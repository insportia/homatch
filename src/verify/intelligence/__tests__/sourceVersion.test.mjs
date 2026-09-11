// Has the official source itself changed since we last read it?
//
// The whole mechanism turns on what goes into the hash, and it can fail in two
// directions that look nothing alike:
//
//   TOO MUCH — hash the timestamp, the session id in the final URL, the order
//   the worker traversed frames, and every run reports CHANGED. The mechanism
//   silently achieves nothing and the only evidence is a cost line that never
//   falls.
//
//   TOO LITTLE — leave out a field that carries the answer and a real change
//   goes unnoticed, so a report states last month's ownership as current.
//
// The second is the one that harms somebody, so the tests below spend most of
// their effort there.
//
// The fixture is the real shape: the field names are taken from a completed
// production job's browserOfficial.results.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  sourceFingerprint,
  sourceContentProjection,
  sourceContentHash,
  compareToStored,
  summariseSources,
} from '../sourceVersion.ts';

const digest = async (s) => createHash('sha256').update(s).digest('hex');

/** The shape the official worker actually returns, per source. */
const TAS_RESULT = {
  source: 'tas',
  sourceName: 'TAS',
  sourceUrl: 'https://tas.gov.ge/search',
  status: 'SEARCH_CONFIRMED',
  retrievedAt: '2026-09-09T10:00:00Z',
  finalUrl: 'https://tas.gov.ge/search?session=abc123',
  frameUrls: ['https://tas.gov.ge/frame/1'],
  traversal: ['open', 'search', 'result'],
  queryEntered: '01.72.14.040.030.01.02.017',
  submitAction: 'click',
  searchControlUsed: '#search',
  resultConfirmed: true,
  resultValidated: true,
  noResultConfirmed: false,
  documents: [{ name: 'extract-2025-07-14.pdf', ref: 'D-77121' }],
  registryInterpretation: { owner: 'LLC Millenio Group' },
};

/* ── the key ─────────────────────────────────────────────────────────── */

test('a source record is keyed by the source and what we asked it', () => {
  // The TAS record for one cadastral code is a different record from the TAS
  // record for another, and both differ from the debtor registry's answer
  // about the same code.
  const a = sourceFingerprint('tas', '01.72.14.040.030.01.02.017');
  const b = sourceFingerprint('tas', '01.18.06.019.055.03.01.603');
  const c = sourceFingerprint('debtor', '01.72.14.040.030.01.02.017');
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.equal(a, sourceFingerprint('TAS', ' 01.72.14.040.030.01.02.017 '), 'spelling changed the key');
});

test('a fingerprint needs both halves', () => {
  assert.equal(sourceFingerprint('', 'x'), null);
  assert.equal(sourceFingerprint('tas', ''), null);
  assert.equal(sourceFingerprint(null, null), null);
});

/* ── what is hashed, and what must not be ────────────────────────────── */

test('re-reading an unchanged source gives the same hash', async () => {
  // The failure this prevents: every run reporting CHANGED because the
  // timestamp moved, and the whole mechanism quietly achieving nothing.
  const first = await sourceContentHash(TAS_RESULT, digest);
  const second = await sourceContentHash({
    ...TAS_RESULT,
    retrievedAt: '2026-09-11T12:00:00Z',
    finalUrl: 'https://tas.gov.ge/search?session=zzz999',
    frameUrls: ['https://tas.gov.ge/frame/2'],
    traversal: ['open', 'search', 'wait', 'result'],
    submitAction: 'enter',
    searchControlUsed: '#q',
  }, digest);
  assert.equal(first, second, 'a fetch detail changed the content hash');
});

test('key order alone is not a change', async () => {
  const reordered = { registryInterpretation: TAS_RESULT.registryInterpretation, documents: TAS_RESULT.documents, resultConfirmed: true, resultValidated: true, noResultConfirmed: false };
  const a = await sourceContentHash(TAS_RESULT, digest);
  const b = await sourceContentHash({ ...reordered, source: 'tas' }, digest);
  assert.equal(a, b, 'serialisation order read as a change');
});

test('a different document IS a change', async () => {
  const before = await sourceContentHash(TAS_RESULT, digest);
  const after = await sourceContentHash({
    ...TAS_RESULT,
    documents: [{ name: 'extract-2026-09-11.pdf', ref: 'D-90012' }],
  }, digest);
  assert.notEqual(before, after, 'a new registry extract went unnoticed');
});

test('a different owner IS a change', async () => {
  // The case that matters most: missing this states last month's ownership as
  // current.
  const before = await sourceContentHash(TAS_RESULT, digest);
  const after = await sourceContentHash({
    ...TAS_RESULT,
    registryInterpretation: { owner: 'Somebody Else' },
  }, digest);
  assert.notEqual(before, after, 'a change of owner went unnoticed');
});

test('the source changing its answer IS a change', async () => {
  for (const field of ['resultConfirmed', 'resultValidated', 'noResultConfirmed', 'debtorRecordFound']) {
    const before = await sourceContentHash(TAS_RESULT, digest);
    const after = await sourceContentHash({ ...TAS_RESULT, [field]: !TAS_RESULT[field] }, digest);
    assert.notEqual(before, after, `${field} flipping went unnoticed`);
  }
});

test('the projection is an allow-list, so a new volatile field cannot creep in', () => {
  // A denylist would silently start hashing whatever the worker adds next,
  // and the first volatile one would turn every comparison into CHANGED.
  const p = sourceContentProjection({ ...TAS_RESULT, someNewFieldTheWorkerAdded: Date.now() });
  assert.ok(!('someNewFieldTheWorkerAdded' in p), 'an unrecognised field was hashed');
  for (const excluded of ['retrievedAt', 'finalUrl', 'frameUrls', 'traversal', 'submitAction', 'searchControlUsed', 'queryEntered', 'status', 'error']) {
    assert.ok(!(excluded in p), `${excluded} is part of the content hash`);
  }
  for (const included of ['documents', 'resultConfirmed', 'registryInterpretation']) {
    assert.ok(included in p, `${included} is missing from the content hash`);
  }
});

test('a source with nothing to compare has no hash', async () => {
  // A technical failure is not a property fact and it is not a version
  // either. Recorded as "unchanged" next time, it would freeze whatever we
  // last believed.
  for (const nothing of [null, undefined, {}, 'x', { source: 'tas', status: 'BLOCKED', error: 'timeout', retrievedAt: 'now' }]) {
    assert.equal(await sourceContentHash(nothing, digest), null, `${JSON.stringify(nothing)} produced a hash`);
  }
});

/* ── the comparison ──────────────────────────────────────────────────── */

test('the first sighting is NEW, an identical one UNCHANGED, a different one CHANGED', () => {
  const f = 'official:tas:x';
  assert.equal(compareToStored(f, 'tas', null, 'abc', null).state, 'NEW');
  assert.equal(compareToStored(f, 'tas', null, 'abc', 'abc').state, 'UNCHANGED');
  assert.equal(compareToStored(f, 'tas', null, 'def', 'abc').state, 'CHANGED');
});

test('not being able to compare is never UNCHANGED', () => {
  // The first source that stops exposing comparable content would otherwise
  // freeze its facts for ever.
  assert.equal(compareToStored('f', 'tas', null, null, 'abc').state, 'UNKNOWN');
  assert.equal(compareToStored('f', 'tas', null, null, null).state, 'UNKNOWN');
});

test('what we held before travels with the answer', () => {
  const o = compareToStored('f', 'tas', 'https://tas.gov.ge', 'def', 'abc');
  assert.equal(o.previousHash, 'abc');
  assert.equal(o.contentHash, 'def');
  assert.equal(o.sourceUrl, 'https://tas.gov.ge');
});

test('a run summarises what it found, for the record rather than the customer', () => {
  const s = summariseSources([
    compareToStored('a', 'tas', null, 'x', 'x'),
    compareToStored('b', 'enreg', null, 'y', 'z'),
    compareToStored('c', 'debtor', null, 'w', null),
    compareToStored('d', 'msmap', null, null, null),
  ]);
  assert.match(s, /1 new/);
  assert.match(s, /1 unchanged/);
  assert.match(s, /1 changed/);
  assert.match(s, /1 not comparable/);
  assert.equal(summariseSources([]), 'no sources read');
});

/* ── how it is wired ─────────────────────────────────────────────────── */

test('source versions are recorded from every verification, after the report is safe', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const agent = readFileSync(
    join(process.cwd(), 'supabase', 'functions', 'research-agent', 'index.ts'),
    'utf8'
  ).split('\r\n').join('\n');

  assert.match(agent, /async function recordOfficialSourceVersions/, 'nothing records source versions');
  assert.match(agent, /from\('research_cache'\)|recordSourceVersions\(/,
    'the store built for this is still unused');

  // After the job is written, like every other piece of bookkeeping.
  const iSave = agent.indexOf("const finished = await sb.from('research_jobs').update({ status: 'COMPLETE'");
  const iSrc = agent.indexOf('await recordOfficialSourceVersions(');
  assert.ok(iSave > 0 && iSrc > iSave, 'source versions are recorded before the report is saved');
});

test('nothing consults a source version to skip work yet', async () => {
  // Acting on an UNCHANGED verdict means skipping a paid read, which is
  // routing, and routing waits for the benchmark like everything else.
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const agent = readFileSync(
    join(process.cwd(), 'supabase', 'functions', 'research-agent', 'index.ts'),
    'utf8'
  );
  assert.ok(!/state === 'UNCHANGED'/.test(agent), 'the pipeline already branches on an unbenchmarked verdict');
});
