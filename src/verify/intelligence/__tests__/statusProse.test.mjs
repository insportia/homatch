// The model (or the fallback) can never state a definitive status the
// deterministic layer marked provisional: the prose is withheld and the
// localized badge + caveats remain the only status line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withholdUnprovenStatement } from '../report.ts';

const cs = { statement: 'ნებართვა მოქმედებს.', items: [{ label: 'სართულები', value: '9', date: '2024-01-01', cites: ['E1'] }] };
const pkg = (conclusive) => ({ tas: { officialStatus: { state: 'PERMITTED', conclusive, caveats: conclusive ? [] : ['PROCESSING_INCOMPLETE'] } } });

test('provisional status: statement withheld, cited items kept', () => {
  const out = withholdUnprovenStatement(pkg(false), cs);
  assert.equal(out.statement, '');
  assert.equal(out.items.length, 1);
});

test('provisional status with no items: the block is dropped (badge stands alone)', () => {
  assert.equal(withholdUnprovenStatement(pkg(false), { statement: 'ნებართვა მოქმედებს.', items: [] }), undefined);
});

test('conclusive status and no TAS status: unchanged', () => {
  assert.deepEqual(withholdUnprovenStatement(pkg(true), cs), cs);
  assert.deepEqual(withholdUnprovenStatement({}, cs), cs);
});
