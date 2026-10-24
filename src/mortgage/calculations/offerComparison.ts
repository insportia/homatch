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
  return roundCurrency(originationFromPercent + (offer.originationFeeFlat ?? 0) + (offer.otherMandatoryOneTimeCosts ?? 0) + (offer.appraisalFeeFlat ?? 0));
}

/** Percentage points the sensitivity check adds to the rate. */
export const RATE_SHOCK_PP = 2;

/** The first month in which the rate may change, or null when it is fixed for the whole term. */
export function rateCanChangeFrom(offer: MortgageOffer): number | null {
  const fixedFor = offer.fixedPeriodMonths ?? (offer.rateType === 'FIXED' ? offer.termMonths : 0);
  if (offer.rateType === 'FIXED' && fixedFor >= offer.termMonths) return null;
  if (!offer.rateType && offer.fixedPeriodMonths === undefined) return null;
  return Math.min(Math.max(0, fixedFor), offer.termMonths - 1) + 1;
}

/** The regular payment once the rate has risen by RATE_SHOCK_PP, re-amortised over the months left. */
function paymentAfterRise(offer: MortgageOffer, schedule: ReturnType<typeof buildAmortizationSchedule>, fromMonth: number | null): number | null {
  if (fromMonth === null) return null;
  const balance = fromMonth <= 1 ? offer.loanAmount : schedule[fromMonth - 2]?.remainingPrincipal ?? 0;
  const monthsLeft = offer.termMonths - fromMonth + 1;
  return monthsLeft > 0 ? computeMonthlyPayment(balance, offer.nominalAnnualRatePercent + RATE_SHOCK_PP, monthsLeft) : null;
}

function missingCosts(offer: MortgageOffer): string[] {
  const out: string[] = [];
  if (offer.originationFeePercent === undefined && offer.originationFeeFlat === undefined) out.push('mortgage_offer_missing_origination');
  if (offer.appraisalFeeFlat === undefined) out.push('mortgage_offer_missing_appraisal');
  if (offer.mandatoryInsuranceAnnualFlat === undefined) out.push('mortgage_offer_missing_insurance');
  if (offer.recurringMonthlyFeeFlat === undefined) out.push('mortgage_offer_missing_monthly_fee');
  return out;
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
    paymentAfterRateRise: paymentAfterRise(offer, schedule, rateCanChangeFrom(offer)),
    rateCanChangeFromMonth: rateCanChangeFrom(offer),
    missingCostKeys: missingCosts(offer),
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
    if (row.offer.rateType === 'FIXED' && row.rateCanChangeFromMonth === null) row.labels.push('mortgage_offer_label_more_predictable_rate');
    if (row.offer.rateType === 'FIXED' && row.rateCanChangeFromMonth !== null) row.labels.push('mortgage_offer_label_fixed_for_period');
    if (!row.labels.length) row.labels.push('mortgage_offer_label_other_tradeoffs');
  }

  return { rows, assumptionsComparable, incomparabilityReasons };
}
