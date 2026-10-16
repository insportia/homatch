import { absolute, decode, dmy, int, meta, num, phones, strip } from '../html.mjs';
import { requestedDistrictKeys } from '../places.mjs';

/*
 * PLACE.GE — public search at /ge/ads with the site's own filter codes (read off its
 * markup: type=for_sale|for_rent, object_type=flat|private_house|land|commercial_estate,
 * city_id=1 for Tbilisi, currency_id=2 USD), pages /ge/ads/page:N, 15 cards a filtered page (17 unfiltered).
 * Each card states deal, type, rooms, area, floor, place, the USD price
 * (data-price_usd), the publication date, the id and the contact the seller published;
 * the listing page adds full photos, the seller's description and building facts.
 * Districts: the site's own region_id + district_id pair, read off its cards' "similar" links
 * (2026-10-15 pages; card place text → id). One results page per requested district;
 * a district without an observed id sends no district filter at all (city-wide read,
 * the shared loop and the pipeline then decide the district), never a guessed id.
 */
const DEAL = { BUY: 'for_sale', MONTHLY_RENT: 'for_rent' };
const TYPE = { APARTMENT: 'flat', HOUSE: 'private_house', VILLA: 'private_house', LAND: 'land', COMMERCIAL: 'commercial_estate', OFFICE: 'commercial_estate' };
const TYPE_BACK = { 'ბინა': 'APARTMENT', 'კერძო სახლი': 'HOUSE', 'აგარაკი': 'HOUSE', 'მიწის ნაკვეთი': 'LAND', 'მიწა': 'LAND' };
const CITY = { 'tbilisi': 1, 'თბილისი': 1 };
/* [region_id, district_id] as the site's own links pair them; district_id alone is ignored by its server (live probe 2026-10-16). */
const DISTRICT_ID = { vake: [1, 2], 'didi digomi': [1, 13], saburtalo: [1, 18], gldani: [2, 23], didube: [4, 45], samgori: [5, 60], avlabari: [6, 62], vera: [6, 63], krtsanisi: [6, 65], mtatsminda: [6, 66], sololaki: [6, 67] };
const unsupported = (why) => Object.assign(Error(why), { code: 'UNSUPPORTED_REQUEST' });

export const placege = {
  workerId: 'placege-agent', sourceId: 'place-ge', sourceName: 'Place.ge', envPrefix: 'PLACEGE', origin: 'https://place.ge',
  maxPages: (c) => (c.district_ids ? Math.min(3, c.district_ids.length) : 2), pagesIndependent: (c) => Boolean(c.district_ids), pageSize: 15, detailLimit: 17, detailIntervalMs: 900, pageIntervalMs: 3000,
  criteria(request) {
    const city = CITY[String(request.city ?? '').trim().toLowerCase()];
    if (!city) throw unsupported('Place.ge city filter is verified for Tbilisi only');
    if (!DEAL[request.transactionType] || !TYPE[request.propertyType]) throw unsupported('Place.ge deal/type not mapped');
    const q = { type: DEAL[request.transactionType], object_type: TYPE[request.propertyType], city_id: city, currency_id: 2, mode: 'list' };
    if (request.priceMinUsd > 0) q.price_from = Math.floor(request.priceMinUsd);
    const ceiling = request.collectPriceMaxUsd ?? request.priceMaxUsd;
    if (Number.isFinite(ceiling) && ceiling > 0) q.price_to = Math.ceil(ceiling);
    if (request.areaMinSqm != null) q.living_space_from = Math.floor(request.areaMinSqm);
    if (request.areaMaxSqm != null) q.living_space_to = Math.ceil(request.areaMaxSqm);
    if (request.rooms?.min != null) q.rooms_from = request.rooms.min;
    if (request.rooms?.max != null) q.rooms_to = request.rooms.max;
    const ids = requestedDistrictKeys(request)?.map((k) => DISTRICT_ID[k]);
    if (ids?.length && ids.every(Boolean)) q.district_ids = ids.slice(0, 3);
    return q;
  },
  searchUrl(criteria, page) {
    const { district_ids: ids, ...q } = criteria;
    if (ids) { const [region_id, district_id] = ids[page - 1]; return `https://place.ge/ge/ads?${new URLSearchParams(Object.entries({ ...q, region_id, district_id }).map(([k, v]) => [k, String(v)]))}`; }
    const qs = new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)])).toString();
    return `https://place.ge/ge/ads${page > 1 ? `/page:${page}` : ''}?${qs}`;
  },
  parseList(html, url) {
    const cards = String(html).split(/<div class="tr-line[^"]*">/).slice(1);
    return cards.map((card) => {
      const id = (card.match(/ID:\s*(\d{5,})/) ?? card.match(/\/ge\/ads\/view\/(\d+)/) ?? [])[1];
      if (!id) return null;
      const line = card.match(/<div><strong>([^<]+)<\/strong>,([^<]*)<br\s*\/?>([^<]*)<\/div>/);
      const facts = decode(line?.[2] ?? ''), place = decode(line?.[3] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      const usd = card.match(/data-price_usd="\$?([\d,]+)/);
      const floor = facts.match(/სართული\s*(\d+)\s*\/\s*(\d+)/);
      const typeWord = facts.split(',').map((s) => s.trim()).find((s) => TYPE_BACK[s]);
      const contact = card.match(/<div>ტელ\.:\s*([^<]+)<\/div>/);
      const contactParts = decode(contact?.[1] ?? '').split(',').map((s) => s.trim());
      const agency = card.match(/<a href="(\/ge\/a\/[^"]+\/ads)">([^<]+)<\/a>/);
      const img = card.match(/<img src="(https:\/\/photos\.place\.ge\/photos\/\d+\/[^"]+)"/);
      const deal = decode(line?.[1] ?? '').trim();
      return {
        sourceListingId: id, url: `https://place.ge/ge/ads/view/${id}`,
        title: [deal, facts.trim(), place.join(', ')].filter(Boolean).join(', ').replace(/\s+,/g, ','),
        transactionType: deal === 'იყიდება' ? 'BUY' : deal === 'ქირავდება' ? 'MONTHLY_RENT' : null,
        propertyType: typeWord ? TYPE_BACK[typeWord] : null,
        price: usd ? num(usd[1]) : null, currency: usd ? 'USD' : null,
        rooms: int((facts.match(/(\d+)\s*ოთახ/) ?? [])[1]), areaSqm: num((facts.match(/([\d.,]+)\s*კვ\.მ/) ?? [])[1]),
        floor: floor ? +floor[1] : null, totalFloors: floor ? +floor[2] : null,
        city: place[0] ?? null, district: place[1] ?? null, address: place.slice(2).join(', ') || null,
        publishedAt: dmy((card.match(/pub-date[^>]*>(?:<em>[^<]*<\/em>)?\s*([\d.]+)/) ?? [])[1]),
        images: img ? [img[1].replace(/\/\d+x\d+\.webp$/, '/800x600.webp')] : [],
        seller: { name: contactParts.find((p) => p && !/\d{6,}/.test(p) && !/აგენტი|მესაკუთრე/.test(p)) ?? (agency ? decode(agency[2]) : null),
          publicPhone: phones(contactParts.join(' '))[0] ?? null, publicEmail: null,
          publicProfile: agency ? absolute(agency[1], url) : null,
          declaredType: agency || contactParts.includes('აგენტი') ? 'AGENCY' : contactParts.includes('მესაკუთრე') ? 'OWNER' : null, sourceListingCount: null },
      };
    }).filter(Boolean);
  },
  parseDetail(html) {
    const text = strip(html);
    const field = (label) => (text.match(new RegExp(`${label}\\s*([^\\n]{1,60}?)(?=\\s+(?:ფართი|მიწის ფართი|რემონტი|სტატუსი|მისამართი|სულ სართული|ოთახი|სველი წერტილი|საძინებელი):|\\n|$)`)) ?? [])[1]?.trim() ?? null;
    const photos = [...new Set([...String(html).matchAll(/https:\/\/i0\.place\.ge\/img\/photos\/\d+\/\d+\/800x600_[^"' )]+/g)].map((m) => m[0]))];
    const description = meta(html, 'og:description');
    const renovation = field('რემონტი:');
    return {
      description,
      images: photos.length ? photos : undefined,
      areaSqm: num(field('ფართი:')) ?? undefined,
      totalFloors: int(field('სულ სართული:')) ?? undefined,
      bathrooms: int(field('სველი წერტილი:')) ?? undefined,
      buildingStatus: /ახალი აშენებული/.test(field('სტატუსი:') ?? '') ? 'NEW_BUILD' : /ძველი აშენებული/.test(field('სტატუსი:') ?? '') ? 'OLD_BUILD' : /მშენებარე/.test(field('სტატუსი:') ?? '') ? 'UNDER_CONSTRUCTION' : undefined,
      renovationStatus: /თეთრი/.test(renovation ?? '') ? 'WHITE_FRAME' : /შავი/.test(renovation ?? '') ? 'BLACK_FRAME' : /მწვანე/.test(renovation ?? '') ? 'GREEN_FRAME' : /^(?:ახალი )?გარემონტებული|^ახალი რემონტი/.test(renovation ?? '') ? 'RENOVATED' : undefined,
      evidence: [renovation && { field: 'sourceFeature', text: `რემონტი: ${renovation}` }, field('სტატუსი:') && { field: 'sourceFeature', text: `სტატუსი: ${field('სტატუსი:')}` }].filter(Boolean),
    };
  },
};
