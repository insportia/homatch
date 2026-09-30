// HOMATCH Design Studio — what one AI call cost, measured and never charged.
//
// Tokens come from the provider's own usage report. The price comes from
// the canonical price book (ds_ai_cost_evidence → price_per_unit_at →
// billing_ai_cost_cents), never from this file or an environment rate. If
// the book has no rate for the model the call is UNPRICED: the cost is
// recorded as unknown (null, cost_known false), never as a zero that reads
// like "free". Design Studio billing is off, so nothing is charged either way.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { recordUnbilledUsage } from '../_shared/billing.ts';

export interface AiCost {
  pricingState: 'ESTIMATED' | 'UNPRICED';
  /** Raw AI COGS in cents; null when unpriced. */
  aiCents: number | null;
}

// deno-lint-ignore no-explicit-any
export function tokensOf(payload: any) {
  const usage = payload?.usage ?? {};
  return {
    inputTokens: Number(usage.input_tokens ?? 0) || 0,
    cachedTokens: Number(usage.input_tokens_details?.cached_tokens ?? 0) || 0,
    outputTokens: Number(usage.output_tokens ?? 0) || 0,
  };
}

export async function priceAiCall(
  admin: SupabaseClient, model: string, t: ReturnType<typeof tokensOf>,
): Promise<AiCost> {
  const { data, error } = await admin.rpc('ds_ai_cost_evidence', {
    p_model: model, p_input_tokens: t.inputTokens, p_cached_tokens: t.cachedTokens, p_output_tokens: t.outputTokens,
  });
  const ev = data as { pricing_state?: string; ai_cost_cents?: number | string | null } | null;
  const cents = ev?.ai_cost_cents == null ? NaN : Number(ev.ai_cost_cents);
  // A failed lookup is as unknown as a missing rate.
  if (error || ev?.pricing_state !== 'ESTIMATED' || !Number.isFinite(cents)) return { pricingState: 'UNPRICED', aiCents: null };
  return { pricingState: 'ESTIMATED', aiCents: cents };
}

/** Measures one successful AI call. Never throws: a missing measurement never fails the work. */
export async function meterAiCall(
  admin: SupabaseClient,
  ctx: { userId: string; productCode: string; jobRef: string | null; model: string; startedAt: number },
  // deno-lint-ignore no-explicit-any
  payload: any,
  metadata: Record<string, unknown>,
): Promise<AiCost> {
  const tokens = tokensOf(payload);
  let cost: AiCost = { pricingState: 'UNPRICED', aiCents: null };
  try {
    cost = await priceAiCall(admin, ctx.model, tokens);
    const { data: ent } = await admin.rpc('billing_entitlements', { p_user_id: ctx.userId });
    const planCode = String((ent as { plan_code?: string } | null)?.plan_code ?? 'FREE').toUpperCase();
    await recordUnbilledUsage(admin, { userId: ctx.userId, productCode: ctx.productCode, planCode, jobRef: ctx.jobRef }, {
      provider: 'openai', providerOperation: 'responses', model: ctx.model, ...tokens,
      durationMs: Date.now() - ctx.startedAt,
      aiCostCents: cost.aiCents ?? undefined,
      pricingState: cost.pricingState,
      metadata: { ...metadata, cost_known: cost.pricingState === 'ESTIMATED', pricing_source: 'provider_price_book' },
    });
  } catch { /* measured best-effort */ }
  return cost;
}
