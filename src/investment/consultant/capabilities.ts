// HOMATCH INVESTMENT INTELLIGENCE — which analysis is relevant right now.
//
// WHY THE PRODUCT DOES NOT SHOW EVERY MODULE AT ONCE
//
// An investor who has typed one sentence does not need a stress-test matrix,
// an exit-delay ladder and a capital-flow diagram on screen. They need the
// two or three things their sentence was actually about, and the rest as it
// becomes answerable. That is a real product decision and it needs a real
// rule, not a designer's intuition applied case by case.
//
// The rule is here: a capability is RELEVANT when the context carries what
// it needs, and PROPOSED when the conversation pointed at it. The interface
// reveals in that order, so the page assembles itself around the
// consultation instead of being a wall of cards that happens to be mostly
// empty.
//
// THE AI CHOOSES FROM THIS LIST; IT DOES NOT INVENT ENTRIES
//
// `focus` on the Consultant's reply is validated against CAPABILITY_IDS, so
// a model cannot surface a module that does not exist, and the mapping from
// "რამდენ წელში ამოვიღებ ფულს?" to the payback module is a decision the
// model makes inside a fixed, reviewable vocabulary.

import type { InvestmentModel } from '../types.ts';
import type { InvestmentContext } from './context.ts';

export const CAPABILITY_IDS = [
  'INCOME_AND_YIELD',
  'INCOME_IMPLIED_VALUE',
  'VACANCY_REALITY',
  'MONEY_BACK',
  'FINANCING',
  'CASH_FLOW',
  'HOLD_AND_SELL',
  'RENOVATE_AND_SELL',
  'EXIT_DELAY',
  'BREAK_EVEN',
  'STRESS_TEST',
  'CAPITAL_FLOW',
  'MARKET_EVIDENCE',
] as const;

export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export type CapabilityState =
  /** Every input it needs is present. Show it, with real numbers. */
  | 'READY'
  /** It has something to show but is missing inputs that would sharpen it. */
  | 'PARTIAL'
  /** It cannot say anything yet. Offered as a question, not as an empty card. */
  | 'NEEDS_INPUT';

export interface CapabilityStatus {
  id: CapabilityId;
  state: CapabilityState;
  /** i18n keys naming what it still wants. */
  missing: string[];
  /**
   * True for a capability the investor has to OPT INTO rather than one the
   * consultation is incomplete without.
   *
   * Renovate-and-sell is the case this exists for. A buy-and-hold landlord
   * has no renovation, and treating its absence as a gap would make the
   * Consultant ask "how much is the renovation?" of somebody who never
   * mentioned one — which reads as the product not listening. An opt-in
   * capability stays off the question list and appears the moment a
   * renovation figure does.
   */
  optIn?: boolean;
}

const ALL: ReadonlySet<string> = new Set(CAPABILITY_IDS);

export function isCapabilityId(value: unknown): value is CapabilityId {
  return typeof value === 'string' && ALL.has(value);
}

function has(context: InvestmentContext, key: keyof InvestmentContext): boolean {
  const entry = context[key];
  return entry !== undefined && entry !== null;
}

/**
 * The state of every capability, given what the consultation knows.
 *
 * Deliberately computed from the CONTEXT rather than from the model output:
 * a capability's readiness is about whether the investor has told us
 * enough, which is a question about inputs. Reading it off the output would
 * conflate "we cannot answer" with "the answer happens to be zero".
 */
export function capabilityStatuses(
  context: InvestmentContext,
  model: InvestmentModel | null,
): CapabilityStatus[] {
  const rent = has(context, 'monthlyRent');
  const costs =
    has(context, 'maintenanceAnnual') ||
    has(context, 'managementPercentOfCollectedRent') ||
    has(context, 'managementFlatMonthly') ||
    has(context, 'repairsAnnual') ||
    has(context, 'insuranceAnnual') ||
    has(context, 'propertyTaxAnnual') ||
    has(context, 'utilitiesPaidByOwnerAnnual') ||
    has(context, 'otherOperatingAnnual');
  const financed = model?.leverage.financed === true;
  const financingDescribed =
    has(context, 'mortgageAnnualRatePercent') ||
    has(context, 'mortgageTermMonths') ||
    has(context, 'downPaymentPercent') ||
    has(context, 'downPaymentAmount');
  const exit = has(context, 'exitPriceAssumption');
  const renovation = has(context, 'renovationCost') || has(context, 'furnishingCost');
  const benchmark = has(context, 'benchmarkYieldPercent');
  const area = has(context, 'areaSqm');
  const location = has(context, 'city');

  const status = (
    id: CapabilityId,
    ready: boolean,
    partial: boolean,
    missing: string[],
  ): CapabilityStatus => ({
    id,
    state: ready ? 'READY' : partial ? 'PARTIAL' : 'NEEDS_INPUT',
    missing: ready ? [] : missing,
  });

  return [
    status('INCOME_AND_YIELD', rent && costs, rent, [
      ...(rent ? [] : ['inv_need_monthly_rent']),
      ...(costs ? [] : ['inv_need_operating_costs']),
    ]),
    status('INCOME_IMPLIED_VALUE', rent && benchmark, rent, [
      ...(rent ? [] : ['inv_need_monthly_rent']),
      ...(benchmark ? [] : ['inv_need_benchmark_yield']),
    ]),
    status('VACANCY_REALITY', rent, rent, rent ? [] : ['inv_need_monthly_rent']),
    status('MONEY_BACK', rent && costs, rent, [
      ...(rent ? [] : ['inv_need_monthly_rent']),
      ...(costs ? [] : ['inv_need_operating_costs']),
    ]),
    status('FINANCING', financed, financingDescribed, [
      ...(has(context, 'downPaymentPercent') || has(context, 'downPaymentAmount')
        ? []
        : ['inv_need_down_payment']),
      ...(has(context, 'mortgageAnnualRatePercent') ? [] : ['inv_need_mortgage_rate']),
      ...(has(context, 'mortgageTermMonths') ? [] : ['inv_need_mortgage_term']),
    ]),
    status('CASH_FLOW', rent && costs, rent, [
      ...(rent ? [] : ['inv_need_monthly_rent']),
      ...(costs ? [] : ['inv_need_operating_costs']),
    ]),
    status('HOLD_AND_SELL', exit && rent, exit || rent, [
      ...(exit ? [] : ['inv_need_exit_price']),
      ...(rent ? [] : ['inv_need_monthly_rent']),
    ]),
    {
      ...status('RENOVATE_AND_SELL', renovation && exit, renovation, [
        ...(renovation ? [] : ['inv_need_renovation']),
        ...(exit ? [] : ['inv_need_exit_price']),
      ]),
      optIn: true,
    },
    status('EXIT_DELAY', exit, exit, exit ? [] : ['inv_need_exit_price']),
    status('BREAK_EVEN', rent && costs, rent, [
      ...(rent ? [] : ['inv_need_monthly_rent']),
      ...(costs ? [] : ['inv_need_operating_costs']),
    ]),
    status('STRESS_TEST', rent && exit, rent || exit, [
      ...(rent ? [] : ['inv_need_monthly_rent']),
      ...(exit ? [] : ['inv_need_exit_price']),
    ]),
    status('CAPITAL_FLOW', rent && exit, true, [
      ...(rent ? [] : ['inv_need_monthly_rent']),
      ...(exit ? [] : ['inv_need_exit_price']),
    ]),
    // Market evidence needs somewhere to look. A city with nothing narrowing
    // it is "every flat in Tbilisi", which the Research Core itself refuses
    // (see seedSupportsMarketSearch) — so the bar here matches that bar
    // rather than inviting a request the core will decline.
    status('MARKET_EVIDENCE', location && (has(context, 'district') || area), location, [
      ...(location ? [] : ['inv_need_city']),
      ...(has(context, 'district') || area ? [] : ['inv_need_district_or_area']),
    ]),
  ];
}

/** The ones worth putting on screen, in the order they become useful. */
export function readyCapabilities(statuses: readonly CapabilityStatus[]): CapabilityId[] {
  return statuses.filter((s) => s.state === 'READY').map((s) => s.id);
}

/**
 * The Consultant's next questions, deduplicated and ordered.
 *
 * Ordered by how many capabilities each answer would unlock, so the first
 * question asked is the one that opens the most of the product. That is a
 * better ordering than "the order the fields happen to be declared in", and
 * it is why a consultation that starts with a price is asked about rent
 * before it is asked about the letting fee.
 */
export function nextQuestions(statuses: readonly CapabilityStatus[], limit = 4): string[] {
  const weight = new Map<string, number>();
  for (const status of statuses) {
    if (status.state === 'READY') continue;
    // An opt-in capability's absence is not a question. See CapabilityStatus.
    if (status.optIn && status.state === 'NEEDS_INPUT') continue;
    for (const key of status.missing) weight.set(key, (weight.get(key) ?? 0) + 1);
  }
  return [...weight.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key]) => key);
}
