import { setTimeout as delay } from 'node:timers/promises';
import { SsgeAdapter } from './vendor/adapter.mjs';
import { SsgePublicClient } from './vendor/public-client.mjs';
import { createGatewayHttp2Fetch } from './vendor/gateway-http2.mjs';
import { compareDetail, validateCriteria } from './vendor/validation.mjs';
import { verifyIndividualPage } from './vendor/page-proof.mjs';
import { ssgeCriteria, ssgeCandidate } from './mapping.mjs';

/*
 * Owner decision (2026-10-16): SS.ge reads ONLY its first 3 result pages (16 cards
 * each). Production search 72050455 read 21 pages / 696 actions in 12.7 minutes and
 * ran into the 15-minute deadline while the next search's SS.ge run sat QUEUED. Each
 * page costs one search request plus, per card, a 500 ms pause, one detail request
 * and one individual-page proof (~36 s per page in production), so a capped run is
 * ~2 minutes. Reaching the cap is a normal completion reported like the portals
 * (PAGE_CAP_REACHED + pagesRead), never a failure.
 *
 * Owner decision (2026-10-23): the same strict policy as MyHome — pages 1 and 2 only, for
 * every caller. This constant is the ceiling acquireSsge enforces (a larger pageCap
 * throws), the adapter is asked for at most this many pages, and nothing — retries, the
 * Verify lane, a fallback — can read page 3. A page-2 failure keeps page 1 (PARTIAL).
 */
export const SSGE_PAGE_CAP = 2;

export async function acquireSsge(request, { deadlineAt, signal, report, client, fetcher, sleep = ms => delay(ms, undefined, { signal }), verifyPage = verifyIndividualPage, pageCap = SSGE_PAGE_CAP } = {}) {
  if (!Number.isInteger(pageCap) || pageCap < 1 || pageCap > SSGE_PAGE_CAP) throw Error('Invalid SS.ge page cap');
  const started = Date.now(), deadline = Date.parse(deadlineAt);
  let pagesVisited = 0, discoveredCount = 0, delivered = 0, stop = null, actions = 0;
  // Every listing not delivered, with why: INACTIVE / CRITERIA (it does not match the search: a normal
  // outcome) or IDENTITY / UNREADABLE (we could not verify it: the run is incomplete).
  const dropped = [];
  const drop = (id, reason) => { dropped.push({ id: String(id ?? '?'), reason }); };
  const errors = [], queryApplied = { acquisition: 'SSGE_ACCEPTED_STANDALONE_HTTP2' };
  const remaining = () => {
    signal?.throwIfAborted();
    if (!Number.isFinite(deadline) || Date.now() >= deadline - 15000) throw Object.assign(Error('Existing run deadline reached'), { code: 'DEADLINE' });
  };
  const boundedSignal = () => AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(Math.max(1, Math.min(30000, deadline - Date.now() - 10000)))]);
  const publicFetch = fetcher ?? createGatewayHttp2Fetch();
  const boundedFetch = (url, options = {}) => { remaining(); actions++; return publicFetch(url, { ...options, signal: AbortSignal.any([boundedSignal(), ...(options.signal ? [options.signal] : [])]) }); };
  const runSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(Number.isFinite(deadline) ? Math.max(1, deadline - Date.now() - 10000) : 1)]);
  /* The last answer SS.ge gave, so a blocked or failed run says which request got which status
     from which server (production d3d859cc, 2026-10-22: BLOCKED in 67 ms with no trace of why).
     Status and server only: never a body, a header value with a credential, or the token. */
  const lastHttp = { phase: null, status: null, server: null };
  const note = (phase) => (info) => {
    if (info?.status == null && !info?.error) return;
    const headers = info.responseHeaders ?? {};
    lastHttp.phase = phase;
    lastHttp.status = info.status ?? null;
    lastHttp.server = typeof headers.server === 'string' ? headers.server.slice(0, 40) : headers['cf-ray'] ? 'cloudflare' : null;
  };
  const source = client ?? new SsgePublicClient({ http: { fetchImpl: boundedFetch, signal: runSignal, retries: 1,
    onBootstrap: note('public page'), onResponse: note('gateway') } });
  const emit = async (status, listings = [], failure = [], retryable = false) => {
    const result = { contract: 'marketplace-worker-1', searchId: request.searchId, searchPlanId: request.searchPlanId, workerId: 'ssge-agent', sourceId: 'ss-ge', status,
      startedAt: new Date(started).toISOString(), completedAt: status === 'RESULTS_RECEIVED' ? null : new Date().toISOString(),
      queryApplied: { ...queryApplied }, discoveredCount, returnedCount: listings.length, listings, errors: failure, retryable,
      metrics: { durationMs: Date.now() - started, pagesVisited, actions, bytesTransferred: null, browserMs: 0, estimatedCostUsd: null } };
    if (Buffer.byteLength(JSON.stringify(result)) > 1500000) throw Error('SS.ge report exceeds ingress limit');
    await report(result); delivered += listings.length;
  };
  try {
    remaining();
    source.locations ??= await source.locationChain();
    const criteria = ssgeCriteria(request, source.locations);
    queryApplied.criteria = JSON.stringify(criteria);
    if (criteria.districtFallback) queryApplied.districtFallback = `city read; SS.ge does not resolve: ${criteria.districtFallback.join(', ')}`;
    for await (const page of new SsgeAdapter({ client: source }).search(criteria, { retries: 0, maxPages: pageCap, onStop: value => { stop = value; } })) {
      remaining(); pagesVisited++;
      discoveredCount = Math.max(discoveredCount, page.total ?? 0);
      for (const x of page.excluded) drop(x.sourceListingId, x.reason === 'Source criteria mismatch' ? 'CRITERIA' : 'UNREADABLE');
      const candidates = [];
      for (const listing of page.items) {
        remaining(); await sleep(500);
        try {
          const detail = await new SsgeAdapter({ client: source }).detail(listing.sourceListingId);
          const proof = await verifyPage(listing, { fetchImpl: boundedFetch, signal: boundedSignal() });
          if ([401, 403, 429].includes(proof.status)) throw Object.assign(Error('SS.ge public page unavailable'), { status: proof.status });
          const check = compareDetail(listing, detail, { pageProof: proof });
          if (detail.raw.isInactiveApplication === true) { drop(listing.sourceListingId, 'INACTIVE'); continue; }
          if (!check.passed) { drop(listing.sourceListingId, 'IDENTITY'); continue; }
          if (!validateCriteria(detail, criteria, source.locations, { requireUrl: false }).passed) { drop(listing.sourceListingId, 'CRITERIA'); continue; }
          candidates.push(ssgeCandidate(listing, detail, request, page.page));
        } catch (error) {
          if (signal?.aborted || error.code === 'DEADLINE' || [401, 403, 429].includes(error.status)) throw error;
          drop(listing.sourceListingId, 'UNREADABLE');
        }
      }
      if (candidates.length) await emit('RESULTS_RECEIVED', candidates);
      await sleep(500);
    }
    queryApplied.pagesRead = String(pagesVisited);
    queryApplied.pageCap = String(pageCap);
    // paginate() reports 'safety-limit' exactly when maxPages (the cap) was read in full.
    const capped = stop?.reason === 'safety-limit';
    const complete = capped || ['last-page', 'total-count'].includes(stop?.reason) || stop?.reason === 'empty-page' && discoveredCount === 0;
    if (capped) errors.push({ code: 'PAGE_CAP_REACHED', message: `SS.ge: first ${pagesVisited} result pages read` });
    if (!complete) errors.push({ code: 'PAGINATION_INCOMPLETE', message: `SS.ge traversal stopped: ${stop?.reason ?? 'unknown'}` });
    const failed = dropped.filter(d => d.reason === 'IDENTITY' || d.reason === 'UNREADABLE');
    const filtered = dropped.filter(d => d.reason === 'INACTIVE' || d.reason === 'CRITERIA');
    const listed = list => `${list.length}: ${list.slice(0, 10).map(d => `${d.id} ${d.reason}`).join(', ')}${list.length > 10 ? ', …' : ''}`;
    if (failed.length) errors.push({ code: 'SOURCE_RECORDS_REJECTED', message: `could not be verified ${listed(failed)}` });
    if (filtered.length) errors.push({ code: 'SOURCE_RECORDS_FILTERED', message: `did not match the search ${listed(filtered)}` });
    // A listing that does not match the search is a normal outcome; one we could not verify is not.
    // A run that delivered nothing while dropping listings never claims a clean completion.
    const status = complete && !failed.length && (delivered > 0 || !filtered.length) ? 'COMPLETE' : 'PARTIAL';
    await emit(status, [], errors);
    return { status, delivered, pagesVisited };
  } catch (error) {
    const status = delivered ? 'PARTIAL' : error.code === 'DEADLINE' ? 'TIMED_OUT' : [401, 403].includes(error.status) ? 'BLOCKED' : 'FAILED';
    // Do not log raw HTTP/parser error text which could contain issued credentials.
    const transient = error.transient === true || error.status === 429 || error.status >= 500
      || ['ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EAI_AGAIN'].includes(error.cause?.code);
    const answered = lastHttp.status != null ? ` Last answer: ${lastHttp.phase} HTTP ${lastHttp.status}${lastHttp.server ? ` (${lastHttp.server})` : ''}.`
      : error.status ? ` HTTP ${error.status}.` : '';
    const code = error.code === 'DEADLINE' ? 'DEADLINE' : status === 'BLOCKED' ? 'SSGE_ACCESS_DENIED' : 'SSGE_ACQUISITION_FAILED';
    await emit(status, [], [{ code, message: `SS.ge acquisition stopped; previously ingested observations are retained.${answered}` }], transient && status === 'FAILED' && !delivered);
    return { status, delivered, pagesVisited };
  }
}
