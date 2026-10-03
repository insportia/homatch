// PHASE 2 — CROSS-SOURCE DEDUPE: one property, one person, however many places it was posted.
//
// The same flat appears on ss.ge, in three Telegram channels and on Facebook;
// the same tenant writes the same request in two groups and on forum.ge. A
// customer must see -- and pay for -- each once, with every place it was seen
// kept as provenance.
//
// DETERMINISTIC AND EVIDENCE-BASED. Every merge names the evidence that made
// it (`edges`), and every refusal the conflict that vetoed it. No model, no
// network, no randomness: the same inputs always give the same clusters.
//
// NEVER OVERMERGE. Three protections:
//   1. Identity evidence alone is not enough where it is shared by design: a
//      broker's phone is on hundreds of listings, so a shared contact merges
//      two listings only when the property itself also agrees (area, and rooms
//      or price). An author profile merges two requests only when the request
//      agrees.
//   2. Any hard conflict vetoes (different transaction, city, property type,
//      area beyond 3%, room count, price beyond 10% for supply; non-overlapping
//      budget or different rooms for demand).
//   3. COMPLETE-LINKAGE VETO: two clusters join only if no member of one
//      conflicts with any member of the other, so A~B and B~C can never drag
//      a conflicting A and C into one entity through a chain.
//
// What is NOT used: anything the source did not provide. A missing field is
// neither agreement nor conflict.

import type { DiscoveryEntity } from './discovery-entity.ts';
import { contactKeys } from './public-contacts.ts';

export const DEDUPE_VERSION = 'cross-source-dedupe-1';

/* Thresholds, each with the reason it is that number. */
export const DEDUPE_RULES = {
  /** Area tolerance: portals round and some quote gross vs net; 3% matches entity-resolution.ts. */
  AREA_TOLERANCE: 0.03,
  /** Supply price tolerance before it is a conflict: a reposted ad after a small price drop is still one flat. */
  PRICE_CONFLICT: 0.10,
  /** Supply price agreement that counts as positive evidence: identical within rounding. */
  PRICE_AGREE: 0.02,
  /** Two coordinates this close are the same building (GPS/map-pin jitter). */
  GEO_METRES: 30,
  /** Demand: the same person rarely re-posts the same request after this many days. */
  DEMAND_WINDOW_DAYS: 30,
  /** Demand text similarity (word 3-shingle Jaccard) that counts as "the same request re-posted". */
  TEXT_SIMILAR: 0.8,
  /** Demand budgets must overlap within this slack to agree. */
  BUDGET_SLACK: 0.15,
} as const;

export interface DedupeItem {
  /** The caller's id (observation id, raw signal id, ...). */
  id: string;
  entity: DiscoveryEntity;
  /** A resolved supply_entities id, when the entity resolver already merged it. */
  entityId?: string | null;
  /** Order-insensitive content fingerprint (cl1:… / content hash). */
  fingerprint?: string | null;
  /** Perceptual or exact image hashes, when the source provided images. */
  imageKeys?: readonly string[];
}

export interface DedupeEdge { a: string; b: string; evidence: string[] }
export interface DedupeCluster {
  key: string;
  members: string[];
  evidence: string[];
}
export interface DedupeResult {
  clusters: DedupeCluster[];
  keyOf: Map<string, string>;
  edges: DedupeEdge[];
  vetoes: Array<{ a: string; b: string; conflict: string }>;
}

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1);
const lower = (s: string | null | undefined) => (s ? s.trim().toLowerCase() : null);

function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function shingles(text: string | null): Set<string> {
  const words = String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 2 < words.length; i++) out.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  return out;
}

export function textSimilarity(a: string | null, b: string | null): number {
  const A = shingles(a);
  const B = shingles(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const s of A) if (B.has(s)) inter++;
  return inter / (A.size + B.size - inter);
}

/** A conflict that forbids two items being one entity, or null. */
export function conflictBetween(x: DedupeItem, y: DedupeItem): string | null {
  const a = x.entity;
  const b = y.entity;
  if (a.kind !== b.kind) return 'kind';
  if (a.transaction && b.transaction && a.transaction !== b.transaction) return 'transaction';
  if (lower(a.city) && lower(b.city) && lower(a.city) !== lower(b.city)) return 'city';
  if (a.kind === 'SUPPLY') {
    if (a.propertyType && b.propertyType && a.propertyType !== b.propertyType) return 'propertyType';
    if (a.areaSqm && b.areaSqm && rel(a.areaSqm, b.areaSqm) > DEDUPE_RULES.AREA_TOLERANCE) return 'area';
    if (a.rooms !== null && b.rooms !== null && a.rooms !== b.rooms) return 'rooms';
    if (a.price && b.price && a.price.currency === b.price.currency && a.price.min !== null && b.price.min !== null
      && rel(a.price.min, b.price.min) > DEDUPE_RULES.PRICE_CONFLICT) return 'price';
    if (lower(a.district) && lower(b.district) && lower(a.district) !== lower(b.district)) return 'district';
  } else {
    if (a.rooms !== null && b.rooms !== null && Math.abs(a.rooms - b.rooms) > 1) return 'rooms';
    if (a.bedrooms !== null && b.bedrooms !== null && Math.abs(a.bedrooms - b.bedrooms) > 1) return 'bedrooms';
    if (a.price && b.price && a.price.currency === b.price.currency) {
      const lo = (p: DiscoveryEntity['price']) => p?.min ?? p?.max ?? null;
      const hi = (p: DiscoveryEntity['price']) => p?.max ?? p?.min ?? null;
      const [al, ah, bl, bh] = [lo(a.price), hi(a.price), lo(b.price), hi(b.price)];
      if (al !== null && ah !== null && bl !== null && bh !== null) {
        const slack = DEDUPE_RULES.BUDGET_SLACK * Math.max(ah, bh);
        if (al > bh + slack || bl > ah + slack) return 'budget';
      }
    }
    if (a.publishedAt && b.publishedAt) {
      const days = Math.abs(Date.parse(a.publishedAt) - Date.parse(b.publishedAt)) / 86_400_000;
      if (days > DEDUPE_RULES.DEMAND_WINDOW_DAYS) return 'time';
    }
  }
  return null;
}

/** The evidence that two items are the same entity; empty when there is none strong enough. */
export function sameEntityEvidence(x: DedupeItem, y: DedupeItem): string[] {
  if (conflictBetween(x, y)) return [];
  const a = x.entity;
  const b = y.entity;
  const ev: string[] = [];
  if (x.entityId && x.entityId === y.entityId) ev.push('resolved-entity');
  const pa = a.provenance.permalink;
  if (pa && pa === b.provenance.permalink) ev.push('same-permalink');
  if (a.source.entityId && a.source.adapterId === b.source.adapterId && a.source.entityId === b.source.entityId) ev.push('same-source-id');
  if (x.fingerprint && x.fingerprint === y.fingerprint) ev.push('same-text');
  if (x.imageKeys?.length && y.imageKeys?.some((k) => x.imageKeys!.includes(k))) {
    if (a.kind === 'SUPPLY' && lower(a.city) && lower(a.city) === lower(b.city)) ev.push('same-image');
  }
  if (ev.length) return ev;

  const sharedContact = contactKeys(a.contacts).some((k) => contactKeys(b.contacts).includes(k));
  if (a.kind === 'SUPPLY') {
    const areaAgrees = !!a.areaSqm && !!b.areaSqm && rel(a.areaSqm, b.areaSqm) <= DEDUPE_RULES.AREA_TOLERANCE;
    const roomsAgree = a.rooms !== null && a.rooms === b.rooms;
    const priceAgrees = !!a.price && !!b.price && a.price.currency === b.price.currency && a.price.min !== null && b.price.min !== null
      && rel(a.price.min, b.price.min) <= DEDUPE_RULES.PRICE_AGREE;
    const sameCity = !!lower(a.city) && lower(a.city) === lower(b.city);
    const sameTransaction = !!a.transaction && a.transaction === b.transaction;
    if (sharedContact && sameCity && sameTransaction && areaAgrees && (roomsAgree || priceAgrees)) {
      ev.push('shared-contact', 'area', roomsAgree ? 'rooms' : 'price');
    } else if (a.geo && b.geo && metres(a.geo, b.geo) <= DEDUPE_RULES.GEO_METRES && sameTransaction && areaAgrees && roomsAgree) {
      ev.push('coordinates', 'area', 'rooms');
    }
    return ev;
  }

  const authorA = lower(a.provenance.authorUrl);
  const sameAuthor = !!authorA && authorA === lower(b.provenance.authorUrl);
  const requestAgrees = !!a.transaction && a.transaction === b.transaction
    && (!!lower(a.city) && lower(a.city) === lower(b.city));
  if ((sameAuthor || sharedContact) && requestAgrees) {
    ev.push(sameAuthor ? 'same-author' : 'shared-contact', 'request');
  } else if (requestAgrees && textSimilarity(a.provenance.originalText, b.provenance.originalText) >= DEDUPE_RULES.TEXT_SIMILAR) {
    ev.push('similar-text', 'request');
  }
  return ev;
}

/** Block size above which a shared key is too common to be evidence (a portal-wide phone, a whole city). */
export const MAX_BLOCK = 200;

/*
 * Only pairs that share at least one blocking key are compared, so a 5,000-row
 * settlement is not 12.5M comparisons. Every rule above needs one of these
 * keys to fire, so blocking drops no merge that could have happened -- except
 * across a coordinate bucket edge, which can only cost a merge, never cause one.
 */
function blockingKeys(item: DedupeItem): string[] {
  const e = item.entity;
  const keys: string[] = [];
  if (item.entityId) keys.push(`e:${item.entityId}`);
  if (e.provenance.permalink) keys.push(`p:${e.provenance.permalink}`);
  if (e.source.entityId) keys.push(`s:${e.source.adapterId}|${e.source.entityId}`);
  if (item.fingerprint) keys.push(`f:${item.fingerprint}`);
  for (const k of item.imageKeys ?? []) keys.push(`i:${k}`);
  for (const k of contactKeys(e.contacts)) keys.push(`c:${k}`);
  if (e.kind === 'DEMAND') {
    if (e.provenance.authorUrl) keys.push(`a:${e.provenance.authorUrl.toLowerCase()}`);
    keys.push(`b:${e.transaction}|${lower(e.city)}`);
  } else if (e.geo) {
    keys.push(`g:${e.geo.lat.toFixed(3)}|${e.geo.lng.toFixed(3)}`);
  }
  return keys;
}

function candidatePairs(sorted: readonly DedupeItem[]): Array<[DedupeItem, DedupeItem]> {
  const blocks = new Map<string, number[]>();
  sorted.forEach((item, index) => {
    for (const key of blockingKeys(item)) {
      const list = blocks.get(key) ?? [];
      list.push(index);
      blocks.set(key, list);
    }
  });
  const seen = new Set<string>();
  const pairs: Array<[number, number]> = [];
  for (const list of blocks.values()) {
    if (list.length < 2 || list.length > MAX_BLOCK) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const id = `${list[i]}:${list[j]}`;
        if (seen.has(id)) continue;
        seen.add(id);
        pairs.push([list[i], list[j]]);
      }
    }
  }
  pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  return pairs.map(([i, j]) => [sorted[i], sorted[j]]);
}

/** Cluster items; a deterministic key per cluster (its lexicographically smallest member id). */
export function dedupe(items: readonly DedupeItem[]): DedupeResult {
  const sorted = [...items].sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
  const parent = new Map(sorted.map((i) => [i.id, i.id]));
  const members = new Map(sorted.map((i) => [i.id, [i]]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  const edges: DedupeEdge[] = [];
  const vetoes: DedupeResult['vetoes'] = [];
  const evidenceOf = new Map<string, Set<string>>();

  for (const [x, y] of candidatePairs(sorted)) {
    const ev = sameEntityEvidence(x, y);
    if (!ev.length) continue;
    const rx = find(x.id);
    const ry = find(y.id);
    if (rx === ry) { edges.push({ a: x.id, b: y.id, evidence: ev }); continue; }
    /* Complete-linkage veto: no member of one may conflict with any member of the other. */
    let conflict: string | null = null;
    for (const m of members.get(rx)!) {
      for (const n of members.get(ry)!) {
        conflict = conflictBetween(m, n);
        if (conflict) break;
      }
      if (conflict) break;
    }
    if (conflict) { vetoes.push({ a: x.id, b: y.id, conflict }); continue; }
    const [root, child] = rx < ry ? [rx, ry] : [ry, rx];
    parent.set(child, root);
    members.set(root, [...members.get(root)!, ...members.get(child)!]);
    members.delete(child);
    const set = evidenceOf.get(root) ?? new Set<string>();
    for (const e of [...ev, ...(evidenceOf.get(child) ?? [])]) set.add(e);
    evidenceOf.set(root, set);
    evidenceOf.delete(child);
    edges.push({ a: x.id, b: y.id, evidence: ev });
  }

  const keyOf = new Map<string, string>();
  const clusters: DedupeCluster[] = [];
  for (const [root, list] of members) {
    const ids = list.map((m) => m.id).sort();
    for (const id of ids) keyOf.set(id, root);
    clusters.push({ key: root, members: ids, evidence: [...(evidenceOf.get(root) ?? [])].sort() });
  }
  clusters.sort((p, q) => (p.key < q.key ? -1 : 1));
  return { clusters, keyOf, edges, vetoes };
}
