// A PLACEHOLDER THE TEMPLATE CANNOT RECEIVE.
//
// t() fills {{name}} and nothing else. src/i18n/interpolate.ts:
//
//   const HOLE_GLOBAL = /\{\{\s*(\w+)\s*\}\}/g;
//
// and hasUnfilledHole() also looks only for {{...}}. So a template written
// with ONE brace is neither substituted nor detected: resolveCopy returns it
// unchanged and the customer reads the braces.
//
// Nothing caught it. The key exists, it is translated in all six languages,
// i18n:check reports 100% real coverage, and the string renders — it just
// renders "{n} unread" instead of "3 unread".
//
// MEASURED 2026-09-26: forty-six keys, 276 language values. Among them the
// header notification badge ({n} unread), every relative timestamp
// ({n}d ago, {n}h ago), the price prefix on a property card, and four
// money-moment strings including "Charged {credits} credits" on the unlock
// receipt and "need {need}, have {have}" when a balance is short.
//
// This compares what CALL SITES pass against what TEMPLATES can receive, in
// both directions, because either half alone is satisfied by a broken string.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const TRANSLATIONS = 'src/i18n/translations.ts';
const trans = readFileSync(TRANSLATIONS, 'utf8');

/** English templates: the first occurrence of each key is the en bundle. */
const templates = new Map();
for (const m of trans.matchAll(/^ {2}([a-z0-9_]+): '((?:[^'\\]|\\.)*)'/gm)) {
  if (!templates.has(m[1])) templates.set(m[1], m[2]);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full) && !full.endsWith(TRANSLATIONS)) out.push(full);
  }
  return out;
}

/** Every t('key', { a, b }) in the app, with the names it supplies. */
const CALLS = [];
for (const file of walk('src')) {
  const body = readFileSync(file, 'utf8');
  for (const m of body.matchAll(/t\(\s*'([a-z0-9_]+)'\s*,\s*\{([^}]*)\}/g)) {
    const names = [...m[2].matchAll(/(\w+)\s*:/g)].map((n) => n[1]);
    if (names.length) CALLS.push({ key: m[1], names, file });
  }
}

test('the audit is actually looking at call sites', () => {
  /* A regex that stopped matching would make everything below vacuous. */
  assert.ok(CALLS.length > 100, `only ${CALLS.length} t() call sites with variables found`);
  assert.ok(templates.size > 1000, `only ${templates.size} templates parsed`);
});

test('every variable a call site passes has a {{hole}} to land in', () => {
  const broken = [];
  for (const { key, names, file } of CALLS) {
    const tpl = templates.get(key);
    if (tpl === undefined) continue;
    for (const name of names) {
      if (tpl.includes(`{{${name}}}`)) continue;
      /*
       * A single brace is the failure. Absent entirely is NOT: some call
       * sites legitimately pass a variable a shortened translation no longer
       * uses, and interpolate leaves the text alone.
       */
      if (new RegExp(`(?<!\\{)\\{${name}\\}(?!\\})`).test(tpl)) {
        broken.push(`${key} needs {{${name}}} but has {${name}} — ${tpl.slice(0, 60)} (${file})`);
      }
    }
  }
  assert.deepEqual(broken, [], `single-braced placeholders reach customers:\n${broken.join('\n')}`);
});

test('no language bundle keeps a single brace a call site will try to fill', () => {
  /*
   * The English fix is not the whole fix. Georgian, Russian, Turkish, Arabic
   * and Hebrew each carry their own copy of every string, and a translator
   * working from a single-braced original reproduces it. All 276 values were
   * wrong, not 46.
   */
  const wanted = new Map();
  for (const { key, names } of CALLS) {
    if (!wanted.has(key)) wanted.set(key, new Set());
    for (const name of names) wanted.get(key).add(name);
  }

  const broken = [];
  for (const [key, names] of wanted) {
    for (const m of trans.matchAll(
      new RegExp(`^ {2}${key}: '((?:[^'\\\\]|\\\\.)*)'`, 'gm'),
    )) {
      for (const name of names) {
        if (new RegExp(`(?<!\\{)\\{${name}\\}(?!\\})`).test(m[1])) {
          broken.push(`${key}: '${m[1].slice(0, 50)}' still has {${name}}`);
        }
      }
    }
  }
  assert.deepEqual(broken, [], `single braces in non-English bundles:\n${broken.join('\n')}`);
});

test('interpolate still only fills the double-braced form', () => {
  /*
   * If this ever changes, the two tests above stop describing reality — so
   * they are pinned to the implementation they were written against rather
   * than silently guarding the wrong contract.
   */
  const src = readFileSync('src/i18n/interpolate.ts', 'utf8');
  assert.match(src, /HOLE_GLOBAL = \/\\\{\\\{\\s\*\(\\w\+\)\\s\*\\\}\\\}\/g/,
    'interpolate no longer fills exactly {{name}}; revisit this gate');
});
