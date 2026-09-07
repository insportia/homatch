// src/mortgage/calculations/affordability.ts — DETERMINISTIC MATH ONLY.
//
// Computes PTI/LTV from a MortgageCalculationResult and, when ACTIVE rule
// rows are supplied, says whether the scenario is within the currently
// published limit. It NEVER says "you will be approved" — only whether the
// entered numbers fall within a currently published general limit; actual
// approval is always a bank underwriting decision (see the mandate's own
// wording, mirrored in mortgage_affordability_disclaimer's i18n string).
import type { AffordabilityInput, AffordabilityResult, MortgageCalculationResult, MortgageRule, LtvLimitRuleData, PtiLimitRuleData } from '../types';
import { roundCurrency } from './amortization.ts';
import { classifyCurrency, selectActiveLtvRule, selectActivePtiRule } from '../rules/ptiLtv.ts';

export function computeAffordability(
  result: MortgageCalculationResult,
  affordability: AffordabilityInput,
  loanCurrency: string,
  ptiRules: MortgageRule<PtiLimitRuleData>[],
  ltvRules: MortgageRule<LtvLimitRuleData>[]
): AffordabilityResult {
  const monthlyObligation = roundCurrency(result.monthlyPayment + (affordability.existingMonthlyDebtObligations ?? 0));
  const ptiPercent = affordability.monthlyNetIncome > 0
    ? roundCurrency((monthlyObligation / affordability.monthlyNetIncome) * 100)
    : 0;

  const currencyClass = classifyCurrency(loanCurrency);
  const ptiRule = selectActivePtiRule(ptiRules, affordability.monthlyNetIncome, currencyClass);
  const ltvRule = selectActiveLtvRule(ltvRules, currencyClass);

  return {
    ptiPercent,
    ltvPercent: result.ltvPercent,
    ptiWithinPublishedLimit: ptiRule ? ptiPercent <= ptiRule.data.maxPtiPercent : null,
    ltvWithinPublishedLimit: ltvRule && result.ltvPercent !== null ? result.ltvPercent <= ltvRule.data.maxLtvPercent : null,
    matchedPtiRuleId: ptiRule?.id ?? null,
    matchedLtvRuleId: ltvRule?.id ?? null,
  };
}
