// HOMATCH INVESTMENT INTELLIGENCE — the options you click instead of typing.
//
// THE RULE THIS FILE IMPLEMENTS
//
// For every number, ask whether it can be CHOSEN rather than typed. Most
// can: an area is usually a round number, a holding period is one of five
// answers, an occupancy is one of four, a selling cost is a market
// convention. Typing is reserved for what is genuinely specific to this
// property — its price, its rent, the resale the investor has in mind.
//
// WHY PRESETS ARE COMPUTED FROM THE CONTEXT AND NOT HARD-CODED
//
// A preset that ignores what the investor has already said is barely better
// than an empty box. Once the area is 80 m² and the quality is Premium, the
// useful options are not "$600 / $750 / $900 per m²" — they are "$48,000 /
// $60,000 / $72,000", the actual amounts, already multiplied. Once the price
// is $100,000 over 80 m², the price per m² is not a question at all; it is
// $1,250 and it should simply appear.
//
// WHERE EACH NUMBER CAME FROM MUST SURVIVE
//
// A preset is one of four things and they must never look alike:
//
//   MARKET      observed in real listings. Only ever set by the evidence
//               lane, never invented here.
//   CALCULATED  derived from what the investor already entered. Certain.
//   EXAMPLE     a plausible illustration. NOT a market claim, and labelled
//               so on screen every time.
//   CONVENTION  a standard practice figure (a typical agency fee), which is
//               a weaker claim than market evidence and a stronger one than
//               an example.
//
// The renovation ranges below are EXAMPLE. They are round numbers chosen to
// be useful starting points, not measurements, and nothing in this product
// may present them as what renovation costs.

import type { InvestmentContext } from '../consultant/context.ts';
import type { StrategyId } from './definitions.ts';

export type PresetKind = 'MARKET' | 'CALCULATED' | 'EXAMPLE' | 'CONVENTION';

export interface Preset {
  value: number;
  /** Rendered as-is when present; otherwise the value is formatted by kind. */
  labelKey?: string;
  kind: PresetKind;
  /** Extra line under the chip, e.g. "$750/m² × 80 m²". */
  noteKey?: string;
  noteVars?: Record<string, string | number>;
}

const num = (context: InvestmentContext, field: string): number | undefined =>
  (context as Record<string, { value?: unknown } | undefined>)[field]?.value as number | undefined;

const text = (context: InvestmentContext, field: string): string | undefined =>
  (context as Record<string, { value?: unknown } | undefined>)[field]?.value as string | undefined;

const positive = (v: number | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;

const round = (v: number) => Math.round(v * 100) / 100;

/* ── Renovation quality → cost per m² ───────────────────────────────── */

/**
 * Illustrative renovation rates, per m².
 *
 * EXAMPLES. Three points per tier so an investor can pick a position within
 * it rather than accept a single figure, and wide enough between tiers that
 * choosing the wrong one is obvious rather than subtle. Nothing here is
 * measured; the moment the evidence lane can observe real renovation costs,
 * these are what it replaces.
 */
export const RENOVATION_RATES: Record<string, readonly number[]> = {
  BASIC: [150, 250, 350],
  STANDARD: [300, 450, 600],
  PREMIUM: [600, 750, 900],
  LUXURY: [1000, 1400, 1800],
};

export const RENOVATION_QUALITIES = ['BASIC', 'STANDARD', 'PREMIUM', 'LUXURY'] as const;

/**
 * The spread offered when no standard has been chosen.
 *
 * Deliberately coarse and deliberately wide: it spans light work to a full
 * refit rather than pretending to know which. Used where the strategy never
 * asks about a standard at all — bringing a rental up to lettable is one
 * question, not five.
 */
export const BROAD_RENOVATION_RATES: readonly number[] = [200, 450, 800];

/* ── The preset table ───────────────────────────────────────────────── */

const AREA_PRESETS = [40, 50, 70, 90, 120];
const OCCUPANCY_VACANT_MONTHS = [0, 0.6, 1.2, 1.8];
const HOLD_MONTHS = [12, 24, 36, 60, 120];
/*
 * The same field, two different questions.
 *
 * `holdMonths` is "how long do you intend to own this" for a rental and
 * "how long until you sell" for a flip or an off-plan resale. Offering a
 * flipper a ten-year hold is not a harmless extra option: it is the
 * product showing it does not know which business the investor is in.
 */
const MONTHS_TO_SALE = [6, 9, 12, 18];
const RENOVATION_MONTHS = [2, 3, 4, 6, 9];
const TARGET_RETURNS = [8, 10, 12, 15, 20];
const TARGET_YIELDS = [5, 6, 7, 8, 10];
const SELLING_COST_PCT = [2, 3, 4, 5];
const ACQUISITION_COST_PCT = [1, 2, 3, 4];
const MANAGEMENT_PCT = [0, 5, 8, 10];
const MONTHS_TO_COMPLETION = [6, 12, 18, 24, 36];
const DOWN_PAYMENT_PCT = [20, 30, 35, 50];
const MORTGAGE_TERMS = [120, 180, 240, 300];
/*
 * Illustrative mortgage rates, not quoted ones.
 *
 * A real rate comes from a bank offer and belongs in /mortgage, which reads
 * the National Bank's published limits. These are round starting points so
 * the field is clickable, and they are EXAMPLE for exactly that reason.
 */
const MORTGAGE_RATES = [8, 10, 12, 14];

/*
 * PRICE BRACKETS PER m², SO THE FIRST QUESTION IS STILL A CLICK.
 *
 * The purchase price is the one number that is genuinely the property's
 * own, and for a long time this field offered nothing at all for exactly
 * that reason — which left the very first question in the product as seven
 * digits of typing.
 *
 * The honest middle is to suggest from the one thing that may already be
 * known: the area. Four brackets, an order of magnitude apart end to end,
 * so picking one is choosing a segment of the market rather than accepting
 * a figure. They are EXAMPLE, and the moment the evidence lane has seen
 * real asking prices for the subject they are replaced wholesale — see
 * DealBuilder's note on why observed and illustrative figures never share
 * a row.
 */
const PRICE_PER_SQM_BRACKETS = [800, 1200, 1600, 2200];
/** The same idea for a monthly rent, where no price exists to work from. */
const RENT_PER_SQM_BRACKETS = [8, 12, 16, 22];

function plain(values: readonly number[], kind: PresetKind = 'EXAMPLE'): Preset[] {
  return values.map((value) => ({ value, kind }));
}

/**
 * The options to offer for one field, given everything already established.
 *
 * Returns an empty list when a field genuinely has no sensible options
 * yet — a renovation budget before a standard has been chosen, a price per
 * m² before an area. An empty list is the field falling back to typing,
 * which is a cost, so it is a last resort rather than a default.
 */
export function presetsFor(
  field: string,
  context: InvestmentContext,
  strategy?: StrategyId,
): Preset[] {
  const area = num(context, 'areaSqm');
  const price = num(context, 'purchasePrice');
  const rent = num(context, 'monthlyRent');

  /** Whether this analysis ends in a sale rather than in a tenancy. */
  const sellsAtTheEnd =
    strategy === 'RENOVATE_RESELL' ||
    strategy === 'CONSTRUCTION_RESALE' ||
    (strategy === 'INVESTMENT_VALUE' && text(context, 'valueStrategy') !== 'RENTAL_INVESTMENT');

  switch (field) {
    case 'areaSqm':
      return plain(AREA_PRESETS);

    case 'purchasePrice': {
      if (!positive(area)) return [];
      return PRICE_PER_SQM_BRACKETS.map((rate) => ({
        value: round(rate * area),
        kind: 'EXAMPLE' as const,
        noteKey: 'inv_preset_rate_times_area',
        noteVars: { rate, area },
      }));
    }

    case 'purchasePricePerSqm': {
      // Only where a total has not already been given: the derived readout
      // covers that case, and offering brackets next to it would invite a
      // third number that disagrees with the two it came from.
      if (positive(price)) return [];
      return plain(PRICE_PER_SQM_BRACKETS);
    }

    case 'vacantMonthsPerYear':
      /*
       * Offered as OCCUPANCY, because that is the word landlords use, while
       * the engine stores vacant months. 95% of a year is 0.6 of a month,
       * and asking somebody to work that out is exactly the typing this
       * product is trying to remove.
       */
      return OCCUPANCY_VACANT_MONTHS.map((value, index) => ({
        value,
        kind: 'EXAMPLE' as const,
        labelKey: ['inv_occ_100', 'inv_occ_95', 'inv_occ_90', 'inv_occ_85'][index],
      }));

    case 'holdMonths': {
      const asYears = (values: readonly number[]) =>
        values.map((value) => ({
          value,
          kind: 'EXAMPLE' as const,
          labelKey:
            value % 12 === 0 ? (value === 12 ? 'inv_hold_one_year' : 'inv_unit_years') : undefined,
          noteVars: { n: value / 12 },
        }));

      if (!sellsAtTheEnd) return asYears(HOLD_MONTHS);

      /*
       * Anchored on the works wherever they are known: a flip goes back on
       * the market a month or two after the last tradesman leaves, and
       * suggesting that is the difference between a preset and a guess.
       */
      const works = num(context, 'renovationDurationMonths');
      if (positive(works)) return asYears([works + 1, works + 2, works + 3, works + 6]);
      return asYears(MONTHS_TO_SALE);
    }

    case 'renovationDurationMonths':
      return plain(RENOVATION_MONTHS);

    case 'monthsToCompletion':
      return plain(MONTHS_TO_COMPLETION);

    case 'targetReturnPercent':
      return plain(TARGET_RETURNS);

    case 'benchmarkYieldPercent':
      return plain(TARGET_YIELDS);

    case 'sellingCostPercent':
      return plain(SELLING_COST_PCT, 'CONVENTION');

    case 'acquisitionCostPercent':
      return plain(ACQUISITION_COST_PCT, 'CONVENTION');

    case 'managementPercentOfCollectedRent':
      return plain(MANAGEMENT_PCT, 'CONVENTION');

    case 'downPaymentPercent':
      return plain(DOWN_PAYMENT_PCT);

    case 'mortgageAnnualRatePercent':
      return plain(MORTGAGE_RATES);

    case 'originationFeePercent':
      return plain([0, 0.5, 1, 1.5], 'CONVENTION');

    case 'managementFlatMonthly':
      return plain([0, 30, 60, 100]);

    case 'repairsAnnual':
      return plain([0, 300, 600, 1200]);

    case 'lettingFeePerTenancy':
      return positive(rent)
        ? [0.5, 1].map((share) => ({
            value: Math.round(rent * share),
            kind: 'CONVENTION' as const,
            noteKey: 'inv_preset_share_of_month_rent',
            noteVars: { n: share },
          }))
        : plain([0, 200, 400]);

    case 'tenanciesPerYear':
      return plain([1, 2]);

    case 'downPaymentAmount':
      return positive(price)
        ? DOWN_PAYMENT_PCT.map((pct) => ({
            value: round((price * pct) / 100),
            kind: 'CALCULATED' as const,
            noteKey: 'inv_preset_share_of_price',
            noteVars: { pct },
          }))
        : [];

    case 'askingPrice':
      return positive(price) ? [{ value: price, kind: 'CALCULATED' as const }] : [];

    case 'sellingCostAmount':
      return positive(price)
        ? SELLING_COST_PCT.map((pct) => ({
            value: round((price * pct) / 100),
            kind: 'CONVENTION' as const,
            noteKey: 'inv_preset_share_of_price',
            noteVars: { pct },
          }))
        : [];

    case 'renovationDurationMonths2':
      return [];

    case 'rooms':
      return plain([1, 2, 3, 4]);

    case 'bedrooms':
      return plain([1, 2, 3, 4]);

    case 'floor':
      return plain([1, 2, 5, 10]);

    case 'purchasePricePerSqm': {
      if (positive(price) && positive(area)) {
        return [{ value: round(price / area), kind: 'CALCULATED' as const }];
      }
      return [];
    }

    case 'mortgageTermMonths':
      return MORTGAGE_TERMS.map((value) => ({
        value,
        kind: 'EXAMPLE' as const,
        labelKey: 'inv_unit_years',
        noteVars: { n: value / 12 },
      }));

    case 'renovationCost': {
      /*
       * THE CONTEXTUAL ONE THIS WHOLE FILE IS FOR.
       *
       * Quality plus area gives three real amounts to click: Premium on
       * 80 m² is $48,000 / $60,000 / $72,000, not "$600–900 per m²".
       *
       * Where no standard has been chosen — the rental flow asks whether
       * work is needed before letting, and never asks to what standard —
       * the fallback spans the tiers instead of sitting inside one. It is
       * three coarse points rather than three precise ones, which is the
       * honest shape of the claim being made.
       *
       * Without an AREA there is still nothing to offer: a rate per m² is
       * not a budget, and three numbers with nothing behind them would be
       * worse than an empty box.
       */
      if (!positive(area)) return [];
      const quality = text(context, 'renovationQuality');
      const rates = (quality ? RENOVATION_RATES[quality] : undefined) ?? BROAD_RENOVATION_RATES;
      return rates.map((rate) => ({
        value: round(rate * area),
        kind: 'EXAMPLE' as const,
        noteKey: 'inv_preset_rate_times_area',
        noteVars: { rate, area },
      }));
    }

    case 'renovationCostPerSqm': {
      const quality = text(context, 'renovationQuality');
      const rates = quality ? RENOVATION_RATES[quality] : undefined;
      if (!rates) return [];
      return rates.map((rate) => ({ value: rate, kind: 'EXAMPLE' as const }));
    }

    case 'exitPriceAssumption': {
      // Resale options as a movement from what is being paid, which is how
      // an investor actually frames it: "I think I can add fifteen percent".
      if (!positive(price)) return [];
      const uplift = [10, 20, 30, 40];
      return uplift.map((pct) => ({
        value: round((price * (100 + pct)) / 100),
        kind: 'CALCULATED' as const,
        noteKey: 'inv_preset_uplift',
        noteVars: { pct },
      }));
    }

    case 'expectedCompletedPrice': {
      if (!positive(price)) return [];
      const uplift = [10, 15, 20, 30];
      return uplift.map((pct) => ({
        value: round((price * (100 + pct)) / 100),
        kind: 'CALCULATED' as const,
        noteKey: 'inv_preset_uplift',
        noteVars: { pct },
      }));
    }

    case 'upfrontPayment': {
      if (!positive(price)) return [];
      return [10, 20, 30, 50].map((pct) => ({
        value: round((price * pct) / 100),
        kind: 'CALCULATED' as const,
        noteKey: 'inv_preset_share_of_price',
        noteVars: { pct },
      }));
    }

    case 'monthlyRent': {
      /*
       * Framed as the gross yield it would represent, because that is the
       * thing the investor is really choosing when they pick a rent
       * against a known price.
       *
       * The Investment Value flow has no price — solving for it is the
       * whole point — so there the rent is offered per m² instead. Both
       * are suggestions from something already answered; neither is a
       * market claim, and the yield framing is CALCULATED because it is
       * arithmetic on the investor's own price while the per-m² spread is
       * only an EXAMPLE.
       */
      if (positive(price)) {
        return [5, 6, 7, 8].map((yieldPct) => ({
          value: Math.round((price * yieldPct) / 100 / 12),
          kind: 'CALCULATED' as const,
          noteKey: 'inv_preset_implied_yield',
          noteVars: { pct: yieldPct },
        }));
      }
      if (!positive(area)) return [];
      return RENT_PER_SQM_BRACKETS.map((rate) => ({
        value: Math.round(rate * area),
        kind: 'EXAMPLE' as const,
        noteKey: 'inv_preset_rate_times_area',
        noteVars: { rate, area },
      }));
    }

    case 'monthlyHoldingCosts': {
      if (!positive(price)) return [];
      // A quarter, a half and one percent of the price a year, monthly.
      return [0.25, 0.5, 1].map((pct) => ({
        value: Math.round((price * pct) / 100 / 12),
        kind: 'EXAMPLE' as const,
      }));
    }

    case 'maintenanceAnnual': {
      if (positive(price)) {
        return [0.5, 1, 1.5].map((pct) => ({
          value: Math.round((price * pct) / 100),
          kind: 'EXAMPLE' as const,
          noteKey: 'inv_preset_share_of_price_year',
          noteVars: { pct },
        }));
      }
      // No price to take a share of — the Investment Value flow, where the
      // price is the unknown — so running costs are offered as a share of
      // the rent instead, which is the other thing already answered there.
      if (!positive(rent)) return [];
      return [10, 20, 30].map((pct) => ({
        value: Math.round((rent * 12 * pct) / 100),
        kind: 'EXAMPLE' as const,
        noteKey: 'inv_preset_share_of_rent',
        noteVars: { pct },
      }));
    }

    case 'repairsReserveAnnual': {
      if (!positive(rent)) return [];
      // A share of the annual rent, which is how a reserve is normally set.
      return [3, 5, 8].map((pct) => ({
        value: Math.round((rent * 12 * pct) / 100),
        kind: 'CONVENTION' as const,
        noteKey: 'inv_preset_share_of_rent',
        noteVars: { pct },
      }));
    }

    case 'acquisitionCosts': {
      if (!positive(price)) return [];
      return ACQUISITION_COST_PCT.map((pct) => ({
        value: round((price * pct) / 100),
        kind: 'CONVENTION' as const,
        noteKey: 'inv_preset_share_of_price',
        noteVars: { pct },
      }));
    }

    case 'furnishingCost': {
      // Furnishing scales with the size of the place, so an area makes the
      // options real amounts; without one they fall back to round sums.
      if (positive(area)) {
        return [80, 120, 180].map((rate) => ({
          value: round(rate * area),
          kind: 'EXAMPLE' as const,
          noteKey: 'inv_preset_rate_times_area',
          noteVars: { rate, area },
        }));
      }
      return plain([3000, 6000, 10000]);
    }

    case 'otherRenovationCosts':
      return plain([0, 1000, 3000, 5000]);

    case 'financingCosts':
      return plain([0, 1000, 2000, 5000]);

    case 'installmentMonthly': {
      /*
       * What is left to pay, spread over the instalment count the investor
       * has already chosen. That is the instalment they would actually be
       * quoted, rather than a round number picked out of the air.
       */
      const upfront = num(context, 'upfrontPayment') ?? 0;
      const count = num(context, 'installmentCount');
      if (positive(price) && positive(count) && price > upfront) {
        return [1].map(() => ({
          value: Math.round((price - upfront) / count),
          kind: 'CALCULATED' as const,
          noteKey: 'inv_preset_spreads_balance',
          noteVars: { n: count },
        }));
      }
      if (!positive(price)) return plain([500, 1000, 1500, 2000]);
      return [0.5, 1, 1.5].map((pct) => ({
        value: Math.round((price * pct) / 100),
        kind: 'EXAMPLE' as const,
      }));
    }

    case 'installmentCount':
      return plain([12, 18, 24, 36]);

    case 'remainingDeveloperBalance': {
      /*
       * What the stated schedule leaves owed, offered as the one obvious
       * answer. An investor who has entered a deposit and a run of
       * instalments has already told us this number; asking them to work it
       * out again is the arithmetic this product exists to remove.
       */
      const upfront = num(context, 'upfrontPayment') ?? 0;
      const monthly = num(context, 'installmentMonthly') ?? 0;
      const count = num(context, 'installmentCount') ?? 0;
      if (!positive(price)) return [];
      const paid = Math.min(price, upfront + monthly * count);
      return [{ value: round(Math.max(0, price - paid)), kind: 'CALCULATED' as const }];
    }

    case 'hoaMonthly': {
      if (positive(area)) {
        return [0.5, 1, 1.5].map((rate) => ({
          value: round(rate * area),
          kind: 'EXAMPLE' as const,
          noteKey: 'inv_preset_rate_times_area',
          noteVars: { rate, area },
        }));
      }
      return plain([20, 40, 60]);
    }

    case 'insuranceAnnual': {
      if (!positive(price)) return plain([100, 200, 400]);
      return [0.1, 0.2, 0.3].map((pct) => ({
        value: Math.round((price * pct) / 100),
        kind: 'EXAMPLE' as const,
        noteKey: 'inv_preset_share_of_price_year',
        noteVars: { pct },
      }));
    }

    case 'propertyTaxAnnual': {
      if (!positive(price)) return plain([0, 200, 500, 1000]);
      return [0, 0.1, 0.5, 1].map((pct) => ({
        value: Math.round((price * pct) / 100),
        kind: 'EXAMPLE' as const,
      }));
    }

    case 'utilitiesPaidByOwnerAnnual':
      return plain([0, 300, 600, 1200]);

    case 'otherOperatingAnnual':
      return plain([0, 200, 500, 1000]);

    case 'otherAnnualIncome':
      return plain([0, 600, 1200, 2400]);

    case 'expectedResalePricePerSqm': {
      const resale = num(context, 'exitPriceAssumption');
      if (positive(resale) && positive(area)) {
        return [{ value: round(resale / area), kind: 'CALCULATED' as const }];
      }
      if (!positive(price) || !positive(area)) return [];
      const base = price / area;
      return [10, 20, 30, 40].map((pct) => ({
        value: round((base * (100 + pct)) / 100),
        kind: 'CALCULATED' as const,
        noteKey: 'inv_preset_uplift',
        noteVars: { pct },
      }));
    }

    case 'expectedCompletedPricePerSqm': {
      const completed = num(context, 'expectedCompletedPrice');
      if (positive(completed) && positive(area)) {
        return [{ value: round(completed / area), kind: 'CALCULATED' as const }];
      }
      if (!positive(price) || !positive(area)) return [];
      const base = price / area;
      return [10, 15, 20, 30].map((pct) => ({
        value: round((base * (100 + pct)) / 100),
        kind: 'CALCULATED' as const,
        noteKey: 'inv_preset_uplift',
        noteVars: { pct },
      }));
    }

    case 'additionalMonthsToSale':
      return plain([0, 3, 6, 12]);

    case 'proposedPrice': {
      // Where a purchase price is already on the table, the price being
      // considered IS that price until the investor says otherwise.
      if (positive(price)) return [{ value: price, kind: 'CALCULATED' as const }];
      // In the Investment Value flow there is no purchase price — solving
      // for one is the point — so this falls back to the same per-m²
      // brackets the purchase price itself would have offered.
      if (!positive(area)) return [];
      return PRICE_PER_SQM_BRACKETS.map((rate) => ({
        value: round(rate * area),
        kind: 'EXAMPLE' as const,
        noteKey: 'inv_preset_rate_times_area',
        noteVars: { rate, area },
      }));
    }

    default:
      return [];
  }
}

/* ── Values that should never be typed twice ────────────────────────── */

export interface DerivedValue {
  field: string;
  value: number;
  /** The fields it was computed from, for the "Calculated" label. */
  fromFields: string[];
}

/**
 * Figures the interface can simply SHOW rather than ask for.
 *
 * Price per m² is the clearest case: with a price and an area it is not a
 * question, and a form that asks for it is asking the investor to do
 * arithmetic the product exists to do. Kept out of the context so the
 * investor's own entries stay theirs; these are display values, recomputed
 * every render.
 */
export function derivedValues(context: InvestmentContext): DerivedValue[] {
  const out: DerivedValue[] = [];
  const area = num(context, 'areaSqm');
  if (!positive(area)) return out;

  const pairs: Array<[string, string]> = [
    ['purchasePrice', 'purchasePricePerSqm'],
    ['exitPriceAssumption', 'expectedResalePricePerSqm'],
    ['expectedCompletedPrice', 'expectedCompletedPricePerSqm'],
    ['renovationCost', 'renovationCostPerSqm'],
  ];

  for (const [totalField, perSqmField] of pairs) {
    const total = num(context, totalField);
    const perSqm = num(context, perSqmField);
    if (positive(total) && !positive(perSqm)) {
      out.push({ field: perSqmField, value: round(total / area), fromFields: [totalField, 'areaSqm'] });
    } else if (positive(perSqm) && !positive(total)) {
      out.push({ field: totalField, value: round(perSqm * area), fromFields: [perSqmField, 'areaSqm'] });
    }
  }
  return out;
}

/** The derived value for one field, if there is one. */
export function derivedValueFor(field: string, context: InvestmentContext): DerivedValue | null {
  return derivedValues(context).find((d) => d.field === field) ?? null;
}
