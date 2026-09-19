// HOMATCH INVESTMENT INTELLIGENCE — from what the investor typed to what
// each engine needs.
//
// WHY THIS LAYER EXISTS AT ALL
//
// The forms let people answer in whichever unit they actually have. Some
// investors know a total renovation budget; others work in cost per m².
// Some have a resale price; others have a resale price per m². A portal
// gives a price, a developer gives a rate. All of those are the SAME fact
// and the engine should only ever see one of them.
//
// Resolving that here — once, in code with tests — rather than in four
// forms and four result screens is the difference between "the per-m²
// figure works on this screen" and "the per-m² figure works".
//
// THE RULE WHEN BOTH ARE PRESENT
//
// The TOTAL wins. A per-m² figure is nearly always a rule of thumb somebody
// used to reach a total, and where they have gone to the trouble of stating
// the total it is the more specific claim. The derived value is never
// written back into the context, so the investor's own entry is what they
// see and what they can change.

import type { InvestmentInput } from '../types.ts';
import type { InvestmentContext } from '../consultant/context.ts';
import { toInvestmentInput } from '../consultant/context.ts';
import type { ConstructionInput } from '../calculations/construction.ts';
import type { RenovateResellInputs } from '../calculations/renovate.ts';
import type {
  ConstructionValueInput,
  RenovationValueInput,
  RentalValueInput,
  ValueStrategy,
} from '../calculations/acquisitionValue.ts';
import type { StrategyId } from './definitions.ts';

const num = (context: InvestmentContext, field: string): number | undefined =>
  (context as Record<string, { value?: unknown } | undefined>)[field]?.value as number | undefined;

const text = (context: InvestmentContext, field: string): string | undefined =>
  (context as Record<string, { value?: unknown } | undefined>)[field]?.value as string | undefined;

const positive = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/** A total, or a rate × area. The total wins when both are present. */
export function totalOrPerSqm(
  total: number | undefined,
  perSqm: number | undefined,
  areaSqm: number | undefined,
): number | undefined {
  if (positive(total)) return total;
  if (positive(perSqm) && positive(areaSqm)) return perSqm * areaSqm;
  return undefined;
}

/**
 * The engine input, with every per-m² alternative already resolved.
 *
 * Built on top of toInvestmentInput rather than replacing it: that function
 * is the one door from provenanced context to plain input and stays so. This
 * adds only the unit resolution and the two operating-cost lines the forms
 * collect in a different shape from the engine.
 */
/**
 * What a choice gate MEANS to the engine.
 *
 * The gates decide which questions get asked; they also have to decide what
 * the engine sees, or the two drift. Somebody who switches from Mortgage
 * back to Cash has a stale interest rate sitting in their context, and an
 * engine that still reads it would keep modelling a loan the investor has
 * just said they are not taking. Cheaper and clearer to strip it here than
 * to clear fields on every toggle and hope nothing was missed.
 */
export function applyGateEffects(context: InvestmentContext, input: InvestmentInput): InvestmentInput {
  const next: InvestmentInput = { ...input };

  if (text(context, 'financingMode') === 'CASH') {
    delete next.financing;
  }

  if (text(context, 'renovationNeeded') === 'NO') {
    delete next.renovationCost;
  }

  if (text(context, 'includeExitScenario') === 'NO') {
    delete next.exitPriceAssumption;
  }

  return next;
}

/**
 * Months after completion, from the timing the investor clicked.
 *
 * "At completion" is zero and "six months later" is six; only Custom asks
 * for a number, and only then is the stored field read.
 */
export function monthsAfterCompletionFor(context: InvestmentContext): number | undefined {
  switch (text(context, 'exitTiming')) {
    case 'AT_COMPLETION':
      return 0;
    case 'PLUS_6':
      return 6;
    case 'PLUS_12':
      return 12;
    case 'CUSTOM':
      return num(context, 'additionalMonthsToSale');
    default:
      return num(context, 'additionalMonthsToSale');
  }
}

export function resolveInvestmentInput(context: InvestmentContext): InvestmentInput | null {
  const areaSqm = num(context, 'areaSqm');

  // A price given only per m² still has to satisfy toInvestmentInput's
  // requirement for a purchase price, so it is resolved before the call.
  const purchasePrice = totalOrPerSqm(
    num(context, 'purchasePrice'),
    num(context, 'purchasePricePerSqm'),
    areaSqm,
  );
  if (!positive(purchasePrice)) return null;

  const base = toInvestmentInput({
    ...context,
    purchasePrice: { value: purchasePrice, origin: context.purchasePrice?.origin ?? 'DERIVED', at: context.purchasePrice?.at ?? new Date().toISOString() },
  });
  if (!base) return null;

  const exitPrice = totalOrPerSqm(
    num(context, 'exitPriceAssumption'),
    num(context, 'expectedResalePricePerSqm'),
    areaSqm,
  );

  const hoaMonthly = num(context, 'hoaMonthly');

  return applyGateEffects(context, {
    ...base,
    ...(exitPrice !== undefined ? { exitPriceAssumption: exitPrice } : {}),
    ...(positive(hoaMonthly)
      ? { operating: { ...(base.operating ?? {}), hoaAnnual: hoaMonthly * 12 } }
      : {}),
  });
}

/* ── Construction resale ────────────────────────────────────────────── */

export function resolveConstructionInput(
  context: InvestmentContext,
): ConstructionInput | null {
  const areaSqm = num(context, 'areaSqm');
  const purchasePrice = totalOrPerSqm(
    num(context, 'purchasePrice'),
    num(context, 'purchasePricePerSqm'),
    areaSqm,
  );
  if (!positive(purchasePrice)) return null;

  return {
    currency: text(context, 'currency') ?? 'USD',
    purchasePrice,
    areaSqm,
    acquisitionCosts: num(context, 'acquisitionCosts'),
    upfrontPayment: num(context, 'upfrontPayment'),
    installmentMonthly: num(context, 'installmentMonthly'),
    installmentCount: num(context, 'installmentCount'),
    remainingDeveloperBalance: num(context, 'remainingDeveloperBalance'),
    monthsToCompletion: num(context, 'monthsToCompletion'),
    additionalMonthsToSale: monthsAfterCompletionFor(context),
    expectedCompletedPrice: num(context, 'expectedCompletedPrice'),
    expectedCompletedPricePerSqm: num(context, 'expectedCompletedPricePerSqm'),
    monthlyHoldingCosts: num(context, 'monthlyHoldingCosts'),
    financingCosts: num(context, 'financingCosts'),
    sellingCostPercent: num(context, 'sellingCostPercent'),
    sellingCostAmount: num(context, 'sellingCostAmount'),
    targetReturnPercent: num(context, 'targetReturnPercent'),
  };
}

/* ── Renovate and resell ────────────────────────────────────────────── */

export function resolveRenovationExtras(
  context: InvestmentContext,
): Pick<
  RenovateResellInputs,
  'monthlyHoldingCosts' | 'renovationCostPerSqm' | 'otherRenovationCosts' | 'targetReturnPercent'
> {
  return {
    monthlyHoldingCosts: num(context, 'monthlyHoldingCosts'),
    renovationCostPerSqm: num(context, 'renovationCostPerSqm'),
    otherRenovationCosts: num(context, 'otherRenovationCosts'),
    targetReturnPercent: num(context, 'targetReturnPercent'),
  };
}

/**
 * The renovation spend, resolved before the engine sees it.
 *
 * Folded into the InvestmentInput rather than passed alongside, so the
 * capital model, the hold ledger and the flip summary all read one number.
 */
export function withResolvedRenovation(
  input: InvestmentInput,
  context: InvestmentContext,
): InvestmentInput {
  const resolved = totalOrPerSqm(
    num(context, 'renovationCost'),
    num(context, 'renovationCostPerSqm'),
    num(context, 'areaSqm'),
  );
  return resolved === undefined ? input : { ...input, renovationCost: resolved };
}

/* ── Investment value ───────────────────────────────────────────────── */

export function resolveValueStrategy(context: InvestmentContext): ValueStrategy {
  const chosen = text(context, 'valueStrategy');
  if (chosen === 'RENOVATE_RESELL' || chosen === 'CONSTRUCTION_RESALE') return chosen;
  return 'RENTAL_INVESTMENT';
}

export function resolveRentalValueInput(
  context: InvestmentContext,
  netOperatingIncome: number,
): RentalValueInput {
  return {
    currency: text(context, 'currency') ?? 'USD',
    netOperatingIncome,
    targetYieldPercent: num(context, 'benchmarkYieldPercent') ?? 0,
    acquisitionCostPercent: num(context, 'acquisitionCostPercent'),
    acquisitionCostsFlat: num(context, 'acquisitionCosts'),
    upfrontWorks: num(context, 'renovationCost'),
    areaSqm: num(context, 'areaSqm'),
    proposedPrice: num(context, 'proposedPrice'),
  };
}

export function resolveRenovationValueInput(
  context: InvestmentContext,
): RenovationValueInput | null {
  const areaSqm = num(context, 'areaSqm');
  const resale = totalOrPerSqm(
    num(context, 'exitPriceAssumption'),
    num(context, 'expectedResalePricePerSqm'),
    areaSqm,
  );
  if (!positive(resale)) return null;
  const months = num(context, 'holdMonths') ?? 0;
  const monthlyHolding = num(context, 'monthlyHoldingCosts') ?? 0;
  return {
    currency: text(context, 'currency') ?? 'USD',
    expectedResalePrice: resale,
    renovationCost: totalOrPerSqm(
      num(context, 'renovationCost'),
      num(context, 'renovationCostPerSqm'),
      areaSqm,
    ),
    furnishingCost: num(context, 'furnishingCost'),
    holdingCosts: months > 0 ? monthlyHolding * months : monthlyHolding,
    sellingCostPercent: num(context, 'sellingCostPercent'),
    sellingCostAmount: num(context, 'sellingCostAmount'),
    acquisitionCostPercent: num(context, 'acquisitionCostPercent'),
    acquisitionCostsFlat: num(context, 'acquisitionCosts'),
    targetReturnPercent: num(context, 'targetReturnPercent'),
    areaSqm,
    proposedPrice: num(context, 'proposedPrice'),
  };
}

export function resolveConstructionValueInput(
  context: InvestmentContext,
): ConstructionValueInput | null {
  const areaSqm = num(context, 'areaSqm');
  const completed = totalOrPerSqm(
    num(context, 'expectedCompletedPrice'),
    num(context, 'expectedCompletedPricePerSqm'),
    areaSqm,
  );
  if (!positive(completed)) return null;
  const months = num(context, 'holdMonths') ?? num(context, 'monthsToCompletion') ?? 0;
  const monthlyHolding = num(context, 'monthlyHoldingCosts') ?? 0;
  return {
    currency: text(context, 'currency') ?? 'USD',
    expectedCompletedPrice: completed,
    remainingPayments: num(context, 'remainingDeveloperBalance'),
    holdingCosts: months > 0 ? monthlyHolding * months : monthlyHolding,
    financingCosts: num(context, 'financingCosts'),
    sellingCostPercent: num(context, 'sellingCostPercent'),
    sellingCostAmount: num(context, 'sellingCostAmount'),
    acquisitionCostPercent: num(context, 'acquisitionCostPercent'),
    acquisitionCostsFlat: num(context, 'acquisitionCosts'),
    targetReturnPercent: num(context, 'targetReturnPercent'),
    areaSqm,
    proposedPrice: num(context, 'proposedPrice'),
  };
}

/** Whether a field has a usable value, for the completeness check. */
export function isFilled(context: InvestmentContext, field: string): boolean {
  const entry = (context as Record<string, { value?: unknown } | undefined>)[field];
  if (!entry || entry.value === undefined || entry.value === null) return false;
  if (typeof entry.value === 'string') return entry.value.trim().length > 0;
  return Number.isFinite(entry.value as number);
}

/** The strategies a given context could run right now, for the home cards. */
export function strategyNeedsArea(strategy: StrategyId): boolean {
  return strategy === 'RENOVATE_RESELL' || strategy === 'CONSTRUCTION_RESALE';
}
