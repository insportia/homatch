// The last-resort privacy net.
//
// sanitizeCustomerString is the primary defence and is where these leaks are
// actually fixed. This is the net underneath it: an INDEPENDENT check that
// fires if the sanitiser is ever changed, bypassed, or handed a shape it does
// not recognise. In normal operation it must find nothing — a hit means the
// primary defence has a hole.
//
// It exists because the net that was there caught none of what actually
// reached customers. It was a list of literal strings (portal names, internal
// field names) and had no idea what a personal identifier looked like, while
// this class of bug has now occurred twice.
//
// The patterns are re-declared here from the source so the behaviour is
// exercised directly; the source assertions below pin that the edge function
// uses the same ones.

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

const AGENT = 'supabase/functions/research-agent/index.ts';

const PATTERNS = {
  personal_id_11_digits: /(?<!\d)\d{11}(?!\d)/g,
  personal_id_label: /(?:პ\/?ნ|პირადი\s*ნომერი|p\s*\/\s*n)\s*[:№#]?\s*\d/gi,
  date_of_birth: /(?:დაბ|ÃÀÁ|born)\s*\.?\s*:?\s*\d{2}[./]\d{2}[./]\d{4}/gi,
  mojibake_registry_text: /[ÀÁÂÃÄÅÆÈÉÊËÌÍÎÏÐÒÓÔÕÖÙÚÛÜÝÞ]{4,}/g,
};

const hits = (payload) => {
  const json = JSON.stringify(payload);
  return Object.entries(PATTERNS)
    .filter(([, re]) => {
      re.lastIndex = 0;
      return re.test(json);
    })
    .map(([name]) => name);
};

/* ── the strings that actually reached customers ─────────────────────── */

test('the exact leaks found in production are caught', () => {
  // Verbatim from the Evidence drawer of a live report.
  assert.deepEqual(hits({ fact: 'ლევან ჩაჩუა პ/ნ 01012012287' }).sort(), [
    'personal_id_11_digits',
    'personal_id_label',
  ]);
  assert.ok(hits({ line: "ÌÀÒÉÍÀ ÊÀÝÉÔÀÞÄ (ÃÀÁ.01/02/1969) ,P/N: 01018001305" }).includes('mojibake_registry_text'));
  assert.ok(hits({ line: 'მარინა კაციტაძე (დაბ.01/02/1969)' }).includes('date_of_birth'));
  assert.ok(hits({ line: 'ლაშა პეტრიაშვილი P/N: 38001036114' }).includes('personal_id_label'));
});

test('a clean report trips nothing', () => {
  // Everything a real report legitimately carries.
  const clean = {
    summary: 'Villion არის დაბალსიმჭიდროვიანი ბუტიკური პროექტი კრწანისში.',
    cadastralCode: '01.18.06.019.055.03.01.601',
    parcelCode: '01.18.06.019.055',
    companyIdCode: '404670272',
    directors: ['კობა კვანტალიანი', 'ლევან ჩაჩუა'],
    pricePerSqm: '1899',
    dates: ['2024-03-28', '2026-06-17', '2009-12-07'],
    permitArea: '5,242.3 კვ.მ',
  };
  assert.deepEqual(hits(clean), []);
});

test('a nine-digit company id is not mistaken for a personal number', () => {
  // It is public by design and is the thing a buyer pastes into the taxpayer
  // register, so a net that ate it would remove a genuinely useful fact.
  assert.deepEqual(hits({ idCode: '404670272' }), []);
  assert.deepEqual(hits({ idCode: '204378869' }), []);
});

test('a cadastral code is not mistaken for a personal number', () => {
  // It has eleven digits in it once the dots are removed; the boundary
  // assertions are what keep them apart.
  assert.deepEqual(hits({ code: '01.18.06.019.055.03.01.601' }), []);
});

test('a long digit run is not reported as an eleven-digit identifier', () => {
  // A registration number is twelve digits. It is not a personal number and
  // must not be reported as one, or the net cries wolf on every report.
  assert.deepEqual(hits({ registration: '892024224686' }), []);
  assert.deepEqual(hits({ registration: '882025810877' }), []);
});

/* ── the edge function uses these same patterns ──────────────────────── */

test('the leak net checks patterns, not only literal tokens', () => {
  const agent = code(AGENT);
  assert.ok(/FORBIDDEN_LEAK_PATTERNS/.test(agent), 'the net is a token list again');
  const fn = agent.slice(agent.indexOf('function findLeaks'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.ok(/FORBIDDEN_LEAK_PATTERNS/.test(body), 'the patterns are declared but never checked');
  assert.ok(/FORBIDDEN_LEAK_TOKENS/.test(body), 'the literal-token check was dropped');
});

test('every production leak class is represented in the net', () => {
  const agent = code(AGENT);
  const decl = agent.slice(agent.indexOf('const FORBIDDEN_LEAK_PATTERNS'), agent.indexOf('function findLeaks'));
  for (const name of Object.keys(PATTERNS)) {
    assert.ok(decl.includes(`'${name}'`), `${name} is no longer checked`);
  }
});

test('a pattern hit is removed by its pattern, not by deleting its name', () => {
  // findLeaks reports a pattern by NAME. The runtime strips residual leaks by
  // treating each hit as a literal string — which for a pattern would delete
  // the words "personal_id_11_digits" and leave the number in place.
  const agent = code(AGENT);
  const site = agent.slice(agent.indexOf('for (const token of leaks)'));
  const body = site.slice(0, 700);
  assert.ok(/FORBIDDEN_LEAK_PATTERNS\.find\(\(p\) => p\.name === token\)/.test(body),
    'a pattern hit is stripped as though its name were the leak');
  assert.ok(/raw\.replace\(pattern\.re, ''\)/.test(body), 'the pattern is never applied');
});

test('the net stays a net — it never replaces the primary sanitiser', () => {
  const agent = code(AGENT);
  // Both must still exist and run: the sanitiser on every string, the net on
  // the assembled payload.
  assert.ok(/PERSONAL_ID_RE/.test(agent) && /PERSONAL_ID_LABEL_RE/.test(agent) && /BIRTH_DATE_RE/.test(agent),
    'the primary redaction was removed in favour of the net');
  assert.ok(/const leaks = findLeaks\(r\)/.test(agent), 'the net is no longer applied on the read path');
});
