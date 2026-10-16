import { decode, dmy, int, meta, num, strip } from '../html.mjs';
import { requestedDistrictKeys } from '../places.mjs';

/*
 * HOME.GE — its search and category pages answer with an empty body to a plain
 * request (they are filled by the browser), so the public listing index is read
 * instead: the site's own sitemap (/files/sitemap/sitemap_listings3.xml, then
 * sitemap_listings2.xml), which robots.txt advertises. Every listing URL there
 * states deal, type, rooms and city in its slug
 * (/binebi/iyideba-binebi/iyideba-bina-3-otakhiani-mshenebare-tbilisi-saburtalo-323245.html)
 * and carries the listing's photos. Matching URLs are taken newest id first, and each
 * listing's own page supplies the price (₾, with the site's own USD rate), area,
 * floors, building and renovation status, district, coordinates and the date it was
 * placed. Price and area are checked after reading (shared loop), because the index cannot.
 * The contact number is only revealed through a click-through request; none is claimed.
 * A requested district narrows the index by the same slug (…-tbilisi-krtsanisi-…), but only
 * when every requested district is in the shared place table; otherwise the city is read.
 * Legacy reading rules: src/research-core/adapters/portal/sources.ts (HOME_GE).
 */
const CATEGORY = {
  BUY: { APARTMENT: ['binebi/iyideba-binebi'], HOUSE: ['saxlebi-agarakebi/iyideba-saxlebi-agarakebi'], LAND: ['miwis-nakveti/iyideba-miwis-nakveti'], COMMERCIAL: ['komerciuli-fartebi/iyideba-komerciuli-fartebi'] },
  MONTHLY_RENT: { APARTMENT: ['binebi/qiravdeba-binebi', 'binebi/giravdeba-binebi'], HOUSE: ['saxlebi-agarakebi/qiravdeba-saxlebi-agarakebi'], COMMERCIAL: ['komerciuli-fartebi/qiravdeba-komerciuli-fartebi'] },
  DAILY_RENT: { APARTMENT: ['binebi/qiravdeba-binebi-dgiurad'], HOUSE: ['saxlebi-agarakebi/qiravdeba-dgiurad-saxlebi-agarakebi'] },
};
const CITY = { tbilisi: 'tbilisi', 'თბილისი': 'tbilisi', batumi: 'batumi', 'ბათუმი': 'batumi', kutaisi: 'kutaisi', 'ქუთაისი': 'kutaisi', rustavi: 'rustavi', 'რუსთავი': 'rustavi' };
const SITEMAPS = ['https://www.home.ge/files/sitemap/sitemap_listings3.xml', 'https://www.home.ge/files/sitemap/sitemap_listings2.xml'];
const unsupported = (why) => Object.assign(Error(why), { code: 'UNSUPPORTED_REQUEST' });
const typeKey = (t) => (t === 'VILLA' ? 'HOUSE' : t === 'OFFICE' ? 'COMMERCIAL' : t);

export const homege = {
  workerId: 'homege-agent', sourceId: 'home-ge', sourceName: 'Home.ge', envPrefix: 'HOMEGE', origin: 'https://www.home.ge',
  maxPages: SITEMAPS.length, pagesIndependent: true, listCacheMs: 6 * 60 * 60 * 1000,
  detailLimit: 24, detailIntervalMs: 900, pageIntervalMs: 1000,
  criteria(request) {
    const city = CITY[String(request.city ?? '').trim().toLowerCase()];
    if (!city) throw unsupported('Home.ge listing slugs are mapped for Tbilisi, Batumi, Kutaisi and Rustavi only');
    const paths = CATEGORY[request.transactionType]?.[typeKey(request.propertyType)];
    if (!paths) throw unsupported('Home.ge has no category for this deal and type');
    return {
      paths, city, transactionType: request.transactionType, propertyType: typeKey(request.propertyType),
      roomsMin: request.rooms?.min ?? null, roomsMax: request.rooms?.max ?? null,
      districts: city === 'tbilisi' ? requestedDistrictKeys(request)?.map((k) => k.replace(/ /g, '-')) ?? null : null,
    };
  },
  searchUrl(_criteria, page) { return SITEMAPS[page - 1]; },
  parseList(xml, _url, criteria) {
    const out = [];
    for (const block of String(xml).split('<url>').slice(1)) {
      const loc = (block.match(/<loc>(https:\/\/www\.home\.ge\/([a-z-]+\/[a-z-]+)\/([^<]*-(\d+)\.html))<\/loc>/) ?? []);
      if (!loc[1] || !criteria.paths.includes(loc[2])) continue; // Georgian URLs only: /en/ and /ru/ copies carry a language prefix
      const slug = loc[3];
      if (!new RegExp(`-${criteria.city}-`).test(slug)) continue;
      if (criteria.districts && !criteria.districts.some((d) => slug.includes(`-${criteria.city}-${d}-`))) continue;
      const rooms = int((slug.match(/-(\d+)-otakhiani-/) ?? [])[1]);
      if (rooms != null && ((criteria.roomsMin != null && rooms < criteria.roomsMin) || (criteria.roomsMax != null && rooms > criteria.roomsMax))) continue;
      out.push({
        sourceListingId: loc[4], url: decode(loc[1]), rooms,
        transactionType: criteria.transactionType, propertyType: criteria.propertyType,
        images: [...block.matchAll(/<image:loc>([^<]+)<\/image:loc>/g)].map((m) => decode(m[1])),
        evidence: [{ field: 'sourceFeature', text: `Home.ge sitemap entry ${loc[1]}` }],
      });
    }
    return out.sort((a, b) => Number(b.sourceListingId) - Number(a.sourceListingId));
  },
  parseDetail(html) {
    const h = String(html);
    const field = (key) => { const m = h.match(new RegExp(`id="df_field_${key}">\\s*<div class="name"[^>]*>[\\s\\S]*?<div class="value">([\\s\\S]*?)</div>`)); return m ? strip(m[1]) : null; };
    const placed = h.match(/title="განთავსების თარიღი">[\s\S]*?<div class="value">([\s\S]*?)<\/div>/);
    const title = strip((h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) ?? [])[1] ?? '') || meta(h, 'og:title');
    const priceText = meta(h, 'twitter:data1') ?? '';
    const currency = /₾/.test(priceText) ? 'GEL' : /\$/.test(priceText) ? 'USD' : /€/.test(priceText) ? 'EUR' : null;
    const price = currency ? num(priceText) : null;
    const usdRate = num((h.match(/rates\['dollar'\]\s*=\s*new Array\('([\d.]+)'/) ?? [])[1]);
    const usd = price == null ? null : currency === 'USD' ? price : currency === 'GEL' && usdRate ? Math.round(price * usdRate) : null;
    const pin = h.match(/staticmap\?markers=[^"&]*?%7C(-?[\d.]+)%2C(-?[\d.]+)/);
    const area = num(field('square_feet'));
    const built = field('built_status') ?? '', renovation = field('renovation') ?? '';
    const yes = (key) => { const v = field(key); return v != null && v !== '' && v !== 'არა' && v !== '0'; };
    return {
      title: title || undefined, description: field('additional_information') ?? undefined,
      price: price ?? undefined, currency: currency ?? undefined, _usd: usd ?? undefined,
      areaSqm: area > 0 ? area : undefined,
      rooms: int((field('rooms') ?? '').match(/\d+/)?.[0]) ?? undefined,
      bedrooms: int(field('bedrooms')) ?? undefined, bathrooms: int(field('bathrooms')) ?? undefined,
      floor: int(field('floor')) ?? undefined, totalFloors: int(field('number_of_floors')) ?? undefined,
      city: field('mdebareoba') ?? undefined, district: field('mdebareoba_level2') ?? undefined,
      latitude: pin ? Number(pin[1]) : undefined, longitude: pin ? Number(pin[2]) : undefined,
      publishedAt: dmy(placed ? strip(placed[1]) : null) ?? undefined,
      buildingStatus: /მშენებარე/.test(built) ? 'UNDER_CONSTRUCTION' : /ახალი აშენებული/.test(built) ? 'NEW_BUILD' : /ძველი აშენებული/.test(built) ? 'OLD_BUILD' : undefined,
      renovationStatus: /გასარემონტებელი/.test(renovation) ? 'NEEDS_RENOVATION' : /თეთრი/.test(renovation) ? 'WHITE_FRAME' : /შავი/.test(renovation) ? 'BLACK_FRAME' : /მწვანე/.test(renovation) ? 'GREEN_FRAME' : /გარემონტებული/.test(renovation) ? 'RENOVATED' : undefined,
      amenities: [['elevator', 'elevator'], ['gas', 'natural gas'], ['balcony_terrace', 'balcony'], ['pool', 'pool'], ['sauna', 'sauna'], ['fireplace', 'fireplace']].filter(([k]) => yes(k)).map(([, label]) => label),
      pricePerSqm: price != null && area > 0 ? Math.round(price / area) : undefined,
    };
  },
};
