// HOMATCH — the dashboard's single read.
//
// Everything the redesigned dashboard shows comes from here, and everything
// here is a real query against a table the signed-in user actually owns
// (owner-scoped under RLS). There is no seeded, illustrative or "looks good
// in a screenshot" data path in this file — when a customer has nothing, the
// numbers are zero and the lists are empty, and the UI renders its empty
// states rather than inventing activity.
//
// It also exists so the dashboard makes ONE coordinated round of requests
// instead of five components each opening their own: the page polls while a
// matching job is live, and five independent pollers on a 3s interval is how
// a dashboard starts costing real money.
import { getActivityEvents, getMatches, getProperties } from '@/services/api';
import { getLatestProgressForProperties, getUserMatchSummary, type LiveMatchingJob } from '@/services/matchingProgress';
import { listDealRooms, type DealRoomRecord } from '@/services/dealRooms';
import type { ActivityEvent, Match, Property } from '@/types/types';

/** A match plus the property it belongs to, so the card can link to both. */
export interface DashboardMatch {
  match: Match;
  property: Property;
}

export interface DashboardSummary {
  properties: Property[];
  /** Keyed by property id — the latest matching job for each. */
  progress: Record<string, LiveMatchingJob>;
  matchTotals: { total: number; newCount: number; bestScore: number; topPropertyId: string | null };
  /** Highest-scoring matches across every property the user owns. */
  topMatches: DashboardMatch[];
  verifications: DealRoomRecord[];
  activity: ActivityEvent[];
  /** Real 7-day deltas, computed from created_at — not a decorative "+3". */
  propertiesThisWeek: number;
  verificationsThisWeek: number;
}

export const EMPTY_DASHBOARD_SUMMARY: DashboardSummary = {
  properties: [],
  progress: {},
  matchTotals: { total: 0, newCount: 0, bestScore: 0, topPropertyId: null },
  topMatches: [],
  verifications: [],
  activity: [],
  propertiesThisWeek: 0,
  verificationsThisWeek: 0,
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function countSince(rows: { created_at: string }[], sinceMs: number): number {
  return rows.filter(r => {
    const t = Date.parse(r.created_at);
    return Number.isFinite(t) && t >= sinceMs;
  }).length;
}

/**
 * Top matches across every property, without issuing one request per property
 * for a user who owns dozens.
 *
 * getMatches() is per-property (that is the only shape the matches route and
 * its RLS policy support), so this asks only the few properties most likely to
 * carry the best matches — the ones the match summary already identified as
 * having volume — and merges their pages. Anything beyond that is a listing
 * page's job, not a dashboard card's.
 */
async function loadTopMatches(properties: Property[], topPropertyId: string | null, limit: number): Promise<DashboardMatch[]> {
  if (!properties.length) return [];

  const byId = new Map(properties.map(p => [p.id, p]));
  // The property the summary flagged first, then the most recently touched —
  // capped so a large portfolio cannot fan out into an unbounded request burst.
  const ordered = [
    ...(topPropertyId && byId.has(topPropertyId) ? [topPropertyId] : []),
    ...properties.map(p => p.id).filter(id => id !== topPropertyId),
  ].slice(0, 4);

  const pages = await Promise.all(ordered.map(id => getMatches(id, undefined, limit).catch(() => [] as Match[])));

  return pages
    .flat()
    .map(match => {
      const property = byId.get(match.property_id);
      return property ? { match, property } : null;
    })
    .filter((m): m is DashboardMatch => m !== null)
    .sort((a, b) => b.match.match_score - a.match.match_score)
    .slice(0, limit);
}

export async function loadDashboardSummary(userId: string): Promise<DashboardSummary> {
  const properties = await getProperties(userId);
  const ids = properties.map(p => p.id);
  const sinceMs = Date.now() - WEEK_MS;

  const [progress, matchTotals, verifications, activity] = await Promise.all([
    getLatestProgressForProperties(ids),
    getUserMatchSummary(ids),
    // A verification case is owner-only under RLS, but a read can still fail
    // (offline, a transient 5xx). One failing card must not blank the whole
    // dashboard, so each optional read degrades to empty on its own.
    listDealRooms().catch(() => [] as DealRoomRecord[]),
    getActivityEvents(userId, 8).catch(() => [] as ActivityEvent[]),
  ]);

  const topMatches = await loadTopMatches(properties, matchTotals.topPropertyId, 5);

  return {
    properties,
    progress,
    matchTotals,
    topMatches,
    verifications,
    activity,
    propertiesThisWeek: countSince(properties, sinceMs),
    verificationsThisWeek: countSince(verifications, sinceMs),
  };
}
