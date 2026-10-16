import { setTimeout as delay } from 'node:timers/promises';
import { districtConflict, districtKey, requestedDistrictKeys } from './places.mjs';

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
 *                                   not end the run (a sitemap read again yields its next
 *                                   unread window: only listings actually read are marked seen)
 *   deepMaxPages                  → how far to keep reading when the request can only be
 *                                   checked AFTER reading (a district the server cannot
 *                                   filter, or filtersAfterRead) and too few listings fit
 *   filtersAfterRead / serverDistricts / targetResults / deepReserveMs
 *   indexed / indexSegments       answered from the worker-local index when it is warm for the
 *                                 request (index/PortalIndex.mjs); indexResultCap (60),
 *                                 indexFreshReads / indexStaleReads (4 each), indexReadBudgetMs (20 s)
 * Everything else — robots.txt, pacing, page cap, refusals, the contract shape,
 * deduplication by source id, and dropping a listing whose own stated deal, USD price,
 * rooms, area or Tbilisi district contradicts the request (portals that cannot filter server-side) —
 * is decided here, once.
 *
 * Public pages only, an honest User-Agent, no cookies, no retry past a refusal,
 * and no CAPTCHA/login/challenge handling: a challenge page ends the run BLOCKED.
 */
export const PORTAL_UA = 'Mozilla/5.0 (compatible; HOMATCH-FindProperty/1.0; +https://homatch.live)';
export const CHALLENGE = /cf-chl|challenge-platform|just a moment\.\.\.|g-recaptcha|hcaptcha/i;
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
export const defined = (o) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length)));
const byNewestId = (a, b) => Number(b.sourceListingId) - Number(a.sourceListingId);

/**
 * Order among listings that already passed the acceptance rules (index answers only; the
 * shared loop reports in reading order). Ranking never drops a listing: the requested
 * building/renovation status, bedrooms and a named requested district lift it, a stated
 * different one lowers it, and a listing placed within 30 days (what the results
 * pipeline keeps) comes before an older one.
 */
export function rankScore(fields, request, nowMs = Date.now()) {
  let s = 0;
  const b = request.buildingStatuses ?? [], rv = request.renovationPreferences ?? [], br = request.bedrooms;
  if (b.length && fields.buildingStatus) s += b.includes(fields.buildingStatus) ? 4 : -4;
  if (rv.length && fields.renovationStatus) s += rv.includes(fields.renovationStatus) ? 2 : -2;
  if (br && fields.bedrooms != null) s += (br.min == null || fields.bedrooms >= br.min) && (br.max == null || fields.bedrooms <= br.max) ? 1 : -2;
  const keys = requestedDistrictKeys(request);
  if (keys && fields.district && keys.includes(districtKey(fields.district))) s += 2;
  const published = Date.parse(fields.publishedAt ?? '');
  if (Number.isFinite(published) && nowMs - published <= 30 * 86400000) s += 3;
  if (fields.price != null) s += 1;
  if (fields.areaSqm != null) s += 0.5;
  if (fields.images?.length) s += 0.5;
  return s;
}

export async function acquirePortal(adapter, request, { deadlineAt, signal, report, fetcher = fetch, sleep = (ms) => delay(ms, undefined, { signal }), now = Date.now, index = null } = {}) {
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
  /*
   * Warm index answer. The index holds each listing's own-page facts with the time they
   * were read; the request's own criteria pick the sitemap entries (so a slug-level
   * district/rooms narrowing applies as in the loop), and the loop's acceptance rules
   * decide (placeholder price, nothing readable, contradiction, adapter.accept). Within a
   * short read budget it also reads the newest listings the sitemap names that the index
   * has not reached yet, and re-reads a top match older than the index's stale age.
   * Each listing's observedAt is when its page was actually read.
   */
  async function fromIndex(view, criteria) {
    queryApplied.index = 'WARM';
    const readUntil = Math.min(deadline - 15000, started + (adapter.indexReadBudgetMs ?? 20000));
    const cap = adapter.indexResultCap ?? 60, asked = Number(request.maxResults);
    const want = Math.max(1, Math.min(cap, Number.isFinite(asked) && asked > 0 ? Math.floor(asked) : cap));
    let fresh = adapter.indexFreshReads ?? 4, refresh = adapter.indexStaleReads ?? 4, halted = false, onDemand = 0;
    const canRead = () => !halted && now() < readUntil;
    const readNow = async (item) => {
      try { actions++; onDemand++; return await index.read(item, { priority: true }); }
      catch (error) { if (signal?.aborted) throw error; halted = true; return null; }
    };
    for (const x of view.items) {
      if (fresh <= 0 || !canRead()) break;
      if (x.entry || x.gone || !x.retryable) continue;
      fresh--; x.entry = await readNow(x.item);
    }
    const evaluate = (x) => {
      const fields = withoutPlaceholderPrice({ ...x.item, ...x.entry.detail, detailRead: true });
      if (!fields.title && fields.price == null) return null;
      if (contradiction(fields, request) || (adapter.accept && !adapter.accept(fields, criteria))) return false;
      return fields;
    };
    const t = now(), ranked = [];
    let unread = 0;
    for (const x of view.items) {
      if (!x.entry) { if (!x.gone) unread++; continue; }
      discovered++;
      const fields = evaluate(x);
      if (fields === null) rejected++; else if (fields === false) filtered++;
      else ranked.push({ x, fields, score: rankScore(fields, request, t) });
    }
    ranked.sort((a, b) => b.score - a.score || (Date.parse(b.fields.publishedAt ?? '') || 0) - (Date.parse(a.fields.publishedAt ?? '') || 0) || byNewestId(a.x.item, b.x.item));
    const chosen = [];
    for (const m of ranked) {
      if (chosen.length >= want) break;
      if (view.stale(m.x.entry) && refresh > 0 && canRead()) {
        refresh--;
        const entry = await readNow(m.x.item);
        if (entry) { m.x.entry = entry; const fields = evaluate(m.x); if (!fields) { filtered++; continue; } m.fields = fields; }
        else if (!halted && !index.entry(m.x.item.sourceListingId)) continue; // the page is gone
      }
      chosen.push(m);
    }
    const listings = chosen.map(({ x, fields }) => {
      const c = toCandidate(adapter, fields, request, 1, view.listUrl), at = new Date(x.entry.fetchedAt).toISOString();
      c.observedAt = at;
      c.retrievalMetadata = { ...c.retrievalMetadata, index: true, indexFetchedAt: at };
      return c;
    });
    if (listings.length) await emit('RESULTS_RECEIVED', listings);
    const oldest = chosen.reduce((m, { x }) => Math.min(m, x.entry.fetchedAt), Infinity);
    Object.assign(queryApplied, { indexCoverage: String(Math.round(view.coverage * 100)), indexMatched: String(ranked.length), indexUnread: String(unread), indexReads: String(onDemand), pagesRead: '0' },
      Number.isFinite(oldest) ? { indexOldestMinutes: String(Math.max(0, Math.round((now() - oldest) / 60000))) } : {},
      filtered ? { filteredAfterRead: String(filtered) } : {});
    await emit('COMPLETE', [], []);
    return { status: 'COMPLETE', delivered, pagesVisited, index: 'WARM' };
  }
  try {
    const criteria = adapter.criteria(request);
    queryApplied.criteria = JSON.stringify(criteria);
    /*
     * INDEXED PORTAL (Allhome.ge, Home.ge): when the worker-local index has read this
     * deal/type/city's sitemap window, answer from it — same acceptance rules, no
     * sitemap or page walk. Cold (or no index) → the reading loop below, unchanged.
     */
    if (index && adapter.indexed === true) {
      let view = null;
      try { view = index.lookup(criteria); } catch { view = null; }
      if (view?.warm) return await fromIndex(view, criteria);
      queryApplied.index = view ? `COLD ${Math.round(view.coverage * 100)}%` : 'COLD';
    }
    try {
      const robots = await fetcher(new URL('/robots.txt', adapter.origin).href, { headers: { 'user-agent': PORTAL_UA }, signal: AbortSignal.timeout(15000) });
      rules = robots.ok ? robotsRules(await robots.text()) : [];
    } catch { rules = []; }
    const { maxPages, pagesIndependent: independent } = adapter;
    /*
     * ADAPTIVE DEPTH. A source that can only check the district (or price/area) after
     * reading a listing reads further — up to deepMaxPages — while too few listings
     * fit, the pages keep yielding unread listings, and the deadline leaves room. The
     * first maxPages are always read; what stopped the read is reported, never hidden.
     */
    const postFilter = adapter.filtersAfterRead === true || (requestedDistrictKeys(request) !== null && adapter.serverDistricts !== true);
    const pageCap = postFilter ? Math.max(maxPages, adapter.deepMaxPages ?? maxPages) : maxPages;
    const target = adapter.targetResults ?? 24;
    let complete = false, accepted = 0, depthStop = null;
    for (let page = 1; page <= pageCap; page++) {
      if (page > maxPages) {
        if (accepted >= target) { depthStop = 'ENOUGH_RESULTS'; complete = true; break; }
        if (now() >= deadline - (adapter.deepReserveMs ?? 60000)) { depthStop = 'TIME_BUDGET'; break; }
      }
      const url = adapter.searchUrl(criteria, page);
      queryApplied[`page${page}`] = url;
      let html = adapter.listCacheMs ? listCache.get(url) : null;
      if (!html || now() - html.at > adapter.listCacheMs) { html = { at: now(), text: await get(url) }; if (adapter.listCacheMs) listCache.set(url, html); }
      const items = adapter.parseList(html.text, url, criteria);
      pagesVisited++;
      const fresh = items.filter((i) => i.sourceListingId && !seen.has(i.sourceListingId));
      const batch = fresh.slice(0, adapter.detailLimit ?? fresh.length);
      /* Only what is actually read is marked seen, so a re-read index yields its next window. */
      batch.forEach((i) => seen.add(i.sourceListingId));
      discovered += batch.length;
      if (page > maxPages && !batch.length) { depthStop = 'SOURCE_EXHAUSTED'; complete = true; break; }
      const candidates = [];
      for (const item of batch) {
        let fields = { ...item };
        if (adapter.parseDetail) {
          try {
            await sleep(adapter.detailIntervalMs ?? 800);
            const detail = defined(adapter.parseDetail(await get(item.url), item.url));
            try { index?.absorb?.(item, detail); } catch { /* the index is an optimisation; never fails a search */ }
            fields = { ...fields, ...detail, detailRead: true };
          }
          catch (error) { if (['BLOCKED', 'DEADLINE'].includes(error.code) || signal?.aborted) throw error; rejected++; continue; }
        }
        fields = withoutPlaceholderPrice(fields);
        if (!fields.title && fields.price == null) { rejected++; continue; }
        if (contradiction(fields, request) || (adapter.accept && !adapter.accept(fields, criteria))) { filtered++; continue; }
        candidates.push(toCandidate(adapter, fields, request, page, url));
      }
      accepted += candidates.length;
      if (candidates.length) await emit('RESULTS_RECEIVED', candidates);
      if (!independent && (!items.length || items.length < (adapter.pageSize ?? 1))) { complete = true; break; }
      if (page < pageCap) await sleep(adapter.pageIntervalMs ?? 3000);
    }
    if (filtered) queryApplied.filteredAfterRead = String(filtered);
    queryApplied.pagesRead = String(pagesVisited);
    if (pageCap > maxPages) queryApplied.adaptiveDepth = `${pagesVisited}/${pageCap}${depthStop ? ` ${depthStop}` : ''}`;
    if (rejected) errors.push({ code: 'SOURCE_RECORDS_REJECTED', message: `${rejected} listings could not be read from their own pages` });
    if (!complete) errors.push({ code: 'PAGE_CAP_REACHED', message: `${adapter.sourceName}: first ${pagesVisited} result pages read${depthStop === 'TIME_BUDGET' ? ' (time budget)' : ''}` });
    const status = rejected ? 'PARTIAL' : 'COMPLETE';
    await emit(status, [], errors);
    return { status, delivered, pagesVisited };
  } catch (error) {
    const status = delivered ? 'PARTIAL' : error.code === 'DEADLINE' ? 'TIMED_OUT' : error.code === 'BLOCKED' ? 'BLOCKED' : 'FAILED';
    const code = ['DEADLINE', 'BLOCKED', 'ROBOTS_DISALLOWED', 'UNSUPPORTED_REQUEST'].includes(error.code) ? error.code : 'PORTAL_ACQUISITION_FAILED';
    const timeout = error.name === 'TimeoutError' || error.cause?.name === 'TimeoutError';
    const cause = error.status ? ` HTTP ${error.status}` : timeout ? ' timeout' : error.code && error.code !== code ? ` ${error.code}` : '';
    await emit(status, [], [{ code, message: `${adapter.sourceName} acquisition stopped (${code}${cause}); previously ingested observations are retained.` }],
      status === 'FAILED' && (timeout || error.transient === true || ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(error.cause?.code)));
    return { status, delivered, pagesVisited, code };
  }
}
