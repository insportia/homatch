// HOMATCH HOME FINANCING — "ჩემი იპოთეკები": saved scenarios, as a person sees them.
//
// Storage is the existing mortgage_scenarios table and it stays immutable:
// a row is never updated. "Save changes" inserts version N+1 pointing at
// version N (supersedes_scenario_id); "duplicate" inserts a new chain;
// "delete" removes a whole chain. This module only turns those rows into
// chains and decides, without touching any number, whether a chain was
// calculated under rules that are no longer in force.

import type { LtvLimitRuleData, MortgageRule, MortgageScenario, PtiLimitRuleData } from './types';
import { classifyCurrency, selectActiveLtvRule, selectActivePtiRule } from './rules/ptiLtv.ts';

/** Bumped when the payment engine's output for the same input would change. */
export const MORTGAGE_ENGINE_VERSION = 'mortgage-engine-1';

export interface ScenarioChain {
  /** The first version's id: stable for the life of the scenario. */
  rootId: string;
  /** Newest first. */
  versions: MortgageScenario[];
  latest: MortgageScenario;
  name: string | null;
  updatedAt: string;
}

/** Group immutable rows into scenarios, newest change first. */
export function toChains(rows: MortgageScenario[]): ScenarioChain[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const rootOf = (row: MortgageScenario): string => {
    let current = row;
    const seen = new Set<string>();
    while (current.supersedesScenarioId && byId.has(current.supersedesScenarioId) && !seen.has(current.id)) {
      seen.add(current.id);
      current = byId.get(current.supersedesScenarioId)!;
    }
    return current.id;
  };
  const groups = new Map<string, MortgageScenario[]>();
  for (const row of rows) {
    const root = rootOf(row);
    groups.set(root, [...(groups.get(root) ?? []), row]);
  }
  const time = (r: MortgageScenario) => Date.parse(r.calculatedAt);
  return [...groups.entries()]
    .map(([rootId, versions]) => {
      const sorted = [...versions].sort((a, b) => b.version - a.version || time(b) - time(a));
      const latest = sorted[0];
      return { rootId, versions: sorted, latest, name: latest.label ?? sorted.find((v) => v.label)?.label ?? null, updatedAt: latest.calculatedAt };
    })
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

/**
 * The rules that apply to this person's numbers: the PTI tier for their income and
 * currency, and the LTV limit for the currency. These, not every rule in force, are what a
 * saved scenario records, so a later change to an unrelated tier never flags it.
 */
export function appliedRuleIds(
  facts: { monthlyNetIncome?: number | null; currency?: string | null },
  ptiRules: MortgageRule<PtiLimitRuleData>[],
  ltvRules: MortgageRule<LtvLimitRuleData>[],
  asOf: Date = new Date(),
): string[] {
  const cls = classifyCurrency(facts.currency ?? undefined);
  const pti = typeof facts.monthlyNetIncome === 'number' && facts.monthlyNetIncome > 0
    ? selectActivePtiRule(ptiRules, facts.monthlyNetIncome, cls, asOf) : null;
  const ltv = selectActiveLtvRule(ltvRules, cls, undefined, asOf);
  return [pti?.id, ltv?.id].filter((id): id is string => typeof id === 'string');
}

export type Freshness = 'CURRENT' | 'STALE' | 'UNKNOWN';

/**
 * Whether a saved scenario still reflects today's rules and engine.
 * STALE: it came from another payment engine, or a rule that applies to its numbers today
 * is not one it was checked against. UNKNOWN: today's rules have not loaded, none apply, or
 * it was saved before any rule had loaded. Unknown is never shown as stale.
 */
export function scenarioFreshness(scenario: MortgageScenario, todayIds: string[] | null): Freshness {
  if (scenario.engineVersion && scenario.engineVersion !== MORTGAGE_ENGINE_VERSION) return 'STALE';
  if (!todayIds || todayIds.length === 0 || scenario.ruleVersionIds.length === 0) return 'UNKNOWN';
  const saved = new Set(scenario.ruleVersionIds);
  return todayIds.every((id) => saved.has(id)) ? 'CURRENT' : 'STALE';
}

/** Every row id in a chain, for deleting the whole scenario. */
export const chainRowIds = (chain: ScenarioChain) => chain.versions.map((v) => v.id);
