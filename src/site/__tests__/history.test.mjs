import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMIT, canRedo, canUndo, emptyHistory, historyIntent, record, redo, undo,
} from '../history.ts';

/*
 * UNDO AND REDO.
 *
 * The property that matters is that undo returns you to a page that actually
 * existed. Snapshots give that for free; an operation log would have to
 * invert a duplicate, a reorder and a locale-scoped text edit correctly, and
 * getting any one of those wrong loses an editor's work silently.
 *
 * These run on plain objects, so they say nothing about React and everything
 * about the rule.
 */

const page = (n) => ({ title: `page ${n}` });

test('a fresh history can do nothing', () => {
  const h = emptyHistory();
  assert.equal(canUndo(h), false);
  assert.equal(canRedo(h), false);
  assert.equal(undo(h, page(1)), null, 'undo with no past must not invent a state');
  assert.equal(redo(h, page(1)), null);
});

test('undo returns the exact page that was left behind', () => {
  const a = page('a');
  const b = page('b');
  const h = record(emptyHistory(), a);
  const stepped = undo(h, b);
  assert.deepEqual(stepped.present, a);
  assert.equal(stepped.present, a, 'the same object, not a copy that merely matches');
});

test('redo returns the page undo stepped away from', () => {
  const a = page('a');
  const b = page('b');
  const back = undo(record(emptyHistory(), a), b);
  const forward = redo(back.history, back.present);
  assert.deepEqual(forward.present, b);
  assert.equal(canRedo(forward.history), false, 'nothing left to redo');
});

test('three edits undo in the order they were made', () => {
  const pages = [page(0), page(1), page(2), page(3)];
  let h = emptyHistory();
  for (let i = 0; i < 3; i += 1) h = record(h, pages[i]);

  let present = pages[3];
  for (let i = 2; i >= 0; i -= 1) {
    const step = undo(h, present);
    assert.deepEqual(step.present, pages[i], `step back ${i}`);
    present = step.present;
    h = step.history;
  }
  assert.equal(canUndo(h), false);
});

test('editing after an undo abandons the futures that no longer follow', () => {
  // Undo twice, then type. The two states you stepped away from are not
  // reachable from where you now are, and a redo must not jump to them.
  const [a, b, c] = [page('a'), page('b'), page('c')];
  let h = record(record(emptyHistory(), a), b);
  const back = undo(h, c);
  assert.equal(canRedo(back.history), true);

  const afterEdit = record(back.history, back.present);
  assert.equal(canRedo(afterEdit), false, 'a new edit must clear the redo stack');
});

test('history is bounded, and it is the OLDEST steps that go', () => {
  let h = emptyHistory();
  for (let i = 0; i < LIMIT + 25; i += 1) h = record(h, page(i));
  assert.equal(h.past.length, LIMIT);
  // The most recent step is still the one immediately behind you.
  assert.deepEqual(h.past[h.past.length - 1], page(LIMIT + 24));
  // The oldest survivor is LIMIT steps back, not step 0.
  assert.deepEqual(h.past[0], page(25));
});

test('neither operation mutates the history it was given', () => {
  const h = record(emptyHistory(), page('a'));
  const before = JSON.stringify(h);
  undo(h, page('b'));
  record(h, page('c'));
  assert.equal(JSON.stringify(h), before, 'history must be treated as immutable');
});

test('the keyboard mapping covers both conventions', () => {
  const k = (key, opts = {}) => ({
    key, ctrlKey: false, metaKey: false, shiftKey: false, ...opts,
  });
  assert.equal(historyIntent(k('z', { ctrlKey: true })), 'undo');
  assert.equal(historyIntent(k('z', { metaKey: true })), 'undo', 'macOS');
  assert.equal(historyIntent(k('Z', { ctrlKey: true, shiftKey: true })), 'redo');
  // Ctrl+Y is what Windows editors use; somebody who knows one spelling
  // should not have to learn the other.
  assert.equal(historyIntent(k('y', { ctrlKey: true })), 'redo');
  // A bare keystroke is typing, not a command.
  assert.equal(historyIntent(k('z')), null);
  assert.equal(historyIntent(k('a', { ctrlKey: true })), null, 'select-all is not history');
});
