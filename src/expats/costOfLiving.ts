// HOMATCH FOR EXPATS — what a month here would cost, worked out rather than
// asserted.
//
// WHY THE ENGINE NEVER HOLDS A PRICE
//
// There is not one number in this file. Every amount comes in as an
// `ObservedMoney` the caller loaded from `expat_cost_observations`, each
// carrying where it was seen, when, in which city and over how many
// observations. A constant here would be a price with no source that would
// still be sitting in the bundle two years from now, quietly wrong, and it
// would be the number a stranger used to decide whether they could afford
// to move country.
//
// WHY THE ANSWER IS A RANGE
//
// Adding midpoints gives a single confident total that nobody can reproduce
// and everybody will budget against. So the low bounds are summed into a low
// total and the high bounds into a high total, and the product shows both.
// That total is honest about the one thing a foreigner most needs to know:
// how much the answer could move.
//
// It does mean the range widens as categories are added — the arithmetic
// assumes a cheap month is cheap in every category at once, which is not how
// a month goes. The alternative is to narrow the band with an assumption
// about correlation that we have no data for, and an invented narrowing
// would read as precision we have not got. A wide honest band beats a narrow
// invented one, and `spreadRatio()` lets the UI say when the band is wide
// enough that the reader should be told why.
//
// WHY RENT IS IN THE MONTHLY TOTAL AND A PURCHASE PRICE IS NOT
//
// §27. Rent is what a month costs. A purchase is capital, and a mortgage
// payment is the only part of a purchase that lands in a month. Mixing a
// property price into a monthly budget produces a number that describes
// nothing, so `CATEGORY_KINDS` marks which categories are monthly and
// `monthlyBudget` refuses anything that is not.

import type { ExpatProfile, Household, ObservedMoney } from './types.ts';
import { midpoint } from './types.ts';

/* ── The categories a month is made of ────────────────────────────────── */

export const COST_CATEGORIES = [
  'RENT',
  'UTILITIES',
  'INTERNET',
  'MOBILE',
  'GROCERIES',
  'RESTAURANTS',
  'TRANSPORT',
  'HEALTHCARE',
  'INSURANCE',
  'GYM',
  'ENTERTAINMENT',
  'CHILDCARE',
  'SCHOOL',
  'CAR',
  'HOUSEHOLD_HELP',
  'COWORKING',
  'OTHER',
] as const;

export type CostCategory = (typeof COST_CATEGORIES)[number];

/**
 * Categories that only exist for some households.
 *
 * A single person is not shown a childcare line at zero — a row of zeroes
 * reads as "we checked and it is free", and it pushes the lines that matter
 * off the first screen. `applicableCategories` decides membership from the
 * profile, and anything not applicable is absent rather than nil.
 */
const REQUIRES_CHILDREN: ReadonlySet<CostCategory> = new Set(['CHILDCARE', 'SCHOOL']);
const REQUIRES_VEHICLE: ReadonlySet<CostCategory> = new Set(['CAR']);
const REQUIRES_REMOTE_WORK: ReadonlySet<CostCategory> = new Set(['COWORKING']);

/**
 * Which categories belong in this household's month.
 *
 * Unknown profile fields INCLUDE the category rather than excluding it. A
 * visitor who has told us nothing should see the full picture and remove
 * what does not apply; starting them on a budget that silently omits school
 * fees would understate the cost of moving a family here, which is the
 * expensive direction to be wrong in.
 */
export function applicableCategories(profile: ExpatProfile): CostCategory[] {
  const hasChildren =
    profile.childrenCount === null
      ? profile.household !== 'ALONE' && profile.household !== 'COUPLE'
      : profile.childrenCount > 0;
  const hasCar = profile.hasVehicle !== false;
  const remote = profile.workStatus === null || profile.workStatus === 'REMOTE';

  return COST_CATEGORIES.filter((c) => {
    if (REQUIRES_CHILDREN.has(c) && !hasChildren) return false;
    if (REQUIRES_VEHICLE.has(c) && !hasCar) return false;
    if (REQUIRES_REMOTE_WORK.has(c) && !remote) return false;
    return true;
  });
}

/* ── Household scaling ────────────────────────────────────────────────── */

/**
 * How much of a category a household of this shape uses, relative to the
 * one-person observation the data is recorded against.
 *
 * These are ARITHMETIC ASSUMPTIONS, not measurements, and the product says
 * so: a budget line built with a multiplier other than 1 is labelled
 * `SCALED` in its `basis`, so the reader can see that the number was
 * derived from a single-person observation rather than observed for their
 * household.
 *
 * Rent does not scale with headcount — a couple rents one flat, not two —
 * so it is deliberately 1 everywhere and only the bedroom count a person
 * chooses moves it. Groceries and restaurants scale close to linearly.
 * Utilities scale weakly: a second person adds hot water, not a second
 * radiator.
 */
const HOUSEHOLD_SCALE: Record<Household, Partial<Record<CostCategory, number>>> = {
  ALONE: {},
  COUPLE: {
    GROCERIES: 1.8,
    RESTAURANTS: 1.9,
    UTILITIES: 1.25,
    TRANSPORT: 1.8,
    HEALTHCARE: 2,
    INSURANCE: 2,
    GYM: 2,
    ENTERTAINMENT: 1.7,
    MOBILE: 2,
  },
  FAMILY: {
    GROCERIES: 2.6,
    RESTAURANTS: 2.4,
    UTILITIES: 1.5,
    TRANSPORT: 2.4,
    HEALTHCARE: 3,
    INSURANCE: 3,
    GYM: 2,
    ENTERTAINMENT: 2.2,
    MOBILE: 2.6,
  },
};

/**
 * The multiplier for a category, given the household.
 *
 * A FAMILY scales per child beyond the first for the two categories where a
 * child is a whole extra person's worth of cost. Everything else uses the
 * flat family figure, because a fourth child does not double the internet.
 */
export function householdScale(
  category: CostCategory,
  profile: ExpatProfile,
): number {
  const household = profile.household;
  if (!household) return 1;
  const base = HOUSEHOLD_SCALE[household][category] ?? 1;
  if (household !== 'FAMILY') return base;
  const extra = Math.max(0, (profile.childrenCount ?? 2) - 2);
  if (extra === 0) return base;
  if (category === 'GROCERIES') return base + extra * 0.5;
  if (category === 'SCHOOL' || category === 'CHILDCARE') {
    return 1 + Math.max(0, (profile.childrenCount ?? 1) - 1);
  }
  return base;
}

/* ── A line in the budget ─────────────────────────────────────────────── */

/**
 * Where a line's number came from. Rendered, not just recorded — §25
 * requires a user's own figure to be visibly theirs.
 */
export const LINE_BASES = [
  /** Straight from an observation for this city. */
  'OBSERVED',
  /** An observation multiplied by a household assumption. */
  'SCALED',
  /** The person typed it. Never overwritten, never averaged with ours. */
  'USER',
  /** We have no observation for this category in this city. */
  'NO_DATA',
] as const;
export type LineBasis = (typeof LINE_BASES)[number];

export interface BudgetLine {
  category: CostCategory;
  basis: LineBasis;
  /** Absent only when basis is NO_DATA. */
  low: number | null;
  high: number | null;
  currency: string;
  /** The observation behind the line. Null for USER and NO_DATA. */
  observation: ObservedMoney | null;
  /** The multiplier applied, when basis is SCALED. */
  scale: number | null;
}

export interface BudgetInput {
  profile: ExpatProfile;
  /** Observations for the chosen city, one per category at most. */
  observations: Partial<Record<CostCategory, ObservedMoney>>;
  /** What the person typed. Wins over everything, always. */
  overrides: Partial<Record<CostCategory, number>>;
  /** Categories the person switched off. */
  excluded?: readonly CostCategory[];
  /** The currency to report in. Observations must already be in it. */
  currency: string;
}

export interface MonthlyBudget {
  lines: BudgetLine[];
  /** Sum of the low bounds of every line that has one. */
  low: number;
  /** Sum of the high bounds. */
  high: number;
  currency: string;
  /** Categories that applied but for which we hold no observation. */
  missing: CostCategory[];
  /** True when any line came from the person rather than from evidence. */
  hasUserValues: boolean;
  /** The oldest observation the total rests on. Null when none was used. */
  oldestObservedAt: string | null;
}

/**
 * Build the month.
 *
 * Order of precedence per category, and it is not negotiable:
 *
 *   1. the person's own number, used exactly as given
 *   2. an observation for this city, scaled for the household
 *   3. nothing — the category is listed as missing and contributes zero
 *
 * The third case contributes zero to the TOTAL and is reported in
 * `missing`, which the UI must show. Silently dropping a category we have
 * no data for would produce a total that looks complete and is not, and a
 * foreigner would plan against it. Zero is arithmetically correct here only
 * because the caller is obliged to say what is absent.
 */
export function monthlyBudget(input: BudgetInput): MonthlyBudget {
  const excluded = new Set(input.excluded ?? []);
  const categories = applicableCategories(input.profile).filter((c) => !excluded.has(c));

  const lines: BudgetLine[] = [];
  const missing: CostCategory[] = [];
  let low = 0;
  let high = 0;
  let hasUserValues = false;
  let oldest: string | null = null;

  for (const category of categories) {
    const override = input.overrides[category];
    if (typeof override === 'number' && Number.isFinite(override) && override >= 0) {
      lines.push({
        category,
        basis: 'USER',
        low: override,
        high: override,
        currency: input.currency,
        observation: null,
        scale: null,
      });
      low += override;
      high += override;
      hasUserValues = true;
      continue;
    }

    const observation = input.observations[category];
    if (!observation) {
      lines.push({
        category,
        basis: 'NO_DATA',
        low: null,
        high: null,
        currency: input.currency,
        observation: null,
        scale: null,
      });
      missing.push(category);
      continue;
    }

    const scale = householdScale(category, input.profile);
    const lineLow = observation.low * scale;
    const lineHigh = observation.high * scale;
    lines.push({
      category,
      basis: scale === 1 ? 'OBSERVED' : 'SCALED',
      low: lineLow,
      high: lineHigh,
      currency: input.currency,
      observation,
      scale: scale === 1 ? null : scale,
    });
    low += lineLow;
    high += lineHigh;
    if (oldest === null || observation.observedAt < oldest) oldest = observation.observedAt;
  }

  return {
    lines,
    low,
    high,
    currency: input.currency,
    missing,
    hasUserValues,
    oldestObservedAt: oldest,
  };
}

/**
 * How wide the total is, as high ÷ low.
 *
 * 1 means the answer is a single number; 2 means the top of the range is
 * twice the bottom. Above about 1.8 the UI should stop presenting it as an
 * estimate of a month and start presenting it as two different months.
 */
export function spreadRatio(budget: MonthlyBudget): number {
  if (budget.low <= 0) return budget.high > 0 ? Infinity : 1;
  return budget.high / budget.low;
}

/**
 * The share of the month one category takes, at the midpoint.
 *
 * For the composition bar only. Returns 0 rather than dividing by zero on
 * an empty budget.
 */
export function shareOfBudget(line: BudgetLine, budget: MonthlyBudget): number {
  const total = (budget.low + budget.high) / 2;
  if (total <= 0 || line.low === null || line.high === null) return 0;
  return (line.low + line.high) / 2 / total;
}

/**
 * What proportion of the month is housing.
 *
 * Called out separately because it is the one line a foreigner can change by
 * a factor of three by choosing a different district, and the one the rest
 * of the product can actually act on: it is the bridge from this engine into
 * the neighbourhood and property surfaces.
 */
export function housingShare(budget: MonthlyBudget): number | null {
  const rent = budget.lines.find((l) => l.category === 'RENT');
  if (!rent || rent.low === null || rent.high === null) return null;
  return shareOfBudget(rent, budget);
}

/**
 * A single number, for arithmetic that genuinely needs one.
 *
 * Exported so that nothing else reaches for `(low + high) / 2` inline and
 * starts treating it as the answer. Every call site that uses this is
 * choosing to collapse a range and should be visible in a grep.
 */
export function budgetMidpoint(budget: MonthlyBudget): number {
  return (budget.low + budget.high) / 2;
}

/**
 * Convert an observation between currencies at a stated rate.
 *
 * The rate is an argument, never a constant and never fetched here: FX moves
 * daily and a hard-coded rate is the same failure as a hard-coded rent. The
 * observation's `observedAt` is preserved — converting a price does not make
 * it newer — and sample counts carry through unchanged because a conversion
 * adds no observations.
 */
export function convertObservation(
  m: ObservedMoney,
  toCurrency: string,
  rate: number,
): ObservedMoney {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new RangeError('convertObservation needs a positive rate');
  }
  return {
    ...m,
    low: m.low * rate,
    high: m.high * rate,
    currency: toCurrency,
  };
}

/**
 * The yearly figure, for someone comparing Georgia with home.
 *
 * Twelve times the month. Deliberately not "twelve times the month plus a
 * guess at annual costs": the annual items a foreigner faces here — a
 * residence renewal, an insurance premium — are tasks with their own costs
 * in the plan, and folding an estimate of them into this number would double
 * count them against the plan's own figures.
 */
export function annualise(budget: MonthlyBudget): { low: number; high: number } {
  return { low: budget.low * 12, high: budget.high * 12 };
}

/** Midpoint of an observation, re-exported so callers need one import. */
export { midpoint };
