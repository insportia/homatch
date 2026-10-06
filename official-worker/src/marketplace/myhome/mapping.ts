import { URL } from 'node:url';
import type { ExternalListingCandidate, MarketplaceSearchRequest, BuildingStatus, RenovationStatus } from '../contract.js';
import { apiUrl, resolveLocation } from './api.js';
import { normalizeListing, normalizeRoomCount } from './next-data.js';

type Dictionary = { id: number; display_name: string; slug?: string };
const deals = { BUY: 1, MONTHLY_RENT: 2, DAILY_RENT: 7 };
const properties: Record<string, number> = { APARTMENT: 1, HOUSE: 2, LAND: 4, COMMERCIAL: 5 };
const statusLabels: Record<BuildingStatus, string> = { OLD_BUILD: 'ძველი აშენებული', NEW_BUILD: 'ახალი აშენებული', UNDER_CONSTRUCTION: 'მშენებარე' };
const conditionLabels: Record<RenovationStatus, string[]> = { RENOVATED: ['ახალი გარემონტებული', 'ძველი გარემონტებული'], GREEN_FRAME: ['მწვანე კარკასი'], WHITE_FRAME: ['თეთრი კარკასი', 'თეთრი პლიუსი'], BLACK_FRAME: ['შავი კარკასი'], NEEDS_RENOVATION: ['სარემონტო'] };
function idsForLabels(rows: Dictionary[], labels: string[]) {
  return labels.map(label => { const matches = rows.filter(row => row.display_name === label); if (matches.length !== 1) throw new Error(`Dictionary mapping unavailable: ${label}`); return matches[0].id; });
}
function rangeIds(rows: Dictionary[], range: MarketplaceSearchRequest['rooms']) {
  if (!range) return [];
  if (range.min !== null && range.max !== null && range.min > range.max) throw new Error('Invalid count range');
  return rows.filter(row => {
    const match = /^(\d+)(\+)?$/.exec(row.display_name);
    if (!match) return false;
    const low = Number(match[1]), high = match[2] ? Infinity : low;
    return high >= (range.min ?? 0) && low <= (range.max ?? Infinity);
  }).map(row => row.id);
}
export function buildQueries(request: MarketplaceSearchRequest, locations: any, filters: any) {
  if (request.contract !== 'marketplace-worker-1' || !['Georgia', 'GE'].includes(request.country) || !properties[request.propertyType]) throw new Error('Unsupported MyHome request');
  const property = properties[request.propertyType], transaction = deals[request.transactionType];
  const d = filters?.data;
  if (!d || !d.real_estate_types?.some((row: Dictionary) => row.id === property) || !d.deal_types?.some((row: Dictionary) => row.id === transaction)) throw new Error('Invalid MyHome filter dictionary');
  const base = { transaction, property, city: request.city, currency: 'USD' as const,
    minPrice: request.priceMinUsd, maxPrice: request.collectPriceMaxUsd ?? request.priceMaxUsd,
    minArea: request.areaMinSqm ?? undefined, maxArea: request.areaMaxSqm ?? undefined };
  return (request.districts.length ? request.districts : [undefined]).map(district => {
    const criteria = resolveLocation({ ...base, district }, locations);
    const url = new URL(apiUrl(criteria));
    const add = (key: string, ids: number[]) => { ids.forEach((id, index) => url.searchParams.set(`${key}[${index}]`, String(id))); };
    for (const [key, range] of [['room_types', request.rooms], ['bedroom_types', request.bedrooms], ['bathroom_types', request.bathrooms]] as const) {
      if (!range || range.min === null && range.max === null) continue;
      const ids = rangeIds(d[key] ?? [], range);
      // An unrepresentable range must fail explicitly, never become an unfiltered search.
      if (!ids.length) throw new Error(`No supported values for ${key}`);
      add(key, ids);
    }
    if (request.buildingStatuses.length) add('statuses', idsForLabels(d.statuses?.[property] ?? [], request.buildingStatuses.map(value => statusLabels[value])));
    if (request.renovationPreferences.length) add('conditions', idsForLabels(d.conditions?.[property] ?? [], request.renovationPreferences.flatMap(value => conditionLabels[value])));
    if (request.parking !== null) {
      const rows: Dictionary[] = d.parking_types ?? [];
      const noParking = idsForLabels(rows, ['პარკინგის გარეშე']);
      add('parking_types', request.parking ? rows.filter(row => !noParking.includes(row.id)).map(row => row.id) : noParking);
    }
    // Negative attributes cannot safely be expressed by presence-only attrs. Preserve
    // them for HOMATCH's existing hard filters, with unknown remaining unknown.
    if (request.furnished === true) {
      const rows = d.statement_parameters?.[property] ?? [];
      const furniture = rows.filter((row: any) => row.svg_file_name === 'furniture-equipment');
      if (furniture.length !== 1) throw new Error('Furniture dictionary mapping unavailable');
      url.searchParams.append(`attrs[${furniture[0].type}][]`, String(furniture[0].id));
    }
    return { criteria, url: url.href };
  });
}
const number = (v: unknown): number | null => v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
const text = (v: unknown): string | null => typeof v === 'string' && v.trim() ? v.slice(0, 8000) : null;
function count(raw: any, key: string, rows: Dictionary[]) { return normalizeRoomCount(raw[key] ?? rows?.find(row => row.id === raw[`${key}_type_id`])?.display_name); }
function knownDate(v: unknown) {
  // MyHome's naive timestamps are Georgian local time, not host-local/UTC.
  if (typeof v !== 'string') return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v) ? v.replace(' ', 'T') + '+04:00' : v;
  return Number.isFinite(Date.parse(iso)) ? new Date(iso).toISOString() : null;
}
export function candidateFromMyHome(raw: any, filters: any, sourceUrl: string, observedAt = new Date().toISOString()): ExternalListingCandidate {
  const listing = normalizeListing(raw), d = filters?.data;
  const rooms = count(raw, 'room', d?.room_types), bedrooms = count(raw, 'bedroom', d?.bedroom_types);
  const bathrooms = count(raw, 'bathroom', d?.bathroom_types);
  const status = d?.statuses?.[raw.real_estate_type_id]?.find((r: Dictionary) => r.id === raw.status_id)?.display_name;
  const condition = d?.conditions?.[raw.real_estate_type_id]?.find((r: Dictionary) => r.id === raw.condition_id)?.display_name;
  const buildingStatus = (Object.entries(statusLabels).find(([, label]) => label === status)?.[0] ?? null) as BuildingStatus | null;
  const renovationStatus = (Object.entries(conditionLabels).find(([, labels]) => labels.includes(condition))?.[0] ?? null) as RenovationStatus | null;
  const parameters: any[] = Array.isArray(raw.parameters) ? raw.parameters : [];
  const has = (icon: string) => parameters.some(row => row.svg_file_name === icon);
  const parkingLabel = d?.parking_types?.find((row: Dictionary) => row.id === raw.parking_type_id)?.display_name;
  const parking = parkingLabel ? parkingLabel !== 'პარკინგის გარეშე' : null;
  const furnished = has('furniture-equipment') ? true : null;
  const icons: Record<string, string> = { elevator: 'ELEVATOR', conditioner: 'AIR_CONDITIONING', 'furniture-equipment': 'FURNISHED', 'swimming-pool-open': 'POOL', 'swimming-pool-closed': 'POOL' };
  const amenities = [...new Set(parameters.map(row => icons[row.svg_file_name]).filter(Boolean))];
  if (parking === true) amenities.push('PARKING');
  if (number(raw.balconies) !== null && Number(raw.balconies) > 0) amenities.push('BALCONY');
  const lat = listing.latitude, lng = listing.longitude;
  const validCoords = lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  return {
    source: 'myhome-ge', sourceListingId: listing.source_id, exactUrl: listing.source_url, canonicalUrl: null,
    sourceName: 'MyHome', sourceType: 'MARKETPLACE', title: listing.title, description: text(raw.comment),
    price: listing.price, currency: listing.currency, pricePerSqm: number(raw.price?.['2']?.price_square),
    country: 'Georgia', city: listing.city, district: text(raw.urban_name) ?? listing.district, address: listing.address,
    latitude: validCoords ? lat : null, longitude: validCoords ? lng : null,
    propertyType: ({ 1: 'APARTMENT', 2: 'HOUSE', 4: 'LAND', 5: 'COMMERCIAL' } as const)[raw.real_estate_type_id as 1] ?? null,
    transactionType: ({ 1: 'BUY', 2: 'MONTHLY_RENT', 7: 'DAILY_RENT' } as const)[raw.deal_type_id as 1] ?? null,
    areaSqm: listing.area_m2, rooms: typeof rooms === 'number' ? rooms : null, bedrooms: typeof bedrooms === 'number' ? bedrooms : null,
    bathrooms: typeof bathrooms === 'number' ? bathrooms : null, floor: number(raw.floor), totalFloors: number(raw.total_floors),
    buildingStatus, renovationStatus, constructionYear: /^\d{4}$/.test(String(raw.build_year ?? '')) ? Number(raw.build_year) : null,
    furnished, parking, amenities: [...new Set(amenities)], images: listing.images.slice(0, 24), imageHashes: [],
    publishedAt: null, updatedAt: knownDate(raw.last_updated), observedAt,
    seller: { name: text(raw.owner_name) ?? text(raw.user_title), publicPhone: text(raw.user_phone_number), publicEmail: null, publicProfile: null,
      declaredType: raw.is_owner === true ? 'OWNER' : null, sourceListingCount: number(raw.user_statements_count) },
    provenance: { exactUrl: listing.source_url, authorUrl: null, sourceUrl },
    evidence: [{ field: 'sourceIdentity', text: `MyHome id=${raw.id}, uuid=${raw.uuid ?? ''}` },
      ...parameters.slice(0, 10).map(row => ({ field: 'sourceFeature', text: String(row.display_name ?? row.svg_file_name).slice(0, 500) })),
      ...([['rooms', rooms], ['bedrooms', bedrooms], ['bathrooms', bathrooms]] as const).filter(([, value]) => typeof value === 'string').map(([field, value]) => ({ field, text: `MyHome reports ${value}; an open-ended range, not an exact count.` }))],
    retrievalMetadata: { acquisition: 'PUBLIC_API', uuid: text(raw.uuid), cityId: number(raw.city_id), districtId: number(raw.district_id), urbanId: number(raw.urban_id),
      roomLabel: rooms, bedroomLabel: bedrooms, bathroomLabel: bathrooms, yardAreaSqm: listing.yard_area_m2,
      conditionId: number(raw.condition_id), parkingTypeId: number(raw.parking_type_id), streetId: number(raw.street_id), groupedStreetId: number(raw.grouped_street_id),
      createdAtSource: text(raw.created_at), buildYearSource: text(raw.build_year), userType: text(raw.user_type?.type) },
  };
}
