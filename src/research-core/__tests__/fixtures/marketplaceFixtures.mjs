// FIXTURE DATA — Marketplace Search. NEVER imported by production code.
//
// Deterministic synthetic listings for unit tests and the offline browser
// harness. Every URL is on a reserved `.example` host, so nothing here can be
// mistaken for, or link to, a real listing. tests/matrix/marketplaceFixtureIsolation
// fails if any file under src/ (outside __tests__) or supabase/functions imports it.

export const FIXTURE_NOW = new Date('2026-10-03T12:00:00Z');
const minutesAgo = (m) => new Date(FIXTURE_NOW.getTime() - m * 60_000).toISOString();
const daysAgo = (d) => new Date(FIXTURE_NOW.getTime() - d * 86_400_000).toISOString();

export const FIXTURE_REQUEST = {
  contract: 'marketplace-worker-1',
  searchId: '00000000-0000-4000-8000-000000000001',
  searchPlanId: '00000000-0000-4000-8000-000000000002',
  market: 'GE', country: 'GE', city: 'Tbilisi', districts: ['Vake'],
  transactionType: 'BUY', propertyType: 'APARTMENT',
  priceMinUsd: 130000, priceMaxUsd: 170000,
  areaMinSqm: 80, areaMaxSqm: 110,
  rooms: { min: 3, max: 3 }, bedrooms: { min: 2, max: 2 }, bathrooms: null,
  buildingStatuses: ['NEW_BUILD', 'UNDER_CONSTRUCTION'], renovationPreferences: [],
  furnished: null, parking: null, mustHave: [], niceToHave: [], exclusions: [],
  searchLanguages: ['ka', 'en'], collectPriceMaxUsd: 187000, requestedAt: minutesAgo(10),
};

export function listing(over = {}) {
  const id = over.sourceListingId ?? 'x1';
  const source = over.source ?? 'source-a';
  const { seller, ...rest } = over;
  return {
    source, sourceListingId: id,
    exactUrl: `https://${source}.example/listing/${id}`, canonicalUrl: null,
    sourceName: source.toUpperCase(), sourceType: 'MARKETPLACE',
    title: 'იყიდება 3 ოთახიანი ბინა ვაკეში', description: null,
    price: 150000, currency: 'USD', pricePerSqm: null,
    country: 'GE', city: 'Tbilisi', district: 'Vake', address: null, latitude: null, longitude: null,
    propertyType: 'APARTMENT', transactionType: 'BUY',
    areaSqm: 92, rooms: 3, bedrooms: 2, bathrooms: 1, floor: 6, totalFloors: 12,
    buildingStatus: 'NEW_BUILD', renovationStatus: 'RENOVATED', constructionYear: null,
    furnished: null, parking: null, amenities: [],
    images: [`https://img.${source}.example/${id}/1.jpg`], imageHashes: [],
    publishedAt: daysAgo(3), updatedAt: null, observedAt: minutesAgo(4),
    seller: { name: null, publicPhone: null, publicEmail: null, publicProfile: null, declaredType: null, sourceListingCount: null, ...(seller ?? {}) },
    provenance: { exactUrl: `https://${source}.example/listing/${id}`, authorUrl: null, sourceUrl: `https://${source}.example` },
    evidence: [], retrievalMetadata: {},
    ...rest,
  };
}

/** The same flat on three sources: owner $162k, agency $165k, broker $181k. */
export const CONFIRMED_IDENTITY = {
  address: '12 Example Street, unit 7',
  description: 'This particular apartment has a distinctive curved living room facing the courtyard, a separate kitchen with two windows, an enclosed western balcony and original fitted cupboards beside the entrance hall. The original photos show those same fixtures and room arrangement.',
  images: [1, 2, 3].map((n) => `https://img.example/confirmed-unit-7/${n}.jpg`),
};
export const SAME_PROPERTY_THREE_SOURCES = [
  listing({ ...CONFIRMED_IDENTITY, source: 'source-a', sourceListingId: 'a-162', price: 162000, areaSqm: 92, floor: 7,
    seller: { name: 'ნინო', publicPhone: '+995 599 11 22 33', declaredType: 'OWNER', sourceListingCount: 1 } }),
  listing({ ...CONFIRMED_IDENTITY, source: 'source-b', sourceListingId: 'b-165', price: 165000, areaSqm: 92, floor: 7, observedAt: minutesAgo(8),
    seller: { name: 'Vake Realty', declaredType: 'AGENCY' } }),
  listing({ ...CONFIRMED_IDENTITY, source: 'source-c', sourceListingId: 'c-181', price: 181000, areaSqm: 92, floor: 7, observedAt: minutesAgo(12),
    seller: { name: 'Giorgi', publicPhone: '+995 577 00 00 01', declaredType: 'BROKER' } }),
];

/** One broker phone on four different properties: the "owner" claim does not survive. */
const brokerPhone = '+995 555 44 44 44';
export const BROKER_LISTINGS = [70, 84, 99, 104].map((area, i) => listing({
  source: 'source-d', sourceListingId: `d-${i}`, price: 135000 + i * 6000, areaSqm: area, floor: 2 + i,
  description: 'მესაკუთრისგან', seller: { publicPhone: brokerPhone, declaredType: 'OWNER' },
}));

export const OTHER_LISTINGS = [
  /* likely owner: owner text, unique phone, no source count */
  listing({ source: 'source-a', sourceListingId: 'a-owner2', price: 149000, areaSqm: 88, floor: 4, buildingStatus: 'UNDER_CONSTRUCTION', renovationStatus: 'WHITE_FRAME',
    description: 'იყიდება მესაკუთრისგან', seller: { publicPhone: '+995 591 12 12 12' } }),
  /* developer */
  listing({ source: 'source-e', sourceListingId: 'e-dev', price: 140000, areaSqm: 95, floor: 10, buildingStatus: 'UNDER_CONSTRUCTION', renovationStatus: 'BLACK_FRAME',
    seller: { name: 'Archi', declaredType: 'DEVELOPER' }, sourceType: 'DEVELOPER' }),
  /* agency */
  listing({ source: 'source-b', sourceListingId: 'b-agency', price: 158000, areaSqm: 101, floor: 3, seller: { name: 'Prime', declaredType: 'AGENCY' } }),
  /* stale: last observed five days ago */
  listing({ source: 'source-b', sourceListingId: 'b-stale', price: 145000, areaSqm: 86, floor: 9, observedAt: daysAgo(5) }),
  /* partial: no area, no floor, no building status */
  listing({ source: 'source-c', sourceListingId: 'c-partial', price: 155000, areaSqm: null, floor: null, buildingStatus: null, renovationStatus: null, images: [] }),
  /* slightly above the $170k maximum (+3.5%) with real advantages over in-budget options */
  listing({ source: 'source-a', sourceListingId: 'a-upgrade', price: 179000, areaSqm: 108, floor: 8, parking: true,
    amenities: ['balcony'], seller: { publicPhone: '+995 593 33 33 33', declaredType: 'OWNER', sourceListingCount: 1 } }),
  /* above the 10% ceiling: never eligible */
  listing({ source: 'source-c', sourceListingId: 'c-too-high', price: 188000, areaSqm: 109, floor: 11, parking: true }),
  /* outside the requested district */
  listing({ source: 'source-c', sourceListingId: 'c-saburtalo', price: 150000, district: 'Saburtalo' }),
  /* GEL listing, converted only with a supplied rate */
  listing({ source: 'source-e', sourceListingId: 'e-gel', price: 405000, currency: 'GEL', areaSqm: 90, floor: 5 }),
];

export const ALL_FIXTURE_LISTINGS = [...SAME_PROPERTY_THREE_SOURCES, ...BROKER_LISTINGS, ...OTHER_LISTINGS];

export const fixtureCandidates = (list = ALL_FIXTURE_LISTINGS) =>
  list.map((candidate) => ({ workerId: `${candidate.source}-worker`, candidate }));

/** Worker run states for lifecycle tests. */
export const WORKER_RUNS = {
  complete: { workerId: 'source-a-worker', status: 'COMPLETE', deadlineAt: minutesAgo(-5), returnedCount: 6 },
  failed: { workerId: 'source-f-worker', status: 'FAILED', deadlineAt: minutesAgo(-5), returnedCount: 0 },
  searching: { workerId: 'source-b-worker', status: 'SEARCHING', deadlineAt: minutesAgo(-5), returnedCount: 0 },
  overdue: { workerId: 'source-g-worker', status: 'SEARCHING', deadlineAt: minutesAgo(1), returnedCount: 0 },
};

/** A deterministic large set: `n` listings over `n/3` physical flats, with cross-posts. */
export function largeFixture(n = 1000) {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const districts = ['Vake', 'Saburtalo', 'Mtatsminda', 'Vera', 'Didube'];
  const flats = Math.ceil(n / 3);
  const out = [];
  for (let i = 0; i < n; i++) {
    const flat = i % flats;
    const area = 60 + (flat % 70);
    const base = 90000 + (flat * 997) % 120000;
    out.push(listing({
      ...CONFIRMED_IDENTITY,
      address: `${flat + 1} Example Street, unit ${flat + 1}`,
      images: [1, 2, 3].map((n) => `https://img.example/flat-${flat}/${n}.jpg`),
      source: `source-${'abcdef'[i % 6]}`,
      sourceListingId: `L${i}`,
      price: Math.round(base * (1 + (rnd() - 0.5) * 0.06)),
      areaSqm: area,
      rooms: 2 + (flat % 3),
      bedrooms: 1 + (flat % 3),
      floor: 1 + (flat % 15),
      district: districts[flat % districts.length],
      buildingStatus: flat % 4 === 0 ? 'OLD_BUILD' : 'NEW_BUILD',
      observedAt: minutesAgo(1 + (i % 50)),
      seller: { publicPhone: `+995 5${String(10000000 + (flat % 400)).slice(0, 8)}`, declaredType: i % 5 === 0 ? 'OWNER' : null },
    }));
  }
  return out;
}

/** What OpenAI call 1 returns for the spec's complete Georgian example. */
export const COMPLETE_TEXT = 'ვაკეში მინდა საყიდლად 2 საძინებლიანი, 3 ოთახიანი ბინა, 80 დან 110 მ² მდე, ახალაშენებულ ან მშენებარე კორპუსში. ბიუჯეტი $120,000 დან $160,000 მდე.';
export const COMPLETE_MODEL_OUTPUT = {
  transactionType: 'BUY', propertyType: 'APARTMENT', country: 'GE', city: null, districts: ['ვაკე'], locationPreferences: [],
  priceMinUsd: 120000, priceMaxUsd: 160000, priceCurrencyStated: 'USD', areaMinSqm: 80, areaMaxSqm: 110,
  roomsMin: 3, roomsMax: 3, bedroomsMin: 2, bedroomsMax: 2, bathroomsMin: null,
  buildingStatuses: ['NEW_BUILD', 'UNDER_CONSTRUCTION'], renovationPreferences: [], furnished: null, parking: null,
  floorPreferences: [], mustHave: [], niceToHave: [], exclusions: [], userLanguage: 'ka', relevantSearchLanguages: ['ka', 'en', 'ru'], proposals: [],
};

/** And for the incomplete one. */
export const INCOMPLETE_TEXT = 'ვაკეში მინდა კარგი 2 საძინებლიანი ბინა';
export const INCOMPLETE_MODEL_OUTPUT = {
  ...COMPLETE_MODEL_OUTPUT,
  transactionType: null, priceMinUsd: null, priceMaxUsd: null, priceCurrencyStated: null, areaMinSqm: null, areaMaxSqm: null,
  roomsMin: null, roomsMax: null, buildingStatuses: [], proposals: [],
};
