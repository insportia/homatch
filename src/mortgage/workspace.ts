// HOMATCH HOME FINANCING — "ჩემი იპოთეკები": saved scenarios, as a person sees them.
//
// Storage is the existing mortgage_scenarios table and it stays immutable:
// a row is never updated. "Save changes" inserts version N+1 pointing at
// version N (supersedes_scenario_id); "duplicate" inserts a new chain;
// "delete" removes a whole chain. This module only turns those rows into
// chains and decides, without touching any number, whether a chain was
// calculated under rules that are no longer in force.

import type { MortgageScenario } from './types';

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
 * Saved under rules no longer in force: some rule the scenario was checked
 * against is not among today's active rules. An unknown rule set (rules not
 * loaded) is never reported as stale.
 */
export function isStale(scenario: MortgageScenario, activeRuleIds: string[] | null): boolean {
  if (!activeRuleIds || activeRuleIds.length === 0) return false;
  const active = new Set(activeRuleIds);
  return scenario.ruleVersionIds.some((id) => !active.has(id));
}

/** Every row id in a chain, for deleting the whole scenario. */
export const chainRowIds = (chain: ScenarioChain) => chain.versions.map((v) => v.id);
