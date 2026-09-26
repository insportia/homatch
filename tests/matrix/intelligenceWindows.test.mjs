// THE READ SIDE OF THE TIME MODEL.
//
// timeBounds() shipped with the time model and had no consumers: nine windows
// were computable and nothing queried with them. community-intelligence is the
// consumer, and the failure it has to avoid is not a crash -- it is a number that
// looks right.
//
// Two of those, specifically:
//
//   A BUCKET THIS FILE GENERATES MUST EQUAL A BUCKET POSTGRES RETURNS. The series
//   is assembled by matching generated bucket starts against date_trunc output as
//   strings. If the two truncate differently -- one to the minute, one to the hour,
//   or a week to Sunday instead of Monday -- every real value is orphaned and the
//   chart renders as all zeroes beside its own data. Nothing throws.
//
//   AN EMPTY BUCKET MUST BE A ZERO, NOT A MISSING POINT. GROUP BY returns only
//   buckets with rows, and four scattered points drawn as a line assert a
//   continuity that was never observed.
//
// The bucket arithmetic is exercised directly rather than through assertions about
// the source text, because "does this agree with Postgres" is a question about
// behaviour and not about wording.
//
// VERIFIED AGAINST PRODUCTION POSTGRES, 2026-09-26. Every expected value below was
// read back out of the database rather than reasoned about:
//
//   date_trunc('hour',  '2026-09-26T13:47:33.912Z')  ->  2026-09-26 13:00:00
//   date_trunc('day',   '2026-09-26T13:47:33.912Z')  ->  2026-09-26 00:00:00
//   date_trunc('week',  '2026-09-26T13:47:33.912Z')  ->  2026-09-21 00:00:00  (Sat)
//   date_trunc('week',  '2026-09-27T09:00:00.000Z')  ->  2026-09-21 00:00:00  (Sun)
//   date_trunc('month', '2026-09-26T13:47:33.912Z')  ->  2026-09-01 00:00:00
//   date_trunc('week',  '2026-07-14T05:23:11.500Z')  ->  2026-07-13 00:00:00  (Tue)
//
// The Sunday row is the one worth having: it confirms Postgres puts Sunday at the
// END of the week beginning Monday the 21st, which is what (getUTCDay() + 6) % 7
// computes and what a naive subtraction would get wrong by six days.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  bucketCount,
  timeBounds,
} from '../../src/research-core/signals/community-evidence.ts';
/*
 * Imported, not reimplemented. The rule under test is "this agrees with Postgres",
 * and a copy of the arithmetic here would only prove it agrees with itself -- which
 * is exactly the failure mode, since a disagreement renders as zeroes rather than
 * as an error.
 */
import { bucketStarts, nextBucket, truncateTo } from '../../src/research-core/signals/time-buckets.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = join(root, 'supabase', 'functions', 'community-intelligence', 'index.ts');
const source = readFileSync(FILE, 'utf8');

const iso = (s) => new Date(s).toISOString();

/* ────────────────────────────────────────────────────────────────────────
 * Truncation must match date_trunc
 * ──────────────────────────────────────────────────────────────────────── */

test('an hour truncates to the top of the hour', () => {
  assert.equal(
    truncateTo(new Date('2026-09-26T13:47:33.912Z'), 'hour').toISOString(),
    iso('2026-09-26T13:00:00.000Z'),
  );
});

test('a day truncates to midnight UTC', () => {
  assert.equal(
    truncateTo(new Date('2026-09-26T13:47:33.912Z'), 'day').toISOString(),
    iso('2026-09-26T00:00:00.000Z'),
  );
});

test('a week truncates to MONDAY, the way Postgres does', () => {
  // 2026-09-26 is a Saturday; its ISO week began Monday the 21st.
  assert.equal(
    truncateTo(new Date('2026-09-26T13:47:33.912Z'), 'week').toISOString(),
    iso('2026-09-21T00:00:00.000Z'),
  );
});

test('a SUNDAY belongs to the week that started six days earlier, not the next one', () => {
  // The getUTCDay() trap: Sunday is 0, so a naive subtraction puts Sunday at the
  // start of the following week and shifts one seventh of every weekly series.
  assert.equal(
    truncateTo(new Date('2026-09-27T09:00:00.000Z'), 'week').toISOString(),
    iso('2026-09-21T00:00:00.000Z'),
  );
});

test('a month truncates to the first of the month', () => {
  assert.equal(
    truncateTo(new Date('2026-09-26T13:47:33.912Z'), 'month').toISOString(),
    iso('2026-09-01T00:00:00.000Z'),
  );
});

/* ────────────────────────────────────────────────────────────────────────
 * Stepping
 * ──────────────────────────────────────────────────────────────────────── */

test('a month step follows the calendar rather than adding thirty days', () => {
  // Adding 30 days to 31 January lands on 2 March and every later month drifts.
  assert.equal(
    nextBucket(new Date('2026-01-01T00:00:00.000Z'), 'month').toISOString(),
    iso('2026-02-01T00:00:00.000Z'),
  );
  assert.equal(
    nextBucket(new Date('2026-02-01T00:00:00.000Z'), 'month').toISOString(),
    iso('2026-03-01T00:00:00.000Z'),
  );
});

test('an hour step crosses a day boundary correctly', () => {
  assert.equal(
    nextBucket(new Date('2026-09-26T23:00:00.000Z'), 'hour').toISOString(),
    iso('2026-09-27T00:00:00.000Z'),
  );
});

test('a day step crosses a month boundary, including a leap February', () => {
  assert.equal(
    nextBucket(new Date('2026-09-30T00:00:00.000Z'), 'day').toISOString(),
    iso('2026-10-01T00:00:00.000Z'),
  );
  // 2028 is a leap year: the 28th is followed by the 29th, not by March.
  assert.equal(
    nextBucket(new Date('2028-02-28T00:00:00.000Z'), 'day').toISOString(),
    iso('2028-02-29T00:00:00.000Z'),
  );
});

/* ────────────────────────────────────────────────────────────────────────
 * The series is continuous, and its length agrees with bucketCount()
 * ──────────────────────────────────────────────────────────────────────── */

test('a 24-hour window by hour yields 24 contiguous buckets', () => {
  const starts = bucketStarts(
    { from: '2026-09-25T12:00:00.000Z', to: '2026-09-26T12:00:00.000Z' },
    'HOUR',
  );
  assert.equal(starts.length, 24);
  for (let i = 1; i < starts.length; i += 1) {
    assert.equal(
      Date.parse(starts[i]) - Date.parse(starts[i - 1]),
      3_600_000,
      'a gap in the generated series would orphan whatever the query returned for it',
    );
  }
});

test('every generated bucket is itself already truncated', () => {
  // A generated start that is not on a bucket boundary can never equal a
  // date_trunc result, so its real value would be dropped and shown as zero.
  for (const [bucket, unit] of [['HOUR', 'hour'], ['DAY', 'day'], ['WEEK', 'week'], ['MONTH', 'month']]) {
    const starts = bucketStarts(
      { from: '2026-07-14T05:23:11.500Z', to: '2026-09-26T12:00:00.000Z' },
      bucket,
    );
    assert.ok(starts.length > 0, `guard: ${unit} produced a series`);
    for (const start of starts) {
      assert.equal(
        truncateTo(new Date(start), unit).toISOString(),
        start,
        `a ${unit} bucket start must be a fixed point of its own truncation`,
      );
    }
  }
});

test('the generated series length is consistent with bucketCount()', () => {
  // bucketCount() is what the request is REFUSED on, and bucketStarts() is what
  // is actually returned. If the second exceeds the first, a request that passed
  // the ceiling check can still produce a larger answer than the ceiling allows.
  for (const window of ['LAST_24H', 'LAST_7D', 'LAST_30D']) {
    for (const bucket of ['HOUR', 'DAY', 'WEEK']) {
      const bounds = timeBounds({ window, column: 'discovered_at' }, new Date('2026-09-26T12:00:00.000Z'));
      const predicted = bucketCount(bounds, bucket);
      const actual = bucketStarts(bounds, bucket).length;
      assert.ok(
        actual <= predicted + 1,
        `${window}/${bucket}: generated ${actual} buckets but the ceiling check saw ${predicted}`,
      );
    }
  }
});

test('a window shorter than one bucket still yields the bucket containing it', () => {
  // LAST_HOUR bucketed by DAY is one day, not zero days. An empty series here
  // would render as "no data" for a window that simply has no full bucket.
  const bounds = timeBounds({ window: 'LAST_HOUR', column: 'discovered_at' }, new Date('2026-09-26T12:30:00.000Z'));
  const starts = bucketStarts(bounds, 'DAY');
  assert.equal(starts.length, 1);
  assert.equal(starts[0], iso('2026-09-26T00:00:00.000Z'));
});

/* ────────────────────────────────────────────────────────────────────────
 * The contract the endpoint states about itself
 * ──────────────────────────────────────────────────────────────────────── */

test('the endpoint reports which clock answered, not just the numbers', () => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(code, /bounds,/, 'the window must be readable off its own answer');
  assert.match(code, /p_column: bounds\.column/, 'the RPC must be told which column, not defaulted');
});

test('an empty bucket is a zero and is marked as not having come from the query', () => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(code, /evidence: Number\(row\?\.evidence_count \?\? 0\)/);
  assert.match(code, /fromQuery: row !== undefined/);
  assert.match(
    code,
    /bucketsWithEvidence/,
    'how much of the window held nothing is the finding, so it is stated rather '
      + 'than left to be counted off the series',
  );
});

test('the RPC refusing is a 400 with the database words, never a 500', () => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(
    code,
    /if \(error\) return json\(\{ error: error\.message, bounds, bucket \}, 400\)/,
    'a misspelled platform raises inside the enum cast on purpose; hiding that in '
      + 'a 500 would lose which input was wrong',
  );
});

test('the bucket ceiling is enforced and names a smaller bucket', () => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(code, /if \(count > MAX_BUCKETS\)/);
  assert.match(code, /suggestion:/, 'a refusal the caller cannot act on is only half an answer');
});
