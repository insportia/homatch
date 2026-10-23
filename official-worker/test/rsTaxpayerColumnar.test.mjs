// rsTaxpayerColumnar.test.mjs — RS.ge's real taxpayer-grid answer shape.
//
// Both fixtures are the exact bytes RS.ge returned in production on 2026-10-22
// (stored in verify-evidence as sha256 15ae5f8c… and fcd58cec…). RS.ge answers
// columnar — {Data: {Fields: [...], Rows: [[...]]}, Summary: {_Count}} — and the
// old parser, looking only for arrays of objects, read the first as UNPARSEABLE
// (NO_ROW_ARRAY) and let the page's empty grid turn the second into a false
// "no taxpayer record". Both are real, active, VAT-registered LLCs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  classifyRsGridResponse,
  pickRsRow,
  mapRsRow,
  rsIdMatches,
  rsRowMatchesId,
} from '../.tstest-build/workflows/financial/RsTaxpayerResponse.js';

const fixture = (name) => readFileSync(fileURLToPath(new URL(`./fixtures/rs/${name}`, import.meta.url)), 'utf8');
const capture = (body) => ({ status: 200, body, contentType: 'application/json', networkError: null });

for (const [file, tin, name] of [
  ['rs-columnar-405537441.json', '405537441', 'შპს ბიჩ ბილდინგ ბაგები'],
  ['rs-columnar-405456359.json', '405456359', 'შპს ამბრელა'],
]) {
  test(`columnar RS.ge answer for ${tin} is ACCEPTED with its one record`, () => {
    const cls = classifyRsGridResponse(capture(fixture(file)));
    assert.equal(cls.outcome, 'ACCEPTED');
    assert.equal(cls.format, 'JSON');
    assert.equal(cls.rows.length, 1);
    assert.equal(cls.total, 1);
    assert.ok(cls.columns.includes('FULL_NAME'));

    const row = pickRsRow(cls.rows, tin);
    assert.equal(rsRowMatchesId(row, tin), true);
    const d = mapRsRow(row, tin);
    assert.equal(d.taxpayerName, name);
    assert.equal(d.identificationCode, tin);
    assert.equal(d.legalForm, 'შპს');
    assert.equal(d.status, 'აქტიური');
    assert.equal(d.vatStatus, 'კი');
    // Lien / seizure registers stay visible, labelled as RS.ge named them.
    assert.equal(d.otherPublicFields.GIRAVNOBA, 'რეგისტრირებული არ არის');
    assert.equal(d.otherPublicFields.YADAGA, 'რეგისტრირებული არ არის');
    // The print-report cell is a link, not markup.
    assert.match(d.otherPublicFields.PDF, /^https:\/\/www\.rs\.ge\/RsGe\.Module\/TaxpayersRegistry\/PrintReport\?samForma=04&unID=\d+$/);
  });
}

test('the record for one identifier never confirms a different one', () => {
  const cls = classifyRsGridResponse(capture(fixture('rs-columnar-405537441.json')));
  const row = pickRsRow(cls.rows, '405456359');
  assert.equal(rsRowMatchesId(row, '405456359'), false);
  assert.notEqual(mapRsRow(row, '405456359').identificationCode, '405456359');
});

test('rsIdMatches: full digits or RS.ge mask of the same length and ends', () => {
  assert.equal(rsIdMatches('405537441', '405537441'), true);
  assert.equal(rsIdMatches('40*****41', '405537441'), true);
  assert.equal(rsIdMatches('40*****59', '405537441'), false);
  assert.equal(rsIdMatches('40****41', '405537441'), false);
  assert.equal(rsIdMatches('', '405537441'), false);
  assert.equal(rsIdMatches('40*****41', null), false);
});

test('a columnar answer with no rows is a valid empty answer', () => {
  const body = JSON.stringify({ Data: { Fields: ['INFO', 'FULL_NAME', 'SAID_KODI'], Rows: [] }, Summary: { _Count: 0 } });
  const cls = classifyRsGridResponse(capture(body));
  assert.equal(cls.outcome, 'NO_RESULT');
  assert.equal(cls.total, 0);
});

test('a row with no identifier column cannot be checked, and says so', () => {
  assert.equal(rsRowMatchesId({ FULL_NAME: 'შპს X', INFO: 'აქტიური' }, '405537441'), null);
});
