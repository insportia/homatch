/*
 * WHERE A LISTING ACTUALLY IS — AND WHY THAT MAY NEVER BE AVERAGED AWAY.
 *
 * The Villion report's headline was a median of 1,670 USD/m² computed from 37
 * listings, of which zero were in the building and zero on the street. The
 * number was real and the arithmetic was right; what was wrong was that a
 * city-wide sample was presented as this property's competitive environment.
 *
 * The existing tiering had the shape of a fix but not the substance: its
 * PEER_PROJECT band is assigned to any listing merely carrying a project NAME,
 * anywhere in Tbilisi, so the band that sounded specific was the loosest one
 * in the system.
 *
 * This module replaces the naming with geography, and adds the rule the old
 * one lacked: TIERS ARE NEVER MERGED. A statistic belongs to exactly one tier
 * and carries its tier with it, so no consumer can accidentally compute one
 * number across all of them.
 */

export type GeoTier =
  | 'TIER_1_SAME_PROJECT'
  | 'TIER_2_SAME_STREET'
  | 'TIER_3_NEARBY_MICROLOCATION'
  | 'TIER_4_DISTRICT'
  | 'TIER_5_CITY';

/** Most local first. The order the buyer's question has. */
export const TIER_ORDER: readonly GeoTier[] = [
  'TIER_1_SAME_PROJECT',
  'TIER_2_SAME_STREET',
  'TIER_3_NEARBY_MICROLOCATION',
  'TIER_4_DISTRICT',
  'TIER_5_CITY',
];

/** Tiers whose evidence genuinely describes THIS property. */
export const LOCAL_TIERS: readonly GeoTier[] = [
  'TIER_1_SAME_PROJECT',
  'TIER_2_SAME_STREET',
  'TIER_3_NEARBY_MICROLOCATION',
];

export type SellerType = 'OWNER' | 'BROKER' | 'DEVELOPER' | 'UNKNOWN';

export interface ListingLike {
  url?: string | null;
  title?: string | null;
  address?: string | null;
  project?: string | null;
  district?: string | null;
  city?: string | null;
  pricePerSqm?: number | null;
  price?: number | null;
  area?: number | null;
  rooms?: number | null;
  floor?: number | null;
  condition?: string | null;
  sellerType?: SellerType | null;
  source?: string | null;
  listedAt?: string | null;
}

export interface SubjectLocation {
  project?: string | null;
  street?: string | null;
  streetNumber?: string | null;
  district?: string | null;
  city?: string | null;
  /** Streets that genuinely adjoin the subject's, when known. */
  adjacentStreets?: readonly string[];
}

const norm = (v: unknown): string =>
  (typeof v === 'string' ? v : '')
    .toLocaleLowerCase()
    .replace(/[«»„“”"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** The street word and number, as a comparable key. Shared with contractMatch. */
export function streetKey(text: string): string {
  const m = norm(text).match(
    /([\p{L}]+)\s*(?:ქუჩა|street|st|улица|ул)\s*[,\s]*(?:№|#|n)?\s*(\d+)?/u
  );
  return m ? `${m[1]}|${m[2] ?? ''}` : '';
}

const streetName = (text: string): string => streetKey(text).split('|')[0] ?? '';

/**
 * Which tier a listing belongs to.
 *
 * Checked most-specific first, and each test requires POSITIVE evidence: a
 * listing with no address and no project name falls to TIER_5 rather than
 * being optimistically placed somewhere flattering.
 */
export function classifyTier(listing: ListingLike, subject: SubjectLocation): GeoTier {
  const lAddr = `${norm(listing.address)} ${norm(listing.title)}`;
  const lProject = norm(listing.project);
  const sProject = norm(subject.project);

  // TIER 1 — the same development, by name or by exact address.
  if (sProject && (lProject === sProject || (!!lProject && lProject.includes(sProject)) || lAddr.includes(sProject))) {
    return 'TIER_1_SAME_PROJECT';
  }
  const sKey = streetKey(`${subject.street ?? ''} ${subject.streetNumber ?? ''}`);
  const lKey = streetKey(lAddr);
  if (sKey && lKey && sKey === lKey) return 'TIER_1_SAME_PROJECT';

  // TIER 2 — the same street, any number.
  const sStreet = streetName(`${subject.street ?? ''} ${subject.streetNumber ?? ''}`);
  const lStreet = streetName(lAddr);
  if (sStreet && lStreet && sStreet === lStreet) return 'TIER_2_SAME_STREET';

  // TIER 3 — a street that genuinely adjoins, when the caller established one.
  for (const adj of subject.adjacentStreets ?? []) {
    const a = streetName(adj);
    if (a && lStreet && a === lStreet) return 'TIER_3_NEARBY_MICROLOCATION';
  }

  // TIER 4 — the same district.
  const sDistrict = norm(subject.district);
  if (sDistrict && (norm(listing.district) === sDistrict || lAddr.includes(sDistrict))) {
    return 'TIER_4_DISTRICT';
  }

  return 'TIER_5_CITY';
}

/* ------------------------------------------------------------------ *
 * Syndication                                                         *
 * ------------------------------------------------------------------ */

/**
 * The identity of a listing, independent of which site is showing it.
 *
 * The same flat is advertised on several portals at once, often by the same
 * agency. Counting each copy inflates a sample and makes a thin market look
 * deep — the one failure mode that would make a wider discovery layer WORSE
 * than the narrow one it replaces.
 *
 * Identity is the physical facts a duplicate cannot change: the address key,
 * the area to the nearest whole m², the room count and the price. A syndicated
 * copy shares all four; two genuinely different flats in one building differ
 * in at least one.
 */
export function syndicationKey(listing: ListingLike): string {
  const place = streetKey(`${listing.address ?? ''} ${listing.title ?? ''}`)
    || norm(listing.project)
    || norm(listing.address);
  const area = typeof listing.area === 'number' && listing.area > 0
    ? String(Math.round(listing.area)) : '';
  const rooms = typeof listing.rooms === 'number' ? String(listing.rooms) : '';
  const price = typeof listing.price === 'number' && listing.price > 0
    ? String(Math.round(listing.price)) : '';
  return [place, area, rooms, price].join('~');
}

export interface DedupeResult<T> {
  unique: T[];
  duplicatesRemoved: number;
}

/**
 * Collapses syndicated copies, keeping the most informative one.
 *
 * "Most informative" is the copy with the most of the fields a price analysis
 * needs — dropping the richer copy for an earlier, emptier one would lose real
 * data to a cosmetic rule.
 */
export function dedupeSyndicated<T extends ListingLike>(listings: T[]): DedupeResult<T> {
  const best = new Map<string, T>();
  let duplicatesRemoved = 0;

  const richness = (l: ListingLike): number =>
    [l.pricePerSqm, l.price, l.area, l.rooms, l.floor, l.condition, l.sellerType]
      .filter((v) => v !== null && v !== undefined && v !== '').length;

  for (const listing of listings) {
    const key = syndicationKey(listing);
    // A listing with no identifying facts at all cannot be proven a duplicate.
    if (key.replace(/~/g, '') === '') { best.set(`unique:${best.size}`, listing); continue; }
    const existing = best.get(key);
    if (!existing) { best.set(key, listing); continue; }
    duplicatesRemoved += 1;
    if (richness(listing) > richness(existing)) best.set(key, listing);
  }

  return { unique: [...best.values()], duplicatesRemoved };
}

/* ------------------------------------------------------------------ *
 * Statistics, per tier, never across them                             *
 * ------------------------------------------------------------------ */

export interface TierStats {
  tier: GeoTier;
  sample: number;
  median: number | null;
  min: number | null;
  max: number | null;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/**
 * Per-tier statistics.
 *
 * Returns ONE entry per tier that actually has listings. There is deliberately
 * no "overall" figure anywhere in this module: the merged number is the defect,
 * and a function that produced one would be used.
 */
export function statsByTier<T extends ListingLike>(
  listings: T[],
  tierOf: (l: T) => GeoTier
): TierStats[] {
  const buckets = new Map<GeoTier, number[]>();
  for (const l of listings) {
    const pps = typeof l.pricePerSqm === 'number' && l.pricePerSqm > 0
      ? l.pricePerSqm
      : typeof l.price === 'number' && typeof l.area === 'number' && l.area > 0
        ? l.price / l.area
        : null;
    if (pps === null) continue;
    const tier = tierOf(l);
    buckets.set(tier, [...(buckets.get(tier) ?? []), Math.round(pps)]);
  }

  return TIER_ORDER
    .filter((tier) => (buckets.get(tier)?.length ?? 0) > 0)
    .map((tier) => {
      const xs = buckets.get(tier) ?? [];
      return {
        tier,
        sample: xs.length,
        median: median(xs),
        min: Math.min(...xs),
        max: Math.max(...xs),
      };
    });
}

/**
 * The tier a customer-facing headline may use.
 *
 * The most local tier with enough observations to be worth stating. Returns
 * null when no tier qualifies — and the caller then shows no headline, rather
 * than promoting the city.
 */
export function headlineTier(stats: TierStats[], minSample = 3): TierStats | null {
  for (const tier of TIER_ORDER) {
    const s = stats.find((x) => x.tier === tier);
    if (s && s.sample >= minSample && LOCAL_TIERS.includes(tier)) return s;
  }
  return null;
}
