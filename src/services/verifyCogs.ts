/**
 * READING WHAT A VERIFICATION COST.
 *
 * Every figure here comes from public.verify_billing_events, which is the
 * authoritative metering: what the run consumed, what that cost Homatch in
 * raw provider spend, and which price book version it was costed against.
 * Nothing in this file computes a cost. A second cost engine would only give
 * us a second set of numbers to disagree with the first.
 *
 * COST, NEVER PRICE. No margin, no VAT, no plan, no entitlement. These
 * functions are called from admin screens only, and the three RPCs behind
 * them refuse anybody who is not an administrator.
 */
import { supabase } from '@/db/supabase';

/** Aggregates over a window. */
export interface VerifyCogsSummary {
  jobsCount: number;
  pricedJobs: number;
  /** > 0 means totalCogsUsd is a FLOOR, not a figure. */
  partiallyPricedJobs: number;
  totalCogsUsd: number | null;
  avgCogsUsd: number | null;
  totalModelCostUsd: number | null;
  totalSearchCostUsd: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
  webSearches: number | null;
  avgDurationSeconds: number | null;
  reuseHits: number;
}

/** One completed verification. */
export interface VerifyCogsJob {
  jobId: string;
  userId: string | null;
  userEmail: string | null;
  subject: string | null;
  completedAt: string | null;
  durationSeconds: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
  webSearches: number | null;
  modelCostUsd: number | null;
  searchCostUsd: number | null;
  providerCogsUsd: number | null;
  priceState: string | null;
  provider: string | null;
  reuseGraphHit: boolean;
  reuseFactsReused: number | null;
}

/** What one stage of one verification consumed and cost. */
export interface VerifyCogsStage {
  stage: string;
  model: string | null;
  tokens: number | null;
  webSearches: number | null;
  modelCostUsd: number | null;
  searchCostUsd: number | null;
}

/** One verification, inspected. */
export interface VerifyCogsDetail extends VerifyCogsJob {
  providerCogsCents: number | null;
  cogsCurrency: string | null;
  priceBookEffectiveFrom: string | null;
  reuseFactsRequired: number | null;
  reuseFactsOnSubject: number | null;
  reuseFactsOnLineage: number | null;
  stages: VerifyCogsStage[];
}

/**
 * A number, or null.
 *
 * Postgres returns numeric as a STRING through PostgREST so no precision is
 * lost on the wire. Number(null) is 0 and Number('') is 0, and a cost that
 * arrives as zero because it was absent is the one failure this whole screen
 * exists to prevent — so anything that is not a real number stays null.
 */
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const int = (v: unknown): number => num(v) ?? 0;

export async function getVerifyCogsSummary(
  from?: Date | null,
  to?: Date | null,
): Promise<VerifyCogsSummary> {
  const { data, error } = await supabase.rpc('verify_cogs_summary', {
    p_from: from ? from.toISOString() : null,
    p_to: to ? to.toISOString() : null,
  });
  if (error) throw error;
  const r = (Array.isArray(data) ? data[0] : data) ?? {};
  return {
    jobsCount: int(r.jobs_count),
    pricedJobs: int(r.priced_jobs),
    partiallyPricedJobs: int(r.partially_priced_jobs),
    totalCogsUsd: num(r.total_cogs_usd),
    avgCogsUsd: num(r.avg_cogs_usd),
    totalModelCostUsd: num(r.total_model_cost_usd),
    totalSearchCostUsd: num(r.total_search_cost_usd),
    totalTokens: num(r.total_tokens),
    cachedInputTokens: num(r.cached_input_tokens),
    webSearches: num(r.web_searches),
    avgDurationSeconds: num(r.avg_duration_seconds),
    reuseHits: int(r.reuse_hits),
  };
}

export async function listVerifyCogsJobs(opts: {
  from?: Date | null; to?: Date | null; limit?: number; offset?: number;
} = {}): Promise<VerifyCogsJob[]> {
  const { data, error } = await supabase.rpc('verify_cogs_jobs', {
    p_from: opts.from ? opts.from.toISOString() : null,
    p_to: opts.to ? opts.to.toISOString() : null,
    p_limit: opts.limit ?? 100,
    p_offset: opts.offset ?? 0,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map((r: Record<string, unknown>) => ({
    jobId: String(r.job_id),
    userId: (r.user_id as string) ?? null,
    userEmail: (r.user_email as string) ?? null,
    subject: (r.subject as string) ?? null,
    completedAt: (r.completed_at as string) ?? null,
    durationSeconds: num(r.duration_seconds),
    totalTokens: num(r.total_tokens),
    cachedInputTokens: num(r.cached_input_tokens),
    webSearches: num(r.web_searches),
    modelCostUsd: num(r.model_cost_usd),
    searchCostUsd: num(r.search_cost_usd),
    providerCogsUsd: num(r.provider_cogs_usd),
    priceState: (r.price_state as string) ?? null,
    provider: (r.provider as string) ?? null,
    reuseGraphHit: r.reuse_graph_hit === true,
    reuseFactsReused: num(r.reuse_facts_reused),
  }));
}

export async function getVerifyCogsJob(jobId: string): Promise<VerifyCogsDetail | null> {
  const { data, error } = await supabase.rpc('verify_cogs_job', { p_job_id: jobId });
  if (error) throw error;
  const r = data as Record<string, unknown> | null;
  if (!r || !r.job_id) return null;

  /*
   * stage_breakdown arrives as { STAGE: { model, tokens, web_searches,
   * model_cost_usd, search_cost_usd } }, exactly as verify_billing_events
   * builds it. It is flattened here and nowhere else, so the shape stays a
   * detail of this one function.
   */
  const raw = (r.stage_breakdown ?? {}) as Record<string, Record<string, unknown>>;
  const stages: VerifyCogsStage[] = Object.entries(raw)
    .map(([stage, v]) => ({
      stage,
      model: (v?.model as string) ?? null,
      tokens: num(v?.tokens),
      webSearches: num(v?.web_searches),
      modelCostUsd: num(v?.model_cost_usd),
      searchCostUsd: num(v?.search_cost_usd),
    }))
    .sort((a, b) => a.stage.localeCompare(b.stage));

  return {
    jobId: String(r.job_id),
    userId: (r.user_id as string) ?? null,
    userEmail: (r.user_email as string) ?? null,
    subject: (r.subject as string) ?? null,
    completedAt: (r.completed_at as string) ?? null,
    durationSeconds: num(r.duration_seconds),
    totalTokens: num(r.total_tokens),
    cachedInputTokens: num(r.cached_input_tokens),
    webSearches: num(r.web_searches),
    modelCostUsd: num(r.model_cost_usd),
    searchCostUsd: num(r.search_cost_usd),
    providerCogsUsd: num(r.provider_cogs_usd),
    providerCogsCents: num(r.provider_cogs_cents),
    cogsCurrency: (r.cogs_currency as string) ?? null,
    priceState: (r.price_state as string) ?? null,
    priceBookEffectiveFrom: (r.price_book_effective_from as string) ?? null,
    provider: (r.provider as string) ?? null,
    reuseGraphHit: r.reuse_graph_hit === true,
    reuseFactsReused: num(r.reuse_facts_reused),
    reuseFactsRequired: num(r.reuse_facts_required),
    reuseFactsOnSubject: num(r.reuse_facts_on_subject),
    reuseFactsOnLineage: num(r.reuse_facts_on_lineage),
    stages,
  };
}
