// estimate.ts — the deterministic money.
//
// PART P is explicit: an LLM may propose scope, quantities and assumptions,
// but it must NEVER produce the arithmetic. Everything here is pure and
// reproducible: same inputs, same totals, every time. AI output only ever
// enters as structured quantities that have already been made explicit.
//
// Structure of a total:
//   materials  = quantity x (1 + waste) x material price
//   labour     = quantity x labour price          (labour is not "wasted")
//   soft costs = design, management, logistics, disposal, cleaning
//   contingency= a reserve sized by how much is genuinely unknown
//
// PART AI: customer-facing totals must not pretend to a precision the input
// data cannot support, so headline figures are rounded and presented as a
// range while line items stay exact enough to add up.

import { type PriceBook, type PriceItem, findItem, assertPriceBookUsable } from './priceBook.ts';
import { type Condition, type Quantities, type Assumption } from './quantities.ts';

export type Tier = 'low' | 'typical' | 'high';
export type RenovationLevel = 'COSMETIC' | 'BUDGET' | 'STANDARD' | 'UPPER_STANDARD' | 'PREMIUM' | 'DESIGNER';

export interface ScenarioInput {
  quantities: Quantities;
  condition: Condition;
  totalArea: number;
  level: RenovationLevel;
  /** Overall material grade. */
  materialTier: Tier;
  /** Per-item overrides, so "standard everywhere but a premium bathroom" is
   * expressible (PART N). */
  itemTierOverrides?: Record<string, Tier>;
  labourTier?: Tier;
  includeSoftCosts?: boolean;
  /** Explicitly opt in to using an unreviewed price book. */
  allowProvisionalPrices?: boolean;
  /**
   * Only these price-item keys may be costed.
   *
   * The configurator's output. When absent, every item with a quantity is
   * priced, which is the old behaviour and still correct for a quick
   * property-level estimate. When present, work the customer skipped or has
   * not decided on is not silently priced anyway -- which is the entire
   * point of asking them.
   */
  includedItemKeys?: string[];
}

export interface LineItem {
  key: string;
  category: string;
  label: string;
  unit: string;
  quantity: number;
  quantityWithWaste: number;
  wasteFactor: number;
  materialUnit: number | null;
  labourUnit: number;
  materialTotal: number;
  labourTotal: number;
  total: number;
}

export interface SoftCosts {
  design: number;
  projectManagement: number;
  logistics: number;
  debrisDisposal: number;
  finalCleaning: number;
  total: number;
}

export interface Estimate {
  currency: 'GEL';
  priceBookVersion: number;
  provisionalPrices: boolean;
  lineItems: LineItem[];
  materials: number;
  labour: number;
  softCosts: SoftCosts;
  /** materials + labour + soft costs, before reserve. */
  baseTotal: number;
  contingency: { rate: number; amount: number; drivers: string[] };
  /** What the customer should actually plan for. */
  planningBudget: number;
  perSqm: number;
  /** Honest presentation — see roundForCustomer(). */
  display: { typical: number; rangeLow: number; rangeHigh: number; contingency: number };
  byCategory: Record<string, number>;
  assumptions: Assumption[];
}

/** Level shifts the DEFAULT material grade but never removes required work —
 * PART AA: a cheaper scenario must not secretly omit necessary items. */
const LEVEL_TIER: Record<RenovationLevel, Tier> = {
  COSMETIC: 'low',
  BUDGET: 'low',
  STANDARD: 'typical',
  UPPER_STANDARD: 'typical',
  PREMIUM: 'high',
  DESIGNER: 'high',
};

/** Soft costs as a share of construction cost. Design effort rises sharply
 * with finish ambition; logistics and disposal do not. */
const SOFT_RATES: Record<RenovationLevel, { design: number; management: number }> = {
  COSMETIC: { design: 0, management: 0.03 },
  BUDGET: { design: 0.01, management: 0.04 },
  STANDARD: { design: 0.03, management: 0.05 },
  UPPER_STANDARD: { design: 0.05, management: 0.06 },
  PREMIUM: { design: 0.07, management: 0.07 },
  DESIGNER: { design: 0.1, management: 0.08 },
};

function tierFor(item: PriceItem, input: ScenarioInput): Tier {
  return input.itemTierOverrides?.[item.key] ?? input.materialTier ?? LEVEL_TIER[input.level];
}

/**
 * Contingency (PART W). Sized by what is genuinely unknown, not a flat
 * percentage: stripping out an old renovation exposes surprises that a bare
 * black frame simply does not have.
 */
export function contingencyRate(condition: Condition, level: RenovationLevel): { rate: number; drivers: string[] } {
  const drivers: string[] = [];
  let rate = 0.07;

  if (condition === 'OLD_RENOVATION') {
    rate += 0.06;
    drivers.push('existing finishes must be removed, which can reveal hidden problems');
  } else if (condition === 'USABLE_RENOVATION') {
    rate += 0.03;
    drivers.push('partial strip-out of existing work');
  } else if (condition === 'BLACK_FRAME') {
    rate += 0.02;
    drivers.push('all services are installed from scratch');
  }

  if (level === 'DESIGNER' || level === 'PREMIUM') {
    rate += 0.03;
    drivers.push('bespoke finishes are harder to price precisely in advance');
  }
  if (drivers.length === 0) drivers.push('normal allowance for preliminary estimates');
  return { rate: Math.round(rate * 100) / 100, drivers };
}

export function calculateEstimate(book: PriceBook, input: ScenarioInput): Estimate {
  const usable = assertPriceBookUsable(book, input.allowProvisionalPrices === true);
  if (!usable.usable) {
    throw new Error(
      `price book is not usable for customer estimates: ${usable.reason} ` +
        `(${usable.provisional} of ${usable.provisional + usable.reviewed} items unreviewed)`
    );
  }

  const labourTier: Tier = input.labourTier ?? 'typical';
  const lineItems: LineItem[] = [];
  const byCategory: Record<string, number> = {};

  const allowed = input.includedItemKeys ? new Set(input.includedItemKeys) : null;

  for (const [key, quantity] of Object.entries(input.quantities.byItem)) {
    const item = findItem(book, key);
    if (!item || quantity <= 0) continue;
    // Not chosen by the customer, so not in their total.
    if (allowed && !allowed.has(key)) continue;

    const mTier = tierFor(item, input);
    const quantityWithWaste = round2(quantity * (1 + item.wasteFactor));
    const materialUnit = item.material ? item.material[mTier] : null;

    // Waste applies to MATERIAL only. Labour is paid on work done.
    const materialTotal = materialUnit === null ? 0 : round2(quantityWithWaste * materialUnit);
    const labourTotal = round2(quantity * item.labour[labourTier]);
    const total = round2(materialTotal + labourTotal);

    lineItems.push({
      key,
      category: item.category,
      label: item.label,
      unit: item.unit,
      quantity: round2(quantity),
      quantityWithWaste,
      wasteFactor: item.wasteFactor,
      materialUnit,
      labourUnit: item.labour[labourTier],
      materialTotal,
      labourTotal,
      total,
    });
    byCategory[item.category] = round2((byCategory[item.category] || 0) + total);
  }

  const materials = round2(lineItems.reduce((s, l) => s + l.materialTotal, 0));
  const labour = round2(lineItems.reduce((s, l) => s + l.labourTotal, 0));
  const construction = round2(materials + labour);

  const rates = SOFT_RATES[input.level];
  const softCosts: SoftCosts = input.includeSoftCosts === false
    ? { design: 0, projectManagement: 0, logistics: 0, debrisDisposal: 0, finalCleaning: 0, total: 0 }
    : (() => {
        const design = round2(construction * rates.design);
        const projectManagement = round2(construction * rates.management);
        const logistics = round2(construction * 0.02);
        const debrisDisposal = round2(input.totalArea * 12);
        const finalCleaning = round2(input.totalArea * 8);
        return {
          design,
          projectManagement,
          logistics,
          debrisDisposal,
          finalCleaning,
          total: round2(design + projectManagement + logistics + debrisDisposal + finalCleaning),
        };
      })();

  const baseTotal = round2(construction + softCosts.total);
  const { rate, drivers } = contingencyRate(input.condition, input.level);
  const contingencyAmount = round2(baseTotal * rate);
  const planningBudget = round2(baseTotal + contingencyAmount);

  return {
    currency: 'GEL',
    priceBookVersion: book.version,
    provisionalPrices: usable.provisional > 0,
    lineItems,
    materials,
    labour,
    softCosts,
    baseTotal,
    contingency: { rate, amount: contingencyAmount, drivers },
    planningBudget,
    perSqm: input.totalArea > 0 ? round2(planningBudget / input.totalArea) : 0,
    display: roundForCustomer(planningBudget, contingencyAmount),
    byCategory,
    assumptions: input.quantities.assumptions,
  };
}

/**
 * PART AI — no false precision. "83,472.18 GEL" claims an accuracy a
 * preliminary estimate cannot have. Headline numbers are rounded to a
 * sensible step and shown as a range.
 */
export function roundForCustomer(planningBudget: number, contingency: number) {
  const step = planningBudget >= 100000 ? 5000 : planningBudget >= 20000 ? 1000 : 500;
  const typical = Math.round(planningBudget / step) * step;
  return {
    typical,
    rangeLow: Math.round((planningBudget * 0.9) / step) * step,
    rangeHigh: Math.round((planningBudget * 1.12) / step) * step,
    contingency: Math.round(contingency / (step / 2)) * (step / 2),
  };
}

/**
 * Three scenarios over the SAME scope (PART AA). Only material grade and
 * labour tier move — never the work list, so the cheap option is honest
 * rather than quietly incomplete.
 */
export function buildScenarios(book: PriceBook, input: ScenarioInput) {
  const same = { ...input, itemTierOverrides: input.itemTierOverrides };
  const economy = calculateEstimate(book, { ...same, materialTier: 'low', labourTier: 'low' });
  const recommended = calculateEstimate(book, { ...same, materialTier: 'typical', labourTier: 'typical' });
  const premium = calculateEstimate(book, { ...same, materialTier: 'high', labourTier: 'typical' });

  // The invariant that makes the comparison honest.
  const keys = (e: Estimate) => e.lineItems.map((l) => l.key).sort().join(',');
  if (keys(economy) !== keys(recommended) || keys(recommended) !== keys(premium)) {
    throw new Error('scenarios must cover identical scope');
  }
  return { economy, recommended, premium };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
