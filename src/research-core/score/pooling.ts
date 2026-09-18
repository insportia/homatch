// HOMATCH RESEARCH CORE — when several numbers may become one number.
//
// Every market statistic Homatch will ever show — a median asking price, a
// range, a position against peers — is a pool of observations collapsed into
// one figure. The collapse is where provenance is normally lost, so this is
// the only place it is allowed to happen, and it refuses rather than blends:
//
//   - different PRICE BASIS: refused. An asking price and a transaction price
//     do not average into anything that exists.
//   - different CURRENCY: refused. There is no FX rate in this core, and
//     applying one silently would turn a market figure into a currency bet.
//     (src/verify/intelligence/fx.ts already handles FX where Homatch needs
//     it, with the reasoning attached; this layer does not duplicate it.)
//   - different EVIDENCE LEVEL: allowed, but the pool reports the FURTHEST
//     level it contains, so the caller cannot describe a district pool as
//     same-building evidence.
//
// The statistics themselves are deliberately plain: count, median, mean, min,
// max and quartiles. Anything cleverer is a modelling decision, and modelling
// decisions belong to the product that shows them, not to the layer that
// gathered the inputs.

import { median, percentile, round } from '../normalize/numbers.ts';
import {
  evidenceLevelDistance,
  type EvidenceLevel,
  type Money,
  type Observation,
  type PriceBasis,
} from '../core/types.ts';
import type { SupportCount } from './independence.ts';

export interface PoolInput {
  observation: Observation;
  value: Money;
  /** Optional per-unit figure, where an area was known. */
  perSqm?: number | null;
}

export type PoolRefusal =
  | 'MIXED_PRICE_BASIS'
  | 'MIXED_CURRENCY'
  | 'UNKNOWN_BASIS'
  | 'EMPTY';

export interface Pool {
  basis: PriceBasis;
  currency: string;
  /** The furthest-from-subject level represented. Describes the WHOLE pool. */
  evidenceLevel: EvidenceLevel;
  count: number;
  median: number;
  mean: number;
  min: number;
  max: number;
  p25: number;
  p75: number;
  /** Same statistics over the per-sqm figures, where enough were known. */
  perSqmMedian: number | null;
  perSqmCount: number;
  observationIds: string[];
  support: SupportCount;
}

export type PoolResult =
  | { ok: true; pool: Pool }
  | { ok: false; refusal: PoolRefusal; detail: string };

export function pool(
  inputs: readonly PoolInput[],
  supportOf: (observations: readonly Observation[]) => SupportCount,
): PoolResult {
  if (inputs.length === 0) return { ok: false, refusal: 'EMPTY', detail: 'no inputs' };

  const bases = new Set(inputs.map((input) => input.value.basis));
  if (bases.size > 1) {
    return {
      ok: false,
      refusal: 'MIXED_PRICE_BASIS',
      detail: [...bases].sort().join(','),
    };
  }

  const basis = [...bases][0] as PriceBasis;
  if (basis === 'UNKNOWN') {
    // A pool of figures nobody labelled is a pool of nothing in particular.
    return { ok: false, refusal: 'UNKNOWN_BASIS', detail: 'basis is UNKNOWN' };
  }

  const currencies = new Set(inputs.map((input) => input.value.currency));
  if (currencies.size > 1) {
    return {
      ok: false,
      refusal: 'MIXED_CURRENCY',
      detail: [...currencies].sort().join(','),
    };
  }

  const amounts = inputs.map((input) => input.value.amount).sort((a, b) => a - b);
  const perSqm = inputs
    .map((input) => input.perSqm)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  const observations = inputs.map((input) => input.observation);
  const furthest = observations.reduce<EvidenceLevel>(
    (worst, observation) =>
      evidenceLevelDistance(observation.evidenceLevel) > evidenceLevelDistance(worst)
        ? observation.evidenceLevel
        : worst,
    observations[0]?.evidenceLevel ?? 'SAME_PROPERTY',
  );

  const sum = amounts.reduce((acc, value) => acc + value, 0);

  return {
    ok: true,
    pool: {
      basis,
      currency: [...currencies][0] as string,
      evidenceLevel: furthest,
      count: amounts.length,
      median: round(median(amounts) ?? 0, 2),
      mean: round(sum / amounts.length, 2),
      min: round(amounts[0] as number, 2),
      max: round(amounts[amounts.length - 1] as number, 2),
      p25: round(percentile(amounts, 25) ?? (amounts[0] as number), 2),
      p75: round(percentile(amounts, 75) ?? (amounts[amounts.length - 1] as number), 2),
      perSqmMedian: perSqm.length > 0 ? round(median(perSqm) ?? 0, 2) : null,
      perSqmCount: perSqm.length,
      observationIds: observations.map((observation) => observation.id),
      support: supportOf(observations),
    },
  };
}

/**
 * Split a mixed set into one pool per (basis, currency) and pool each
 * separately.
 *
 * This is the supported way to handle a set containing more than one basis:
 * several honest pools, reported side by side, rather than one dishonest one.
 */
export function poolByBasis(
  inputs: readonly PoolInput[],
  supportOf: (observations: readonly Observation[]) => SupportCount,
): Pool[] {
  const groups = new Map<string, PoolInput[]>();
  for (const input of inputs) {
    const key = `${input.value.basis}\u001f${input.value.currency}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(input);
    else groups.set(key, [input]);
  }

  const pools: Pool[] = [];
  for (const group of groups.values()) {
    const result = pool(group, supportOf);
    if (result.ok) pools.push(result.pool);
  }
  return pools.sort((a, b) => b.count - a.count || a.basis.localeCompare(b.basis));
}
