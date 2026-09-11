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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/* ── the row a shared table is allowed to hold ───────────────────────
 *
 * research_cache held zero rows across six production verifications while
 * appearing to work. Every insert was failing on
 * research_cache_created_by_user_id_fkey: that column's foreign key points at
 * the legacy public.users profile table, which is keyed separately from
 * auth.users and reached through its auth_id column, and this module was
 * passing the job's auth.users id straight into it. The error was caught per
 * source, pushed into out.errors, and logged — so the failure was visible
 * only in a log line, and the table looked merely unused.
 *
 * It is not written at all now. A source-version row says what a public
 * registry showed for a cadastral code; it is shared across every customer
 * who looks and updated by each of them, so a "created by" is meaningless
 * after the second one — and a customer identity inside a shared table is the
 * shape of leak this layer exists to prevent.
 */

test('a source-version row carries no customer identity', async () => {
  const { recordSourceVersions } = await import('../sourceStore.ts');

  let inserted = null;
  const db = {
    from() {
      const api = {
        select: () => api,
        eq: () => api,
        maybeSingle: async () => ({ data: null }),
        insert: async (row) => { inserted = row; return { error: null }; },
        update: () => api,
      };
      return api;
    },
  };

  const out = await recordSourceVersions(
    db,
    '01.72.14.040.030.01.02.017',
    [{ source: 'tas', sourceUrl: 'https://example.ge/x', documents: [{ a: 1 }], resultConfirmed: true }],
    async (s) => `hash-${s.length}`
  );

  assert.equal(out.errors.length, 0, `the insert was rejected: ${out.errors.join(' | ')}`);
  assert.ok(inserted, 'nothing was inserted at all');
  assert.ok(
    !('created_by_user_id' in inserted),
    'a shared source-version row was stamped with a customer identity'
  );
  assert.equal(inserted.fingerprint, 'official:tas:01.72.14.040.030.01.02.017');
});

test('recordSourceVersions takes no user argument to pass by mistake', () => {
  // The parameter is gone rather than merely unused, so the auth.users id
  // cannot be handed back in by a future caller copying the old shape.
  const src = readFileSync(join(process.cwd(), 'src/verify/intelligence/sourceStore.ts'), 'utf8');
  const sig = src.slice(src.indexOf('export async function recordSourceVersions'));
  assert.ok(!/jobUserId/.test(sig.slice(0, sig.indexOf('{'))), 'the user parameter is back');
});

/* ── the re-read has to actually land ────────────────────────────────
 *
 * The insert bug and this one are the same failure twice: a write whose error
 * was never read. Production logged "4 unchanged, 2 changed" — proving the
 * comparison worked — while every row kept hit_count 1 and its original
 * last_verified_at, because freshness_status was being set to 'VERIFIED' and
 * 'CHANGED', and the column's CHECK constraint allows only LIVE, FRESH, AGING
 * and STALE.
 */

const FRESHNESS_ALLOWED = new Set(['LIVE', 'FRESH', 'AGING', 'STALE']);

async function runAgainstStored(storedRow, result, digest = async (s) => `h${s.length}`) {
  const { recordSourceVersions } = await import('../sourceStore.ts');
  let updated = null;
  const db = {
    from() {
      const api = {
        select: () => api,
        eq: () => api,
        maybeSingle: async () => ({ data: storedRow }),
        insert: async () => ({ error: null }),
        update: (row) => { updated = row; return { eq: async () => ({ error: null }) }; },
      };
      return api;
    },
  };
  const out = await recordSourceVersions(db, '01.72.14.040.030.01.02.017', [result], digest);
  return { updated, out };
}

test('re-reading a known source writes a status the column actually allows', async () => {
  const { updated, out } = await runAgainstStored(
    { id: 'row-1', content_hash: 'h-old', hit_count: 1 },
    { source: 'tas', sourceUrl: 'https://x', documents: [{ a: 1 }], resultConfirmed: true }
  );
  assert.equal(out.errors.length, 0, out.errors.join(' | '));
  assert.ok(updated, 'the stored row was never updated');
  assert.ok(
    FRESHNESS_ALLOWED.has(updated.freshness_status),
    `freshness_status '${updated.freshness_status}' violates the column's CHECK constraint`
  );
});

test('a re-read moves last_verified_at and counts the hit', async () => {
  const { updated } = await runAgainstStored(
    { id: 'row-1', content_hash: 'h-old', hit_count: 4 },
    { source: 'tas', documents: [{ a: 1 }] }
  );
  assert.equal(updated.hit_count, 5, 'the hit was not counted');
  assert.ok(updated.last_verified_at, 'last_verified_at did not move on a confirmed look');
});

test('content that moved updates the hash and the acquired time; content that did not, does not', async () => {
  // acquired_at answers "how old is what we hold", last_verified_at answers
  // "when did somebody last look". Conflating them loses the first.
  // The stored hash is whatever this exact content hashes to, computed rather
  // than guessed, so "unchanged" really means unchanged.
  const content = { source: 'tas', documents: [{ a: 1 }] };
  const stableDigest = async () => 'THE-SAME-HASH';
  const { sourceContentHash } = await import('../sourceVersion.ts');
  const expected = await sourceContentHash(content, stableDigest);

  const same = await runAgainstStored({ id: 'row-1', content_hash: expected, hit_count: 1 }, content, stableDigest);
  assert.ok(!('acquired_at' in same.updated), 'unchanged content was aged forward');

  const moved = await runAgainstStored(
    { id: 'row-1', content_hash: 'something-else', hit_count: 1 },
    { source: 'tas', documents: [{ a: 1 }] }
  );
  assert.ok(moved.updated.acquired_at, 'changed content did not update acquired_at');
  assert.ok(moved.updated.content_hash, 'changed content did not update the hash');
});

test('a rejected write-back is reported rather than swallowed', async () => {
  const { recordSourceVersions } = await import('../sourceStore.ts');
  const db = {
    from() {
      const api = {
        select: () => api,
        eq: () => api,
        maybeSingle: async () => ({ data: { id: 'row-1', content_hash: 'old', hit_count: 1 } }),
        insert: async () => ({ error: null }),
        update: () => ({ eq: async () => ({ error: { message: 'violates check constraint' } }) }),
      };
      return api;
    },
  };
  const out = await recordSourceVersions(db, 'q', [{ source: 'tas', documents: [{ a: 1 }] }], async () => 'h');
  assert.equal(out.errors.length, 1, 'a failed update was swallowed exactly like the first time');
  assert.match(out.errors[0], /violates check constraint/);
});
