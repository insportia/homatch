// TWO VOCABULARIES THAT LOOK LIKE ONE, AND THE WRITE THAT CONFLATED THEM.
//
// raw_signals.validation_state stores a ValidationState — did we re-read this?
//
//   UNVERIFIED  VALID  INVALID  REMOVED  UNVERIFIABLE
//
// judgeDelivery() returns a DeliveryVerdict — may a customer see this?
//
//   FRESH  NEW_UNVERIFIED  NEEDS_REVALIDATION  INVALID  REMOVED  UNVERIFIABLE
//
// They overlap on three words and disagree on the rest, so 'FRESH' reads as a
// perfectly sensible thing to store and is rejected by
// raw_signals_validation_state_check. community-sync wrote exactly that, and
// because the insert error was discarded the run reported:
//
//   messagesParsed: 18, classificationsRun: 18, persistenceWrites: 0
//
// which is indistinguishable from a flawlessly deduplicated sync. Eighteen real
// Telegram posts were read, classified, rejected by the database, and the cursor
// advanced past them as though they had been kept.
//
// These tests pin the three things that had to be true and were not: the right
// vocabulary reaches the column, a first sighting claims no verification, and a
// refused write is never counted as a no-op.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FUNCTIONS = join(root, 'supabase', 'functions');

/** The states raw_signals_validation_state_check actually permits. */
const VALIDATION_STATES = ['UNVERIFIED', 'VALID', 'INVALID', 'REMOVED', 'UNVERIFIABLE'];

/** Verdicts that are NOT validation states. Storing one is a rejected row. */
const DELIVERY_ONLY = ['FRESH', 'NEW_UNVERIFIED', 'NEEDS_REVALIDATION'];

/** Every edge function that writes a validation_state. */
function functionsWriting(column) {
  const out = [];
  for (const slug of readdirSync(FUNCTIONS, { withFileTypes: true })) {
    if (!slug.isDirectory()) continue;
    const file = join(FUNCTIONS, slug.name, 'index.ts');
    let source;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (source.includes(`${column}:`)) out.push({ slug: slug.name, source });
  }
  return out;
}

test('no edge function stores a DeliveryVerdict in validation_state', () => {
  const writers = functionsWriting('validation_state');
  assert.ok(writers.length > 0, 'guard: something must write this column');

  const offences = [];
  for (const { slug, source } of writers) {
    // Every literal assigned to validation_state, however it is spaced.
    for (const match of source.matchAll(/validation_state:\s*'([A-Z_]+)'/g)) {
      const value = match[1];
      if (DELIVERY_ONLY.includes(value)) {
        offences.push(`${slug} writes validation_state: '${value}' (a DeliveryVerdict)`);
      } else if (!VALIDATION_STATES.includes(value)) {
        offences.push(`${slug} writes validation_state: '${value}' (not a ValidationState)`);
      }
    }
  }

  assert.deepEqual(
    offences,
    [],
    'raw_signals_validation_state_check rejects the row, and a swallowed error makes '
      + 'that look like a clean sync:\n' + offences.join('\n'),
  );
});

test('community-sync states validation on each path, not once in a shared row', () => {
  const source = readFileSync(join(FUNCTIONS, 'community-sync', 'index.ts'), 'utf8');

  // An INSERT is a first sighting: UNVERIFIED and nothing verified.
  assert.match(
    source,
    /validation_state:\s*'UNVERIFIED'/,
    'a first sighting has verified nothing, which is what firstSighting() says and '
      + 'raw_signals_verification_coherence_check enforces',
  );
  assert.match(
    source,
    /last_verified_at:\s*null/,
    'UNVERIFIED with a last_verified_at violates the coherence check outright',
  );
  // A re-read really did verify something.
  assert.match(source, /validation_state:\s*'VALID'/);
});

test('community-sync never discards a write error', () => {
  const source = readFileSync(join(FUNCTIONS, 'community-sync', 'index.ts'), 'utf8');

  // The original shape: success counted inside `if (!error)`, with no else.
  // Every write must instead branch on the error and record it.
  for (const name of ['insertError', 'updateError', 'touchError']) {
    assert.match(
      source,
      new RegExp(`if\\s*\\(${name}\\)`),
      `${name} must be handled on the failure branch, not skipped by if (!${name})`,
    );
  }

  assert.match(
    source,
    /persistenceFailures/,
    'a refused write must be counted, or "nothing to write" and "nothing could be '
      + 'written" report identically',
  );
  assert.match(
    source,
    /writeFailures\.push/,
    'the constraint name in the error message is the whole diagnosis',
  );
});

test('community-sync does not advance the cursor over evidence it failed to store', () => {
  const source = readFileSync(join(FUNCTIONS, 'community-sync', 'index.ts'), 'utf8');

  assert.match(
    source,
    /const persisted = writeFailures\.length === 0;/,
    'whether the cursor may move has to be a stated condition',
  );

  // The cursor write must sit behind that condition. Anchoring on the guard
  // rather than on exact formatting: the point is that `persisted` gates it.
  const cursorWrite = source.indexOf('cursor: newestSeen !== null');
  const guard = source.indexOf('...(persisted');
  assert.ok(cursorWrite > 0, 'guard: the cursor is still written');
  assert.ok(
    guard > 0 && guard < cursorWrite,
    'advancing the cursor past a rejected message skips it permanently and silently',
  );
});

test('a persistence failure is visible in the outcome, not only in a counter', () => {
  const source = readFileSync(join(FUNCTIONS, 'community-sync', 'index.ts'), 'utf8');
  assert.match(
    source,
    /outcome: persisted \? 'OK' : 'PERSISTENCE_REFUSED'/,
    'an operator scanning a list of OK results must not have to cross-check a counter '
      + 'to find out the sync kept nothing',
  );
});

/* ────────────────────────────────────────────────────────────────────────
 * THE FOURTH TRANSITION, WHICH NOTHING PERFORMED
 *
 * planObservation() has always been able to return MARK_UNAVAILABLE, and until now
 * nothing consumed it. Nothing in the repository wrote became_unavailable_at at
 * all -- community-sync only ever READ it -- so every report of "no longer there"
 * was a structural zero presented as a measurement, including the one on the new
 * Admin intelligence panel.
 *
 * And the loop's branches were TOUCH, INSERT, then `else`. A MARK_UNAVAILABLE
 * reaching it would have been written as a VERSION: a row that is GONE overwritten
 * with a fresh copy of text we no longer have.
 * ──────────────────────────────────────────────────────────────────────── */

/** community-sync with comments stripped, so no assertion can match prose. */
function syncCode() {
  const source = readFileSync(join(FUNCTIONS, 'community-sync', 'index.ts'), 'utf8');
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('MARK_UNAVAILABLE is handled explicitly, never by falling through to VERSION', () => {
  const code = syncCode();
  const branch = code.indexOf("plan.action === 'MARK_UNAVAILABLE'");
  const version = code.indexOf('content_changed_at: now');

  assert.ok(branch > 0, 'the fourth transition must have a branch of its own');
  assert.ok(version > 0, 'guard: the VERSION path is still here');
  assert.ok(
    branch < version,
    'it has to be decided BEFORE the VERSION path, or the fallthrough is still there',
  );
  assert.match(code, /became_unavailable_at: plan\.becameUnavailableAt/);
});

test('a removed row is REMOVED, and its verification time is not advanced', () => {
  const code = syncCode();
  // Sliced to the absence block on purpose: the TOUCH path legitimately advances
  // last_verified_at, so a whole-file assertion would pass for the wrong reason.
  const start = code.indexOf('if (collected.length >= 2)');
  assert.ok(start > 0, 'guard: the absence block is present');
  const block = code.slice(start, code.indexOf('const persisted =', start));
  assert.ok(block.length > 0, 'guard: the block was actually located');

  assert.match(block, /validation_state: 'REMOVED'/);
  assert.match(block, /last_revalidation_outcome: 'REMOVED'/);
  assert.doesNotMatch(
    block,
    /last_verified_at/,
    'confirming something is GONE is not a verification of the evidence; advancing it '
      + 'would make a deleted post the freshest thing in the store',
  );
});

test('absence is only inferred inside the id range actually read', () => {
  const code = syncCode();
  const start = code.indexOf('if (collected.length >= 2)');
  const block = code.slice(start, code.indexOf('const persisted =', start));

  // Telegram's preview serves a WINDOW. A stored message missing from today's page
  // is usually older than the window, not deleted -- and marking those unavailable
  // would wipe good evidence on the first sync of any channel with history.
  assert.match(block, /Math\.min\(/, 'the low end of the covered interval');
  assert.match(block, /Math\.max\(/, 'the high end');
  assert.match(
    block,
    /numeric < lowest \|\| numeric > highest/,
    'anything outside the interval must be skipped rather than judged',
  );
  assert.match(
    code,
    /if \(collected\.length >= 2\)/,
    'one message establishes no interval: min === max would let a post be inferred '
      + 'absent from its own presence',
  );
});

test('the count is reported, so a zero can be told from a dead metric', () => {
  const source = readFileSync(join(FUNCTIONS, 'community-sync', 'index.ts'), 'utf8');
  assert.match(source, /markedUnavailable: 0,/, 'initialised in totals');
  assert.match(source, /totals\.markedUnavailable \+= 1/, 'incremented on a real write');
  assert.match(source, /markedUnavailable: totals\.markedUnavailable/, 'and returned');
});
