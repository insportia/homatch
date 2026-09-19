// WHAT THIS CHECKLIST KNOWS ABOUT *THIS* LOAN.
//
// The list in guidance.ts is fifteen things worth checking with a bank.
// It was correct and it was useless, because every reader got the same
// fifteen sentences: "ask whether the rate is fixed" reads identically
// to somebody who has already said it is fixed and to somebody who has
// no idea. A checklist that cannot see the scenario beside it is a
// printed leaflet.
//
// This module answers, for each item, the only question that makes it
// personal: WHAT DO WE ALREADY KNOW IN THIS CASE?
//
// TWO STATES, AND NEITHER OF THEM IS AN OPINION
//
//   KNOWN  the scenario answers it, and the sentence carries the figure.
//   OPEN   it does not, and the sentence says where the answer comes from.
//
// KNOWN is not approval. A 3% origination fee is KNOWN and might be
// terrible; an unknown early-repayment clause is OPEN and might be
// generous. Nothing here ranks anything, for the same reason
// financingPicture.ts has no score: whether a fee is acceptable depends
// on what the alternative charges, and this product does not know that.
// The UI wording carries the same distinction — see §16 of the brief.
//
// NEVER INVENTED. An item whose field is empty is OPEN. It is never
// filled with a plausible default, and "the bank did not mention one" is
// not the same statement as "there is none".
//
// Plain data, no React, so the tests import it directly.

import { CHECKLIST } from './guidance.ts';
import type {
  MortgageCalculationResult,
  MortgageInput,
  RateType,
} from './types.ts';
import type { RateBreakdown } from './calculations/rateBreakdown.ts';

export type ChecklistStatus = 'KNOWN' | 'OPEN';

export interface ChecklistState {
  id: string;
  status: ChecklistStatus;
  /** i18n key for the sentence about this scenario. */
  stateKey: string;
  vars?: Record<string, string | number>;
  /** Variables whose value is itself an i18n key (a rate type is an enum). */
  varKeys?: Record<string, string>;
  /**
   * Variables holding a raw amount, to be formatted by the renderer.
   *
   * This module has no locale and no Intl: a figure formatted here
   * would be "1765" on a Georgian page and "1765" on an Arabic one.
   * The engine says WHICH numbers are money and in what currency, and
   * the view formats them once. Naming them is what stops a bare
   * integer reaching a sentence about somebody's salary.
   */
  moneyVars?: string[];
  /** The currency those amounts are in. */
  currency?: string;
  /** OPEN only: where the answer comes from. */
  findKey?: string;
}

export interface ChecklistContext {
  input: MortgageInput | null;
  result: MortgageCalculationResult | null;
  breakdown: RateBreakdown | null;
}

const RATE_TYPE_LABEL_KEYS: Record<RateType, string> = {
  FIXED: 'mortgage_rate_type_fixed',
  VARIABLE: 'mortgage_rate_type_variable',
  INDEXED: 'mortgage_rate_type_indexed',
};

const known = (
  id: string,
  stateKey: string,
  vars?: Record<string, string | number>,
  extra?: { varKeys?: Record<string, string>; moneyVars?: string[]; currency?: string },
): ChecklistState => ({ id, status: 'KNOWN', stateKey, vars, ...extra });

const open = (id: string, stateKey: string, findKey: string): ChecklistState =>
  ({ id, status: 'OPEN', stateKey, findKey });

const money = (value: number) => Math.round(value);
const pct = (value: number) => Math.round(value * 10) / 10;

/**
 * One state per checklist item, in the order guidance.ts lists them.
 *
 * With no scenario every item is OPEN and says so, which is the honest
 * answer before anybody has typed a price.
 */
export function checklistStates(ctx: ChecklistContext): ChecklistState[] {
  const { input, result, breakdown } = ctx;
  const states = new Map<string, ChecklistState>();
  const put = (state: ChecklistState) => states.set(state.id, state);

  if (input && result) {
    const years = Math.round((result.amortizationSchedule.length / 12) * 10) / 10;

    /* ── What the loan really costs ── */
    if (breakdown && breakdown.effectiveAnnualRatePercent !== null) {
      put(known('effective_rate', 'mortgage_state_effective_rate', {
        nominal: pct(breakdown.nominalAnnualRatePercent),
        effective: Math.round(breakdown.effectiveAnnualRatePercent * 100) / 100,
      }));
    } else {
      put(open('effective_rate', 'mortgage_state_effective_rate_open', 'mortgage_find_effective_rate'));
    }

    const cash = (names: string[]) => ({ moneyVars: names, currency: result.currency });

    put(known('monthly_payment', 'mortgage_state_monthly_payment', {
      amount: money(result.monthlyPayment),
    }, cash(['amount'])));
    put(known('total_repayment', 'mortgage_state_total_repayment', {
      total: money(result.totalRepayment), years,
    }, cash(['total'])));
    put(known('total_interest', 'mortgage_state_total_interest', {
      interest: money(result.totalInterest),
      pct: result.loanAmount > 0 ? pct((result.totalInterest / result.loanAmount) * 100) : 0,
    }, cash(['interest'])));

    /* ── The bank's own cost sheet ── */
    if (typeof input.originationFeePercent === 'number' || typeof input.originationFeeFlat === 'number') {
      const fromPercent = typeof input.originationFeePercent === 'number'
        ? (result.loanAmount * input.originationFeePercent) / 100
        : 0;
      put(known('initial_fees', 'mortgage_state_initial_fees', {
        amount: money(fromPercent + (input.originationFeeFlat ?? 0)),
      }, cash(['amount'])));
    } else {
      put(open('initial_fees', 'mortgage_state_initial_fees_open', 'mortgage_find_initial_fees'));
    }

    if (typeof input.monthlyFeeFlat === 'number') {
      put(known('recurring_fees', 'mortgage_state_recurring_fees', {
        amount: money(input.monthlyFeeFlat),
        total: money(input.monthlyFeeFlat * result.amortizationSchedule.length),
      }, cash(['amount', 'total'])));
    } else {
      put(open('recurring_fees', 'mortgage_state_recurring_fees_open', 'mortgage_find_recurring_fees'));
    }

    if (typeof input.mandatoryInsuranceAnnualFlat === 'number') {
      put(known('insurance', 'mortgage_state_insurance', {
        amount: money(input.mandatoryInsuranceAnnualFlat),
      }, cash(['amount'])));
    } else {
      put(open('insurance', 'mortgage_state_insurance_open', 'mortgage_find_insurance'));
    }

    if (typeof input.valuationFeeFlat === 'number') {
      put(known('valuation', 'mortgage_state_valuation', { amount: money(input.valuationFeeFlat) }, cash(['amount'])));
    } else {
      put(open('valuation', 'mortgage_state_valuation_open', 'mortgage_find_valuation'));
    }

    /* ── Terms ── */
    if (input.rateType) {
      put(known('rate_type', 'mortgage_state_rate_type', undefined, {
        varKeys: { type: RATE_TYPE_LABEL_KEYS[input.rateType] },
      }));
    } else {
      put(open('rate_type', 'mortgage_state_rate_type_open', 'mortgage_find_rate_type'));
    }

    if (typeof input.gracePeriodMonths === 'number' && input.gracePeriodMonths > 0) {
      put(known('grace_period', 'mortgage_state_grace_period', { months: input.gracePeriodMonths }));
    } else {
      put(open('grace_period', 'mortgage_state_grace_period_open', 'mortgage_find_grace_period'));
    }

    /* ── Risk ── */
    if (input.indexOrReferenceName) {
      put(known('rate_exposure', 'mortgage_state_rate_exposure', { index: input.indexOrReferenceName }));
    } else if (input.rateType === 'FIXED') {
      put(known('rate_exposure', 'mortgage_state_rate_exposure_fixed'));
    } else {
      put(open('rate_exposure', 'mortgage_state_rate_exposure_open', 'mortgage_find_rate_exposure'));
    }

    /*
     * Currency is always KNOWN, and the two sentences say different
     * things. Lari is not "safe" and dollars are not "risky" — what
     * matters is whether the loan and the income are in the same money,
     * which this product does not know. So the foreign-currency line
     * states the exposure conditionally and the lari one states the
     * absence of it.
     */
    put(
      input.propertyCurrency.toUpperCase() === 'GEL'
        ? known('currency_risk', 'mortgage_state_currency_local', { currency: input.propertyCurrency.toUpperCase() })
        : known('currency_risk', 'mortgage_state_currency_foreign', { currency: input.propertyCurrency.toUpperCase() }),
    );
  }

  /*
   * The three a calculator can never answer.
   *
   * Nothing in an amortization schedule knows what a contract says about
   * closing early, moving the loan, or being late. They were unticked
   * before and they are OPEN now, which is the same honesty with a
   * sentence attached.
   */
  put(open('early_repayment', 'mortgage_state_early_repayment_open', 'mortgage_find_early_repayment'));
  put(open('refinancing', 'mortgage_state_refinancing_open', 'mortgage_find_refinancing'));
  put(open('penalties', 'mortgage_state_penalties_open', 'mortgage_find_penalties'));

  return CHECKLIST.map(
    (item) => states.get(item.id) ?? open(item.id, 'mortgage_state_no_scenario', 'mortgage_find_no_scenario'),
  );
}

/** How many items the scenario can already speak to. */
export function knownCount(states: ChecklistState[]): number {
  return states.filter((s) => s.status === 'KNOWN').length;
}
