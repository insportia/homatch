// "Check it yourself", for somebody who has never read a registry extract.
//
// The card already told a buyer WHAT to open and WHAT to paste. It did not
// tell them what an ordinary answer looks like, or what would be worth a
// second look — which are the two things a non-lawyer needs most, because
// they are the difference between reading an extract and understanding it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const code = (p) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

const REPORT = 'src/components/verify/VerifyReport.tsx';
const KINDS = ['PROPERTY_EXTRACT', 'TAXPAYER_REGISTRY'];

test('every check answers all six of the buyer questions', () => {
  const src = code(REPORT);
  const map = src.slice(src.indexOf('const SELF_CHECK_COPY'), src.indexOf('const SelfChecks'));
  for (const kind of KINDS) {
    assert.ok(map.includes(kind), `${kind} has no copy`);
  }
  for (const part of ['title', 'help', 'expect', 'attention']) {
    assert.ok(new RegExp(`${part}:`).test(map), `no check states "${part}"`);
  }
  // Where to open it and what to type in are the other two, and they are the
  // fields the data already carries.
  const card = src.slice(src.indexOf('const SelfChecks'));
  assert.ok(/href=\{c\.url\}/.test(card), 'the official portal link is gone');
  assert.ok(/\{c\.copyValue\}/.test(card), 'the value to paste is gone');
});

test('a new kind cannot be added without deciding what it says', () => {
  // The old card chose its copy with a ternary, so a third kind would have
  // silently rendered the taxpayer wording.
  const src = code(REPORT);
  const card = src.slice(src.indexOf('const SelfChecks'));
  assert.ok(!/c\.kind === 'PROPERTY_EXTRACT' \?/.test(card),
    'the copy is chosen by a ternary again');
  assert.ok(/SELF_CHECK_COPY\[c\.kind\]/.test(card), 'the copy is not keyed by kind');
  assert.ok(/Record<SelfCheck\['kind'\]/.test(src),
    'the copy map is not typed against the kinds, so one could be missed');
});

test('the explanations exist in all six languages', () => {
  const bundle = read('src/i18n/translations.ts');
  const keys = [
    'verify_ir_selfcheck_expect_label',
    'verify_ir_selfcheck_attention_label',
    'verify_ir_selfcheck_property_expect',
    'verify_ir_selfcheck_property_attention',
    'verify_ir_selfcheck_taxpayer_expect',
    'verify_ir_selfcheck_taxpayer_attention',
  ];
  for (const k of keys) {
    const n = bundle.split(`\n  ${k}: `).length - 1;
    assert.equal(n, 6, `${k} is defined ${n} times, expected all six languages`);
  }
});

test('the guidance tells a buyer what to DO, not what we failed to fetch', () => {
  // This section replaced an inventory of what the pipeline could not
  // retrieve. It must stay pointed forwards.
  const bundle = read('src/i18n/translations.ts');
  for (const c of bundle.split('verify_ir_selfcheck_property_attention: ').slice(1)) {
    const line = c.slice(0, c.indexOf('\n'));
    assert.ok(!/(could not|ვერ მოვიძიეთ|не удалось|failed|unavailable)/i.test(line),
      'the attention copy describes our own failure rather than the buyer\'s check');
  }
});

test('the attention copy names a concrete thing to look at', () => {
  // "Something might be wrong" is not guidance.
  const bundle = read('src/i18n/translations.ts');
  const en = bundle.slice(bundle.indexOf("verify_ir_selfcheck_property_attention: '"));
  const line = en.slice(0, en.indexOf('\n'));
  assert.ok(/owner|area|rights|restrictions/i.test(line),
    'the property attention copy names nothing specific to check');
});

test('no internal mechanics are exposed alongside the official links', () => {
  const src = code(REPORT);
  const card = src.slice(src.indexOf('const SelfChecks'));
  for (const leak of ['worker', 'browserbase', 'playwright', 'rstax', 'enreg', 'napr']) {
    assert.ok(!new RegExp(leak, 'i').test(card), `${leak} is named in the self-check card`);
  }
});
