// HOMATCH VERIFY — assembling the ResearchSeed from what the run already knows.
//
// The pipeline establishes a great deal before market research begins: a
// cadastral code, an address, a project, a developer, an asset class, whatever
// the customer typed. Until now the only consumer of most of that was a prompt
// paragraph, so a model was told the district and then went looking for it.
//
// This turns those same facts into structured values a portal filter can take.
// Nothing here researches anything; it reads what is already in the job.
//
// EVERY FIELD CARRIES WHERE IT CAME FROM
//
// A district taken from a reconciled identity with three independent sources
// and a district guessed from free text are not the same claim, and the
// envelope's rationale has to be able to say which one it used. That is why
// every value is a SeedValue and not a bare string.
//
// WHAT IS DELIBERATELY NOT READ
//
// Ownership, encumbrances and rights. They are re-read on every verification
// by design, they say nothing about which flats are comparable, and carrying
// them into a market query would be both useless and a privacy mistake.

import {
  emptySeed,
  seeded,
  type ResearchSeed,
  type SeedValue,
} from '../research-core/plan/seed.ts';
import type { ResearchLanguage } from '../research-core/discovery/lexicon.ts';
import { districtOfAddress, cityOfAddress } from './intelligence/locationIntelligence.ts';

/** The Georgian market is researched in these, regardless of UI language. */
export const GE_RESEARCH_LANGUAGES: ResearchLanguage[] = ['ka', 'en', 'ru'];

const text = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
};

const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const parsed = Number(v.replace(/[^\d.,-]/g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

/**
 * Pull structured hints out of what the customer actually typed.
 *
 * This is the weakest source in the seed and is marked as such — free text is
 * evidence of intent, not of fact. It matters because in property mode it is
 * frequently the ONLY place the unit's own area and room count appear: a
 * registry knows a building's total area, not which flat is 97m².
 */
export interface QueryHints {
  areaSqm: number | null;
  rooms: number | null;
  bedrooms: number | null;
  floor: number | null;
  transaction: 'SALE' | 'RENT' | 'UNKNOWN';
}

export function parseQueryHints(query: string | null | undefined): QueryHints {
  const q = String(query ?? '');
  const hints: QueryHints = {
    areaSqm: null,
    rooms: null,
    bedrooms: null,
    floor: null,
    transaction: 'UNKNOWN',
  };
  if (!q.trim()) return hints;

  // "97.2 m²", "97,2 კვ.მ", "97 sqm", "97 кв.м"
  const area = q.match(
    /(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:m²|m2|sq\.?\s?m|sqm|кв\.?\s?м|კვ\.?\s?მ)/i,
  );
  if (area) {
    const value = Number(area[1].replace(',', '.'));
    // A plausibility bound, not a guess: below it the number is not an area.
    if (Number.isFinite(value) && value >= 8 && value <= 20_000) hints.areaSqm = value;
  }

  const bedrooms = q.match(/(\d{1,2})\s*(?:bed|bedroom|br\b|საძინებ|спальн)/i);
  if (bedrooms) hints.bedrooms = Number(bedrooms[1]);

  const rooms = q.match(/(\d{1,2})\s*(?:room|rooms|otaxi|ოთახ|комнат)/i);
  if (rooms) hints.rooms = Number(rooms[1]);

  const floor = q.match(/(?:floor|სართულ|этаж)\s*[:№#]?\s*(\d{1,3})/i);
  if (floor) hints.floor = Number(floor[1]);

  /*
   * NO \b BEFORE A NON-LATIN ALTERNATIVE.
   *
   * JavaScript's \b is defined against [A-Za-z0-9_], so a Georgian or
   * Cyrillic letter is a non-word character and a pattern that opens with
   * \b followed by one can never match. Every Georgian rental query
   * silently returned UNKNOWN, and the lane then searched the sale side of
   * a market the customer had asked about renting.
   *
   * The Latin words keep their boundaries; the others are matched as bare
   * substrings, which is what an agglutinative language needs anyway -- the
   * Georgian for "is for rent" contains the stem rather than equalling it.
   */
  if (/\b(rent|rental)\b/i.test(q) || /(ქირა|аренд|сним)/i.test(q)) {
    hints.transaction = 'RENT';
  } else if (/\b(sale|buy|purchase)\b/i.test(q) || /(იყიდება|прода|купит)/i.test(q)) {
    hints.transaction = 'SALE';
  }

  return hints;
}

/** What the seed builder reads. Plain data, so this stays testable. */
export interface SeedInput {
  jobId: string;
  query: string | null | undefined;
  mode: 'property' | 'cadastral' | string | null | undefined;
  /** research_jobs.result_json as accumulated so far. */
  result: Record<string, any> | null | undefined;
  /**
   * Facts already held about this subject and its lineage, as fact_key →
   * value. Only CURRENT, fresh ones should be passed in.
   */
  knownFacts?: Record<string, string | number | null> | null;
  /** A linked Homatch property record, when the run started from one. */
  property?: Record<string, any> | null;
}

function firstSeed<T>(...candidates: Array<SeedValue<T> | null>): SeedValue<T> | null {
  for (const candidate of candidates) if (candidate) return candidate;
  return null;
}

/**
 * Build the seed.
 *
 * Ordered by strength: a registry-confirmed value beats a reconciled one,
 * which beats a stage's own claim, which beats free text. The first non-null
 * wins, and the winner's origin travels with it.
 */
export function buildResearchSeed(input: SeedInput): ResearchSeed {
  const seed = emptySeed(input.jobId);
  const r = input.result ?? {};
  const identity = r.identity ?? {};
  const reconciled = r.reconciledIdentity ?? {};
  const project = r.projectProfile ?? identity.project ?? {};
  const company = r.companyProfile ?? {};
  const parent = r.identifiedParent ?? identity.identifiedParent ?? {};
  const hints = parseQueryHints(input.query);
  const known = input.knownFacts ?? {};
  const property = input.property ?? {};

  // ── identity ────────────────────────────────────────────────────────────
  seed.property.cadastralCode = firstSeed(
    seeded(text(r.exactUnit?.code), 'SAME_PROPERTY', 'exactUnit'),
    seeded(text(identity.exactUnit?.code), 'SAME_PROPERTY', 'identity.exactUnit'),
    seeded(text(known['parcel.code']), 'SAME_PROPERTY', 'graph:parcel.code'),
    seeded(input.mode === 'cadastral' ? text(input.query) : null, 'SAME_PROPERTY', 'query'),
  );
  seed.property.parentCadastralCode = seeded(
    text(parent.code),
    'SAME_BUILDING',
    'identifiedParent',
  );

  // ── location ────────────────────────────────────────────────────────────
  const address = firstSeed(
    seeded(text(reconciled.address), 'SAME_PROPERTY', 'reconciledIdentity'),
    seeded(text(project.address), 'SAME_PROJECT', 'projectProfile'),
    seeded(text(parent.address), 'SAME_BUILDING', 'identifiedParent'),
    seeded(text(known['address.full']), 'SAME_PROPERTY', 'graph:address.full'),
    seeded(text(property.address), 'SAME_PROPERTY', 'property'),
  );
  seed.location.address = address;

  const addressText = address?.value ?? null;
  seed.location.city = firstSeed(
    seeded(text(property.city), 'SAME_PROPERTY', 'property'),
    seeded(addressText ? cityOfAddress(addressText) ?? null : null, address?.evidence ?? 'DISTRICT', `city from ${address?.origin ?? 'address'}`),
    seeded(input.query ? cityOfAddress(input.query) ?? null : null, 'DISTRICT', 'query'),
  );
  seed.location.district = firstSeed(
    seeded(text(property.district), 'SAME_PROPERTY', 'property'),
    seeded(addressText ? districtOfAddress(addressText) ?? null : null, address?.evidence ?? 'DISTRICT', `district from ${address?.origin ?? 'address'}`),
    seeded(input.query ? districtOfAddress(input.query) ?? null : null, 'DISTRICT', 'query'),
  );
  // The portal taxonomy calls Vake a sub-district of Vake-Saburtalo. Homatch's
  // own district vocabulary is at that same granularity, so the value serves
  // as both and the adapter resolves whichever the portal recognises.
  seed.location.subDistrict = seed.location.district;
  seed.location.countryCode = seeded('GE', 'DISTRICT', 'market');

  // ── the property itself ─────────────────────────────────────────────────
  seed.property.propertyType = firstSeed(
    seeded(text(property.property_type), 'SAME_PROPERTY', 'property'),
    seeded(assetClassToType(identity.assetClass), 'SAME_PROPERTY', 'identity.assetClass'),
    seeded(text(known['property.assetClass']), 'SAME_PROPERTY', 'graph:property.assetClass'),
  );
  seed.property.areaSqm = firstSeed(
    seeded(num(property.area_sqm ?? property.area), 'SAME_PROPERTY', 'property'),
    seeded(num(known['listing.area']), 'SAME_PROPERTY', 'graph:listing.area'),
    seeded(hints.areaSqm, 'SAME_PROPERTY', 'query text'),
  );
  seed.property.bedrooms = firstSeed(
    seeded(num(property.bedrooms), 'SAME_PROPERTY', 'property'),
    seeded(hints.bedrooms, 'SAME_PROPERTY', 'query text'),
  );
  seed.property.rooms = firstSeed(
    seeded(num(property.rooms), 'SAME_PROPERTY', 'property'),
    seeded(num(known['listing.rooms']), 'SAME_PROPERTY', 'graph:listing.rooms'),
    seeded(hints.rooms, 'SAME_PROPERTY', 'query text'),
  );
  seed.property.floor = firstSeed(
    seeded(num(property.floor), 'SAME_PROPERTY', 'property'),
    seeded(num(known['listing.floor']), 'SAME_PROPERTY', 'graph:listing.floor'),
    seeded(hints.floor, 'SAME_PROPERTY', 'query text'),
  );
  seed.property.totalFloors = seeded(num(project.floors), 'SAME_PROJECT', 'projectProfile');
  seed.property.transaction =
    hints.transaction !== 'UNKNOWN'
      ? hints.transaction
      : identity.assetClass === 'RENTAL'
        ? 'RENT'
        : 'SALE';

  // ── project and developer ───────────────────────────────────────────────
  seed.project.name = firstSeed(
    seeded(text(reconciled.project), 'SAME_PROJECT', 'reconciledIdentity'),
    seeded(text(project.name), 'SAME_PROJECT', 'projectProfile'),
    seeded(text(known['project.identity']), 'SAME_PROJECT', 'graph:project.identity'),
  );
  seed.project.aliases = uniqueStrings([
    ...(Array.isArray(project.aliases) ? project.aliases : []),
    ...splitList(known['project.aliases']),
  ]);
  seed.project.developerName = firstSeed(
    seeded(text(reconciled.developer), 'SAME_PROJECT', 'reconciledIdentity'),
    seeded(text(project.developer), 'SAME_PROJECT', 'projectProfile'),
  );
  seed.project.developerCompanyName = firstSeed(
    seeded(text(company.name), 'SAME_PROJECT', 'companyProfile'),
    seeded(text(project.developerCompany), 'SAME_PROJECT', 'projectProfile'),
  );
  seed.project.developerCompanyId = seeded(text(company.idCode), 'SAME_PROJECT', 'companyProfile');
  seed.project.urls = uniqueStrings([
    text(project.website),
    ...(Array.isArray(r.sources) ? r.sources.map((s: any) => text(s?.url)) : []),
  ]).slice(0, 12);

  // ── the rest ────────────────────────────────────────────────────────────
  seed.knownListingUrls = uniqueStrings([
    text(property.source_url),
    ...(Array.isArray(r.market?.comparables)
      ? r.market.comparables.map((c: any) => text(c?.url))
      : []),
  ]).slice(0, 25);
  seed.languages = GE_RESEARCH_LANGUAGES;
  seed.establishedFactKeys = Object.keys(known).sort();

  return seed;
}

function assetClassToType(assetClass: unknown): string | null {
  const value = String(assetClass ?? '').toUpperCase();
  if (value === 'APARTMENT_IN_PROJECT' || value === 'PRIVATE_RESALE' || value === 'RENTAL') {
    return 'APARTMENT';
  }
  if (value === 'PRIVATE_HOUSE') return 'HOUSE';
  if (value === 'LAND') return 'LAND';
  if (value === 'COMMERCIAL') return 'COMMERCIAL';
  // UNDER_CONSTRUCTION, COMPANY_OWNED and MIXED_OR_UNKNOWN genuinely do not
  // say what kind of property this is. Returning null keeps the envelope open
  // rather than asserting a type nothing established.
  return null;
}

function splitList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => text(v)).filter((v): v is string => v !== null);
  const single = text(value);
  if (!single) return [];
  return single
    .split(/[;|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const cleaned = text(value);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}
