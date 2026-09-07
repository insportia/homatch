// src/mortgage/calculations/termComparison.ts — DETERMINISTIC MATH ONLY.
import type { MortgageInput, TermComparisonRow } from '../types';
import { calculateMortgage, roundCurrency, validateMortgageInput } from './amortization.ts';

const STANDARD_TERM_YEARS = [10, 15, 20, 25, 30];

/** Candidate term set: the user's own selected term plus the standard
 * 10/15/20/25/30-year markers "around" it — never further than a
 * reasonable band so the comparison stays about THIS scenario, not every
 * possible term. Deduped and capped at 600 months (validateMortgageInput's
 * own ceiling), sorted ascending. */
export function candidateTermsMonths(selectedTermMonths: number): number[] {
  const selectedYears = selectedTermMonths / 12;
  const years = new Set<number>([selectedYears]);
  for (const y of STANDARD_TERM_YEARS) {
    if (Math.abs(y - selectedYears) <= 10) years.add(y);
  }
  return Array.from(years)
    .map(y => Math.round(y * 12))
    .filter(m => m > 0 && m <= 600)
    .sort((a, b) => a - b)
    .filter((m, i, arr) => arr.indexOf(m) === i);
}

/** Runs the SAME deterministic calculator across each candidate term and
 * reports the difference against the user's actually-selected term — never
 * a standalone "cheapest" ranking, since the mandate's own framing is
 * "shorter raises monthly burden but reduces lifetime interest", a
 * trade-off, not a winner. */
export function compareTerms(baseInput: MortgageInput): TermComparisonRow[] {
  const errors = validateMortgageInput(baseInput);
  if (errors.length) throw new Error(`compareTerms called with invalid base input: ${errors.map(e => e.messageKey).join(', ')}`);

  const selectedResult = calculateMortgage(baseInput);
  const terms = candidateTermsMonths(baseInput.termMonths);

  return terms.map(termMonths => {
    const isSelected = termMonths === baseInput.termMonths;
    const result = isSelected ? selectedResult : calculateMortgage({ ...baseInput, termMonths });
    return {
      termMonths,
      isSelected,
      monthlyPayment: result.monthlyPayment,
      totalRepayment: result.totalRepayment,
      totalInterest: result.totalInterest,
      monthlyPaymentDeltaVsSelected: roundCurrency(result.monthlyPayment - selectedResult.monthlyPayment),
      totalCostDeltaVsSelected: roundCurrency(result.totalRepayment - selectedResult.totalRepayment),
    };
  });
}
