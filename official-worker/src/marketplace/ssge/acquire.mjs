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
 */
export const SSGE_PAGE_CAP = 3;

export async function acquireSsge(request, { deadlineAt, signal, report, client, fetcher, sleep = ms => delay(ms, undefined, { signal }), verifyPage = verifyIndividualPage, pageCap = SSGE_PAGE_CAP } = {}) {
  if (!Number.isInteger(pageCap) || pageCap < 1 || pageCap > SSGE_PAGE_CAP) throw Error('Invalid SS.ge page cap');
  const started = Date.now(), deadline = Date.parse(deadlineAt);
  let pagesVisited = 0, discoveredCount = 0, delivered = 0, rejected = 0, stop = null, actions = 0;
  const errors = [], queryApplied = { acquisition: 'SSGE_ACCEPTED_STANDALONE_HTTP2' };
  const remaining = () => {
    signal?.throwIfAborted();
    if (!Number.isFinite(deadline) || Date.now() >= deadline - 15000) throw Object.assign(Error('Existing run deadline reached'), { code: 'DEADLINE' });
  };
  const boundedSignal = () => AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(Math.max(1, Math.min(30000, deadline - Date.now() - 10000)))]);
  const publicFetch = fetcher ?? createGatewayHttp2Fetch();
  const boundedFetch = (url, options = {}) => { remaining(); actions++; return publicFetch(url, { ...options, signal: AbortSignal.any([boundedSignal(), ...(options.signal ? [options.signal] : [])]) }); };
  const runSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(Number.isFinite(deadline) ? Math.max(1, deadline - Date.now() - 10000) : 1)]);
  const source = client ?? new SsgePublicClient({ http: { fetchImpl: boundedFetch, signal: runSignal, retries: 1 } });
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
      rejected += page.excluded.length;
      const candidates = [];
      for (const listing of page.items) {
        remaining(); await sleep(500);
        try {
          const detail = await new SsgeAdapter({ client: source }).detail(listing.sourceListingId);
          const proof = await verifyPage(listing, { fetchImpl: boundedFetch, signal: boundedSignal() });
          if ([401, 403, 429].includes(proof.status)) throw Object.assign(Error('SS.ge public page unavailable'), { status: proof.status });
          const check = compareDetail(listing, detail, { pageProof: proof });
          if (detail.raw.isInactiveApplication === true || !check.passed || !validateCriteria(detail, criteria, source.locations, { requireUrl: false }).passed) { rejected++; continue; }
          candidates.push(ssgeCandidate(listing, detail, request, page.page));
        } catch (error) {
          if (signal?.aborted || error.code === 'DEADLINE' || [401, 403, 429].includes(error.status)) throw error;
          rejected++;
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
    if (rejected) errors.push({ code: 'SOURCE_RECORDS_REJECTED', message: `${rejected} source records failed identity, detail or criteria checks` });
    const status = complete && !rejected ? 'COMPLETE' : 'PARTIAL';
    await emit(status, [], errors);
    return { status, delivered, pagesVisited };
  } catch (error) {
    const status = delivered ? 'PARTIAL' : error.code === 'DEADLINE' ? 'TIMED_OUT' : [401, 403].includes(error.status) ? 'BLOCKED' : 'FAILED';
    // Do not log raw HTTP/parser error text which could contain issued credentials.
    const transient = error.transient === true || error.status === 429 || error.status >= 500
      || ['ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EAI_AGAIN'].includes(error.cause?.code);
    await emit(status, [], [{ code: error.code === 'DEADLINE' ? 'DEADLINE' : 'SSGE_ACQUISITION_FAILED', message: 'SS.ge acquisition stopped; previously ingested observations are retained.' }], transient && status === 'FAILED' && !delivered);
    return { status, delivered, pagesVisited };
  }
}
