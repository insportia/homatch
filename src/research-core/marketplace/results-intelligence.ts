// HOMATCH MARKETPLACE SEARCH — Results Intelligence, deterministic.
//
// After the pipeline, every property that answers the request gets its reasons
// ordered by what THIS person asked for, and up to two tradeoffs worth saying.
// It used to be an OpenAI call (call 2) over the strongest twelve; the owner's
// rule since 2026-10-29 is zero model calls on the search path, so the same
// judgement is made in code from the same evidence:
//
//   reasons    the property's own reason codes, the ones answering a stated
//              criterion first (district, bedrooms, floor, elevator, building
//              age, renovation, parking), then value, owner, freshness
//   tradeoffs  the property's own tradeoff codes, a price above similar homes
//              first, then gaps on a criterion the person stated, then the rest
//   upgrades   never vetoed: an upgrade stays in its group and the customer
//              judges whether its advantages are worth the money
//
// It cannot add a fact: every code comes from the property's own allowed list.
import type { ReasonCode, ResultProperty } from './pipeline.ts';
import type { MarketplaceSearchRequest } from './worker-contract.ts';

export const RESULTS_INTELLIGENCE_VERSION = 'results-intelligence-1';
export const RESULTS_INTELLIGENCE_LIMIT = 12;

export type TradeoffCode =
  | 'PRICE_ABOVE_SIMILAR' | 'FLOOR_NOT_STATED' | 'AREA_NOT_STATED' | 'DISTRICT_NOT_STATED'
  | 'BUILDING_STATUS_NOT_STATED' | 'NOT_RECENTLY_VERIFIED' | 'SELLER_UNKNOWN' | 'PRICE_DIFFERS_ACROSS_SOURCES';

export interface FactSheet {
  key: string;
  group: ResultProperty['group'];
  facts: Record<string, string | number | boolean | null>;
  allowedReasons: ReasonCode[];
  allowedTradeoffs: TradeoffCode[];
  upgrade: { overMaxPct: number | null; advantages: string[] } | null;
}

export function tradeoffsOf(p: ResultProperty): TradeoffCode[] {
  const t: TradeoffCode[] = [];
  if (p.vsComparable !== null && p.vsComparable >= 0.08) t.push('PRICE_ABOVE_SIMILAR');
  if (p.facts.floor === null) t.push('FLOOR_NOT_STATED');
  if (p.unverified.includes('AREA')) t.push('AREA_NOT_STATED');
  if (p.unverified.includes('DISTRICT')) t.push('DISTRICT_NOT_STATED');
  if (p.unverified.includes('BUILDING_STATUS')) t.push('BUILDING_STATUS_NOT_STATED');
  if (p.freshness.state !== 'VERIFIED') t.push('NOT_RECENTLY_VERIFIED');
  if (p.seller.classification === 'UNKNOWN') t.push('SELLER_UNKNOWN');
  if (p.priceDiscrepancy?.significant) t.push('PRICE_DIFFERS_ACROSS_SOURCES');
  return t;
}

/** The bounded, evidence-only payload. Top BEST/OWNER/UPGRADE properties first. */
export function buildFactSheets(properties: readonly ResultProperty[]): FactSheet[] {
  const priority = { BEST: 0, UPGRADE: 1, OWNER: 2, MORE: 3, OTHER: 4 } as const;
  /* Homes outside the request (OTHER) are browsable, never summarised as answers to it. */
  return properties.filter((p) => p.group !== 'OTHER')
    .sort((a, b) => priority[a.group] - priority[b.group] || a.rank - b.rank)
    .slice(0, RESULTS_INTELLIGENCE_LIMIT)
    .map((p) => ({
      key: p.key,
      group: p.group,
      facts: {
        priceUsd: p.facts.priceUsd, pricePerSqmUsd: p.facts.pricePerSqmUsd, areaSqm: p.facts.areaSqm,
        rooms: p.facts.rooms, bedrooms: p.facts.bedrooms, floor: p.facts.floor, district: p.facts.district,
        buildingStatus: p.facts.buildingStatus, renovationStatus: p.facts.renovationStatus, parking: p.facts.parking,
        seller: p.seller.classification, sourceCount: p.sourceCount, freshness: p.freshness.state,
        vsSimilarPricePerSqmPct: p.vsComparable,
      },
      allowedReasons: p.reasons.map((r) => r.code),
      allowedTradeoffs: tradeoffsOf(p),
      upgrade: p.upgrade ? { overMaxPct: p.upgrade.overMaxPct, advantages: p.upgrade.advantages.map((a) => a.code) } : null,
    }));
}

export interface AcceptedIntelligence {
  key: string;
  reasons: ReasonCode[];
  tradeoffs: TradeoffCode[];
  upgradeWorthIt: boolean | null;
}

/** Keep only what each property's own evidence allows. Unknown keys and codes are dropped
 *  (the validation every reading passes, whoever produced it). */
export function acceptIntelligence(raw: unknown, sheets: readonly FactSheet[]): { accepted: AcceptedIntelligence[]; discarded: number } {
  const byKey = new Map(sheets.map((s) => [s.key, s]));
  const out: AcceptedIntelligence[] = [];
  let discarded = 0;
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { properties?: unknown }).properties)
    ? (raw as { properties: unknown[] }).properties : [];
  const done = new Set<string>();
  for (const item of list) {
    const r = item as Record<string, unknown>;
    const sheet = typeof r?.key === 'string' ? byKey.get(r.key) : undefined;
    if (!sheet || done.has(sheet.key)) { discarded++; continue; }
    done.add(sheet.key);
    const pick = <T extends string>(v: unknown, allowed: readonly T[], cap: number): T[] => {
      const res: T[] = [];
      for (const c of Array.isArray(v) ? v : []) {
        if (typeof c === 'string' && (allowed as readonly string[]).includes(c) && !res.includes(c as T)) res.push(c as T);
        else discarded++;
      }
      return res.slice(0, cap);
    };
    out.push({
      key: sheet.key,
      reasons: pick(r.reasons, sheet.allowedReasons, 3),
      tradeoffs: pick(r.tradeoffs, sheet.allowedTradeoffs, 2),
      /* Only an upgrade can be judged, and the model can only say no to one. */
      upgradeWorthIt: sheet.upgrade && typeof r.upgradeWorthIt === 'boolean' ? r.upgradeWorthIt : null,
    });
  }
  return { accepted: out, discarded };
}

/**
 * Fold accepted intelligence into the result set: reorder reasons, attach
 * tradeoffs, and drop an upgrade the model judged not worth it. Properties the
 * model did not cover keep their deterministic reasons.
 */
export function applyIntelligence(properties: readonly ResultProperty[], accepted: readonly AcceptedIntelligence[]):
  Array<ResultProperty & { tradeoffs: TradeoffCode[] }> {
  const byKey = new Map(accepted.map((a) => [a.key, a]));
  const out: Array<ResultProperty & { tradeoffs: TradeoffCode[] }> = [];
  for (const p of properties) {
    const a = byKey.get(p.key);
    if (!a) { out.push({ ...p, tradeoffs: [] }); continue; }
    if (p.group === 'UPGRADE' && a.upgradeWorthIt === false) continue;
    const chosen = a.reasons.length
      ? [...a.reasons.map((c) => p.reasons.find((r) => r.code === c)!), ...p.reasons.filter((r) => !a.reasons.includes(r.code))]
      : p.reasons;
    out.push({ ...p, reasons: chosen, tradeoffs: a.tradeoffs });
  }
  /* Ranks inside UPGRADE are re-numbered after a veto. */
  let n = 0;
  return out.map((p) => (p.group === 'UPGRADE' ? { ...p, rank: ++n } : p));
}

/** Reason codes in the order they answer what the person stated; value and trust after. */
function reasonPriority(request: MarketplaceSearchRequest): ReasonCode[] {
  const asked: ReasonCode[] = [];
  const wants = (a: string) => request.mustHave?.includes(a) || request.niceToHave?.includes(a);
  if (request.districts?.length) asked.push('DISTRICT_MATCH');
  if (request.bedrooms) asked.push('BEDROOM_MATCH');
  if (request.floorRange || request.floorPreferences?.length) asked.push('FLOOR_MATCH');
  if (wants('ELEVATOR')) asked.push('ELEVATOR_CONFIRMED');
  if (request.preferredBuildingStatuses?.includes('NEW_BUILD') || (request.buildingStatuses?.includes('NEW_BUILD') && request.buildingStatuses.length < 3)) asked.push('NEW_BUILD');
  if (request.preferredRenovations?.includes('RENOVATED') || request.renovationPreferences?.includes('RENOVATED')) asked.push('RENOVATED');
  if (request.parking === true || wants('PARKING')) asked.push('HAS_PARKING');
  const rest: ReasonCode[] = ['GOOD_VALUE_VS_SIMILAR', 'LOWEST_ACROSS_SOURCES', 'OWNER_LIKELY', 'VERIFIED_RECENTLY', 'DISTRICT_MATCH', 'BEDROOM_MATCH',
    'FLOOR_MATCH', 'ELEVATOR_CONFIRMED', 'NEW_BUILD', 'RENOVATED', 'HAS_PARKING'];
  return [...new Set([...asked, ...rest])];
}

/** Tradeoff codes in the order that matters to this person: price first, then gaps on stated criteria. */
function tradeoffPriority(request: MarketplaceSearchRequest): TradeoffCode[] {
  const stated: TradeoffCode[] = [];
  if (request.floorRange || request.floorPreferences?.length) stated.push('FLOOR_NOT_STATED');
  if (request.areaMinSqm != null || request.areaMaxSqm != null) stated.push('AREA_NOT_STATED');
  if (request.districts?.length) stated.push('DISTRICT_NOT_STATED');
  if (request.buildingStatuses?.length && request.buildingStatuses.length < 3) stated.push('BUILDING_STATUS_NOT_STATED');
  return [...new Set<TradeoffCode>(['PRICE_ABOVE_SIMILAR', ...stated, 'PRICE_DIFFERS_ACROSS_SOURCES', 'NOT_RECENTLY_VERIFIED', 'SELLER_UNKNOWN'])];
}

/**
 * The deterministic reading of a result set: one AcceptedIntelligence per property that
 * answers the request (OTHER is browsable, never summarised). Codes come only from each
 * property's own facts; upgrades are never vetoed (upgradeWorthIt stays null).
 */
export function deterministicIntelligence(properties: readonly ResultProperty[], request: MarketplaceSearchRequest): AcceptedIntelligence[] {
  const reasonOrder = reasonPriority(request);
  const tradeoffOrder = tradeoffPriority(request);
  const statedGaps = tradeoffOrder.slice(1, -3);
  const rank = <T extends string>(order: readonly T[], code: T) => { const i = order.indexOf(code); return i < 0 ? order.length : i; };
  return properties.filter((p) => p.group !== 'OTHER').map((p) => {
    const own = p.reasons.map((r) => r.code);
    /* A missing fact is a tradeoff only for a criterion the person stated. */
    const gaps: TradeoffCode[] = ['FLOOR_NOT_STATED', 'AREA_NOT_STATED', 'DISTRICT_NOT_STATED', 'BUILDING_STATUS_NOT_STATED'];
    const tradeoffs = tradeoffsOf(p).filter((t) => !gaps.includes(t) || statedGaps.includes(t));
    return {
      key: p.key,
      reasons: [...own].sort((a, b) => rank(reasonOrder, a) - rank(reasonOrder, b)).slice(0, 3),
      tradeoffs: tradeoffs.sort((a, b) => rank(tradeoffOrder, a) - rank(tradeoffOrder, b)).slice(0, 2),
      upgradeWorthIt: null,
    };
  });
}
