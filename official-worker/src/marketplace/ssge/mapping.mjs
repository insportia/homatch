import { flattenLocations } from './vendor/locations.mjs';
import { placeAliases } from './place-aliases.mjs';
const fold = value => String(value).trim().toLowerCase().replace(/\s+/g, ' ');
function matches(title, input) {
  const a = fold(title), b = fold(input);
  return a === b || placeAliases.some(row => row.map(fold).includes(a) && row.map(fold).includes(b));
}
const types = { APARTMENT: 'apartment', HOUSE: 'house', LAND: 'land', COMMERCIAL: 'commercial' };
const deals = { BUY: 'sale', MONTHLY_RENT: 'monthly_rent', DAILY_RENT: 'daily_rent' };
function counts(range) {
  if (!range) return undefined;
  const min = range.min ?? 1, max = range.max ?? 10;
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min || min > 10) throw Error('Unsupported source count range');
  return Array.from({ length: Math.min(10, max) - min + 1 }, (_, i) => min + i);
}
export function ssgeCriteria(request, locations) {
  if (request.contract !== 'marketplace-worker-1' || !['GE', 'Georgia'].includes(request.country)
    || !types[request.propertyType] || !deals[request.transactionType]) throw Error('Unsupported SS.ge request');
  const rows = flattenLocations(locations);
  const cities = rows.filter(r => r.kind === 'city' && matches(r.title, request.city));
  if (cities.length !== 1) throw Error('Unknown or ambiguous SS.ge city');
  const city = cities[0], subdistricts = new Set(), unresolved = [];
  /*
   * A district SS.ge does not know (or one with no child locations) no longer ends
   * the whole source with nothing (production search 645ba0d0, 2026-10-16): the city
   * is read instead and the results pipeline checks the district per listing, exactly
   * as for the portals that cannot filter districts. A partial set is never sent —
   * it would silently drop listings in the district SS.ge could not resolve.
   * A name that is both a district and a neighbourhood is the same place: the district
   * (with all its neighbourhoods) wins.
   */
  for (const name of request.districts ?? []) {
    let selected = rows.filter(r => r.cityId === city.id && ['district', 'subdistrict'].includes(r.kind) && matches(r.title, name));
    if (selected.length > 1 && selected.some(r => r.kind === 'district')) selected = selected.filter(r => r.kind === 'district');
    if (!selected.length) { unresolved.push(name); continue; }
    for (const r of selected) {
      if (r.kind === 'subdistrict') { subdistricts.add(r.id); continue; }
      const children = rows.filter(s => s.kind === 'subdistrict' && s.parentId === r.id && s.cityId === city.id);
      if (!children.length) { unresolved.push(name); continue; }
      children.forEach(s => subdistricts.add(s.id));
    }
  }
  if (unresolved.length) subdistricts.clear();
  const ceiling = request.collectPriceMaxUsd ?? request.priceMaxUsd;
  if (!Number.isFinite(ceiling) || ceiling > request.priceMaxUsd * 1.1 + 0.01) throw Error('Invalid acquisition budget ceiling');
  const criteria = { transactionType: deals[request.transactionType], propertyType: types[request.propertyType], city: city.id,
    ...(subdistricts.size ? { subdistricts: [...subdistricts] } : {}), priceMinUsd: request.priceMinUsd, priceMaxUsd: ceiling,
    ...(request.areaMinSqm != null ? { areaMinSqm: request.areaMinSqm } : {}),
    ...(request.areaMaxSqm != null ? { areaMaxSqm: request.areaMaxSqm } : {}),
    ...(request.rooms ? { rooms: counts(request.rooms) } : {}), ...(request.bedrooms ? { bedrooms: counts(request.bedrooms) } : {}),
    ...(request.furnished === true ? { furnished: true } : {}) };
  /* Not sent to SS.ge (non-enumerable): which districts it could not resolve, for the report. */
  if (unresolved.length) Object.defineProperty(criteria, 'districtFallback', { value: unresolved, enumerable: false });
  return criteria;
  // Unproven source filters are not invented. All hard constraints and preferences
  // still go through HOMATCH's authoritative downstream evidence/filter pipeline.
}
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
export function ssgeCandidate(listing, detail, request, page) {
  const n = detail, raw = n.raw;
  const coords = number(n.latitude) !== null && number(n.longitude) !== null && Math.abs(n.latitude) <= 90 && Math.abs(n.longitude) <= 180;
  return { source: 'ss-ge', sourceListingId: n.sourceListingId, exactUrl: listing.exactUrl, canonicalUrl: listing.exactUrl,
    sourceName: 'SS.ge', sourceType: 'MARKETPLACE', title: text(n.title), description: text(n.description)?.slice(0, 12000) ?? null,
    price: number(n.price), currency: n.currency, pricePerSqm: null, country: 'Georgia', city: text(n.city),
    district: text(n.subdistrict) ?? text(n.district), address: [n.street, n.address].filter(Boolean).join(' ') || null,
    latitude: coords ? n.latitude : null, longitude: coords ? n.longitude : null,
    propertyType: Object.entries(types).find(([, value]) => value === n.propertyType)?.[0] ?? null,
    transactionType: Object.entries(deals).find(([, value]) => value === n.transactionType)?.[0] ?? null,
    areaSqm: number(n.area), rooms: number(n.rooms), bedrooms: number(n.bedrooms), bathrooms: null,
    floor: number(n.floor), totalFloors: number(n.totalFloors), buildingStatus: null, renovationStatus: null, constructionYear: null,
    furnished: typeof n.furnished === 'boolean' ? n.furnished : null, parking: null,
    amenities: Object.entries(n.amenities ?? {}).filter(([key, value]) => value === true && ['balcony', 'elevator', 'garage', 'storage'].includes(key)).map(([key]) => key),
    images: [...new Set([...(listing.images ?? []), ...(n.images ?? [])])].slice(0, 24), imageHashes: [],
    publishedAt: n.publishedAt, updatedAt: n.updatedAt, observedAt: n.observedAt,
    seller: { name: text(raw.agencyName) ?? text(raw.contactPerson), publicPhone: null, publicEmail: null, publicProfile: null,
      declaredType: text(raw.agencyName) ? 'AGENCY' : null, sourceListingCount: number(raw.userApplicationCount) },
    provenance: { exactUrl: listing.exactUrl, authorUrl: null, sourceUrl: 'https://home.ss.ge/ka/udzravi-qoneba' },
    evidence: [{ field: 'sourceIdentity', text: `SS.ge applicationId=${n.sourceListingId}; individual page identity verified` },
      ...['condition', 'buildingStatus'].filter(key => text(n[key])).map(key => ({ field: 'sourceFeature', text: `${key}: ${n[key]}`.slice(0, 500) }))],
    retrievalMetadata: { acquisition: 'SSGE_ACCEPTED_STANDALONE', page, ...n.provenance.locationIds,
      districtSource: text(n.district), subdistrictSource: text(n.subdistrict), sourceOrderDate: text(raw.orderDate),
      conditionSource: text(n.condition), buildingStatusSource: text(n.buildingStatus), yardAreaSqm: number(n.yardArea),
      requestedSearchId: request.searchId } };
}
