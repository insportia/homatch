// Section maturity: what a customer may read while the rest is still running.
//
// The contract being tested is narrow and it is the whole point of showing a
// report before it is finished:
//
//   - a section becomes usable when the EVIDENCE exists, not when time passes;
//   - PRELIMINARY is never presented as VERIFIED;
//   - "still running" and "we looked and found nothing" are different states;
//   - a blocked official source makes a section PARTIAL, never a failed job;
//   - SYNTHESIS is only ever complete when a report actually exists.

import test from 'node:test';
import assert from 'node:assert/strict';

import { computeSections, isUsable, SECTION_IDS } from '../sections.ts';

const at = (result, extra = {}) =>
  computeSections({ result, now: () => Date.parse('2026-09-18T20:00:00Z'), ...extra });

const find = (snapshot, id) => snapshot.sections.find((s) => s.id === id);

test('an empty job has every section pending and nothing usable', () => {
  const snapshot = at({});
  assert.equal(snapshot.sections.length, SECTION_IDS.length);
  for (const section of snapshot.sections) {
    // RISKS is legitimately "nothing to report" rather than pending once the
    // run is terminal; while running with no evidence it is pending too.
    assert.ok(['PENDING', 'VERIFIED'].includes(section.maturity), section.id);
  }
  assert.equal(snapshot.anyUsable, false);
});

test('the market section becomes usable from the deterministic lane alone', () => {
  const snapshot = at({
    _marketLane: {
      advertisements: 30,
      uniqueProperties: 27,
      crossPosted: 3,
      uncertainDuplicates: 10,
      independentSourceCount: 1,
      priceConflicts: 2,
    },
  });
  const market = find(snapshot, 'MARKET');
  // Usable, and explicitly not final: the AI market stage has not run yet.
  assert.equal(market.maturity, 'PRELIMINARY');
  assert.equal(isUsable(market.maturity), true);
  assert.equal(snapshot.anyUsable, true);
  assert.equal(market.metrics.advertisements, 30);
  assert.equal(market.metrics.uniqueProperties, 27);
  assert.equal(market.metrics.priceConflicts, 2);
});

test('advertisements, unique properties and sources stay three different numbers', () => {
  const market = find(
    at({
      _marketLane: {
        advertisements: 30,
        uniqueProperties: 27,
        crossPosted: 3,
        uncertainDuplicates: 10,
        independentSourceCount: 1,
      },
    }),
    'MARKET',
  );
  assert.notEqual(market.metrics.advertisements, market.metrics.uniqueProperties);
  assert.notEqual(market.metrics.uniqueProperties, market.metrics.independentSources);
  assert.equal(market.metrics.independentSources, 1);
});

test('the market section strengthens when the report gains comparables', () => {
  const snapshot = at({
    _marketLane: { advertisements: 30, uniqueProperties: 27 },
    market: { comparables: [{ url: 'https://a.test/1' }, { url: 'https://a.test/2' }] },
  });
  assert.equal(find(snapshot, 'MARKET').maturity, 'ENRICHING');
});

test('a finished run with comparables is VERIFIED, without them UNAVAILABLE', () => {
  const done = at(
    { market: { comparables: [{ url: 'https://a.test/1' }] } },
    { status: 'COMPLETE' },
  );
  assert.equal(find(done, 'MARKET').maturity, 'VERIFIED');

  const empty = at({}, { status: 'COMPLETE' });
  // "We looked and found nothing" is a finding. It must not read as pending
  // forever, which is what an empty row looks like to a reader.
  assert.equal(find(empty, 'MARKET').maturity, 'UNAVAILABLE');
});

test('a widened envelope and a spent time budget are disclosed, not hidden', () => {
  const market = find(
    at({
      _marketLane: {
        advertisements: 8,
        uniqueProperties: 6,
        widened: true,
        truncatedByDeadline: true,
        blockedSources: ['BLOCKED'],
      },
    }),
    'MARKET',
  );
  assert.ok(market.notes.includes('MARKET_ENVELOPE_WIDENED'));
  assert.ok(market.notes.includes('MARKET_TIME_BUDGET_REACHED'));
  assert.ok(market.notes.includes('MARKET_SOURCE_BLOCKED'));
});

test('a blocked official source is PARTIAL, never a failed verification', () => {
  const official = find(
    at({
      officialSourceCoverage: [
        { source: 'tas', customerStatus: 'SUCCESS' },
        { source: 'napr', customerStatus: 'BLOCKED' },
      ],
      officialDocumentsRetrieved: [{ url: 'https://o.test/1' }],
    }),
    'OFFICIAL',
  );
  assert.equal(official.maturity, 'PARTIAL');
  assert.equal(isUsable(official.maturity), true, 'the section is still readable');
  assert.ok(official.notes.includes('OFFICIAL_SOURCE_NOT_READABLE'));
  assert.equal(official.metrics.sourcesConfirmed, 1);
  assert.equal(official.metrics.sourcesBlocked, 1);
});

test('official evidence that never arrived is UNAVAILABLE, not confirmed', () => {
  const official = find(
    at({ officialSourceCoverage: [{ source: 'tas', customerStatus: 'BLOCKED' }] }),
    'OFFICIAL',
  );
  assert.equal(official.maturity, 'UNAVAILABLE');
});

test('a company known only from the web is PRELIMINARY and says why', () => {
  const dev = find(
    at({ companyProfile: { name: 'Some LLC', sourceBasis: 'WEB_RESEARCH_ONLY' } }),
    'DEVELOPER',
  );
  assert.equal(dev.maturity, 'PRELIMINARY');
  assert.ok(dev.notes.includes('COMPANY_FROM_WEB_RESEARCH_ONLY'));

  const confirmed = find(
    at({ companyProfile: { name: 'Some LLC', idCode: '405', sourceBasis: 'REGISTRY_CONFIRMED' } }),
    'DEVELOPER',
  );
  assert.equal(confirmed.maturity, 'ENRICHING');
  assert.deepEqual(confirmed.notes, []);
});

test('an unconfirmed unit is disclosed rather than presented as identified', () => {
  const property = find(at({ identifiedParent: { code: '01.18.06' } }), 'PROPERTY');
  assert.equal(property.maturity, 'ENRICHING');
  assert.ok(property.notes.includes('UNIT_NOT_INDEPENDENTLY_CONFIRMED'));

  const verified = find(at({ exactUnit: { code: '01.18.06.001', verified: true } }), 'PROPERTY');
  assert.equal(verified.maturity, 'VERIFIED');
  assert.deepEqual(verified.notes, []);
});

test('a finished run never leaves a section looking like it is still loading', () => {
  // Production, job 8dfff8f5: a free-text query that never resolved to a
  // cadastral unit left PROPERTY at PENDING after COMPLETE. PENDING renders
  // as "not started", so the finished report showed a section that appeared
  // to be still loading and always would be.
  const done = at({ exactUnit: { code: null, verified: false } }, { status: 'COMPLETE' });
  for (const section of done.sections) {
    assert.notEqual(section.maturity, 'PENDING', `${section.id} is PENDING on a finished run`);
  }
  const property = find(done, 'PROPERTY');
  assert.equal(property.maturity, 'UNAVAILABLE');

  // While still running, PENDING remains the honest answer.
  const running = find(at({}), 'PROPERTY');
  assert.equal(running.maturity, 'PENDING');
});

test('synthesis is complete only when a report actually exists', () => {
  // Research finishing is not the report being ready, and the state must
  // never say otherwise.
  assert.equal(find(at({}, { status: 'COMPLETE' }), 'SYNTHESIS').maturity, 'PARTIAL');
  assert.equal(find(at({ summary: 'A real report.' }), 'SYNTHESIS').maturity, 'VERIFIED');
  assert.equal(find(at({}), 'SYNTHESIS').maturity, 'PENDING');
});

test('a zero count is reported as absent rather than as a real zero', () => {
  const location = find(at({ publicResearch: { nearbyPlaces: [] } }), 'LOCATION');
  // "0 nearby places" reads as a measured result. Null means not applicable,
  // and the UI shows nothing at all.
  assert.equal(location.metrics.nearbyPlaces, 0);
  const market = find(at({}), 'MARKET');
  assert.equal(market.metrics.comparablesInReport, null);
});

test('section state is a pure function of the evidence, not of the clock', () => {
  const result = { _marketLane: { advertisements: 5, uniqueProperties: 5 } };
  const a = computeSections({ result, now: () => 1000 });
  const b = computeSections({ result, now: () => 9_999_999 });
  assert.deepEqual(
    a.sections.map((s) => [s.id, s.maturity]),
    b.sections.map((s) => [s.id, s.maturity]),
  );
});

test('no internal machinery leaks into the customer-visible metrics', () => {
  const market = find(
    at({
      _marketLane: {
        advertisements: 30,
        uniqueProperties: 27,
        networkRequests: 3,
        cacheHits: 2,
        portals: [{ id: 'ss-ge', state: 'OK', detail: null }],
      },
    }),
    'MARKET',
  );
  const rendered = JSON.stringify(market);
  assert.ok(!rendered.includes('networkRequests'));
  assert.ok(!rendered.includes('ss-ge'));
  assert.ok(!rendered.includes('cacheHits'));
});

/*
 * DEGRADED MODE: the report a stalled worker leaves behind.
 *
 * Production held a job in FINANCIAL_ENTITY_WAITING for 2,307 seconds
 * because one official-source lookup stopped progressing. The job never
 * finished, so `finished` stayed false and EVERY section stayed PENDING —
 * which renders as "not started". A customer looking at that saw a report
 * that was permanently about to begin.
 *
 * The watchdog (supabase/functions/_shared/verifyWatchdog.ts) now abandons
 * the individual source and lets the run complete. These two tests pin the
 * consequence: the run reaches a terminal status, the abandoned source is
 * disclosed as unreadable, and NOTHING is left saying "not started".
 */
test('a run that completes after abandoning a source has no PENDING section', () => {
  const snapshot = at(
    {
      // What survived: the unit, the company, market comparables.
      exactUnit: { code: '01.10.01.001.01', verified: true },
      companyProfile: { name: 'Example LLC', idCode: '405068386', sourceBasis: 'REGISTRY_CONFIRMED' },
      marketComparables: [{ id: 1 }, { id: 2 }],
      publicResearch: { directorsRepresentatives: [{ name: 'A' }] },
      publicSignals: [{ url: 'https://x.test/1' }],
      summary: { headline: 'done' },
      // What did not: one registry lookup the watchdog gave up on. TIMEOUT
      // maps to TECHNICAL_FAILED for the customer.
      officialSourceCoverage: [
        { source: 'enreg', customerStatus: 'SUCCESS' },
        { source: 'rstax', customerStatus: 'TECHNICAL_FAILED' },
      ],
      officialDocumentsRetrieved: [{ url: 'https://o.test/1' }],
    },
    { status: 'COMPLETE', stage: 'COMPLETE' },
  );

  const pending = snapshot.sections.filter((x) => x.maturity === 'PENDING');
  assert.deepEqual(pending.map((x) => x.id), [],
    'a terminal report must never show a section as "not started"');
});

test('the abandoned source is disclosed, and does not fail the verification', () => {
  const snapshot = at(
    {
      officialSourceCoverage: [
        { source: 'enreg', customerStatus: 'SUCCESS' },
        { source: 'rstax', customerStatus: 'TECHNICAL_FAILED' },
      ],
      officialDocumentsRetrieved: [{ url: 'https://o.test/1' }],
    },
    { status: 'COMPLETE', stage: 'COMPLETE' },
  );
  const official = find(snapshot, 'OFFICIAL');
  // PARTIAL, not UNAVAILABLE and not a failed job: one source was read and
  // one was not, and the report says exactly that.
  assert.equal(official.maturity, 'PARTIAL');
  assert.equal(isUsable(official.maturity), true);
  assert.ok(official.notes.includes('OFFICIAL_SOURCE_NOT_READABLE'));
  assert.equal(official.metrics.sourcesChecked, 2);
  assert.equal(official.metrics.sourcesConfirmed, 1);
  assert.equal(official.metrics.sourcesBlocked, 1);
});
