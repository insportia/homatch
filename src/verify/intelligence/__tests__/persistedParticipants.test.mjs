// A report already written can still be wrong.
//
// The eight fabricated shareholders are fixed at the parser, but they are
// already persisted in synthesis_json for every report generated before that
// fix — and a persisted report is served as a read, so it never passes
// through the parser again.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { looksLikePersonName } from '../peopleIntelligence.ts';

const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const code = (p) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

/** Every name that actually reached a customer as a registered shareholder. */
const FABRICATED = [
  'სამინისტროს სა',
  'დოკუმენტაციის წარმოდგენის შემთხვევაში',
  'დამატებით გაცნობებთ',
  'წილიარ არის განსაზღვრული',
  'მესაკუთრერაოდენობაწილიწილის მმართველი',
  'რეგისტრირებული არ არის',
  'ქონებრივი სიკეთე',
  'საჯარო რეესტრის',
];

/** The people who are actually in the register. */
const REAL = ['კობა კვანტალიანი', 'ლევან ჩაჩუა'];

test('every fabricated participant is rejected as a name', () => {
  for (const name of FABRICATED) {
    assert.equal(looksLikePersonName(name), false, `"${name}" still reads as a person`);
  }
});

test('the real directors and partners are still names', () => {
  for (const name of REAL) {
    assert.equal(looksLikePersonName(name), true, `"${name}" was rejected`);
  }
});

test('ordinary Georgian names are unaffected by the new vocabulary', () => {
  // The blocklist must not reach into normal names that happen to share a
  // syllable with an administrative word.
  for (const name of ['ნინო ბერიძე', 'გიორგი მაისურაძე', 'დარეჯან შათაშვილი', 'თამარ წილოსანი']) {
    assert.equal(looksLikePersonName(name), true, `"${name}" was rejected`);
  }
  assert.equal(looksLikePersonName('Levan Chachua'), true);
});

test('a persisted report is re-checked on the way out', () => {
  const fn = code('supabase/functions/verify-synthesis/index.ts');
  assert.ok(/function withCredibleParticipants/.test(fn), 'persisted participants are served unchecked');
  assert.ok(/looksLikePersonName\(name\)/.test(fn), 'the guard does not apply the name test');

  // It must be wired into the READ branch, which is the one that never
  // rebuilds the report.
  const readBranch = fn.slice(fn.indexOf("job.synthesis_state === 'READY'"));
  assert.ok(/withCredibleParticipants\(job\.synthesis_json/.test(readBranch.slice(0, 300)),
    'the persisted branch still returns the payload unfiltered');
});

test('the guard only removes participants, never rewrites the report', () => {
  const fn = code('supabase/functions/verify-synthesis/index.ts');
  const body = fn.slice(fn.indexOf('function withCredibleParticipants'));
  const guard = body.slice(0, body.indexOf('\n}'));
  assert.ok(/return payload;/.test(guard), 'an unchanged report is not returned as-is');
  assert.ok(!/summary|sections|snapshot|keyFindings/.test(guard),
    'the guard reaches into narrative fields it has no business changing');
});
