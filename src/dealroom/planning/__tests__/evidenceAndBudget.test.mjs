import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeEvidence, canonicalizeValue, deriveState,
  toFindings, presentationOrder,
} from '../evidence.ts';
import { buildTotalBudget, displayTotal } from '../totalBudget.ts';

/* ------------------------------------------------------------------ *
 * SEMANTIC FACT DEDUPLICATION                                         *
 * ------------------------------------------------------------------ */

const claim = (over) => ({
  type: 'ownership.owner',
  subject: 'unit-601',
  value: 'შპს მილენიო გრუპი',
  source: 'enreg',
  documentRef: 'B24099518',
  ...over,
});

test('THE MANDATE EXAMPLE: one owner named by five documents becomes ONE fact', () => {
  const facts = normalizeEvidence([
    claim({ documentRef: 'd1' }),
    claim({ documentRef: 'd2' }),
    claim({ documentRef: 'd3', source: 'tas' }),
    claim({ documentRef: 'd4', source: 'TAS_MAP' }),
    claim({ documentRef: 'd5', source: 'tas' }),
  ]);
  assert.equal(facts.length, 1, 'five mentions, one fact');
  assert.equal(facts[0].evidence.length, 5, 'all five references are kept internally');
});

test('REPETITION IS NOT CORROBORATION — three mentions from one source is one source', () => {
  const facts = normalizeEvidence([
    claim({ documentRef: 'a' }),
    claim({ documentRef: 'b' }),
    claim({ documentRef: 'c' }),
  ]);
  assert.equal(facts[0].sourceCount, 1);
  assert.equal(facts[0].state, 'CONFIRMED', 'one source cannot corroborate itself');
});

test('two INDEPENDENT sources agreeing is CORROBORATED', () => {
  const facts = normalizeEvidence([claim({ source: 'enreg' }), claim({ source: 'tas' })]);
  assert.equal(facts[0].sourceCount, 2);
  assert.equal(facts[0].state, 'CORROBORATED');
});

test('equivalent phrasings of the same value merge', () => {
  const facts = normalizeEvidence([
    claim({ value: 'შპს მილენიო გრუპი' }),
    claim({ value: 'მილენიო  გრუპი', source: 'tas' }),
    claim({ value: '"მილენიო გრუპი"', source: 'TAS_MAP' }),
  ]);
  assert.equal(facts.length, 1, 'legal form, spacing and quotes are not real differences');
  assert.equal(facts[0].sourceCount, 3);
});

test('genuinely different values are NEVER merged — they conflict', () => {
  const facts = normalizeEvidence([
    claim({ value: 'შპს მილენიო გრუპი', source: 'enreg' }),
    claim({ value: 'შპს არტიტექსი', source: 'tas' }),
  ]);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].state, 'CONFLICTING');
  assert.equal(facts[0].conflicting.length, 1, 'the losing value is kept, not discarded');
});

test('a conflict keeps BOTH sides addressable', () => {
  const facts = normalizeEvidence([
    claim({ value: 'A', source: 'enreg', documentRef: 'x' }),
    claim({ value: 'B', source: 'tas', documentRef: 'y' }),
  ]);
  const all = [facts[0].value, ...facts[0].conflicting.map((c) => c.value)];
  assert.deepEqual(all.sort(), ['A', 'B']);
});

test('different subjects stay separate facts', () => {
  const facts = normalizeEvidence([
    claim({ subject: 'unit-601' }),
    claim({ subject: 'unit-602' }),
  ]);
  assert.equal(facts.length, 2);
});

test('NO EVIDENCE = NO FACT: a claim without a source is refused', () => {
  assert.deepEqual(normalizeEvidence([{ type: 'ownership.owner', value: 'X' }]), []);
  assert.deepEqual(normalizeEvidence([]), []);
});

test('an explicit negative ("not registered") is real evidence, not missing data', () => {
  const facts = normalizeEvidence([
    { type: 'encumbrance.seizure', value: false, negative: true, source: 'enreg', documentRef: 'B1' },
  ]);
  assert.equal(facts[0].negative, true);
  assert.equal(facts[0].state, 'CONFIRMED');
});

test('canonicalization ignores case, quotes, punctuation and legal form only', () => {
  assert.equal(canonicalizeValue('შპს "მილენიო გრუპი"'), canonicalizeValue('მილენიო გრუპი'));
  assert.equal(canonicalizeValue('Millennio Group LLC'), canonicalizeValue('millennio  group'));
  assert.notEqual(canonicalizeValue('მილენიო გრუპი'), canonicalizeValue('არტიტექსი'));
});

test('state derivation is explicit and testable', () => {
  assert.equal(deriveState(0, false), 'UNAVAILABLE');
  assert.equal(deriveState(1, false), 'CONFIRMED');
  assert.equal(deriveState(3, false), 'CORROBORATED');
  assert.equal(deriveState(2, true), 'CONFLICTING');
  assert.equal(deriveState(1, false, true), 'INFERRED');
});

test('conflicts are presented FIRST — a disagreement is the most useful thing to see', () => {
  const facts = normalizeEvidence([
    claim({ type: 'a', value: 'x', source: 's1' }),
    claim({ type: 'b', value: 'p', source: 's1' }),
    claim({ type: 'b', value: 'q', source: 's2' }),
  ]);
  assert.equal(presentationOrder(facts)[0].state, 'CONFLICTING');
});

test('facts bridge cleanly into the buyer-plan Finding shape', () => {
  const findings = toFindings(normalizeEvidence([claim({})]));
  assert.equal(findings[0].type, 'ownership.owner');
  assert.equal(findings[0].source, 'enreg');
  assert.equal(findings[0].state, 'CONFIRMED');
});

/* ------------------------------------------------------------------ *
 * TOTAL PROPERTY BUDGET                                               *
 * ------------------------------------------------------------------ */

const RENO = { planningBudget: 84000, currency: 'GEL', provisional: true };

test('only KNOWN amounts are summed; unknowns are listed, never guessed', () => {
  const b = buildTotalBudget({ currency: 'GEL', purchasePrice: 400000 });
  assert.equal(b.totalAcquisitionCost, 400000);
  assert.equal(b.unknowns.includes('რემონტის ბიუჯეტი'), true);
  assert.equal(b.lines.length, 1, 'nothing invented');
});

test('NO invented taxes or fees ever appear', () => {
  const b = buildTotalBudget({ currency: 'GEL', purchasePrice: 400000, renovation: RENO });
  const keys = b.lines.map((l) => l.key);
  for (const invented of ['tax', 'notary', 'agent', 'registration', 'insurance']) {
    assert.equal(keys.some((k) => k.includes(invented)), false, `${invented} must not be invented`);
  }
});

test('explicitly configured extras ARE included', () => {
  const b = buildTotalBudget({
    currency: 'GEL', purchasePrice: 400000,
    otherCosts: [{ key: 'notary', label: 'ნოტარიუსი', amount: 500 }],
  });
  assert.equal(b.totalAcquisitionCost, 400500);
  assert.equal(b.lines.find((l) => l.key === 'notary').origin, 'USER_ENTERED');
});

test('RENOVATION IS CASH unless a product actually finances it', () => {
  const withLoan = buildTotalBudget({
    currency: 'GEL', purchasePrice: 400000, renovation: RENO,
    mortgage: { purchasePrice: 400000, downPayment: 80000, loanAmount: 320000, monthlyPayment: 2400, currency: 'GEL' },
  });
  const reno = withLoan.lines.find((l) => l.key === 'renovation');
  assert.equal(reno.cash, true, 'renovation must not be assumed financed');
  // 484,000 total - 320,000 financed = 164,000 cash.
  assert.equal(withLoan.totalAcquisitionCost, 484000);
  assert.equal(withLoan.financed, 320000);
  assert.equal(withLoan.cashRequired, 164000);
});

test('a product that DOES finance renovation flips it out of cash', () => {
  const b = buildTotalBudget({
    currency: 'GEL', purchasePrice: 400000, renovation: RENO,
    mortgage: { purchasePrice: 400000, downPayment: 80000, loanAmount: 320000, monthlyPayment: 2400, currency: 'GEL', financesRenovation: true },
  });
  assert.equal(b.lines.find((l) => l.key === 'renovation').cash, false);
});

test('the monthly payment is carried through for the mortgage view', () => {
  const b = buildTotalBudget({
    currency: 'GEL', purchasePrice: 400000,
    mortgage: { purchasePrice: 400000, downPayment: 80000, loanAmount: 320000, monthlyPayment: 2400, currency: 'GEL' },
  });
  assert.equal(b.monthlyPayment, 2400);
});

test('a cross-currency amount with NO rate is refused, not guessed', () => {
  const b = buildTotalBudget({
    currency: 'USD', purchasePrice: 160000,
    renovation: { planningBudget: 84000, currency: 'GEL', provisional: true },
  });
  assert.equal(b.lines.some((l) => l.key === 'renovation'), false, 'no rate means no conversion');
  assert.equal(b.unknowns.some((u) => u.includes('კურსი')), true);
  assert.equal(b.totalAcquisitionCost, 160000, 'the unconvertible amount is excluded, not approximated');
});

test('a supplied rate converts correctly', () => {
  const b = buildTotalBudget({
    currency: 'USD', purchasePrice: 160000,
    renovation: { planningBudget: 84000, currency: 'GEL', provisional: true },
    usdPerGel: 0.37,
  });
  const reno = b.lines.find((l) => l.key === 'renovation');
  assert.equal(Math.abs(reno.amount - 84000 * 0.37) < 0.01, true);
});

test('a provisional renovation estimate marks the whole budget provisional', () => {
  const b = buildTotalBudget({ currency: 'GEL', purchasePrice: 400000, renovation: RENO });
  assert.equal(b.provisional, true);
  assert.equal(b.lines.find((l) => l.key === 'renovation').note, 'წინასწარი შეფასება');
});

test('customer-facing totals are rounded, never falsely precise', () => {
  const b = buildTotalBudget({ currency: 'GEL', purchasePrice: 400123, renovation: { planningBudget: 84567, currency: 'GEL', provisional: true } });
  const d = displayTotal(b);
  assert.equal(d.total % d.step, 0);
  assert.equal(d.cash % d.step, 0);
});

test('an empty budget degrades safely', () => {
  const b = buildTotalBudget({ currency: 'GEL' });
  assert.equal(b.totalAcquisitionCost, 0);
  assert.equal(b.cashRequired, 0);
  assert.equal(b.unknowns.length >= 2, true);
});
