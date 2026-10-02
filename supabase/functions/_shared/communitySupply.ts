// PHASE 2 — a community post judged an OFFER becomes a supply observation.
//
// The demand classifier filters listing posts out of demand, which is right.
// Before Phase 2 that was where they ended; now the same post is also read by
// the deterministic extractor (research-core/discovery/community-listing.ts)
// and, when it is recognisably a listing with a place and a price or an
// area, stored as a supply_observation with its provenance: the raw signal it
// came from, its community, the URL, and where every field was read
// (field_origins). The raw signal itself is never altered beyond its
// classification. Identity is (source_id, external_id), so a re-read updates
// the same observation instead of adding one; reposts of the same flat stay
// separate observations for entity resolution to group.

import {
  COMMUNITY_LISTING_PARSER_VERSION, extractCommunityListing,
} from '../../../src/research-core/discovery/community-listing.ts';
import { contentHash } from '../../../src/research-core/normalize/hash.ts';

/*
 * A repost of the same card shuffles its lines and its hashtags, so the raw
 * text hash differs every time. The listing's own fingerprint ignores order,
 * hashtags, emoji and blank lines: a reshuffled repost is identical text,
 * which the entity resolver rightly weighs as strong evidence of one property.
 */
export function listingFingerprint(text: string): string {
  const lines = String(text || '').split('\n')
    .map((line) => line.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/[^\p{L}\p{N}+/.,:$€₾ ]/gu, '').replace(/\s+/g, ' ').trim().toLowerCase())
    .filter((line) => line.length > 2);
  return `cl1:${contentHash([...new Set(lines)].sort().join('\n'))}`;
}

export interface CommunitySignal {
  id: string;
  platform: string | null;
  source_id: string | null;
  external_id: string | null;
  source_url: string | null;
  original_text: string | null;
  language: string | null;
  published_at: string | null;
  content_fingerprint: string | null;
  author_is_agency?: boolean | null;
  source?: { city?: string | null; country_code?: string | null } | Array<{ city?: string | null; country_code?: string | null }> | null;
}

export async function recordCommunitySupply(db: any, signal: CommunitySignal): Promise<string | null> {
  if (!signal.source_id || !signal.external_id) return null;
  const source = Array.isArray(signal.source) ? signal.source[0] : signal.source;
  const listing = extractCommunityListing(String(signal.original_text ?? ''), { sourceCity: source?.city ?? null });
  if (!listing) return null;

  const now = new Date().toISOString();
  const platform = String(signal.platform ?? 'COMMUNITY').toLowerCase();
  const row: Record<string, unknown> = {
    source_id: signal.source_id,
    adapter_id: `${platform}-community`,
    external_id: String(signal.external_id),
    canonical_url: signal.source_url || `signal:${signal.id}`,
    transaction: listing.transaction,
    property_type: listing.propertyType,
    country_code: String(source?.country_code ?? 'GE').toUpperCase(),
    city: listing.city,
    district: listing.district,
    sale_amount: listing.transaction === 'SALE' ? listing.price?.amount ?? null : null,
    sale_currency: listing.transaction === 'SALE' ? listing.price?.currency ?? null : null,
    sale_basis: listing.transaction === 'SALE' && listing.price ? 'ASKING_SALE_PRICE' : null,
    rent_amount: listing.transaction === 'RENT' ? listing.price?.amount ?? null : null,
    rent_currency: listing.transaction === 'RENT' ? listing.price?.currency ?? null : null,
    rent_period: listing.transaction === 'RENT' ? listing.price?.period ?? null : null,
    area_sqm: listing.areaSqm,
    rooms: listing.rooms,
    bedrooms: listing.bedrooms,
    floor: listing.floor,
    total_floors: listing.totalFloors,
    title: String(signal.original_text ?? '').split('\n').find((line) => line.trim())?.trim().slice(0, 160) ?? null,
    description: String(signal.original_text ?? '').slice(0, 4000),
    detected_language: signal.language,
    published_at: signal.published_at,
    content_fingerprint: listingFingerprint(String(signal.original_text ?? '')),
    last_seen_at: now,
    field_origins: { ...listing.origins, rawSignalId: signal.id },
    structured_quality: listing.quality,
    parser_version: COMMUNITY_LISTING_PARSER_VERSION,
    adapter_version: 'community-supply-1',
    supply_role: signal.author_is_agency === true ? 'AGENCY' : null,
    updated_at: now,
  };
  const { data, error } = await db.from('supply_observations')
    .upsert(row, { onConflict: 'source_id,external_id' })
    .select('id').single();
  if (error) throw error;
  return data?.id ? String(data.id) : null;
}
