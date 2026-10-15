import { assignedJson, strip } from '../html.mjs';

/*
 * KORTER.GE — server-rendered listing pages that carry their results as data
 * (window.INITIAL_STATE.apartmentListingStore.apartments, 20 a page, ?page=N).
 * Section routes are the site's own (Tbilisi): sale/rent/daily × flat/house/land/
 * commercial. The listing page adds the description, bedrooms, bathrooms and photos
 * (layoutLandingStore.layout). Contact numbers are not published on the page
 * (seller.phones is null until a visitor asks), so none is claimed.
 * robots.txt disallows /api/; only the public HTML pages are read.
 */
const ROUTES = {
  BUY: { APARTMENT: 'binebis-yidva-gayidva-tbilisi', HOUSE: 'iyideba-kerdzo-saxlebi-tbilisshi', LAND: 'iyideba-miwis-nakveti-tbilisshi', COMMERCIAL: 'komerciuli-fartebis-gakidva-tbilisi' },
  MONTHLY_RENT: { APARTMENT: 'qiravdeba-binebi-tbilisshi', HOUSE: 'qiravdeba-saxlebi-tbilisshi', COMMERCIAL: 'komerciuli-fartebis-kiravdeba-tbilisi' },
  DAILY_RENT: { APARTMENT: 'qiravdeba-binebi-dgiurad-tbilisshi', HOUSE: 'qiravdeba-kerdzo-saxlebi-dgiurad-tbilisshi' },
};
const TYPE_BACK = { flat: 'APARTMENT', house: 'HOUSE', cottage: 'HOUSE', land: 'LAND', commercial: 'COMMERCIAL', office: 'OFFICE' };
const SECTION = { sale: 'BUY', rent: 'MONTHLY_RENT', daily: 'DAILY_RENT' };
const unsupported = (why) => Object.assign(Error(why), { code: 'UNSUPPORTED_REQUEST' });
const n = (v) => typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() && Number.isFinite(+v) ? +v : null);

export const korter = {
  workerId: 'korter-agent', sourceId: 'korter-ge', sourceName: 'Korter.ge', envPrefix: 'KORTER', origin: 'https://korter.ge',
  maxPages: 2, pageSize: 20, detailLimit: 20, detailIntervalMs: 900, pageIntervalMs: 3000,
  criteria(request) {
    if (!/^(tbilisi|თბილისი)$/i.test(String(request.city ?? '').trim())) throw unsupported('Korter.ge routes are verified for Tbilisi only');
    const route = ROUTES[request.transactionType]?.[request.propertyType === 'VILLA' ? 'HOUSE' : request.propertyType === 'OFFICE' ? 'COMMERCIAL' : request.propertyType];
    if (!route) throw unsupported('Korter.ge has no route for this deal and type');
    // Site filters verified 2026-10-15: max_price/min_price (USD) and room_counts (one value).
    const q = [], ceiling = request.collectPriceMaxUsd ?? request.priceMaxUsd;
    if (request.priceMinUsd > 0) q.push(['min_price', Math.floor(request.priceMinUsd)]);
    if (Number.isFinite(ceiling) && ceiling > 0) q.push(['max_price', Math.ceil(ceiling)]);
    if (request.rooms?.min != null && request.rooms.min === request.rooms.max) q.push(['room_counts', request.rooms.min]);
    return { route, q };
  },
  searchUrl(criteria, page) {
    const q = [...(criteria.q ?? []), ...(page > 1 ? [['page', page]] : [])];
    return `https://korter.ge/${criteria.route}${q.length ? `?${q.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')}` : ''}`;
  },
  parseList(html) {
    const state = assignedJson(html, 'window.INITIAL_STATE');
    const rows = state?.apartmentListingStore?.apartments;
    if (!Array.isArray(rows)) return [];
    return rows.filter((r) => r && r.objectId && r.link && r.availableStatus !== 'sold').map((r) => ({
      sourceListingId: String(r.objectId), url: new URL(r.link, 'https://korter.ge').href,
      title: [r.propertyTypeRoomCountLabel ?? r.propertyTypeLabel, r.area ? `${r.area} მ²` : null, r.address, r.subLocalityNominative].filter(Boolean).join(', '),
      transactionType: SECTION[r.section] ?? null, propertyType: TYPE_BACK[r.objectType ?? r.propertyCategory] ?? null,
      price: n(r.price), currency: typeof r.currency === 'string' ? r.currency.toUpperCase() : null,
      areaSqm: n(r.area), rooms: n(r.roomCount), floor: Array.isArray(r.floorNumbers) ? n(r.floorNumbers[0]) : null, totalFloors: n(r.house?.floorCount),
      city: r.mainGeoObject?.nominative ?? null, district: r.subLocalityNominative ?? null, address: r.address ?? null,
      latitude: n(r.building?.position?.lat), longitude: n(r.building?.position?.lng),
      updatedAt: typeof r.actualizeTime === 'string' ? new Date(r.actualizeTime).toISOString() : null,
      images: [r.mediaSrc?.default?.x2 ?? r.mediaSrc?.default?.x1].filter(Boolean),
      seller: { name: null, publicPhone: null, publicEmail: null, publicProfile: r.userId ? `https://korter.ge/realtor/${r.userId}` : null, declaredType: r.building?.buildingId ? 'DEVELOPER' : null, sourceListingCount: null },
      evidence: [{ field: 'sourceFeature', text: `Korter.ge objectId=${r.objectId}; section=${r.section}; commissionIncluded=${r.commissionIncluded === true}` }],
    }));
  },
  parseDetail(html) {
    const state = assignedJson(html, 'window.INITIAL_STATE');
    const layout = state?.layoutLandingStore?.layout;
    if (!layout) return {};
    const images = (layout.images ?? []).map((i) => i?.mediaSrc?.default?.x1).filter((u) => typeof u === 'string');
    const seller = state?.layoutLandingStore?.seller;
    return {
      description: typeof layout.description === 'string' ? strip(layout.description) : undefined,
      bedrooms: n(layout.bedroomCount) ?? undefined, bathrooms: n(layout.bathroomCount) ?? undefined,
      images: images.length ? images : undefined,
      seller: seller?.name ? { name: String(seller.name), publicPhone: null, publicEmail: null, publicProfile: seller.userId ? `https://korter.ge/realtor/${seller.userId}` : null, declaredType: null, sourceListingCount: null } : undefined,
    };
  },
};
