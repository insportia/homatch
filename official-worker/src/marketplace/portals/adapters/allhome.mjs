import { decode, dmy, int, meta, num, strip } from '../html.mjs';

/*
 * ALLHOME.GE — its only search and list routes live under /index.php?…, which
 * robots.txt disallows, so none is requested. The public listing index is the
 * site's own sitemap (/sitemaps/defs_sitemap_ge.xml, advertised by /sitemap.xml):
 * every listing URL names its deal and type in the slug and the category code at
 * the end (binebis-kidva-gakidva-<id>-10.html = flat for sale,
 * qiravdeba-bina-<id>-11.html = flat for rent). Matching URLs are taken newest id
 * first and each listing's own page supplies everything else, as labelled fields
 * (<div id="atr"><b>ქალაქი:</b> <span>თბილისი</span>): city, district, street,
 * rooms, bedrooms, floor, floors, area, building and renovation status, the USD
 * price block, the date it was placed and its photos. City is checked after
 * reading, because the slug does not state it. No contact number is published on
 * the page; none is claimed. Verified on real pages 2026-10-15; flats only.
 */
const SLUG = { BUY: { APARTMENT: /^binebis-(?:kidva-gakidva|yidva-gayidva)-(\d+)-10\.html$/ }, MONTHLY_RENT: { APARTMENT: /^qiravdeba-bina-(\d+)-11\.html$/ } };
const CITY = { tbilisi: 'თბილისი', 'თბილისი': 'თბილისი', batumi: 'ბათუმი', 'ბათუმი': 'ბათუმი', kutaisi: 'ქუთაისი', 'ქუთაისი': 'ქუთაისი', rustavi: 'რუსთავი', 'რუსთავი': 'რუსთავი' };
const SITEMAP = 'https://www.allhome.ge/sitemaps/defs_sitemap_ge.xml';
const unsupported = (why) => Object.assign(Error(why), { code: 'UNSUPPORTED_REQUEST' });

export const allhome = {
  workerId: 'allhome-agent', sourceId: 'allhome-ge', sourceName: 'Allhome.ge', envPrefix: 'ALLHOME', origin: 'https://www.allhome.ge',
  deepMaxPages: 6, filtersAfterRead: true, maxPages: 1, pagesIndependent: true, listCacheMs: 6 * 60 * 60 * 1000,
  detailLimit: 24, detailIntervalMs: 900, pageIntervalMs: 1000,
  /* Worker-local index (../index/PortalIndex.mjs): the sitemap does not state the city, so
     one window per deal serves every mapped city; the city is checked after reading. */
  indexed: true, indexCityAgnostic: true,
  indexSegments: [
    { transactionType: 'BUY', propertyType: 'APARTMENT', city: 'Tbilisi', cap: 3000 },
    { transactionType: 'MONTHLY_RENT', propertyType: 'APARTMENT', city: 'Tbilisi', cap: 3000 },
  ],
  criteria(request) {
    const city = CITY[String(request.city ?? '').trim().toLowerCase()];
    if (!city) throw unsupported('Allhome.ge is mapped for Tbilisi, Batumi, Kutaisi and Rustavi only');
    const slug = SLUG[request.transactionType]?.[request.propertyType];
    if (!slug) throw unsupported('Allhome.ge is verified for flats for sale and for monthly rent only');
    return { city, slug: slug.source, transactionType: request.transactionType, propertyType: request.propertyType };
  },
  searchUrl() { return SITEMAP; },
  parseList(xml, _url, criteria) {
    const slug = new RegExp(criteria.slug);
    return [...String(xml).matchAll(/<loc>https:\/\/www\.allhome\.ge\/([^<\/]+)<\/loc>/g)]
      .map((m) => { const s = decode(m[1]), id = (s.match(slug) ?? [])[1]; return id ? { sourceListingId: id, url: `https://www.allhome.ge/${s}` } : null; })
      .filter(Boolean)
      .map((i) => ({ ...i, transactionType: criteria.transactionType, propertyType: criteria.propertyType }))
      .sort((a, b) => Number(b.sourceListingId) - Number(a.sourceListingId));
  },
  parseDetail(html) {
    const h = String(html);
    const field = (label) => { const m = h.match(new RegExp(`<div id="atr"><b>${label}:</b>(?:&nbsp;|\\s)*<span>([\\s\\S]*?)</span>`)); return m ? strip(m[1]) : null; };
    const usd = h.match(/class="price-dollar"[^>]*>[\s\S]{0,300}?<span style="margin-left: 3px;">([\d\s,.]+)<\/span>\s*\$/);
    const price = usd ? num(usd[1]) : null, area = num(field('საერთო ფართი'));
    const built = field('შენობის სტატუსი') ?? '', renovation = field('მდგომარეობა') ?? '';
    const head = h.match(/<b class="obj-title"><a[^>]*>([^<]+)<\/a><\/b>[\s\S]{0,200}?<div class="obj_date">\s*(\d{2}\.\d{2}\.\d{4})/);
    const images = [...new Set([...h.matchAll(/<a class="thumb"[^>]*href="(https:\/\/www\.allhome\.ge\/files\/gallery\/[^"]+)"/g)].map((m) => decode(m[1])))];
    const rooms = int(field('ოთახების რაოდენობა')), district = field('უბანი') ?? field('რაიონი'), street = field('ქუჩა');
    const description = field('დამატებითი აღწერა');
    return {
      title: [decode(head?.[1] ?? '').trim() || null, rooms ? `${rooms} ოთახი` : null, area ? `${area} მ²` : null, district, street].filter(Boolean).join(', ') || meta(h, 'og:title') || undefined,
      description: description ?? meta(h, 'og:description') ?? undefined,
      price: price ?? undefined, currency: price != null ? 'USD' : undefined,
      areaSqm: area > 0 ? area : undefined, pricePerSqm: price != null && area > 0 ? Math.round(price / area) : undefined,
      rooms: rooms ?? undefined, bedrooms: int(field('საძინებლის რაოდენობა')) ?? undefined, bathrooms: int(field('სველი წერტილები')) ?? undefined,
      floor: int(field('სართული')) ?? undefined, totalFloors: int(field('სართულიანობა')) ?? undefined,
      city: field('ქალაქი') ?? undefined, district: district ?? undefined, address: street ?? undefined,
      publishedAt: dmy(head?.[2]) ?? undefined,
      buildingStatus: /მშენებარე/.test(built) ? 'UNDER_CONSTRUCTION' : /ახალი აშენებული/.test(built) ? 'NEW_BUILD' : /ძველი აშენებული/.test(built) ? 'OLD_BUILD' : undefined,
      renovationStatus: /გასარემონტებელი/.test(renovation) ? 'NEEDS_RENOVATION' : /თეთრი/.test(renovation) ? 'WHITE_FRAME' : /შავი/.test(renovation) ? 'BLACK_FRAME' : /მწვანე/.test(renovation) ? 'GREEN_FRAME' : /გარემონტებული/.test(renovation) ? 'RENOVATED' : undefined,
      amenities: [...h.matchAll(/objects\/plus\.png"[^>]*\/?>\s*<\/div>\s*<div class="text"[^>]*>([^<]+)<\/div>/g)].map((m) => decode(m[1]).trim()),
      images: images.length ? images : undefined,
    };
  },
  /** The slug does not state the city; the listing page does. */
  accept(fields, criteria) { return !fields.city || fields.city === criteria.city; },
};
