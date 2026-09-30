// META ADS — CHANGING A LIVE CAMPAIGN. Pause, resume, end, edit budget, edit
// duration, pause one ad. Every one of them is WRITE-THROUGH:
//
//   authorize → validate → commercial check → record the operation
//   (REQUESTED) → Meta API → read Meta back → CONFIRMED → persist locally →
//   update the approved configuration Guard compares against.
//
// Nothing is reported done because our own row changed. If Meta refuses, or
// Meta no longer lets HOMATCH control the object, the operation is FAILED /
// NOT_PERMITTED and the customer is told so. Money moves only with a
// confirmed Meta change, and a failed Meta write gives back what it took.

import { graph, graphAll, MetaApiError } from '../_shared/metaAds.ts';
import { budgetChange, heldFeeFromLedger, type FeePolicy } from '../../../src/lib/metaAds/billing.ts';
import { adSetState, type ManagedState } from '../../../src/lib/metaAds/guard.ts';
import { userToken, customerFeePercent, type MetaSettings } from './engine.ts';

type Sb = any;

export type Actor = 'CUSTOMER' | 'ADMIN' | 'SYSTEM';

export class LifecycleError extends Error {
  code: string;
  status: number;
  extra: Record<string, unknown>;
  constructor(code: string, status = 409, extra: Record<string, unknown> = {}) {
    super(code);
    this.code = code; this.status = status; this.extra = extra;
  }
}

/* ── OPERATIONS LOG ─────────────────────────────────────────────────── */

export async function recordOp(sb: Sb, o: {
  userId: string; campaignId: string | null; op: string; actor: Actor; actorUserId?: string | null;
  object?: string | null; changes?: Array<{ object: string; field: string; expected: unknown }>; key?: string | null;
}): Promise<{ id: string; replay: any | null }> {
  if (o.key) {
    const { data: prior } = await sb.from('meta_operations').select('*').eq('idempotency_key', o.key).maybeSingle();
    if (prior) return { id: prior.id, replay: prior };
  }
  const { data, error } = await sb.from('meta_operations').insert({
    user_id: o.userId, campaign_id: o.campaignId, op: o.op, actor: o.actor, actor_user_id: o.actorUserId ?? null,
    object_external_id: o.object ?? null, changes: o.changes ?? [], idempotency_key: o.key ?? null,
  }).select('id').single();
  if (error) throw error;
  return { id: data.id, replay: null };
}

export async function finishOp(sb: Sb, id: string, status: 'CONFIRMED' | 'FAILED' | 'NOT_PERMITTED', error?: unknown) {
  await sb.from('meta_operations').update({
    status, confirmed_at: status === 'CONFIRMED' ? new Date().toISOString() : null,
    error: error ? { message: String((error as Error)?.message ?? error).slice(0, 300) } : null,
  }).eq('id', id);
}

export async function timeline(sb: Sb, c: { id: string; user_id: string }, kind: string, customerKey: string, params: Record<string, unknown> = {}, dedupe?: string) {
  const { error } = await sb.from('meta_campaign_events').insert({
    campaign_id: c.id, user_id: c.user_id, kind, customer_key: customerKey, params, dedupe_key: dedupe ?? null,
  });
  if (error && !String(error.message).includes('duplicate')) throw error;
  return !error;
}

/** Meta refused because HOMATCH may no longer control this object. */
export function isAccessError(err: unknown): boolean {
  if (!(err instanceof MetaApiError)) return false;
  const code = Number((err as any).normalized?.code ?? (err as any).code ?? 0);
  return [10, 190, 200, 294, 2635, 1487534].includes(code) || /permission|access token|not authori[sz]ed/i.test(String((err as any).normalized?.rawMessage ?? err.message));
}

/* ── READ META: the exact managed state ─────────────────────────────── */

export async function readManagedState(token: string, c: any, audit?: unknown): Promise<ManagedState> {
  const opts = { token, audit } as any;
  const camp = await graph(`/${c.external_campaign_id}?fields=status,effective_status`, opts);
  const sets = await graphAll(`/${c.external_campaign_id}/adsets?fields=id,status,daily_budget,end_time,targeting&limit=50`, opts, 3);
  const ads = await graphAll(`/${c.external_campaign_id}/ads?fields=id,adset_id,status,creative{id}&limit=100`, opts, 3);
  return {
    campaignStatus: String(camp.status ?? camp.effective_status ?? ''),
    adSets: sets.map((s: any) => adSetState(s)),
    ads: ads.map((a: any) => ({ id: String(a.id), adsetId: String(a.adset_id ?? ''), status: String(a.status ?? ''), creativeId: a.creative?.id ? String(a.creative.id) : null })),
    pageId: c.page_external_id ?? null,
    instagramId: c.instagram_external_id ?? null,
    leadFormId: c.lead_form_external_id ?? null,
  };
}

export async function setApproved(sb: Sb, c: any, state: ManagedState) {
  await sb.from('meta_campaigns').update({
    approved_state: state, approved_version: Number(c.approved_version ?? 0) + 1,
  }).eq('id', c.id);
}

/* ── GUARD SUSPENSION: new managed operations stop, reading never does ── */

export async function assertNotSuspended(sb: Sb, userId: string, adAccountId: string | null) {
  if (!adAccountId) return;
  const { data } = await sb.from('meta_guard_accounts').select('status')
    .eq('user_id', userId).eq('ad_account_external_id', adAccountId).maybeSingle();
  if (data?.status === 'SUSPENDED') throw new LifecycleError('META_ADS_ACCESS_SUSPENDED', 403);
}

export async function feePolicyFor(sb: Sb, userId: string): Promise<FeePolicy | null> {
  const { data } = await sb.from('meta_fee_policies').select('kind,percent').eq('user_id', userId).maybeSingle();
  return data ? { kind: data.kind, percent: data.percent } : null;
}

export async function feePercentFor(sb: Sb, userId: string, settings: MetaSettings): Promise<number> {
  return customerFeePercent(sb, userId, settings);
}

const LIVE = ['SUBMITTED', 'META_REVIEW', 'ACTIVE', 'PAUSED'];
const isMock = (c: any) => !c.external_campaign_id || String(c.external_campaign_id).startsWith('mock_');

async function tokenOrThrow(sb: Sb, userId: string) {
  const token = await userToken(sb, userId);
  if (!token) throw new LifecycleError('META_CONNECTION_NEEDS_ATTENTION', 409);
  return token;
}

/* ── PAUSE / RESUME / END ───────────────────────────────────────────── */

export async function setCampaignStatus(sb: Sb, c: any, to: 'PAUSED' | 'ACTIVE', ctx: { actor: Actor; actorUserId?: string | null; op?: string; key?: string | null }) {
  if (!LIVE.includes(c.status)) throw new LifecycleError('BAD_TRANSITION', 409, { from: c.status });
  if (to === 'ACTIVE') {
    if (c.status !== 'PAUSED') throw new LifecycleError('BAD_TRANSITION', 409, { from: c.status });
    if (c.guard_state === 'LOCKED_FOR_REVIEW' && ctx.actor !== 'ADMIN') throw new LifecycleError('CAMPAIGN_UNDER_REVIEW', 409);
    await assertNotSuspended(sb, c.user_id, c.ad_account_external_id);
  }
  const op = await recordOp(sb, {
    userId: c.user_id, campaignId: c.id, op: ctx.op ?? (to === 'PAUSED' ? 'PAUSE' : 'RESUME'), actor: ctx.actor,
    actorUserId: ctx.actorUserId, object: c.external_campaign_id, key: ctx.key,
    changes: [{ object: 'campaign', field: 'status', expected: to }],
  });
  if (op.replay) return { replay: true, status: op.replay.status };
  if (isMock(c)) {
    await finishOp(sb, op.id, 'CONFIRMED');
    await sb.from('meta_campaigns').update({ status: to === 'ACTIVE' ? 'META_REVIEW' : 'PAUSED' }).eq('id', c.id);
    return { status: to === 'ACTIVE' ? 'META_REVIEW' : 'PAUSED', mock: true };
  }
  const token = await tokenOrThrow(sb, c.user_id);
  try {
    await graph(`/${c.external_campaign_id}`, { token, method: 'POST', body: { status: to }, audit: { sb, userId: c.user_id, campaignId: c.id }, attempts: 1 });
    const back = await graph(`/${c.external_campaign_id}?fields=status`, { token, attempts: 2 });
    if (String(back.status) !== to) throw new LifecycleError('META_DID_NOT_CONFIRM', 502);
  } catch (err) {
    await finishOp(sb, op.id, isAccessError(err) ? 'NOT_PERMITTED' : 'FAILED', err);
    if (isAccessError(err)) throw new LifecycleError('META_CONNECTION_NEEDS_ATTENTION', 409);
    throw err;
  }
  await finishOp(sb, op.id, 'CONFIRMED');
  const approved = c.approved_state ? { ...c.approved_state, campaignStatus: to } : null;
  await sb.from('meta_campaigns').update({
    status: to === 'ACTIVE' ? 'META_REVIEW' : 'PAUSED',
    ...(approved ? { approved_state: approved, approved_version: Number(c.approved_version ?? 0) + 1 } : {}),
  }).eq('id', c.id);
  await timeline(sb, c, to === 'PAUSED' ? 'PAUSED_BY_HOMATCH' : 'RESUMED_BY_HOMATCH', to === 'PAUSED' ? 'tl_paused' : 'tl_resumed', { by: ctx.actor });
  return { status: to === 'ACTIVE' ? 'META_REVIEW' : 'PAUSED' };
}

/**
 * END: delivery stops at Meta (the campaign is paused there, never deleted —
 * its history stays in Ads Manager and in HOMATCH), then the campaign is
 * COMPLETED here. The service fee settles after a short grace period, so the
 * spend Meta attributes late is counted before anything is released.
 */
export async function endCampaign(sb: Sb, c: any, ctx: { actor: Actor; actorUserId?: string | null; key?: string | null }) {
  if (!LIVE.includes(c.status)) throw new LifecycleError('BAD_TRANSITION', 409, { from: c.status });
  const op = await recordOp(sb, {
    userId: c.user_id, campaignId: c.id, op: 'END', actor: ctx.actor, actorUserId: ctx.actorUserId,
    object: c.external_campaign_id, key: ctx.key, changes: [{ object: 'campaign', field: 'status', expected: 'PAUSED' }],
  });
  if (op.replay) return { replay: true };
  if (!isMock(c)) {
    const token = await tokenOrThrow(sb, c.user_id);
    try {
      if (c.status !== 'PAUSED') {
        await graph(`/${c.external_campaign_id}`, { token, method: 'POST', body: { status: 'PAUSED' }, audit: { sb, userId: c.user_id, campaignId: c.id }, attempts: 1 });
      }
      const back = await graph(`/${c.external_campaign_id}?fields=status`, { token, attempts: 2 });
      if (String(back.status) !== 'PAUSED') throw new LifecycleError('META_DID_NOT_CONFIRM', 502);
    } catch (err) {
      await finishOp(sb, op.id, isAccessError(err) ? 'NOT_PERMITTED' : 'FAILED', err);
      if (isAccessError(err)) throw new LifecycleError('META_CONNECTION_NEEDS_ATTENTION', 409);
      throw err;
    }
  }
  await finishOp(sb, op.id, 'CONFIRMED');
  const now = new Date().toISOString();
  await sb.from('meta_campaigns').update({
    status: 'COMPLETED', ended_at: now,
    ...(c.approved_state ? { approved_state: { ...c.approved_state, campaignStatus: 'PAUSED' } } : {}),
  }).eq('id', c.id);
  await timeline(sb, c, 'ENDED', 'tl_ended', { by: ctx.actor });
  await sb.from('meta_funnel_events').insert({ event: 'campaign_ended', user_id: c.user_id });
  return { status: 'COMPLETED', endedAt: now };
}

/* ── EDIT BUDGET / DURATION ─────────────────────────────────────────── */

/** Split a new daily total across ad sets in the proportions they had. */
export function splitLike(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((n, w) => n + Math.max(0, w), 0);
  const w = sum > 0 ? weights.map((x) => Math.max(0, x)) : weights.map(() => 1);
  const s = sum > 0 ? sum : weights.length;
  const raw = w.map((x) => Math.floor((total * x) / s));
  let rest = total - raw.reduce((n, r) => n + r, 0);
  for (let i = 0; rest > 0; i = (i + 1) % raw.length, rest -= 1) raw[i] += 1;
  return raw;
}

async function ledgerRows(sb: Sb, campaignId: string) {
  const { data } = await sb.from('meta_ads_ledger').select('entry_type,amount_cents,idempotency_key').eq('campaign_id', campaignId);
  return data ?? [];
}

async function available(sb: Sb, userId: string, currency: string): Promise<number> {
  const { data } = await sb.from('meta_wallet_balances').select('available_cents').eq('user_id', userId).eq('currency', currency).maybeSingle();
  return Number(data?.available_cents ?? 0);
}

/**
 * The shared money + Meta path for a budget or duration change. Preview
 * (commit=false) returns the financial delta and changes nothing.
 */
export async function changePlan(sb: Sb, c: any, settings: MetaSettings, change: { dailyBudgetCents?: number; durationDays?: number },
  ctx: { actor: Actor; actorUserId?: string | null; key?: string | null; commit: boolean; op?: 'EDIT_BUDGET' | 'EDIT_DURATION' | 'APPLY_RECOMMENDATION' }) {
  if (!LIVE.includes(c.status)) throw new LifecycleError('BAD_TRANSITION', 409, { from: c.status });
  /* The fee delta below is the whole money story only when Meta bills the
     customer's own ad account. With the budget held in the HOMATCH wallet a
     change would also have to move the media reserve — not offered. */
  if (settings.budgetBilling !== 'CUSTOMER_AD_ACCOUNT') throw new LifecycleError('EDIT_NOT_AVAILABLE_FOR_BILLING_MODEL', 409);
  await assertNotSuspended(sb, c.user_id, c.ad_account_external_id);
  if (c.guard_state === 'LOCKED_FOR_REVIEW' && ctx.actor !== 'ADMIN') throw new LifecycleError('CAMPAIGN_UNDER_REVIEW', 409);

  const newDaily = Math.round(Number(change.dailyBudgetCents ?? c.daily_budget_cents));
  const newDays = Math.round(Number(change.durationDays ?? c.duration_days));
  if (!(newDaily >= settings.minDailyCents) || newDaily > settings.maxDailyCents) throw new LifecycleError('BUDGET_OUT_OF_RANGE', 400, { min: settings.minDailyCents, max: settings.maxDailyCents });
  const launchedAt = c.launched_at ? Date.parse(c.launched_at) : Date.now();
  const elapsedDays = Math.max(0, Math.ceil((Date.now() - launchedAt) / 86_400_000));
  const minDays = Math.max(settings.minDurationDays, elapsedDays + 1);
  if (!(newDays >= minDays) || newDays > 365) throw new LifecycleError('DURATION_OUT_OF_RANGE', 400, { min: minDays, max: 365 });
  const newEnd = new Date(launchedAt + newDays * 86_400_000 + 5 * 60_000).toISOString();
  if (Date.parse(newEnd) < Date.now() + 60 * 60_000) throw new LifecycleError('DURATION_OUT_OF_RANGE', 400, { min: minDays });

  const feePercent = Number.isFinite(Number(c.fee_percent)) && c.fee_percent != null ? Number(c.fee_percent) : await feePercentFor(sb, c.user_id, settings);
  const held = heldFeeFromLedger(await ledgerRows(sb, c.id));
  const delta = budgetChange({ newDailyBudgetCents: newDaily, newDurationDays: newDays, feePercent, heldFeeCents: held, spentMediaCents: Number(c.spend_cents ?? 0) });
  const avail = await available(sb, c.user_id, c.currency);
  const preview = {
    currentDailyCents: Number(c.daily_budget_cents), currentDays: Number(c.duration_days),
    newDailyCents: newDaily, newDays, feePercent, heldFeeCents: held,
    requiredFeeCents: delta.requiredFeeCents, additionalCents: delta.additionalCents, releaseCents: delta.releaseCents,
    availableCents: avail, shortfallCents: Math.max(0, delta.additionalCents - avail), minDays,
  };
  if (!ctx.commit) return { preview };
  if (preview.shortfallCents > 0) throw new LifecycleError('INSUFFICIENT_FUNDS', 402, { preview });

  const sets: Array<{ key: string; dailyBudgetCents: number }> = Array.isArray(c.plan?.adSets) ? c.plan.adSets : [];
  const { data: setRows } = await sb.from('meta_ad_entities').select('external_id,config').eq('campaign_id', c.id).eq('kind', 'AD_SET');
  const adSetIds: string[] = (setRows ?? []).map((r: any) => String(r.external_id));
  const budgets = splitLike(newDaily, (setRows ?? []).map((r: any) => Number(r.config?.dailyBudgetCents ?? 0)));
  const opName = ctx.op ?? (change.dailyBudgetCents != null ? 'EDIT_BUDGET' : 'EDIT_DURATION');
  const op = await recordOp(sb, {
    userId: c.user_id, campaignId: c.id, op: opName, actor: ctx.actor, actorUserId: ctx.actorUserId, key: ctx.key,
    object: c.external_campaign_id,
    changes: adSetIds.flatMap((id, i) => [
      ...(budgets[i] !== undefined ? [{ object: id, field: 'daily_budget', expected: budgets[i] }] : []),
      { object: id, field: 'end_time', expected: newEnd },
    ]),
  });
  if (op.replay) return { replay: true, status: op.replay.status, preview };

  // 1. Money first when more is needed (the balance guard refuses overdraft).
  if (delta.additionalCents > 0) {
    const { error } = await sb.from('meta_ads_ledger').insert({
      user_id: c.user_id, currency: c.currency, campaign_id: c.id, entry_type: 'HOMATCH_FEE',
      amount_cents: -delta.additionalCents, idempotency_key: `${c.id}:op:${op.id}:fee`, note: 'service fee for a larger plan',
    });
    if (error) {
      await finishOp(sb, op.id, 'FAILED', error);
      if (String(error.message).includes('INSUFFICIENT_FUNDS')) throw new LifecycleError('INSUFFICIENT_FUNDS', 402, { preview });
      throw error;
    }
  }

  // 2. Meta, every ad set, each read back.
  const done: Array<{ id: string; prev: Record<string, unknown> }> = [];
  if (!isMock(c)) {
    const token = await tokenOrThrow(sb, c.user_id);
    try {
      for (const [i, id] of adSetIds.entries()) {
        const prev = await graph(`/${id}?fields=daily_budget,end_time`, { token, attempts: 2 });
        const body: Record<string, unknown> = { end_time: newEnd };
        if (budgets[i] !== undefined) body.daily_budget = budgets[i];
        await graph(`/${id}`, { token, method: 'POST', body, audit: { sb, userId: c.user_id, campaignId: c.id }, attempts: 1 });
        done.push({ id, prev: { daily_budget: prev.daily_budget, end_time: prev.end_time } });
        const back = await graph(`/${id}?fields=daily_budget,end_time`, { token, attempts: 2 });
        if (budgets[i] !== undefined && Math.round(Number(back.daily_budget)) !== budgets[i]) throw new LifecycleError('META_DID_NOT_CONFIRM', 502);
      }
    } catch (err) {
      // Put back what was changed, and give back the fee just taken.
      for (const d of done) {
        try { await graph(`/${d.id}`, { token, method: 'POST', body: d.prev, attempts: 1 }); } catch { /* recorded in the op */ }
      }
      if (delta.additionalCents > 0) {
        await sb.from('meta_ads_ledger').insert({
          user_id: c.user_id, currency: c.currency, campaign_id: c.id, entry_type: 'FEE_RELEASE',
          amount_cents: delta.additionalCents, idempotency_key: `${c.id}:op:${op.id}:revert`, note: 'Meta did not apply the change',
        });
      }
      await finishOp(sb, op.id, isAccessError(err) ? 'NOT_PERMITTED' : 'FAILED', err);
      if (isAccessError(err)) throw new LifecycleError('META_CONNECTION_NEEDS_ATTENTION', 409);
      throw err;
    }
  }

  // 3. Confirmed: release what the smaller plan no longer needs, persist.
  if (delta.releaseCents > 0) {
    await sb.from('meta_ads_ledger').insert({
      user_id: c.user_id, currency: c.currency, campaign_id: c.id, entry_type: 'FEE_RELEASE',
      amount_cents: delta.releaseCents, idempotency_key: `${c.id}:op:${op.id}:release`, note: 'released to HOMATCH balance',
    });
  }
  await finishOp(sb, op.id, 'CONFIRMED');
  const plan = c.plan ? { ...c.plan, adSets: sets.map((s, i) => ({ ...s, dailyBudgetCents: budgets[i] ?? s.dailyBudgetCents })) } : c.plan;
  const approved = c.approved_state ? {
    ...c.approved_state,
    adSets: c.approved_state.adSets.map((s: any) => {
      const i = adSetIds.indexOf(s.id);
      return { ...s, dailyBudget: i >= 0 && budgets[i] !== undefined ? budgets[i] : s.dailyBudget, endTime: newEnd.slice(0, 16) };
    }),
  } : null;
  await sb.from('meta_campaigns').update({
    daily_budget_cents: newDaily, duration_days: newDays, plan, fee_percent: feePercent,
    ...(approved ? { approved_state: approved, approved_version: Number(c.approved_version ?? 0) + 1 } : {}),
  }).eq('id', c.id);
  for (const [i, id] of adSetIds.entries()) {
    const { data: row } = await sb.from('meta_ad_entities').select('config').eq('campaign_id', c.id).eq('kind', 'AD_SET').eq('external_id', id).maybeSingle();
    await sb.from('meta_ad_entities').update({ config: { ...(row?.config ?? {}), dailyBudgetCents: budgets[i] } }).eq('campaign_id', c.id).eq('kind', 'AD_SET').eq('external_id', id);
  }
  const changedBudget = newDaily !== Number(c.daily_budget_cents);
  const changedDays = newDays !== Number(c.duration_days);
  if (changedBudget) await timeline(sb, c, 'BUDGET_CHANGED', 'tl_budget_changed', { from: Number(c.daily_budget_cents), to: newDaily, currency: c.currency });
  if (changedDays) await timeline(sb, c, 'DURATION_CHANGED', 'tl_duration_changed', { from: Number(c.duration_days), to: newDays });
  await sb.from('meta_funnel_events').insert({ event: changedBudget ? 'budget_edited' : 'duration_edited', user_id: c.user_id });
  return { ok: true, preview };
}

/** Pause ONE ad (a recommendation the customer applied). */
export async function setAdStatus(sb: Sb, c: any, adId: string, to: 'PAUSED' | 'ACTIVE', ctx: { actor: Actor; actorUserId?: string | null; key?: string | null }) {
  const { data: owned } = await sb.from('meta_ad_entities').select('external_id').eq('campaign_id', c.id).eq('kind', 'AD').eq('external_id', adId).maybeSingle();
  if (!owned) throw new LifecycleError('AD_NOT_IN_CAMPAIGN', 404);
  await assertNotSuspended(sb, c.user_id, c.ad_account_external_id);
  const op = await recordOp(sb, { userId: c.user_id, campaignId: c.id, op: to === 'PAUSED' ? 'PAUSE_AD' : 'RESUME_AD', actor: ctx.actor, actorUserId: ctx.actorUserId, object: adId, key: ctx.key, changes: [{ object: adId, field: 'status', expected: to }] });
  if (op.replay) return { replay: true };
  if (!isMock(c)) {
    const token = await tokenOrThrow(sb, c.user_id);
    try {
      await graph(`/${adId}`, { token, method: 'POST', body: { status: to }, attempts: 1 });
      const back = await graph(`/${adId}?fields=status`, { token, attempts: 2 });
      if (String(back.status) !== to) throw new LifecycleError('META_DID_NOT_CONFIRM', 502);
    } catch (err) {
      await finishOp(sb, op.id, isAccessError(err) ? 'NOT_PERMITTED' : 'FAILED', err);
      throw err;
    }
  }
  await finishOp(sb, op.id, 'CONFIRMED');
  if (c.approved_state) {
    const approved = { ...c.approved_state, ads: c.approved_state.ads.map((a: any) => (a.id === adId ? { ...a, status: to } : a)) };
    await sb.from('meta_campaigns').update({ approved_state: approved, approved_version: Number(c.approved_version ?? 0) + 1 }).eq('id', c.id);
  }
  return { ok: true };
}
