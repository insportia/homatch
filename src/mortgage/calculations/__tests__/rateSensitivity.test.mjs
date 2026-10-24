import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rateSensitivity } from '../rateSensitivity.ts';
import { calculateMortgage } from '../amortization.ts';

const input = { propertyPrice: 200000, propertyCurrency: 'GEL', downPayment: 40000, termMonths: 240, nominalAnnualRatePercent: 11 };

test('each row is the same loan at a moved rate, through the same engine', () => {
  const base = calculateMortgage(input);
  const rows = rateSensitivity(input);
  assert.deepEqual(rows.map((r) => r.deltaPoints), [-2, -1, 1, 2]);
  for (const r of rows) {
    const direct = calculateMortgage({ ...input, nominalAnnualRatePercent: r.ratePercent });
    assert.equal(r.monthlyPayment, direct.monthlyPayment);
    assert.equal(r.totalInterest, direct.totalInterest);
    assert.ok(Math.abs(r.monthlyChange - (direct.monthlyPayment - base.monthlyPayment)) < 0.01);
  }
  assert.ok(rows[0].monthlyPayment < base.monthlyPayment && rows[3].monthlyPayment > base.monthlyPayment, 'lower rate, lower payment');
});

test('a rate at or below zero is left out, never invented', () => {
  const rows = rateSensitivity({ ...input, nominalAnnualRatePercent: 1 });
  assert.deepEqual(rows.map((r) => r.deltaPoints), [1, 2]);
});
