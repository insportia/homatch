import { URL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import type { MarketplaceSearchRequest, MarketplaceWorkerResult, ExternalListingCandidate } from '../contract.js';
import { endpoints, publicJson, parsePagination, parseListEnvelope, validateSearchListings, AcquisitionError } from './api.js';
import { buildQueries, candidateFromMyHome } from './mapping.js';
import { publicPage, publicSearchUrl } from './public-page.js';
import { MyHomeEngine, myHomeEngine } from './engine.js';

export class MyHomeFailure extends Error { constructor(public code: string, message: string, public retryable = false) { super(message); } }
export type AdapterOptions = { fetcher?: typeof fetch; pageFetcher?: typeof fetch; browserMs?: () => number; deadlineAt: string; signal?: AbortSignal; engine?: MyHomeEngine;
  checkpoint?: { queryApplied?: Record<string, unknown>; returnedCount?: number };
  report: (result: MarketplaceWorkerResult & { retryable?: boolean }) => Promise<void> };
export async function acquireMyHome(request: MarketplaceSearchRequest, options: AdapterOptions) {
  // Injected fixtures may use an isolated policy. Production shares durable state.
  const engine = options.engine ?? (options.fetcher ? new MyHomeEngine() : myHomeEngine);
  const started = Date.now(), startedAt = new Date(started).toISOString();
  const deadline = Date.parse(options.deadlineAt);
  const seenIds = new Set<string>(), seenUuids = new Set<string>();
  let unavailableUrls = 0;
  const unavailableIds: string[] = [];
  let pagesVisited = 0, actions = 0, discoveredCount = 0, delivered = 0, nextPage = 1, currentQuery = 0;
  const queriesApplied: Record<string, string | number | boolean | null | string[]> = { acquisition: options.pageFetcher ? 'PUBLIC_NEXT_DATA_BROWSER' : 'PUBLIC_NEXT_DATA', dictionariesAndCount: 'PUBLIC_API' };
  function remaining() {
    options.signal?.throwIfAborted();
    if (!Number.isFinite(deadline) || Date.now() > deadline - 15000) throw new MyHomeFailure('DEADLINE', 'Existing worker deadline reached; already ingested batches remain available.');
  }
  async function json(url: string, locale = 'ka', page = false, statementId?: string): Promise<any> {
    for (let attempt = 0; ; attempt++) {
      remaining();
      try {
        const fetcher: typeof fetch = (input, init) => (page ? options.pageFetcher ?? options.fetcher ?? fetch : options.fetcher ?? fetch)(input, { ...init,
          signal: AbortSignal.any([AbortSignal.timeout(Math.min(20000, deadline - Date.now() - 10000)), ...(options.signal ? [options.signal] : [])]) });
        return await engine.dictionary(url, locale, async () => {
          actions++;
          return (page ? await publicPage(url, fetcher, statementId) : await publicJson(url, locale, fetcher)).payload;
        });
      } catch (error) {
        const e = error as AcquisitionError;
        const retryable = error instanceof AcquisitionError && (e.status === null || e.status === 408 || e.status === 429 || (e.status !== null && e.status >= 500));
        if (!retryable || attempt >= 2) throw new MyHomeFailure(e.category === 'ACCESS_RESTRICTED' ? 'ACCESS_DENIED'
          : e.category === 'CONTRACT' ? 'SOURCE_CONTRACT_CHANGED' : 'SOURCE_REQUEST_FAILED', e.message, retryable);
        await delay(500 * 2 ** attempt, undefined, { signal: options.signal });
      }
    }
  }
  const report = async (status: MarketplaceWorkerResult['status'], listings: ExternalListingCandidate[] = [], errors: MarketplaceWorkerResult['errors'] = [], retryable = false) => {
    const result = { contract: 'marketplace-worker-1' as const, searchId: request.searchId, searchPlanId: request.searchPlanId,
      workerId: 'myhome-agent', sourceId: 'myhome-ge', status, startedAt,
      completedAt: ['COMPLETE', 'PARTIAL', 'FAILED', 'TIMED_OUT', 'BLOCKED'].includes(status) ? new Date().toISOString() : null,
      queryApplied: { ...queriesApplied, nextPage, queryIndex: currentQuery }, discoveredCount, returnedCount: listings.length, listings, errors,
      metrics: { durationMs: Date.now() - started, pagesVisited, actions, bytesTransferred: null, browserMs: options.browserMs?.() ?? 0, estimatedCostUsd: null }, retryable };
    if (new TextEncoder().encode(JSON.stringify(result)).length > 1500000) throw new MyHomeFailure('REPORT_TOO_LARGE', 'Report exceeds safe ingress size.');
    await options.report(result); delivered += listings.length;
  };
  try {
    await engine.ready();
    const locations = await json(endpoints.locations, 'en'), filters = await json(endpoints.filters);
    const queries = buildQueries(request, locations, filters);
    queriesApplied.requests = queries.map(query => query.url);
    const saved = options.checkpoint?.queryApplied;
    const resume = saved && JSON.stringify(saved.requests) === JSON.stringify(queriesApplied.requests)
      && Number.isSafeInteger(saved.queryIndex) && Number(saved.queryIndex) >= 0 && Number(saved.queryIndex) < queries.length
      && Number.isSafeInteger(saved.nextPage) && Number(saved.nextPage) >= 1 ? saved : null;
    if (resume) delivered = Math.max(0, Math.trunc(options.checkpoint?.returnedCount ?? 0));
    for (let queryIndex = 0; queryIndex < queries.length; queryIndex++) {
      if (resume && queryIndex < Number(resume.queryIndex)) continue;
      currentQuery = queryIndex; const query = queries[queryIndex];
      const countUrl = new URL(query.url); countUrl.pathname += '/count';
      const pagination = parsePagination(await json(countUrl.href), 1);
      discoveredCount += pagination.total; queriesApplied.lastPage = pagination.last_page;
      const fingerprints = new Set<string>();
      // No maxPages/maxResults acquisition cap: only authoritative last_page and
      // the pre-existing HOMATCH run deadline bound this loop.
      const firstPage = resume && queryIndex === Number(resume.queryIndex) && Number(resume.nextPage) <= Math.max(1, pagination.last_page) + 1
        ? Number(resume.nextPage) : 1;
      for (let page = firstPage; page <= Math.max(1, pagination.last_page); page++) {
        nextPage = page; remaining();
        const url = new URL(query.url); url.searchParams.set('page', String(page));
        const searchUrl = publicSearchUrl(url.href);
        const rows = parseListEnvelope(await json(searchUrl, 'ka', true)); pagesVisited++;
        validateSearchListings(rows, query.criteria);
        if (pagination.total === 0 && rows.length) throw new MyHomeFailure('COUNT_MISMATCH', 'Count reported zero but listings were returned.');
        if (!rows.length) {
          if (pagination.total === 0) break;
          throw new MyHomeFailure('EMPTY_PAGE', `Unexpected empty page ${page}/${pagination.last_page}; results are partial.`);
        }
        const ids = rows.map(row => row.source_id).sort().join(',');
        if (fingerprints.has(ids)) throw new MyHomeFailure('REPEATED_PAGE', `Page ${page} repeats an earlier page; results are partial.`);
        fingerprints.add(ids);
        const newRows = rows.filter(row => !seenIds.has(row.source_id) && (!row.source_uuid || !seenUuids.has(row.source_uuid)));
        // A later district query can legitimately overlap earlier queries. Detect
        // no progress within this query, independently of global identity dedupe.
        const priorIds: Set<string> = (query as any).priorIds ??= new Set<string>();
        const newWithinQuery = rows.filter(row => !priorIds.has(row.source_id));
        rows.forEach(row => priorIds.add(row.source_id));
        if (!newWithinQuery.length) throw new MyHomeFailure('NO_NEW_IDS', `Page ${page} adds no source identities.`);
        const candidates: ExternalListingCandidate[] = [];
        for (let i = 0; i < newRows.length; i += (options.pageFetcher ? 2 : 4)) {
          const group = await Promise.all(newRows.slice(i, i + (options.pageFetcher ? 2 : 4)).map(async row => {
            // Detail enrichment is source acquisition only: it supplies missing
            // description/condition/contact/coordinate evidence to the existing core.
            if (!row.source_url) {
              unavailableUrls++;
              if (unavailableIds.length < 20) unavailableIds.push(row.source_id);
              return null;
            }
            const payload = await json(row.source_url, 'ka', true, row.source_id);
            const detail = payload?.result === true ? payload?.data?.statement : null;
            if (!detail || String(detail.id) !== row.source_id || detail.uuid !== row.source_uuid) throw new MyHomeFailure('DETAIL_IDENTITY', `Invalid detail identity for ${row.source_id}`);
            const raw = { ...row.raw_source_data, ...detail };
            // Live API records can lack a slug in both summary and detail.
            // Never fabricate a URL or stop unrelated pages for that record.
            if (!raw.dynamic_slug) {
              unavailableUrls++;
              if (unavailableIds.length < 20) unavailableIds.push(row.source_id);
              return null;
            }
            // Validate detail price/type/location/area too: inventory may change
            // between list and detail. Known mismatches are not fabricated away.
            const merged = parseListEnvelope({ result: true, data: { data: [raw] } });
            try { validateSearchListings(merged, query.criteria); } catch { return null; }
            return candidateFromMyHome(raw, filters, searchUrl);
          }));
          candidates.push(...group.filter((candidate): candidate is ExternalListingCandidate => candidate !== null));
        }
        newRows.forEach(row => { seenIds.add(row.source_id); if (row.source_uuid) seenUuids.add(row.source_uuid); });
        // A page is normally 24 rows. Split by encoded bytes as well as count so
        // exceptionally long public descriptions cannot breach the ingest limit.
        let batch: ExternalListingCandidate[] = [], bytes = 0;
        for (const candidate of candidates) {
          const size = new TextEncoder().encode(JSON.stringify(candidate)).length;
          if (batch.length && (bytes + size > 1200000 || batch.length >= 100)) { await report('RESULTS_RECEIVED', batch); batch = []; bytes = 0; }
          batch.push(candidate); bytes += size;
        }
        // Only the final acknowledged batch advances the durable page cursor.
        // Earlier failure replays this page through identity-based upserts.
        nextPage = page + 1;
        await report('RESULTS_RECEIVED', batch);
      }
    }
    const status = unavailableUrls ? 'PARTIAL' : 'COMPLETE';
    await report(status, [], unavailableUrls ? [{ code: 'SOURCE_URL_UNAVAILABLE', message: `${unavailableUrls} source records have no canonical URL; IDs: ${unavailableIds.join(',')}. All pagination traversed.` }] : []);
    return { status, pagesVisited, delivered };
  } catch (error) {
    const e = error instanceof MyHomeFailure ? error : error instanceof AcquisitionError && error.category === 'ACCESS_RESTRICTED'
      ? new MyHomeFailure('ACCESS_DENIED', error.message) : new MyHomeFailure('ACQUISITION_FAILED', error instanceof Error ? error.message : String(error));
    const status = delivered || (options.checkpoint?.returnedCount ?? 0) > 0 ? 'PARTIAL' : e.code === 'DEADLINE' ? 'TIMED_OUT' : e.code === 'ACCESS_DENIED' ? 'BLOCKED' : 'FAILED';
    await report(status, [], [{ code: e.code, message: e.message.slice(0, 1000) }], e.retryable && !delivered);
    return { status, pagesVisited, delivered };
  }
}
