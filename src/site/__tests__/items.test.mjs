import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addItem, applyAutoTranslation, duplicateItem, editItemField, editLocale,
  emptyPage, localeState, makeItem, makeSection, markReviewed, moveItem,
  normalizeItem, normalizeSection, onItem, readLocalized, removeItem,
  setItemIcon, suggestionFor, translationTargets,
} from '../model.ts';

/*
 * REPEATED CHILDREN — cards, steps, questions.
 *
 * The reason these carry their own id is the reason inline editing works at
 * all: an edit addresses "the body of card-3", which stays true when the card
 * is reordered, duplicated, or edited to say something else. Addressing it by
 * position, or by the text it currently holds, does not.
 *
 * normalizeItem is a gate between a database row and the public site, so its
 * refusals matter as much as its acceptances.
 */

const RULES = {
  knownTypes: ['feature_cards'],
  variantsFor: () => ['default'],
  knownRoutes: ['/', '/verify'],
};

const withItems = (n) => {
  let s = makeSection('feature_cards', 'cards-1');
  for (let i = 0; i < n; i += 1) s = addItem(s, `card-${i}`);
  return s;
};

test('a new section starts with no children and no icons', () => {
  const s = makeSection('feature_cards', 'cards-1');
  assert.deepEqual(s.items, []);
  assert.deepEqual(s.icons, {});
});

test('children are added in order, and after a named sibling', () => {
  let s = addItem(addItem(makeSection('feature_cards', 'c'), 'a'), 'b');
  assert.deepEqual(s.items.map(i => i.id), ['a', 'b']);
  s = addItem(s, 'middle', 'a');
  assert.deepEqual(s.items.map(i => i.id), ['a', 'middle', 'b']);
});

test('adding after an unknown sibling appends rather than losing the child', () => {
  // A control can be pressed with an id that has just been removed elsewhere.
  const s = addItem(withItems(2), 'new', 'gone-9');
  assert.deepEqual(s.items.map(i => i.id), ['card-0', 'card-1', 'new']);
});

test('moving past either end does nothing, and never wraps', () => {
  const s = withItems(3);
  // "Up" on the first card means nothing. It must not mean "send to bottom".
  assert.deepEqual(moveItem(s, 'card-0', -1).items.map(i => i.id), ['card-0', 'card-1', 'card-2']);
  assert.deepEqual(moveItem(s, 'card-2', 1).items.map(i => i.id), ['card-0', 'card-1', 'card-2']);
  assert.deepEqual(moveItem(s, 'card-1', -1).items.map(i => i.id), ['card-1', 'card-0', 'card-2']);
});

test('an edit reaches one child, in one locale, and nothing else', () => {
  let s = withItems(3);
  s = editItemField(s, 'card-1', 'title', 'en', 'Only this one');
  s = editItemField(s, 'card-1', 'title', 'ka', 'მხოლოდ ეს');

  assert.equal(readLocalized(s.items[1].content.title, 'en'), 'Only this one');
  assert.equal(readLocalized(s.items[1].content.title, 'ka'), 'მხოლოდ ეს');
  assert.equal(s.items[0].content.title, undefined, 'the sibling above is untouched');
  assert.equal(s.items[2].content.title, undefined, 'the sibling below is untouched');
});

test('editing one locale of a child leaves its other locales alone', () => {
  let s = editItemField(withItems(1), 'card-0', 'title', 'en', 'English');
  s = editItemField(s, 'card-0', 'title', 'ru', 'Русский');
  s = editItemField(s, 'card-0', 'title', 'en', 'English again');

  assert.equal(readLocalized(s.items[0].content.title, 'ru'), 'Русский');
  assert.equal(readLocalized(s.items[0].content.title, 'en'), 'English again');
});

test('a duplicated child does not share its words with the original', () => {
  // The failure a shallow copy produces: two cards, one set of strings, in
  // six languages, with nothing on screen to explain why both changed.
  let s = editItemField(withItems(2), 'card-0', 'title', 'en', 'Original');
  s = duplicateItem(s, 'card-0', 'card-copy');
  assert.deepEqual(s.items.map(i => i.id), ['card-0', 'card-copy', 'card-1']);

  s = editItemField(s, 'card-copy', 'title', 'en', 'Changed on the copy');
  assert.equal(readLocalized(s.items[0].content.title, 'en'), 'Original');
  assert.notEqual(s.items[0].content, s.items[1].content, 'content object is shared');
});

test('removing a child leaves the rest in order; an unknown id is a no-op', () => {
  const s = withItems(3);
  assert.deepEqual(removeItem(s, 'card-1').items.map(i => i.id), ['card-0', 'card-2']);
  assert.equal(removeItem(s, 'nope'), s, 'an unknown id must not rebuild the section');
});

test('none of the operations mutate the section they were given', () => {
  const s = withItems(3);
  const before = JSON.stringify(s);
  moveItem(s, 'card-0', 1);
  addItem(s, 'x');
  removeItem(s, 'card-0');
  duplicateItem(s, 'card-0', 'y');
  editItemField(s, 'card-0', 'title', 'en', 'z');
  assert.equal(JSON.stringify(s), before);
});

test('a stored child is cleaned, and a malformed one is dropped', () => {
  assert.equal(normalizeItem(null), null);
  assert.equal(normalizeItem('a string'), null);
  assert.equal(normalizeItem(42), null);

  const item = normalizeItem({ id: 'c1', content: { title: { en: 'Hi' } } });
  assert.equal(item.id, 'c1');
  assert.equal(readLocalized(item.content.title, 'en'), 'Hi');
  // An item with no id still renders — it is given one rather than dropped.
  assert.match(normalizeItem({}).id, /^item-/);
});

test('an icon slot holds a NAME, never markup', () => {
  // The whole safety argument for letting an admin change an icon: the slot
  // cannot carry an <svg onload=...> because it does not carry markup.
  const item = normalizeItem({
    id: 'c1',
    icons: {
      good: 'ShieldCheck',
      markup: '<svg onload=alert(1)>',
      spaces: 'has spaces',
      long: 'x'.repeat(200),
      wrongType: 42,
    },
  });
  assert.equal(item.icons.good, 'ShieldCheck');
  assert.equal(item.icons.markup, undefined, 'markup must never survive');
  assert.equal(item.icons.spaces, undefined);
  assert.equal(item.icons.long, undefined);
  assert.equal(item.icons.wrongType, undefined);
});

test('a child cannot smuggle a dangerous image URL', () => {
  const item = normalizeItem({
    id: 'c1',
    media: {
      ok: { url: 'https://cdn.example.com/a.png' },
      js: { url: 'javascript:alert(1)' },
      data: { url: 'data:text/html,<script>alert(1)</script>' },
    },
  });
  assert.equal(item.media.ok.url, 'https://cdn.example.com/a.png');
  assert.equal(item.media.js, undefined);
  assert.equal(item.media.data, undefined);
});

test('a section normalises its children, and drops the broken ones', () => {
  const section = normalizeSection({
    type: 'feature_cards',
    id: 'cards-1',
    items: [{ id: 'a', content: { title: { en: 'A' } } }, null, 'nonsense', { id: 'b' }],
  }, RULES);

  assert.deepEqual(section.items.map(i => i.id), ['a', 'b']);
  assert.deepEqual(section.icons, {});
});

test('a section with no items field still normalises to an empty list', () => {
  // Every page stored before items existed must keep working.
  const section = normalizeSection({ type: 'feature_cards', id: 'cards-1' }, RULES);
  assert.deepEqual(section.items, []);
  assert.deepEqual(section.icons, {});
});

/*
 * A CARD TRANSLATES BY THE SAME RULES AS THE HEADING ABOVE IT.
 *
 * These are not new rules; they are the section's rules, reached through a
 * child. What is being tested is that the child is genuinely running them and
 * not a second, simpler implementation that happens to look similar.
 */

test('editing a card in one language flags its other languages', () => {
  let s = editItemField(withItems(1), 'card-0', 'title', 'en', 'Verified title');
  s = editItemField(s, 'card-0', 'title', 'ka', 'დადასტურებული');
  // Now revise the English. The Georgian text stays on the page; only its
  // label changes, which is the whole point of flagging rather than clearing.
  s = editItemField(s, 'card-0', 'title', 'en', 'Verified title, revised');

  assert.equal(readLocalized(s.items[0].content.title, 'ka'), 'დადასტურებული');
  assert.equal(localeState(s.items[0], 'title', 'ka'), 'needs_update');
  assert.equal(localeState(s.items[0], 'title', 'en'), 'reviewed');
});

test('auto-translation will not overwrite a card a person approved', () => {
  // The guarantee the whole translation feature rests on, checked at the level
  // people are most likely to assume it was skipped.
  let s = editItemField(withItems(1), 'card-0', 'title', 'en', 'Source');
  s = onItem(s, 'card-0', i => markReviewed(i, 'title', 'ru'));
  s = editItemField(s, 'card-0', 'title', 'ru', 'Человек написал это');
  s = onItem(s, 'card-0', i => applyAutoTranslation(i, 'title', 'ru', 'Машина написала это'));

  assert.equal(readLocalized(s.items[0].content.title, 'ru'), 'Человек написал это');
  assert.equal(suggestionFor(s.items[0], 'title', 'ru'), 'Машина написала это');
});

test('a translate run finds the cards, not only the heading', () => {
  let page = emptyPage();
  let section = addItem(addItem(makeSection('feature_cards', 'cards-1'), 'a'), 'b');
  section = editLocale(section, 'title', 'en', 'Our features');
  section = editItemField(section, 'a', 'body', 'en', 'The first one');
  section = editItemField(section, 'b', 'body', 'en', 'The second one');
  page = { ...page, sections: [section] };

  const targets = translationTargets(page, { sourceLocale: 'en', includeMissing: true });
  const fromCards = targets.filter(t => t.itemId !== undefined);

  assert.ok(fromCards.length > 0, 'the cards were invisible to the translator');
  assert.deepEqual([...new Set(fromCards.map(t => t.itemId))].sort(), ['a', 'b']);
  // Five other languages per card, and the target says which card it is for.
  assert.equal(fromCards.filter(t => t.itemId === 'a').length, 5);
});

test('a duplicated card does not inherit the original approvals', () => {
  // structuredClone copies i18n too, which is correct: the copy really does
  // hold the same reviewed words. What must NOT happen is the two sharing one
  // state object, so approving on one silently approves the other.
  let s = editItemField(withItems(1), 'card-0', 'title', 'en', 'Original');
  s = duplicateItem(s, 'card-0', 'copy');
  s = onItem(s, 'copy', i => markReviewed(i, 'title', 'tr'));

  assert.equal(localeState(s.items[1], 'title', 'tr'), 'reviewed');
  assert.equal(localeState(s.items[0], 'title', 'tr'), 'current');
});

test('an icon slot is set and cleared by name', () => {
  let s = setItemIcon(withItems(1), 'card-0', 'glyph', 'ShieldCheck');
  assert.equal(s.items[0].icons.glyph, 'ShieldCheck');
  s = setItemIcon(s, 'card-0', 'glyph', null);
  assert.equal(s.items[0].icons.glyph, undefined);
  assert.equal(setItemIcon(s, 'nope', 'glyph', 'Home'), s, 'an unknown card is a no-op');
});

test('a stored card keeps its translation state through normalisation', () => {
  const item = normalizeItem({
    id: 'c1',
    content: { title: { en: 'Hi', ka: 'გამარჯობა' } },
    i18n: { title: { source: 'en', state: { ka: 'needs_update' }, suggestion: { ka: 'სალამი' } } },
  });
  assert.equal(localeState(item, 'title', 'ka'), 'needs_update');
  assert.equal(suggestionFor(item, 'title', 'ka'), 'სალამი');
});
