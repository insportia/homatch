// HOMATCH MARKETPLACE SEARCH — the deterministic pipeline after the workers.
//
//   raw candidates → validation → normalisation → hard filters → property
//   entity resolution → seller evidence → price intelligence → freshness →
//   ranking → budget upgrades → groups → pagination
//
// Pure: the edge function loads rows, calls `processSearch`, stores the output.
// Nothing here calls a model; OpenAI Results Intelligence receives only the
// strongest canonical properties this produces (results-intelligence.ts),
// never the raw listings. Re-running on a larger set (a later worker reported)
// replaces the previous output; earlier results are never thrown away because
// a slow worker has not finished.

import type { CurrencyConverter } from '../normalize/currency.ts';
import type { ExternalListingCandidate, MarketplaceSearchRequest } from './worker-contract.ts';
import { type NormalizedListing, validateListing } from './normalize.ts';
import { type PairDecision, resolveProperties } from './property-entity.ts';
import { type SellerAssessment, classifySeller, isOwnerClass } from './seller.ts';
import { type LocalComparison, type PriceDiscrepancy, localComparison, priceDiscrepancy } from './price-intel.ts';
import {
  type BudgetBand, type HardFilterResult, type PropertyFacts, type RankingComponents,
  districtFit, hardFilter, rankProperty,
} from './ranking.ts';
import { type Gain, selectUpgrades } from './upgrade.ts';
import { listingActivity } from './freshness.ts';
import { resultEvidence, type ResultEvidence } from './result-evidence.ts';
import { descriptionFingerprint } from './description-signals.ts';

export const PIPELINE_VERSION = 'marketplace-pipeline-2';

export type ResultGroup = 'BEST' | 'OWNER' | 'UPGRADE' | 'MORE';
export const RESULT_GROUPS: readonly ResultGroup[] = ['BEST', 'OWNER', 'UPGRADE', 'MORE'];
export const BEST_LIMIT = 6;
export const OWNER_LIMIT = 6;
/** A strong match: fits every hard constraint, in budget, mostly matches, observed recently. */
export const STRONG_CRITERIA = 0.75;
export const OWNER_MIN_CONFIDENCE = 0.65;

export type ReasonCode =
  | 'DISTRICT_MATCH' | 'OWNER_LIKELY' | 'RENOVATED' | 'NEW_BUILD' | 'HAS_PARKING'
  | 'LOWEST_ACROSS_SOURCES' | 'GOOD_VALUE_VS_SIMILAR' | 'VERIFIED_RECENTLY';

export interface ListingView {
  listingId: string;
  sourceListingId?: string;
  address?: string | null;
  source: string;
  sourceName: string | null;
  exactUrl: string;
  title: string | null;
  priceUsd: number | null;
  priceOriginal: { amount: number; currency: string } | null;
  observedAt: string;
  lastVerifiedAt: string | null;
  freshness: NormalizedListing['freshness'];
  publishedAt?: string | null;
  updatedAt?: string | null;
  seller: { classification: SellerAssessment['classification']; name: string | null; publicPhone: string | null; publicEmail: string | null; publicProfile: string | null };
  authorUrl: string | null;
  isLowest: boolean;
  isHighest: boolean;
}

export interface ResultProperty {
  key: string;
  group: ResultGroup;
  rank: number;
  score: number;
  title: string | null;
  description?: string | null;
  intelligence?: ResultEvidence;
  facts: PropertyFacts;
  images: string[];
  freshness: { state: NormalizedListing['freshness']; lastVerifiedAt: string | null };
  seller: { classification: SellerAssessment['classification']; confidence: number; reasonCodes: string[] };
  sourceCount: number;
  listings: ListingView[];
  priceDiscrepancy: PriceDiscrepancy | null;
  vsComparable: number | null;
  reasons: Array<{ code: ReasonCode; count?: number }>;
  unverified: string[];
  upgrade: (Gain & { band: 'UPGRADE_PREFERRED' | 'UPGRADE_EXTENDED' }) | null;
  /** Internal; served to Admin only. */
  internal: {
    components: RankingComponents;
    band: BudgetBand;
    violations: string[];
    resolutionEvidence: string[];
    resolutionTiers: string[];
    sellerEvidence: string[];
    criteria: number;
  };
}

export interface PipelineStats {
  raw: number;
  validated: number;
  rejected: Record<string, number>;
  normalized: number;
  uniqueProperties: number;
  duplicatesCollapsed: number;
  possibleDuplicates: number;
  vetoedMerges: number;
  comparisons: number;
  sellerClasses: Record<string, number>;
  priceDiscrepancies: number;
  excludedByFilter: number;
  inBudget: number;
  strongMatches: number;
  upgrades: number;
  stale: number;
}

export interface PipelineOutput {
  version: typeof PIPELINE_VERSION;
  properties: ResultProperty[];
  excluded: Array<{ key: string; reason: string }>;
  possibleDuplicates: PairDecision[];
  localComparison: LocalComparison;
  stats: PipelineStats;
}

export interface PipelineInput {
  request: MarketplaceSearchRequest;
  candidates: ReadonlyArray<{ workerId: string; candidate: ExternalListingCandidate }>;
  converter?: CurrencyConverter | null;
  now?: Date;
  verifiedOwnerPhoneKeys?: ReadonlySet<string>;
}

const FRESH_ORDER = { VERIFIED: 2, RECENT: 1, STALE: 0 } as const;

function mergeFacts(members: NormalizedListing[], now: Date): { facts: PropertyFacts; representative: NormalizedListing } {
  const rep = [...members].sort((a, b) => FRESH_ORDER[b.freshness] - FRESH_ORDER[a.freshness]
    || (listingActivity(a.publishedAt, a.updatedAt, now).ageDays ?? 31) - (listingActivity(b.publishedAt, b.updatedAt, now).ageDays ?? 31)
    || b.completeness - a.completeness || a.id.localeCompare(b.id))[0];
  const first = <K extends keyof NormalizedListing>(k: K): NormalizedListing[K] | null => {
    if (rep[k] !== null && rep[k] !== undefined) return rep[k];
    for (const m of members) if (m[k] !== null && m[k] !== undefined) return m[k];
    return null;
  };
  const prices = members.map((m) => m.priceUsd).filter((v): v is number => v !== null);
  const lowest = prices.length ? Math.min(...prices) : null;
  const area = first('areaSqm') as number | null;
  const amenities = [...new Set(members.flatMap((m) => m.amenities))].sort();
  return {
    representative: rep,
    facts: {
      priceUsd: lowest,
      pricePerSqmUsd: lowest !== null && area ? Math.round(lowest / area) : null,
      areaSqm: area,
      rooms: first('rooms') as number | null,
      bedrooms: first('bedrooms') as number | null,
      bathrooms: first('bathrooms') as number | null,
      floor: first('floor') as number | null,
      totalFloors: first('totalFloors') as number | null,
      city: (first('city') as string | null),
      district: (first('district') as string | null),
      buildingStatus: first('buildingStatus') as string | null,
      renovationStatus: first('renovationStatus') as string | null,
      parking: members.some((m) => m.parking === true) ? true : members.every((m) => m.parking === false) ? false : null,
      furnished: first('furnished') as boolean | null,
      amenities,
    },
  };
}

export function processSearch(input: PipelineInput): PipelineOutput {
  const now = input.now ?? new Date();
  const req = input.request;
  const rejected: Record<string, number> = {};
  const observations = new Map<string, NormalizedListing>();
  for (const { candidate } of input.candidates) {
    const v = validateListing(candidate, req, { converter: input.converter, now });
    if (!v.valid) { rejected[v.reason] = (rejected[v.reason] ?? 0) + 1; continue; }
    if (v.listing.oldListing) { rejected.LISTING_OVER_30_DAYS = (rejected.LISTING_OVER_30_DAYS ?? 0) + 1; continue; }
    const prev = observations.get(v.listing.id);
    if (prev) {
      rejected.DUPLICATE_REPORT = (rejected.DUPLICATE_REPORT ?? 0) + 1;
      // Repeated reports choose the newest source observation, then completeness; never input order.
      const order = Date.parse(v.listing.observedAt) - Date.parse(prev.observedAt)
        || v.listing.completeness - prev.completeness || JSON.stringify(v.listing).localeCompare(JSON.stringify(prev));
      if (order <= 0) continue;
    }
    observations.set(v.listing.id, v.listing);
  }
  const valid = [...observations.values()].sort((a, b) => a.id.localeCompare(b.id));
  const byId = new Map(valid.map((l) => [l.id, l]));
  const resolution = resolveProperties(valid);

  /* Contacts across PROPERTIES (not listings): one flat on three portals is still one property. */
  const propsPerPhone = new Map<string, Set<string>>();
  for (const l of valid) {
    if (!l.seller.phoneKey) continue;
    const set = propsPerPhone.get(l.seller.phoneKey) ?? new Set<string>();
    set.add(resolution.keyOf.get(l.id)!);
    propsPerPhone.set(l.seller.phoneKey, set);
  }
  const sellerCtx = {
    propertiesPerPhone: new Map([...propsPerPhone].map(([k, v]) => [k, v.size])),
    verifiedOwnerPhoneKeys: input.verifiedOwnerPhoneKeys,
  };

  interface Working {
    key: string;
    members: NormalizedListing[];
    facts: PropertyFacts;
    rep: NormalizedListing;
    sellers: Map<string, SellerAssessment>;
    seller: SellerAssessment;
    filter: HardFilterResult;
    discrepancy: PriceDiscrepancy | null;
    freshness: NormalizedListing['freshness'];
    lastVerifiedAt: string | null;
    oldListing: boolean;
    sources: number;
    intelligence: ResultEvidence;
    cluster: { evidence: string[]; tiers: string[] };
  }
  const working: Working[] = resolution.clusters.map((c) => {
    const members = c.memberIds.map((id) => byId.get(id)!);
    const { facts, representative } = mergeFacts(members, now);
    const sellers = new Map(members.map((m) => [m.id, classifySeller(m, sellerCtx)]));
    const all = [...sellers.values()];
    const owner = all.filter((s) => isOwnerClass(s.classification)).sort((a, b) => b.confidence - a.confidence)[0];
    const seller = owner ?? all.sort((a, b) => b.confidence - a.confidence)[0];
    const verified = members.map((m) => m.lastVerifiedAt).filter((v): v is string => !!v).sort().reverse();
    const best = members.reduce((acc, m) => (FRESH_ORDER[m.freshness] > FRESH_ORDER[acc] ? m.freshness : acc), 'STALE' as NormalizedListing['freshness']);
    return {
      key: c.key, members, facts, rep: representative, sellers, seller,
      filter: hardFilter(facts, req),
      discrepancy: priceDiscrepancy(members),
      freshness: best,
      lastVerifiedAt: verified[0] ?? null,
      oldListing: members.every((m) => m.oldListing),
      sources: new Set(members.map((m) => m.source)).size,
      intelligence: resultEvidence(representative, members, facts, req, now),
      cluster: { evidence: c.evidence, tiers: c.tiers },
    };
  });

  const possibleKeys = new Set(resolution.possible.flatMap((pair) => [resolution.keyOf.get(pair.a), resolution.keyOf.get(pair.b)]));
  const descriptions = new Map<string, Set<string>>();
  for (const w of working) {
    const fp = descriptionFingerprint(w.rep.description);
    if (fp) { const keys = descriptions.get(fp) ?? new Set<string>(); keys.add(w.key); descriptions.set(fp, keys); }
  }
  for (const w of working) {
    if (possibleKeys.has(w.key)) w.intelligence.warnings.push('POSSIBLE_DUPLICATE');
    if (w.discrepancy?.significant) w.intelligence.warnings.push('PRICE_CONFLICT');
    if (w.seller.reasonCodes.includes('CONTACT_ON_MANY_PROPERTIES')) w.intelligence.warnings.push('MULTI_PROPERTY_CONTACT');
    const fp = descriptionFingerprint(w.rep.description);
    if (fp && (descriptions.get(fp)?.size ?? 0) > 1) w.intelligence.warnings.push('COPIED_DESCRIPTION');
    w.intelligence.verificationNeeded = w.intelligence.warnings.some((code) => code !== 'MULTI_PROPERTY_CONTACT') || w.filter.unverified.length > 0;
  }

  const inBudget = working.filter((w) => w.filter.fits && w.filter.band === 'IN_BUDGET');
  const local = localComparison(inBudget.map((w) => ({ priceUsd: w.facts.priceUsd, pricePerSqmUsd: w.facts.pricePerSqmUsd })));

  const ranked = working.map((w) => {
    const r = rankProperty({
      facts: w.facts, filter: w.filter, freshness: w.freshness, oldListing: w.oldListing,
      seller: w.seller.classification, sellerConfidence: w.seller.confidence, sourceCount: w.sources,
      completeness: w.rep.completeness,
      listingAgeDays: w.intelligence.activity.ageDays,
      descriptionFit: w.intelligence.preferences.mentioned.length,
      warningCount: w.intelligence.warnings.filter((code) => code !== 'MULTI_PROPERTY_CONTACT').length,
    }, req, local);
    return { w, r };
  });

  const upgrades = selectUpgrades(ranked.map(({ w, r }) => ({
    key: w.key, facts: w.facts, band: w.filter.band, fits: w.filter.fits, criteriaScore: r.components.criteria,
    freshness: w.freshness, seller: w.seller.classification, score: r.score,
  })), { maxUsd: req.priceMaxUsd, districts: req.districts });
  const upgradeOf = new Map(upgrades.map((u) => [u.key, u]));

  const excluded: PipelineOutput['excluded'] = [];
  const eligible = ranked.filter(({ w }) => {
    if (upgradeOf.has(w.key)) return true;
    if (!w.filter.fits) { excluded.push({ key: w.key, reason: w.filter.violations[0] }); return false; }
    if (w.filter.band !== 'IN_BUDGET') { excluded.push({ key: w.key, reason: `PRICE_${w.filter.band}` }); return false; }
    return true;
  });
  const order = (a: typeof ranked[number], b: typeof ranked[number]) => b.r.score - a.r.score
    || (a.w.intelligence.activity.ageDays ?? 31) - (b.w.intelligence.activity.ageDays ?? 31) || a.w.key.localeCompare(b.w.key);
  const normal = eligible.filter(({ w }) => !upgradeOf.has(w.key)).sort(order);
  const strong = normal.filter(({ w, r }) => r.components.criteria >= STRONG_CRITERIA && w.freshness !== 'STALE');
  const best = strong.slice(0, BEST_LIMIT);
  const bestKeys = new Set(best.map(({ w }) => w.key));
  const owners = normal.filter(({ w }) => !bestKeys.has(w.key) && isOwnerClass(w.seller.classification)
    && w.seller.confidence >= OWNER_MIN_CONFIDENCE && w.freshness !== 'STALE').slice(0, OWNER_LIMIT);
  const ownerKeys = new Set(owners.map(({ w }) => w.key));
  const more = normal.filter(({ w }) => !bestKeys.has(w.key) && !ownerKeys.has(w.key));
  const upgradeRows = upgrades.map((u) => ranked.find(({ w }) => w.key === u.key)!);

  const properties: ResultProperty[] = [];
  const emit = (rows: typeof ranked, group: ResultGroup) => rows.forEach(({ w, r }, i) => {
    const reasons: ResultProperty['reasons'] = [];
    if (districtFit(w.facts.district, req.districts) === 'MATCH') reasons.push({ code: 'DISTRICT_MATCH' });
    if (isOwnerClass(w.seller.classification) && w.seller.confidence >= OWNER_MIN_CONFIDENCE) reasons.push({ code: 'OWNER_LIKELY' });
    if (w.facts.renovationStatus === 'RENOVATED') reasons.push({ code: 'RENOVATED' });
    if (w.facts.buildingStatus === 'NEW_BUILD') reasons.push({ code: 'NEW_BUILD' });
    if (w.facts.parking === true) reasons.push({ code: 'HAS_PARKING' });
    if (w.discrepancy?.significant) reasons.push({ code: 'LOWEST_ACROSS_SOURCES', count: w.discrepancy.listingCount });
    if (r.vsComparable !== null && r.vsComparable <= -0.07) reasons.push({ code: 'GOOD_VALUE_VS_SIMILAR' });
    if (w.freshness === 'VERIFIED') reasons.push({ code: 'VERIFIED_RECENTLY' });
    const u = upgradeOf.get(w.key);
    const prices = new Map((w.discrepancy?.prices ?? []).map((p) => [p.listingId, p]));
    properties.push({
      key: w.key,
      group,
      rank: i + 1,
      score: r.score,
      title: w.rep.title,
      description: w.rep.description?.replace(/<[^>]*>/g, ' ').trim() ?? null,
      intelligence: { ...w.intelligence, strong: r.components.criteria >= STRONG_CRITERIA && w.filter.unverified.length === 0
        && w.filter.band === 'IN_BUDGET' && w.freshness !== 'STALE' && !w.intelligence.verificationNeeded },
      facts: w.facts,
      images: [...new Set([...w.rep.images, ...w.members.flatMap((m) => m.images)])].slice(0, 12),
      freshness: { state: w.freshness, lastVerifiedAt: w.lastVerifiedAt },
      seller: { classification: w.seller.classification, confidence: w.seller.confidence, reasonCodes: w.seller.reasonCodes },
      sourceCount: w.sources,
      listings: [...w.members].sort((a, b) => Number(b.id === w.rep.id) - Number(a.id === w.rep.id)
        || (a.priceUsd ?? Infinity) - (b.priceUsd ?? Infinity) || a.id.localeCompare(b.id)).map((m) => ({
        listingId: m.id,
        sourceListingId: m.sourceListingId,
        address: m.address,
        source: m.source,
        sourceName: m.sourceName,
        exactUrl: m.exactUrl,
        title: m.title,
        priceUsd: m.priceUsd,
        priceOriginal: m.priceOriginal,
        observedAt: m.observedAt,
        lastVerifiedAt: m.lastVerifiedAt,
        freshness: m.freshness,
        publishedAt: m.publishedAt,
        updatedAt: m.updatedAt,
        seller: {
          classification: w.sellers.get(m.id)!.classification,
          name: m.seller.name, publicPhone: m.seller.publicPhone, publicEmail: m.seller.publicEmail, publicProfile: m.seller.publicProfile,
        },
        authorUrl: m.provenance.authorUrl,
        isLowest: prices.get(m.id)?.isLowest ?? false,
        isHighest: prices.get(m.id)?.isHighest ?? false,
      })),
      priceDiscrepancy: w.discrepancy,
      vsComparable: r.vsComparable,
      reasons: reasons.slice(0, 6),
      unverified: w.filter.unverified,
      upgrade: u ? { ...u.gain, band: u.band } : null,
      internal: {
        components: r.components,
        band: w.filter.band,
        violations: w.filter.violations,
        resolutionEvidence: w.cluster.evidence,
        resolutionTiers: w.cluster.tiers,
        sellerEvidence: w.seller.evidence,
        criteria: r.components.criteria,
      },
    });
  });
  emit(best, 'BEST');
  emit(owners, 'OWNER');
  emit(upgradeRows, 'UPGRADE');
  emit(more, 'MORE');

  // One section per property. Historical storage groups stay compatible with existing consumers.
  const overall = [...properties].sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  let bestCount = 0;
  for (const p of overall) {
    const intel = p.intelligence!;
    intel.section = p.group === 'UPGRADE' ? 'UPGRADE' : intel.verificationNeeded ? 'VERIFY'
      : intel.strong && bestCount < BEST_LIMIT ? 'BEST'
        : intel.strong && intel.activity.ageDays !== null && intel.activity.ageDays <= 2 ? 'FRESH'
          : p.vsComparable !== null && p.vsComparable <= -0.07 ? 'VALUE' : 'CLOSE';
    if (intel.section === 'BEST') bestCount += 1;
  }

  const sellerClasses: Record<string, number> = {};
  for (const w of working) sellerClasses[w.seller.classification] = (sellerClasses[w.seller.classification] ?? 0) + 1;
  return {
    version: PIPELINE_VERSION,
    properties,
    excluded,
    possibleDuplicates: resolution.possible,
    localComparison: local,
    stats: {
      raw: input.candidates.length,
      validated: valid.length,
      rejected,
      normalized: valid.length,
      uniqueProperties: resolution.clusters.length,
      duplicatesCollapsed: valid.length - resolution.clusters.length,
      possibleDuplicates: resolution.possible.length,
      vetoedMerges: resolution.vetoed.length,
      comparisons: resolution.comparisons,
      sellerClasses,
      priceDiscrepancies: working.filter((w) => w.discrepancy?.significant).length,
      excludedByFilter: excluded.length,
      inBudget: normal.length,
      strongMatches: strong.length,
      upgrades: upgrades.length,
      stale: working.filter((w) => w.freshness === 'STALE').length,
    },
  };
}

/** One page of one group. Results go to the browser a page at a time, never the raw set. */
export function pageResults(output: Pick<PipelineOutput, 'properties'>, group: ResultGroup, offset: number, limit: number):
  { items: ResultProperty[]; total: number; nextOffset: number | null } {
  const all = output.properties.filter((p) => p.group === group);
  const start = Math.max(0, Math.trunc(offset) || 0);
  const size = Math.max(1, Math.min(48, Math.trunc(limit) || 12));
  const items = all.slice(start, start + size);
  return { items, total: all.length, nextOffset: start + size < all.length ? start + size : null };
}

/** The customer-facing view of a property: everything except the internal block. */
export function publicView(p: ResultProperty): Omit<ResultProperty, 'internal'> {
  const { internal: _internal, ...rest } = p;
  return rest;
}
