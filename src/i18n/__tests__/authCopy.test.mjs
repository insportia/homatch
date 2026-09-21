// The strings the sign-in screen renders, in all six languages.
//
// This lives here rather than beside the browser gate because it needs no
// browser: `npm test` walks src/ and `npm run test:mobile` does not, so a
// copy rule kept next to the layout gate would only run when somebody
// remembered to run the layout gate.
//
// WHAT IT GUARDS
//
// Arabic punctuation. The hero description shipped with a Latin comma in
// the middle of an Arabic sentence while every sibling string used the
// Arabic one. In a right-to-left line the Latin comma leans the wrong way
// and sits on the wrong side of the word it follows, so it reads as a
// typo rather than as punctuation.
//
// The Hebrew consent line. It began "בהמשך," — which on its own means
// "later on", not "by continuing" — so the sentence promised that the
// reader would agree at some unspecified future point. It also dropped
// the preposition before the second document, which Hebrew repeats.
//
// And the flat requirement underneath both: every key the screen renders
// exists in every language. That is the check that was in place before,
// and on its own it passed while all of the above was true — which is the
// reason the other rules are here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const LOCALES = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];

const ARABIC = /[؀-ۿ]/;

/**
 * One locale's object literal out of the bundle.
 *
 * Both quote styles, because the English values carry apostrophes
 * ("Don't have an account?") and are therefore written double-quoted. A
 * single-quote-only reader reports those two keys as missing, which is
 * exactly the false alarm that sent this audit looking for a bug in the
 * English bundle that was never there.
 */
function bundleFor(src, locale) {
  const opener = locale === 'en'
    ? 'const en = {'
    : `const ${locale}: Partial<Record<TranslationKey, string>> = {`;
  const start = src.indexOf(opener);
  assert.notEqual(start, -1, `locale bundle ${locale} not found`);
  const body = src.slice(start, src.indexOf('\n};', start));
  const out = {};
  for (const m of body.matchAll(/^ {2}([a-z0-9_]+): '((?:[^'\\]|\\.)*)',$/gm)) {
    out[m[1]] = m[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  }
  for (const m of body.matchAll(/^ {2}([a-z0-9_]+): "((?:[^"\\]|\\.)*)",$/gm)) {
    out[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return out;
}

/** Every key /auth/login and its forgot-password dialog render. */
const LOGIN_KEYS = [
  'auth_login_hero_title1', 'auth_login_hero_title2', 'auth_login_hero_desc',
  'auth_signin', 'auth_signin_btn', 'auth_continue_google', 'auth_or_email',
  'auth_email', 'auth_email_ph', 'auth_password', 'auth_forgot_password',
  'auth_show_password', 'auth_hide_password', 'auth_terms', 'auth_no_account',
  'auth_signup', 'auth_analysing_after', 'auth_forgot_desc', 'auth_forgot_sent',
  'auth_forgot_submit', 'general_loading', 'general_ok', 'general_cancel',
];

const SRC = fs.readFileSync(path.join(ROOT, 'src', 'i18n', 'translations.ts'), 'utf8');
const B = Object.fromEntries(LOCALES.map((l) => [l, bundleFor(SRC, l)]));

test('the sign-in screen has every one of its strings in every language', () => {
  const missing = [];
  for (const key of LOGIN_KEYS) {
    for (const lang of LOCALES) {
      if (!B[lang][key]) missing.push(`${key} [${lang}]`);
    }
  }
  assert.deepEqual(missing, [], `sign-in strings missing:\n  ${missing.join('\n  ')}`);
});

test('Arabic sign-in copy is punctuated in Arabic', () => {
  const wrong = [];
  for (const key of LOGIN_KEYS) {
    const v = B.ar[key] ?? '';
    if (!ARABIC.test(v)) continue;
    if (v.includes(',')) wrong.push(`${key}: Latin "," should be "،"`);
    if (v.includes(';')) wrong.push(`${key}: Latin ";" should be "؛"`);
    if (v.includes('?')) wrong.push(`${key}: Latin "?" should be "؟"`);
  }
  assert.deepEqual(wrong, [], `Arabic punctuation:\n  ${wrong.join('\n  ')}`);
});

test('the Hebrew consent line says "by continuing", not "later on"', () => {
  const terms = B.he.auth_terms ?? '';
  assert.ok(terms, 'auth_terms [he] is missing');
  assert.doesNotMatch(
    terms, /^בהמשך\s*,/,
    '"בהמשך," on its own reads as "later on"; the sentence has to say that carrying on now is the agreement',
  );
  /* Both documents still named, and the second still governed by its own
     preposition the way Hebrew requires. */
  assert.match(terms, /תנאי השירות/, 'the terms of service are no longer named');
  assert.match(terms, /ולמדיניות הפרטיות/, 'the privacy policy lost its preposition or its name');
});
