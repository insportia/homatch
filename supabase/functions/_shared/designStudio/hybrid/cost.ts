// WHAT A JOB COSTS — measured where it can be, labelled where it cannot.
//
// Every line says how it was known: MEASURED (a provider reported it: tokens
// billed, GPU seconds executed), ESTIMATED (computed from a rate card), or
// NOT_AVAILABLE. Totals keep the three apart; nothing is silently zero. A
// ceiling stops runaway work BEFORE it is spent.

import type { Stage } from './contract.ts';

export type Basis = 'MEASURED' | 'ESTIMATED' | 'NOT_AVAILABLE';
export interface CostLine { stage: Stage; kind: 'LLM' | 'VISION' | 'GPU' | 'STORAGE' | 'OTHER'; usd: number | null; basis: Basis; detail: string }

/** A GPU job's cost from the seconds the provider says it ran, at the endpoint's per-second price. */
export function gpuCost(executionMs: number | null, usdPerSecond: number | null, detail: string): CostLine {
  if (executionMs === null) return { stage: 'BUILDING_OBJECTS', kind: 'GPU', usd: null, basis: 'NOT_AVAILABLE', detail };
  if (usdPerSecond === null) return { stage: 'BUILDING_OBJECTS', kind: 'GPU', usd: null, basis: 'NOT_AVAILABLE', detail: `${detail}; ${Math.round(executionMs / 100) / 10} s, no price configured` };
  // Seconds are measured; the price is the endpoint's configured rate: the product is an estimate of the bill.
  return { stage: 'BUILDING_OBJECTS', kind: 'GPU', usd: Math.round((executionMs / 1000) * usdPerSecond * 1e5) / 1e5, basis: 'ESTIMATED', detail: `${detail}; ${Math.round(executionMs / 100) / 10} s × $${usdPerSecond}/s` };
}

export function totals(lines: CostLine[]) {
  const sum = (b: Basis) => Math.round(lines.filter((l) => l.basis === b && l.usd !== null).reduce((s, l) => s + (l.usd as number), 0) * 1e5) / 1e5;
  return { measured: sum('MEASURED'), estimated: sum('ESTIMATED'), unavailable: lines.filter((l) => l.basis === 'NOT_AVAILABLE').length };
}

/** May this be spent? Counts everything known so far (measured and estimated) plus what the next step will cost. */
export function withinCeiling(lines: CostLine[], nextUsd: number, ceilingUsd: number): boolean {
  const t = totals(lines);
  return t.measured + t.estimated + Math.max(0, nextUsd) <= ceilingUsd;
}

/** A per-job ceiling for a quality target (USD): a guard against runaway work, not a price. */
export const JOB_CEILING_USD: Record<'DRAFT' | 'STANDARD' | 'HIGH', number> = { DRAFT: 0.6, STANDARD: 1.2, HIGH: 2.0 };
