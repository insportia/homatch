// legacyGeorgian.test.mjs — older NAPR extracts (TAS map "ABSTRACT N:" PDFs) are typeset in a legacy Georgian font and
// extract as Latin-1 ("ÌÉßÉÓ"); live test 307a60b1 had 9 of 19 such documents unreadable to the report.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeLegacyGeorgian, looksLegacyGeorgian } from '../.tstest-build/documents/legacyGeorgian.js';
import { compactResult } from '../.tstest-build/queue/evidence.js';

const REAL = 'ÌÉßÉÓ (ÖÞÒÀÅÉ ØÏÍÄÁÉÓ) ÓÀÊÀÃÀÓÔÒÏ ÊÏÃÉ N 01.15.01.004.070 ÀÌÏÍÀßÄÒÉ ÓÀãÀÒÏ ÒÄÄÓÔÒÉÃÀÍ ÂÀÍÝáÀÃÄÁÉÓ ÒÄÂÉÓÔÒÀÝÉÀ ÌÏÌÆÀÃÄÁÉÓ ÈÀÒÉÙÉ';

test('legacy-font Georgian decodes to Unicode; real Latin-1 and real Georgian are untouched', () => {
  assert.equal(decodeLegacyGeorgian(REAL), 'მიწის (უძრავი ქონების) საკადასტრო კოდი N 01.15.01.004.070 ამონაწერი საჯარო რეესტრიდან განცხადების რეგისტრაცია მომზადების თარიღი');
  for (const keep of ['Café à la crème, Société Générale, Zürich', 'მიწის ნაკვეთი 01.15.01.004.070', 'Ò', '']) assert.equal(decodeLegacyGeorgian(keep), keep);
  assert.equal(looksLegacyGeorgian(REAL), true);
});

test('every document is decoded before it is stored or sent', async () => {
  const stored = [];
  const r = await compactResult({ documents: [{ id: 'a', rawText: REAL.repeat(400) }] }, async (sha, ct, body) => { stored.push(body); return `p/${sha}`; });
  assert.match(r.result.documents[0].rawText, /^მიწის \(უძრავი ქონების\)/);
  assert.ok(stored.every((b) => !b.includes('ÌÉßÉÓ')), 'the stored full text is decoded too');
});

test('the research-side copy uses the same table', () => {
  const a = readFileSync(new URL('../src/documents/legacyGeorgian.ts', import.meta.url), 'utf8').match(/const LEGACY = '([^']+)'/)[1];
  const b = readFileSync(new URL('../../src/verify/legacyGeorgian.ts', import.meta.url), 'utf8').match(/const LEGACY = '([^']+)'/)[1];
  assert.equal(a, b);
  assert.equal([...a].length, 37);
});
