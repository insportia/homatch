// HOMATCH HOME FINANCING — the session.
//
// WHY THERE IS NO CALCULATE BUTTON ANY MORE
//
// There was one, and on the live page it sat grey and disabled above a
// form whose four placeholders read as filled values, with nothing
// saying which field was empty. Somebody arriving at that screen has no
// way to tell a broken page from an incomplete one.
//
// Every engine in src/mortgage/calculations runs in single-digit
// milliseconds, so there is nothing to wait for: the result updates on
// each change and the topics that cannot answer yet say what they are
// waiting on, by name. That is also the Investment workspace's rule, and
// two products that behave differently for no reason are two products to
// learn.
//
// WHAT IS DERIVED AND WHAT IS STATE
//
// Only what the borrower entered is state. Every number on every topic —
// the payment, the schedule, the effective-rate decomposition, the term
// ladder, PTI, the offer comparison, the subsidy verdict — is a useMemo
// over the same engines. Keeping any of them in state would create a
// second source of truth that drifts the first time one is updated and
// the other is not.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { logActivity } from '@/services/api';
import type { ActivityEventType } from '@/types/types';
import {
  getActiveLtvRules,
  getActivePtiRules,
  getActiveReferenceRate,
  getActiveSubsidyPrograms,
} from '@/services/mortgageApi';
import {
  calculateEarlyRepayment,
  calculateRefinancing,
  compareOffers,
  compareTerms,
  computeAffordability,
  runFullMortgageCalculation,
  validateMortgageInput,
} from '@/mortgage/calculations';
import { buildRateBreakdown, type RateBreakdown } from '@/mortgage/calculations/rateBreakdown';
import { buildFinancingPicture, type FinancingPicture } from '@/mortgage/calculations/financingPicture';
import { classifyCurrency, selectActiveLtvRule, selectActivePtiRule } from '@/mortgage/rules/ptiLtv';
import {
  matchSubsidyProgram,
  type ReferenceRateRuleData,
  type SubsidyAnswers,
  type SubsidyMatch,
} from '@/mortgage/rules/subsidy';
import { TOPICS, isTopicId, type TopicId, type WorkspaceState } from '@/mortgage/topics';
import type {
  AffordabilityResult,
  EarlyRepaymentResult,
  LtvLimitRuleData,
  MortgageCalculationResult,
  MortgageInput,
  MortgageOffer,
  MortgageRule,
  OfferComparisonResult,
  PtiLimitRuleData,
  RateType,
  RefinancingResult,
  SubsidyProgramRuleData,
  TermComparisonRow,
} from '@/mortgage/types';

/** Everything the borrower has typed or clicked, as entered. */
export interface FinancingDraft {
  propertyPrice: number | null;
  currency: string;
  downPayment: number | null;
  termMonths: number | null;
  nominalAnnualRatePercent: number | null;

  rateType: RateType | null;
  originationFeePercent: number | null;
  monthlyFeeFlat: number | null;
  mandatoryInsuranceAnnualFlat: number | null;
  valuationFeeFlat: number | null;
  gracePeriodMonths: number | null;
  effectiveAnnualRatePercentFromBank: number | null;

  monthlyNetIncome: number | null;
  existingMonthlyDebtObligations: number | null;

  extraPaymentAmount: number | null;
  extraPaymentMonth: number | null;
  recurringMonthlyExtra: number | null;
  knownEarlyRepaymentFeeFlat: number | null;

  ownRemainingPrincipal: number | null;
  ownRemainingTermMonths: number | null;
  ownNominalRatePercent: number | null;
  refiNewRatePercent: number | null;
  refiNewTermMonths: number | null;
  refinancingFeesFlat: number | null;
}

export type DraftField = keyof FinancingDraft;

const EMPTY_DRAFT: FinancingDraft = {
  propertyPrice: null,
  currency: 'GEL',
  downPayment: null,
  termMonths: 240,
  nominalAnnualRatePercent: null,
  rateType: null,
  originationFeePercent: null,
  monthlyFeeFlat: null,
  mandatoryInsuranceAnnualFlat: null,
  valuationFeeFlat: null,
  gracePeriodMonths: null,
  effectiveAnnualRatePercentFromBank: null,
  monthlyNetIncome: null,
  existingMonthlyDebtObligations: null,
  extraPaymentAmount: null,
  extraPaymentMonth: null,
  recurringMonthlyExtra: null,
  knownEarlyRepaymentFeeFlat: null,
  ownRemainingPrincipal: null,
  ownRemainingTermMonths: null,
  ownNominalRatePercent: null,
  refiNewRatePercent: null,
  refiNewTermMonths: null,
  refinancingFeesFlat: null,
};

const STORAGE_KEY = 'homatch.mortgage.draft.v1';
const TOPIC_KEY = 'homatch.mortgage.topic.v1';

/**
 * A scenario survives a reload.
 *
 * The same reasoning as the Investment workspace: somebody who has spent
 * ten minutes entering a bank's fee schedule and then refreshes should
 * not lose it, and a database table for genuinely local working state
 * would mean a schema, a migration and an RLS review for nothing. Values
 * are re-validated on the way back in — storage is writable by anything
 * on this origin, including an older build with different fields.
 */
function loadDraft(): FinancingDraft {
  if (typeof window === 'undefined') return EMPTY_DRAFT;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_DRAFT;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: FinancingDraft = { ...EMPTY_DRAFT };
    for (const key of Object.keys(EMPTY_DRAFT) as DraftField[]) {
      const value = parsed[key];
      if (key === 'currency') {
        if (typeof value === 'string' && value.length >= 3) next.currency = value;
        continue;
      }
      if (key === 'rateType') {
        if (value === 'FIXED' || value === 'VARIABLE' || value === 'INDEXED') next.rateType = value;
        continue;
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        (next as unknown as Record<string, unknown>)[key] = value;
      }
    }
    return next;
  } catch {
    return EMPTY_DRAFT;
  }
}

function store(key: string, value: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* A full or disabled storage must never break the workspace. */
  }
}

function loadTopic(): TopicId | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(TOPIC_KEY);
    return isTopicId(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** The draft as the engines want it, or null when the five core fields
 *  are not all present and valid. Never a partially-built input. */
export function toMortgageInput(draft: FinancingDraft): MortgageInput | null {
  if (
    draft.propertyPrice === null ||
    draft.downPayment === null ||
    draft.termMonths === null ||
    draft.nominalAnnualRatePercent === null
  ) {
    return null;
  }
  const input: MortgageInput = {
    propertyPrice: draft.propertyPrice,
    propertyCurrency: draft.currency,
    downPayment: draft.downPayment,
    termMonths: draft.termMonths,
    nominalAnnualRatePercent: draft.nominalAnnualRatePercent,
    ...(draft.rateType ? { rateType: draft.rateType } : {}),
    ...(draft.originationFeePercent !== null ? { originationFeePercent: draft.originationFeePercent } : {}),
    ...(draft.monthlyFeeFlat !== null ? { monthlyFeeFlat: draft.monthlyFeeFlat } : {}),
    ...(draft.mandatoryInsuranceAnnualFlat !== null
      ? { mandatoryInsuranceAnnualFlat: draft.mandatoryInsuranceAnnualFlat }
      : {}),
    ...(draft.valuationFeeFlat !== null ? { valuationFeeFlat: draft.valuationFeeFlat } : {}),
    ...(draft.gracePeriodMonths !== null ? { gracePeriodMonths: draft.gracePeriodMonths } : {}),
    ...(draft.effectiveAnnualRatePercentFromBank !== null
      ? { effectiveAnnualRatePercentFromBank: draft.effectiveAnnualRatePercentFromBank }
      : {}),
  };
  return validateMortgageInput(input).length ? null : input;
}

export interface FinancingSession {
  draft: FinancingDraft;
  set: (field: DraftField, value: number | string | null) => void;
  reset: () => void;

  topic: TopicId | null;
  selectTopic: (topic: TopicId | null) => void;

  /** Named validation problems for whatever the borrower has entered. */
  inputErrors: string[];
  input: MortgageInput | null;
  result: MortgageCalculationResult | null;
  breakdown: RateBreakdown | null;
  termRows: TermComparisonRow[];
  affordability: AffordabilityResult | null;
  picture: FinancingPicture | null;
  earlyRepayment: EarlyRepaymentResult | null;
  refinancing: RefinancingResult | null;

  offers: MortgageOffer[];
  addOffer: (offer: MortgageOffer) => void;
  updateOffer: (index: number, offer: MortgageOffer) => void;
  removeOffer: (index: number) => void;
  offerComparison: OfferComparisonResult | null;

  subsidyPrograms: MortgageRule<SubsidyProgramRuleData>[];
  subsidyAnswers: SubsidyAnswers;
  answerSubsidy: (questionId: string, answer: boolean | number | undefined) => void;
  subsidyMatches: SubsidyMatch[];
  referenceRate: MortgageRule<ReferenceRateRuleData> | null;

  ptiRule: MortgageRule<PtiLimitRuleData> | null;
  ltvRule: MortgageRule<LtvLimitRuleData> | null;
  workspaceState: WorkspaceState;
}

export function useFinancingSession(prefill?: { price?: number; currency?: string }): FinancingSession {
  const { homatchUser } = useAuth();

  const [draft, setDraft] = useState<FinancingDraft>(() => {
    const loaded = loadDraft();
    if (prefill?.price && loaded.propertyPrice === null) {
      return { ...loaded, propertyPrice: prefill.price, currency: prefill.currency ?? loaded.currency };
    }
    return loaded;
  });
  const [topic, setTopic] = useState<TopicId | null>(loadTopic);
  const [offers, setOffers] = useState<MortgageOffer[]>([]);
  const [subsidyAnswers, setSubsidyAnswers] = useState<SubsidyAnswers>({});

  const [ptiRules, setPtiRules] = useState<MortgageRule<PtiLimitRuleData>[]>([]);
  const [ltvRules, setLtvRules] = useState<MortgageRule<LtvLimitRuleData>[]>([]);
  const [subsidyPrograms, setSubsidyPrograms] = useState<MortgageRule<SubsidyProgramRuleData>[]>([]);
  const [referenceRate, setReferenceRate] = useState<MortgageRule<ReferenceRateRuleData> | null>(null);

  useEffect(() => {
    store(STORAGE_KEY, JSON.stringify(draft));
  }, [draft]);

  useEffect(() => {
    store(TOPIC_KEY, topic);
  }, [topic]);

  useEffect(() => {
    // ACTIVE knowledge-base rows are public under RLS, so these load for a
    // signed-out visitor too and every topic works before sign-in.
    getActivePtiRules().then(setPtiRules).catch(() => {});
    getActiveLtvRules().then(setLtvRules).catch(() => {});
    getActiveSubsidyPrograms().then(setSubsidyPrograms).catch(() => {});
    getActiveReferenceRate().then(setReferenceRate).catch(() => {});
  }, []);

  const track = useCallback(
    (eventType: ActivityEventType, metadata?: Record<string, unknown>) => {
      // activity_events.user_id is NOT NULL and this page is public, so a
      // signed-out visitor is a deliberate no-op rather than a row that
      // would violate the constraint.
      if (!homatchUser) return;
      logActivity(homatchUser.id, eventType, undefined, metadata).catch(() => {});
    },
    [homatchUser],
  );

  const set = useCallback((field: DraftField, value: number | string | null) => {
    setDraft((current) => ({ ...current, [field]: value }));
  }, []);

  const reset = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    setTopic(null);
    setOffers([]);
    setSubsidyAnswers({});
    store(STORAGE_KEY, null);
    store(TOPIC_KEY, null);
  }, []);

  const selectTopic = useCallback(
    (next: TopicId | null) => {
      setTopic(next);
      if (next) track('MORTGAGE_TOPIC_OPENED', { topic: next });
    },
    [track],
  );

  /* ── The one calculation everything else reads ── */

  const input = useMemo(() => toMortgageInput(draft), [draft]);

  const inputErrors = useMemo(() => {
    // Only complain about fields that have been filled in. An untouched
    // form is not an invalid one, and reporting five errors before
    // anybody has typed anything is how a product teaches people to
    // ignore its error text.
    if (draft.propertyPrice === null && draft.downPayment === null) return [];
    const probe: MortgageInput = {
      propertyPrice: draft.propertyPrice ?? 1,
      propertyCurrency: draft.currency,
      downPayment: draft.downPayment ?? 0,
      termMonths: draft.termMonths ?? 240,
      nominalAnnualRatePercent: draft.nominalAnnualRatePercent ?? 0,
      ...(draft.gracePeriodMonths !== null ? { gracePeriodMonths: draft.gracePeriodMonths } : {}),
    };
    return validateMortgageInput(probe).map((e) => e.messageKey);
  }, [draft]);

  const result = useMemo<MortgageCalculationResult | null>(() => {
    if (!input) return null;
    try {
      return runFullMortgageCalculation(input);
    } catch {
      return null;
    }
  }, [input]);

  const breakdown = useMemo(() => (input ? buildRateBreakdown(input) : null), [input]);

  const termRows = useMemo<TermComparisonRow[]>(() => {
    if (!input) return [];
    try {
      return compareTerms(input);
    } catch {
      return [];
    }
  }, [input]);

  const ptiRule = useMemo(
    () =>
      draft.monthlyNetIncome !== null
        ? selectActivePtiRule(ptiRules, draft.monthlyNetIncome, classifyCurrency(draft.currency))
        : null,
    [ptiRules, draft.monthlyNetIncome, draft.currency],
  );
  const ltvRule = useMemo(
    () => selectActiveLtvRule(ltvRules, classifyCurrency(draft.currency)),
    [ltvRules, draft.currency],
  );

  const affordability = useMemo<AffordabilityResult | null>(() => {
    if (!result || draft.monthlyNetIncome === null || draft.monthlyNetIncome <= 0) return null;
    return computeAffordability(
      result,
      {
        monthlyNetIncome: draft.monthlyNetIncome,
        incomeCurrency: draft.currency,
        existingMonthlyDebtObligations: draft.existingMonthlyDebtObligations ?? undefined,
      },
      draft.currency,
      ptiRules,
      ltvRules,
    );
  }, [result, draft.monthlyNetIncome, draft.existingMonthlyDebtObligations, draft.currency, ptiRules, ltvRules]);

  const picture = useMemo<FinancingPicture | null>(() => {
    if (!input || !result || !breakdown) return null;
    return buildFinancingPicture({
      input,
      result,
      breakdown,
      affordability,
      ptiRule,
      ltvRule,
      earlyRepaymentFeeKnown: draft.knownEarlyRepaymentFeeFlat !== null,
    });
  }, [input, result, breakdown, affordability, ptiRule, ltvRule, draft.knownEarlyRepaymentFeeFlat]);

  const earlyRepayment = useMemo<EarlyRepaymentResult | null>(() => {
    if (!input || draft.extraPaymentAmount === null || draft.extraPaymentMonth === null) return null;
    try {
      return calculateEarlyRepayment(input, {
        extraPaymentAmount: draft.extraPaymentAmount,
        extraPaymentMonth: draft.extraPaymentMonth,
        ...(draft.recurringMonthlyExtra !== null ? { recurringMonthlyExtra: draft.recurringMonthlyExtra } : {}),
        ...(draft.knownEarlyRepaymentFeeFlat !== null
          ? { knownEarlyRepaymentFeeFlat: draft.knownEarlyRepaymentFeeFlat }
          : {}),
      });
    } catch {
      return null;
    }
  }, [
    input,
    draft.extraPaymentAmount,
    draft.extraPaymentMonth,
    draft.recurringMonthlyExtra,
    draft.knownEarlyRepaymentFeeFlat,
  ]);

  const refinancing = useMemo<RefinancingResult | null>(() => {
    const d = draft;
    if (
      d.ownRemainingPrincipal === null ||
      d.ownRemainingTermMonths === null ||
      d.ownNominalRatePercent === null ||
      d.refiNewRatePercent === null ||
      d.refiNewTermMonths === null
    ) {
      return null;
    }
    try {
      return calculateRefinancing({
        currentRemainingPrincipal: d.ownRemainingPrincipal,
        currentRemainingTermMonths: d.ownRemainingTermMonths,
        currentNominalAnnualRatePercent: d.ownNominalRatePercent,
        newNominalAnnualRatePercent: d.refiNewRatePercent,
        newTermMonths: d.refiNewTermMonths,
        // The fee is a REQUIRED input to the engine and there is no
        // "unknown" branch, so an unentered fee is treated as zero here
        // and the view says so in as many words.
        refinancingFeesFlat: d.refinancingFeesFlat ?? 0,
      });
    } catch {
      return null;
    }
  }, [draft]);

  const offerComparison = useMemo<OfferComparisonResult | null>(() => {
    if (offers.length < 2 || offers.length > 3) return null;
    try {
      return compareOffers(offers);
    } catch {
      return null;
    }
  }, [offers]);

  const subsidyMatches = useMemo<SubsidyMatch[]>(
    () =>
      subsidyPrograms.map((rule) =>
        matchSubsidyProgram(
          rule,
          subsidyAnswers,
          result ? { amount: result.loanAmount, currency: draft.currency } : null,
        ),
      ),
    [subsidyPrograms, subsidyAnswers, result, draft.currency],
  );

  /* ── Analytics: once per thing, not once per keystroke ── */
  const fired = useRef(new Set<string>());
  useEffect(() => {
    const once = (key: string, event: ActivityEventType) => {
      if (fired.current.has(key)) return;
      fired.current.add(key);
      track(event);
    };
    if (result) once('calculated', 'MORTGAGE_CALCULATED');
    if (affordability) once('afford', 'MORTGAGE_AFFORDABILITY_CHECKED');
    if (termRows.length > 1) once('terms', 'MORTGAGE_TERM_COMPARED');
    if (offerComparison) once('offers', 'MORTGAGE_OFFERS_COMPARED');
    if (subsidyMatches.some((m) => m.verdict !== 'CANNOT_DETERMINE')) {
      once('subsidy', 'MORTGAGE_SUBSIDY_CHECKED');
    }
  }, [result, affordability, termRows.length, offerComparison, subsidyMatches, track]);

  const workspaceState = useMemo<WorkspaceState>(
    () => ({
      loan: input,
      monthlyNetIncome: draft.monthlyNetIncome,
      offerCount: offers.length,
      hasOwnLoan:
        draft.ownRemainingPrincipal !== null &&
        draft.ownRemainingTermMonths !== null &&
        draft.ownNominalRatePercent !== null,
    }),
    [input, draft.monthlyNetIncome, draft.ownRemainingPrincipal, draft.ownRemainingTermMonths, draft.ownNominalRatePercent, offers.length],
  );

  const addOffer = useCallback((offer: MortgageOffer) => {
    setOffers((current) => (current.length >= 3 ? current : [...current, offer]));
  }, []);
  const updateOffer = useCallback((index: number, offer: MortgageOffer) => {
    setOffers((current) => current.map((existing, i) => (i === index ? offer : existing)));
  }, []);
  const removeOffer = useCallback((index: number) => {
    setOffers((current) => current.filter((_, i) => i !== index));
  }, []);

  const answerSubsidy = useCallback((questionId: string, answer: boolean | number | undefined) => {
    setSubsidyAnswers((current) => ({ ...current, [questionId]: answer }));
  }, []);

  return {
    draft,
    set,
    reset,
    topic,
    selectTopic,
    inputErrors,
    input,
    result,
    breakdown,
    termRows,
    affordability,
    picture,
    earlyRepayment,
    refinancing,
    offers,
    addOffer,
    updateOffer,
    removeOffer,
    offerComparison,
    subsidyPrograms,
    subsidyAnswers,
    answerSubsidy,
    subsidyMatches,
    referenceRate,
    ptiRule,
    ltvRule,
    workspaceState,
  };
}

export { TOPICS };
