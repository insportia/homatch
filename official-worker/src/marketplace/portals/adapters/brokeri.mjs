import { absolute, decode, int, num, phones, strip } from '../html.mjs';

/*
 * BROKERI.GE — an agency's own catalogue. Public search /property-search with the
 * site's form values (filter=1; offerType[] 1 sale / 7 rent; propertyType[N]
 * 1 flat, 2 house, 3 land, 4 commercial; municipalityId[] 1 Tbilisi, 2 Kutaisi,
 * 3 Rustavi, 4 Batumi; min/max price, space, rooms), ?page=N, 15 cards a page.
 * The card states title, USD price, area, floor, rooms, bedrooms, place and date;
 * the listing page states every fact plus the agent's published number.
 */
const OFFER = { BUY: 1, MONTHLY_RENT: 7 };
const PTYPE = { APARTMENT: 1, STUDIO: 1, PENTHOUSE: 1, HOUSE: 2, VILLA: 2, TOWNHOUSE: 2, LAND: 3, COMMERCIAL: 4, OFFICE: 4 };
const CITY = { tbilisi: 1, 'თბილისი': 1, kutaisi: 2, 'ქუთაისი': 2, rustavi: 3, 'რუსთავი': 3, batumi: 4, 'ბათუმი': 4 };
const TYPE_BACK = [[/ბინა/, 'APARTMENT'], [/სახლი|აგარაკი/, 'HOUSE'], [/მიწის ნაკვეთი|მიწის ნაკვეტი/, 'LAND'], [/კომერციული|ოფისი|ფართი/, 'COMMERCIAL']];
const unsupported = (why) => Object.assign(Error(why), { code: 'UNSUPPORTED_REQUEST' });

export const brokeri = {
  workerId: 'brokeri-agent', sourceId: 'brokeri-ge', sourceName: 'Brokeri.ge', sourceType: 'AGENCY', envPrefix: 'BROKERI', origin: 'https://brokeri.ge',
  maxPages: 2, pageSize: 15, detailLimit: 15, detailIntervalMs: 900, pageIntervalMs: 3000,
  criteria(request) {
    const city = CITY[String(request.city ?? '').trim().toLowerCase()];
    if (!city) throw unsupported('Brokeri.ge city not in its municipality list');
    if (!OFFER[request.transactionType] || !PTYPE[request.propertyType]) throw unsupported('Brokeri.ge deal/type not mapped');
    const q = [['filter', 1], ['offerType[]', OFFER[request.transactionType]], [`propertyType[${PTYPE[request.propertyType]}]`, PTYPE[request.propertyType]], ['municipalityId[]', city]];
    if (request.areaMinSqm != null) q.push(['min_space', Math.floor(request.areaMinSqm)]);
    if (request.areaMaxSqm != null) q.push(['max_space', Math.ceil(request.areaMaxSqm)]);
    if (request.rooms?.min != null) q.push(['min_rooms', request.rooms.min]);
    if (request.rooms?.max != null) q.push(['max_rooms', request.rooms.max]);
    // Price in USD: max_price/min_price apply only with currency=usd (verified 2026-10-15).
    const ceiling = request.collectPriceMaxUsd ?? request.priceMaxUsd;
    if (request.priceMinUsd > 0) q.push(['min_price', Math.floor(request.priceMinUsd)]);
    if (Number.isFinite(ceiling) && ceiling > 0) q.push(['max_price', Math.ceil(ceiling)]);
    if (q.some(([k]) => k.endsWith('_price'))) q.push(['currency', 'usd']);
    return q;
  },
  searchUrl(criteria, page) {
    const qs = criteria.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
    return `https://brokeri.ge/property-search?${qs}${page > 1 ? `&page=${page}` : ''}`;
  },
  parseList(html, url) {
    return String(html).split('property-content-div').slice(1).map((block) => {
      const link = block.match(/<a href="(\/property\/[^"]+\/(\d+))"/);
      if (!link) return null;
      const t = strip(block).replace(/\s+/g, ' ');
      const title = decode(decodeURIComponent(link[1].split('/')[2] ?? '')).trim();
      const usd = block.match(/class="price-usd price">\s*([\d,.]+)\$/);
      const address = decode(strip((block.match(/property-text-address-div">\s*<p>([\s\S]*?)<\/p>/) ?? [])[1] ?? ''));
      const parts = address.split('/').map((s) => s.trim()).filter(Boolean);
      // Facts cells in the site's fixed order: floor/total, area, rooms, bedrooms (absent for land).
      const cells = [...((block.match(/property-text-space-div">([\s\S]*?)property-text-address-div/) ?? [])[1] ?? '').matchAll(/>\s*([\d.]+(?:\/\d+)?)\s*</g)].map((m) => m[1]);
      const floorCell = cells.find((c) => c.includes('/'));
      const rest = cells.filter((c) => !c.includes('/'));
      const date = t.match(/(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/);
      const img = block.match(/url\('(https:\/\/brokeri\.ge\/storage\/uploads\/[^']+)'\)/);
      return {
        sourceListingId: link[2], url: absolute(link[1], url), title,
        transactionType: /^ქირავდება/.test(title) ? 'MONTHLY_RENT' : /^იყიდება/.test(title) ? 'BUY' : null,
        propertyType: TYPE_BACK.find(([re]) => re.test(title))?.[1] ?? null,
        price: usd ? num(usd[1]) : null, currency: usd ? 'USD' : null,
        areaSqm: num(rest[0]), floor: floorCell ? int(floorCell.split('/')[0]) : null, totalFloors: floorCell ? int(floorCell.split('/')[1]) : null,
        rooms: int(rest[1]), bedrooms: int(rest[2]),
        city: parts[0] ?? null, district: parts.length > 2 ? parts[2] : parts[1] ?? null, address: address || null,
        publishedAt: date ? new Date(`${date[1]}T${date[2]}+04:00`).toISOString() : null,
        images: img ? [img[1].replace('/thumb_', '/')] : [],
        seller: { name: null, publicPhone: null, publicEmail: null, publicProfile: null, declaredType: 'AGENCY', sourceListingCount: null },
      };
    }).filter(Boolean);
  },
  parseDetail(html) {
    const t = strip(html).replace(/\s+/g, ' ');
    const head = t.slice(0, t.indexOf('ყველა განცხადება') > 0 ? t.indexOf('ყველა განცხადება') : 4000);
    const floor = head.match(/სართული:\s*(\d+)\s*\/\s*(\d+)/);
    const agent = head.match(/ფართი:\s*[\d.]+\s*მ²\s+(.{2,60}?)\s+(5\d{8})/);
    const photos = [...new Set([...String(html).matchAll(/https:\/\/brokeri\.ge\/storage\/uploads\/(?!thumb_|blank_)[a-z0-9-]+\.(?:jpe?g|png|webp)/gi)].map((m) => m[0]))];
    const facts = (head.match(/(?:ბუნებრივი აირი|ინტერნეტი|ავეჯი|სამგზავრო ლიფტი|კონდიციონერი|კონდინციონერი|ცენტრალური გათბობის სისტემა|პარკინგის ადგილი)/g) ?? []);
    return {
      areaSqm: num((head.match(/ფართი:\s*([\d.]+)\s*მ²/) ?? [])[1]) ?? undefined,
      floor: floor ? +floor[1] : undefined, totalFloors: floor ? +floor[2] : undefined,
      rooms: int((head.match(/(\d+) ოთახი/) ?? [])[1]) ?? undefined, bedrooms: int((head.match(/(\d+) საძინებელი/) ?? [])[1]) ?? undefined,
      bathrooms: int((head.match(/(\d+) სვ\. წერტილი/) ?? [])[1]) ?? undefined,
      furnished: facts.includes('ავეჯი') ? true : undefined, parking: facts.includes('პარკინგის ადგილი') ? true : undefined,
      amenities: facts.includes('სამგზავრო ლიფტი') ? ['elevator'] : undefined,
      buildingStatus: /\/ მშენებარე \//.test(head) ? 'UNDER_CONSTRUCTION' : /\/ ახალი აშენებული \//.test(head) ? 'NEW_BUILD' : /\/ ძველი აშენებული \//.test(head) ? 'OLD_BUILD' : undefined,
      images: photos.length ? photos.slice(0, 24) : undefined,
      seller: agent ? { name: agent[1].trim(), publicPhone: phones(agent[2])[0] ?? null, publicEmail: null, publicProfile: null, declaredType: 'AGENCY', sourceListingCount: null } : undefined,
      evidence: facts.length ? [{ field: 'sourceFeature', text: facts.join(', ') }] : undefined,
    };
  },
};
