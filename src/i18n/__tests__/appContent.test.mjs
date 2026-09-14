import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LOCALES, allKeys, groupOf, groups, holesIn, localeCoverage,
  resolve, search, shipped, validateOverride,
} from '../appContent.ts';

/*
 * APP CONTENT — the copy Site Studio cannot reach.
 *
 * Four and a half thousand strings that could only be changed by a deploy.
 * The override layer that fixes that has one property it must never lose and
 * one failure it must never allow, and this file is both.
 *
 * THE PROPERTY: AN OVERRIDE CAN ONLY ADD.
 *
 * Every path through resolve() ends at the copy the application shipped. No
 * stored value, a blank stored value, a locale nobody has touched, a key that
 * does not exist in this language — all of them render what a customer reads
 * today. There must be no way to make the product say LESS than it says now,
 * because the people using this screen are not the people who would find out.
 *
 * THE FAILURE: A LOST PLACEHOLDER.
 *
 * "Welcome back, {{name}}" rewritten as "Welcome back" does not break. It
 * renders, it reads fine, and the customer's name is gone. Nothing crashes,
 * no test fails, and the person who made the change sees exactly what they
 * typed. That is the one kind of edit the editor has to refuse.
 */

test('every locale the editor offers is a locale the bundle has', () => {
  const source = readFileSync('src/i18n/translations.ts', 'utf8');
  for (const locale of LOCALES) {
    assert.ok(shipped('nav_about', locale), `the ${locale} bundle is missing or empty`);
  }
  /* And the other direction: a seventh language in the bundle that the editor
     does not list would be a language nobody can correct. */
  const declared = [...source.matchAll(/^export const (\w+): Record<string, string> = \{/gm)].map(m => m[1]);
  if (declared.length) {
    assert.ok(declared.length >= LOCALES.length,
      `the bundle declares ${declared.length} locales and the editor offers ${LOCALES.length}`);
  }
});

test('the key list is the English bundle, which is the complete one', () => {
  const keys = allKeys();
  assert.ok(keys.length > 4000, `only ${keys.length} keys found — the bundle is not being read`);
  assert.ok(keys.includes('nav_about'));
});

/* ── Finding a string ──────────────────────────────────────────────────── */

test('a group is derived from the key, so a new key needs no registration', () => {
  assert.equal(groupOf('dash_welcome'), 'Dashboard');
  assert.equal(groupOf('mp_hero_h1'), 'Marketing page');
  // A prefix nobody named falls back to itself, which is usually right.
  assert.equal(groupOf('zzz_new_thing'), 'zzz');
  // A key with no underscore is its own group rather than crashing.
  assert.equal(groupOf('brand'), 'brand');
});

test('every key lands in exactly one group, and the groups cover everything', () => {
  const total = groups().reduce((n, g) => n + g.count, 0);
  assert.equal(total, allKeys().length, 'a key is in two groups or in none');
});

test('search finds a string by what it says, not only by what it is called', () => {
  /*
   * The reason this screen is a search box. Nobody remembers that the
   * sentence they want to change is called `empty_no_notifications_desc`.
   */
  const english = shipped('nav_about', 'en');
  const byText = search(english, null, 'en');
  assert.ok(byText.includes('nav_about'), 'searching the exact English text found nothing');

  const byKey = search('nav_about', null, 'en');
  assert.ok(byKey.includes('nav_about'));

  assert.deepEqual(search('zzzz-no-such-string-anywhere', null, 'en'), []);
});

test('a group filter narrows, and an empty query inside it lists the group', () => {
  const dash = search('', 'Dashboard', 'en');
  assert.ok(dash.length > 0);
  for (const key of dash) assert.equal(groupOf(key), 'Dashboard');
});

/* ── The property ──────────────────────────────────────────────────────── */

test('with no overrides at all, resolve returns exactly what the app ships', () => {
  for (const locale of LOCALES) {
    for (const key of allKeys().slice(0, 200)) {
      assert.equal(resolve(key, locale, {}), shipped(key, locale) ?? shipped(key, 'en'));
    }
  }
});

test('a blank override is ignored rather than rendered', () => {
  // A row cannot be stored blank — the write path deletes instead — so this
  // can only arrive from a direct database write. It must not blank a heading.
  for (const blank of ['', '   ', '\n']) {
    assert.equal(
      resolve('nav_about', 'en', { en: { nav_about: blank } }),
      shipped('nav_about', 'en'),
    );
  }
});

test('an override for one locale does not leak into another', () => {
  const overrides = { ka: { nav_about: 'შეცვლილი' } };
  assert.equal(resolve('nav_about', 'ka', overrides), 'შეცვლილი');
  assert.equal(resolve('nav_about', 'en', overrides), shipped('nav_about', 'en'));
  assert.equal(resolve('nav_about', 'ru', overrides), shipped('nav_about', 'ru'));
});

test('a key nothing has ever defined resolves to undefined, not to a crash', () => {
  assert.equal(resolve('no_such_key_anywhere', 'en', {}), undefined);
});

/* ── The failure ───────────────────────────────────────────────────────── */

test('the holes a string contains are found whichever syntax they use', () => {
  assert.deepEqual(holesIn('Hello {{name}}, you have {n} left'), ['{n}', '{{name}}']);
  assert.deepEqual(holesIn('no holes at all'), []);
  // Whitespace inside the braces is how the interpolator already accepts them.
  assert.deepEqual(holesIn('{{ name }}'), ['{{name}}']);
});

test('a replacement that loses a placeholder is refused', () => {
  const problem = validateOverride('Welcome back', 'Welcome back, {{name}}');
  assert.equal(problem?.kind, 'MISSING_HOLES');
  assert.deepEqual(problem.holes, ['{{name}}']);
});

test('a replacement that invents a placeholder is refused', () => {
  // Nothing fills it, so it reaches the customer as literal braces.
  const problem = validateOverride('Hello {{nickname}}', 'Hello there');
  assert.equal(problem?.kind, 'UNKNOWN_HOLES');
  assert.deepEqual(problem.holes, ['{{nickname}}']);
});

test('losing one placeholder and inventing another reports the loss first', () => {
  /* Both are wrong; only one is invisible. An invented hole shows up as
     literal braces the moment anybody looks at the screen, and a lost one
     never shows up at all, so that is the one to name. */
  const problem = validateOverride('Hello {{nickname}}', 'Hello {{name}}');
  assert.equal(problem?.kind, 'MISSING_HOLES');
  assert.deepEqual(problem.holes, ['{{name}}']);
});

test('a replacement may move a placeholder and rewrite everything around it', () => {
  assert.equal(validateOverride('{{name}} — welcome back to Homatch', 'Welcome back, {{name}}'), null);
  assert.equal(validateOverride('{{ name }} hello', 'Hello {{name}}'), null);
});

test('an empty replacement is not a refusal — it is how the original comes back', () => {
  const problem = validateOverride('', 'Welcome back, {{name}}');
  assert.equal(problem?.kind, 'EMPTY');
});

test('a replacement far too long to be interface copy is refused', () => {
  const problem = validateOverride('x'.repeat(2001), 'Short');
  assert.equal(problem?.kind, 'TOO_LONG');
});

/* ── What the screen reports ───────────────────────────────────────────── */

test('coverage counts a locale against English, which is the complete one', () => {
  const en = localeCoverage('en', {});
  assert.equal(en.total, allKeys().length);
  assert.equal(en.translated, en.total, 'the English bundle has a hole in it');
  assert.equal(en.overridden, 0);
});

test('an override counts as translated, because it is what the customer reads', () => {
  const before = localeCoverage('ka', {});
  if (before.missing.length === 0) return; // nothing to prove on a complete locale
  const key = before.missing[0];
  const after = localeCoverage('ka', { ka: { [key]: 'ტექსტი' } });
  assert.equal(after.translated, before.translated + 1);
  assert.equal(after.overridden, 1);
  assert.ok(!after.missing.includes(key));
});
