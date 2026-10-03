// HOMATCH MARKETPLACE SEARCH — OpenAI Results Intelligence (call 2).
//
// After the deterministic pipeline, the strongest canonical properties (never
// the raw listings, never more than RESULTS_INTELLIGENCE_LIMIT) go to OpenAI
// with their FACTS and the codes those facts support. The model's job is
// judgement over supplied evidence: which reasons matter most to THIS person,
// which tradeoffs are worth saying, and whether an upgrade's extra money buys
// something meaningful.
//
// It cannot add a fact. Its output is codes chosen from each property's own
// allowed list; anything else is discarded by `acceptIntelligence()`. It can
// only VETO an upgrade, never create one. When the model is unavailable the
// deterministic reasons stand on their own and nothing is lost.

import type { ResultProperty, ReasonCode } from './pipeline.ts';
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
  const priority = { BEST: 0, UPGRADE: 1, OWNER: 2, MORE: 3 } as const;
  return [...properties]
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

export const RESULTS_INTELLIGENCE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['properties'],
  properties: {
    properties: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'reasons', 'tradeoffs', 'upgradeWorthIt'],
        properties: {
          key: { type: 'string' },
          reasons: { type: 'array', items: { type: 'string' } },
          tradeoffs: { type: 'array', items: { type: 'string' } },
          upgradeWorthIt: { type: ['boolean', 'null'] },
        },
      },
    },
  },
} as const;

export const RESULTS_INTELLIGENCE_INSTRUCTIONS = [
  'You help one person compare real-estate options. You receive the person\'s confirmed criteria and, per property, facts plus the ONLY reason and tradeoff codes those facts support.',
  'For each property return up to 3 reasons and up to 2 tradeoffs, chosen ONLY from that property\'s allowedReasons / allowedTradeoffs, ordered by what matters most to this person.',
  'For a property with an upgrade block, set upgradeWorthIt=false if the advantages do not justify the extra price for this person, true otherwise; null for properties without an upgrade block.',
  'Never invent a code, a fact or a property key.',
].join('\n');

export function buildIntelligenceInput(request: MarketplaceSearchRequest, sheets: readonly FactSheet[]) {
  return {
    criteria: {
      transactionType: request.transactionType, propertyType: request.propertyType, city: request.city,
      districts: request.districts, priceMinUsd: request.priceMinUsd, priceMaxUsd: request.priceMaxUsd,
      areaMinSqm: request.areaMinSqm, areaMaxSqm: request.areaMaxSqm, rooms: request.rooms, bedrooms: request.bedrooms,
      buildingStatuses: request.buildingStatuses, mustHave: request.mustHave, niceToHave: request.niceToHave,
    },
    properties: sheets,
  };
}

export interface AcceptedIntelligence {
  key: string;
  reasons: ReasonCode[];
  tradeoffs: TradeoffCode[];
  upgradeWorthIt: boolean | null;
}

/** Keep only what each property's own evidence allows. Unknown keys and codes are dropped. */
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
