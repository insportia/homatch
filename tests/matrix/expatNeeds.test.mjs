/*
 * FOR EXPATS IS A SET OF ACTIONS, NOT A READING LIST.
 *
 * Production carries six topics. The gap was never too much to read — it was
 * that somebody who wanted to buy a flat had no path through the product and
 * had to work out for themselves that Verify checks an owner and that Find a
 * property is where a search starts.
 *
 * What these tests protect is the part that is easy to get wrong later:
 * every step points at a tool that exists, no step states a law, and a guide
 * that production does not have is never implied to exist.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const NEEDS = readFileSync('src/expats/needs.ts', 'utf8');
const ROUTES = readFileSync('src/routes.tsx', 'utf8');
const COMPONENT = readFileSync('src/components/expats/WhatDoYouNeed.tsx', 'utf8');
const COPY = readFileSync('scripts/expat-needs-i18n-data.mjs', 'utf8');

test('needs 1: every tool a step offers is a route that exists', () => {
  /* A step that sends somebody to a 404 is worse than a step with no tool. */
  const targets = [...NEEDS.matchAll(/to: '(\/[^'#]*)/g)].map((m) => m[1]);
  assert.ok(targets.length >= 6, 'expected the steps to offer real tools');
  for (const target of targets) {
    assert.ok(ROUTES.includes(`path: '${target}'`), `${target} is not a route`);
  }
});

test('needs 2: every need resolves to steps the catalogue defines', () => {
  const defined = new Set([...NEEDS.matchAll(/^ {2}(\w+): \{$/gm)].map((m) => m[1]));
  const referenced = [...NEEDS.matchAll(/steps: \[([^\]]*)\]/g)]
    .flatMap((m) => m[1].split(',').map((s) => s.trim().replace(/'/g, '')))
    .filter(Boolean);
  assert.ok(referenced.length > 20, 'expected the needs to compose many steps');
  for (const step of referenced) {
    assert.ok(defined.has(step), `need references an undefined step: ${step}`);
  }
});

test('needs 3: the steps describe process, never law, tax or fees', () => {
  /*
   * "Check who owns it before you pay" is an order of events. "A foreigner
   * may own an apartment" is a statement of law that changes and belongs in
   * a topic with a source and a verified date. Percentages, currency amounts
   * and legal permission are the three shapes that sneak in.
   */
  const english = [...COPY.matchAll(/^ {4}'([^']*)',$/gm)].map((m) => m[1]);
  assert.ok(english.length > 40, 'expected to be reading the copy');
  for (const line of english) {
    assert.ok(!/\b\d+(\.\d+)?\s?%/.test(line), `a rate appears in the copy: ${line}`);
    assert.ok(!/(GEL|USD|EUR|\$)\s?\d/.test(line), `a money amount appears in the copy: ${line}`);
    assert.ok(!/\b(is legal|are allowed to own|may legally|tax rate|required by law)\b/i.test(line),
      `a legal claim appears in the copy: ${line}`);
  }
});

test('needs 4: a guide production does not have is never implied to exist', () => {
  /* The domain link renders only when a topic for that domain came back;
     otherwise the component says so. */
  assert.match(COMPONENT, /topic \?/, 'the topic link is not conditional');
  assert.match(COMPONENT, /expat_needs_no_topic/, 'there is no honest empty state');
  assert.match(COPY, /expat_needs_no_topic/, 'the empty state has no copy');
});

test('needs 5: one question, then steps — the chooser is replaced, not stacked', () => {
  /*
   * A wall of choices is the same failure as a wall of text. Choosing
   * replaces the list rather than appending to it, and there is a way back.
   */
  assert.match(COMPONENT, /chosen === null \?/, 'the chooser and the steps are both on screen');
  assert.match(COMPONENT, /data-expat-needs-reset/, 'there is no way back to the chooser');
  assert.match(COMPONENT, /expat_needs_step_of/, 'the steps are not numbered');
});

test('needs 6: touch targets are big enough to hit', () => {
  /* §67: an elderly reader on a phone is the person this is for. */
  assert.match(COMPONENT, /min-h-11/, 'the actions are below a comfortable touch size');
  assert.match(COMPONENT, /min-h-\[4\.5rem\]/, 'the choices are below a comfortable touch size');
});
