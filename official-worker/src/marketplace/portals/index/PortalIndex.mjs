import { setTimeout as delay } from 'node:timers/promises';
import { CHALLENGE, PORTAL_UA, defined, robotsAllows, robotsRules } from '../acquire.mjs';

/*
 * WORKER-LOCAL PORTAL INDEX (in memory, per site; no database, no new service).
 *
 * Allhome.ge and Home.ge cannot filter a search on their own servers (Allhome's
 * search routes are robots-disallowed; Home.ge's search pages are browser-rendered),
 * so a search used to read the site's sitemap newest-first and then each listing's
 * own page, and only then check price, area, rooms and district — minutes of reading
 * to keep a handful (live 2026-10-16: Allhome 144 read / 3 kept, Home.ge 40 / 1).
 *
 * An adapter that sets `indexed: true` gets one of these instead. In the background
 * it reads the same public sitemap(s) and the same listing pages, at the site's own
 * politeness interval (never faster than one request per second, one site request at
 * a time, robots.txt honoured, a refusal or challenge backs off for 30 minutes), and
 * keeps each listing's parsed page facts with the time they were read:
 *
 *   indexSegments          [{ transactionType, propertyType, city, cap }] in priority
 *                          order (Tbilisi first); each is a synthetic request run
 *                          through adapter.criteria/parseList, newest `cap` ids kept
 *   indexCityAgnostic      the sitemap does not state the city (Allhome): one segment
 *                          per deal/type serves every mapped city, checked after reading
 *
 * Memory is capped (newest `capacity` listings per site, default 6,000); a listing that
 * leaves the sitemap or the newest window is evicted; an entry older than `staleMs`
 * (12 h) is read again. A search asks lookup(criteria): when its segment is warm (the
 * sitemap is loaded and ≥ 90% of its window has been read) the shared loop answers from
 * memory, with each listing's observedAt = the time its page was read. Otherwise it is
 * cold and the search runs exactly as before (and what it reads seeds the index).
 */
const HOUR = 3600000;
export const INDEX_DEFAULTS = Object.freeze({
  capacity: 6000, staleMs: 12 * HOUR, listRefreshMs: 30 * 60000, robotsRefreshMs: 6 * HOUR,
  warmCoverage: 0.9, blockedBackoffMs: 30 * 60000, failureRetryMs: HOUR, idleMs: 60000, progressEvery: 100,
});
const MAX_DESCRIPTION = 8000;
const fail = (code, status) => Object.assign(Error(code), { code, status });
const byIdDesc = (a, b) => Number(b.sourceListingId) - Number(a.sourceListingId) || String(b.sourceListingId).localeCompare(String(a.sourceListingId));

/** Segment key: deal | type | city (or * when the sitemap cannot say the city). */
export const segmentKey = (adapter, criteria) => `${criteria.transactionType}|${criteria.propertyType}|${adapter.indexCityAgnostic ? '*' : criteria.city}`;

export function createPortalIndex(adapter, {
  fetcher = fetch, now = Date.now, log = () => {},
  sleep = null, ...options
} = {}) {
  const cfg = { ...INDEX_DEFAULTS, intervalMs: Math.max(1000, adapter.detailIntervalMs ?? 900), ...(adapter.indexOptions ?? {}), ...options };
  const controller = new AbortController();
  const wait = sleep ?? ((ms) => delay(ms, undefined, { signal: controller.signal }));
  const entries = new Map();   // id → { item, detail, fetchedAt }
  const gone = new Set();      // ids whose page answered 404/410
  const failedUntil = new Map(); // id → retry time after a read error
  const lists = new Map();     // sitemap url → { at, text }
  let target = new Map();      // id → list item (union of segment windows, priority order)
  let rules = [], robotsAt = null, lastRequestAt = -Infinity, backoffUntil = 0, holds = 0;
  let startedAt = null, lastError = null, running = false;
  const counters = { detailReads: 0, listReads: 0, onDemandReads: 0, absorbed: 0, refreshed: 0, failures: 0, gone: 0, blocked: 0, evicted: 0 };

  /* Segments from the adapter: a synthetic request each, through the adapter's own criteria(). */
  const segments = [];
  for (const def of adapter.indexSegments ?? []) {
    let criteria; try { criteria = adapter.criteria({ districts: [], rooms: null, ...def }); } catch { continue; }
    const key = segmentKey(adapter, criteria);
    if (segments.some((s) => s.key === key)) continue;
    const urls = [...new Set(Array.from({ length: Math.max(1, adapter.maxPages ?? 1) }, (_, i) => adapter.searchUrl(criteria, i + 1)))];
    segments.push({ key, criteria, urls, cap: def.cap ?? cfg.capacity, ids: [], listed: 0, listedAt: null, warmAt: null });
  }

  /* ONE site request at a time, ≥ intervalMs apart. The crawler yields while a search holds
     the site; a search's own (priority) reads still keep the interval. */
  async function pace(priority) {
    for (;;) {
      controller.signal.throwIfAborted();
      if (!priority && holds > 0) { await wait(500); continue; }
      const remaining = lastRequestAt + cfg.intervalMs - now();
      if (remaining <= 0) break;
      await wait(remaining);
    }
    lastRequestAt = now();
  }
  async function get(url, priority = false) {
    if (now() < backoffUntil) throw fail('BACKOFF');
    if (!robotsAllows(rules, url)) throw fail('ROBOTS_DISALLOWED');
    await pace(priority);
    const res = await fetcher(url, { headers: { 'user-agent': PORTAL_UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'ka,en;q=0.8' }, redirect: 'follow',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]) });
    const text = await res.text();
    if ([401, 403, 429].includes(res.status) || CHALLENGE.test(text.slice(0, 30000))) {
      backoffUntil = now() + cfg.blockedBackoffMs; counters.blocked++; lastError = `BLOCKED${res.status ? ` HTTP ${res.status}` : ''}`;
      log('portal_index_blocked', { status: res.status, backoffMinutes: Math.round(cfg.blockedBackoffMs / 60000) });
      throw fail('BLOCKED', res.status);
    }
    if (!res.ok) throw fail('HTTP_ERROR', res.status);
    return text;
  }

  async function refreshRobots() {
    if (robotsAt != null && now() - robotsAt < cfg.robotsRefreshMs) return;
    try { await pace(false); const r = await fetcher(new URL('/robots.txt', adapter.origin).href, { headers: { 'user-agent': PORTAL_UA }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) }); rules = r.ok ? robotsRules(await r.text()) : []; }
    catch (error) { if (controller.signal.aborted) throw error; rules = []; }
    robotsAt = now();
  }

  /** Re-read due sitemaps, rebuild every segment's newest window and the target set, evict the rest. */
  async function refreshLists() {
    await refreshRobots();
    let changed = false;
    for (const url of new Set(segments.flatMap((s) => s.urls))) {
      const cached = lists.get(url);
      if (cached && now() - cached.at < cfg.listRefreshMs) continue;
      try { lists.set(url, { at: now(), text: await get(url) }); counters.listReads++; changed = true; }
      catch (error) { if (error.code === 'BLOCKED' || controller.signal.aborted) throw error; lastError = `LIST_${error.code ?? 'FAILED'}`;
        if (cached) cached.at = now(); else lists.set(url, { at: now(), text: null, failed: true }); }
    }
    if (changed) rebuild();
  }
  function itemsFor(segmentUrls, criteria) {
    const out = new Map();
    for (const url of segmentUrls) {
      const l = lists.get(url);
      if (!l?.text) continue;
      for (const item of adapter.parseList(l.text, url, criteria)) if (item.sourceListingId && !out.has(item.sourceListingId)) out.set(item.sourceListingId, item);
    }
    return [...out.values()].sort(byIdDesc);
  }
  function rebuild() {
    const next = new Map();
    for (const s of segments) {
      if (!s.urls.some((u) => lists.get(u)?.text)) continue;
      const window = itemsFor(s.urls, s.criteria).slice(0, s.cap);
      /* A segment's window is what fits under the site's capacity (earlier segments first). */
      s.ids = [];
      for (const item of window) {
        const id = item.sourceListingId;
        if (!next.has(id)) { if (next.size >= cfg.capacity) break; next.set(id, item); }
        s.ids.push(id);
      }
      s.listed = window.length; s.listedAt = now();
    }
    target = next;
    for (const id of [...entries.keys()]) if (!target.has(id)) { entries.delete(id); counters.evicted++; }
    for (const id of [...gone]) if (!target.has(id)) gone.delete(id);
    for (const id of [...failedUntil.keys()]) if (!target.has(id)) failedUntil.delete(id);
  }

  const settled = (id) => entries.has(id) || gone.has(id) || failedUntil.has(id);
  const coverage = (s) => (!s.listedAt ? 0 : s.ids.length ? s.ids.filter(settled).length / s.ids.length : s.listed ? 0 : 1);
  /* Warm: the sitemap is loaded and ≥ warmCoverage of the segment's window has been read
     (a segment the sitemap lists nothing for is warm and empty; one left outside the
     capacity is never warm). */
  const isWarm = (s) => Boolean(s.listedAt) && (s.listed === 0 || (s.ids.length > 0 && coverage(s) >= cfg.warmCoverage));

  /** Next listing to read: never-read listings in priority order first, then the stalest entry past staleMs. */
  function nextWork() {
    const t = now();
    for (const [id, item] of target) if (!entries.has(id) && !gone.has(id) && !((failedUntil.get(id) ?? 0) > t)) return item;
    let stalest = null;
    for (const [id, e] of entries) if (target.has(id) && t - e.fetchedAt >= cfg.staleMs && (!stalest || e.fetchedAt < stalest.fetchedAt)) stalest = e;
    return stalest?.item ?? null;
  }

  function store(item, detail) {
    const d = { ...detail };
    if (typeof d.description === 'string') d.description = d.description.slice(0, MAX_DESCRIPTION);
    const listItem = { ...item }; delete listItem.evidence;
    entries.set(item.sourceListingId, { item: listItem, detail: d, fetchedAt: now() });
    failedUntil.delete(item.sourceListingId); gone.delete(item.sourceListingId);
    return entries.get(item.sourceListingId);
  }

  /** Read one listing's own page into the index. Returns the entry, or null when it could not be read. */
  async function read(item, { priority = false } = {}) {
    const id = item.sourceListingId, refresh = entries.has(id);
    try {
      const html = await get(item.url, priority);
      const entry = store(target.get(id) ?? entries.get(id)?.item ?? item, defined(adapter.parseDetail(html, item.url)));
      counters.detailReads++; if (refresh) counters.refreshed++; if (priority) counters.onDemandReads++;
      return entry;
    } catch (error) {
      if (error.code === 'BLOCKED' || controller.signal.aborted) throw error;
      if (error.status === 404 || error.status === 410) { entries.delete(id); gone.add(id); counters.gone++; return null; }
      failedUntil.set(id, now() + cfg.failureRetryMs); counters.failures++; lastError = error.code ?? 'READ_FAILED';
      return null;
    }
  }

  let lastProgressAt = 0;
  function progress(force = false) {
    for (const s of segments) if (!s.warmAt && isWarm(s)) { s.warmAt = now(); force = true; log('portal_index_warm', { segment: s.key, listings: s.ids.length }); }
    if (force || counters.detailReads - lastProgressAt >= cfg.progressEvery) {
      lastProgressAt = counters.detailReads;
      log('portal_index_progress', { entries: entries.size, targets: target.size, detailReads: counters.detailReads, refreshed: counters.refreshed, evicted: counters.evicted,
        warm: segments.filter(isWarm).map((s) => s.key) });
    }
  }

  /** One crawler step: 'backoff' | 'held' | 'read' | 'idle'. The loop sleeps on everything but 'read'. */
  async function step() {
    if (now() < backoffUntil) return 'backoff';
    if (holds > 0) return 'held';
    await refreshLists();
    const item = nextWork();
    if (!item) return 'idle';
    await read(item);
    progress();
    return 'read';
  }
  async function loop() {
    running = true; startedAt = new Date(now()).toISOString();
    log('portal_index_started', { segments: segments.map((s) => s.key), capacity: cfg.capacity, intervalMs: cfg.intervalMs });
    while (!controller.signal.aborted) {
      try {
        const done = await step();
        if (done === 'backoff') await wait(Math.min(Math.max(1000, backoffUntil - now()), cfg.idleMs));
        else if (done === 'held') await wait(1000);
        else if (done === 'idle') await wait(cfg.idleMs);
      } catch (error) {
        if (controller.signal.aborted) break;
        if (error.code !== 'BLOCKED') lastError = error.code ?? 'INDEX_FAILED';
        await wait(cfg.idleMs).catch(() => {});
      }
    }
    running = false;
  }

  /**
   * What the index knows for one search's criteria (the request's own criteria, so a
   * district or rooms narrowing in the sitemap slug applies exactly as in the shared loop).
   * null → the index has no segment for this deal/type/city.
   */
  function lookup(criteria) {
    const s = segments.find((x) => x.key === segmentKey(adapter, criteria));
    if (!s) return null;
    const cov = coverage(s);
    if (!isWarm(s)) return { warm: false, coverage: cov, segment: s.key };
    const t = now(), window = new Set(s.ids), oldest = s.ids.length ? Number(s.ids.at(-1)) : Infinity;
    const items = itemsFor(s.urls, criteria).filter((i) => window.has(i.sourceListingId) || Number(i.sourceListingId) > oldest).map((item) => ({
      item, entry: entries.get(item.sourceListingId) ?? null, gone: gone.has(item.sourceListingId),
      retryable: !((failedUntil.get(item.sourceListingId) ?? 0) > t),
    }));
    return { warm: true, coverage: cov, segment: s.key, listUrl: s.urls[0], listedAt: s.listedAt, items, stale: (entry) => t - entry.fetchedAt >= cfg.staleMs };
  }

  /** A listing a cold search read anyway: kept when it belongs to the index's window. */
  function absorb(item, detail) {
    if (!target.has(item.sourceListingId)) return;
    store(target.get(item.sourceListingId), detail); counters.absorbed++;
  }

  function stats() {
    return {
      enabled: true, running, startedAt, capacity: cfg.capacity, intervalMs: cfg.intervalMs, staleHours: cfg.staleMs / HOUR,
      entries: entries.size, targets: target.size, held: holds > 0, lastError,
      backoffUntil: backoffUntil > now() ? new Date(backoffUntil).toISOString() : null,
      lastRequestAt: Number.isFinite(lastRequestAt) ? new Date(lastRequestAt).toISOString() : null,
      counters: { ...counters },
      segments: segments.map((s) => ({ key: s.key, listed: s.listed, window: s.ids.length, read: s.ids.filter((id) => entries.has(id)).length, coverage: Math.round(coverage(s) * 1000) / 1000,
        warm: isWarm(s), listedAt: s.listedAt ? new Date(s.listedAt).toISOString() : null })),
    };
  }

  return {
    adapter, config: cfg,
    start() { if (!running && segments.length) void loop(); return this; },
    stop() { controller.abort(); },
    /** A search runs on this site: the crawler yields until release() (one site request at a time). */
    hold() { holds++; let released = false; return () => { if (!released) { released = true; holds--; } }; },
    step, lookup, read, absorb, stats, refreshLists,
    /** Test/diagnostic view of one entry. */
    entry: (id) => entries.get(String(id)) ?? null,
  };
}
