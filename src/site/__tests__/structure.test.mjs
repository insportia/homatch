import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  duplicateSection, editLocale, emptyPage, insertSectionAfter, makeSection,
  moveSection, readLocalized, setSectionEnabled,
} from '../model.ts';

/*
 * SITE STUDIO — building the page: add, copy, reorder, hide, remove.
 *
 * These are the operations behind the controls that float on the selected
 * section. They are pure functions over the page object on purpose: the
 * question "did duplicating a block quietly make two blocks share one set of
 * words" is answerable without a browser, a database or a click.
 *
 * The failure this file exists to prevent is the shallow copy. A section's
 * content is a nested object of localized strings, so `{...section}` produces
 * a second section pointing at the FIRST one's text. Editing either would
 * change both, in all six languages, with nothing on screen to explain it —
 * and the admin would only find out after publishing.
 */

/** A page with three sections, the middle one carrying real content. */
function page() {
  let p = { ...emptyPage(), sections: [
    makeSection('hero', 'hero-1'),
    makeSection('rich_text', 'text-1'),
    makeSection('action_launcher', 'launch-1'),
  ] };
  p = {
    ...p,
    sections: p.sections.map(s => (s.id === 'text-1'
      ? editLocale(editLocale(s, 'body', 'en', 'Original English'), 'body', 'ka', 'ორიგინალი')
      : s)),
  };
  return p;
}

const ids = p => p.sections.map(s => s.id);

test('insert puts the new section directly below the named one', () => {
  const next = insertSectionAfter(page(), 'rich_text', 'new-1', 'hero-1');
  assert.deepEqual(ids(next), ['hero-1', 'new-1', 'text-1', 'launch-1']);
});

test('insert at the last section appends', () => {
  const next = insertSectionAfter(page(), 'rich_text', 'new-1', 'launch-1');
  assert.deepEqual(ids(next), ['hero-1', 'text-1', 'launch-1', 'new-1']);
});

test('insert with an unknown or absent anchor appends rather than losing the section', () => {
  // A control can be clicked with an id that has just been deleted elsewhere.
  // Dropping the new block would read as the button being broken.
  for (const anchor of ['gone-9', undefined]) {
    const next = insertSectionAfter(page(), 'rich_text', 'new-1', anchor);
    assert.deepEqual(ids(next), ['hero-1', 'text-1', 'launch-1', 'new-1']);
  }
});

test('insert leaves the original page object untouched', () => {
  const before = page();
  insertSectionAfter(before, 'rich_text', 'new-1', 'hero-1');
  assert.deepEqual(ids(before), ['hero-1', 'text-1', 'launch-1']);
});

test('duplicate places the copy directly below its original', () => {
  const next = duplicateSection(page(), 'text-1', 'text-2');
  assert.deepEqual(ids(next), ['hero-1', 'text-1', 'text-2', 'launch-1']);
});

test('the copy carries the original words, in every language', () => {
  const next = duplicateSection(page(), 'text-1', 'text-2');
  const copy = next.sections.find(s => s.id === 'text-2');
  assert.equal(readLocalized(copy.content.body, 'en'), 'Original English');
  assert.equal(readLocalized(copy.content.body, 'ka'), 'ორიგინალი');
});

test('editing a copy does not edit the original — the clone is deep', () => {
  // Note this does NOT catch a shallow copy on its own: editLocale returns
  // a new section rather than mutating, so editing through it cannot reach
  // the original even when the two share a content object. What it proves
  // is the behaviour an admin sees. The test below is the one that catches
  // the shared reference itself — verified by making the clone shallow and
  // watching exactly that test, and only that test, fail.
  const next = duplicateSection(page(), 'text-1', 'text-2');
  const edited = {
    ...next,
    sections: next.sections.map(s => (s.id === 'text-2'
      ? editLocale(s, 'body', 'en', 'Changed on the copy')
      : s)),
  };

  const original = edited.sections.find(s => s.id === 'text-1');
  const copy = edited.sections.find(s => s.id === 'text-2');
  assert.equal(readLocalized(copy.content.body, 'en'), 'Changed on the copy');
  assert.equal(readLocalized(original.content.body, 'en'), 'Original English');
  // And the untouched language of the original is still its own.
  assert.equal(readLocalized(original.content.body, 'ka'), 'ორიგინალი');
});

test('the copy is a separate object graph, not shared references', () => {
  const next = duplicateSection(page(), 'text-1', 'text-2');
  const original = next.sections.find(s => s.id === 'text-1');
  const copy = next.sections.find(s => s.id === 'text-2');
  assert.notEqual(original.content, copy.content, 'content object is shared');
  assert.notEqual(original.content.body, copy.content.body, 'localized text object is shared');
  assert.notEqual(original.id, copy.id, 'two sections cannot carry one id');
});

test('duplicating an unknown id changes nothing', () => {
  const before = page();
  assert.deepEqual(ids(duplicateSection(before, 'gone-9', 'new-1')), ids(before));
});

test('duplicate leaves the original page object untouched', () => {
  const before = page();
  duplicateSection(before, 'text-1', 'text-2');
  assert.deepEqual(ids(before), ['hero-1', 'text-1', 'launch-1']);
});

test('reordering and hiding still compose with the new operations', () => {
  // The controls sit on one toolbar, so they get used one after another.
  let p = insertSectionAfter(page(), 'rich_text', 'new-1', 'hero-1');
  p = duplicateSection(p, 'new-1', 'new-2');
  p = moveSection(p, 'new-2', -1);
  p = setSectionEnabled(p, 'new-2', false);

  assert.deepEqual(ids(p), ['hero-1', 'new-2', 'new-1', 'text-1', 'launch-1']);
  assert.equal(p.sections.find(s => s.id === 'new-2').enabled, false);
  assert.equal(p.sections.find(s => s.id === 'new-1').enabled, true);
});

test('moving past either end is a no-op, not a lost section', () => {
  const p = page();
  assert.deepEqual(ids(moveSection(p, 'hero-1', -1)), ids(p));
  assert.deepEqual(ids(moveSection(p, 'launch-1', 1)), ids(p));
});
