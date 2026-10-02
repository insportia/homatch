// PHASE 2 — ONE NORMALIZED DISCOVERY ENTITY, FOR BOTH DIRECTIONS.
//
//   SOURCE ADAPTERS → NORMALIZATION (this file) → DEDUPE → SCORING → MATCHING
//                   → PROVENANCE → BILLING / DELIVERY
//
// Find Property consumes SUPPLY entities; Find Buyers/Tenants consumes DEMAND
// entities. Both are the same shape, built by the mappers below from whatever
// a source produced (a portal listing, a community post, a social post, a
// stored observation). Nothing downstream needs to know which adapter ran.
//
// RULES
//   - Never invent a value: a field the source did not provide is null.
//   - Coordinates only when the source states them as numbers in range.
//   - Provenance is the #66 contract (attribution.ts): exact permalink wins,
//     every link passes safeWebUrl, attribution is never guessed.
//   - Public contacts are kept as written (public-contacts.ts), never redacted
//     for being contact information, and the original text survives intact.

import type { PortalListing } from '../adapters/portal/types.ts';
import { attributionFor, ORIGINAL_TEXT_LIMIT, type SourceAttribution } from './attribution.ts';
import type { CommunityListing } from './community-listing.ts';
import { publicContactsIn, type PublicContact } from './public-contacts.ts';
import { safeWebUrl } from './source-link.ts';

export const DISCOVERY_ENTITY_VERSION = 'discovery-entity-1';

export type EntityKind = 'SUPPLY' | 'DEMAND';
export type Transaction = 'SALE' | 'RENT';
export type EvidenceOrigin = 'SOURCE_FIELD' | 'TEXT' | 'SOURCE_CONTEXT' | 'MODEL';

export interface MoneyRange {
  min: number | null;
  max: number | null;
  currency: string;
  period: 'MONTH' | 'DAY' | 'YEAR' | null;
}

export interface DiscoveryEntity {
  version: typeof DISCOVERY_ENTITY_VERSION;
  kind: EntityKind;
  /** OFFER for supply; BUY / RENT / INVEST for demand. Null when the source did not say. */
  intent: 'OFFER' | 'BUY' | 'RENT' | 'INVEST' | null;
  transaction: Transaction | null;
  propertyType: string | null;
  country: string | null;
  city: string | null;
  district: string | null;
  locationText: string | null;
  geo: { lat: number; lng: number } | null;
  /** Supply: the asking price (min = max). Demand: the stated budget. */
  price: MoneyRange | null;
  rooms: number | null;
  bedrooms: number | null;
  areaSqm: number | null;
  /** When the SOURCE says it was posted; never the crawl time. */
  publishedAt: string | null;
  observedAt: string;
  language: string | null;
  source: {
    platform: string;
    adapterId: string;
    /** The source's own id for the item (listing id, channel/message, post id). */
    entityId: string | null;
  };
  provenance: SourceAttribution;
  contacts: PublicContact[];
  photos: string[];
  /** 0..1, how much of the core shape was read. */
  confidence: number;
  /** Where each filled field came from. */
  evidence: Record<string, EvidenceOrigin>;
}

const CORE_FIELDS = ['transaction', 'propertyType', 'city', 'price', 'areaSqm', 'rooms'] as const;

function confidenceOf(e: Pick<DiscoveryEntity, (typeof CORE_FIELDS)[number]>): number {
  const filled = CORE_FIELDS.filter((f) => e[f] !== null && e[f] !== undefined).length;
  return Math.round((filled / CORE_FIELDS.length) * 100) / 100;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Only coordinates that are numbers inside the globe, and not the 0,0 placeholder. */
export function reliableGeo(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const a = num(lat);
  const b = num(lng);
  if (a === null || b === null) return null;
  if (Math.abs(a) > 90 || Math.abs(b) > 180 || (a === 0 && b === 0)) return null;
  return { lat: a, lng: b };
}

/** Photo links: http(s) only, deduplicated, bounded. */
export function safePhotos(urls: readonly unknown[] | null | undefined, limit = 12): string[] {
  const out: string[] = [];
  for (const u of urls ?? []) {
    const safe = safeWebUrl(u);
    if (safe && !out.includes(safe)) out.push(safe);
    if (out.length >= limit) break;
  }
  return out;
}

function finish(entity: Omit<DiscoveryEntity, 'confidence' | 'version'>): DiscoveryEntity {
  return { version: DISCOVERY_ENTITY_VERSION, ...entity, confidence: confidenceOf(entity) };
}

/* ── SUPPLY: a portal listing, straight from an adapter ─────────────────── */

export function fromPortalListing(
  listing: PortalListing,
  options: { sourceName?: string | null; registryUrl?: string | null; photos?: readonly string[]; sellerName?: string | null; sellerUrl?: string | null; contactsText?: string | null } = {},
): DiscoveryEntity {
  const l = listing.listing;
  const money = l.sale ?? l.rent;
  const transaction: Transaction | null = l.sale ? 'SALE' : l.rent ? 'RENT' : null;
  const evidence: Record<string, EvidenceOrigin> = {};
  for (const field of Object.keys(l.fieldOrigins ?? {})) evidence[field] = 'SOURCE_FIELD';
  const area = l.area ? (l.area.unit === 'sqm' ? l.area.value : null) : null;
  const provenance = attributionFor({
    observation: { canonical_url: listing.url, adapter_id: listing.portalId },
    signal: {
      platform: 'PORTAL',
      source_url: listing.url,
      author_public_name: options.sellerName ?? l.agencyName ?? null,
      author_public_url: options.sellerUrl ?? null,
      original_text: l.description,
    },
    source: { name: options.sourceName ?? listing.sourceFamily, url: options.registryUrl ?? null },
  });
  return finish({
    kind: 'SUPPLY',
    intent: 'OFFER',
    transaction,
    propertyType: l.propertyType,
    country: l.country,
    city: l.city,
    district: l.district,
    locationText: l.address ? [l.address.street, l.address.houseNumber].filter(Boolean).join(' ') || null : null,
    geo: l.geo ? reliableGeo(l.geo.lat, l.geo.lng) : null,
    price: money ? { min: money.amount, max: money.amount, currency: money.currency, period: l.sale ? null : l.rentPeriod } : null,
    rooms: l.rooms,
    bedrooms: l.bedrooms,
    areaSqm: area,
    publishedAt: l.publishedAt,
    observedAt: listing.retrievedAt,
    language: null,
    source: { platform: 'PORTAL', adapterId: listing.portalId, entityId: listing.externalId },
    provenance,
    contacts: publicContactsIn(options.contactsText ?? null),
    photos: safePhotos(options.photos),
    evidence,
  });
}

/* ── SUPPLY: a stored supply_observations row (+ its raw signal, if any) ── */

export interface ObservationRow {
  id?: string;
  adapter_id?: string | null;
  external_id?: string | null;
  canonical_url?: string | null;
  transaction?: string | null;
  property_type?: string | null;
  country_code?: string | null;
  city?: string | null;
  district?: string | null;
  sale_amount?: number | string | null;
  sale_currency?: string | null;
  rent_amount?: number | string | null;
  rent_currency?: string | null;
  rent_period?: string | null;
  area_sqm?: number | string | null;
  rooms?: number | null;
  bedrooms?: number | null;
  description?: string | null;
  detected_language?: string | null;
  published_at?: string | null;
  last_seen_at?: string | null;
  first_seen_at?: string | null;
  field_origins?: Record<string, unknown> | null;
}

export interface SignalRow {
  platform?: string | null;
  external_id?: string | null;
  source_url?: string | null;
  parent_url?: string | null;
  author_public_name?: string | null;
  author_public_url?: string | null;
  profile_url?: string | null;
  original_text?: string | null;
  language?: string | null;
  published_at?: string | null;
}

export function fromObservationRow(
  row: ObservationRow,
  signal: SignalRow | null = null,
  source: { name?: string | null; url?: string | null } | null = null,
): DiscoveryEntity {
  const sale = num(row.sale_amount);
  const rent = num(row.rent_amount);
  const transaction = row.transaction === 'SALE' || row.transaction === 'RENT' ? row.transaction : null;
  const priceAmount = transaction === 'RENT' ? rent : sale ?? rent;
  const currency = transaction === 'RENT' ? row.rent_currency : row.sale_currency ?? row.rent_currency;
  const origins = (row.field_origins ?? {}) as Record<string, unknown>;
  const evidence: Record<string, EvidenceOrigin> = {};
  for (const [field, origin] of Object.entries(origins)) {
    if (field === 'rawSignalId' || field === 'parser') continue;
    evidence[field] = origin === 'SOURCE_CONTEXT' ? 'SOURCE_CONTEXT' : origin === 'TEXT' ? 'TEXT' : 'SOURCE_FIELD';
  }
  const text = signal?.original_text ?? row.description ?? null;
  const adapterId = row.adapter_id ?? 'unknown';
  return finish({
    kind: 'SUPPLY',
    intent: 'OFFER',
    transaction,
    propertyType: str(row.property_type),
    country: str(row.country_code),
    city: str(row.city),
    district: str(row.district),
    locationText: null,
    geo: reliableGeo(origins.lat, origins.lng),
    price: priceAmount !== null && currency
      ? { min: priceAmount, max: priceAmount, currency, period: transaction === 'RENT' ? (row.rent_period as MoneyRange['period']) ?? null : null }
      : null,
    rooms: num(row.rooms),
    bedrooms: num(row.bedrooms),
    areaSqm: num(row.area_sqm),
    publishedAt: row.published_at ?? signal?.published_at ?? null,
    observedAt: row.last_seen_at ?? row.first_seen_at ?? new Date(0).toISOString(),
    language: row.detected_language ?? signal?.language ?? null,
    source: { platform: signal?.platform ?? (adapterId.endsWith('-community') ? adapterId.replace(/-community$/, '').toUpperCase() : 'PORTAL'), adapterId, entityId: row.external_id ?? null },
    provenance: attributionFor({ observation: { canonical_url: row.canonical_url, adapter_id: adapterId }, signal, source }),
    contacts: publicContactsIn(text),
    photos: safePhotos(Array.isArray(origins.photos) ? origins.photos as unknown[] : []),
    evidence,
  });
}

/* ── SUPPLY: a community post read by the deterministic extractor ───────── */

export function fromCommunityListing(
  signal: SignalRow & { id?: string },
  listing: CommunityListing,
  source: { name?: string | null; url?: string | null; country_code?: string | null } | null = null,
  observedAt: string = new Date().toISOString(),
): DiscoveryEntity {
  const evidence: Record<string, EvidenceOrigin> = {};
  for (const [field, origin] of Object.entries(listing.origins)) evidence[field] = origin;
  return finish({
    kind: 'SUPPLY',
    intent: 'OFFER',
    transaction: listing.transaction,
    propertyType: listing.propertyType,
    country: source?.country_code ?? null,
    city: listing.city,
    district: listing.district,
    locationText: null,
    geo: null,
    price: listing.price ? { min: listing.price.amount, max: listing.price.amount, currency: listing.price.currency, period: listing.price.period } : null,
    rooms: listing.rooms,
    bedrooms: listing.bedrooms,
    areaSqm: listing.areaSqm,
    publishedAt: signal.published_at ?? null,
    observedAt,
    language: signal.language ?? null,
    source: { platform: String(signal.platform ?? 'COMMUNITY').toUpperCase(), adapterId: `${String(signal.platform ?? 'community').toLowerCase()}-community`, entityId: signal.external_id ?? null },
    provenance: attributionFor({ observation: { canonical_url: signal.source_url }, signal, source }),
    contacts: publicContactsIn(signal.original_text),
    photos: [],
    evidence,
  });
}

/* ── DEMAND: a person looking for property, from a raw signal + its reading ─ */

export interface DemandReading {
  intent?: 'BUY' | 'RENT' | 'INVEST' | null;
  transaction?: Transaction | null;
  propertyType?: string | null;
  country?: string | null;
  city?: string | null;
  district?: string | null;
  locationText?: string | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  currency?: string | null;
  rooms?: number | null;
  bedrooms?: number | null;
  areaSqm?: number | null;
  /** MODEL when an LLM read it (OpenAI classifier), TEXT for the deterministic reader. */
  origin?: 'MODEL' | 'TEXT';
}

export function fromDemandSignal(
  signal: SignalRow & { id?: string },
  reading: DemandReading,
  source: { name?: string | null; url?: string | null } | null = null,
  observedAt: string = new Date().toISOString(),
): DiscoveryEntity {
  const origin: EvidenceOrigin = reading.origin ?? 'TEXT';
  const evidence: Record<string, EvidenceOrigin> = {};
  const set = <T>(field: string, v: T | null | undefined): T | null => {
    if (v === null || v === undefined || v === '') return null;
    evidence[field] = origin;
    return v;
  };
  const currency = str(reading.currency);
  const min = num(reading.budgetMin);
  const max = num(reading.budgetMax);
  const transaction = set('transaction', reading.transaction ?? (reading.intent === 'RENT' ? 'RENT' : reading.intent === 'BUY' || reading.intent === 'INVEST' ? 'SALE' : null));
  return finish({
    kind: 'DEMAND',
    intent: reading.intent ?? null,
    transaction,
    propertyType: set('propertyType', str(reading.propertyType)),
    country: set('country', str(reading.country)),
    city: set('city', str(reading.city)),
    district: set('district', str(reading.district)),
    locationText: set('locationText', str(reading.locationText)),
    geo: null,
    price: (min !== null || max !== null) && currency ? set('price', { min, max, currency, period: transaction === 'RENT' ? 'MONTH' : null }) : null,
    rooms: set('rooms', num(reading.rooms)),
    bedrooms: set('bedrooms', num(reading.bedrooms)),
    areaSqm: set('areaSqm', num(reading.areaSqm)),
    publishedAt: signal.published_at ?? null,
    observedAt,
    language: signal.language ?? null,
    source: { platform: String(signal.platform ?? 'OTHER').toUpperCase(), adapterId: `${String(signal.platform ?? 'other').toLowerCase()}-community`, entityId: signal.external_id ?? null },
    provenance: attributionFor({ observation: { canonical_url: signal.source_url }, signal, source }),
    contacts: publicContactsIn(signal.original_text),
    photos: [],
    evidence,
  });
}

/** The original text, as the provenance carries it (capped, never rewritten). */
export function originalTextOf(entity: DiscoveryEntity): string | null {
  const t = entity.provenance.originalText;
  return t ? t.slice(0, ORIGINAL_TEXT_LIMIT) : null;
}
