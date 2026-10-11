// A finished report's market evidence, refreshed once from the free portals
// (owner 2026-10-11, job 8ba97da9): when it starts, how it folds, and that
// the rebuild it requests happens exactly once and bypasses the fast read.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { needsMarketRefresh, refreshProfile, startedMarker, failedMarker, foldMarketRefresh, rebuildRequest, MARKET_REFRESH_VERSION } from '../marketRefresh.ts';
import { shouldAutoUpgrade, markUpgradeAttempted, rebuildRequestPending, REPORT_LOGIC_VERSION } from '../intelligence/reportVersion.ts';
import { canServeStoredFast, readEnrichmentMarkers } from '../intelligence/reportReadPath.ts';

const NOW = '2026-10-11T12:00:00.000Z';
const profile = { city: 'თბილისი', district: 'კრწანისი', transactionType: 'BUY', propertyType: 'APARTMENT', areaSqm: null, rooms: null, priceUsd: null };
const existing = { url: 'https://www.ss.ge/ka/udzravi-qoneba/1', price: 440000, currency: 'USD', areaSqm: 127, pricePerSqm: 3465 };
const wc = (i, source = 'MYHOME') => ({
  source, sourceListingId: `${source}-${i}`, exactUrl: `https://www.${source === 'MYHOME' ? 'myhome.ge' : 'ss.ge'}/x/${i}`, price: 200000 + i * 1000, currency: 'USD',
  pricePerSqm: 2500, areaSqm: 90, rooms: 3, bedrooms: 2, floor: 5, totalFloors: 12, city: 'თბილისი', district: 'ორთაჭალა', address: 'კრწანისის ქ.',
  latitude: null, longitude: null, propertyType: 'APARTMENT', transactionType: 'BUY', buildingStatus: null, renovationStatus: null, title: `ბინა ${i}`,
  publishedAt: '2026-10-01T00:00:00Z', updatedAt: null, observedAt: NOW, imageHashes: [], phoneHash: null, scope: 'DISTRICT',
});
const workerJob = (n) => ({
  id: 'w1', status: 'COMPLETE', profile,
  sources: { MYHOME: { source: 'MYHOME', status: 'COMPLETE', attempts: [{ scope: 'DISTRICT', district: 'კრწანისი', discovered: n, returned: n, status: 'COMPLETE', error: null, durationMs: 1 }], listings: n, error: null },
    SSGE: { source: 'SSGE', status: 'COMPLETE', attempts: [], listings: 0, error: null } },
  comparables: Array.from({ length: n }, (_, i) => wc(i)),
});

test('a finished job without a marker needs one refresh; running/folded do not; failures retry once', () => {
  assert.equal(needsMarketRefresh({}), true);
  assert.equal(needsMarketRefresh({ _marketRefresh: { version: MARKET_REFRESH_VERSION, state: 'RUNNING', attempts: 1 } }), false);
  assert.equal(needsMarketRefresh({ _marketRefresh: { version: MARKET_REFRESH_VERSION, state: 'FOLDED', attempts: 1 } }), false);
  assert.equal(needsMarketRefresh({ _marketRefresh: { version: MARKET_REFRESH_VERSION, state: 'LOST', attempts: 1 } }), true);
  assert.equal(needsMarketRefresh({ _marketRefresh: { version: MARKET_REFRESH_VERSION, state: 'TIMED_OUT', attempts: 2 } }), false);
});

test('the refresh searches with the profile the original search recorded', () => {
  assert.deepEqual(refreshProfile({ _marketplaceLedger: { profile } }), profile);
  assert.equal(refreshProfile({ _marketplaceLedger: {} }), null);
  const m = startedMarker({ attempts: 1, state: 'LOST' }, 'w9', profile, NOW);
  assert.equal(m.state, 'RUNNING');
  assert.equal(m.attempts, 2);
  assert.equal(failedMarker(m, 'TIMED_OUT', NOW).attempts, 2);
});

test('fold keeps the existing comparables first, adds the new ones, keeps the old ledger', () => {
  const rj = { market: { comparables: [existing], summary: 'kept' }, _marketplaceLedger: { profile, state: 'FOLDED', finalComparableCount: 1 }, _marketRefresh: startedMarker(null, 'w1', profile, NOW), officialEvidence: { untouched: true } };
  const out = foldMarketRefresh(rj, workerJob(25), { project: null, latitude: null, longitude: null, district: 'კრწანისი' }, NOW);
  assert.equal(out.market.comparables[0], existing);
  assert.equal(out.market.comparables.length, 26);
  assert.equal(out.market.summary, 'kept');
  assert.deepEqual(out.officialEvidence, { untouched: true });
  assert.equal(out._marketRefresh.state, 'FOLDED');
  assert.equal(out._marketRefresh.before, 1);
  assert.equal(out._marketRefresh.after, 26);
  assert.equal(out._marketplaceLedger.previous.finalComparableCount, 1);
  assert.deepEqual(out._marketplaceLedger.profile, profile);
  assert.notEqual(out, rj, 'a new object; the input is not mutated');
  assert.equal(rj.market.comparables.length, 1);
});

test('a rebuild request is honoured exactly once and is never served from the fast path', () => {
  const at = '2026-10-11T12:05:00.000Z';
  const current = { _logicVersion: REPORT_LOGIC_VERSION, ...readEnrichmentMarkers(), summary: 'x' };
  const requested = { ...current, _rebuildRequested: rebuildRequest('MARKET_REFRESH', at) };
  const input = (p) => ({ synthesisState: 'READY', synthesisJson: p, completedAt: '2026-10-11T07:09:00Z', now: Date.parse(NOW) });
  assert.equal(shouldAutoUpgrade(input(current)), false);
  assert.equal(rebuildRequestPending(requested), true);
  assert.equal(shouldAutoUpgrade(input(requested)), true);
  assert.equal(canServeStoredFast({ synthesis_state: 'READY', synthesis_json: current }), true);
  assert.equal(canServeStoredFast({ synthesis_state: 'READY', synthesis_json: requested }), false);
  // A failed attempt is not retried on every open.
  const failed = markUpgradeAttempted(requested);
  assert.equal(failed._rebuildRequestAttempted, at);
  assert.equal(shouldAutoUpgrade(input(failed)), false);
  assert.equal(canServeStoredFast({ synthesis_state: 'READY', synthesis_json: failed }), true);
});

test('wiring: verify-synthesis starts the refresh on a rebuild; the driver folds it', () => {
  const root = join(import.meta.dirname, '..', '..', '..');
  const vs = readFileSync(join(root, 'supabase/functions/verify-synthesis/index.ts'), 'utf8');
  const ra = readFileSync(join(root, 'supabase/functions/research-agent/index.ts'), 'utf8');
  assert.match(vs, /await recoverVisualsBeforeRebuild\(job\);\s*\/\/[^\n]*\n\s*await startMarketRefreshBeforeRebuild\(job\);/);
  assert.match(ra, /action \|\| ''\) === 'refresh_market'/);
  assert.match(ra, /await driveSynthesis\(sb\);\s*await pollMarketRefreshes\(sb\);/);
  assert.match(ra, /_rebuildRequested: rebuildRequest\('MARKET_REFRESH'/);
  // Production 2026-10-11: selecting a column research_jobs does not have
  // (`type`) failed the sweep every tick; only real columns may be selected.
  const sweep = ra.slice(ra.indexOf('async function pollMarketRefreshes'), ra.indexOf('async function pollMarketRefreshes') + 900);
  const cols = (sweep.match(/\.select\('([^']+)'\)/) ?? [])[1]?.split(',') ?? [];
  assert.deepEqual(cols.filter((c) => !['id', 'query', 'mode', 'result_json', 'synthesis_json', 'synthesis_state'].includes(c)), []);
  assert.match(ra, /needsMarketRefresh\(next\)\) \{\s*const again = await startJobMarketRefresh\(sb, j\.id\)/);
});
