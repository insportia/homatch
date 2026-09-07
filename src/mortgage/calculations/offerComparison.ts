// src/mortgage/calculations/offerComparison.ts — DETERMINISTIC MATH ONLY.
//
// Normalizes 2-3 MortgageOffer entries into comparable monetary figures.
// NEVER ranks by nominal rate alone (mandate requirement) and never
// declares one offer "the best bank" — every generated label is a
// specific, defensible comparison ("lower monthly payment", "lower total
// cost under these assumptions", "more predictable rate"), and when the
// offers' currency or term differ, the result says so explicitly instead
// of pretending the totals are directly comparable.
import type { MortgageOffer, OfferComparisonResult, OfferComparisonRow } from '../types';
import { buildAmortizationSchedule, computeMonthlyPayment, roundCurrency } from './amortization.ts';
import { annualizeFromSchedule } from './effectiveRate.ts';

function initialCosts(offer: MortgageOffer): number {
  const originationFromPercent = ((offer.originationFeePercent ?? 0) / 100) * offer.loanAmount;
  return roundCurrency(originationFromPercent + (offer.originationFeeFlat ?? 0) + (offer.otherMandatoryOneTimeCosts ?? 0));
}

function recurringMonthlyCosts(offer: MortgageOffer): number {
  return roundCurrency((offer.recurringMonthlyFeeFlat ?? 0) + (offer.mandatoryInsuranceAnnualFlat ?? 0) / 12);
}

function evaluateOffer(offer: MortgageOffer): OfferComparisonRow {
  const schedule = buildAmortizationSchedule({
    principal: offer.loanAmount,
    annualRatePercent: offer.nominalAnnualRatePercent,
    termMonths: offer.termMonths,
    monthlyFeeFlat: offer.recurringMonthlyFeeFlat ?? 0,
    mandatoryInsuranceAnnualFlat: offer.mandatoryInsuranceAnnualFlat ?? 0,
  });
  const monthlyPayment = computeMonthlyPayment(offer.loanAmount, offer.nominalAnnualRatePercent, offer.termMonths);
  const totalInterest = roundCurrency(schedule.reduce((s, r) => s + r.interestPortion, 0));
  const totalRecurring = roundCurrency(schedule.reduce((s, r) => s + r.recurringKnownCosts, 0));
  const oneTime = initialCosts(offer);
  const totalRepayment = roundCurrency(offer.loanAmount + totalInterest + totalRecurring + oneTime);
  const totalFinancingCost = roundCurrency(totalRepayment - offer.loanAmount);

  let effectiveAnnualRatePercent: number | null;
  let effectiveRateSource: OfferComparisonRow['effectiveRateSource'];
  if (typeof offer.effectiveAnnualRatePercent === 'number' && Number.isFinite(offer.effectiveAnnualRatePercent)) {
    effectiveAnnualRatePercent = offer.effectiveAnnualRatePercent;
    effectiveRateSource = 'BANK_SUPPLIED';
  } else {
    const netProceeds = roundCurrency(offer.loanAmount - oneTime);
    const calculated = netProceeds > 0 ? annualizeFromSchedule(netProceeds, schedule) : null;
    effectiveAnnualRatePercent = calculated;
    effectiveRateSource = calculated === null ? 'UNAVAILABLE' : 'CALCULATED';
  }

  return {
    offer,
    monthlyPayment,
    initialCosts: oneTime,
    recurringMonthlyCosts: recurringMonthlyCosts(offer),
    totalRepayment,
    totalFinancingCost,
    effectiveAnnualRatePercent,
    effectiveRateSource,
    labels: [],
  };
}

export function compareOffers(offers: MortgageOffer[]): OfferComparisonResult {
  if (offers.length < 2) throw new Error('compareOffers requires at least 2 offers');
  if (offers.length > 3) throw new Error('compareOffers supports at most 3 offers');

  const rows = offers.map(evaluateOffer);

  const currencies = new Set(offers.map(o => o.currency));
  const terms = new Set(offers.map(o => o.termMonths));
  const assumptionsComparable = currencies.size === 1 && terms.size === 1;
  const incomparabilityReasons: string[] = [];
  if (currencies.size > 1) incomparabilityReasons.push('mortgage_offer_incomparable_currency');
  if (terms.size > 1) incomparabilityReasons.push('mortgage_offer_incomparable_term');

  const lowestMonthly = Math.min(...rows.map(r => r.monthlyPayment));
  const lowestTotal = assumptionsComparable ? Math.min(...rows.map(r => r.totalRepayment)) : null;

  for (const row of rows) {
    if (row.monthlyPayment === lowestMonthly) row.labels.push('mortgage_offer_label_lower_monthly_payment');
    if (assumptionsComparable && lowestTotal !== null && row.totalRepayment === lowestTotal) row.labels.push('mortgage_offer_label_cheaper_under_assumptions');
    if (row.offer.rateType === 'FIXED') row.labels.push('mortgage_offer_label_more_predictable_rate');
    if (!row.labels.length) row.labels.push('mortgage_offer_label_other_tradeoffs');
  }

  return { rows, assumptionsComparable, incomparabilityReasons };
}
