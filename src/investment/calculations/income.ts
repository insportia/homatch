// HOMATCH INVESTMENT INTELLIGENCE — income, vacancy, operating cost, yield.
//
// THE ONE RELATIONSHIP THIS FILE EXISTS TO GET RIGHT
//
//   annual income / purchase price = yield
//
// so at a FIXED purchase price, MORE sustainable income is a HIGHER yield.
// $100,000 earning $6,000 is 6%; the same $100,000 earning $8,000 is 8%, and
// 8% is the better income result on the same capital. The inverse — value
// falling as the required yield rises — lives in valuation.ts, and the two
// are kept in separate files precisely because they are the two directions
// people confuse.
//
// VACANCY IS COUNTED IN MONTHS
//
// Eleven collected months on a $500 flat is $5,500, and ten is $5,000. That
// is the arithmetic a landlord actually does, and expressing it as 8.33% and
// 16.67% occupancy loss is the same fact in a form nobody volunteers. The
// engine stores months and derives the rate, never the other way round.
//
// A COST NOBODY SUPPLIED IS A NAMED GAP, NOT A ZERO
//
// Net yield over three of the eight costs a property really has is not a net
// yield. Every absent category is listed in `knownGaps`, and the UI shows
// them beside the figure, because a reader cannot otherwise tell "this
// property has no service charge" from "nobody told us the service charge".

import type {
  Figure,
  IncomeModel,
  InvestedCapital,
  InvestmentInput,
  InvestmentOperatingCosts,
  OperatingExpenseBreakdown,
  OperatingExpenseLine,
  YieldModel,
} from '../types.ts';
import { figure, unavailable } from '../types.ts';
import { EPSILON, isNonNegative, isPositive, money, orZero, percentOf, rate } from './core.ts';

export const MONTHS_PER_YEAR = 12;

/** Every operating-cost category the engine knows how to account for. */
export const OPERATING_COST_KEYS = [
  'management',
  'maintenance',
  'repairs',
  'insurance',
  'propertyTax',
  'utilities',
  'hoa',
  'repairsReserve',
  'lettingFee',
  'other',
] as const;

export type OperatingCostKey = (typeof OPERATING_COST_KEYS)[number];

/** Occupied months, clamped to a real year and never silently defaulted. */
export function occupiedMonthsFor(input: InvestmentInput): number {
  const vacant = input.vacantMonthsPerYear;
  if (typeof vacant !== 'number' || !Number.isFinite(vacant)) return MONTHS_PER_YEAR;
  const clamped = Math.min(MONTHS_PER_YEAR, Math.max(0, vacant));
  return MONTHS_PER_YEAR - clamped;
}

/**
 * Twelve months of rent plus non-rent income. Nothing deducted.
 *
 * This is the number a portal advert implies and the number a seller quotes,
 * which is exactly why it is kept separate from what is actually collected.
 */
export function grossPotentialAnnualIncome(input: InvestmentInput): Figure {
  if (!isNonNegative(input.monthlyRent)) {
    return unavailable('MISSING_INPUT', 'monthlyRent');
  }
  return figure(money(input.monthlyRent * MONTHS_PER_YEAR + orZero(input.otherAnnualIncome)));
}

/** Rent lost to the vacant months the scenario assumes. Rent only — other
 *  income is not assumed to stop when a tenant leaves. */
export function vacancyLossAnnual(input: InvestmentInput): Figure {
  if (!isNonNegative(input.monthlyRent)) return unavailable('MISSING_INPUT', 'monthlyRent');
  const vacantMonths = MONTHS_PER_YEAR - occupiedMonthsFor(input);
  return figure(money(input.monthlyRent * vacantMonths));
}

/** What is actually collected in a year: gross potential less vacancy. */
export function effectiveGrossIncome(input: InvestmentInput): Figure {
  if (!isNonNegative(input.monthlyRent)) return unavailable('MISSING_INPUT', 'monthlyRent');
  return figure(
    money(input.monthlyRent * occupiedMonthsFor(input) + orZero(input.otherAnnualIncome)),
  );
}

/**
 * Operating costs, itemised, with the categories nobody supplied named.
 *
 * Management is charged on COLLECTED rent, not on potential rent: an agent
 * managing an empty flat does not take a percentage of the rent it is not
 * producing. Stated here because it is a modelling choice, not an obvious
 * fact, and the UI repeats it beside the line.
 */
export function operatingExpenses(
  input: InvestmentInput,
  collectedRentAnnual: number | null,
): OperatingExpenseBreakdown | null {
  const costs: InvestmentOperatingCosts = input.operating ?? {};
  const lines: OperatingExpenseLine[] = [];
  const present = new Set<OperatingCostKey>();

  const management = (() => {
    let total = 0;
    let any = false;
    if (isPositive(costs.managementPercentOfCollectedRent) && collectedRentAnnual !== null) {
      total += (collectedRentAnnual * costs.managementPercentOfCollectedRent) / 100;
      any = true;
    }
    if (isPositive(costs.managementFlatMonthly)) {
      total += costs.managementFlatMonthly * MONTHS_PER_YEAR;
      any = true;
    }
    return any ? total : null;
  })();
  if (management !== null) {
    lines.push({ key: 'management', annual: money(management) });
    present.add('management');
  }

  const simple: Array<[OperatingCostKey, number | undefined]> = [
    ['maintenance', costs.maintenanceAnnual],
    ['repairs', costs.repairsAnnual],
    ['insurance', costs.insuranceAnnual],
    ['propertyTax', costs.propertyTaxAnnual],
    ['utilities', costs.utilitiesPaidByOwnerAnnual],
    ['hoa', costs.hoaAnnual],
    ['repairsReserve', costs.repairsReserveAnnual],
    ['other', costs.otherOperatingAnnual],
  ];
  for (const [key, value] of simple) {
    if (isNonNegative(value) && value > 0) {
      lines.push({ key, annual: money(value) });
      present.add(key);
    }
  }

  if (isPositive(costs.lettingFeePerTenancy)) {
    const tenancies = isPositive(costs.tenanciesPerYear) ? costs.tenanciesPerYear : 1;
    lines.push({ key: 'lettingFee', annual: money(costs.lettingFeePerTenancy * tenancies) });
    present.add('lettingFee');
  }

  const knownGaps = OPERATING_COST_KEYS.filter((key) => !present.has(key));

  // Nothing at all was supplied. Returning an empty breakdown with a zero
  // total would let a "net" yield render that is identical to the gross one,
  // which is the single most misleading thing this product could show.
  if (lines.length === 0) return null;

  return {
    lines,
    totalAnnual: money(lines.reduce((sum, line) => sum + line.annual, 0)),
    knownGaps: [...knownGaps],
  };
}

/** Effective gross income less operating costs. Before any debt service. */
export function netOperatingIncome(
  effectiveGross: Figure,
  expenses: OperatingExpenseBreakdown | null,
): Figure {
  if (effectiveGross.value === null) {
    return unavailable(effectiveGross.unavailable ?? 'MISSING_INPUT', effectiveGross.detail);
  }
  if (!expenses) {
    return unavailable(
      'MISSING_INPUT',
      'no operating cost was supplied, so a net figure would be the gross one relabelled',
    );
  }
  return figure(money(effectiveGross.value - expenses.totalAnnual));
}

export function buildIncomeModel(input: InvestmentInput): IncomeModel {
  const occupied = occupiedMonthsFor(input);
  const gross = grossPotentialAnnualIncome(input);
  const effective = effectiveGrossIncome(input);
  const expenses = operatingExpenses(
    input,
    isNonNegative(input.monthlyRent) ? money(input.monthlyRent * occupied) : null,
  );

  return {
    grossPotentialAnnualIncome: gross,
    vacancyLossAnnual: vacancyLossAnnual(input),
    effectiveGrossIncome: effective,
    operatingExpenses: expenses,
    netOperatingIncome: netOperatingIncome(effective, expenses),
    occupiedMonths: occupied,
    occupancyRate: figure(rate((occupied / MONTHS_PER_YEAR) * 100)),
  };
}

/**
 * The four yields and the cash-on-cash figure.
 *
 * `annualDebtService` is passed in rather than computed here: debt is the
 * mortgage engine's business, and this file must not grow a second opinion
 * about what a payment is.
 */
export function buildYieldModel(
  income: IncomeModel,
  capital: InvestedCapital,
  purchasePrice: number,
  annualDebtService: number | null,
): YieldModel {
  const gross = income.grossPotentialAnnualIncome.value;
  const noi = income.netOperatingIncome.value;

  const cashOnCash = (() => {
    if (noi === null) {
      return unavailable('MISSING_INPUT', 'net operating income is not established');
    }
    if (!isPositive(capital.investorCashInvested)) {
      return unavailable('MISSING_INPUT', 'investor cash invested is not established');
    }
    const debt = annualDebtService ?? 0;
    return figure(rate(((noi - debt) / capital.investorCashInvested) * 100));
  })();

  return {
    grossYieldOnPurchasePrice: percentOf(gross, purchasePrice, 'grossPotentialAnnualIncome'),
    grossYieldOnInvestedCapital: percentOf(
      gross,
      capital.totalPropertyCapital,
      'grossPotentialAnnualIncome',
    ),
    netYieldOnPurchasePrice: percentOf(noi, purchasePrice, 'netOperatingIncome'),
    netYieldOnInvestedCapital: percentOf(
      noi,
      capital.totalPropertyCapital,
      'netOperatingIncome',
    ),
    cashOnCashReturn: cashOnCash,
  };
}

/**
 * The vacancy ladder: what each number of empty months does to the model.
 *
 * Returned as data rather than rendered, so the interface can animate one
 * continuous relationship instead of showing three disconnected cards.
 */
export interface VacancyScenario {
  vacantMonths: number;
  occupiedMonths: number;
  effectiveGrossIncome: number;
  grossYieldOnPurchasePrice: Figure;
  netOperatingIncome: Figure;
  netYieldOnPurchasePrice: Figure;
}

export function vacancyLadder(
  input: InvestmentInput,
  vacantMonthsOptions: readonly number[] = [0, 1, 2, 3],
): VacancyScenario[] {
  if (!isNonNegative(input.monthlyRent)) return [];
  const rent = input.monthlyRent;
  const out: VacancyScenario[] = [];
  for (const raw of vacantMonthsOptions) {
    const vacant = Math.min(MONTHS_PER_YEAR, Math.max(0, Math.round(raw)));
    const occupied = MONTHS_PER_YEAR - vacant;
    const collected = money(rent * occupied);
    const egi = money(collected + orZero(input.otherAnnualIncome));
    const expenses = operatingExpenses({ ...input, vacantMonthsPerYear: vacant }, collected);
    const noi = expenses
      ? figure(money(egi - expenses.totalAnnual))
      : unavailable('MISSING_INPUT', 'no operating cost supplied');
    out.push({
      vacantMonths: vacant,
      occupiedMonths: occupied,
      effectiveGrossIncome: egi,
      grossYieldOnPurchasePrice: percentOf(egi, input.purchasePrice, 'effectiveGrossIncome'),
      netOperatingIncome: noi,
      netYieldOnPurchasePrice: percentOf(noi.value, input.purchasePrice, 'netOperatingIncome'),
    });
  }
  return out;
}

/** Guard so a caller cannot divide by an income of exactly zero downstream. */
export function hasPositiveIncome(value: number | null): value is number {
  return value !== null && value > EPSILON;
}
