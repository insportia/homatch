// HOMATCH MARKETPLACE SEARCH — one physical property, however many listings.
//
// A property is not a listing. The same flat on three marketplaces at $162,000,
// $165,000 and $181,000 is ONE property with THREE available listings, and the
// price disagreement is one of the most useful things HOMATCH can show.
//
// The pairwise judgement is entity-resolution.ts `resolve()`, unchanged: it
// already treats price as never contradictory and returns UNRESOLVED rather than
// guessing. This module adds the evidence a marketplace worker can carry that an
// observation row could not (shared public phone, image hashes, coordinates) and
// clusters with a complete-linkage veto, so A~B and B~C never drag a
// conflicting A and C into one property.
//
// FALSE MERGES ARE WORSE THAN VISIBLE DUPLICATES. Only EXACT_DUPLICATE and
// LIKELY_SAME_PROPERTY collapse. POSSIBLE_SAME_PROPERTY is recorded (Admin sees
// it) and the listings stay separate. Every merge stores its evidence; every
// refusal stores the conflict.

import { type ResolvableObservation, resolve } from '../discovery/entity-resolution.ts';
import type { NormalizedListing } from './normalize.ts';

export const PROPERTY_ENTITY_VERSION = 'marketplace-property-entity-1';

export type PropertyMatchTier = 'EXACT_DUPLICATE' | 'LIKELY_SAME_PROPERTY' | 'POSSIBLE_SAME_PROPERTY' | 'DISTINCT_PROPERTY';

export interface PairDecision {
  a: string;
  b: string;
  tier: PropertyMatchTier;
  confidence: number;
  evidence: string[];
  conflict: string | null;
}

/** Above this cross-source price spread a likely match is only POSSIBLE: too different to merge unseen. */
export const MAX_AUTO_MERGE_PRICE_SPREAD = 0.30;
const AREA_TOLERANCE = 0.03;
const GEO_METRES = 30;

const observation = (l: NormalizedListing): ResolvableObservation => ({
  id: l.id,
  sourceId: l.source,
  adapterId: l.source,
  externalId: l.sourceListingId,
  canonicalUrl: l.canonicalUrl ?? l.exactUrl,
  countryCode: l.country,
  city: l.cityKey ?? l.city,
  district: l.districtKey ?? l.district,
  transaction: l.transactionType,
  propertyType: l.propertyType,
  areaSqm: l.areaSqm,
  rooms: l.rooms,
  bedrooms: l.bedrooms,
  floor: l.floor,
  saleAmount: l.priceUsd,
  saleCurrency: l.priceUsd !== null ? 'USD' : null,
  contentFingerprint: null,
  quality: l.completeness,
});

const areaAgrees = (a: number | null, b: number | null) =>
  a !== null && b !== null && Math.abs(a - b) / Math.max(a, b) <= AREA_TOLERANCE;

function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Decide one pair. Deterministic, explainable, never merges on price alone. */
export function classifyPair(x: NormalizedListing, y: NormalizedListing): PairDecision {
  const d = resolve(observation(x), observation(y));
  const base = { a: x.id < y.id ? x.id : y.id, b: x.id < y.id ? y.id : x.id };
  const evidence = d.signals.filter((s) => s.weight > 0).map((s) => s.name);
  if (d.verdict === 'EXACT_DUPLICATE') return { ...base, tier: 'EXACT_DUPLICATE', confidence: 1, evidence, conflict: null };
  if (d.verdict === 'DISTINCT') {
    return { ...base, tier: 'DISTINCT_PROPERTY', confidence: d.confidence, evidence, conflict: d.signals.find((s) => s.weight < 0)?.name ?? d.reason };
  }
  /* Rooms/bedrooms disagreements are soft in resolve(); for a merge they are a conflict. */
  if (x.rooms !== null && y.rooms !== null && x.rooms !== y.rooms) {
    return { ...base, tier: 'DISTINCT_PROPERTY', confidence: 0.8, evidence, conflict: 'room count' };
  }
  if (x.bedrooms !== null && y.bedrooms !== null && x.bedrooms !== y.bedrooms) {
    return { ...base, tier: 'DISTINCT_PROPERTY', confidence: 0.8, evidence, conflict: 'bedroom count' };
  }
  if (x.floor !== null && y.floor !== null && x.floor !== y.floor) {
    return { ...base, tier: 'DISTINCT_PROPERTY', confidence: 0.75, evidence, conflict: 'floor' };
  }

  const extra: string[] = [];
  const area = areaAgrees(x.areaSqm, y.areaSqm);
  if (x.imageHashes.length && y.imageHashes.some((h) => x.imageHashes.includes(h)) && area) extra.push('shared image');
  if (x.seller.phoneKey && x.seller.phoneKey === y.seller.phoneKey && area && x.rooms !== null && x.rooms === y.rooms) {
    extra.push('shared public phone');
  }
  if (x.geo && y.geo && metres(x.geo, y.geo) <= GEO_METRES && area) extra.push('same coordinates');

  let tier: PropertyMatchTier;
  if (d.verdict === 'LIKELY_SAME_ENTITY' || extra.length) tier = 'LIKELY_SAME_PROPERTY';
  else if (d.verdict === 'RELATED') tier = 'POSSIBLE_SAME_PROPERTY';
  else tier = 'DISTINCT_PROPERTY';

  if (tier === 'LIKELY_SAME_PROPERTY' && x.priceUsd && y.priceUsd) {
    const spread = Math.abs(x.priceUsd - y.priceUsd) / Math.max(x.priceUsd, y.priceUsd);
    if (spread > MAX_AUTO_MERGE_PRICE_SPREAD) tier = 'POSSIBLE_SAME_PROPERTY';
  }
  /* A same-source pair that is not the same id is two listings on one site: never auto-merged. */
  if (tier === 'LIKELY_SAME_PROPERTY' && x.source === y.source && !extra.includes('shared image')) tier = 'POSSIBLE_SAME_PROPERTY';
  return { ...base, tier, confidence: Math.min(1, d.confidence + extra.length * 0.1), evidence: [...evidence, ...extra], conflict: null };
}

export interface PropertyCluster {
  key: string;
  memberIds: string[];
  evidence: string[];
  tiers: PropertyMatchTier[];
}

export interface ResolutionResult {
  clusters: PropertyCluster[];
  keyOf: Map<string, string>;
  merges: PairDecision[];
  possible: PairDecision[];
  vetoed: Array<PairDecision & { vetoedBy: string }>;
  comparisons: number;
}

/** Blocks bigger than this are too common to be evidence (a broker's phone on 400 listings). */
export const MAX_BLOCK = 200;

function blockKeys(l: NormalizedListing): string[] {
  const keys: string[] = [`u:${l.canonicalUrl ?? l.exactUrl}`, `x:${l.source}:${l.sourceListingId}`];
  if (l.areaSqm) {
    /* Log-scale buckets ~3% wide; a pair within tolerance shares this or an adjacent bucket. */
    const b = Math.floor(Math.log(l.areaSqm) / Math.log(1.03));
    keys.push(`a:${l.cityKey ?? ''}:${b}`, `a:${l.cityKey ?? ''}:${b + 1}`);
  }
  if (l.seller.phoneKey) keys.push(`p:${l.seller.phoneKey}`);
  for (const h of l.imageHashes.slice(0, 6)) keys.push(`i:${h}`);
  if (l.geo) keys.push(`g:${Math.round(l.geo.lat * 2000)}:${Math.round(l.geo.lng * 2000)}`);
  return keys;
}

/** Cluster listings into properties. Deterministic for a given input set. */
export function resolveProperties(listings: readonly NormalizedListing[]): ResolutionResult {
  const sorted = [...listings].sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
  const byId = new Map(sorted.map((l) => [l.id, l]));
  const blocks = new Map<string, number[]>();
  sorted.forEach((l, i) => {
    for (const k of blockKeys(l)) {
      const list = blocks.get(k) ?? [];
      list.push(i);
      blocks.set(k, list);
    }
  });
  const pairSet = new Set<string>();
  const pairs: Array<[number, number]> = [];
  for (const members of blocks.values()) {
    if (members.length < 2 || members.length > MAX_BLOCK) continue;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const key = `${members[i]}|${members[j]}`;
        if (pairSet.has(key)) continue;
        pairSet.add(key);
        pairs.push([members[i], members[j]]);
      }
    }
  }
  pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1]);

  const parent = new Map(sorted.map((l) => [l.id, l.id]));
  const members = new Map(sorted.map((l) => [l.id, [l.id]]));
  const evidenceOf = new Map<string, Set<string>>();
  const tiersOf = new Map<string, Set<PropertyMatchTier>>();
  const find = (id: string): string => {
    let r = id;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(id, r);
    return r;
  };
  const decisions = new Map<string, PairDecision>();
  const decide = (a: NormalizedListing, b: NormalizedListing) => {
    const k = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
    let dec = decisions.get(k);
    if (!dec) { dec = classifyPair(a, b); decisions.set(k, dec); }
    return dec;
  };

  const merges: PairDecision[] = [];
  const possible: PairDecision[] = [];
  const vetoed: ResolutionResult['vetoed'] = [];
  for (const [i, j] of pairs) {
    const a = sorted[i];
    const b = sorted[j];
    const dec = decide(a, b);
    if (dec.tier === 'POSSIBLE_SAME_PROPERTY') { possible.push(dec); continue; }
    if (dec.tier !== 'EXACT_DUPLICATE' && dec.tier !== 'LIKELY_SAME_PROPERTY') continue;
    const ra = find(a.id);
    const rb = find(b.id);
    if (ra === rb) continue;
    let veto: string | null = null;
    for (const m of members.get(ra)!) {
      for (const n of members.get(rb)!) {
        const cross = decide(byId.get(m)!, byId.get(n)!);
        if (cross.tier === 'DISTINCT_PROPERTY' && cross.conflict) { veto = `${cross.a}~${cross.b}: ${cross.conflict}`; break; }
      }
      if (veto) break;
    }
    if (veto) { vetoed.push({ ...dec, vetoedBy: veto }); continue; }
    const [root, child] = ra < rb ? [ra, rb] : [rb, ra];
    parent.set(child, root);
    members.set(root, [...members.get(root)!, ...members.get(child)!]);
    members.delete(child);
    const ev = evidenceOf.get(root) ?? new Set<string>();
    for (const e of [...dec.evidence, ...(evidenceOf.get(child) ?? [])]) ev.add(e);
    evidenceOf.set(root, ev);
    evidenceOf.delete(child);
    const ts = tiersOf.get(root) ?? new Set<PropertyMatchTier>();
    ts.add(dec.tier);
    for (const t of tiersOf.get(child) ?? []) ts.add(t);
    tiersOf.set(root, ts);
    tiersOf.delete(child);
    merges.push(dec);
  }

  const keyOf = new Map<string, string>();
  const clusters: PropertyCluster[] = [];
  for (const [root, ids] of members) {
    const sortedIds = [...ids].sort();
    for (const id of sortedIds) keyOf.set(id, root);
    clusters.push({ key: root, memberIds: sortedIds, evidence: [...(evidenceOf.get(root) ?? [])].sort(), tiers: [...(tiersOf.get(root) ?? [])].sort() });
  }
  clusters.sort((p, q) => (p.key < q.key ? -1 : 1));
  /* A POSSIBLE pair that later ended up in one cluster through other evidence is not "possible" any more. */
  const stillPossible = possible.filter((p) => keyOf.get(p.a) !== keyOf.get(p.b));
  return { clusters, keyOf, merges, possible: stillPossible, vetoed, comparisons: decisions.size };
}
