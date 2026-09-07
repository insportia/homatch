// src/mortgage/calculations/effectiveRate.ts — DETERMINISTIC MATH ONLY.
//
// IMPORTANT HONESTY NOTE (read before changing this file): the National
// Bank of Georgia publishes a "Loan Effective Interest Rate Calculator"
// (https://nbg.gov.ge/en/calculators?calculator=loaneffectiveinterest)
// whose INPUT fields we mirror closely (nominal rate, grace period,
// one-time costs at issuance, periodic costs, payment frequency, issuance/
// payment dates) — but its underlying formula/legal methodology document
// was not recoverable from the page content this project could actually
// fetch. Rather than guess at an undisclosed regulator formula and label
// the result "the NBG official effective rate" (which would violate this
// project's own "NO CURRENT VERIFIED SOURCE = NO CURRENT FACT" rule), this
// module computes the effective annual rate using the standard, widely
// documented actuarial/IRR method (the same family of calculation behind
// EU Annual Percentage Rate rules and most consumer-credit regulators
// worldwide: find the discount rate that sets the net present value of the
// borrower's actual cash flows — amount received vs. every payment made —
// to zero). The result is always labeled CALCULATED (an estimate using a
// standard methodology), and is explicitly distinguished in the UI from
// `effectiveAnnualRatePercentFromBank`, which is the authoritative,
// bank-stated figure whenever the user has it — see
// src/mortgage/types.ts's ValueOrigin and MortgageOffer.effectiveAnnualRatePercent
// comments. Never relabel this CALCULATED estimate as an official/regulatory
// number.
import type { AmortizationRow, MortgageInput } from '../types';
import { buildAmortizationSchedule, computeLoanAmount, roundCurrency } from './amortization.ts';

export interface EffectiveRateResult {
  effectiveAnnualRatePercent: number | null;
  unavailableReasonKey: string | null;
  methodologyKey: 'IRR_CASH_FLOW_ESTIMATE'; // always this today — kept as a union of one so a future, source-confirmed NBG methodology can be added without changing every call site
}

const MAX_ITERATIONS = 200;
const TOLERANCE = 1e-8;

/** Net present value of the borrower's cash flows at monthly rate `i`:
 * positive `netProceeds` at t=0, then one outflow per schedule row. */
function npv(i: number, netProceeds: number, schedule: AmortizationRow[]): number {
  let value = netProceeds;
  for (const row of schedule) {
    value -= row.totalPayment / Math.pow(1 + i, row.month);
  }
  return value;
}

/** Solves NPV(i) = 0 for the monthly rate `i` via bisection — deterministic,
 * always converges for this cash-flow shape (net proceeds at t=0, only
 * outflows after) because NPV(i) is strictly increasing in i whenever the
 * borrower's total nominal outflows exceed what they actually received,
 * which holds for any loan with a positive interest rate and/or fees.
 * Returns null when there is nothing to solve for (see callers). */
function solveMonthlyIrr(netProceeds: number, schedule: AmortizationRow[]): number | null {
  if (netProceeds <= 0 || schedule.length === 0) return null;
  let lo = -0.9; // a monthly rate can't sensibly go below -90%
  let hi = 5; // 500%/month upper bound — far beyond any realistic mortgage, just a safe search ceiling
  const npvLo = npv(lo, netProceeds, schedule);
  const npvHi = npv(hi, netProceeds, schedule);
  // If NPV doesn't change sign across this (very wide) bracket, the input
  // is degenerate (e.g. zero outflows) — refuse to guess rather than
  // return a meaningless root.
  if (npvLo * npvHi > 0) return null;

  let mid = 0;
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    mid = (lo + hi) / 2;
    const value = npv(mid, netProceeds, schedule);
    if (Math.abs(value) < TOLERANCE) return mid;
    const npvAtLo = npv(lo, netProceeds, schedule);
    if (npvAtLo * value < 0) hi = mid; else lo = mid;
  }
  return mid;
}

/** Computes the borrower's total upfront costs deducted from the amount
 * actually disbursed to them at t=0 — origination fee (flat + % of loan),
 * valuation fee, and other one-time mandatory costs. Recurring costs are
 * already folded into each schedule row's totalPayment by
 * buildAmortizationSchedule, so they are NOT added again here. */
function upfrontCosts(input: MortgageInput, loanAmount: number): number {
  const originationFromPercent = ((input.originationFeePercent ?? 0) / 100) * loanAmount;
  return roundCurrency(originationFromPercent + (input.originationFeeFlat ?? 0) + (input.valuationFeeFlat ?? 0) + (input.otherMandatoryOneTimeCosts ?? 0));
}

/** Shared building block: given the net amount actually disbursed at t=0
 * and the resulting payment schedule, returns the IRR-based effective
 * annual rate (percent) or null when it can't be solved. Exported so
 * offerComparison.ts can compute the same CALCULATED estimate for a bare
 * MortgageOffer (which has no MortgageInput to build a full scenario from)
 * without duplicating the bisection algorithm. */
export function annualizeFromSchedule(netProceeds: number, schedule: AmortizationRow[]): number | null {
  const monthlyIrr = solveMonthlyIrr(netProceeds, schedule);
  if (monthlyIrr === null) return null;
  const annualEffective = (Math.pow(1 + monthlyIrr, 12) - 1) * 100;
  // Same floating-point-noise tolerance as computeEffectiveRate below: a
  // legitimate zero-rate/zero-fee cash flow solves to an IRR of exactly 0
  // but bisection can land a hair below zero (e.g. -1e-11). Only a
  // materially negative result is treated as degenerate/unavailable.
  if (!Number.isFinite(annualEffective) || annualEffective < -1e-6) return null;
  return roundCurrency(Math.max(0, annualEffective));
}

/** Public entry point. Returns a CALCULATED effective annual rate
 * (compounded monthly-to-annual, expressed as a percent) whenever the
 * basic loan mechanics are present, or null with a reason key when there
 * is nothing meaningful to solve for (no financed amount, or a degenerate
 * cash-flow shape). Never returns a value when `computeLoanAmount(input)`
 * is 0 — an all-cash purchase has no effective borrowing rate at all. */
export function computeEffectiveRate(input: MortgageInput): EffectiveRateResult {
  const loanAmount = computeLoanAmount(input);
  if (loanAmount <= 0) {
    return { effectiveAnnualRatePercent: null, unavailableReasonKey: 'mortgage_effective_rate_unavailable_no_financing', methodologyKey: 'IRR_CASH_FLOW_ESTIMATE' };
  }

  const schedule = buildAmortizationSchedule({
    principal: loanAmount,
    annualRatePercent: input.nominalAnnualRatePercent,
    termMonths: input.termMonths,
    gracePeriodMonths: input.gracePeriodMonths,
    monthlyFeeFlat: input.monthlyFeeFlat,
    annualFeeFlat: input.annualFeeFlat,
    mandatoryInsuranceAnnualFlat: input.mandatoryInsuranceAnnualFlat,
    otherMandatoryRecurringMonthlyCosts: input.otherMandatoryRecurringMonthlyCosts,
  });
  if (!schedule.length) {
    return { effectiveAnnualRatePercent: null, unavailableReasonKey: 'mortgage_effective_rate_unavailable_no_schedule', methodologyKey: 'IRR_CASH_FLOW_ESTIMATE' };
  }

  const netProceeds = roundCurrency(loanAmount - upfrontCosts(input, loanAmount));
  const monthlyIrr = solveMonthlyIrr(netProceeds, schedule);
  if (monthlyIrr === null) {
    return { effectiveAnnualRatePercent: null, unavailableReasonKey: 'mortgage_effective_rate_unavailable_degenerate', methodologyKey: 'IRR_CASH_FLOW_ESTIMATE' };
  }

  // A zero-rate, zero-fee scenario legitimately solves to an IRR of
  // exactly 0, which can land a hair below zero from bisection/floating-
  // point noise (e.g. -1e-11) — clamp that noise to 0 rather than reject
  // it as "degenerate"; only a materially negative result (which should
  // never occur for a real loan's cash-flow shape) is treated as an error.
  const annualEffective = (Math.pow(1 + monthlyIrr, 12) - 1) * 100;
  if (!Number.isFinite(annualEffective) || annualEffective < -1e-6) {
    return { effectiveAnnualRatePercent: null, unavailableReasonKey: 'mortgage_effective_rate_unavailable_degenerate', methodologyKey: 'IRR_CASH_FLOW_ESTIMATE' };
  }
  return { effectiveAnnualRatePercent: roundCurrency(Math.max(0, annualEffective)), unavailableReasonKey: null, methodologyKey: 'IRR_CASH_FLOW_ESTIMATE' };
}
