import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ABOUT_ORDER, DEFAULT_HOME_ORDER, defaultOrderFor, resolveSections,
} from '../render/order.ts';
import { emptyPage, makeSection, setSectionEnabled } from '../model.ts';

/*
 * SITE STUDIO — what the public site actually renders.
 *
 * The single most important property of this feature is that it cannot take
 * the website away. Every test below is a way that could happen: an empty
 * database, an unreachable one, a stored page written before a section
 * existed, a page whose every section was hidden.
 *
 * The answer in each case has to be a real page.
 */

function page(types) {
  return { ...emptyPage(), sections: types.map((t, i) => makeSection(t, `${t}-${i}`)) };
}

test('no stored page renders the full shipped running order', () => {
  const resolved = resolveSections('home', null);
  assert.deepEqual(resolved.map(r => r.type), [...DEFAULT_HOME_ORDER]);
  // Every section reports "no overrides", which is what makes the components
  // fall back to their own six-language copy.
  assert.ok(resolved.every(r => r.section === null));
});

test('an empty stored page is treated as no stored page', () => {
  // A row that exists but has no sections is what a failed migration or a
  // bad save looks like. It must not mean "render nothing".
  const resolved = resolveSections('home', emptyPage());
  assert.deepEqual(resolved.map(r => r.type), [...DEFAULT_HOME_ORDER]);
});

test('about resolves its own order, not the homepage one', () => {
  assert.deepEqual(resolveSections('about', null).map(r => r.type), [...DEFAULT_ABOUT_ORDER]);
  assert.deepEqual(defaultOrderFor('about'), DEFAULT_ABOUT_ORDER);
  // An unknown slug falls back to the homepage order rather than to nothing.
  assert.deepEqual(defaultOrderFor('nonsense'), DEFAULT_HOME_ORDER);
});

test('the stored sections keep their relative order', () => {
  // Sections the stored page does not mention are woven back in around them,
  // so this is about relative order rather than adjacency: what the admin
  // arranged stays arranged.
  const stored = page(['mortgage', 'hero', 'verify']);
  const types = resolveSections('home', stored).map(r => r.type);
  assert.ok(types.indexOf('mortgage') < types.indexOf('hero'));
  assert.ok(types.indexOf('hero') < types.indexOf('verify'));
});

test('a page that stores every section is reproduced exactly', () => {
  // Once the admin has saved the whole page, nothing is missing and nothing
  // is interleaved: the stored order is the page, verbatim.
  const custom = ['closing_cta', ...DEFAULT_HOME_ORDER.filter(t => t !== 'closing_cta')];
  const resolved = resolveSections('home', page(custom));
  assert.deepEqual(resolved.map(r => r.type), custom);
});

test('a section the stored page never heard of still renders', () => {
  // The scenario: a page was saved, then a new section shipped in code. The
  // new section has to appear without anyone re-saving every page.
  const stored = page(['hero', 'action_launcher']);
  const resolved = resolveSections('home', stored);

  for (const type of DEFAULT_HOME_ORDER) {
    assert.ok(resolved.some(r => r.type === type), `${type} disappeared`);
  }
  assert.equal(resolved.length, DEFAULT_HOME_ORDER.length);
});

test('a code-only section lands in its shipped position, not at the end', () => {
  // hero, then verify: intelligence_layers ships between them and should
  // arrive between them, rather than being swept to the bottom of the page.
  const stored = page(['hero', 'verify']);
  const types = resolveSections('home', stored).map(r => r.type);
  assert.ok(types.indexOf('intelligence_layers') > types.indexOf('hero'));
  assert.ok(types.indexOf('intelligence_layers') < types.indexOf('verify'));
});

test('a hidden section is gone from the site and present in the editor', () => {
  const stored = setSectionEnabled(page(['hero', 'verify']), 'verify-1', false);

  const live = resolveSections('home', stored, false);
  assert.ok(!live.some(r => r.section?.id === 'verify-1'));

  const editing = resolveSections('home', stored, true);
  const found = editing.find(r => r.section?.id === 'verify-1');
  assert.ok(found, 'a hidden section became unreachable in the editor');
  assert.equal(found.section.enabled, false);
});

test('hiding every stored section still leaves a page', () => {
  // The worst realistic misuse: someone hides everything and publishes. The
  // sections the stored page does not mention are still shipped by the code,
  // so the site degrades rather than going blank.
  let stored = page(['hero', 'action_launcher']);
  stored = setSectionEnabled(stored, 'hero-0', false);
  stored = setSectionEnabled(stored, 'action_launcher-1', false);

  const live = resolveSections('home', stored, false);
  assert.ok(live.length > 0);
  assert.ok(live.every(r => r.section === null || r.section.enabled));
});

test('stored sections carry their overrides through', () => {
  const stored = page(['hero']);
  const resolved = resolveSections('home', stored);
  const hero = resolved.find(r => r.type === 'hero');
  assert.equal(hero.section?.id, 'hero-0');
  // Everything else arrives with no overrides, so it renders shipped copy.
  assert.ok(resolved.filter(r => r.type !== 'hero').every(r => r.section === null));
});

test('resolving does not mutate the stored page', () => {
  const stored = page(['hero', 'verify']);
  const before = JSON.stringify(stored);
  resolveSections('home', stored, true);
  resolveSections('home', stored, false);
  assert.equal(JSON.stringify(stored), before);
});
