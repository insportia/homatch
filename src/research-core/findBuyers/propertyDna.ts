// PROPERTY SEARCH DNA — the owner's property as a search target, built only
// from stored fields. A missing field stays missing (listed in `missing`) and
// is never guessed; tolerances turn exact facts into comparable bands.

export interface PropertyFactsInput {
  transactionType?: string | null;
  propertyType?: string | null;
  countryCode?: string | null;
  city?: string | null;
  district?: string | null;
  neighborhood?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  totalPrice?: number | null;
  currency?: string | null;
  area?: number | null;
  rooms?: number | null;
  bedrooms?: number | null;
  floor?: number | null;
  totalFloors?: number | null;
  condition?: string | null;
  buildingType?: string | null;
  newBuild?: boolean | null;
  parking?: boolean | null;
  balcony?: boolean | null;
  terrace?: boolean | null;
  elevator?: boolean | null;
  furnished?: boolean | null;
  view?: string | null;
}

export interface Band { min: number; max: number }

export interface PropertyDna {
  version: 1;
  transaction: 'SALE' | 'RENT';
  counterpart: 'BUYER' | 'TENANT';
  countryCode: string;
  city: string | null;
  district: string | null;
  neighborhood: string | null;
  coordinates: { lat: number; lng: number } | null;
  propertyType: string | null;
  bedrooms: number | null;
  rooms: number | null;
  areaSqm: number | null;
  price: number | null;
  currency: string | null;
  pricePerSqm: number | null;
  condition: string | null;
  buildingType: string | null;
  newBuild: boolean | null;
  floor: number | null;
  amenities: string[];
  view: string | null;
  tolerances: {
    area: Band | null;
    price: Band | null;
    bedrooms: Band | null;
  };
  /** Fields that would sharpen the search but are not stored. */
  missing: string[];
  /** Stable key for caching query plans: same DNA → same plan. */
  dnaKey: string;
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return v === null || v === undefined || v === '' || !Number.isFinite(n) || n <= 0 ? null : n;
};
const str = (v: unknown): string | null => {
  const s = v == null ? '' : String(v).trim();
  return s ? s : null;
};

/** Rentals move on price more than sales; both get a band, never equality. */
export function toleranceBands(input: { transaction: 'SALE' | 'RENT'; areaSqm: number | null; price: number | null; bedrooms: number | null }) {
  const area = input.areaSqm ? { min: Math.round(input.areaSqm * 0.8), max: Math.round(input.areaSqm * 1.2) } : null;
  const pf = input.transaction === 'RENT' ? 0.25 : 0.2;
  const price = input.price ? { min: Math.round(input.price * (1 - pf)), max: Math.round(input.price * (1 + pf)) } : null;
  const bedrooms = input.bedrooms != null ? { min: Math.max(0, input.bedrooms - 1), max: input.bedrooms + 1 } : null;
  return { area, price, bedrooms };
}

export function buildPropertyDna(f: PropertyFactsInput): PropertyDna {
  const tx = String(f.transactionType ?? '').toLowerCase();
  const transaction: 'SALE' | 'RENT' = tx.includes('rent') || tx.includes('lease') ? 'RENT' : 'SALE';
  const areaSqm = num(f.area);
  const price = num(f.totalPrice);
  const bedrooms = f.bedrooms != null && Number.isFinite(Number(f.bedrooms)) && Number(f.bedrooms) >= 0 ? Number(f.bedrooms) : null;
  const rooms = num(f.rooms);
  const amenities = ([
    ['parking', f.parking], ['balcony', f.balcony], ['terrace', f.terrace], ['elevator', f.elevator], ['furnished', f.furnished],
  ] as Array<[string, boolean | null | undefined]>).filter(([, v]) => v === true).map(([k]) => k);
  const lat = num(f.latitude); const lng = num(f.longitude);
  const city = str(f.city); const district = str(f.district);
  const propertyType = str(f.propertyType)?.toUpperCase() ?? null;
  const missing = ([
    ['city', city], ['propertyType', propertyType], ['price', price], ['area', areaSqm],
    ['bedrooms', bedrooms ?? rooms], ['district', district],
  ] as Array<[string, unknown]>).filter(([, v]) => v === null || v === undefined).map(([k]) => k);
  const dna: Omit<PropertyDna, 'dnaKey'> = {
    version: 1,
    transaction,
    counterpart: transaction === 'RENT' ? 'TENANT' : 'BUYER',
    countryCode: (str(f.countryCode) ?? 'GE').toUpperCase(),
    city,
    district,
    neighborhood: str(f.neighborhood),
    coordinates: lat && lng ? { lat, lng } : null,
    propertyType,
    bedrooms,
    rooms,
    areaSqm,
    price,
    currency: str(f.currency)?.toUpperCase() ?? null,
    pricePerSqm: price && areaSqm && transaction === 'SALE' ? Math.round(price / areaSqm) : null,
    condition: str(f.condition),
    buildingType: str(f.buildingType),
    newBuild: typeof f.newBuild === 'boolean' ? f.newBuild : null,
    floor: f.floor != null && Number.isFinite(Number(f.floor)) ? Number(f.floor) : null,
    amenities,
    view: str(f.view),
    tolerances: toleranceBands({ transaction, areaSqm, price, bedrooms }),
    missing,
  };
  return { ...dna, dnaKey: dnaKeyOf(dna) };
}

/** Coarse on purpose: two flats that would be searched identically share a key. */
export function dnaKeyOf(d: Pick<PropertyDna, 'transaction' | 'countryCode' | 'city' | 'district' | 'propertyType' | 'bedrooms' | 'areaSqm' | 'price'>): string {
  const bucket = (v: number | null, step: number) => (v == null ? 'x' : String(Math.round(v / step)));
  return [
    d.transaction, d.countryCode, (d.city ?? 'x').toLowerCase(), (d.district ?? 'x').toLowerCase(),
    d.propertyType ?? 'x', d.bedrooms ?? 'x', bucket(d.areaSqm, 15), bucket(d.price, d.transaction === 'RENT' ? 200 : 20000),
  ].join('|');
}
