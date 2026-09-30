// META ADS GUARD — the edge half. guard.ts decides; this file reconciles Meta,
// records incidents, applies (and verifies) protective actions, and keeps the
// per-ad-account strike count. It only ever acts on objects that resolve
// through HOMATCH's own mapping, or on a campaign proven to be a copy of one.

import { graph, graphAll } from '../_shared/metaAds.ts';
import {
  diffState, classifyExternal, isHomatchOrigin, decide, duplicateLevel, activeStrikeCount,
  type GuardPolicy, type ManagedState, type HomatchOperation, type ExternalAction, type CampaignFingerprint, type GuardDecision,
} from '../../../src/lib/metaAds/guard.ts';
import { recordOp, finishOp, timeline, isAccessError, setApproved } from './lifecycle.ts';

type Sb = any;

export interface GuardOutcome { incidents: number; protective: number; adopted: boolean }

async function recentOps(sb: Sb, campaignId: string, sinceMs: number): Promise<HomatchOperation[]> {
  const { data } = await sb.from('meta_operations').select('changes,requested_at,confirmed_at,status')
    .eq('campaign_id', campaignId).gte('requested_at', new Date(sinceMs).toISOString()).in('status', ['REQUESTED', 'CONFIRMED']);
  const out: HomatchOperation[] = [];
  for (const o of data ?? []) {
    for (const ch of (o.changes ?? []) as Array<{ object: string; field: string; expected: unknown }>) {
      out.push({ object: ch.object, field: ch.field, expected: ch.expected, requestedAt: o.requested_at, confirmedAt: o.confirmed_at });
    }
  }
  return out;
}

async function accountHistory(sb: Sb, userId: string, account: string, windowDays: number) {
  const { data } = await sb.from('meta_guard_incidents').select('action,level,status,created_at')
    .eq('user_id', userId).eq('ad_account_external_id', account)
    .gte('created_at', new Date(Date.now() - Math.max(windowDays, 400) * 86_400_000).toISOString());
  return data ?? [];
}

/** Recompute and store the account's standing from its incidents. */
export async function refreshAccount(sb: Sb, userId: string, account: string, policy: GuardPolicy, forceSuspend = false) {
  const incidents = await accountHistory(sb, userId, account, policy.windowDays);
  const strikes = activeStrikeCount(incidents, Date.now(), policy);
  const warnings = incidents.filter((i: any) => i.level === 'WARNING' && i.status === 'ACTIVE'
    && Date.parse(i.created_at) >= Date.now() - policy.windowDays * 86_400_000).length;
  const { data: prev } = await sb.from('meta_guard_accounts').select('status').eq('user_id', userId).eq('ad_account_external_id', account).maybeSingle();
  const suspended = forceSuspend || strikes >= policy.maxStrikes || prev?.status === 'SUSPENDED';
  const status = suspended ? 'SUSPENDED' : strikes > 0 || warnings > 0 ? 'WATCH' : 'ACTIVE';
  await sb.from('meta_guard_accounts').upsert({
    user_id: userId, ad_account_external_id: account, status, active_strikes: strikes, active_warnings: warnings,
    ...(suspended && prev?.status !== 'SUSPENDED' ? { suspended_at: new Date().toISOString() } : {}),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,ad_account_external_id' });
  return { status, strikes, warnings, newlySuspended: suspended && prev?.status !== 'SUSPENDED' };
}

async function writeIncident(sb: Sb, c: any, account: string, action: ExternalAction, d: GuardDecision, evidence: unknown, affected: string[], dedupe: string) {
  const { data, error } = await sb.from('meta_guard_incidents').insert({
    user_id: c.user_id, ad_account_external_id: account, campaign_id: c.id ?? null, action, level: d.level,
    customer_key: d.customerKey, points: d.points, protective_action: d.action, affected_external_ids: affected, dedupe_key: dedupe,
  }).select('id').single();
  if (error) {
    if (String(error.message).includes('duplicate')) return null;
    throw error;
  }
  await sb.from('meta_guard_evidence').insert({ incident_id: data.id, evidence });
  return data.id as string;
}

async function pauseVerified(sb: Sb, token: string, objectId: string, c: any, op: string): Promise<'APPLIED' | 'FAILED' | 'NOT_PERMITTED'> {
  const rec = await recordOp(sb, { userId: c.user_id, campaignId: c.id ?? null, op, actor: 'SYSTEM', object: objectId, changes: [{ object: objectId, field: 'status', expected: 'PAUSED' }] });
  try {
    await graph(`/${objectId}`, { token, method: 'POST', body: { status: 'PAUSED' }, attempts: 1 });
    const back = await graph(`/${objectId}?fields=status`, { token, attempts: 2 });
    if (String(back.status) !== 'PAUSED') throw new Error('META_DID_NOT_CONFIRM');
    await finishOp(sb, rec.id, 'CONFIRMED');
    return 'APPLIED';
  } catch (err) {
    const denied = isAccessError(err);
    await finishOp(sb, rec.id, denied ? 'NOT_PERMITTED' : 'FAILED', err);
    return denied ? 'NOT_PERMITTED' : 'FAILED';
  }
}

/**
 * One campaign: approved vs Meta's current state. HOMATCH-originated changes
 * are adopted silently; external ones are classified and judged.
 */
export async function guardCampaign(sb: Sb, c: any, current: ManagedState, token: string, policy: GuardPolicy, enabled: boolean,
  onDecision?: (d: { action: ExternalAction; decision: GuardDecision; incidentId: string; account: string }) => Promise<void>): Promise<GuardOutcome> {
  const out: GuardOutcome = { incidents: 0, protective: 0, adopted: false };
  if (!c.approved_state) { await setApproved(sb, c, current); out.adopted = true; return out; }
  const diff = diffState(c.approved_state as ManagedState, current);
  if (diff.length === 0) return out;
  const ops = await recentOps(sb, c.id, Date.now() - policy.originGraceMinutes * 60_000);
  const external = diff.filter((i) => !isHomatchOrigin(i, ops, Date.now(), policy));
  const account = String(c.ad_account_external_id ?? '');
  let locked = false;
  if (enabled && account && external.length) {
    for (const ev of classifyExternal(external)) {
      const history = (await accountHistory(sb, c.user_id, account, policy.windowDays))
        .filter((h: any) => h.status === 'ACTIVE').map((h: any) => ({ action: h.action, level: h.level, at: h.created_at }));
      const strikes = activeStrikeCount(await accountHistory(sb, c.user_id, account, policy.windowDays), Date.now(), policy);
      const d = decide({ action: ev.action, high: ev.high, history, activeStrikes: strikes, now: Date.now() }, policy);
      const fingerprint = ev.items.map((i) => `${i.object}:${i.field}:${JSON.stringify(i.to)}`).sort().join('|');
      const incidentId = await writeIncident(sb, c, account, ev.action, d, { items: ev.items, homatchOps: ops.length, approvedVersion: c.approved_version },
        ev.items.map((i) => i.object), `${c.id}:${ev.action}:${fingerprint}`);
      if (!incidentId) continue;
      out.incidents += 1;
      await timeline(sb, c, 'CHANGED_IN_META', ev.action === 'MANUAL_PAUSE' ? 'tl_paused_in_meta' : ev.action === 'MANUAL_RESUME' ? 'tl_resumed_in_meta' : 'tl_changed_in_meta', {});
      if (d.level !== 'NOTICE') await timeline(sb, c, `GUARD_${d.level}`, d.level === 'STRIKE' ? 'tl_guard_warning_n' : 'tl_guard_attention', { n: d.strikesAfter, of: policy.maxStrikes });
      if (d.action === 'PAUSE_CAMPAIGN') {
        const res = await pauseVerified(sb, token, String(c.external_campaign_id), c, 'GUARD_PAUSE_CAMPAIGN');
        await sb.from('meta_guard_incidents').update({ protective_status: res }).eq('id', incidentId);
        if (res === 'APPLIED') {
          locked = true; out.protective += 1;
          await sb.from('meta_campaigns').update({ guard_state: 'LOCKED_FOR_REVIEW', status: 'PAUSED' }).eq('id', c.id);
          await timeline(sb, c, 'PROTECTIVE_ACTION', 'tl_protective_pause', {});
        }
      }
      await refreshAccount(sb, c.user_id, account, policy, d.suspend);
      if (onDecision) await onDecision({ action: ev.action, decision: d, incidentId, account });
    }
  }
  // Meta is authoritative for delivery: the observed state becomes the new
  // baseline (one incident per change, never one per sync) — except when a
  // protective pause locked the campaign for review, where the approved
  // HOMATCH configuration is what an admin restores to.
  if (!locked) { await setApproved(sb, c, { ...current, campaignStatus: current.campaignStatus }); out.adopted = true; }
  await timeline(sb, c, 'SYNCED', 'tl_synced', {}, `${c.id}:synced:${new Date().toISOString().slice(0, 13)}`);
  return out;
}

/* ── DUPLICATES ───────────────────────────────────────────────────────── */

async function managedFingerprint(sb: Sb, c: any): Promise<CampaignFingerprint & { adIds: string[]; launchedAt: string | null }> {
  const { data: ents } = await sb.from('meta_ad_entities').select('kind,external_id,config').eq('campaign_id', c.id);
  const { data: crs } = await sb.from('meta_creatives').select('headline,primary_text').eq('campaign_id', c.id);
  const creatives = (ents ?? []).filter((e: any) => e.kind === 'CREATIVE');
  const countries = [...new Set(((c.approved_state?.adSets ?? []) as any[]).flatMap((s) => s.countries ?? []))];
  return {
    id: String(c.external_campaign_id), name: String(c.name ?? ''), createdTime: c.launched_at ?? null,
    sourceCampaignId: null, sourceAdIds: [],
    imageHashes: creatives.map((e: any) => e.config?.imageHash).filter(Boolean),
    videoIds: creatives.map((e: any) => e.config?.videoId).filter(Boolean),
    texts: (crs ?? []).flatMap((r: any) => [r.headline, r.primary_text]).filter(Boolean),
    leadFormIds: c.lead_form_external_id ? [String(c.lead_form_external_id)] : [],
    pageIds: c.page_external_id ? [String(c.page_external_id)] : [],
    countries: countries as string[],
    adIds: (ents ?? []).filter((e: any) => e.kind === 'AD').map((e: any) => String(e.external_id)),
    launchedAt: c.launched_at ?? null,
  };
}

async function candidateFingerprint(token: string, camp: any): Promise<CampaignFingerprint> {
  const ads = await graphAll(`/${camp.id}/ads?fields=id,source_ad_id,creative{object_story_spec,image_hash,body,title}&limit=25`, { token } as any, 1);
  const sets = await graphAll(`/${camp.id}/adsets?fields=targeting&limit=10`, { token } as any, 1);
  const hashes: string[] = []; const videos: string[] = []; const texts: string[] = []; const forms: string[] = []; const pages: string[] = [];
  for (const a of ads) {
    const cr: any = a.creative ?? {};
    const oss: any = cr.object_story_spec ?? {};
    const ld = oss.link_data ?? {}; const vd = oss.video_data ?? {}; const pd = oss.photo_data ?? {};
    for (const h of [cr.image_hash, ld.image_hash, pd.image_hash, vd.image_hash]) if (h) hashes.push(String(h));
    if (vd.video_id) videos.push(String(vd.video_id));
    for (const t of [cr.body, cr.title, ld.message, ld.name, vd.message, vd.title, pd.caption]) if (t) texts.push(String(t));
    const form = ld.call_to_action?.value?.lead_gen_form_id ?? vd.call_to_action?.value?.lead_gen_form_id;
    if (form) forms.push(String(form));
    if (oss.page_id) pages.push(String(oss.page_id));
  }
  return {
    id: String(camp.id), name: String(camp.name ?? ''), createdTime: camp.created_time ?? null,
    sourceCampaignId: camp.source_campaign_id ? String(camp.source_campaign_id) : null,
    sourceAdIds: ads.map((a: any) => a.source_ad_id).filter(Boolean).map(String),
    imageHashes: [...new Set(hashes)], videoIds: [...new Set(videos)], texts: [...new Set(texts)],
    leadFormIds: [...new Set(forms)], pageIds: [...new Set(pages)],
    countries: [...new Set(sets.flatMap((s: any) => s.targeting?.geo_locations?.countries ?? []))] as string[],
  };
}

/**
 * Read-only over the ad account's recent campaigns; acts only on a proven or
 * high-confidence copy of a HOMATCH-managed campaign, by pausing the copy
 * (never deleting, never touching anything else). Anything weaker is a
 * REVIEW_REQUIRED incident for an admin.
 */
export async function scanDuplicates(sb: Sb, token: string, userId: string, account: string, policy: GuardPolicy,
  onDecision?: (d: { action: ExternalAction; decision: GuardDecision; incidentId: string; account: string; campaign: any }) => Promise<void>) {
  const { data: managedRows } = await sb.from('meta_campaigns').select('*').eq('user_id', userId).eq('ad_account_external_id', account)
    .not('external_campaign_id', 'is', null).not('launched_at', 'is', null);
  const managed = managedRows ?? [];
  if (managed.length === 0) return { scanned: 0, incidents: 0 };
  const managedIds = new Set(managed.map((m: any) => String(m.external_campaign_id)));
  const earliest = Math.min(...managed.map((m: any) => Date.parse(m.launched_at)));
  const since = Math.floor(Math.max(earliest, Date.now() - 30 * 86_400_000) / 1000);
  const recent = await graphAll(`/${account}/campaigns?fields=id,name,created_time,source_campaign_id,effective_status&filtering=${encodeURIComponent(JSON.stringify([{ field: 'created_time', operator: 'GREATER_THAN', value: since }]))}&limit=50`, { token } as any, 2);
  const fps = await Promise.all(managed.map((m: any) => managedFingerprint(sb, m)));
  let incidents = 0;
  for (const camp of recent) {
    if (managedIds.has(String(camp.id))) continue;
    const fp = await candidateFingerprint(token, camp);
    let best: { level: string; score: number; signals: string[]; source: any } | null = null;
    for (const [i, m] of fps.entries()) {
      const r = duplicateLevel(m, fp, policy);
      if (r.level !== 'NONE' && (!best || r.score > best.score)) best = { ...r, source: managed[i] };
    }
    if (!best) continue;
    const src = best.source;
    const action: ExternalAction = best.level === 'CONFIRMED_DUPLICATE' ? 'CONFIRMED_DUPLICATE' : 'POSSIBLE_DUPLICATE';
    const history = (await accountHistory(sb, userId, account, policy.windowDays)).filter((h: any) => h.status === 'ACTIVE').map((h: any) => ({ action: h.action, level: h.level, at: h.created_at }));
    const strikes = activeStrikeCount(await accountHistory(sb, userId, account, policy.windowDays), Date.now(), policy);
    const d = decide({ action, duplicate: best.level as any, history, activeStrikes: strikes, now: Date.now() }, policy);
    const incidentId = await writeIncident(sb, src, account, action, d,
      { duplicateOf: String(src.external_campaign_id), candidate: fp.id, level: best.level, score: best.score, signals: best.signals },
      [fp.id], `dup:${fp.id}:${best.level}`);
    if (!incidentId) continue;
    incidents += 1;
    await timeline(sb, src, 'DUPLICATE_DETECTED', d.level === 'STRIKE' ? 'tl_duplicate_detected' : 'tl_duplicate_review', {});
    if (d.action === 'PAUSE_DUPLICATE') {
      // Pausing is the fail-safe first step; the copy is proven to derive from
      // this HOMATCH campaign and lives in the account the customer authorized.
      const res = await pauseVerified(sb, token, fp.id, { user_id: userId, id: null }, 'GUARD_PAUSE_DUPLICATE');
      await sb.from('meta_guard_incidents').update({ protective_status: res }).eq('id', incidentId);
      if (res === 'APPLIED') await timeline(sb, src, 'PROTECTIVE_ACTION', 'tl_protective_pause_copy', {});
    }
    await refreshAccount(sb, userId, account, policy, d.suspend);
    if (onDecision) await onDecision({ action, decision: d, incidentId, account, campaign: src });
  }
  return { scanned: recent.length, incidents };
}
