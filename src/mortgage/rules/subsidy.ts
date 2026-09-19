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
// HOW THE CONDITIONS COMBINE
//
// Two kinds. A `mandatory` criterion must pass — citizenship is one, and
// failing it rules the programme out outright. The rest are alternative
// routes in: Decree 388 admits a family through a child born after a
// date, OR three children by a date, OR an adoption, OR single-parent
// status, and satisfying any ONE of them is enough. Treating them as a
// conjunction would tell almost every real applicant they do not qualify.
import type {
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
  /** null when unanswered, or when the criterion carries no question. */
  satisfied: boolean | null;
  checkable: boolean;
}

export interface SubsidyMatch {
  ruleId: string;
  verdict: SubsidyVerdict;
  outcomes: CriterionOutcome[];
  /** i18n keys naming why it is not a match, or what is still unanswered. */
  reasons: string[];
  /** True when the loan is above the programme's stated maximum. */
  loanExceedsMaximum: boolean;
  /** True when the loan currency differs from the programme's. */
  currencyMismatch: boolean;
}

function evaluate(criterion: SubsidyEligibilityCriterion, answers: SubsidyAnswers): CriterionOutcome {
  const question = criterion.question;
  if (!question) return { criterion, satisfied: null, checkable: false };

  const answer = answers[question.id];
  if (answer === undefined) return { criterion, satisfied: null, checkable: true };

  if (question.type === 'YES_NO') {
    if (typeof answer !== 'boolean') return { criterion, satisfied: null, checkable: true };
    const wants = question.satisfiedWhenYes ?? true;
    return { criterion, satisfied: answer === wants, checkable: true };
  }

  if (typeof answer !== 'number' || !Number.isFinite(answer)) {
    return { criterion, satisfied: null, checkable: true };
  }
  const atLeast = question.satisfiedWhenAtLeast;
  const atMost = question.satisfiedWhenAtMost;
  const okLow = atLeast === undefined || answer >= atLeast;
  const okHigh = atMost === undefined || answer <= atMost;
  return { criterion, satisfied: okLow && okHigh, checkable: true };
}

export function matchSubsidyProgram(
  rule: MortgageRule<SubsidyProgramRuleData>,
  answers: SubsidyAnswers,
  loan: { amount: number; currency: string } | null,
): SubsidyMatch {
  const outcomes = rule.data.eligibilityCriteria.map((c) => evaluate(c, answers));
  const reasons: string[] = [];

  const currencyMismatch = Boolean(
    loan && rule.data.currency && loan.currency.toUpperCase() !== rule.data.currency.toUpperCase(),
  );
  const loanExceedsMaximum = Boolean(
    loan && rule.data.maxLoanAmount !== null && !currencyMismatch && loan.amount > rule.data.maxLoanAmount,
  );

  if (currencyMismatch) reasons.push('mortgage_subsidy_reason_currency');
  if (loanExceedsMaximum) reasons.push('mortgage_subsidy_reason_over_max');

  const mandatory = outcomes.filter((o) => o.criterion.mandatory);
  const optional = outcomes.filter((o) => !o.criterion.mandatory);

  if (mandatory.some((o) => o.satisfied === false)) reasons.push('mortgage_subsidy_reason_mandatory_failed');
  if (currencyMismatch || loanExceedsMaximum || mandatory.some((o) => o.satisfied === false)) {
    return { ruleId: rule.id, verdict: 'NOT_A_MATCH', outcomes, reasons, loanExceedsMaximum, currencyMismatch };
  }

  const mandatoryUnanswered = mandatory.some((o) => o.satisfied === null);
  const anyRouteIn = optional.some((o) => o.satisfied === true);
  const routesUnanswered = optional.some((o) => o.checkable && o.satisfied === null);
  const uncheckable = outcomes.some((o) => !o.checkable);

  if (uncheckable) reasons.push('mortgage_subsidy_reason_uncheckable');

  if (mandatoryUnanswered || (!anyRouteIn && routesUnanswered)) {
    reasons.push('mortgage_subsidy_reason_unanswered');
    return { ruleId: rule.id, verdict: 'CANNOT_DETERMINE', outcomes, reasons, loanExceedsMaximum, currencyMismatch };
  }

  if (!anyRouteIn && optional.length > 0) {
    reasons.push('mortgage_subsidy_reason_no_route');
    return { ruleId: rule.id, verdict: 'NOT_A_MATCH', outcomes, reasons, loanExceedsMaximum, currencyMismatch };
  }

  return { ruleId: rule.id, verdict: 'LIKELY_MATCH', outcomes, reasons, loanExceedsMaximum, currencyMismatch };
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
