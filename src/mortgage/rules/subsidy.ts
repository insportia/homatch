// src/mortgage/rules/subsidy.ts — pure rule evaluation over whatever
// ACTIVE SUBSIDY_PROGRAM rows the caller loaded. No Supabase, no network,
// no numbers of its own: every threshold, date and amount comes from the
// rule row, exactly as ptiLtv.ts does, and for the same reason.
//
// THE ONE THING THIS FILE MUST NEVER DO
//
// Say somebody is eligible. Eligibility for a government programme is
// established by the programme's administrator against documents, and
// nothing a calculator can compute changes that. So the strongest verdict
// here is LIKELY_MATCH, the wording is "based on what you entered", and
// any condition the rule does not express as a checkable question is
// reported as UNCHECKED rather than quietly assumed to pass.
//
// HOW THE CONDITIONS COMBINE, AND THE THIRD KIND THAT WAS MISSING
//
// A MANDATORY criterion must pass — citizenship is one, and failing it
// rules the programme out outright. A ROUTE is one of several ways in:
// Decree 388 admits a family through a child under one year old born
// after 1 September 2021, or through an adoption after that date, and
// satisfying either is enough.
//
// Everything else is CONTEXT, and that category is new because its
// absence produced two false matches. The old model had only "mandatory
// or not", so anything not mandatory became a route:
//
//   BEING A SINGLE PARENT became a way in. The decree does not list it
//   beside the child conditions; it lists "family / single parent /
//   widow" INSIDE each of them. A single parent with no qualifying child
//   satisfies nothing, and this file used to tell them they likely
//   matched.
//
//   HAVING THREE CHILDREN became a live way in. That route admitted
//   loans taken up to and including 1 September 2022 and has been closed
//   for four years. The answer still matters — it decides which subsidy
//   formula applies, 3.5 points off or 1.5 — but it opens nothing.
//
// Both errors pointed the same way: towards telling a family they
// qualified for money they will not receive. See CriterionRole in
// ../types.ts.

import type {
  CriterionRole,
  MortgageRule,
  SubsidyEligibilityCriterion,
  SubsidyProgramRuleData,
} from '../types.ts';

export type SubsidyVerdict =
  /** Every mandatory condition passed and at least one route in was satisfied. */
  | 'LIKELY_MATCH'
  /** A mandatory condition failed, or the loan exceeds a stated ceiling. */
  | 'NOT_A_MATCH'
  /** Nothing contradicts it, but something checkable is still unanswered. */
  | 'CANNOT_DETERMINE';

/** Answers keyed by `criterion.question.id`. */
export type SubsidyAnswers = Record<string, boolean | number | undefined>;

export interface CriterionOutcome {
  criterion: SubsidyEligibilityCriterion;
  role: CriterionRole;
  /** null when unanswered, or when the criterion carries no question. */
  satisfied: boolean | null;
  checkable: boolean;
}

/**
 * One sentence the result card can print, with the figures it needs.
 *
 * A verdict with no reason under it is what the owner found on the live
 * page: "does not match the published conditions" tells somebody nothing
 * they can act on, while "the programme is lari-only and you chose USD"
 * tells them exactly what to change. So every branch below that produces
 * a verdict also produces the reason for it, carrying its numbers rather
 * than pointing at them.
 */
export interface SubsidyReason {
  key: string;
  vars?: Record<string, string | number>;
}

export interface SubsidyMatch {
  ruleId: string;
  verdict: SubsidyVerdict;
  outcomes: CriterionOutcome[];
  /** Conditions this scenario DOES satisfy, worth saying back to them. */
  met: SubsidyReason[];
  /** Why it is not a match, or what is still unanswered. Decisive first. */
  reasons: SubsidyReason[];
  /** Criterion keys still waiting on an answer. */
  outstanding: string[];
  /** The one thing the person could do next, when there is one. */
  nextStep: SubsidyReason | null;
  /** True when the loan is above the programme's stated maximum. */
  loanExceedsMaximum: boolean;
  /** True when the loan currency differs from the programme's. */
  currencyMismatch: boolean;
}

/** MANDATORY / ROUTE / CONTEXT, defaulting the way the old data meant it. */
export function criterionRole(criterion: SubsidyEligibilityCriterion): CriterionRole {
  if (criterion.role) return criterion.role;
  return criterion.mandatory ? 'MANDATORY' : 'ROUTE';
}

function evaluate(criterion: SubsidyEligibilityCriterion, answers: SubsidyAnswers): CriterionOutcome {
  const role = criterionRole(criterion);
  const question = criterion.question;
  if (!question) return { criterion, role, satisfied: null, checkable: false };

  const answer = answers[question.id];
  if (answer === undefined) return { criterion, role, satisfied: null, checkable: true };

  if (question.type === 'YES_NO') {
    if (typeof answer !== 'boolean') return { criterion, role, satisfied: null, checkable: true };
    const wants = question.satisfiedWhenYes ?? true;
    return { criterion, role, satisfied: answer === wants, checkable: true };
  }

  if (typeof answer !== 'number' || !Number.isFinite(answer)) {
    return { criterion, role, satisfied: null, checkable: true };
  }
  const atLeast = question.satisfiedWhenAtLeast;
  const atMost = question.satisfiedWhenAtMost;
  const okLow = atLeast === undefined || answer >= atLeast;
  const okHigh = atMost === undefined || answer <= atMost;
  return { criterion, role, satisfied: okLow && okHigh, checkable: true };
}

export function matchSubsidyProgram(
  rule: MortgageRule<SubsidyProgramRuleData>,
  answers: SubsidyAnswers,
  loan: { amount: number; currency: string } | null,
): SubsidyMatch {
  const outcomes = rule.data.eligibilityCriteria.map((c) => evaluate(c, answers));
  const reasons: SubsidyReason[] = [];
  const met: SubsidyReason[] = [];
  let nextStep: SubsidyReason | null = null;

  const programCurrency = (rule.data.currency || '').toUpperCase();
  const loanCurrency = loan ? loan.currency.toUpperCase() : null;
  const currencyMismatch = Boolean(loan && programCurrency && loanCurrency !== programCurrency);
  const loanExceedsMaximum = Boolean(
    loan && rule.data.maxLoanAmount !== null && !currencyMismatch && loan.amount > rule.data.maxLoanAmount,
  );

  /*
   * THE ORDER IS THE MESSAGE.
   *
   * Somebody whose loan is both in the wrong currency and over the
   * ceiling has one thing to fix first, and it is the currency: the
   * ceiling is stated in lari and means nothing until the loan is. So
   * reasons are pushed most decisive first, and the card leads with one
   * sentence and keeps the rest as detail.
   */
  if (currencyMismatch) {
    reasons.push({
      key: 'mortgage_subsidy_reason_currency',
      vars: { program: programCurrency, chosen: loanCurrency ?? '' },
    });
    nextStep = { key: 'mortgage_subsidy_next_currency', vars: { program: programCurrency } };
  } else if (loan && programCurrency) {
    met.push({ key: 'mortgage_subsidy_met_currency', vars: { program: programCurrency } });
  }

  if (loanExceedsMaximum && rule.data.maxLoanAmount !== null) {
    reasons.push({
      key: 'mortgage_subsidy_reason_over_max',
      vars: { max: rule.data.maxLoanAmount, currency: programCurrency, loan: loan?.amount ?? 0 },
    });
    nextStep ??= {
      key: 'mortgage_subsidy_next_over_max',
      vars: { max: rule.data.maxLoanAmount, currency: programCurrency },
    };
  } else if (loan && !currencyMismatch && rule.data.maxLoanAmount !== null) {
    met.push({
      key: 'mortgage_subsidy_met_within_max',
      vars: { max: rule.data.maxLoanAmount, currency: programCurrency },
    });
  }

  const mandatory = outcomes.filter((o) => o.role === 'MANDATORY');
  const routes = outcomes.filter((o) => o.role === 'ROUTE');

  for (const outcome of outcomes) {
    if (outcome.satisfied !== true || outcome.role === 'CONTEXT') continue;
    met.push({ key: outcome.criterion.metKey ?? outcome.criterion.description });
  }

  const failedMandatory = mandatory.filter((o) => o.satisfied === false);
  for (const outcome of failedMandatory) {
    reasons.push({ key: outcome.criterion.failureKey ?? 'mortgage_subsidy_reason_mandatory_failed' });
  }

  if (currencyMismatch || loanExceedsMaximum || failedMandatory.length) {
    return {
      ruleId: rule.id, verdict: 'NOT_A_MATCH', outcomes, met, reasons,
      outstanding: [], nextStep, loanExceedsMaximum, currencyMismatch,
    };
  }

  const anyRouteIn = routes.some((o) => o.satisfied === true);

  /*
   * WHAT IS STILL OPEN, BY NAME.
   *
   * "We need a bit more information", with nothing after it, is the state
   * the owner found on the live page. This names the exact questions, so
   * the card can list them and the person can finish.
   *
   * Once one route is satisfied the other routes stop being outstanding:
   * any one of them is enough, so asking would be asking for an answer
   * that cannot change the result.
   */
  const outstanding = outcomes
    .filter((o) => o.checkable && o.satisfied === null && o.role !== 'CONTEXT')
    .filter((o) => !(anyRouteIn && o.role === 'ROUTE'))
    .map((o) => o.criterion.key);

  /* A condition the rule cannot turn into a question is reported, never
     assumed to pass — but it is a caveat on the verdict, not the verdict. */
  if (outcomes.some((o) => !o.checkable)) {
    reasons.push({ key: 'mortgage_subsidy_reason_uncheckable' });
  }

  if (outstanding.length) {
    reasons.unshift({ key: 'mortgage_subsidy_reason_unanswered', vars: { n: outstanding.length } });
    return {
      ruleId: rule.id, verdict: 'CANNOT_DETERMINE', outcomes, met, reasons,
      outstanding, nextStep, loanExceedsMaximum, currencyMismatch,
    };
  }

  if (!anyRouteIn && routes.length > 0) {
    reasons.unshift({ key: 'mortgage_subsidy_reason_no_route' });
    return {
      ruleId: rule.id, verdict: 'NOT_A_MATCH', outcomes, met, reasons,
      outstanding, nextStep, loanExceedsMaximum, currencyMismatch,
    };
  }

  return {
    ruleId: rule.id, verdict: 'LIKELY_MATCH', outcomes, met, reasons,
    outstanding, nextStep, loanExceedsMaximum, currencyMismatch,
  };
}

/* ── What the subsidy is actually worth right now ───────────────────── */

/** A REFERENCE_RATE rule row's payload. */
export interface ReferenceRateRuleData {
  rateName: string;
  ratePercent: number;
  decisionDate: string;
  nextReviewDate: string | null;
}

export interface SubsidyBenefit {
  /** Percentage points taken off the borrower's rate. */
  reductionPoints: number;
  /** The rate the borrower would actually pay, when a nominal one exists. */
  effectiveBorrowerRatePercent: number | null;
  /** True when the decree's ceiling, not the reference rate, set the figure. */
  capApplied: boolean;
  months: number | null;
}

/**
 * What the decree's formula produces at today's reference rate.
 *
 * The formula is "reference rate minus N points, but not more than M" —
 * so the reduction is min(reference − N, M), and which of the two bound
 * it is worth saying out loud: a borrower whose subsidy is capped will
 * see it shrink if the National Bank cuts rates, and one whose subsidy is
 * not capped will not.
 *
 * Returns null rather than guessing when either the formula for this
 * household shape or the current reference rate is absent. A subsidy
 * quoted from a stale policy rate is worse than no figure at all.
 */
export function computeSubsidyBenefit(args: {
  formula: { subtractPoints: number; capPercent: number } | null;
  referenceRatePercent: number | null;
  nominalAnnualRatePercent: number | null;
  durationMonths: number | null;
}): SubsidyBenefit | null {
  const { formula, referenceRatePercent } = args;
  if (!formula || referenceRatePercent === null || !Number.isFinite(referenceRatePercent)) return null;

  const fromReference = referenceRatePercent - formula.subtractPoints;
  const reductionPoints = Math.max(0, Math.min(fromReference, formula.capPercent));
  const capApplied = fromReference > formula.capPercent;

  const nominal = args.nominalAnnualRatePercent;
  const borrowerRate =
    nominal === null || !Number.isFinite(nominal) ? null : Math.max(0, Math.round((nominal - reductionPoints) * 100) / 100);

  return {
    reductionPoints: Math.round(reductionPoints * 100) / 100,
    effectiveBorrowerRatePercent: borrowerRate,
    capApplied,
    months: args.durationMonths,
  };
}

/** Parses "NBG_refinancing_rate_minus_3.5pp_capped_at_6pct" from the KB. */
export function parseSubsidyFormula(expression: string | undefined): { subtractPoints: number; capPercent: number } | null {
  if (!expression) return null;
  const match = /minus_([0-9.]+)pp_capped_at_([0-9.]+)pct/.exec(expression);
  if (!match) return null;
  const subtractPoints = Number(match[1]);
  const capPercent = Number(match[2]);
  if (!Number.isFinite(subtractPoints) || !Number.isFinite(capPercent)) return null;
  return { subtractPoints, capPercent };
}
