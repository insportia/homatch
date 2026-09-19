import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * THE PANEL CAN NAME EVERY STATE IT CAN BE IN.
 *
 * AI TALK reports what it is doing through STATE_KEY, which turns a
 * VoiceState into a translation key. Two ways that quietly breaks:
 *
 *   A state is added to the union in voiceClient.ts and nobody adds it to the
 *   map. The panel then renders `t(undefined)` and the header goes blank
 *   exactly when something unusual is happening — the moment a visitor most
 *   needs to be told.
 *
 *   A key is in the map but not in the translation file. The i18n gates do
 *   not catch this one: they check LITERAL t('...') calls, and this call is
 *   `t(STATE_KEY[state])`, which is not a literal. A Georgian visitor would
 *   see the raw key.
 *
 * Both are caught here by reading the three files as text, which is the only
 * option available: these are .tsx and .ts modules with JSX and path aliases
 * that a bare node test cannot import.
 */

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const LOCALES = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];

/** The union, as declared by the voice client. */
function voiceStates() {
  const src = read('../comm/voiceClient.ts');
  const decl = src.match(/export type VoiceState =([\s\S]*?);/);
  assert.ok(decl, 'VoiceState is no longer declared the way this test reads it');
  return [...decl[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
}

/** The map, as declared by the panel. */
function stateKeys() {
  const src = read('../../components/home/AiTalkPanel.tsx');
  const decl = src.match(/const STATE_KEY = \{([\s\S]*?)\n\}/);
  assert.ok(decl, 'STATE_KEY is no longer declared the way this test reads it');
  return Object.fromEntries(
    [...decl[1].matchAll(/^\s{2}([A-Z_]+):\s*'([a-z0-9_]+)',/gm)].map((m) => [m[1], m[2]]),
  );
}

test('every state the voice client can reach has a word for it', () => {
  const map = stateKeys();
  const missing = voiceStates().filter((s) => !map[s]);
  assert.deepEqual(missing, [], 'VoiceState members with no entry in STATE_KEY');
});

test('every word it uses exists in all six languages', () => {
  const src = read('../../i18n/translations.ts');
  const keys = [...new Set(Object.values(stateKeys()))];

  // One counted block per locale, in declaration order, so a key present in
  // English only is not mistaken for a key present everywhere.
  const absent = [];
  for (const key of keys) {
    const hits = [...src.matchAll(new RegExp(`^\\s{2}${key}:`, 'gm'))].length;
    if (hits < LOCALES.length) absent.push(`${key} (${hits}/${LOCALES.length})`);
  }
  assert.deepEqual(absent, [], 'state labels missing from one or more locales');
});

test('each state family looks different, so the panel is never ambiguous', () => {
  const src = read('../../components/home/AiTalkPanel.tsx');
  // PanelState since the refusals became states of their own: a spent
  // allowance and a dropped connection are things the panel is in, and they
  // need a colour as much as LISTENING does.
  const body = src.match(/function toneOf\(state: PanelState\)[\s\S]*?\n\}/);
  assert.ok(body, 'toneOf is no longer declared the way this test reads it');

  // Listening, thinking, answering, connecting, failed and finished must not
  // share an indicator colour: the colour is the at-a-glance signal, and a
  // shared one makes the panel say "something is happening" rather than what.
  const dots = [...body[0].matchAll(/dot: '([^']+)'/g)].map((m) => m[1]);
  assert.equal(new Set(dots).size, dots.length, `toneOf reuses an indicator colour: ${dots.join(', ')}`);
  assert.ok(dots.length >= 6, 'fewer tones than there are kinds of state');
});
