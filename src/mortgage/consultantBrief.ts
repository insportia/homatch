// HOMATCH MORTGAGE AI CONSULTANT — what the consultant is allowed to know.
//
// THE DIVISION OF LABOUR
//
//   NUMBERS COME FROM THE ENGINE. EXPLANATION COMES FROM THE MODEL.
//
// A language model asked "what if I put another 20,000 down?" will
// happily produce an amortisation figure, and it will be close, and
// close is worthless: somebody is deciding what to sign. So the
// consultant is never asked to compute. Before a question is sent, this
// module runs the SAME deterministic engines the page renders from —
// runFullMortgageCalculation, compareTerms, calculateEarlyRepayment,
// buildRateBreakdown, computeAffordability, compareOffers,
// calculateRefinancing — across the variations people actually ask
// about, and hands the results over as data. The model's job is to say
// which of those numbers answers the question and what it means.
//
// WHICH VARIATIONS, AND WHY THESE
//
// One per question in the brief that defined this product: a term
// ladder ("15 years instead of 20"), a down-payment ladder ("another
// 20,000 down"), a rate ladder ("is 11% much better than 13%"), and
// extra monthly payments ("an extra 500 a month"). Each is the existing
// engine called with a different input — not a second calculator, and
// not an approximation of one.
//
// WHAT IS DELIBERATELY ABSENT
//
// Anything not computed. When the brief cannot answer something —
// no income entered, no bank fees, no offers — it says so by name in
// `unknown`, so the consultant can ask for the missing input instead of
// inventing it. An empty field never becomes a zero here.
//
// No React, no network: a pure function of the scenario, so the tests
// import it directly.

import {
  calculateEarlyRepayment,
  calculateRefinancing,
  compareOffers,
  compareTerms,
  computeAffordability,
  runFullMortgageCalculation,
} from './calculations/index.ts';
import { buildRateBreakdown } from './calculations/rateBreakdown.ts';
import type {
  AffordabilityResult,
  LtvLimitRuleData,
  MortgageInput,
  MortgageOffer,
  MortgageRule,
  PtiLimitRuleData,
  SubsidyProgramRuleData,
} from './types.ts';

const money = (value: number): number => Math.round(value);
const pct = (value: number): number => Math.round(value * 100) / 100;

export interface BriefScenario {
  termMonths?: number;
  downPayment?: number;
  nominalAnnualRatePercent?: number;
  monthlyPayment: number;
  totalInterest: number;
  totalRepayment: number;
  loanAmount: number;
  downPaymentPercent?: number;
}

export interface ConsultantBrief {
  currency: string;
  /** What the person actually entered, as entered. */
  scenario: {
    propertyPrice: number;
    downPayment: number;
    downPaymentPercent: number;
    loanAmount: number;
    termMonths: number;
    nominalAnnualRatePercent: number;
    rateType: string | null;
    monthlyPayment: number;
    totalInterest: number;
    totalRepayment: number;
    effectiveAnnualRatePercent: number | null;
  };
  /** Same loan, different term. */
  ifTermWere: BriefScenario[];
  /** Same loan, different deposit. */
  ifDownPaymentWere: BriefScenario[];
  /** Same loan, different nominal rate. */
  ifRateWere: BriefScenario[];
  /** Paying more than the schedule asks, every month. */
  ifPaidExtraMonthly: Array<{
    extraMonthly: number;
    monthsSaved: number;
    interestSaved: number;
    payoffMonth: number;
    earlyRepaymentFeeIncluded: boolean;
  }>;
  /** Where the advertised rate and the real cost differ, and why. */
  realCost: {
    nominalAnnualRatePercent: number;
    effectiveAnnualRatePercent: number | null;
    gapPoints: number | null;
    components: Array<{ key: string; ratePoints: number; amount: number }>;
    costsNotEntered: string[];
  };
  affordability: {
    paymentToIncomePercent: number;
    officialPtiLimitPercent: number | null;
    loanToValuePercent: number | null;
    officialLtvLimitPercent: number | null;
    withinPti: boolean | null;
    withinLtv: boolean | null;
  } | null;
  offers: {
    count: number;
    assumptionsComparable: boolean;
    whyNotComparable: string[];
    rows: Array<{
      name: string;
      nominalAnnualRatePercent: number;
      effectiveAnnualRatePercent: number | null;
      monthlyPayment: number;
      initialCosts: number;
      totalFinancingCost: number;
    }>;
  } | null;
  refinancing: {
    monthlyPaymentBefore: number;
    monthlyPaymentAfter: number;
    lifetimeSavings: number;
    breakEvenMonths: number | null;
  } | null;
  programmes: Array<{
    name: string;
    maxLoanAmount: number | null;
    durationMonths: number | null;
    officialSourceUrl: string;
    lastVerifiedAt: string;
  }>;
  /** Named, so the consultant asks rather than assumes. */
  unknown: string[];
}

export interface BriefInputs {
  input: MortgageInput;
  offers: MortgageOffer[];
  monthlyNetIncome: number | null;
  existingMonthlyDebtObligations: number | null;
  ptiRules: MortgageRule<PtiLimitRuleData>[];
  ltvRules: MortgageRule<LtvLimitRuleData>[];
  /* The rows the page already selected for this scenario. Passed in
     rather than re-selected so the consultant quotes exactly the limit
     the screen is showing. */
  ptiRule: MortgageRule<PtiLimitRuleData> | null;
  ltvRule: MortgageRule<LtvLimitRuleData> | null;
  subsidyPrograms: MortgageRule<SubsidyProgramRuleData>[];
  ownLoan: {
    remainingPrincipal: number | null;
    remainingTermMonths: number | null;
    nominalRatePercent: number | null;
    newRatePercent: number | null;
    newTermMonths: number | null;
    feesFlat: number | null;
  };
}

/** One variation, run through the real engine. */
function variant(input: MortgageInput, patch: Partial<MortgageInput>): BriefScenario | null {
  try {
    const next = { ...input, ...patch };
    if (next.downPayment >= next.propertyPrice) return null;
    const r = runFullMortgageCalculation(next);
    return {
      ...(patch.termMonths !== undefined ? { termMonths: patch.termMonths } : {}),
      ...(patch.downPayment !== undefined
        ? { downPayment: money(patch.downPayment), downPaymentPercent: pct(r.downPaymentPercent) }
        : {}),
      ...(patch.nominalAnnualRatePercent !== undefined
        ? { nominalAnnualRatePercent: pct(patch.nominalAnnualRatePercent) }
        : {}),
      monthlyPayment: money(r.monthlyPayment),
      totalInterest: money(r.totalInterest),
      totalRepayment: money(r.totalRepayment),
      loanAmount: money(r.loanAmount),
    };
  } catch {
    return null;
  }
}

export function buildConsultantBrief(args: BriefInputs): ConsultantBrief | null {
  const { input } = args;
  let base;
  try {
    base = runFullMortgageCalculation(input);
  } catch {
    return null;
  }
  const breakdown = buildRateBreakdown(input);
  const unknown: string[] = [];

  /* ── The ladders ── */

  const terms = compareTerms(input)
    .map((row) => ({
      termMonths: row.termMonths,
      monthlyPayment: money(row.monthlyPayment),
      totalInterest: money(row.totalInterest),
      totalRepayment: money(row.totalRepayment),
      loanAmount: money(base.loanAmount),
    }))
    .slice(0, 6);

  const downPayments = [10, 20, 30, 40]
    .map((share) => variant(input, { downPayment: (input.propertyPrice * share) / 100 }))
    .filter((row): row is BriefScenario => row !== null);

  const rate = input.nominalAnnualRatePercent;
  const rates = [rate - 2, rate - 1, rate + 1, rate + 2]
    .filter((candidate) => candidate > 0)
    .map((candidate) => variant(input, { nominalAnnualRatePercent: candidate }))
    .filter((row): row is BriefScenario => row !== null);

  /* Extra monthly payments, as shares of the payment itself so the
     figures stay sensible in every currency. */
  const extras: ConsultantBrief['ifPaidExtraMonthly'] = [];
  for (const share of [0.1, 0.25, 0.5]) {
    const extraMonthly = Math.round(base.monthlyPayment * share);
    if (extraMonthly <= 0) continue;
    try {
      const r = calculateEarlyRepayment(input, {
        extraPaymentAmount: 0,
        extraPaymentMonth: 1,
        recurringMonthlyExtra: extraMonthly,
      });
      extras.push({
        extraMonthly,
        monthsSaved: r.monthsSaved,
        interestSaved: money(r.interestSaved),
        payoffMonth: r.newPayoffMonth,
        earlyRepaymentFeeIncluded: r.earlyRepaymentFeeIncluded,
      });
    } catch {
      /* A scenario the engine rejects is simply not offered. */
    }
  }
  if (extras.length && !extras[0].earlyRepaymentFeeIncluded) {
    unknown.push('early_repayment_fee');
  }

  /* ── Affordability ── */

  let affordability: ConsultantBrief['affordability'] = null;
  if (args.monthlyNetIncome !== null && args.monthlyNetIncome > 0) {
    try {
      const a: AffordabilityResult = computeAffordability(
        base,
        {
          monthlyNetIncome: args.monthlyNetIncome,
          incomeCurrency: input.propertyCurrency,
          ...(args.existingMonthlyDebtObligations !== null
            ? { existingMonthlyDebtObligations: args.existingMonthlyDebtObligations }
            : {}),
        },
        input.propertyCurrency,
        args.ptiRules,
        args.ltvRules,
      );
      affordability = {
        paymentToIncomePercent: pct(a.ptiPercent),
        officialPtiLimitPercent: args.ptiRule?.data.maxPtiPercent ?? null,
        loanToValuePercent: a.ltvPercent === null ? null : pct(a.ltvPercent),
        officialLtvLimitPercent: args.ltvRule?.data.maxLtvPercent ?? null,
        withinPti: a.ptiWithinPublishedLimit,
        withinLtv: a.ltvWithinPublishedLimit,
      };
    } catch {
      affordability = null;
    }
  } else {
    unknown.push('monthly_net_income');
  }

  /* ── Offers ── */

  let offers: ConsultantBrief['offers'] = null;
  if (args.offers.length >= 2 && args.offers.length <= 3) {
    try {
      const comparison = compareOffers(args.offers);
      offers = {
        count: comparison.rows.length,
        assumptionsComparable: comparison.assumptionsComparable,
        whyNotComparable: comparison.incomparabilityReasons,
        rows: comparison.rows.map((row) => ({
          name: row.offer.offerName,
          nominalAnnualRatePercent: pct(row.offer.nominalAnnualRatePercent),
          effectiveAnnualRatePercent:
            row.effectiveAnnualRatePercent === null ? null : pct(row.effectiveAnnualRatePercent),
          monthlyPayment: money(row.monthlyPayment),
          initialCosts: money(row.initialCosts),
          totalFinancingCost: money(row.totalFinancingCost),
        })),
      };
    } catch {
      offers = null;
    }
  }

  /* ── Refinancing an existing loan ── */

  let refinancing: ConsultantBrief['refinancing'] = null;
  const own = args.ownLoan;
  if (
    own.remainingPrincipal !== null &&
    own.remainingTermMonths !== null &&
    own.nominalRatePercent !== null &&
    own.newRatePercent !== null &&
    own.newTermMonths !== null
  ) {
    try {
      const r = calculateRefinancing({
        currentRemainingPrincipal: own.remainingPrincipal,
        currentRemainingTermMonths: own.remainingTermMonths,
        currentNominalAnnualRatePercent: own.nominalRatePercent,
        newNominalAnnualRatePercent: own.newRatePercent,
        newTermMonths: own.newTermMonths,
        refinancingFeesFlat: own.feesFlat ?? 0,
      });
      if (own.feesFlat === null) unknown.push('refinancing_fees');
      refinancing = {
        monthlyPaymentBefore: money(r.monthlyPaymentBefore),
        monthlyPaymentAfter: money(r.monthlyPaymentAfter),
        lifetimeSavings: money(r.lifetimeSavings),
        breakEvenMonths: r.breakEvenMonths,
      };
    } catch {
      refinancing = null;
    }
  }

  if (breakdown.unknownCosts.length) unknown.push(...breakdown.unknownCosts.map((k) => k.toLowerCase()));
  if (!input.rateType) unknown.push('rate_type');

  return {
    currency: input.propertyCurrency,
    scenario: {
      propertyPrice: money(input.propertyPrice),
      downPayment: money(input.downPayment),
      downPaymentPercent: pct(base.downPaymentPercent),
      loanAmount: money(base.loanAmount),
      termMonths: input.termMonths,
      nominalAnnualRatePercent: pct(input.nominalAnnualRatePercent),
      rateType: input.rateType ?? null,
      monthlyPayment: money(base.monthlyPayment),
      totalInterest: money(base.totalInterest),
      totalRepayment: money(base.totalRepayment),
      effectiveAnnualRatePercent:
        base.effectiveAnnualRatePercent === null ? null : pct(base.effectiveAnnualRatePercent),
    },
    ifTermWere: terms,
    ifDownPaymentWere: downPayments,
    ifRateWere: rates,
    ifPaidExtraMonthly: extras,
    realCost: {
      nominalAnnualRatePercent: pct(input.nominalAnnualRatePercent),
      effectiveAnnualRatePercent:
        breakdown.effectiveAnnualRatePercent === null ? null : pct(breakdown.effectiveAnnualRatePercent),
      gapPoints: breakdown.gapPoints === null ? null : pct(breakdown.gapPoints),
      components: breakdown.components.map((c) => ({
        key: c.key,
        ratePoints: pct(c.ratePoints),
        amount: money(c.amount),
      })),
      costsNotEntered: breakdown.unknownCosts,
    },
    affordability,
    offers,
    refinancing,
    programmes: args.subsidyPrograms.map((rule) => ({
      name: rule.data.programName ?? rule.title,
      maxLoanAmount: rule.data.maxLoanAmount ?? null,
      durationMonths: rule.data.durationMonths ?? null,
      officialSourceUrl: rule.officialSourceUrl,
      lastVerifiedAt: rule.lastVerifiedAt,
    })),
    unknown: [...new Set(unknown)],
  };
}
