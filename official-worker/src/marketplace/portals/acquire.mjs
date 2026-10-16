import { setTimeout as delay } from 'node:timers/promises';
import { districtConflict } from './places.mjs';

/*
 * Shared acquisition for the HTML portals (place.ge, home.ge, brokeri.ge,
 * allhome.ge). Each adapter supplies only:
 *   criteria(request)             → source query, or throws { code: 'UNSUPPORTED_REQUEST' }
 *   searchUrl(criteria, page)     → public search-results URL for that page
 *   parseList(html, url)          → [{ sourceListingId, url, ...partial fields }]
 *   parseDetail?(html, url)       → partial fields from the listing's own page
 *   accept?(fields, criteria)     → false drops a read listing on a fact only its own
 *                                   page states (e.g. the city); counted as filtered
 *   listCacheMs                   → reuse a list document (e.g. a sitemap) for this long
 *   pagesIndependent              → each "page" is its own document; a short page does
 *                                   not end the run
 * Everything else — robots.txt, pacing, page cap, refusals, the contract shape,
 * deduplication by source id, and dropping a listing whose own stated deal, USD price,
 * rooms, area or Tbilisi district contradicts the request (portals that cannot filter server-side) —
 * is decided here, once.
 *
 * Public pages only, an honest User-Agent, no cookies, no retry past a refusal,
 * and no CAPTCHA/login/challenge handling: a challenge page ends the run BLOCKED.
 */
export const PORTAL_UA = 'Mozilla/5.0 (compatible; HOMATCH-FindProperty/1.0; +https://homatch.live)';
const CHALLENGE = /cf-chl|challenge-platform|just a moment\.\.\.|g-recaptcha|hcaptcha/i;
const listCache = new Map();

export function robotsRules(text) {
  const rules = []; let applies = false;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); const i = line.indexOf(':'); if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase(), value = line.slice(i + 1).trim();
    if (key === 'user-agent') applies = value === '*';
    else if (applies && key === 'disallow' && value) rules.push(value.replace(/^https?:\/\/[^/]+/, ''));
  }
  return rules.map((r) => new RegExp('^' + r.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')));
}
export const robotsAllows = (rules, url) => { const u = new URL(url); return !rules.some((re) => re.test(u.pathname + u.search)); };

export function emptyCandidate() {
  return { source: null, sourceListingId: null, exactUrl: null, canonicalUrl: null, sourceName: null, sourceType: null, title: null, description: null,
    price: null, currency: null, pricePerSqm: null, country: 'Georgia', city: null, district: null, address: null, latitude: null, longitude: null,
    propertyType: null, transactionType: null, areaSqm: null, rooms: null, bedrooms: null, bathrooms: null, floor: null, totalFloors: null,
    buildingStatus: null, renovationStatus: null, constructionYear: null, furnished: null, parking: null, amenities: [], images: [], imageHashes: [],
    publishedAt: null, updatedAt: null, observedAt: null,
    seller: { name: null, publicPhone: null, publicEmail: null, publicProfile: null, declaredType: null, sourceListingCount: null },
    provenance: { exactUrl: null, authorUrl: null, sourceUrl: null }, evidence: [], retrievalMetadata: {} };
}

/** Merge parsed fields into the contract shape; unknown keys are ignored, nothing is invented. */
export function toCandidate(adapter, fields, request, page, searchUrl) {
  const c = emptyCandidate(), now = new Date().toISOString();
  for (const [k, v] of Object.entries(fields)) if (k in c && k !== 'seller' && v !== undefined && v !== null && v !== '') c[k] = v;
  c.seller = { ...c.seller, ...(fields.seller ?? {}) };
  c.source = adapter.sourceId; c.sourceName = adapter.sourceName; c.sourceType = adapter.sourceType ?? 'MARKETPLACE';
  c.exactUrl = fields.url; c.canonicalUrl = fields.url; c.observedAt = now;
  c.transactionType ??= request.transactionType; c.propertyType ??= request.propertyType;
  c.images = [...new Set((fields.images ?? []).filter((u) => /^https:\/\//.test(u)))].slice(0, 24);
  c.description = typeof c.description === 'string' ? c.description.slice(0, 12000) : null;
  c.provenance = { exactUrl: fields.url, authorUrl: fields.authorUrl ?? null, sourceUrl: searchUrl };
  c.evidence = [{ field: 'sourceIdentity', text: `${adapter.sourceName} listing ${fields.sourceListingId}; read from its public page` }, ...(fields.evidence ?? [])];
  c.retrievalMetadata = { acquisition: `${adapter.workerId.toUpperCase().replace(/-/g, '_')}_PUBLIC_HTML`, page, requestedSearchId: request.searchId, detail: fields.detailRead === true };
  return c;
}

/** Why a read listing contradicts the request, or null. Unknown values never exclude. */
export function contradiction(fields, request) {
  const usd = fields._usd ?? (fields.currency === 'USD' ? fields.price : null), ceiling = request.collectPriceMaxUsd ?? request.priceMaxUsd;
  if (usd != null && ((request.priceMinUsd > 0 && usd < request.priceMinUsd) || (Number.isFinite(ceiling) && ceiling > 0 && usd > ceiling))) return 'price';
  const r = request.rooms;
  if (fields.rooms != null && r && ((r.min != null && fields.rooms < r.min) || (r.max != null && fields.rooms > r.max))) return 'rooms';
  if (fields.areaSqm != null && ((request.areaMinSqm != null && fields.areaSqm < request.areaMinSqm) || (request.areaMaxSqm != null && fields.areaSqm > request.areaMaxSqm))) return 'area';
  if (fields.transactionType && request.transactionType && fields.transactionType !== request.transactionType) return 'deal';
  if (districtConflict(fields.district, request)) return 'district';
  return null;
}

/**
 * A price below 10 (₾/$/€) is a portal's "price on request" placeholder (Home.ge shows "1 ₾",
 * live run 2026-10-16), never a real sale or rent figure: it is removed, not shown as a bargain.
 */
export function withoutPlaceholderPrice(fields) {
  if (fields.price == null || fields.price >= 10) return fields;
  const { price, currency, _usd, pricePerSqm, ...rest } = fields;
  return { ...rest, evidence: [...(fields.evidence ?? []), { field: 'price', text: `placeholder price ${price} ${currency ?? ''} not treated as a price`.trim() }] };
}

/** Detail fields replace list fields only where the detail page actually said something. */
const defined = (o) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length)));

export async function acquirePortal(adapter, request, { deadlineAt, signal, report, fetcher = fetch, sleep = (ms) => delay(ms, undefined, { signal }), now = Date.now } = {}) {
  const started = now(), deadline = Date.parse(deadlineAt);
  let pagesVisited = 0, actions = 0, bytes = 0, discovered = 0, delivered = 0, rejected = 0, filtered = 0;
  const errors = [], seen = new Set(), queryApplied = { acquisition: adapter.workerId };
  const remaining = () => {
    signal?.throwIfAborted();
    if (!Number.isFinite(deadline) || now() >= deadline - 15000) throw Object.assign(Error('deadline'), { code: 'DEADLINE' });
  };
  let rules = [];
  const get = async (url) => {
    remaining();
    if (!robotsAllows(rules, url)) throw Object.assign(Error('robots'), { code: 'ROBOTS_DISALLOWED', url });
    actions++;
    const res = await fetcher(url, { headers: { 'user-agent': PORTAL_UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'ka,en;q=0.8' }, redirect: 'follow',
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(Math.max(1000, Math.min(25000, deadline - now() - 10000)))]) });
    const html = await res.text(); bytes += html.length;
    if ([401, 403, 429].includes(res.status) || CHALLENGE.test(html.slice(0, 30000))) throw Object.assign(Error('refused'), { code: 'BLOCKED', status: res.status });
    if (!res.ok) throw Object.assign(Error(`HTTP ${res.status}`), { code: 'HTTP_ERROR', status: res.status, transient: res.status >= 500 });
    return html;
  };
  const emit = async (status, listings = [], failure = [], retryable = false) => {
    const result = { contract: 'marketplace-worker-1', searchId: request.searchId, searchPlanId: request.searchPlanId, workerId: adapter.workerId, sourceId: adapter.sourceId, status,
      startedAt: new Date(started).toISOString(), completedAt: status === 'RESULTS_RECEIVED' ? null : new Date().toISOString(),
      queryApplied: { ...queryApplied }, discoveredCount: discovered, returnedCount: listings.length, listings, errors: failure, retryable,
      metrics: { durationMs: now() - started, pagesVisited, actions, bytesTransferred: bytes, browserMs: 0, estimatedCostUsd: null } };
    if (Buffer.byteLength(JSON.stringify(result)) > 1500000) throw Error('report exceeds ingress limit');
    await report(result); delivered += listings.length;
  };
  try {
    const criteria = adapter.criteria(request);
    queryApplied.criteria = JSON.stringify(criteria);
    try {
      const robots = await fetcher(new URL('/robots.txt', adapter.origin).href, { headers: { 'user-agent': PORTAL_UA }, signal: AbortSignal.timeout(15000) });
      rules = robots.ok ? robotsRules(await robots.text()) : [];
    } catch { rules = []; }
    const { maxPages, pagesIndependent: independent } = adapter;
    let complete = false;
    for (let page = 1; page <= maxPages; page++) {
      const url = adapter.searchUrl(criteria, page);
      queryApplied[`page${page}`] = url;
      let html = adapter.listCacheMs ? listCache.get(url) : null;
      if (!html || now() - html.at > adapter.listCacheMs) { html = { at: now(), text: await get(url) }; if (adapter.listCacheMs) listCache.set(url, html); }
      const items = adapter.parseList(html.text, url, criteria);
      pagesVisited++;
      const fresh = items.filter((i) => i.sourceListingId && !seen.has(i.sourceListingId));
      fresh.forEach((i) => seen.add(i.sourceListingId));
      discovered += fresh.length;
      const candidates = [];
      for (const item of fresh.slice(0, adapter.detailLimit ?? fresh.length)) {
        let fields = { ...item };
        if (adapter.parseDetail) {
          try { await sleep(adapter.detailIntervalMs ?? 800); fields = { ...fields, ...defined(adapter.parseDetail(await get(item.url), item.url)), detailRead: true }; }
          catch (error) { if (['BLOCKED', 'DEADLINE'].includes(error.code) || signal?.aborted) throw error; rejected++; continue; }
        }
        fields = withoutPlaceholderPrice(fields);
        if (!fields.title && fields.price == null) { rejected++; continue; }
        if (contradiction(fields, request) || (adapter.accept && !adapter.accept(fields, criteria))) { filtered++; continue; }
        candidates.push(toCandidate(adapter, fields, request, page, url));
      }
      if (candidates.length) await emit('RESULTS_RECEIVED', candidates);
      if (!independent && (!items.length || items.length < (adapter.pageSize ?? 1))) { complete = true; break; }
      if (page < maxPages) await sleep(adapter.pageIntervalMs ?? 3000);
    }
    if (filtered) queryApplied.filteredAfterRead = String(filtered);
    if (rejected) errors.push({ code: 'SOURCE_RECORDS_REJECTED', message: `${rejected} listings could not be read from their own pages` });
    if (!complete) errors.push({ code: 'PAGE_CAP_REACHED', message: `${adapter.sourceName}: first ${maxPages} result pages read` });
    const status = rejected ? 'PARTIAL' : 'COMPLETE';
    await emit(status, [], errors);
    return { status, delivered, pagesVisited };
  } catch (error) {
    const status = delivered ? 'PARTIAL' : error.code === 'DEADLINE' ? 'TIMED_OUT' : error.code === 'BLOCKED' ? 'BLOCKED' : 'FAILED';
    const code = ['DEADLINE', 'BLOCKED', 'ROBOTS_DISALLOWED', 'UNSUPPORTED_REQUEST'].includes(error.code) ? error.code : 'PORTAL_ACQUISITION_FAILED';
    const cause = error.status ? ` HTTP ${error.status}` : error.code && error.code !== code ? ` ${error.code}` : error.name === 'TimeoutError' ? ' timeout' : '';
    await emit(status, [], [{ code, message: `${adapter.sourceName} acquisition stopped (${code}${cause}); previously ingested observations are retained.` }],
      status === 'FAILED' && (error.transient === true || ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(error.cause?.code)));
    return { status, delivered, pagesVisited, code };
  }
}
