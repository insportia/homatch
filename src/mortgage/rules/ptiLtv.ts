// src/mortgage/rules/ptiLtv.ts — pure rule-selection logic over whatever
// ACTIVE PTI/LTV rule rows the caller loaded from the mortgage_rules
// knowledge-base table (see src/mortgage/knowledge/mortgageKnowledgeApi.ts
// for the actual Supabase fetch). Deliberately takes rule ROWS as a plain
// argument rather than fetching them itself, so this file has zero
// Supabase/network dependency and can be unit-tested directly — and so the
// numeric limits themselves NEVER appear as constants in this file or
// anywhere in the UI, per the mandate: "CURRENT Georgian PTI/LTV
// regulatory limits must come from versioned official data, not permanent
// UI constants."
import type { LtvLimitRuleData, MortgageRule, PtiLimitRuleData } from '../types';

export type CurrencyClass = 'LOCAL' | 'FOREIGN';

/** GEL is the only currency this project currently treats as LOCAL for
 * Georgian PTI/LTV purposes — every other currency (USD, EUR, ...) is a
 * FOREIGN-currency loan/income under the National Bank of Georgia's own
 * framing (its published tiers are explicitly "GEL loans" vs "foreign
 * currency loans"). This one mapping is a currency-code classification,
 * not a numeric regulatory limit, so it is not itself something that
 * needs to live in the versioned knowledge base — but it is intentionally
 * isolated here, in one place, rather than repeated inline wherever a
 * currency class is needed. */
export function classifyCurrency(currencyCode: string | undefined | null): CurrencyClass {
  return (currencyCode ?? '').toUpperCase() === 'GEL' ? 'LOCAL' : 'FOREIGN';
}

function isActive(rule: MortgageRule<unknown>): boolean {
  return rule.status === 'ACTIVE';
}

/** Selects the single ACTIVE PTI rule row whose income tier and currency
 * class match, preferring the narrowest (lowest, non-null) income ceiling
 * that still covers the borrower's income — i.e. the tier boundaries are
 * read as "up to and including this ceiling", falling through to the
 * unbounded (ceiling === null) tier when the borrower's income exceeds
 * every bounded tier. Returns null when no ACTIVE rule matches at all
 * (never a fabricated fallback number) — the caller must then say the
 * limit "cannot currently be confirmed", never assume one. */
export function selectActivePtiRule(rules: MortgageRule<PtiLimitRuleData>[], monthlyNetIncome: number, currencyClass: CurrencyClass): MortgageRule<PtiLimitRuleData> | null {
  const candidates = rules.filter(r => isActive(r) && r.type === 'PTI_LIMIT' && r.data.currencyClass === currencyClass);
  const bounded = candidates
    .filter(r => r.data.incomeTierMaxMonthlyNet !== null && monthlyNetIncome <= (r.data.incomeTierMaxMonthlyNet as number))
    .sort((a, b) => (a.data.incomeTierMaxMonthlyNet as number) - (b.data.incomeTierMaxMonthlyNet as number));
  if (bounded.length) return bounded[0];
  const unbounded = candidates.find(r => r.data.incomeTierMaxMonthlyNet === null);
  return unbounded ?? null;
}

/** Selects the single ACTIVE LTV rule row for the given currency class
 * (and property use, when the KB carries that dimension — currently
 * Georgia's published LTV rule differentiates only by currency, not
 * property use, so most rows will have propertyUse undefined and match
 * any use). Returns null when nothing matches. */
export function selectActiveLtvRule(rules: MortgageRule<LtvLimitRuleData>[], currencyClass: CurrencyClass, propertyUse?: LtvLimitRuleData['propertyUse']): MortgageRule<LtvLimitRuleData> | null {
  const candidates = rules.filter(r => isActive(r) && r.type === 'LTV_LIMIT' && r.data.currencyClass === currencyClass);
  const specific = propertyUse ? candidates.find(r => r.data.propertyUse === propertyUse) : undefined;
  return specific ?? candidates.find(r => !r.data.propertyUse) ?? candidates[0] ?? null;
}
