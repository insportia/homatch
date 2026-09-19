import { test } from 'node:test';
import assert from 'node:assert/strict';

import { neighboursFor } from '../historyNeighbours.ts';

/*
 * MOVING BETWEEN STORED REPORTS.
 *
 * The arrows are only as good as their boundaries: an off-by-one here shows
 * a customer somebody else's neighbour, or offers a button that goes nowhere.
 * listVerifyHistory returns newest first, so index 0 is the newest run and
 * the last index is the oldest.
 */

const HISTORY = [
  { id: 'c', created_at: '2026-09-19T12:00:00Z' }, // newest
  { id: 'b', created_at: '2026-09-18T12:00:00Z' },
  { id: 'a', created_at: '2026-09-17T12:00:00Z' }, // oldest
];

test('the middle report has a report on each side', () => {
  const n = neighboursFor(HISTORY, 'b');
  assert.equal(n?.newer?.id, 'c', 'newer is the row above, because the list is newest first');
  assert.equal(n?.older?.id, 'a');
});

test('the newest report offers no newer, and the oldest offers no older', () => {
  const newest = neighboursFor(HISTORY, 'c');
  assert.equal(newest?.newer, null, 'nothing is newer than the newest run');
  assert.equal(newest?.older?.id, 'b');

  const oldest = neighboursFor(HISTORY, 'a');
  assert.equal(oldest?.newer?.id, 'b');
  assert.equal(oldest?.older, null, 'nothing is older than the first run');
});

test('a single report produces no navigation at all', () => {
  // Two dead arrows are worse than none: they invite a tap that does nothing.
  assert.equal(neighboursFor([{ id: 'only' }], 'only'), null);
  assert.equal(neighboursFor([], 'only'), null);
});

test('a report that is not in the history has no neighbours', () => {
  // An anonymous run, one still being written, or one since deleted.
  assert.equal(neighboursFor(HISTORY, 'not-in-history'), null);
  assert.equal(neighboursFor(HISTORY, null), null);
  assert.equal(neighboursFor(HISTORY, undefined), null);
  assert.equal(neighboursFor(HISTORY, ''), null);
});

test('the order is the history’s own and is never re-derived', () => {
  /*
   * Deliberately given rows whose ids sort the opposite way to their
   * position. Anything that quietly sorted by id — or by date, or by
   * anything else — would disagree with the list the customer is looking at,
   * and the arrows would then walk a different sequence from the one on
   * screen.
   */
  const scrambled = [{ id: 'a' }, { id: 'c' }, { id: 'b' }];
  const n = neighboursFor(scrambled, 'c');
  assert.equal(n?.newer?.id, 'a');
  assert.equal(n?.older?.id, 'b');
});

test('walking the whole history reaches every report exactly once', () => {
  // Start at the newest and follow `older` to the end.
  const seen = [];
  let current = HISTORY[0].id;
  for (let guard = 0; guard < 10 && current; guard += 1) {
    seen.push(current);
    const next = neighboursFor(HISTORY, current)?.older ?? null;
    current = next ? next.id : '';
  }
  assert.deepEqual(seen, ['c', 'b', 'a'], 'the walk must terminate and cover the history');
});
