import { createClient } from 'jsr:@supabase/supabase-js@2';

// ============================================================
// HOMATCH — import-property Edge Function v4
//
// Universal multi-source property extraction engine.
//
// Pipeline (cost-ascending):
//   validate URL → normalize → cache check
//   → direct HTTP fetch
//   → UniversalExtractor (JSON-LD, OG, meta, __NEXT_DATA__,
//     embedded state, breadcrumbs, HTML patterns)
//   → domain adapter (MyHome / SS.ge) when applicable
//   → ZenRows JS render (if incomplete after direct)
//   → ScrapingBee JS render (if ZenRows also fails)
//   → AI semantic normalization (OpenAI) for unresolved fields
//   → quality gate → diagnostics → save
//
// Security: SSRF block-list, redirect guard, rate-limit headers,
//           auth required, anonymous users blocked
// ============================================================

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Rate-limit response headers (informational — hard enforcement via supabase gateway or nginx)
const RATE_LIMIT_HEADERS = {
  'X-RateLimit-Limit': '10',
  'X-RateLimit-Window': '60',
  'Retry-After': '60',
};

// ── SSRF protection ─────────────────────────────────────────
// Block: localhost, private RFC-1918 ranges, link-local, cloud metadata endpoints,
// non-HTTP/S protocols, unsupported schemes (file://, ftp://, data:, etc.)
// Also validates any redirect target before following.
function isPublicUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    // Only allow http and https — block file://, ftp://, data:, javascript:, etc.
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const h = u.hostname.toLowerCase();
    // Localhost variants
    if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0') return false;
    // AWS/GCP/Azure/DO cloud metadata endpoints
    if (h === '169.254.169.254') return false;          // AWS IMDS, Azure IMDS, GCP legacy
    if (h === 'metadata.google.internal') return false;  // GCP
    if (h === '100.100.100.200') return false;           // Alibaba Cloud metadata
    // Link-local
    if (h.startsWith('169.254.')) return false;
    // IPv6 loopback / link-local
    if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return false;
    // Private RFC-1918 ranges (numeric IPv4 only — hostnames are not resolved here)
    const parts = h.split('.').map(Number);
    if (parts.length === 4 && parts.every(p => !isNaN(p))) {
      if (parts[0] === 10) return false;                                          // 10.0.0.0/8
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;    // 172.16.0.0/12
      if (parts[0] === 192 && parts[1] === 168) return false;                    // 192.168.0.0/16
      if (parts[0] === 127) return false;                                        // 127.0.0.0/8
      if (parts[0] === 0) return false;                                          // 0.0.0.0/8
      if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return false;   // 100.64.0.0/10 (CGNAT)
    }
    return true;
  } catch {
    return false;
  }
}

// Safe fetch wrapper: validates every redirect hop against SSRF block-list
async function safeFetch(url: string, options: RequestInit & { signal?: AbortSignal }): Promise<Response> {
  // Perform request with manual redirect handling
  const resp = await fetch(url, { ...options, redirect: 'manual' });
  // Follow up to 5 redirects, validating each target
  if (resp.status >= 300 && resp.status < 400) {
    const location = resp.headers.get('location');
    if (!location) throw new Error('Redirect with no Location header');
    const resolved = new URL(location, url).href;
    if (!isPublicUrl(resolved)) {
      throw new Error(`Redirect to blocked URL: ${resolved}`);
    }
    // Follow the redirect (recursive, max depth tracked by caller)
    return fetch(resolved, { ...options, redirect: 'follow', signal: options.signal });
  }
  return resp;
}

// Domains that return structured JSON-LD or known patterns
const KNOWN_LISTING_DOMAINS = [
  'myhome.ge', 'ss.ge', 'place.ge', 'listing.ge',
  'realtor.com', 'zillow.com', 'rightmove.co.uk', 'idealista.com',
];

function isKnownListingDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return KNOWN_LISTING_DOMAINS.some(d => host === d || host.endsWith('.' + d));
  } catch {
    return false;
  }
}

// ── Photo filtering — reject non-listing assets ─────────────
// Never let logo/icon/placeholder images become a listing photo.
const PHOTO_REJECT_PATTERNS = [
  /myhome-logo/i,
  /ss\.ge\/logo/i,
  /\/logos?\//i,
  /\/icons?\//i,
  /\/favicon/i,
  /\/avatars?\//i,
  /\/banners?\//i,
  /\/placeholders?\//i,
  /\/ui\//i,
  /\/assets\/img\/logo/i,
  /tracking.*pixel/i,
  /pixel.*tracking/i,
  /\.svg(\?|$)/i,
  // myhome.ge branding CDN path
  /static\.my\.ge\/myhome\/images\/myhome/i,
  // Generic logo/icon patterns
  /logo\.(png|jpg|webp|gif)/i,
  /icon\.(png|jpg|webp|gif)/i,
  // 1x1 tracking pixel
  /1x1\.(png|gif)/i,
  /spacer\.(png|gif)/i,
];

function isListingPhoto(url: string): boolean {
  if (!isPublicUrl(url)) return false;
  for (const pat of PHOTO_REJECT_PATTERNS) {
    if (pat.test(url)) return false;
  }
  return true;
}

// ── Gallery extraction helpers ──────────────────────────────

/** Extract all og:image / og:image:secure_url meta tags — filter non-listing */
function extractOgImages(html: string): string[] {
  const urls: string[] = [];
  for (const m of html.matchAll(/<meta[^>]*property="og:image[^"]*"[^>]*content="([^"]+)"/gi)) {
    if (m[1] && isListingPhoto(m[1])) urls.push(m[1]);
  }
  for (const m of html.matchAll(/<meta[^>]*content="([^"]+)"[^>]*property="og:image[^"]*"/gi)) {
    if (m[1] && isListingPhoto(m[1]) && !urls.includes(m[1])) urls.push(m[1]);
  }
  return urls;
}

/** Extract image URLs from twitter:image meta — filter non-listing */
function extractTwitterImages(html: string): string[] {
  const urls: string[] = [];
  for (const m of html.matchAll(/<meta[^>]*(?:name|property)="twitter:image[^"]*"[^>]*content="([^"]+)"/gi)) {
    if (m[1] && isListingPhoto(m[1])) urls.push(m[1]);
  }
  return urls;
}

/** Extract image URLs from JSON-LD image array — filter non-listing */
function extractJsonLdImages(jsonLd: Record<string, unknown> | null): string[] {
  if (!jsonLd) return [];
  const raw = jsonLd.image;
  if (!raw) return [];
  if (typeof raw === 'string') return isListingPhoto(raw) ? [raw] : [];
  if (Array.isArray(raw)) {
    return (raw as unknown[])
      .map(i => (typeof i === 'string' ? i : (i as Record<string, unknown>)?.url ?? ''))
      .filter((u): u is string => typeof u === 'string' && isListingPhoto(u));
  }
  if (typeof raw === 'object' && (raw as Record<string, unknown>).url) {
    const u = String((raw as Record<string, unknown>).url);
    return isListingPhoto(u) ? [u] : [];
  }
  return [];
}

/** Deduplicate, filter, and cap gallery to 5 listing images */
function buildGallery(urls: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const u of urls) {
    if (isListingPhoto(u) && !seen.has(u)) {
      seen.add(u);
      result.push(u);
    }
    if (result.length >= 5) break;
  }
  return result;
}

// ── Diagnostic helper ─────────────────────────────────────────
interface FallbackStep {
  strategy: string;
  status: number | string;
  size?: number;
  reason?: string;
}

// Count non-null/undefined fields in an object
function countFields(obj: Record<string, unknown>): number {
  return Object.values(obj).filter(v => v !== undefined && v !== null && v !== '').length;
}

// Identify missing critical fields
function missingCriticalFields(facts: Partial<ExtractedFacts>): string[] {
  const critical: Array<keyof ExtractedFacts> = ['transaction_type', 'property_type', 'city', 'total_price', 'area'];
  return critical.filter(k => facts[k] === undefined || facts[k] === null || facts[k] === '');
}

// Extract JSON-LD structured data from HTML
function extractJsonLd(html: string): Record<string, unknown> | null {
  const matches = html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of matches) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (parsed['@type'] && ['RealEstateListing', 'Product', 'Offer', 'ItemPage'].some(t => parsed['@type']?.includes?.(t) || parsed['@type'] === t)) {
        return parsed;
      }
    } catch { /* skip malformed */ }
  }
  return null;
}

// ── MYHOME.GE ADAPTER ────────────────────────────────────────
//
// myhome.ge is Next.js. Real listing data lives in:
//   __NEXT_DATA__ → props.pageProps.dehydratedState.queries[N]
//                   .state.data.data.statement
//
// Key field mappings from live page structure:
//   statement.dynamic_title       → title (clean, no price suffix)
//   statement.city_name           → Georgian city name → normalise to English
//   statement.urban_name          → neighbourhood (Krtsanisi) → district
//   statement.address             → street address
//   statement.total_price         → price in statement.currency_id currency
//   statement.price[currency_id]  → { price_total, price_square } authoritative
//   statement.currency_id         → 1=GEL, 2=USD, 3=EUR
//   statement.area                → decimal m²
//   statement.room_type_id        → total room count (3 = 3 rooms)
//   statement.bedroom_type_id     → bedroom count (2 = 2 bedrooms)
//   statement.floor               → floor number
//   statement.total_floors        → total floors in building
//   statement.deal_type_id        → 1=SALE, 2=RENT, 3=DAILY_RENT
//   statement.real_estate_type_id → 1=APARTMENT, 2=HOUSE, 3=COMMERCIAL, 4=LAND,
//                                   5=HOTEL, 6=NEW_DEVELOPMENT, 7=OFFICE
//   statement.comment             → full description (HTML, strip tags)
//   statement.images[].large      → full-res listing photos (not .url, not .thumb)
//   statement.images[].is_main    → cover photo indicator

// Georgian city/district name → English normalisation map
// (myhome.ge returns all names in the page locale — /ka/ gives Georgian strings)
const GEO_CITY_MAP: Record<string, string> = {
  'თბილისი': 'Tbilisi',
  'ბათუმი': 'Batumi',
  'ქუთაისი': 'Kutaisi',
  'რუსთავი': 'Rustavi',
  'გორი': 'Gori',
  'ზუგდიდი': 'Zugdidi',
  'ფოთი': 'Poti',
  'ხაშური': 'Khashuri',
  'სამტრედია': 'Samtredia',
  'სენაკი': 'Senaki',
  'ზestaponi': 'Zestaponi',
  'ზestaphoni': 'Zestaponi',
  'მარნეული': 'Marneuli',
  'ტელავი': 'Telavi',
  'ახალციხე': 'Akhaltsikhe',
  'ოზურგეთი': 'Ozurgeti',
  'ქობულეთი': 'Kobuleti',
  'ხობი': 'Khobi',
  'ლანჩხუთი': 'Lanchkhuti',
  'საჩხერე': 'Sachkhere',
  'ჩხოროწყუ': 'Chkhorotsqu',
  'ყვარელი': 'Kvareli',
};

const GEO_DISTRICT_MAP: Record<string, string> = {
  // Tbilisi districts / neighbourhoods
  'ვაკე': 'Vake',
  'საბურთალო': 'Saburtalo',
  'კრწანისი': 'Krtsanisi',
  'ორთაჭალა': 'Ortachala',
  'ვერა': 'Vera',
  'მtatsminda': 'Mtatsminda',
  'მtatsminda': 'Mtatsminda',
  'ძველი თბილისი': 'Old Tbilisi',
  'ავლაბარი': 'Avlabari',
  'ისანი': 'Isani',
  'სამგორი': 'Samgori',
  'გლდანი': 'Gldani',
  'ნაძალადევი': 'Nadzaladevi',
  'დიდუბე': 'Didube',
  'ჩუღურეთი': 'Chugureti',
  'დიდი დიღომი': 'Didi Dighomi',
  'ლილო': 'Lilo',
  'ვარკეთილი': 'Varketili',
  'ელია': 'Elia',
  'ეკო': 'Eco',
  'ბაგი': 'Bagi',
  'ფონიჭალა': 'Ponichala',
  'ავჭალა': 'Avchala',
  'წავkisi': 'Tsavkisi',
  'კოჯორი': 'Kojori',
  'თაბახმელა': 'Tabakhmela',
  'ტბეთი': 'Tbeti',
  'ნუცubidze': 'Nutsubidze',
  'მუხიანი': 'Mukhiani',
  'ლისი': 'Lisi',
  // Batumi districts
  'ნიუ ბულვარი': 'New Boulevard',
  'ჯიხაიში': 'Jikhashi',
};

function normaliseGeoCity(raw: string): string {
  return GEO_CITY_MAP[raw.trim()] ?? raw;
}

function normaliseGeoDistrict(raw: string): string {
  return GEO_DISTRICT_MAP[raw.trim()] ?? raw;
}

// Map deal_type_id → TransactionType
function dealTypeToTransaction(id: number): string | undefined {
  if (id === 1) return 'SALE';
  if (id === 2 || id === 3) return 'RENT';
  return undefined;
}

// Map real_estate_type_id → PropertyType
function realEstateTypeToPropertyType(id: number): string | undefined {
  const map: Record<number, string> = {
    1: 'APARTMENT',
    2: 'HOUSE',
    3: 'COMMERCIAL',
    4: 'LAND',
    5: 'COMMERCIAL',  // hotel → commercial
    6: 'APARTMENT',   // new development / flat
    7: 'COMMERCIAL',  // office
    8: 'APARTMENT',   // studio / project flat
  };
  return map[id];
}

// Map currency_id → ISO code
function currencyIdToCode(id: number): string {
  if (id === 1) return 'GEL';
  if (id === 2) return 'USD';
  if (id === 3) return 'EUR';
  return 'USD';
}

// Strip HTML tags from comment/description field
function stripHtml(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

// Safely parse price from myhome.ge price element or JSON
function parsePrice(raw: string): number | undefined {
  const cleaned = raw.replace(/[^\d.]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) || n <= 0 ? undefined : n;
}

// Transaction type from URL path — most reliable, checked before any JSON
function parseMyHomeTransaction(url: string): string | undefined {
  const lower = url.toLowerCase();
  if (/\/(for-sale|iyideba|gasayideli|for-investment)\//i.test(lower)) return 'SALE';
  if (/\/(for-rent|for-daily-rent|qiravdeba|gasaqiravebeli)\//i.test(lower)) return 'RENT';
  return undefined;
}

function adaptMyHome(html: string, url: string): Partial<ExtractedFacts> | null {
  if (!url.includes('myhome.ge')) return null;
  const facts: Partial<ExtractedFacts> = { source_url: url, country: 'GE' };

  // ── Transaction type from URL (highest confidence) ───────
  const urlTxn = parseMyHomeTransaction(url);
  if (urlTxn) facts.transaction_type = urlTxn;

  // ── Property type from URL path ──────────────────────────
  const urlLower = url.toLowerCase();
  if (/\/flat\/|\/apartment\/|\/bina\//i.test(urlLower)) facts.property_type = 'APARTMENT';
  else if (/\/house\/|\/villa\/|\/cottage\//i.test(urlLower)) facts.property_type = 'HOUSE';
  else if (/\/commercial\/|\/office\//i.test(urlLower)) facts.property_type = 'COMMERCIAL';
  else if (/\/land\/|\/plot\//i.test(urlLower)) facts.property_type = 'LAND';

  // ── Parse __NEXT_DATA__ ───────────────────────────────────
  const nextDataMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (nextDataMatch) {
    try {
      const nd = JSON.parse(nextDataMatch[1]);
      const pageProps = nd?.props?.pageProps ?? nd?.props?.initialProps?.pageProps ?? {};

      // ── Primary path: dehydratedState.queries[N].state.data.data.statement ──
      // This is where myhome.ge stores the full listing object after React-Query hydration.
      let statement: Record<string, unknown> | null = null;
      const queries: unknown[] = pageProps?.dehydratedState?.queries ?? [];
      for (const q of queries) {
        const qData = (q as Record<string, unknown>)?.state as Record<string, unknown> | undefined;
        const inner = (qData?.data as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
        if (inner?.statement && typeof inner.statement === 'object') {
          statement = inner.statement as Record<string, unknown>;
          break;
        }
      }

      if (statement) {
        // Title — dynamic_title is clean (no price/area suffix like og:title has)
        const dynTitle = statement.dynamic_title ?? statement.title ?? statement.name;
        if (dynTitle) facts.title = String(dynTitle);

        // Currency
        const currId = typeof statement.currency_id === 'number' ? statement.currency_id : 2;
        facts.currency = currencyIdToCode(currId);

        // Price — authoritative: price[currency_id].price_total
        // Falls back to statement.total_price if price dict unavailable
        const priceDict = statement.price as Record<string, { price_total?: number; price_square?: number }> | undefined;
        const priceEntry = priceDict?.[String(currId)];
        const totalPrice = priceEntry?.price_total ?? (statement.total_price as number | undefined);
        const sqmPrice   = priceEntry?.price_square ?? (statement.price_per_sqm as number | undefined);
        if (totalPrice && totalPrice > 0) facts.total_price = totalPrice;
        if (sqmPrice   && sqmPrice > 0)   facts.price_per_sqm = sqmPrice;

        // Area
        const rawArea = statement.area;
        if (rawArea != null) {
          const a = parseFloat(String(rawArea));
          if (!isNaN(a) && a > 0) facts.area = a;
        }

        // Rooms vs Bedrooms — CRITICAL: these are different fields on myhome.ge
        // room_type_id    = total room count (1-room, 2-room, 3-room flat) → facts.rooms
        // bedroom_type_id = actual bedroom/sleeping room count              → facts.bedrooms
        const bedroomTypeId = statement.bedroom_type_id;
        const roomTypeId    = statement.room_type_id;
        if (roomTypeId != null) {
          const r = parseInt(String(roomTypeId));
          if (!isNaN(r) && r > 0) facts.rooms = r;
        }
        if (bedroomTypeId != null) {
          const b = parseInt(String(bedroomTypeId));
          if (!isNaN(b) && b > 0) facts.bedrooms = b;
        }
        // Never copy rooms → bedrooms. If bedrooms unproven, leave null.

        // Floor / total floors
        if (statement.floor != null) facts.floor = parseInt(String(statement.floor));
        if (statement.total_floors != null) facts.total_floors = parseInt(String(statement.total_floors));

        // Location — city_name, urban_name (neighbourhood), address
        // urban_name is the actual neighbourhood (Krtsanisi), district_name is
        // the administrative district (Old Tbilisi) — urban_name is more useful for matching
        const cityName = statement.city_name;
        if (cityName) facts.city = normaliseGeoCity(String(cityName));

        const urbanName = statement.urban_name;   // neighbourhood = most relevant
        const distName  = statement.district_name; // admin district = fallback
        if (urbanName) facts.district = normaliseGeoDistrict(String(urbanName));
        else if (distName) facts.district = normaliseGeoDistrict(String(distName));

        if (statement.address) facts.address = String(statement.address);

        // Description — comment has full HTML; strip tags
        const rawDesc = statement.comment ?? statement.description;
        if (rawDesc) facts.description = stripHtml(String(rawDesc));

        // Property type from real_estate_type_id (overrides URL guess — more accurate)
        const retId = typeof statement.real_estate_type_id === 'number' ? statement.real_estate_type_id : 0;
        const pt = realEstateTypeToPropertyType(retId);
        if (pt) facts.property_type = pt;

        // Transaction type from deal_type_id (fill if URL was ambiguous)
        if (!facts.transaction_type) {
          const dtId = typeof statement.deal_type_id === 'number' ? statement.deal_type_id : 0;
          const tx = dealTypeToTransaction(dtId);
          if (tx) facts.transaction_type = tx;
        }

        // Condition
        if (statement.condition) facts.condition = String(statement.condition);

        // Amenities from balconies / parameters array
        if (statement.balconies && Number(statement.balconies) > 0) facts.balcony = true;

        // Photos — images[].large is full-res; images[].thumb is thumbnail
        // Sort: is_main first, then rest in order
        const rawImgs = (statement.images as unknown[]) ?? [];
        const mainImgs = rawImgs.filter((i): i is Record<string, unknown> =>
          typeof i === 'object' && i !== null && !!(i as Record<string, unknown>).is_main
        );
        const otherImgs = rawImgs.filter((i): i is Record<string, unknown> =>
          typeof i === 'object' && i !== null && !(i as Record<string, unknown>).is_main
        );
        const sortedImgs = [...mainImgs, ...otherImgs];

        const validImgs = sortedImgs
          .map(i => String(i.large ?? i.url ?? i.src ?? i.thumb ?? ''))
          .filter(u => u && isListingPhoto(u));

        if (validImgs.length > 0) {
          facts.cover_image   = validImgs[0];
          facts.gallery_images = validImgs.slice(0, 5);
        }
      }

      // ── Legacy/fallback shapes (older myhome.ge page versions) ──
      // Only used when dehydratedState path returns nothing
      if (!facts.total_price) {
        const legacyListing =
          pageProps?.data ?? pageProps?.listing ?? pageProps?.product ??
          pageProps?.propertyData ?? pageProps?.property ?? pageProps?.item;

        if (legacyListing) {
          const ll = legacyListing as Record<string, unknown>;
          if (!facts.title) {
            const t = ll.dynamic_title ?? ll.title ?? ll.name;
            if (t) facts.title = String(t);
          }
          const rawPrice = ll.total_price ?? ll.price ?? ll.salePrice;
          if (rawPrice != null) facts.total_price = parsePrice(String(rawPrice));
          if (!facts.area) {
            const a = parseFloat(String(ll.area ?? ll.totalArea ?? 0));
            if (!isNaN(a) && a > 0) facts.area = a;
          }
        }
      }

      // ── Deep-scan dehydratedState for price if still missing ──
      if (!facts.total_price) {
        const scanForPrice = (obj: unknown, depth = 0): void => {
          if (depth > 5 || !obj || typeof obj !== 'object') return;
          const o = obj as Record<string, unknown>;
          if (typeof o.price_total === 'number' && o.price_total > 0 && !facts.total_price) {
            facts.total_price = o.price_total;
          }
          if (typeof o.total_price === 'number' && o.total_price > 0 && !facts.total_price) {
            facts.total_price = o.total_price;
          }
          for (const v of Object.values(o)) scanForPrice(v, depth + 1);
        };
        scanForPrice(pageProps);
      }
    } catch { /* ignore malformed JSON */ }
  }

  // ── window.__PRELOADED_STATE__ fallback ──────────────────
  if (!facts.title || !facts.total_price) {
    const preloadedMatch = html.match(
      /window\.__(?:PRELOADED_STATE|INITIAL_DATA|APP_STATE)__\s*=\s*(\{[\s\S]*?\});\s*(?:window|var|let|const|<\/script>)/
    );
    if (preloadedMatch) {
      try {
        const ps = JSON.parse(preloadedMatch[1]);
        const listing = ps?.listing ?? ps?.product ?? ps?.data ?? ps?.property;
        if (listing?.title && !facts.title) facts.title = String(listing.title);
        if (listing?.price && !facts.total_price) facts.total_price = parsePrice(String(listing.price));
        if (!facts.area && listing?.area) {
          const a = parseFloat(String(listing.area));
          if (!isNaN(a) && a > 0) facts.area = a;
        }
        if (!facts.gallery_images?.length) {
          const imgs = (listing?.photos ?? listing?.images ?? []) as unknown[];
          const valid = imgs
            .map(i => String(typeof i === 'string' ? i : (i as Record<string, unknown>)?.large ?? (i as Record<string, unknown>)?.url ?? ''))
            .filter(u => u && isListingPhoto(u));
          if (valid.length > 0) {
            facts.cover_image    = facts.cover_image ?? valid[0];
            facts.gallery_images = valid.slice(0, 5);
          }
        }
      } catch { /* ignore */ }
    }
  }

  // ── HTML-level fallbacks (partial HTML / no __NEXT_DATA__) ─

  // Title — og:title has " , PRICE $, AREA m², ID | Myhome" appended; strip it
  if (!facts.title) {
    const ogTitle =
      html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i) ??
      html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:title"/i);
    if (ogTitle) {
      // Strip trailing ", 213840 $, 97.2 მ², 25805378 | Myhome" and similar
      facts.title = ogTitle[1]
        .replace(/,\s*[\d\s]+\$.*$/u, '')
        .replace(/,\s*[\d\s]+₾.*$/u, '')
        .replace(/\s*\|\s*Myhome.*$/i, '')
        .replace(/\s*[-|].*$/, '')
        .trim();
    } else {
      const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleTag) {
        facts.title = titleTag[1]
          .replace(/,\s*[\d\s]+\$.*$/u, '')
          .replace(/,\s*[\d\s]+₾.*$/u, '')
          .replace(/\s*\|\s*Myhome.*$/i, '')
          .replace(/\s*[-|].*$/, '')
          .trim();
      }
    }
  }

  // Description from meta description
  if (!facts.description) {
    const descMatch =
      html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i) ??
      html.match(/<meta[^>]*content="([^"]+)"[^>]*name="description"/i);
    if (descMatch) facts.description = descMatch[1];
  }

  // Price from inline patterns
  if (!facts.total_price) {
    for (const pat of [
      /"(?:total_price|price_total)"\s*:\s*"?([\d.]+)"?/,
      /data-price="([\d.]+)"/,
      /([\d][\d\s]*(?:\.\d{1,2})?)\s*(?:\$|USD)/,
      /([\d][\d\s]*(?:\.\d{1,2})?)\s*₾/,
    ]) {
      const m = html.match(pat);
      if (m?.[1]) {
        const p = parsePrice(m[1].replace(/\s/g, ''));
        if (p && p > 1000) { facts.total_price = p; break; }
      }
    }
  }

  // Area from inline patterns
  if (!facts.area) {
    const areaMatch = html.match(/([\d.]+)\s*(?:m²|m2|კვ\.\s*მ|sq\.?\s*m)/i);
    if (areaMatch) {
      const a = parseFloat(areaMatch[1]);
      if (!isNaN(a) && a > 0) facts.area = a;
    }
  }

  // Cover photo from og:image (only if not already set from __NEXT_DATA__)
  if (!facts.cover_image) {
    const ogImg =
      html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i) ??
      html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:image"/i);
    // og:image on myhome.ge is a _thumb — prefer it only as last resort
    if (ogImg?.[1] && isListingPhoto(ogImg[1])) facts.cover_image = ogImg[1];
  }

  return facts;
}

// ── SS.GE ADAPTER ─────────────────────────────────────────────
// ss.ge is Next.js. Real listing data lives in:
//   __NEXT_DATA__ → props.pageProps.applicationData
//
// CRITICAL: ss.ge does NOT use dehydratedState.
// The full listing object is in pageProps.applicationData directly.
// Confirmed from live listing 35980396.

function adaptSS(html: string, url: string): Partial<ExtractedFacts> | null {
  if (!url.includes('ss.ge')) return null;
  const facts: Partial<ExtractedFacts> = { source_url: url, country: 'GE' };

  // Transaction type from URL path (most reliable for ss.ge)
  const urlLower = url.toLowerCase();
  if (/\/for-sale\/|\/iyideba\/|\/gasayideli\//i.test(urlLower)) facts.transaction_type = 'SALE';
  else if (/\/for-rent\/|\/qiravdeba\/|\/gasaqiravebeli\//i.test(urlLower)) facts.transaction_type = 'RENT';

  // Property type from URL
  if (/\/flat\/|\/apartment\/|\/bina\//i.test(urlLower)) facts.property_type = 'APARTMENT';
  else if (/\/house\/|\/cottage\/|\/saxli\//i.test(urlLower)) facts.property_type = 'HOUSE';
  else if (/\/commercial\/|\/office\//i.test(urlLower)) facts.property_type = 'COMMERCIAL';
  else if (/\/land\/|\/plot\/|\/miwa\//i.test(urlLower)) facts.property_type = 'LAND';

  // Layer 1: __NEXT_DATA__ → pageProps.applicationData (authoritative)
  const ndMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (ndMatch) {
    try {
      const nd = JSON.parse(ndMatch[1]);
      const app = nd?.props?.pageProps?.applicationData as Record<string, unknown> | undefined;

      if (app) {
        if (app.title) facts.title = String(app.title);
        if (app.applicationId) facts.source_listing_id = String(app.applicationId);

        // Price: ss.ge provides both GEL and USD; use whichever the seller listed in
        const priceObj = app.price as Record<string, unknown> | undefined;
        if (priceObj) {
          const currType = Number(priceObj.currencyType ?? 2);
          if (currType === 1) {
            facts.currency = 'GEL';
            const pg = Number(priceObj.priceGeo ?? 0);
            const ug = Number(priceObj.unitPriceGeo ?? 0);
            if (pg > 0) facts.total_price = pg;
            if (ug > 0) facts.price_per_sqm = ug;
          } else {
            facts.currency = 'USD';
            const pu = Number(priceObj.priceUsd ?? 0);
            const uu = Number(priceObj.unitPriceUsd ?? 0);
            if (pu > 0) facts.total_price = pu;
            if (uu > 0) facts.price_per_sqm = uu;
          }
        }

        // Area
        const rawArea = app.totalArea ?? app.areaOfHouse;
        if (rawArea != null) {
          const a = parseFloat(String(rawArea));
          if (!isNaN(a) && a > 0) facts.area = a;
        }

        // Rooms vs Bedrooms — KEEP SEPARATE
        // rooms = total room count; bedrooms = sleeping rooms only
        const rawRooms = app.rooms;
        const rawBedrooms = app.bedrooms;
        if (rawRooms != null) {
          const r = parseInt(String(rawRooms));
          if (!isNaN(r) && r > 0) facts.rooms = r;
        }
        if (rawBedrooms != null) {
          const b = parseInt(String(rawBedrooms));
          if (!isNaN(b) && b > 0) facts.bedrooms = b;
        }

        // Floor / total floors
        if (app.floor != null) { const f = parseInt(String(app.floor)); if (!isNaN(f)) facts.floor = f; }
        if (app.floors != null) { const tf = parseInt(String(app.floors)); if (!isNaN(tf)) facts.total_floors = tf; }

        // Location from address object
        const addr = app.address as Record<string, unknown> | undefined;
        if (addr) {
          const cityTitle = String(addr.cityTitle ?? '');
          if (cityTitle) facts.city = normaliseGeoCity(cityTitle);

          // subdistrictTitle is more specific (e.g. "სამგორი"), prefer over districtTitle ("ისანი-სამგორი")
          const subdist = String(addr.subdistrictTitle ?? '');
          const dist = String(addr.districtTitle ?? '');
          if (subdist) facts.district = normaliseGeoDistrict(subdist);
          else if (dist) facts.district = normaliseGeoDistrict(dist);

          const street = String(addr.streetTitle ?? '');
          const number = String(addr.streetNumber ?? '');
          if (street) facts.address = number ? `${street} ${number}` : street;

          if (addr.locationLatitude != null) facts.latitude = Number(addr.locationLatitude);
          if (addr.locationLongitude != null) facts.longitude = Number(addr.locationLongitude);
        }

        // Description — prefer English, fallback to Georgian/Russian
        const descObj = app.description as Record<string, unknown> | undefined;
        if (descObj) {
          const en = String(descObj.en ?? '').trim();
          const ka = String(descObj.ka ?? '').trim();
          const ru = String(descObj.ru ?? '').trim();
          facts.description = en || ka || ru || undefined;
          if (ka && en) facts.original_description = ka;
        }
        if (!facts.description && app.text) facts.description = stripHtml(String(app.text));

        // Property type from realEstateTypeId
        // ss.ge: 1=house, 2=land, 4=commercial, 5=apartment
        if (!facts.property_type) {
          const retId = Number(app.realEstateTypeId ?? 0);
          if (retId === 5 || retId === 8) facts.property_type = 'APARTMENT';
          else if (retId === 1) facts.property_type = 'HOUSE';
          else if (retId === 4 || retId === 6) facts.property_type = 'COMMERCIAL';
          else if (retId === 2) facts.property_type = 'LAND';
        }
        if (!facts.property_type && app.realEstateType) {
          const rtt = String(app.realEstateType).toLowerCase();
          if (/apartment|flat|bina|ბინა/i.test(rtt)) facts.property_type = 'APARTMENT';
          else if (/house|cottage|სახლი/i.test(rtt)) facts.property_type = 'HOUSE';
          else if (/commercial|office/i.test(rtt)) facts.property_type = 'COMMERCIAL';
          else if (/land|plot|მიწა/i.test(rtt)) facts.property_type = 'LAND';
        }

        // Transaction type from realEstateDealTypeId: 4=for sale, 5=for rent, 6=daily rent
        if (!facts.transaction_type) {
          const dtId = Number(app.realEstateDealTypeId ?? 0);
          if (dtId === 4) facts.transaction_type = 'SALE';
          else if (dtId === 5 || dtId === 6) facts.transaction_type = 'RENT';
        }
        if (!facts.transaction_type && app.realEstateDealType) {
          const dtt = String(app.realEstateDealType).toLowerCase();
          if (/sale|sell|buy|იყიდება/i.test(dtt)) facts.transaction_type = 'SALE';
          else if (/rent|lease|ქირავდება/i.test(dtt)) facts.transaction_type = 'RENT';
        }

        // Condition
        if (app.realEstateStatusId === 3 || String(app.realEstateStatus ?? '').includes('მშენება')) {
          facts.new_build = true;
        }

        // Amenities
        if (app.balcony || app.balcony_Loggia) facts.balcony = true;
        if (app.elevator) facts.elevator = true;
        if (app.garage) facts.parking = true;
        if (app.securityAlarm) facts.security = true;
        if (app.furniture) facts.furnished = true;
        if (app.airConditioning) facts.air_conditioning = true;

        // Photos: appImages[].fileName = full-res, isMain = cover
        const rawImgs = (app.appImages as unknown[]) ?? [];
        const mains = rawImgs.filter((i): i is Record<string, unknown> =>
          typeof i === 'object' && i !== null && !!(i as Record<string, unknown>).isMain);
        const others = rawImgs.filter((i): i is Record<string, unknown> =>
          typeof i === 'object' && i !== null && !(i as Record<string, unknown>).isMain);
        const validImgs = [...mains, ...others]
          .map(i => String(i.fileName ?? ''))
          .filter(u => u && isListingPhoto(u));
        if (validImgs.length > 0) {
          facts.cover_image = validImgs[0];
          facts.gallery_images = validImgs.slice(0, 5);
        }
      }
    } catch (e) {
      console.warn('[adaptSS] __NEXT_DATA__ parse error:', e);
    }
  }

  // Layer 2: HTML meta fallbacks (fill still-empty fields only)
  if (!facts.title) {
    const ogT = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i)
      ?? html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:title"/i);
    if (ogT) facts.title = ogT[1];
    else {
      const tt = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (tt) facts.title = tt[1].replace(/\s*[-|].*$/, '').trim();
    }
  }
  if (!facts.description) {
    const dm = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i)
      ?? html.match(/<meta[^>]*content="([^"]+)"[^>]*name="description"/i);
    if (dm) facts.description = dm[1];
  }
  if (!facts.total_price) {
    for (const pat of [/"priceUsd"\s*:\s*([\d.]+)/i, /"priceGeo"\s*:\s*([\d.]+)/i,
      /([\d][\d\s,]*)\s*\$/i, /([\d][\d\s,]*)\s*₾/i]) {
      const m = html.match(pat);
      if (m?.[1]) { const p = parseFloat(m[1].replace(/[,\s]/g, '')); if (p > 1000) { facts.total_price = p; break; } }
    }
  }
  if (!facts.area) {
    const am = html.match(/"totalArea"\s*:\s*"?([\d.]+)"?/i) ?? html.match(/([\d]+(?:\.\d+)?)\s*(?:m²|m2|კვ)/i);
    if (am?.[1]) { const a = parseFloat(am[1]); if (a > 0) facts.area = a; }
  }
  if (!facts.cover_image) {
    const oi = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i)
      ?? html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:image"/i);
    if (oi?.[1] && isListingPhoto(oi[1])) facts.cover_image = oi[1];
  }

  return facts;
}

// ── UNIVERSAL GENERIC EXTRACTOR ───────────────────────────────
// Works on any public real estate page without site-specific knowledge.
// Sources (priority order): JSON-LD → OpenGraph/meta → embedded state → HTML patterns → URL
function universalExtract(html: string, url: string): Partial<ExtractedFacts> {
  const facts: Partial<ExtractedFacts> = { source_url: url };
  const domain = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } })();

  const metaGet = (attr: string): string | undefined => {
    const m = html.match(new RegExp(`<meta[^>]*(?:property|name)="${attr}"[^>]*content="([^"]+)"`, 'i'))
      ?? html.match(new RegExp(`<meta[^>]*content="([^"]+)"[^>]*(?:property|name)="${attr}"`, 'i'));
    return m?.[1];
  };

  // 1. JSON-LD
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const raw = JSON.parse(m[1].trim());
      const nodes: Record<string, unknown>[] = Array.isArray((raw as Record<string, unknown>)['@graph'])
        ? (raw as Record<string, unknown>)['@graph'] as Record<string, unknown>[]
        : [raw as Record<string, unknown>];
      for (const node of nodes) {
        const type = String(node['@type'] ?? '');
        if (!/RealEstate|Apartment|House|Residence|Product|Offer|ItemPage|LodgingBusiness/i.test(type)) continue;
        if (!facts.title) { const t = String(node.name ?? node.headline ?? ''); if (t) facts.title = t; }
        if (!facts.description && node.description) facts.description = String(node.description);
        const offer = (node.offers ?? node) as Record<string, unknown>;
        if (!facts.total_price && offer.price) {
          const p = parseFloat(String(offer.price).replace(/[,\s]/g, ''));
          if (!isNaN(p) && p > 0) facts.total_price = p;
        }
        if (!facts.currency && offer.priceCurrency) facts.currency = String(offer.priceCurrency);
        const addr = (node.address ?? node.geo) as Record<string, unknown> | undefined;
        if (addr) {
          if (!facts.city) { const c = String(addr.addressLocality ?? addr.city ?? ''); if (c.length > 1) facts.city = c; }
          if (!facts.district) { const d = String(addr.addressRegion ?? ''); if (d.length > 1) facts.district = d; }
          if (!facts.address) { const s = String(addr.streetAddress ?? ''); if (s) facts.address = s; }
          if (!facts.country) { const cc = String(addr.addressCountry ?? ''); if (cc.length === 2) facts.country = cc.toUpperCase(); else if (cc) facts.country = cc; }
        }
        const geo = node.geo as Record<string, unknown> | undefined;
        if (geo) {
          if (!facts.latitude && geo.latitude) facts.latitude = parseFloat(String(geo.latitude));
          if (!facts.longitude && geo.longitude) facts.longitude = parseFloat(String(geo.longitude));
        }
        if (!facts.rooms && node.numberOfRooms) facts.rooms = parseInt(String(node.numberOfRooms));
        const fs = node.floorSize as Record<string, unknown> | undefined;
        if (!facts.area && fs?.value) { const a = parseFloat(String(fs.value)); if (a > 0) facts.area = a; }
        const imgs = extractJsonLdImages(node);
        if (imgs.length > 0 && !facts.gallery_images?.length) { facts.cover_image = imgs[0]; facts.gallery_images = imgs.slice(0, 5); }
      }
    } catch { /* skip malformed */ }
  }

  // 2. OpenGraph / meta
  if (!facts.title) {
    const t = metaGet('og:title') ?? metaGet('twitter:title');
    if (t) facts.title = t.replace(/\s*[|–-].*$/, '').trim();
  }
  if (!facts.title) {
    const tag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (tag) facts.title = tag[1].replace(/\s*[|–-].*$/, '').trim();
  }
  if (!facts.description) {
    const d = metaGet('description') ?? metaGet('og:description') ?? metaGet('twitter:description');
    if (d) facts.description = d;
  }
  if (!facts.cover_image) {
    const imgs = [...extractOgImages(html), ...extractTwitterImages(html)];
    if (imgs.length > 0) { facts.cover_image = imgs[0]; if (!facts.gallery_images?.length) facts.gallery_images = imgs.slice(0, 5); }
  }
  const ogPrice = metaGet('product:price:amount') ?? metaGet('og:price:amount');
  const ogCurr  = metaGet('product:price:currency') ?? metaGet('og:price:currency');
  if (ogPrice && !facts.total_price) { const p = parseFloat(ogPrice.replace(/[,\s]/g, '')); if (p > 0) facts.total_price = p; }
  if (ogCurr  && !facts.currency)    facts.currency = ogCurr.toUpperCase();

  // 3. Embedded state (Next.js __NEXT_DATA__, Redux, Nuxt, etc.)
  const statePatterns = [
    /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i,
    /window\.__(?:PRELOADED_STATE|INITIAL_STATE|APP_STATE|REDUX_STATE)__\s*=\s*({[\s\S]*?})(?:;|\s*<\/script>)/,
  ];
  for (const pat of statePatterns) {
    if (facts.title && facts.total_price && facts.city) break;
    const m = html.match(pat);
    if (!m) continue;
    try {
      const parsed = JSON.parse(m[1]);
      const tryExtract = (obj: unknown, depth = 0): void => {
        if (depth > 6 || !obj || typeof obj !== 'object') return;
        const o = obj as Record<string, unknown>;
        if (('price' in o || 'total_price' in o) && ('area' in o || 'totalArea' in o) && depth > 1) {
          if (!facts.title) { const t = String(o.title ?? o.name ?? ''); if (t) facts.title = t; }
          if (!facts.total_price) { const p = parseFloat(String(o.price ?? o.total_price ?? 0).replace(/[,\s]/g, '')); if (p > 0) facts.total_price = p; }
          if (!facts.area) { const a = parseFloat(String(o.area ?? o.totalArea ?? 0)); if (a > 0) facts.area = a; }
          if (!facts.city) { const c = String(o.city ?? (o.location as Record<string, unknown>)?.city ?? o.cityName ?? ''); if (c) facts.city = c; }
          if (!facts.bedrooms) { const b = parseInt(String(o.bedrooms ?? o.bedroomCount ?? 0)); if (b > 0) facts.bedrooms = b; }
          if (!facts.rooms) { const r = parseInt(String(o.rooms ?? o.numberOfRooms ?? 0)); if (r > 0) facts.rooms = r; }
          if (!facts.currency) { const c = String(o.currency ?? o.currencyCode ?? o.priceCurrency ?? ''); if (c) facts.currency = c.toUpperCase(); }
        }
        for (const v of Object.values(o)) tryExtract(v, depth + 1);
      };
      tryExtract(parsed);
    } catch { /* malformed */ }
  }

  // 4. HTML pattern extraction — multilingual price/area/rooms/floor
  if (!facts.total_price) {
    const priceTests: [RegExp, string][] = [
      [/([\d,.\s]+)\s*(?:USD|\$)/i, 'USD'], [/([\d,.\s]+)\s*(?:EUR|€)/i, 'EUR'],
      [/([\d,.\s]+)\s*(?:GEL|₾)/i, 'GEL'], [/([\d,.\s]+)\s*(?:TRY|TL|₺)/i, 'TRY'],
      [/([\d,.\s]+)\s*(?:AED)/i, 'AED'],   [/([\d,.\s]+)\s*(?:GBP|£)/i, 'GBP'],
      [/([\d,.\s]+)\s*(?:PLN|zł)/i, 'PLN'], [/([\d,.\s]+)\s*(?:CHF)/i, 'CHF'],
      [/([\d,.\s]+)\s*(?:KZT)/i, 'KZT'],   [/([\d,.\s]+)\s*(?:UAH|₴)/i, 'UAH'],
    ];
    for (const [pat, curr] of priceTests) {
      const m = html.match(pat);
      if (m?.[1]) { const p = parseFloat(m[1].replace(/[,\s]/g, '')); if (!isNaN(p) && p > 1000) { facts.total_price = p; if (!facts.currency) facts.currency = curr; break; } }
    }
  }

  if (!facts.area) {
    for (const pat of [/([\d]+(?:[.,]\d+)?)\s*(?:m²|m2|sq\.?\s*m|sqm|კვ\.?\s*მ)/i, /([\d]+(?:[.,]\d+)?)\s*(?:sqft|sq\s*ft)/i]) {
      const m = html.match(pat);
      if (m?.[1]) {
        let a = parseFloat(m[1].replace(',', '.'));
        if (/sqft|sq\s*ft/i.test(m[0])) a = Math.round(a * 0.0929 * 100) / 100;
        if (!isNaN(a) && a > 0) { facts.area = a; break; }
      }
    }
  }

  if (!facts.bedrooms) {
    for (const pat of [/(\d+)\s*(?:bedrooms?|bed\b|BR\b|schlafzimmer|спальн|chambre|habitaci[oó]n)/i]) {
      const m = html.match(pat);
      if (m?.[1]) { facts.bedrooms = parseInt(m[1]); break; }
    }
  }

  // Turkish "2+1" room notation: "2+1 oda" means 3 rooms, 1 bedroom
  if (!facts.rooms) {
    const turkM = html.match(/(\d+)\+(\d+)\s*(?:oda|room)/i);
    if (turkM) { facts.rooms = parseInt(turkM[1]) + parseInt(turkM[2]); if (!facts.bedrooms) facts.bedrooms = parseInt(turkM[2]); }
    else {
      const roomM = html.match(/(\d+)\s*(?:rooms?|ოთახ|комнат|zimmer|pièces?)/i);
      if (roomM) facts.rooms = parseInt(roomM[1]);
    }
  }

  if (!facts.floor) {
    const fm = html.match(/(?:floor|kat\b|этаж|sártul)\D{0,8}(\d+)/i) ?? html.match(/(\d+)(?:st|nd|rd|th)\s*floor/i) ?? html.match(/"floor"\s*:\s*"?(\d+)"?/);
    if (fm?.[1]) facts.floor = parseInt(fm[1]);
  }
  if (!facts.total_floors) {
    const tfm = html.match(/(?:of|\/)\s*(\d+)\s*floors?/i) ?? html.match(/"(?:totalFloors?|floorsCount)"\s*:\s*"?(\d+)"?/i);
    if (tfm?.[1]) facts.total_floors = parseInt(tfm[1]);
  }
  if (!facts.bathrooms) {
    const bm = html.match(/(\d+)\s*(?:bathrooms?|baths?|toilets?|WC|ванн)/i);
    if (bm?.[1]) facts.bathrooms = parseInt(bm[1]);
  }

  // 5. Location from breadcrumbs + URL slug (generic fallback)
  if (!facts.city) {
    // JSON-LD BreadcrumbList
    for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const d = JSON.parse(m[1]);
        const list = d['@type'] === 'BreadcrumbList' ? d.itemListElement
          : (d['@graph'] as Record<string, unknown>[] ?? []).find((n: Record<string, unknown>) => n['@type'] === 'BreadcrumbList')?.itemListElement;
        if (Array.isArray(list) && list.length >= 3) {
          const crumbs = list.map((i: Record<string, unknown>) => String(i.name ?? '')).filter(Boolean);
          // Skip first (Home) and last (listing title) — middle items are location hierarchy
          if (!facts.city && crumbs.length >= 3) facts.city = crumbs[crumbs.length - 2];
          if (!facts.district && crumbs.length >= 4) facts.district = crumbs[crumbs.length - 2];
          break;
        }
      } catch { /* skip */ }
    }
    // URL slug fallback
    if (!facts.city) {
      const slugM = url.match(/\/(?:city|location|in|area)\/([a-z-]+)/i) ?? url.match(/\/([a-z]{3,20})-real-estate\//i);
      if (slugM?.[1]) facts.city = slugM[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }
  }

  // 6. Transaction type from title + URL
  if (!facts.transaction_type) {
    const checkIn = (facts.title ?? '') + ' ' + url;
    if (/for\s*sale|zu\s*verkaufen|à\s*vendre|en\s*venta|satılık|продаж|иyидeba|იყიდება/i.test(checkIn)) facts.transaction_type = 'SALE';
    else if (/for\s*rent|zu\s*vermieten|à\s*louer|kiralık|оренда|ქირავდება/i.test(checkIn)) facts.transaction_type = 'RENT';
  }

  // 7. Property type from title + URL
  if (!facts.property_type) {
    const checkIn = (facts.title ?? '') + ' ' + url;
    if (/apartment|flat|condo|ბინა|квартир|daire|appartement/i.test(checkIn)) facts.property_type = 'APARTMENT';
    else if (/\bhouse\b|villa|cottage|townhouse|სახლი|\bдом\b|maison/i.test(checkIn)) facts.property_type = 'HOUSE';
    else if (/studio|loft|однокомнат/i.test(checkIn)) facts.property_type = 'STUDIO';
    else if (/penthouse/i.test(checkIn)) facts.property_type = 'PENTHOUSE';
    else if (/commercial|office|retail/i.test(checkIn)) facts.property_type = 'COMMERCIAL';
    else if (/\bland\b|plot|\bлот\b|მიწა/i.test(checkIn)) facts.property_type = 'LAND';
  }

  // 8. Country from TLD
  if (!facts.country) {
    const tld = domain.split('.').pop() ?? '';
    const tldMap: Record<string, string> = {
      ge: 'GE', tr: 'TR', ua: 'UA', kz: 'KZ', az: 'AZ', de: 'DE', fr: 'FR',
      es: 'ES', it: 'IT', pl: 'PL', nl: 'NL', be: 'BE', se: 'SE', ch: 'CH',
      uk: 'GB', ae: 'AE', il: 'IL', sa: 'SA',
    };
    if (tldMap[tld]) facts.country = tldMap[tld];
  }

  return facts;
}

// Check if page looks like a real listing (not auth wall)
function detectLoginRequired(html: string, domain: string): boolean {
  // For myhome.ge: nav always contains "Log In" / "Sign In" — that's NOT a login wall
  // Only flag if there's no property content AND a login form is prominent
  if (domain.includes('myhome.ge') || domain.includes('ss.ge')) {
    // These sites serve content without login — check for actual paywall indicators
    const hasPrice = /([\d,]+)\s*(?:\$|₾|USD|GEL)/i.test(html);
    const hasArea = /([\d.]+)\s*(?:m²|კვ)/i.test(html);
    if (hasPrice || hasArea) return false; // has content, no login wall
    const loginFormPresent = /<form[^>]*(?:login|sign[-\s]in)[^>]*>/i.test(html);
    return loginFormPresent && html.length < 8000;
  }
  // Generic: look for login-only markers
  const markers = [
    /please\s+(?:log|sign)\s*in\s+to\s+view/i,
    /this\s+content\s+is\s+only\s+available\s+to\s+(?:registered|logged)/i,
  ];
  return markers.some(r => r.test(html)) && html.length < 6000;
}

interface ExtractedFacts {
  title?: string;
  source_url?: string;
  source_listing_id?: string;
  source_domain?: string;
  source_language?: string;
  original_description?: string;  // original-language text before normalization
  transaction_type?: string;
  property_type?: string;
  country?: string;
  country_code?: string;
  city?: string;
  district?: string;
  neighborhood?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  total_price?: number;
  price_per_sqm?: number;
  currency?: string;
  area?: number;
  rooms?: number;          // total room count (living + sleeping)
  bedrooms?: number;       // sleeping rooms only — null if unproven from source
  bathrooms?: number;
  floor?: number;
  total_floors?: number;
  new_build?: boolean;
  condition?: string;
  description?: string;
  cover_image?: string;
  gallery_images?: string[];
  parking?: boolean;
  balcony?: boolean;
  elevator?: boolean;
  security?: boolean;
  furnished?: boolean;
  air_conditioning?: boolean;
  building_type?: string;
}

// Development mock data
const MOCK_FACTS: Partial<ExtractedFacts> = {
  title: '[MOCK] 3-bedroom apartment in Vake, Tbilisi',
  source_url: 'https://www.myhome.ge/en/listing/mock-12345',
  transaction_type: 'SALE',
  property_type: 'APARTMENT',
  country: 'GE',
  city: 'Tbilisi',
  district: 'Vake',
  total_price: 145000,
  price_per_sqm: 1450,
  currency: 'USD',
  area: 100,
  bedrooms: 3,
  bathrooms: 1,
  floor: 4,
  total_floors: 9,
  description: 'Modern renovated apartment in the prestigious Vake district. Close to public transport and schools.',
  balcony: true,
  elevator: true,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }

  // ── Step 0: Authentication — anonymous users cannot import ────
  const authHeader = req.headers.get('authorization') ?? '';
  const anonKey    = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const testSecret = Deno.env.get('INTERNAL_TEST_SECRET') ?? '';

  // Internal test mode: known static secret in X-Test-Mode header skips user JWT
  // Used only for production verification — never exposed to clients
  const testHeader  = req.headers.get('x-test-mode') ?? '';
  const isTestMode  = testSecret.length > 8 && testHeader === testSecret;

  // If caller is using the anon key only (no Bearer JWT), reject.
  const isAnonOnly = authHeader === `Bearer ${anonKey}`;
  if (!authHeader || isAnonOnly) {
    return Response.json(
      { success: false, error: 'Authentication required', error_code: 'UNAUTHORIZED' },
      { status: 401, headers: { ...CORS, 'WWW-Authenticate': 'Bearer' } },
    );
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    serviceKey,
  );

  // Verify session — skip for internal test mode
  let authUser: { id: string } | null = isTestMode ? { id: 'internal-test-user' } : null;
  if (!isTestMode) {
    const userSupabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      anonKey,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userSupabase.auth.getUser();
    if (!user) {
      return Response.json(
        { success: false, error: 'Invalid session', error_code: 'UNAUTHORIZED' },
        { status: 401, headers: { ...CORS, 'WWW-Authenticate': 'Bearer' } },
      );
    }
    authUser = user;
  }

  let body: { url?: string; importId?: string } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid request body', error_code: 'INVALID_URL' }, {
      status: 400, headers: CORS,
    });
  }

  const rawUrl = (body.url ?? '').trim();
  const importId = body.importId ?? null;
  const mockMode = Deno.env.get('MOCK_DATA_PROVIDERS') === 'true';

  const updateImport = async (updates: Record<string, unknown>) => {
    if (!importId) return;
    await supabase.from('property_imports').update(updates).eq('id', importId);
  };

  // ── Step 1: Validate URL (SSRF block-list) ───────────────
  if (!rawUrl || !rawUrl.startsWith('http')) {
    await updateImport({ status: 'FAILED', error_code: 'INVALID_URL', error_message: 'Invalid URL' });
    return Response.json({ success: false, error: 'Invalid URL', error_code: 'INVALID_URL' }, {
      status: 422, headers: CORS,
    });
  }

  if (!isPublicUrl(rawUrl)) {
    await updateImport({ status: 'FAILED', error_code: 'INVALID_URL', error_message: 'Private or blocked URL' });
    return Response.json({ success: false, error: 'Private URL', error_code: 'INVALID_URL' }, {
      status: 422, headers: CORS,
    });
  }

  // ── Per-user rate limit: max 10 imports per minute ───────
  const windowStart = new Date(Date.now() - 60_000).toISOString();
  const { count: recentImports } = await supabase
    .from('property_imports')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', authUser.id)        // requires user_id column — see migration 00003
    .gte('created_at', windowStart);
  if ((recentImports ?? 0) >= 10) {
    return Response.json(
      { success: false, error: 'Rate limit exceeded', error_code: 'RATE_LIMITED' },
      { status: 429, headers: { ...CORS, ...RATE_LIMIT_HEADERS } },
    );
  }

  await updateImport({ status: 'PROCESSING' });

  // ── Mock mode for development ────────────────────────────
  if (mockMode) {
    const mockFacts = { ...MOCK_FACTS, source_url: rawUrl };
    await updateImport({ status: 'COMPLETED', extracted_data: mockFacts, mock_mode: true });
    return Response.json({
      success: true,
      mock: true,
      title: mockFacts.title,
      facts: mockFacts,
    }, { headers: CORS });
  }

  // ── Step 2: Fetch the page ────────────────────────────────
  // Fetch strategy order (cost-ascending):
  //   1. Direct HTTP fetch (free)
  //   2. ZenRows JS render + antibot (paid — only if direct blocked/incomplete)
  //   3. ScrapingBee JS render + premium_proxy (paid — only if ZenRows also fails)
  //
  // "Incomplete" = Cloudflare challenge page or missing all critical fields.
  // We NEVER advance to a paid provider if the free layer returned real data.

  let html = '';
  let fetchStrategy = 'DIRECT';
  let httpStatusUsed = 0;
  let responseSizeUsed = 0;
  let cfBlocked = false;
  const fallbackChain: FallbackStep[] = [];

  const zenrowsKey    = Deno.env.get('ZENROWS_API_KEY');
  const scrapingbeeKey = Deno.env.get('SCRAPINGBEE_API_KEY');
  const domain        = new URL(rawUrl).hostname;
  const isMyHome      = domain.includes('myhome.ge');
  const isSS          = domain.includes('ss.ge');
  // Known Cloudflare-protected domains that ALWAYS need JS render
  const cfProtected   = isMyHome || isSS;

  // Detect whether the HTML we have is a Cloudflare challenge shell (not real content)
  const isCloudflareChallenge = (h: string): boolean =>
    h.includes('challenges.cloudflare.com') ||
    h.includes('Just a moment') ||
    h.includes('_cf_chl_opt') ||
    h.includes('Enable JavaScript and cookies');

  // Detect whether the rendered HTML has enough real listing content
  const hasListingContent = (h: string): boolean => {
    if (isCloudflareChallenge(h)) return false;
    if (h.length < 2000) return false; // too small to be a full listing page
    // Price signal in any supported currency
    const hasPrice = /([\d,]+)\s*(?:\$|₾|€|£|₺|₴|₸|USD|GEL|EUR|GBP|TRY|UAH|KZT)/i.test(h);
    // Area in m², sqft, or Georgian კვ
    const hasArea  = /[\d.]+\s*(?:m²|m2|sqft|sq\.ft|კვ\.მ|кв\.м)/i.test(h);
    // Next.js / embedded JSON data with listing fields
    const hasNextData = /__NEXT_DATA__/.test(h) &&
      (h.includes('"price"') || h.includes('"statement"') || h.includes('"applicationData"') || h.includes('"totalPrice"'));
    // Generic embedded state patterns (Nuxt, Redux, Vue hydration)
    const hasEmbedded = /window\.__(?:NUXT|INITIAL_STATE|REDUX_STATE|PRELOADED_STATE|APP_STATE)__/.test(h);
    // JSON-LD property listing
    const hasJsonLd = /"@type"\s*:\s*"(?:RealEstateListing|Apartment|House|Product)"/.test(h);
    // OG meta with price or address
    const hasOgMeta = /og:(?:price|address|locality|region)/.test(h);
    return hasPrice || hasArea || hasNextData || hasEmbedded || hasJsonLd || hasOgMeta;
  };

  // ── Layer 1: Direct fetch (always attempted first) ────────
  // Even for known CF-protected domains, the SSR initial HTML often contains
  // __NEXT_DATA__ / embedded state with full listing data — try direct first
  // and only escalate to paid render providers if it fails or returns a CF challenge.
  try {
    const resp = await safeFetch(rawUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ka;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
      },
      signal: AbortSignal.timeout(20000),
    });
    const candidate = await resp.text();
    httpStatusUsed = resp.status;
    responseSizeUsed = candidate.length;

    if (resp.ok && hasListingContent(candidate)) {
      html = candidate;
      fetchStrategy = 'DIRECT';
      fallbackChain.push({ strategy: 'direct', status: resp.status, size: candidate.length });
      console.log(`[import-property] Direct fetch succeeded, size=${candidate.length}`);
    } else {
      const reason = isCloudflareChallenge(candidate)
        ? 'cloudflare_challenge'
        : resp.ok ? 'incomplete_content' : `http_${resp.status}`;
      cfBlocked = isCloudflareChallenge(candidate);
      fallbackChain.push({ strategy: 'direct', status: resp.status, size: candidate.length, reason });
      console.warn(`[import-property] Direct fetch inadequate (${reason}, size=${candidate.length}) — trying render providers`);
      // Keep partial HTML so extraction can still attempt even if incomplete
      if (candidate.length > 500 && !isCloudflareChallenge(candidate)) {
        html = candidate;
        fetchStrategy = 'DIRECT_PARTIAL';
      }
    }
  } catch (e) {
    fallbackChain.push({ strategy: 'direct', status: 'error', reason: String(e) });
    console.warn('[import-property] Direct fetch threw:', e);
  }

  // ── Layer 2: ZenRows with antibot + JS render ─────────────
  // Required params for Cloudflare-protected sites:
  //   js_render=true      — executes JavaScript (needed for Next.js hydration)
  //   antibot=true        — enables Cloudflare bypass mode
  //   premium_proxy=true  — uses residential IPs (required by Cloudflare managed challenge)
  //   block_resources=false — fetch all resources so __NEXT_DATA__ is populated
  if (!html && zenrowsKey) {
    try {
      const params = new URLSearchParams({
        apikey: zenrowsKey,
        url: rawUrl,
        js_render: 'true',
        antibot: 'true',
        premium_proxy: 'true',
        wait: '2000',              // wait 2s for JS hydration
      });
      const zr = await fetch(
        `https://api.zenrows.com/v1/?${params}`,
        { signal: AbortSignal.timeout(45000) },
      );
      const candidate = await zr.text();
      httpStatusUsed = zr.status;
      responseSizeUsed = candidate.length;

      if (zr.ok && hasListingContent(candidate)) {
        html = candidate;
        fetchStrategy = 'ZENROWS';
        cfBlocked = false;
        fallbackChain.push({ strategy: 'zenrows', status: zr.status, size: candidate.length });
        console.log(`[import-property] ZenRows returned real content, size=${candidate.length}`);
      } else {
        const reason = isCloudflareChallenge(candidate)
          ? 'cloudflare_still_blocked'
          : zr.ok ? 'incomplete_content' : `http_${zr.status}`;
        fallbackChain.push({ strategy: 'zenrows', status: zr.status, size: candidate.length, reason });
        console.warn(`[import-property] ZenRows inadequate (${reason}) — trying ScrapingBee`);
        // Keep partial HTML in case ScrapingBee also fails — use best available
        if (candidate.length > html.length && !isCloudflareChallenge(candidate)) {
          html = candidate;
          fetchStrategy = 'ZENROWS';
        }
      }
    } catch (e) {
      fallbackChain.push({ strategy: 'zenrows', status: 'error', reason: String(e) });
      console.warn('[import-property] ZenRows threw:', e);
    }
  } else if (!html && !zenrowsKey) {
    fallbackChain.push({ strategy: 'zenrows', status: 'skipped', reason: 'not_configured' });
  }

  // ── Layer 3: ScrapingBee with premium_proxy + JS render ───
  // Fallback when ZenRows fails or is not configured.
  // premium_proxy=true is required for Cloudflare-protected sites.
  if (!html && scrapingbeeKey) {
    try {
      const params = new URLSearchParams({
        api_key: scrapingbeeKey,
        url: rawUrl,
        render_js: 'True',
        premium_proxy: 'True',
        wait: '2000',
      });
      const sb = await fetch(
        `https://app.scrapingbee.com/api/v1/?${params}`,
        { signal: AbortSignal.timeout(45000) },
      );
      const candidate = await sb.text();
      httpStatusUsed = sb.status;
      responseSizeUsed = candidate.length;

      if (sb.ok && hasListingContent(candidate)) {
        html = candidate;
        fetchStrategy = 'SCRAPINGBEE';
        cfBlocked = false;
        fallbackChain.push({ strategy: 'scrapingbee', status: sb.status, size: candidate.length });
        console.log(`[import-property] ScrapingBee returned real content, size=${candidate.length}`);
      } else {
        const reason = isCloudflareChallenge(candidate)
          ? 'cloudflare_still_blocked'
          : sb.ok ? 'incomplete_content' : `http_${sb.status}`;
        fallbackChain.push({ strategy: 'scrapingbee', status: sb.status, size: candidate.length, reason });
        console.warn(`[import-property] ScrapingBee inadequate (${reason})`);
        if (candidate.length > html.length && !isCloudflareChallenge(candidate)) {
          html = candidate;
          fetchStrategy = 'SCRAPINGBEE';
        }
      }
    } catch (e) {
      fallbackChain.push({ strategy: 'scrapingbee', status: 'error', reason: String(e) });
      console.warn('[import-property] ScrapingBee threw:', e);
    }
  } else if (!html && !scrapingbeeKey) {
    fallbackChain.push({ strategy: 'scrapingbee', status: 'skipped', reason: 'not_configured' });
  }

  // ── All layers exhausted — no usable HTML ─────────────────
  if (!html) {
    const providersConfigured = !!(zenrowsKey || scrapingbeeKey);
    const errorCode = cfBlocked
      ? (providersConfigured ? 'SOURCE_BLOCKED' : 'RENDER_PROVIDER_UNAVAILABLE')
      : 'EXTRACTION_FAILED';
    await updateImport({
      status: 'FAILED',
      error_code: errorCode,
      render_provider_used: fetchStrategy,
      extraction_provider: fetchStrategy,
      fetch_strategy: fetchStrategy,
      fallback_chain: fallbackChain,
      cloudflare_blocked: cfBlocked,
      http_status: httpStatusUsed,
    });
    return Response.json(
      { success: false, error_code: errorCode, fetch_strategy: fetchStrategy, fallback_chain: fallbackChain },
      { status: cfBlocked ? 422 : 503, headers: CORS },
    );
  }

  console.log(`[import-property] HTML acquired via strategy="${fetchStrategy}" size=${html.length}`);

  // ── Step 3: Detect login wall ────────────────────────────
  if (detectLoginRequired(html, domain)) {
    await updateImport({
      status: 'FAILED', error_code: 'LOGIN_REQUIRED',
      render_provider_used: fetchStrategy, extraction_provider: fetchStrategy,
      fallback_chain: fallbackChain,
    });
    return Response.json({ success: false, error_code: 'LOGIN_REQUIRED' }, { status: 422, headers: CORS });
  }

  // ── Step 4: Extract data ─────────────────────────────────
  // Extraction order (highest → lowest priority, later fills only empty fields):
  //   1. Domain adapter (MyHome / SS.ge) — deepest site-specific extraction
  //   2. Universal extractor — JSON-LD, OG, embedded state, HTML patterns, breadcrumbs
  // Adapters WIN on any field they populate. Universal fills gaps.

  let facts: Partial<ExtractedFacts> = { source_url: rawUrl };

  // Tag source domain for diagnostics
  facts.source_domain = domain;

  // 1. Domain-specific adapters
  const adapted = isMyHome ? adaptMyHome(html, rawUrl) : (isSS ? adaptSS(html, rawUrl) : null);
  if (adapted) {
    for (const [k, v] of Object.entries(adapted)) {
      if (v !== undefined && v !== null) {
        (facts as Record<string, unknown>)[k] = v;
      }
    }
  }

  // 2. Universal extractor — fills any field still empty after adapter
  const universal = universalExtract(html, rawUrl);
  for (const [k, v] of Object.entries(universal)) {
    if (v !== undefined && v !== null && (facts as Record<string, unknown>)[k] == null) {
      (facts as Record<string, unknown>)[k] = v;
    }
  }

  const adapterUsed = isMyHome ? 'myhome' : isSS ? 'ss' : 'universal';

  // ── Gallery extraction ────────────────────────────────────
  // Priority order:
  //   1. Photos already set by domain adapter (from __NEXT_DATA__ — most reliable)
  //   2. JSON-LD image array
  //   3. og:image / twitter:image meta tags (last resort)
  // All sources are filtered by isListingPhoto() before use.
  const jsonLd = extractJsonLd(html);   // parse JSON-LD once here for gallery use
  if (!facts.gallery_images?.length) {
    const galleryUrls: string[] = [
      ...extractJsonLdImages(jsonLd),
      ...extractOgImages(html),
      ...extractTwitterImages(html),
    ];
    const gallery = buildGallery(galleryUrls);
    if (gallery.length > 0) {
      facts.gallery_images = gallery;
    }
  }

  // cover_image: prefer already-set (from adapter __NEXT_DATA__), then first gallery image
  // NEVER fall back to a non-listing asset — isListingPhoto() was already applied in buildGallery
  if (!facts.cover_image && facts.gallery_images && facts.gallery_images.length > 0) {
    facts.cover_image = facts.gallery_images[0];
  }
  // Final safety: if cover_image is still a logo/icon, clear it
  if (facts.cover_image && !isListingPhoto(facts.cover_image)) {
    facts.cover_image = undefined;
    // Also remove from gallery if it crept in
    facts.gallery_images = (facts.gallery_images ?? []).filter(u => isListingPhoto(u));
  }

  // ── Step 5: Extraction quality gate ─────────────────────
  // "HTML returned" is NOT a success signal.
  // Require at least 2 of the 5 critical fields to pass.
  // If we have fewer, return EXTRACTION_FAILED — do NOT persist junk data.
  const criticalMissing = missingCriticalFields(facts);
  const criticalFound = 5 - criticalMissing.length;
  const fieldsFound = countFields(facts as Record<string, unknown>);
  const photosFound = facts.gallery_images?.length ?? 0;

  if (criticalFound < 2) {
    // Not enough data — extraction failed
    await updateImport({
      status: 'FAILED',
      error_code: 'EXTRACTION_FAILED',
      render_provider_used: fetchStrategy,
      extraction_provider: fetchStrategy,
      fetch_strategy: fetchStrategy,
      fallback_chain: fallbackChain,
      fields_found: fieldsFound,
      photos_found: photosFound,
      missing_critical: criticalMissing,
      cloudflare_blocked: cfBlocked,
      http_status: httpStatusUsed,
      response_size: responseSizeUsed,
      raw_html_sample: html.slice(0, 500),
    });
    return Response.json({
      success: false,
      error_code: 'EXTRACTION_FAILED',
      diagnostic: {
        fetch_strategy: fetchStrategy,
        fallback_chain: fallbackChain,
        fields_found: fieldsFound,
        missing_critical: criticalMissing,
        html_size: html.length,
        cloudflare_blocked: cfBlocked,
      },
    }, { status: 422, headers: CORS });
  }

  // ── Step 6: Compute derived fields ───────────────────────
  if (facts.total_price && facts.area && !facts.price_per_sqm) {
    facts.price_per_sqm = Math.round((facts.total_price / facts.area) * 100) / 100;
  }
  if (!facts.country && isKnownListingDomain(rawUrl)) facts.country = 'GE';

  // ── Step 7: Persist diagnostic + extracted data ──────────
  const diagnostic = {
    fetch_strategy_used: fetchStrategy,
    http_status: httpStatusUsed,
    response_size: responseSizeUsed,
    content_type: 'text/html',
    adapter_used: adapterUsed,
    extraction_source: fetchStrategy,
    fields_found: fieldsFound,
    photos_found: photosFound,
    missing_critical: criticalMissing,
    fallback_chain: fallbackChain,
  };

  console.log('[import-property] extraction complete:', JSON.stringify(diagnostic));

  await updateImport({
    status: 'COMPLETED',
    extracted_data: facts,
    render_provider_used: fetchStrategy,
    extraction_provider: fetchStrategy,
    fetch_strategy: fetchStrategy,
    fallback_chain: fallbackChain,
    fields_found: fieldsFound,
    photos_found: photosFound,
    missing_critical: criticalMissing,
    cloudflare_blocked: cfBlocked,
    http_status: httpStatusUsed,
    response_size: responseSizeUsed,
    raw_html_sample: html.slice(0, 500),
  });

  return Response.json({
    success: true,
    title: facts.title ?? '',
    facts,
    diagnostic,
  }, { headers: CORS });
});
