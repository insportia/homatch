// Admin verification of one memo23 Actor: current pricing and input schema,
// read from Apify server-side and written to the registry. Verifying never
// enables an Actor; an operator does that separately.

import { actorDefinition, datasetItems, Memo23Error } from './memo23Client.ts';
import { REGISTRY_SEEDS } from '../../../../src/research-core/findBuyers/actorCatalog.ts';
import { requalifyLeads, summarize, duplicateKey } from '../../../../src/research-core/findBuyers/requalify.ts';
import { QUALIFICATION_VERSION } from '../../../../src/research-core/findBuyers/qualify.ts';

export async function verifyActor(db: any, actorKey: string) {
  let { data: actor } = await db.from('find_buyers_actor_registry').select('actor_key,actor_id,input_contract,health').eq('actor_key', actorKey).maybeSingle();
  /* An Actor HOMATCH knows (REGISTRY_SEEDS) but has not registered yet is written
     now, DISABLED and unpriced; the verification below then reads its real price
     and schema from Apify. Enabling stays a separate operator decision. */
  if (!actor && REGISTRY_SEEDS[actorKey]) {
    const seed = REGISTRY_SEEDS[actorKey];
    await db.from('find_buyers_actor_registry').insert({ ...seed, enabled: false, health: 'UNKNOWN', pricing_model: 'UNKNOWN', input_contract: {} });
    ({ data: actor } = await db.from('find_buyers_actor_registry').select('actor_key,actor_id,input_contract,health').eq('actor_key', actorKey).maybeSingle());
  }
  if (!actor) return { success: false, error: 'UNKNOWN_ACTOR' };
  try {
    const def = await actorDefinition(actor.actor_id);
    const verifiedAt = new Date().toISOString();
    const priced = def.pricing.model !== 'UNKNOWN' && def.pricing.pricePer1kMicros != null;
    await db.from('find_buyers_actor_registry').update({
      pricing_model: def.pricing.model,
      price_per_1k_micros: def.pricing.pricePer1kMicros,
      start_fee_micros: def.pricing.startFeeMicros,
      pricing_source: `apify api ${verifiedAt.slice(0, 10)}`,
      /* Only a price Apify actually stated counts as verified. */
      pricing_verified_at: priced ? verifiedAt : null,
      input_contract: { ...(actor.input_contract ?? {}), schemaProperties: def.schemaProperties, required: def.required, pricingRaw: def.pricing.raw ?? null },
      input_contract_verified_at: def.schemaProperties.length ? verifiedAt : null,
      /* Metadata is not a run: health only moves on a real execution. A
         previous failed verification (DEGRADED/FAILED) is cleared to UNKNOWN. */
      ...(['DEGRADED', 'FAILED'].includes(actor.health) ? { health: 'UNKNOWN' } : {}),
      last_verified_at: verifiedAt,
      /* A quarantine note (health DISABLED) survives re-verification. */
      ...(actor.health === 'DISABLED' ? {} : { last_error: priced ? null : 'pricing not stated by Apify; set it manually and mark verified' }),
      updated_at: verifiedAt,
    }).eq('actor_key', actorKey);
    return { success: true, actorKey, pricing: { model: def.pricing.model, pricePer1kMicros: def.pricing.pricePer1kMicros, startFeeMicros: def.pricing.startFeeMicros }, schemaProperties: def.schemaProperties, required: def.required, priced };
  } catch (error) {
    const e = error instanceof Memo23Error ? error : new Memo23Error(String(error), 0, false);
    await db.from('find_buyers_actor_registry').update({ health: e.status === 404 ? 'FAILED' : 'DEGRADED', last_error: e.message.slice(0, 500) }).eq('actor_key', actorKey);
    return { success: false, error: e.message };
  }
}

/* ── why were comments skipped? (free: reads stored datasets, runs nothing) ── */

const COUNTER_KEYS = ['commentsCount', 'commentCount', 'comments_count', 'numComments', 'commentsNumber'];

/**
 * For one campaign's Facebook post runs, read the stored Apify datasets (a
 * dataset read starts no Actor and is not a paid event) and report only the
 * SHAPE of what the Actor returned for comments: which counter field it used,
 * how its values distribute, whether a comments list came with it. No post
 * text, author or URL leaves this function. Datasets Apify no longer keeps are
 * reported as such.
 */
export async function auditCommentCounts(db: any, matchingJobId: string) {
  const { data: runs } = await db.from('find_buyers_actor_runs')
    .select('id,actor_key,dataset_id,items_fetched,status').eq('matching_job_id', matchingJobId)
    .in('actor_key', ['FB_GROUP_POSTS', 'FB_PAGE_POSTS', 'FB_POST_SEARCH']).not('dataset_id', 'is', null).limit(40);
  const perRun: any[] = [];
  const total = { items: 0, counterZero: 0, counterPositive: 0, counterMissing: 0, listNonEmpty: 0, listEmpty: 0, listMissing: 0 };
  const counterFields: Record<string, number> = {};
  const topKeys: Record<string, number> = {};
  for (const r of (runs ?? []) as any[]) {
    try {
      const { items } = await datasetItems(String(r.dataset_id), 200);
      const s = { runId: r.id, actorKey: r.actor_key, items: items.length, counterZero: 0, counterPositive: 0, counterMissing: 0, listNonEmpty: 0, listEmpty: 0, listMissing: 0 };
      for (const it of items as any[]) {
        if (!it || typeof it !== 'object') continue;
        for (const k of Object.keys(it)) topKeys[k] = (topKeys[k] ?? 0) + 1;
        const key = COUNTER_KEYS.find((k) => it[k] != null);
        const v = key ? Number(it[key]) : NaN;
        if (key) counterFields[key] = (counterFields[key] ?? 0) + 1;
        if (!key || !Number.isFinite(v)) s.counterMissing++; else if (v === 0) s.counterZero++; else s.counterPositive++;
        const list = it.comments ?? it.topComments ?? it.latestComments;
        if (!Array.isArray(list)) s.listMissing++; else if (list.length) s.listNonEmpty++; else s.listEmpty++;
      }
      for (const k of Object.keys(total) as Array<keyof typeof total>) total[k] += (s as any)[k];
      perRun.push(s);
    } catch (e) {
      perRun.push({ runId: r.id, actorKey: r.actor_key, error: e instanceof Memo23Error ? `HTTP_${e.status}` : 'READ_FAILED' });
    }
  }
  return { success: true, matchingJobId, runs: perRun.length, total, counterFields, topKeys: Object.keys(topKeys).sort() };
}

/* ── re-qualification of a finished campaign's stored leads ─────────────── */


/**
 * Re-judge one campaign's stored leads with the current qualification, from
 * their stored evidence (the original post text in raw_signals). No provider
 * call, no money. DRY RUN by default: returns before/after counts and each
 * lead's new category. With apply=true it writes the category, reasons and
 * fit next to the lead — nothing is deleted; the previous classification is
 * kept in qualification.before, and REJECTED rows leave the customer view.
 */
export async function requalifyCampaign(db: any, matchingJobId: string, apply = false) {
  const { data: c } = await db.from('find_buyers_campaigns').select('matching_job_id,dna,transaction').eq('matching_job_id', matchingJobId).maybeSingle();
  if (!c?.dna) return { success: false, error: 'NO_CAMPAIGN' };
  const { data: leads } = await db.from('find_buyers_leads')
    .select('id,best_signal_id,author_name,author_profile_url,signal_at,evidence,intent_class,overall_score,strength,match_category,qualification')
    .eq('matching_job_id', matchingJobId).limit(5000);
  const rows = (leads ?? []) as any[];
  if (!rows.length) return { success: true, matchingJobId, apply, before: 0, after: summarize([]), leads: [] };
  const ids = rows.map((r) => r.best_signal_id).filter(Boolean);
  const texts = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 60) {
    const { data } = await db.from('raw_signals').select('id,original_text,source_url,content_type').in('id', ids.slice(i, i + 60));
    for (const s of (data ?? []) as any[]) texts.set(s.id, s);
  }
  const stored = rows.map((r) => {
    const sig = texts.get(r.best_signal_id) ?? {};
    const ev = Array.isArray(r.evidence) ? r.evidence[0] ?? {} : {};
    return {
      id: r.id, text: String(sig.original_text ?? ev.text ?? ''), publishedAt: r.signal_at, url: sig.source_url ?? ev.url ?? null,
      author: r.author_profile_url ?? r.author_name ?? null, kind: (sig.content_type === 'COMMENT' ? 'COMMENT' : 'POST') as 'POST' | 'COMMENT',
      parent: sig.content_type === 'COMMENT' ? { role: 'SALE_OFFER' as const, similarity: Number(ev.similarity ?? 0) } : null,
    };
  });
  /* Judged as of when the campaign ran, so the 30-day rule does not reject
     what was current then; dates are re-checked by the customer view. */
  const asOf = Math.max(...rows.map((r) => Date.parse(r.signal_at ?? '') || 0)) + 3_600_000;
  const out = requalifyLeads(stored, c.dna, { now: asOf });
  const before = rows.filter((r) => (r.match_category ?? 'POTENTIAL') !== 'REJECTED').length;
  if (apply) {
    const at = new Date().toISOString();
    for (const r of out) {
      const prev = rows.find((x) => x.id === r.id)!;
      const q = r.qualification;
      await db.from('find_buyers_leads').update({
        match_category: q.category, rejection_reasons: q.reasons, role: q.role, transaction: q.transaction,
        budget_fit: q.budgetFit, location_fit: q.locationFit, requirements_fit: q.requirementsFit,
        qualification: { ...q, dupKeys: duplicateKey(stored.find((s) => s.id === r.id)!), evidence: r.reading.evidence, confidence: r.reading.confidence,
          duplicateOf: r.duplicateOf, before: prev.qualification?.before ?? { intentClass: prev.intent_class, overallScore: prev.overall_score, strength: prev.strength } },
        qualification_version: QUALIFICATION_VERSION, requalified_at: at,
      }).eq('id', r.id);
    }
  }
  return {
    success: true, matchingJobId, apply, before, after: summarize(out),
    leads: out.map((r) => ({ id: r.id, role: r.reading.role, category: r.qualification.category, reasons: r.qualification.reasons,
      budgetFit: r.qualification.budgetFit, locationFit: r.qualification.locationFit, duplicateOf: r.duplicateOf })),
  };
}
