// ============================================================
// HOMATCH — the billing gateway every paid product goes through.
//
// A product worker (Verify, Find Clients, Contract Intelligence, Broker
// Finder, and whatever is registered next) should never touch credit_accounts,
// credit_lots, usage_reservations or the ledger. It calls three functions:
//
//   beginExecution()   decide how this run is funded, and hold the money
//   settleExecution()  charge what it actually cost, release the rest
//   releaseExecution() it failed; charge nothing
//
// WHY THIS FILE HOLDS NO PRICING ARITHMETIC
//
// Every number here comes from a SQL function. The price, the margin floor,
// the estimate range, the allowance count and the spend order are all decided
// in the database, because that is the only place a direct API call, a second
// edge function and a future worker all pass through. A copy of the formula in
// TypeScript would be a second answer waiting to disagree with the first.
//
// WHAT beginExecution DECIDES
//
// Included allowance first, always. A FREE user's 1st-3rd Verify of the month
// costs them nothing and reserves nothing, and only the 4th reaches the wallet.
// Upgrading never removes an included run; it changes the quality tier the
// included run executes at.
// ============================================================

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type Funding = 'INCLUDED' | 'PAYG' | 'UNAVAILABLE';
export type QualityTier = 'STANDARD' | 'ENHANCED' | 'MAXIMUM';
export type PlanCode = 'FREE' | 'VIP' | 'PREMIUM';

/** Everything a worker needs to execute at the right depth and bill correctly. */
export interface ExecutionGrant {
  ok: boolean;
  funding: Funding;
  /** Carried on the grant so settle/release need no extra arguments. */
  productCode: string;
  userId: string;
  planCode: PlanCode;
  qualityTier: QualityTier;
  /** Present for PAYG runs. Settle or release against this. */
  reservationId: string | null;
  /** Present for INCLUDED runs. Released automatically if the job fails. */
  allowanceId: string | null;
  reservedCredits: number;
  authorizedMaxCredits: number;
  estimateMinCredits: number;
  estimateMaxCredits: number;
  /** Ceiling on qualified results. null = no product-level ceiling. */
  resultCeiling: number | null;
  /** Hard ceiling on provider spend for this run, in cents. */
  providerBudgetCeilingCents: number | null;
  priorityLevel: number;
  pricingVersion: number;
  /**
   * True when the customer could not cover the full estimate and authorised
   * what they had instead. The worker must scope the search to the budget
   * rather than running a full one and being cut off part way.
   */
  partialBudget: boolean;
  /** The minimum budget this product will run at all for. */
  minViableBudgetCredits: number;
  /** Machine-readable reason when ok is false. */
  reason?: 'INSUFFICIENT_CREDITS' | 'BELOW_MIN_VIABLE_BUDGET' | 'PAYG_DISABLED'
         | 'PRODUCT_DISABLED' | 'PRODUCT_PRICING_INACTIVE' | 'NOT_FOUND' | 'ERROR';
  message?: string;
  /** Populated on a BELOW_MIN_VIABLE_BUDGET refusal, so the UI can say how short they are. */
  budget?: {
    availableCredits: number;
    minViableCredits: number;
    estimateMaxCredits: number;
    creditsShortOfViable: number;
  };
}

/** Measured facts about what a run actually consumed. */
export interface ActualUsage {
  provider?: string;
  providerOperation?: string;
  providerRequestId?: string;
  model?: string;
  inputTokens?: number;
  cachedTokens?: number;
  outputTokens?: number;
  searchCount?: number;
  providerUnits?: number;
  enrichmentUnits?: number;
  durationMs?: number;
  /** Raw provider spend in cents, before tax and fees. */
  rawProviderCostCents?: number;
  aiCostCents?: number;
  enrichmentCostCents?: number;
  metadata?: Record<string, unknown>;
  failureReason?: string;
}

export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

function n(v: unknown, d = 0): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

/**
 * Decide funding and hold the money.
 *
 * `idempotencyKey` must be stable for the logical run — derive it from the job
 * id, not from Date.now(). A retried request with the same key returns the
 * reservation that already exists instead of holding the customer's credits a
 * second time.
 */
export async function beginExecution(
  sb: SupabaseClient,
  opts: {
    userId: string;
    productCode: string;
    idempotencyKey: string;
    jobRef?: string;
    /** Scales the estimate for per-unit products. Defaults to one execution. */
    expectedUnits?: number;
    /**
     * What the customer explicitly authorised. Pass this when they accepted a
     * best-effort budget smaller than the estimate ("search with my 10
     * Credits"). Omitted means "the full estimate, or as much of it as the
     * balance covers".
     */
    authorizedMaxCredits?: number;
    /**
     * Refuse rather than silently shrinking. Set when the caller has NOT shown
     * the customer a partial-budget offer and must not spend less than the
     * estimate without asking.
     */
    requireFullBudget?: boolean;
    metadata?: Record<string, unknown>;
  },
): Promise<ExecutionGrant> {
  const base: ExecutionGrant = {
    ok: false, funding: 'UNAVAILABLE',
    productCode: opts.productCode, userId: opts.userId,
    planCode: 'FREE', qualityTier: 'STANDARD',
    reservationId: null, allowanceId: null,
    reservedCredits: 0, authorizedMaxCredits: 0,
    estimateMinCredits: 0, estimateMaxCredits: 0,
    resultCeiling: null, providerBudgetCeilingCents: null,
    priorityLevel: 0, pricingVersion: 1,
    partialBudget: false, minViableBudgetCredits: 0,
  };

  const { data: ent, error: entErr } = await sb.rpc('billing_entitlements', { p_user_id: opts.userId });
  if (entErr || !ent) {
    return { ...base, reason: 'ERROR', message: entErr?.message ?? 'entitlements unavailable' };
  }

  const planCode = (ent.plan_code ?? 'FREE') as PlanCode;
  const product = (ent.products ?? []).find((p: any) => p.product_code === opts.productCode);
  if (!product) return { ...base, planCode, reason: 'NOT_FOUND', message: `${opts.productCode} is not available on ${planCode}` };

  const qualityTier = (product.quality_tier ?? 'STANDARD') as QualityTier;
  const resultCeiling = product.result_ceiling ?? null;
  const priorityLevel = n(product.priority_level);

  // 1. Included allowance. Costs the customer nothing and holds nothing.
  if (n(product.included_remaining) > 0) {
    const { data: allowanceId, error } = await sb.rpc('billing_claim_allowance', {
      p_user_id: opts.userId, p_product_code: opts.productCode, p_job_ref: opts.jobRef ?? null,
    });
    if (!error && allowanceId) {
      const budget = await providerBudgetFor(sb, opts.productCode, planCode);
      return {
        ...base, ok: true, funding: 'INCLUDED', planCode, qualityTier,
        allowanceId: allowanceId as string,
        resultCeiling, providerBudgetCeilingCents: budget, priorityLevel,
        pricingVersion: n(ent.pricing_version, 1),
        // An included run is full depth for the plan by definition.
        partialBudget: false,
      };
    }
    // A null here means someone else took the last slot between the read and
    // the claim. That is the race the advisory lock exists for, and the right
    // answer is to fall through to PAYG, not to fail the request.
  }

  // 2. PAYG.
  if (!product.payg_available) {
    return { ...base, planCode, qualityTier, resultCeiling, reason: 'PAYG_DISABLED',
             message: 'Pay as you go is currently unavailable for this product.' };
  }

  const { data: quote, error: quoteErr } = await sb.rpc('billing_price_quote', {
    p_product_code: opts.productCode, p_plan_code: planCode, p_landed_cogs_cents: null,
  });
  if (quoteErr || !quote?.[0]) {
    return { ...base, planCode, qualityTier, reason: 'PRODUCT_PRICING_INACTIVE', message: quoteErr?.message };
  }

  const unitCredits = n(quote[0].credits);
  const spread = await estimateSpreadFor(sb, opts.productCode);
  const expected = unitCredits * Math.max(opts.expectedUnits ?? 1, 0.0001);
  const estMin = round2(expected * (1 - spread));
  const estMax = round2(expected * (1 + spread));

  // -- How much is actually authorised -------------------------------------
  //
  // A balance short of the estimate is NOT a failure. The customer is offered
  // the search their balance can buy, and the work is scoped to that ceiling
  // rather than a full search being started and cut off part way.
  //
  // Below the product's minimum viable budget it refuses instead, because
  // spending someone's last 2 Credits on a search that cannot produce anything
  // useful is worse than telling them so.
  // `budgetRules`, not `product`. `product` is already bound at the top of
  // this function to the entitlement row, and is still read after this point
  // (payg_available, quality_tier). Binding the name twice in one scope is a
  // SyntaxError in Deno, not a shadow — the module would not load at all.
  const budgetRules = await productBudgetRules(sb, opts.productCode);
  const balance = n(ent?.wallet?.balance);
  const minViable = budgetRules.minViableBudgetCredits;

  const authorized = opts.authorizedMaxCredits != null
    ? round2(Math.min(opts.authorizedMaxCredits, balance, estMax))
    : round2(Math.min(estMax, balance));

  const partial = authorized < estMax;

  if (partial && opts.requireFullBudget) {
    return {
      ...base, planCode, qualityTier, resultCeiling,
      minViableBudgetCredits: minViable,
      reason: 'INSUFFICIENT_CREDITS',
      estimateMinCredits: estMin, estimateMaxCredits: estMax,
      budget: {
        availableCredits: balance, minViableCredits: minViable,
        estimateMaxCredits: estMax, creditsShortOfViable: 0,
      },
    };
  }

  if (authorized < minViable) {
    return {
      ...base, planCode, qualityTier, resultCeiling,
      minViableBudgetCredits: minViable,
      reason: 'BELOW_MIN_VIABLE_BUDGET',
      message: 'This search needs at least ' + minViable + ' Credits to be worth running.',
      estimateMinCredits: estMin, estimateMaxCredits: estMax,
      budget: {
        availableCredits: balance,
        minViableCredits: minViable,
        estimateMaxCredits: estMax,
        creditsShortOfViable: round2(Math.max(minViable - balance, 0)),
      },
    };
  }

  const { data: res, error: resErr } = await sb.rpc('wallet_reserve', {
    p_user_id: opts.userId,
    p_product_code: opts.productCode,
    // The AUTHORISED ceiling, which may be less than the estimate. It is a
    // maximum, not the charge: settlement bills actual usage and releases the
    // rest.
    p_authorized_max_credits: authorized,
    p_idempotency_key: opts.idempotencyKey,
    p_estimate_min_credits: estMin,
    p_estimate_max_credits: estMax,
    p_job_ref: opts.jobRef ?? null,
    p_metadata: { ...(opts.metadata ?? {}), partial_budget: partial },
  });

  if (resErr) {
    const msg = resErr.message ?? '';
    const reason: ExecutionGrant['reason'] =
      msg.includes('INSUFFICIENT_CREDITS') ? 'INSUFFICIENT_CREDITS'
      : msg.includes('PAYG_DISABLED') ? 'PAYG_DISABLED'
      : msg.includes('PRODUCT_DISABLED') || msg.includes('KILL_SWITCH') ? 'PRODUCT_DISABLED'
      : msg.includes('PRICING_INACTIVE') ? 'PRODUCT_PRICING_INACTIVE'
      : msg.includes('BELOW_MIN_VIABLE_BUDGET') ? 'BELOW_MIN_VIABLE_BUDGET'
      : 'ERROR';
    return { ...base, planCode, qualityTier, resultCeiling, reason, message: msg,
             minViableBudgetCredits: minViable,
             estimateMinCredits: estMin, estimateMaxCredits: estMax };
  }

  const row = res?.[0] ?? {};

  // The spend ceiling comes from the RESERVATION, not from the plan's
  // entitlement row: wallet_reserve already took the stricter of what the
  // money buys at this plan's member rate and what the plan allows
  // operationally. Reading the entitlement here would let a partial-budget
  // search spend a full-budget amount.
  const { data: snap } = await sb
    .from('usage_reservations')
    .select('provider_budget_ceiling_cents_snapshot, result_ceiling_snapshot, authorized_max_credits')
    .eq('id', row.reservation_id).maybeSingle();

  return {
    ok: true, funding: 'PAYG',
    productCode: opts.productCode, userId: opts.userId,
    planCode, qualityTier,
    reservationId: row.reservation_id ?? null,
    allowanceId: null,
    reservedCredits: n(row.reserved_credits),
    authorizedMaxCredits: n(snap?.authorized_max_credits, authorized),
    estimateMinCredits: estMin,
    estimateMaxCredits: estMax,
    resultCeiling: snap?.result_ceiling_snapshot ?? resultCeiling,
    providerBudgetCeilingCents: snap?.provider_budget_ceiling_cents_snapshot
      ?? (await providerBudgetFor(sb, opts.productCode, planCode)),
    priorityLevel,
    pricingVersion: n(quote[0].pricing_version, 1),
    partialBudget: partial,
    minViableBudgetCredits: minViable,
  };
}

/**
 * Charge what the run actually cost.
 *
 * The credits charged are recomputed from the MEASURED landed COGS, not from
 * the estimate, so a cheap run is cheap and an expensive one is dearer — and
 * wallet_settle then clamps the result to what the customer authorised, so an
 * unexpectedly expensive provider is Homatch's problem, not theirs.
 *
 * An INCLUDED run still records its usage event: free-allowance COGS is a real
 * cost and the acquisition economics are unreadable without it.
 */
export async function settleExecution(
  sb: SupabaseClient,
  grant: ExecutionGrant,
  usage: ActualUsage,
  outcome: 'SUCCESS' | 'PARTIAL' | 'CANCELLED' | 'TIMEOUT' = 'SUCCESS',
): Promise<{ chargedCredits: number; releasedCredits: number; clamped: boolean }> {
  const { data: landed } = await sb.rpc('billing_landed_cogs_cents', {
    p_raw_provider_cents: usage.rawProviderCostCents ?? 0,
    p_ai_cents: usage.aiCostCents ?? 0,
    p_enrichment_cents: usage.enrichmentCostCents ?? 0,
    p_infra_cents: 0,
  });
  const landedCogsCents = n(landed);
  const rawTotal = (usage.rawProviderCostCents ?? 0) + (usage.aiCostCents ?? 0) + (usage.enrichmentCostCents ?? 0);

  const usagePayload = {
    provider: usage.provider ?? null,
    provider_operation: usage.providerOperation ?? null,
    provider_request_id: usage.providerRequestId ?? null,
    model: usage.model ?? null,
    input_tokens: usage.inputTokens ?? null,
    cached_tokens: usage.cachedTokens ?? null,
    output_tokens: usage.outputTokens ?? null,
    search_count: usage.searchCount ?? null,
    provider_units: usage.providerUnits ?? null,
    enrichment_units: usage.enrichmentUnits ?? null,
    duration_ms: usage.durationMs ?? null,
    raw_provider_cost_cents: usage.rawProviderCostCents ?? 0,
    ai_cost_cents: usage.aiCostCents ?? 0,
    tax_cents: round4(landedCogsCents - rawTotal),
    fee_cents: 0,
    landed_cogs_cents: landedCogsCents,
    failure_reason: usage.failureReason ?? null,
    metadata: usage.metadata ?? {},
  };

  if (grant.funding === 'INCLUDED') {
    await recordAllowanceUsage(sb, grant, usagePayload, outcome);
    return { chargedCredits: 0, releasedCredits: 0, clamped: false };
  }

  if (!grant.reservationId) return { chargedCredits: 0, releasedCredits: 0, clamped: false };

  // Price the ACTUAL work at the plan the job started under, not the plan the
  // customer is on now. Cancelling Premium mid-search must not reprice a
  // running Maximum search.
  const { data: quote } = await sb.rpc('billing_price_quote', {
    p_product_code: grant.productCode,
    p_plan_code: grant.planCode,
    p_landed_cogs_cents: landedCogsCents > 0 ? landedCogsCents : null,
  });
  const actualCredits = n(quote?.[0]?.credits, grant.estimateMaxCredits);

  const { data, error } = await sb.rpc('wallet_settle', {
    p_reservation_id: grant.reservationId,
    p_actual_credits: actualCredits,
    p_usage: usagePayload,
    p_outcome: outcome,
  });
  if (error) throw new Error(`wallet_settle failed: ${error.message}`);
  const row = data?.[0] ?? {};
  return {
    chargedCredits: n(row.settled_credits),
    releasedCredits: n(row.released_credits),
    clamped: !!row.clamped,
  };
}

/**
 * The run failed. Charge nothing, give the hold back, and give an included
 * slot back too — a customer must not lose one of their three monthly
 * Verifications because a provider timed out.
 */
export async function releaseExecution(
  sb: SupabaseClient,
  grant: ExecutionGrant,
  reason: string,
  usage?: ActualUsage,
): Promise<void> {
  const usagePayload = usage
    ? {
        provider: usage.provider ?? null,
        provider_operation: usage.providerOperation ?? null,
        provider_request_id: usage.providerRequestId ?? null,
        raw_provider_cost_cents: usage.rawProviderCostCents ?? 0,
        ai_cost_cents: usage.aiCostCents ?? 0,
        landed_cogs_cents: n(
          (await sb.rpc('billing_landed_cogs_cents', {
            p_raw_provider_cents: usage.rawProviderCostCents ?? 0,
            p_ai_cents: usage.aiCostCents ?? 0,
            p_enrichment_cents: usage.enrichmentCostCents ?? 0,
            p_infra_cents: 0,
          })).data,
        ),
        metadata: usage.metadata ?? {},
      }
    : {};

  if (grant.funding === 'INCLUDED') {
    if (grant.allowanceId) {
      await sb.rpc('billing_release_allowance', { p_allowance_id: grant.allowanceId, p_reason: reason });
    }
    return;
  }
  if (!grant.reservationId) return;
  const { error } = await sb.rpc('wallet_release', {
    p_reservation_id: grant.reservationId, p_reason: reason, p_usage: usagePayload,
  });
  if (error) throw new Error(`wallet_release failed: ${error.message}`);
}

// ── internals ─────────────────────────────────────────────────

async function providerBudgetFor(sb: SupabaseClient, productCode: string, planCode: string): Promise<number | null> {
  const { data } = await sb
    .from('product_plan_entitlements')
    .select('provider_budget_ceiling_cents')
    .eq('product_code', productCode).eq('plan_code', planCode).maybeSingle();
  return data?.provider_budget_ceiling_cents ?? null;
}

async function productBudgetRules(
  sb: SupabaseClient, productCode: string,
): Promise<{ minViableBudgetCredits: number }> {
  const { data } = await sb
    .from('billable_products').select('min_viable_budget_credits').eq('code', productCode).maybeSingle();
  return { minViableBudgetCredits: n(data?.min_viable_budget_credits) };
}

async function estimateSpreadFor(sb: SupabaseClient, productCode: string): Promise<number> {
  const { data } = await sb.from('billable_products').select('config').eq('code', productCode).maybeSingle();
  const bps = n(data?.config?.estimate_spread_bps, 2500);
  return bps / 10000;
}

async function recordAllowanceUsage(
  sb: SupabaseClient, grant: ExecutionGrant, usagePayload: Record<string, unknown>, outcome: string,
) {
  await sb.from('usage_events').insert({
    user_id: grant.userId,
    reservation_id: null,
    product_code: grant.productCode,
    plan_code: grant.planCode,
    quality_tier: grant.qualityTier,
    pricing_version: grant.pricingVersion,
    ...usagePayload,
    charged_credits: 0,
    reserved_credits: 0,
    released_credits: 0,
    allowance_funded: true,
    billable: false,
    outcome,
  });
}

function round2(v: number): number { return Math.round(v * 100) / 100; }
function round4(v: number): number { return Math.round(v * 10000) / 10000; }
