// BUDGET-AWARE DISCOVERY — explore every arm (source × language) with a small
// probe, then move the remaining provider budget toward the arms producing
// property-relevant, high-intent, unique leads at the lowest cost.
//
// Optimisation target: cost per qualified unique lead, never cost per row.
// Progressive sampling: probe → +step → +step, each step only when the arm's
// measured yield justifies it, always inside the campaign's provider budget.

export interface SamplingConfig {
  /** First tranche size per arm. */
  probe: number;
  /** Cumulative totals after each deepening, e.g. [50, 100]. */
  steps: number[];
  /** Qualified leads per provider dollar an arm must reach to keep deepening. */
  minQualifiedPerDollar: number;
  /** How many probes an arm gets before it must show any useful result. */
  maxProbesPerArm: number;
}

export const DEFAULT_SAMPLING: SamplingConfig = { probe: 20, steps: [50, 100], minQualifiedPerDollar: 2, maxProbesPerArm: 2 };

export function parseSampling(raw: unknown): SamplingConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const steps = Array.isArray(r.steps) ? r.steps.map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b) : DEFAULT_SAMPLING.steps;
  const probe = Number(r.probe);
  return {
    probe: Number.isFinite(probe) && probe > 0 ? Math.min(200, probe) : DEFAULT_SAMPLING.probe,
    steps: steps.length ? steps.slice(0, 5) : DEFAULT_SAMPLING.steps,
    minQualifiedPerDollar: Number.isFinite(Number(r.minQualifiedPerDollar)) ? Number(r.minQualifiedPerDollar) : DEFAULT_SAMPLING.minQualifiedPerDollar,
    maxProbesPerArm: Number.isFinite(Number(r.maxProbesPerArm)) ? Math.max(1, Number(r.maxProbesPerArm)) : DEFAULT_SAMPLING.maxProbesPerArm,
  };
}

export interface ArmStats {
  arm: string;
  /** Results bought so far on this arm (cumulative requested sizes that ran). */
  itemsBought: number;
  spendMicros: number;
  /** Items that passed the property/demand relevance gate. */
  useful: number;
  qualified: number;
  strong: number;
  duplicates: number;
  failures: number;
  runs: number;
  avgSimilarity: number | null;
  avgIntent: number | null;
}

export type ArmDecision =
  | { action: 'DEEPEN'; nextSize: number; reason: string }
  | { action: 'STOP'; reason: string };

const dollars = (micros: number) => micros / 1_000_000;

/** Qualified-equivalent yield: a strong lead counts double. */
export function armYield(a: ArmStats): number {
  const spend = dollars(a.spendMicros);
  const q = a.qualified + a.strong;
  if (spend <= 0) return q > 0 ? Number.POSITIVE_INFINITY : 0;
  return q / spend;
}

/** Cost per qualified lead in micros (null when none yet). */
export function costPerQualified(a: ArmStats): number | null {
  return a.qualified > 0 ? Math.round(a.spendMicros / a.qualified) : null;
}

/**
 * After an arm's run finished: deepen (and by how much) or stop.
 * `remainingMicros` is the campaign's unspent provider budget;
 * `pricePer1kMicros` prices the next tranche.
 */
export function decideArm(a: ArmStats, cfg: SamplingConfig, remainingMicros: number, pricePer1kMicros: number): ArmDecision {
  if (a.failures >= 2) return { action: 'STOP', reason: 'repeated_failures' };
  const totals = [cfg.probe, ...cfg.steps];
  const nextTotal = totals.find((t) => t > a.itemsBought);
  if (nextTotal == null) return { action: 'STOP', reason: 'sampling_complete' };
  const nextSize = nextTotal - a.itemsBought;
  const nextCost = Math.ceil(nextSize * pricePer1kMicros / 1000);
  if (nextCost > remainingMicros) return { action: 'STOP', reason: 'budget_exhausted' };
  if (a.itemsBought === 0) return { action: 'DEEPEN', nextSize, reason: 'probe' };

  const usefulRate = a.itemsBought > 0 ? a.useful / a.itemsBought : 0;
  const dupRate = a.itemsBought > 0 ? a.duplicates / a.itemsBought : 0;
  if (dupRate > 0.6) return { action: 'STOP', reason: 'mostly_duplicates' };
  const afterProbe = a.itemsBought <= cfg.probe;
  if (afterProbe) {
    if (a.qualified > 0 || usefulRate >= 0.15) return { action: 'DEEPEN', nextSize, reason: 'probe_productive' };
    if (a.runs < cfg.maxProbesPerArm && usefulRate > 0) return { action: 'DEEPEN', nextSize: Math.min(nextSize, cfg.probe), reason: 'second_probe' };
    return { action: 'STOP', reason: 'probe_unproductive' };
  }
  if (a.strong > 0 || armYield(a) >= cfg.minQualifiedPerDollar) return { action: 'DEEPEN', nextSize, reason: 'yield_justifies' };
  return { action: 'STOP', reason: 'yield_below_threshold' };
}

/**
 * Queue priority for an arm's next job (0-100). Unexplored arms get a
 * neutral prior so every arm is probed once; measured arms rise or fall
 * with yield; historical source intelligence nudges the prior.
 */
export function armPriority(a: ArmStats | null, historicalYield: number | null = null, basePriority = 50): number {
  if (!a || a.runs === 0) {
    const prior = historicalYield != null ? Math.min(20, historicalYield * 4) : 0;
    return Math.round(Math.min(95, basePriority + prior));
  }
  const y = armYield(a);
  const fromYield = Number.isFinite(y) ? Math.min(40, y * 8) : 40;
  return Math.round(Math.max(5, Math.min(99, basePriority - 15 + fromYield - 10 * a.failures)));
}
