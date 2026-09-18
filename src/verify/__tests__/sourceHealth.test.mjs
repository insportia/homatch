// What the lane remembers about its sources.
//
// The registry is only worth writing to if the numbers in it mean something
// later. The properties tested here are the ones that decide that:
//
//   - adverts read and properties found are different counters;
//   - a source that failed records the failure, never a zero;
//   - a source that was never asked leaves no trace at all;
//   - counters accumulate across runs, because the history IS the value;
//   - a timestamp only moves on the event it names.

import test from 'node:test';
import assert from 'node:assert/strict';

import { portalHealthUpdates, mergeSourceRow, accessStateFor } from '../sourceHealth.ts';

const advert = (family, url) => ({
  portalId: family,
  sourceFamily: family,
  externalId: url,
  url,
  listing: {},
  priceBasis: 'ASKING_SALE_PRICE',
  retrievedAt: '2026-09-18T20:00:00.000Z',
  via: 'http',
  queryId: 'q',
  matchRationale: 'r',
});

const outcome = (over = {}) => ({
  portalId: 'ss-ge',
  sourceFamily: 'ss.ge',
  state: 'OK',
  listingsFound: 0,
  totalAvailable: null,
  pagesFetched: 1,
  networkRequests: 1,
  serverFilters: [],
  clientFilters: [],
  unsupportedFilters: [],
  detail: null,
  durationMs: 10,
  ...over,
});

const evidence = (over = {}) => ({
  queries: [],
  advertisements: [],
  uniqueProperties: [],
  uncertainDuplicateCount: 0,
  crossPostedCount: 0,
  independentSourceCount: 0,
  observationCount: 0,
  portals: [],
  truncatedByDeadline: false,
  networkRequests: 0,
  widened: false,
  startedAt: '2026-09-18T20:00:00.000Z',
  finishedAt: '2026-09-18T20:00:10.000Z',
  ...over,
});

test('adverts read and properties found are recorded as different numbers', () => {
  const a = advert('ss.ge', 'https://home.ss.ge/en/real-estate/a-1');
  const b = advert('ss.ge', 'https://home.ss.ge/en/real-estate/a-2');
  const [update] = portalHealthUpdates(
    evidence({
      advertisements: [a, b, advert('ss.ge', 'https://home.ss.ge/en/real-estate/a-3')],
      uniqueProperties: [
        { id: '1', primary: a, crossPosted: [b], uncertain: [], sourceFamilies: ['ss.ge'], priceConflict: null, groupingReason: '' },
      ],
      portals: [outcome({ listingsFound: 3 })],
    }),
  );
  // Three adverts described one property. A registry that stored one number
  // could not tell a productive source from a repetitive one.
  assert.equal(update.scanned, 3);
  assert.equal(update.useful, 1);
  assert.equal(update.url, 'https://home.ss.ge');
  assert.equal(update.accessState, 'PUBLIC');
  assert.equal(update.failureReason, null);
});

test('a refusal is recorded as a refusal, not as an empty market', () => {
  const [update] = portalHealthUpdates(
    evidence({ portals: [outcome({ state: 'BLOCKED', detail: 'HTTP 403' })] }),
  );
  assert.equal(update.succeeded, false);
  assert.equal(update.accessState, 'INACCESSIBLE');
  assert.match(update.failureReason, /BLOCKED/);
  assert.equal(update.useful, 0);
});

test('a transient failure degrades a source rather than retiring it', () => {
  assert.equal(accessStateFor(outcome({ state: 'RATE_LIMITED' })), 'DEGRADED');
  assert.equal(accessStateFor(outcome({ state: 'UNAVAILABLE' })), 'DEGRADED');
  // A flat refusal is different from a bad minute.
  assert.equal(accessStateFor(outcome({ state: 'BLOCKED' })), 'INACCESSIBLE');
  // And a wall is a human decision, never a retry.
  assert.equal(accessStateFor(outcome({ state: 'LOGIN_WALL' })), 'AUTHENTICATED_ACCESS');
  assert.equal(accessStateFor(outcome({ state: 'JOIN_REQUIRED' })), 'JOIN_REQUIRED');
});

test('a source that was never asked leaves no trace', () => {
  const updates = portalHealthUpdates(
    evidence({
      portals: [outcome({ state: 'NOT_SUPPORTED' }), outcome({ state: 'DEADLINE' })],
    }),
  );
  // "We did not ask" is not a fact about the source, and writing it would
  // make an untried portal look tried and empty.
  assert.deepEqual(updates, []);
});

test('counters accumulate across runs, because the history is the value', () => {
  const update = {
    url: 'https://home.ss.ge',
    platform: 'WEBSITE',
    sourceType: 'WEBSITE',
    name: 'ss.ge',
    countryCode: 'GE',
    accessState: 'PUBLIC',
    scanned: 40,
    useful: 36,
    succeeded: true,
    failureReason: null,
  };
  const row = mergeSourceRow(
    { scanned_signal_count: 100, useful_signal_count: 60, failure_count: 2, name: 'ss.ge' },
    update,
    '2026-09-18T20:00:00.000Z',
  );
  assert.equal(row.scanned_signal_count, 140);
  assert.equal(row.useful_signal_count, 96);
  assert.equal(row.failure_count, 2, 'a success does not clear an old failure count');
  assert.equal(row.last_successful_at, '2026-09-18T20:00:00.000Z');
  assert.equal(row.last_useful_at, '2026-09-18T20:00:00.000Z');
});

test('a timestamp only moves on the event it names', () => {
  // Reachable, but produced nothing usable: last_successful_at moves,
  // last_useful_at must not.
  const row = mergeSourceRow(
    { last_successful_at: '2026-01-01T00:00:00.000Z', last_useful_at: '2026-01-01T00:00:00.000Z' },
    {
      url: 'https://home.ss.ge', platform: 'WEBSITE', sourceType: 'WEBSITE', name: 'ss.ge',
      countryCode: 'GE', accessState: 'PUBLIC', scanned: 12, useful: 0, succeeded: true, failureReason: null,
    },
    '2026-09-18T20:00:00.000Z',
  );
  assert.equal(row.last_successful_at, '2026-09-18T20:00:00.000Z');
  assert.equal(row.last_useful_at, '2026-01-01T00:00:00.000Z', 'nothing useful happened');

  // A failure keeps the old success timestamp and increments the failures.
  const failed = mergeSourceRow(
    { last_successful_at: '2026-01-01T00:00:00.000Z', failure_count: 1 },
    {
      url: 'https://home.ss.ge', platform: 'WEBSITE', sourceType: 'WEBSITE', name: 'ss.ge',
      countryCode: 'GE', accessState: 'INACCESSIBLE', scanned: 0, useful: 0, succeeded: false,
      failureReason: 'BLOCKED: HTTP 403',
    },
    '2026-09-18T20:00:00.000Z',
  );
  assert.equal(failed.last_successful_at, '2026-01-01T00:00:00.000Z');
  assert.equal(failed.failure_count, 2);
  assert.match(failed.last_failure_reason, /403/);
});

test('one portal answering two envelopes is still one source row', () => {
  const a = advert('ss.ge', 'https://home.ss.ge/en/real-estate/a-1');
  const updates = portalHealthUpdates(
    evidence({
      advertisements: [a],
      uniqueProperties: [
        { id: '1', primary: a, crossPosted: [], uncertain: [], sourceFamilies: ['ss.ge'], priceConflict: null, groupingReason: '' },
      ],
      // The primary envelope and its widened retry both answered.
      portals: [outcome({ listingsFound: 10 }), outcome({ listingsFound: 5 })],
    }),
  );
  assert.equal(updates.length, 1, 'a source is a thing with a history, not a search');
  assert.equal(updates[0].scanned, 15);
});
