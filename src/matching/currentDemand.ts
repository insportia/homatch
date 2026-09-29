// Is a match still CURRENT demand, or history?
//
// The one client-side reading of the 30-day active-demand rule
// (research-core/discovery/freshness-policy.ts), shared by the Matches list,
// its header counts and the dashboard summary so the three never disagree.
// The server applies the same rule when matches are created (run-matching-v2)
// and when one is opened for Credits (atomic-unlock, DEMAND_NOT_CURRENT).
//
// A row read before migration 20260930130000 has no demand_published_at key
// at all -- "not known yet", not "undated" -- and keeps today's behaviour. An
// opened match is never history: the customer already has the contact.
import { judgeActiveDemand } from '@/research-core/discovery/freshness-policy';

export interface DemandDated {
  status?: string | null;
  demand_published_at?: string | null;
}

export function isHistoryMatch(row: DemandDated, now?: number): boolean {
  if (!('demand_published_at' in row)) return false;
  if (row.status === 'UNLOCKED') return false;
  return !judgeActiveDemand(row.demand_published_at ?? null, now === undefined ? {} : { now }).eligible;
}

/** A column list with the demand date, and the fallback for before the migration. */
export async function selectWithDemandDate<T>(
  run: (columns: string) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  columns: string,
): Promise<T[]> {
  const first = await run(`${columns},demand_published_at`);
  if (!first.error) return (Array.isArray(first.data) ? first.data : []) as T[];
  if (!/demand_published_at/.test(first.error.message)) return [];
  const second = await run(columns);
  return (Array.isArray(second.data) ? second.data : []) as T[];
}
