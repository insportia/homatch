import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareOffers } from '../offerComparison.ts';

function offer(overrides = {}) {
  return {
    offerName: 'Bank A', source: 'USER_MANUAL_ENTRY', loanAmount: 120000, currency: 'USD',
    termMonths: 240, nominalAnnualRatePercent: 10.5, rateType: 'FIXED', ...overrides,
  };
}

test('compareOffers: requires at least 2 and at most 3 offers', () => {
  assert.throws(() => compareOffers([offer()]));
  assert.throws(() => compareOffers([offer(), offer(), offer(), offer()]));
  assert.doesNotThrow(() => compareOffers([offer({ offerName: 'A' }), offer({ offerName: 'B' })]));
});

test('compareOffers: never ranks by nominal rate alone — a lower nominal rate with a large origination fee can end up MORE expensive overall, and the label reflects the real total, not the rate', () => {
  const cheapNominalHighFee = offer({ offerName: 'Low nominal, high fee', nominalAnnualRatePercent: 8, originationFeePercent: 8, termMonths: 12 });
  const higherNominalNoFee = offer({ offerName: 'Higher nominal, no fee', nominalAnnualRatePercent: 8.5, termMonths: 12 });
  const result = compareOffers([cheapNominalHighFee, higherNominalNoFee]);
  const cheapRow = result.rows.find(r => r.offer.offerName === 'Low nominal, high fee');
  const higherRow = result.rows.find(r => r.offer.offerName === 'Higher nominal, no fee');
  // Over a short 12-month term, an 8% up-front origination fee dwarfs the
  // 0.5-point rate difference — the lower-nominal offer should end up the
  // MORE expensive one on total cost, proving the comparison never just
  // follows the nominal rate.
  assert.ok(cheapRow.totalRepayment > higherRow.totalRepayment, 'the high-fee offer should be more expensive overall despite its lower nominal rate');
  assert.ok(higherRow.labels.includes('mortgage_offer_label_cheaper_under_assumptions'));
  assert.ok(!cheapRow.labels.includes('mortgage_offer_label_best_bank'));
  assert.ok(!higherRow.labels.includes('mortgage_offer_label_best_bank'));
});

test('compareOffers: bank-supplied effective rate is used verbatim; a calculated fallback is used only when the bank did not supply one', () => {
  const withBankRate = offer({ effectiveAnnualRatePercent: 11.2 });
  const withoutBankRate = offer({ offerName: 'No bank rate given' });
  const result = compareOffers([withBankRate, withoutBankRate]);
  const bankRow = result.rows.find(r => r.offer.offerName === 'Bank A');
  const calcRow = result.rows.find(r => r.offer.offerName === 'No bank rate given');
  assert.equal(bankRow.effectiveAnnualRatePercent, 11.2);
  assert.equal(bankRow.effectiveRateSource, 'BANK_SUPPLIED');
  assert.equal(calcRow.effectiveRateSource, 'CALCULATED');
  assert.ok(calcRow.effectiveAnnualRatePercent > 10.5);
});

test('compareOffers: flags currency/term mismatches as not directly comparable rather than pretending totals are equivalent', () => {
  const usdOffer = offer({ offerName: 'USD offer', currency: 'USD' });
  const gelOffer = offer({ offerName: 'GEL offer', currency: 'GEL' });
  const result = compareOffers([usdOffer, gelOffer]);
  assert.equal(result.assumptionsComparable, false);
  assert.ok(result.incomparabilityReasons.includes('mortgage_offer_incomparable_currency'));
});

test('compareOffers: a FIXED-rate offer is labeled more predictable relative to a VARIABLE one', () => {
  const fixed = offer({ offerName: 'Fixed', rateType: 'FIXED' });
  const variable = offer({ offerName: 'Variable', rateType: 'VARIABLE', nominalAnnualRatePercent: 9 });
  const result = compareOffers([fixed, variable]);
  const fixedRow = result.rows.find(r => r.offer.offerName === 'Fixed');
  assert.ok(fixedRow.labels.includes('mortgage_offer_label_more_predictable_rate'));
});

test('compareOffers: matching currency and term across all offers marks assumptions comparable', () => {
  const result = compareOffers([offer({ offerName: 'A' }), offer({ offerName: 'B', nominalAnnualRatePercent: 9 })]);
  assert.equal(result.assumptionsComparable, true);
  assert.equal(result.incomparabilityReasons.length, 0);
});
