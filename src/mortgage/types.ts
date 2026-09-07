// src/mortgage/types.ts — normalized shapes for the Mortgage/Home-Financing
// feature. Deliberately plain TypeScript (no React, no Deno-only APIs) so
// these types — and the calculation modules built on top of them — can be
// imported both by the Vite/React frontend AND directly by Node's native
// test runner (Node 22's built-in TypeScript type-stripping), the same way
// official-worker's real .ts modules are unit-tested, rather than the
// "copy the logic verbatim into the test file" fallback this repo uses only
// for Deno-edge-function code it genuinely cannot import (see
// src/services/__tests__/*.test.mjs headers for that pattern and why it
// exists — it does not apply here).
//
// ACCURACY LABELS (mandate requirement): every numeric value that reaches
// the UI must be traceable to exactly one of these origins. `ValueOrigin`
// is threaded through the calculation outputs precisely so the UI can
// render the right label and never present, say, a USER_PROVIDED bank fee
// as if it were a CALCULATED one.
export type ValueOrigin = 'ESTIMATE' | 'USER_PROVIDED' | 'CALCULATED' | 'OFFICIAL_RULE' | 'AI_EXPLANATION';

export type RateType = 'FIXED' | 'VARIABLE' | 'INDEXED';
export type PaymentFrequency = 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';

// ─── Core scenario input/output ─────────────────────────────────────────

/** Everything a user can enter, from the 6-field initial screen through
 * every field behind "I know more details about my bank offer". Every
 * field beyond the first six is optional — the calculator must produce a
 * useful, honestly-labeled result from the minimal screen alone, and must
 * never fabricate a value for a field the user did not supply (e.g. it
 * must never invent an effective rate — see calculations/effectiveRate.ts). */
export interface MortgageInput {
  // Initial screen (mandatory)
  propertyPrice: number;
  propertyCurrency: string; // ISO-ish currency code as the app already uses it (e.g. "USD","GEL")
  downPayment: number; // absolute amount, same currency as propertyPrice
  termMonths: number;
  nominalAnnualRatePercent: number;

  // "I know more details about my bank offer" (all optional)
  effectiveAnnualRatePercentFromBank?: number; // as SUPPLIED by the bank/user — never computed and relabeled as this
  originationFeePercent?: number; // one-time, % of loan amount
  originationFeeFlat?: number; // one-time, flat amount
  monthlyFeeFlat?: number;
  annualFeeFlat?: number;
  valuationFeeFlat?: number; // one-time
  mandatoryInsuranceAnnualFlat?: number; // recurring annual
  otherMandatoryOneTimeCosts?: number;
  otherMandatoryRecurringMonthlyCosts?: number;
  gracePeriodMonths?: number; // interest-only or no-payment period at the start
  paymentFrequency?: PaymentFrequency; // defaults to MONTHLY
  rateType?: RateType; // defaults to FIXED when unspecified — UI must say so explicitly, never imply certainty
  indexOrReferenceName?: string; // only meaningful when rateType is VARIABLE or INDEXED

  // Property/context integration
  propertyId?: string;
  propertyPriceSnapshotAt?: string; // ISO timestamp — when propertyPrice was captured from the property record
}

export interface AmortizationRow {
  month: number;
  openingPrincipal: number;
  principalPortion: number;
  interestPortion: number;
  recurringKnownCosts: number; // monthly fee + amortized annual fee/insurance portion actually due this month
  totalPayment: number;
  remainingPrincipal: number;
}

/** The deterministic result of running MortgageInput through
 * calculations/amortization.ts. Every numeric field here is CALCULATED —
 * never touched or "improved" by AI. */
export interface MortgageCalculationResult {
  loanAmount: number;
  downPaymentPercent: number;
  monthlyPayment: number; // for the first post-grace-period regular month, under the nominal rate
  totalPrincipal: number;
  totalInterest: number;
  totalKnownFees: number; // sum of all one-time + recurring known costs entered
  totalRepayment: number; // totalPrincipal + totalInterest + totalKnownFees
  effectiveAnnualRatePercent: number | null; // CALCULATED only when inputs/methodology are sufficient (see effectiveRate.ts); null + reason otherwise
  effectiveRateUnavailableReason: string | null; // i18n key naming why, when effectiveAnnualRatePercent is null
  ltvPercent: number | null; // loanAmount / propertyPrice * 100
  amortizationSchedule: AmortizationRow[];
  currency: string;
}

// ─── Term comparison ─────────────────────────────────────────────────────

export interface TermComparisonRow {
  termMonths: number;
  isSelected: boolean;
  monthlyPayment: number;
  totalRepayment: number;
  totalInterest: number;
  monthlyPaymentDeltaVsSelected: number;
  totalCostDeltaVsSelected: number;
}

// ─── Affordability (PTI/LTV) ─────────────────────────────────────────────

export interface AffordabilityInput {
  monthlyNetIncome: number;
  incomeCurrency: string;
  existingMonthlyDebtObligations?: number;
}

export interface AffordabilityResult {
  ptiPercent: number; // (monthlyPayment + existingMonthlyDebtObligations) / monthlyNetIncome * 100
  ltvPercent: number | null;
  ptiWithinPublishedLimit: boolean | null; // null when no active rule matched the currency/income tier
  ltvWithinPublishedLimit: boolean | null;
  matchedPtiRuleId: string | null;
  matchedLtvRuleId: string | null;
}

// ─── Early repayment / refinancing ───────────────────────────────────────

export interface EarlyRepaymentInput {
  extraPaymentAmount: number;
  extraPaymentMonth: number; // 1-indexed month at which the extra payment is applied
  recurringMonthlyExtra?: number; // optional additional recurring extra payment from that month onward
  /** true only when the user has actually confirmed a bank-stated early-repayment fee/limit; when absent, the
   * result must say the fee is not included rather than assuming zero. */
  knownEarlyRepaymentFeeFlat?: number;
}

export interface EarlyRepaymentResult {
  newPayoffMonth: number;
  monthsSaved: number;
  interestSaved: number;
  totalCostWithExtra: number;
  earlyRepaymentFeeIncluded: boolean;
}

export interface RefinancingInput {
  currentRemainingPrincipal: number;
  currentRemainingTermMonths: number;
  currentNominalAnnualRatePercent: number;
  newNominalAnnualRatePercent: number;
  newTermMonths: number;
  refinancingFeesFlat: number;
}

export interface RefinancingResult {
  currentRemainingTotalCost: number;
  newTotalCost: number; // new loan's totalRepayment + refinancingFeesFlat
  lifetimeSavings: number; // currentRemainingTotalCost - newTotalCost, can be negative
  monthlyPaymentBefore: number;
  monthlyPaymentAfter: number;
  breakEvenMonths: number | null; // null when there's no monthly saving to break even against
}

// ─── Bank offers & comparison ────────────────────────────────────────────

export type OfferSource = 'USER_UPLOADED' | 'USER_MANUAL_ENTRY' | 'BANK_PUBLISHED';

export interface MortgageOffer {
  id?: string;
  offerName: string; // bank/offer label the user gave it
  source: OfferSource;
  loanAmount: number;
  currency: string;
  termMonths: number;
  nominalAnnualRatePercent: number;
  effectiveAnnualRatePercent?: number | null; // only ever a value the bank/user actually supplied — never invented
  originationFeePercent?: number;
  originationFeeFlat?: number;
  recurringMonthlyFeeFlat?: number;
  mandatoryInsuranceAnnualFlat?: number;
  otherMandatoryOneTimeCosts?: number;
  rateType?: RateType;
  // Extraction provenance — only present for OfferSource === 'USER_UPLOADED'
  extraction?: {
    documentAssetId: string;
    fieldConfidence: Partial<Record<keyof MortgageOffer, 'HIGH' | 'MEDIUM' | 'LOW'>>;
    confirmedByUser: boolean;
    sourcePages?: number[];
  };
}

export interface OfferComparisonRow {
  offer: MortgageOffer;
  monthlyPayment: number;
  initialCosts: number;
  recurringMonthlyCosts: number;
  totalRepayment: number;
  totalFinancingCost: number;
  effectiveAnnualRatePercent: number | null;
  effectiveRateSource: 'BANK_SUPPLIED' | 'CALCULATED' | 'UNAVAILABLE';
  labels: string[]; // i18n keys such as 'mortgage_offer_label_cheaper_under_assumptions', never a raw "best bank" claim
}

export interface OfferComparisonResult {
  rows: OfferComparisonRow[];
  assumptionsComparable: boolean; // false when currency/term differ across offers in a way that makes totals not directly comparable
  incomparabilityReasons: string[]; // i18n keys explaining why, when assumptionsComparable is false
}

// ─── Versioned Mortgage Knowledge Base ───────────────────────────────────

export type MortgageRuleStatus = 'CANDIDATE' | 'ACTIVE' | 'SUPERSEDED' | 'REJECTED';
export type MortgageRuleType = 'PTI_LIMIT' | 'LTV_LIMIT' | 'EFFECTIVE_RATE_METHODOLOGY' | 'DEFINITION' | 'SUBSIDY_PROGRAM' | 'FOREIGN_BUYER_BANK_RULE' | 'CLOSING_COST';

/** One row of the mortgage_rules table (see supabase migration). `data` is
 * the structured, machine-evaluable payload whose shape depends on `type`
 * (see the RuleData* interfaces below) — kept as a typed union at the
 * point of use, stored as jsonb in Postgres. */
export interface MortgageRule<TData = unknown> {
  id: string;
  type: MortgageRuleType;
  title: string;
  data: TData;
  humanExplanation: string; // plain-language explanation, per-locale key or already-localized string depending on caller
  officialSourceUrl: string;
  sourceAuthority: string; // e.g. "National Bank of Georgia", "Matsne / Legislative Herald of Georgia"
  effectiveFrom: string | null; // ISO date; null when the source does not state one
  effectiveTo: string | null;
  lastVerifiedAt: string; // ISO date — when a human/process last confirmed this against the live source
  status: MortgageRuleStatus;
  version: number;
  supersedesRuleId: string | null;
  country: string; // ISO 3166-1 alpha-2, e.g. "GE"
  currency: string | null; // null when the rule applies regardless of currency
  eligibilityDimensions: Record<string, unknown> | null; // free-form structured eligibility filter (income tier, nationality, residency, etc.)
  createdAt: string;
}

export interface PtiLimitRuleData {
  incomeTierMaxMonthlyNet: number | null; // null means "and above" (the top, unbounded tier)
  currencyClass: 'LOCAL' | 'FOREIGN'; // loan/income currency class this tier applies to
  maxPtiPercent: number;
}

export interface LtvLimitRuleData {
  currencyClass: 'LOCAL' | 'FOREIGN';
  maxLtvPercent: number;
  propertyUse?: 'RESIDENTIAL' | 'COMMERCIAL' | 'LAND' | 'AGRICULTURAL';
}

export interface SubsidyProgramRuleData {
  programName: string;
  administrator: string;
  maxLoanAmount: number | null;
  currency: string;
  eligibilityCriteria: { key: string; description: string }[];
  subsidyDescription: string;
  durationMonths: number | null;
  citizenshipRequired: boolean;
}

// ─── Saved scenarios ──────────────────────────────────────────────────────

export interface MortgageScenario {
  id: string;
  userId: string;
  propertyId?: string | null;
  input: MortgageInput;
  result: MortgageCalculationResult;
  affordability?: AffordabilityResult | null;
  ruleVersionIds: string[]; // mortgage_rules.id values actually consulted for this calculation
  offerRefs?: string[]; // mortgage_offers.id values included, if any
  calculatedAt: string;
  version: number; // this scenario's own version — a "Recalculate" produces a NEW MortgageScenario row, never mutates this one
  supersedesScenarioId: string | null;
  label?: string | null;
}

// ─── Foreign / non-resident context ───────────────────────────────────────

export interface ForeignBuyerContext {
  nationality?: string;
  countryOfResidence?: string;
  residenceStatus?: string;
  incomeCountry?: string;
  incomeCurrency?: string;
  incomeType?: 'EMPLOYMENT' | 'SELF_EMPLOYED' | 'BUSINESS_OWNER' | 'OTHER';
  loanCurrency?: string;
  downPaymentFundsOrigin?: string;
}
