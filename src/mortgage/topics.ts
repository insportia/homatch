// HOMATCH HOME FINANCING — the nine things a borrower actually wants to
// know, and what each one needs before it can answer.
//
// WHY A TABLE AND NOT NINE COMPONENTS THAT KNOW THEMSELVES
//
// The page has to answer three questions about a topic before rendering
// it: is it reachable yet, what is still missing, and does the answer
// depend on anything beyond the basic loan. A component can only answer
// those about itself, which means the home screen cannot say "two of
// these are ready" without instantiating all nine. So the requirements
// live here, as data, and both the chooser and the topic view read the
// same row.
//
// WHAT A TOPIC IS NOT
//
// It is not a calculator. Several topics read the SAME calculation from
// different angles — "monthly payment", "compare terms" and "understand
// my rate" are all the one amortization run — and the split is by the
// question a person came with, not by which engine answers it. Nothing
// here computes anything; see src/mortgage/calculations.

import type { MortgageInput } from './types.ts';

export const TOPIC_IDS = [
  'MONTHLY_PAYMENT',
  'AFFORDABILITY',
  'UNDERSTAND_RATE',
  'COMPARE_TERMS',
  'COMPARE_OFFERS',
  'EARLY_REPAYMENT',
  'REFINANCING',
  'GOVERNMENT_PROGRAMS',
  'BEFORE_YOU_SIGN',
] as const;

export type TopicId = (typeof TOPIC_IDS)[number];

/**
 * What a topic needs before it can say anything.
 *
 *   LOAN      the five core fields — price, currency, down payment, term,
 *             nominal rate. Everything numeric needs these.
 *   INCOME    monthly net income, for PTI.
 *   OFFERS    at least two bank offers entered.
 *   OWN_LOAN  an existing loan's remaining principal/term/rate.
 *   NONE      answers without any of the above; the educational topics.
 */
export type TopicRequirement = 'LOAN' | 'INCOME' | 'OFFERS' | 'OWN_LOAN' | 'NONE';

export interface TopicDef {
  id: TopicId;
  titleKey: string;
  /** The question in the borrower's own words, shown under the title. */
  questionKey: string;
  descriptionKey: string;
  requires: TopicRequirement[];
  /** Icon name, resolved by the chooser. Kept as a string so this file
   *  stays importable by Node's test runner with no React in the graph. */
  icon:
    | 'wallet'
    | 'scale'
    | 'percent'
    | 'calendar'
    | 'columns'
    | 'fast-forward'
    | 'repeat'
    | 'landmark'
    | 'file-check';
}

export const TOPICS: Record<TopicId, TopicDef> = {
  MONTHLY_PAYMENT: {
    id: 'MONTHLY_PAYMENT',
    titleKey: 'mortgage_topic_payment_title',
    questionKey: 'mortgage_topic_payment_question',
    descriptionKey: 'mortgage_topic_payment_desc',
    requires: ['LOAN'],
    icon: 'wallet',
  },
  AFFORDABILITY: {
    id: 'AFFORDABILITY',
    titleKey: 'mortgage_topic_afford_title',
    questionKey: 'mortgage_topic_afford_question',
    descriptionKey: 'mortgage_topic_afford_desc',
    requires: ['LOAN', 'INCOME'],
    icon: 'scale',
  },
  UNDERSTAND_RATE: {
    id: 'UNDERSTAND_RATE',
    titleKey: 'mortgage_topic_rate_title',
    questionKey: 'mortgage_topic_rate_question',
    descriptionKey: 'mortgage_topic_rate_desc',
    requires: ['LOAN'],
    icon: 'percent',
  },
  COMPARE_TERMS: {
    id: 'COMPARE_TERMS',
    titleKey: 'mortgage_topic_terms_title',
    questionKey: 'mortgage_topic_terms_question',
    descriptionKey: 'mortgage_topic_terms_desc',
    requires: ['LOAN'],
    icon: 'calendar',
  },
  COMPARE_OFFERS: {
    id: 'COMPARE_OFFERS',
    titleKey: 'mortgage_topic_offers_title',
    questionKey: 'mortgage_topic_offers_question',
    descriptionKey: 'mortgage_topic_offers_desc',
    requires: ['OFFERS'],
    icon: 'columns',
  },
  EARLY_REPAYMENT: {
    id: 'EARLY_REPAYMENT',
    titleKey: 'mortgage_topic_early_title',
    questionKey: 'mortgage_topic_early_question',
    descriptionKey: 'mortgage_topic_early_desc',
    requires: ['LOAN'],
    icon: 'fast-forward',
  },
  REFINANCING: {
    id: 'REFINANCING',
    titleKey: 'mortgage_topic_refi_title',
    questionKey: 'mortgage_topic_refi_question',
    descriptionKey: 'mortgage_topic_refi_desc',
    requires: ['OWN_LOAN'],
    icon: 'repeat',
  },
  GOVERNMENT_PROGRAMS: {
    id: 'GOVERNMENT_PROGRAMS',
    titleKey: 'mortgage_topic_programs_title',
    questionKey: 'mortgage_topic_programs_question',
    descriptionKey: 'mortgage_topic_programs_desc',
    requires: ['NONE'],
    icon: 'landmark',
  },
  BEFORE_YOU_SIGN: {
    id: 'BEFORE_YOU_SIGN',
    titleKey: 'mortgage_topic_sign_title',
    questionKey: 'mortgage_topic_sign_question',
    descriptionKey: 'mortgage_topic_sign_desc',
    requires: ['NONE'],
    icon: 'file-check',
  },
};

/**
 * The order on the home screen.
 *
 * Not the order of the mandate's list and not alphabetical: it is the
 * order somebody actually arrives at these questions. "What will it cost
 * a month" and "can I afford it" come before "which bank", and the two
 * topics that need no numbers at all sit at the end so the screen does
 * not open with homework.
 */
export const TOPIC_ORDER: TopicId[] = [
  'MONTHLY_PAYMENT',
  'AFFORDABILITY',
  'UNDERSTAND_RATE',
  'COMPARE_TERMS',
  'COMPARE_OFFERS',
  'EARLY_REPAYMENT',
  'REFINANCING',
  'GOVERNMENT_PROGRAMS',
  'BEFORE_YOU_SIGN',
];

/* ── Readiness ──────────────────────────────────────────────────────── */

export interface WorkspaceState {
  /** The core loan, when all five required fields are present and valid. */
  loan: MortgageInput | null;
  monthlyNetIncome: number | null;
  offerCount: number;
  hasOwnLoan: boolean;
}

/**
 * Which requirements a topic is still waiting on.
 *
 * Returns i18n keys rather than booleans so the caller can say WHAT is
 * missing. An empty array means the topic can answer.
 */
export function missingRequirements(topic: TopicDef, state: WorkspaceState): string[] {
  const missing: string[] = [];
  for (const requirement of topic.requires) {
    switch (requirement) {
      case 'LOAN':
        if (!state.loan) missing.push('mortgage_needs_loan');
        break;
      case 'INCOME':
        if (state.monthlyNetIncome === null || state.monthlyNetIncome <= 0) {
          missing.push('mortgage_needs_income');
        }
        break;
      case 'OFFERS':
        if (state.offerCount < 2) missing.push('mortgage_needs_two_offers');
        break;
      case 'OWN_LOAN':
        if (!state.hasOwnLoan) missing.push('mortgage_needs_own_loan');
        break;
      case 'NONE':
        break;
    }
  }
  return missing;
}

export function isTopicReady(topic: TopicDef, state: WorkspaceState): boolean {
  return missingRequirements(topic, state).length === 0;
}

export function isTopicId(value: unknown): value is TopicId {
  return typeof value === 'string' && (TOPIC_IDS as readonly string[]).includes(value);
}
