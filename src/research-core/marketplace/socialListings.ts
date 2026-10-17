/*
 * FIND PROPERTY — social listings in the marketplace results.
 *
 * A paid social OFFER campaign (findProperty/offerCampaign.ts) stores the posts
 * that offer a property as supply_observations. Once the campaign has ended, they
 * join the search's ranked results through the same pipeline as the portals, so
 * they are deduplicated against portal listings (one property, several sources),
 * scored against the same request and filtered by the same rules.
 *
 * What stays different, by rule:
 *   - a social post is unverified content written by whoever posted it: it is
 *     labelled as such (ListingView.social) and never counted as a Best Match
 *     on its own (pipeline.ts);
 *   - a request ("looking for a flat") is never a listing: qualifyOffer rejects it
 *     at storage and socialCandidate checks again here;
 *   - photos are the post's own; none are ever invented.
 *
 * Pure (no I/O).
 */
import { classifyDirection } from '../signals/direction.ts';
import type { ExternalListingCandidate } from './worker-contract.ts';
import type { MarketplacePropertyType } from './taxonomy.ts';

/** adapter_version of social offers stored with their photos. */
export const SOCIAL_ADAPTER_VERSION = 'fp-social-offers-2';
/** Every social listing's source starts with this; the rest is the network. */
export const SOCIAL_SOURCE_PREFIX = 'social:';
export const isSocialSource = (source: string | null | undefined) => String(source ?? '').startsWith(SOCIAL_SOURCE_PREFIX);

export const SOCIAL_NETWORK_NAMES: Readonly<Record<string, string>> = {
  FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram', TELEGRAM: 'Telegram', VK: 'VK',
};

const MAX_IMAGES = 12;
const IMAGE_KEYS = /^(images?|imageUrls?|photos?|photoUrls?|displayUrl|thumbnail(Url)?|media|mediaUrls?|attachments|full_picture|picture|uri|src|url|image_url|photo_url|preview|previewUrl|childPosts|sidecar|carousel|fullSizeUrl)$/i;
const looksLikeImage = (u: string) => /\.(jpe?g|png|webp|gif)(\?|$)/i.test(u)
  || /(fbcdn\.net|cdninstagram\.com|scontent|telesco\.pe|cdn\d*\.telegram|userapi\.com|sun\d+-\d+\.userapi)/i.test(u);

/**
 * The post's own photos, from whatever shape the Actor delivered: known image
 * keys, followed into nested media/attachment objects (a few levels deep).
 * Only https URLs that look like images; no profile pictures (author/avatar keys
 * are never followed); at most twelve, in the order the post shows them.
 */
export function offerImages(raw: unknown): string[] {
  const found: string[] = [];
  const walk = (v: unknown, depth: number, viaImageKey: boolean) => {
    if (found.length >= MAX_IMAGES || depth > 5 || v == null) return;
    if (typeof v === 'string') {
      if (viaImageKey && /^https:\/\//.test(v) && looksLikeImage(v) && !found.includes(v)) found.push(v);
      return;
    }
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1, viaImageKey); return; }
    if (typeof v === 'object') {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (/author|avatar|profile|owner|user|logo|icon|channel|group|page/i.test(k)) continue;
        if (IMAGE_KEYS.test(k)) walk(x, depth + 1, true);
        else if (viaImageKey && typeof x === 'object') walk(x, depth + 1, true);
      }
    }
  };
  walk(raw, 0, false);
  return found;
}

/** A stored social offer, as read for the results (supply_observations columns). */
export interface SocialObservation {
  id: string;
  external_id: string;
  canonical_url: string;
  transaction: string | null;
  property_type: string | null;
  city: string | null;
  district: string | null;
  sale_amount: number | null;
  sale_currency: string | null;
  rent_amount: number | null;
  rent_currency: string | null;
  rent_period: string | null;
  area_sqm: number | null;
  rooms: number | null;
  bedrooms: number | null;
  floor: number | null;
  total_floors: number | null;
  title: string | null;
  description: string | null;
  published_at: string | null;
  last_seen_at: string | null;
  image_urls: string[] | null;
  field_origins: Record<string, unknown> | null;
}

const PROPERTY_TYPES: readonly MarketplacePropertyType[] = ['APARTMENT', 'HOUSE', 'LAND', 'COMMERCIAL'];
const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * A stored social offer as a marketplace candidate, or null when it cannot be one:
 * no https post URL, no price, a rent price that is not monthly, or text that
 * reads as a request rather than an offer.
 */
export function socialCandidate(o: SocialObservation, now = new Date()): ExternalListingCandidate | null {
  if (!o.canonical_url || !/^https:\/\//.test(o.canonical_url)) return null;
  const text = [o.title, o.description].filter(Boolean).join('\n');
  if (!text.trim() || classifyDirection(text).direction === 'DEMAND') return null;
  const sale = o.transaction === 'SALE';
  const rent = o.transaction === 'RENT';
  if (!sale && !rent) return null;
  if (rent && o.rent_period && o.rent_period !== 'MONTH') return null;
  const price = num(sale ? o.sale_amount : o.rent_amount);
  const currency = (sale ? o.sale_currency : o.rent_currency) ?? null;
  if (price == null || price <= 0 || !currency) return null;
  const network = String(o.field_origins?.network ?? 'FACEBOOK').toUpperCase();
  const authorUrl = typeof o.field_origins?.authorUrl === 'string' && /^https:\/\//.test(o.field_origins.authorUrl) ? o.field_origins.authorUrl : null;
  const area = num(o.area_sqm);
  const type = PROPERTY_TYPES.find((t) => t === o.property_type) ?? null;
  return {
    source: `${SOCIAL_SOURCE_PREFIX}${network.toLowerCase()}`,
    sourceListingId: o.external_id,
    exactUrl: o.canonical_url,
    canonicalUrl: o.canonical_url,
    sourceName: SOCIAL_NETWORK_NAMES[network] ?? network,
    sourceType: null,
    title: o.title,
    description: o.description,
    price,
    currency: currency.toUpperCase(),
    pricePerSqm: area && area > 0 ? Math.round(price / area) : null,
    country: 'GE',
    city: o.city,
    district: o.district,
    address: null,
    latitude: null,
    longitude: null,
    propertyType: type,
    transactionType: sale ? 'BUY' : 'MONTHLY_RENT',
    areaSqm: area,
    rooms: num(o.rooms),
    bedrooms: num(o.bedrooms),
    bathrooms: null,
    floor: num(o.floor),
    totalFloors: num(o.total_floors),
    buildingStatus: null,
    renovationStatus: null,
    constructionYear: null,
    furnished: null,
    parking: null,
    amenities: [],
    images: (o.image_urls ?? []).filter((u) => /^https:\/\//.test(u)).slice(0, MAX_IMAGES),
    imageHashes: [],
    publishedAt: o.published_at,
    updatedAt: null,
    observedAt: o.last_seen_at ?? now.toISOString(),
    seller: { name: null, publicPhone: null, publicEmail: null, publicProfile: authorUrl, declaredType: null, sourceListingCount: null },
    provenance: { exactUrl: o.canonical_url, authorUrl, sourceUrl: null },
    evidence: [],
    retrievalMetadata: { social: true, network, observationLevel: 'SOCIAL_POST', verified: false, observationId: o.id },
  };
}
