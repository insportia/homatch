// HOMATCH Design Studio — THE 3D WALKTHROUGH'S MONEY (DS_WALKTHROUGH).
//
// The same server-authoritative path as every Design Studio operation
// (renderPricing.ts): the customer confirms a signed quote's MAXIMUM, the
// maximum is reserved before any provider work, and when the walkthrough is
// READY its MEASURED cost is priced again by billing_price_quote and settled
// (clamped to the reservation); a FAILED walkthrough releases everything.
//
// What it cost, and where that is recorded (never twice):
//   AI  the scene plan, a reference re-plan, the reference QA — each call is
//       recorded in usage_events as it happens (meterAiCall, job_ref = the
//       walkthrough). The settlement PRICES them (alreadyLedgeredLandedCents)
//       without writing them again.
//   GPU the RunPod factory passes (every pass that ran, a retried one too) —
//       written once, here, as the settlement's (or release's) own usage
//       event; while Design Studio charging is off, as an unbilled event.
// A plan reused from an earlier walkthrough cost nothing new and is not
// charged again; a resumed walkthrough keeps its reservation.

import { beginExecution, recordUnbilledUsage, releaseExecution, settleExecution, type ExecutionGrant } from '../_shared/billing.ts';
import { quoteMatches, quoteSecret, verifyQuote } from '../_shared/designStudio/renderPricing.ts';

// deno-lint-ignore no-explicit-any
type Row = any;

export const WALK_PRODUCT = 'DS_WALKTHROUGH';

const env = (k: string) => Deno.env.get(k) ?? undefined;

/**
 * Reserve a walkthrough's confirmed maximum. `key` is stable for the logical run (the walkthrough's identity, plus
 * the retry it is for), so asking twice holds the customer's credits once.
 */
export async function reserveWalkthrough(admin: Row, a: { actorId: string; projectId: string; versionId: string; quoteToken: unknown; key: string; charged: boolean }):
  Promise<{ billing: Row } | { error: string; status: number }> {
  if (!a.charged) return { billing: { state: 'NOT_CHARGED', productCode: WALK_PRODUCT } };
  const secret = await quoteSecret(env);
  if (!secret) return { error: 'QUOTE_NOT_CONFIGURED', status: 503 };
  const q = await verifyQuote(a.quoteToken, secret);
  if (!q.ok) return { error: q.reason === 'QUOTE_MALFORMED' && a.quoteToken == null ? 'BILLING_CONFIRMATION_REQUIRED' : q.reason, status: q.reason === 'QUOTE_EXPIRED' ? 410 : 409 };
  if (!quoteMatches(q.claims, { userId: a.actorId, projectId: a.projectId, versionId: a.versionId, product: WALK_PRODUCT, views: 1 })) return { error: 'QUOTE_MISMATCH', status: 409 };
  // Charging switched off or on since the quote: the customer confirmed something else.
  if (q.claims.charged !== true) return { error: 'QUOTE_STALE', status: 409 };
  const grant = await beginExecution(admin, {
    userId: a.actorId, productCode: WALK_PRODUCT, idempotencyKey: `ds-walk:${a.key}`, jobRef: a.key,
    authorizedMaxCredits: q.claims.credits, budgetIsCeiling: true, requireFullBudget: true, allowIncluded: false,
    metadata: { ds_project_id: a.projectId, quoted_credits: q.claims.credits, quoted_estimate: q.claims.est, quoted_minimum: q.claims.min },
  });
  if (!grant.ok || !grant.reservationId) {
    return { error: grant.reason ?? 'ERROR', status: grant.reason === 'INSUFFICIENT_CREDITS' || grant.reason === 'BELOW_MIN_VIABLE_BUDGET' ? 402 : 409 };
  }
  return {
    billing: {
      state: 'RESERVED', reservationId: grant.reservationId, credits: q.claims.credits, min: q.claims.min, est: q.claims.est,
      productCode: WALK_PRODUCT, planCode: grant.planCode, pricingVersion: grant.pricingVersion,
    },
  };
}

function grantOf(row: Row): ExecutionGrant {
  const b = row.billing ?? {}; const credits = Number(b.credits) || 0;
  return {
    ok: true, funding: 'PAYG', productCode: WALK_PRODUCT, userId: String(row.user_id), planCode: (b.planCode ?? 'FREE'),
    qualityTier: 'STANDARD', reservationId: b.reservationId ?? null, allowanceId: null, reservedCredits: credits,
    authorizedMaxCredits: credits, estimateMinCredits: Number(b.min) || credits, estimateMaxCredits: credits, resultCeiling: null,
    providerBudgetCeilingCents: null, priorityLevel: 0, pricingVersion: Number(b.pricingVersion) || 1, partialBudget: false, minViableBudgetCredits: 0,
  };
}

/** The GPU the walkthrough's factory passes used, from its own cost lines (every pass, a retried one too). */
export function gpuOf(cost: unknown): { usd: number | null; known: boolean; passes: number } {
  const lines = (Array.isArray(cost) ? cost : []).filter((c: Row) => c?.kind === 'RUNPOD_GPU');
  const known = lines.every((c: Row) => typeof c.usd === 'number' && Number.isFinite(c.usd));
  const usd = lines.reduce((s: number, c: Row) => s + (typeof c.usd === 'number' ? c.usd : 0), 0);
  return { usd: known ? Math.round(usd * 1e6) / 1e6 : null, known, passes: lines.length };
}

/** The walkthrough's AI calls already recorded in usage_events (its plan, re-plan, QA), in landed cents. */
async function ledgeredAi(admin: Row, row: Row): Promise<number> {
  const { data } = await admin.from('usage_events').select('landed_cogs_cents').eq('user_id', row.user_id).eq('job_ref', String(row.id))
    .in('product_code', [WALK_PRODUCT, 'DS_AI_DESIGN']);
  return (data ?? []).reduce((s: number, r: Row) => s + (Number(r.landed_cogs_cents) || 0), 0);
}

/**
 * Close the walkthrough's money once it is terminal: SETTLE (READY) the measured AI + GPU cost, or RELEASE (FAILED)
 * the reservation; while charging is off, record the GPU cost once as unbilled. Idempotent: wallet_settle and
 * wallet_release do nothing to a closed reservation, and the unbilled record is claimed before it is written.
 * Never throws.
 */
export async function closeWalkthroughBilling(admin: Row, id: string, outcome: 'SETTLE' | 'RELEASE'): Promise<void> {
  try {
    const { data: row } = await admin.from('ds_walkthroughs').select('id, user_id, project_id, state, error, billing, cost').eq('id', id).maybeSingle();
    if (!row) return;
    const b = row.billing ?? {};
    const gpu = gpuOf(row.cost);
    // Only the GPU not yet in the ledger: a retried walkthrough keeps the passes an earlier attempt already recorded.
    const prior = Number(b.ledgeredGpuUsd) || 0;
    const fresh = gpu.usd == null ? null : Math.max(0, Math.round((gpu.usd - prior) * 1e6) / 1e6);
    const usage = {
      provider: 'runpod', providerOperation: 'walkthrough_build', durationMs: undefined,
      rawProviderCostCents: fresh == null ? undefined : Math.round(fresh * 100 * 10000) / 10000,
      pricingState: (gpu.known ? 'ESTIMATED' : 'UNPRICED') as 'ESTIMATED' | 'UNPRICED',
      metadata: { ds_walkthrough_id: row.id, ds_project_id: row.project_id, gpu_usd: fresh, gpu_usd_all_passes: gpu.usd, gpu_passes: gpu.passes, cost_known: gpu.known },
    };
    const ledgeredGpuUsd = gpu.usd ?? prior;
    if (b.state === 'RESERVED' && b.reservationId) {
      const grant = grantOf(row);
      let next: Row;
      if (outcome === 'SETTLE') {
        const s = await settleExecution(admin, grant, { ...usage, alreadyLedgeredLandedCents: await ledgeredAi(admin, row) }, 'SUCCESS');
        next = { ...b, state: 'SETTLED', chargedCredits: s.chargedCredits, releasedCredits: s.releasedCredits, clamped: s.clamped, ledgeredGpuUsd };
      } else {
        await releaseExecution(admin, grant, row.error ?? 'WALKTHROUGH_FAILED', usage);
        next = { ...b, state: 'RELEASED', ledgeredGpuUsd };
      }
      await admin.from('ds_walkthroughs').update({ billing: next }).eq('id', row.id).eq('billing->>reservationId', b.reservationId);
      return;
    }
    if (b.state === 'SETTLED' || b.state === 'RELEASED' || b.closed) return;
    // Not charged: the GPU is still a real cost. The close is claimed first, so two closers never record it twice;
    // a retry starts a new attempt (no `closed`) that carries ledgeredGpuUsd, so only its new passes are recorded.
    const { data: won } = await admin.from('ds_walkthroughs').update({ billing: { ...b, state: b.state ?? 'NOT_CHARGED', productCode: WALK_PRODUCT, closed: true, ledgeredGpuUsd } })
      .eq('id', row.id).is('billing->>closed', null).select('id');
    if (!won?.length || !gpu.passes || fresh === 0) return;
    const { data: ent } = await admin.rpc('billing_entitlements', { p_user_id: row.user_id });
    const planCode = String((ent as { plan_code?: string } | null)?.plan_code ?? 'FREE').toUpperCase();
    await recordUnbilledUsage(admin, { userId: row.user_id, productCode: WALK_PRODUCT, planCode, jobRef: String(row.id) }, usage);
  } catch {
    // A missing measurement never fails the walkthrough; the reservation's TTL is the backstop.
  }
}
