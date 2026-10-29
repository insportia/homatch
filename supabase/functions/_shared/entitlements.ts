/*
 * SUBSCRIPTION ENTITLEMENTS — the gate in front of a gated operation (owner decision 2026-10-29).
 *
 * Funding order, decided in SQL by saas_usage_begin (migration 20261207100000), never here:
 *   first-use trial -> plan allowance -> legacy credit balance -> refusal.
 *
 * Success-only: a TRIAL or PLAN use is RESERVED when the work starts, COMMITTED only when the
 * customer received the result, RELEASED on failure. A stale reservation is returned by the
 * sweeper (saas_subscription_tick). The legacy path is the product's existing wallet code
 * (beginExecution / settleExecution / releaseExecution), unchanged, for accounts that still hold
 * credits; credits are no longer sold.
 */
import type { ExecutionGrant } from './billing.ts';

export type SaasFeature = 'VERIFY' | 'CONTRACT_ANALYSIS' | 'PREMIUM_DISCOVERY';
export type EntitledFunding = 'TRIAL' | 'PLAN' | 'LEGACY_CREDITS';
export type EntitlementRefusal = 'SUBSCRIPTION_REQUIRED' | 'ALLOWANCE_EXHAUSTED' | 'ERROR' | string;

export interface EntitledGrant {
  ok: boolean;
  funding: EntitledFunding | null;
  feature: SaasFeature;
  userId: string;
  key: string;
  /** The wallet grant when funding is LEGACY_CREDITS. */
  legacy: ExecutionGrant | null;
  reason?: EntitlementRefusal;
  trialBlocked?: string | null;
  /** True when this key was already committed (same document re-run): nothing new is consumed. */
  alreadyCommitted?: boolean;
}

interface Rpc {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

const WALLET_SHORT = new Set(['INSUFFICIENT_CREDITS', 'BELOW_MIN_VIABLE_BUDGET']);

/**
 * Reserve a use. `legacy` runs the product's existing wallet begin, and is called ONLY when the
 * server says the account should fall back to its legacy balance.
 */
export async function beginEntitled(
  sb: Rpc,
  opts: { userId: string; feature: SaasFeature; key: string; jobRef?: string | null; legacy?: () => Promise<ExecutionGrant> },
): Promise<EntitledGrant> {
  const base: EntitledGrant = { ok: false, funding: null, feature: opts.feature, userId: opts.userId, key: opts.key, legacy: null };
  const { data, error } = await sb.rpc('saas_usage_begin', {
    p_user_id: opts.userId, p_feature: opts.feature, p_key: opts.key, p_job_ref: opts.jobRef ?? null,
    p_allow_legacy: typeof opts.legacy === 'function',
  });
  if (error || !data || typeof data !== 'object') return { ...base, reason: 'ERROR' };
  const r = data as Record<string, unknown>;
  if (r.ok === true && (r.funding === 'TRIAL' || r.funding === 'PLAN')) {
    return { ...base, ok: true, funding: r.funding, alreadyCommitted: r.state === 'COMMITTED' };
  }
  if (r.ok === true && r.funding === 'LEGACY_CREDITS' && opts.legacy) {
    const g = await opts.legacy();
    if (g.ok) return { ...base, ok: true, funding: 'LEGACY_CREDITS', legacy: g };
    // Too few legacy credits for this one run: the answer is the subscription prompt, not a top-up.
    const fallback = typeof r.fallbackReason === 'string' ? r.fallbackReason : 'SUBSCRIPTION_REQUIRED';
    return { ...base, reason: WALLET_SHORT.has(String(g.reason)) ? fallback : (g.reason ?? fallback) };
  }
  return {
    ...base,
    reason: typeof r.reason === 'string' ? r.reason : 'SUBSCRIPTION_REQUIRED',
    trialBlocked: typeof r.trialBlocked === 'string' ? r.trialBlocked : null,
  };
}

/** The customer received the result: the trial is consumed / the allowance counted. */
export async function commitEntitled(sb: Rpc, g: EntitledGrant): Promise<boolean> {
  if (!g.ok || g.funding === 'LEGACY_CREDITS' || g.funding === null) return false;
  const { data, error } = await sb.rpc('saas_usage_commit', { p_user_id: g.userId, p_feature: g.feature, p_key: g.key });
  if (error) {
    console.error('[entitlements] commit failed; the sweeper will NOT count it', g.feature, (error as { message?: string })?.message);
    return false;
  }
  return (data as { ok?: boolean } | null)?.ok === true;
}

/** Nothing was delivered: the trial / allowance use goes back. */
export async function releaseEntitled(sb: Rpc, g: EntitledGrant, reason: string): Promise<void> {
  if (!g.ok || g.funding === 'LEGACY_CREDITS' || g.funding === null) return;
  const { error } = await sb.rpc('saas_usage_release', { p_user_id: g.userId, p_feature: g.feature, p_key: g.key, p_reason: reason });
  if (error) console.error('[entitlements] release failed; the sweeper will return it', g.feature, (error as { message?: string })?.message);
}

/** HTTP status for a refusal: 402 for "subscribe / upgrade", 503 when the gate itself failed. */
export function refusalStatus(reason: string | undefined): number {
  return reason === 'ERROR' ? 503 : 402;
}
