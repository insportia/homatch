// priceBook.ts — versioned, market-scoped renovation prices.
//
// METHODOLOGY (PART Q / PART AM)
// ------------------------------
// Every price is an OBSERVATION with provenance and a date, not a constant.
// Material and labour are stored separately because they move independently
// and because a customer needs to see which one is driving a number.
//
// The default is the TYPICAL market value — deliberately not the cheapest
// craftsman found online, and not a premium contractor's list price.
//
// HONESTY GATE — read this before adding numbers
// ----------------------------------------------
// Renovation figures steer six-figure decisions. A plausible-looking but
// invented price book is worse than none, so every entry carries
// `provenance` and a `review` state, and `assertPriceBookUsable()` REFUSES to
// produce customer-facing estimates from entries that a human has not
// reviewed, unless the caller explicitly opts into provisional mode (which
// the UI must label as such).
//
// The seed below is intentionally SMALL and marked provisional. It is
// grounded in published Tbilisi whole-renovation ranges (roughly
// 520-900 GEL/m2 for a black-frame apartment in 2026, across several Georgian
// renovation companies) which is enough to sanity-check a total, but NOT
// enough to derive eighty per-item material/labour splits. Those must be
// collected per item, per PART AM, before this book is used for real
// customer estimates.

export type Market = 'tbilisi';
export type Unit = 'm2' | 'lm' | 'point' | 'unit' | 'set' | 'project';
export type ReviewState = 'PROVISIONAL' | 'ADMIN_REVIEWED';

export interface PriceObservation {
  /** Where the number came from. Never blank. */
  source: string;
  /** ISO date the observation was made. */
  observedAt: string;
  /** GEL. */
  value: number;
}

export interface PriceItem {
  key: string;
  category: string;
  label: string;
  unit: Unit;
  /** GEL per unit. `typical` is the default used by every estimate. */
  material: { low: number; typical: number; high: number } | null;
  labour: { low: number; typical: number; high: number };
  /** Category-appropriate waste/contingency on MATERIAL quantity only.
   * Labour is not wasted; material is. */
  wasteFactor: number;
  review: ReviewState;
  provenance: PriceObservation[];
}

export interface PriceBook {
  market: Market;
  /** Monotonic. A saved estimate records the version it used so an old
   * scenario can always be explained. */
  version: number;
  effectiveFrom: string;
  currency: 'GEL';
  items: PriceItem[];
}

/** Waste factors differ per material — a single global percentage would be
 * wrong for every category at once (PART T). */
export const WASTE = Object.freeze({
  tile: 0.1,
  flooring: 0.07,
  paint: 0.05,
  plaster: 0.08,
  drywall: 0.1,
  cable: 0.12,
  pipe: 0.12,
  none: 0,
});

const SEED_SOURCE = 'Tbilisi published renovation ranges (multiple Georgian renovation companies, 2026)';
const SEED_DATE = '2026-09-09';
const obs = (value: number): PriceObservation[] => [{ source: SEED_SOURCE, observedAt: SEED_DATE, value }];

/**
 * PROVISIONAL Tbilisi seed.
 *
 * Deliberately limited to categories whose split can be reasoned about from
 * published whole-job ranges. Anything requiring a genuine per-item market
 * survey is absent rather than guessed — a missing item is visible and
 * fixable, an invented one is not.
 */
export const TBILISI_PRICE_BOOK: PriceBook = {
  market: 'tbilisi',
  version: 1,
  effectiveFrom: SEED_DATE,
  currency: 'GEL',
  items: [
    {
      key: 'wall.plaster',
      category: 'WALLS',
      label: 'Wall plaster and levelling',
      unit: 'm2',
      material: { low: 8, typical: 12, high: 18 },
      labour: { low: 14, typical: 20, high: 28 },
      wasteFactor: WASTE.plaster,
      review: 'PROVISIONAL',
      provenance: obs(32),
    },
    {
      key: 'wall.paint',
      category: 'WALLS',
      label: 'Putty and paint',
      unit: 'm2',
      material: { low: 6, typical: 9, high: 15 },
      labour: { low: 10, typical: 14, high: 20 },
      wasteFactor: WASTE.paint,
      review: 'PROVISIONAL',
      provenance: obs(23),
    },
    {
      key: 'floor.screed',
      category: 'FLOORS',
      label: 'Floor screed',
      unit: 'm2',
      material: { low: 9, typical: 13, high: 19 },
      labour: { low: 11, typical: 16, high: 23 },
      wasteFactor: WASTE.plaster,
      review: 'PROVISIONAL',
      provenance: obs(29),
    },
    {
      key: 'floor.laminate',
      category: 'FLOORS',
      label: 'Laminate flooring',
      unit: 'm2',
      material: { low: 25, typical: 45, high: 90 },
      labour: { low: 12, typical: 17, high: 24 },
      wasteFactor: WASTE.flooring,
      review: 'PROVISIONAL',
      provenance: obs(62),
    },
    {
      key: 'floor.tile',
      category: 'FLOORS',
      label: 'Ceramic / porcelain floor tile',
      unit: 'm2',
      material: { low: 30, typical: 55, high: 130 },
      labour: { low: 22, typical: 32, high: 45 },
      wasteFactor: WASTE.tile,
      review: 'PROVISIONAL',
      provenance: obs(87),
    },
    {
      key: 'wall.tile',
      category: 'BATHROOM',
      label: 'Wall tile (wet areas)',
      unit: 'm2',
      material: { low: 32, typical: 60, high: 140 },
      labour: { low: 26, typical: 38, high: 52 },
      wasteFactor: WASTE.tile,
      review: 'PROVISIONAL',
      provenance: obs(98),
    },
    {
      key: 'bath.waterproofing',
      category: 'BATHROOM',
      label: 'Wet-area waterproofing',
      unit: 'm2',
      material: { low: 10, typical: 16, high: 26 },
      labour: { low: 12, typical: 18, high: 26 },
      wasteFactor: WASTE.paint,
      review: 'PROVISIONAL',
      provenance: obs(34),
    },
    {
      key: 'ceiling.paint',
      category: 'CEILINGS',
      label: 'Ceiling levelling and paint',
      unit: 'm2',
      material: { low: 6, typical: 9, high: 14 },
      labour: { low: 11, typical: 16, high: 22 },
      wasteFactor: WASTE.paint,
      review: 'PROVISIONAL',
      provenance: obs(25),
    },
    {
      key: 'skirting',
      category: 'FLOORS',
      label: 'Skirting board',
      unit: 'lm',
      material: { low: 8, typical: 14, high: 26 },
      labour: { low: 5, typical: 8, high: 12 },
      wasteFactor: WASTE.flooring,
      review: 'PROVISIONAL',
      provenance: obs(22),
    },
    {
      key: 'electrical.point',
      category: 'ELECTRICAL',
      label: 'Electrical point (socket / switch / light)',
      unit: 'point',
      material: { low: 18, typical: 30, high: 60 },
      labour: { low: 25, typical: 38, high: 55 },
      wasteFactor: WASTE.cable,
      review: 'PROVISIONAL',
      provenance: obs(68),
    },
    {
      key: 'plumbing.point',
      category: 'PLUMBING',
      label: 'Plumbing point (supply + drain)',
      unit: 'point',
      material: { low: 45, typical: 80, high: 140 },
      labour: { low: 60, typical: 95, high: 140 },
      wasteFactor: WASTE.pipe,
      review: 'PROVISIONAL',
      provenance: obs(175),
    },
    {
      key: 'door.interior',
      category: 'DOORS',
      label: 'Interior door (supplied and fitted)',
      unit: 'unit',
      material: { low: 250, typical: 500, high: 1200 },
      labour: { low: 90, typical: 140, high: 200 },
      wasteFactor: WASTE.none,
      review: 'PROVISIONAL',
      provenance: obs(640),
    },
    {
      key: 'demolition',
      category: 'DEMOLITION',
      label: 'Strip-out and debris removal',
      unit: 'm2',
      material: null,
      labour: { low: 18, typical: 28, high: 42 },
      wasteFactor: WASTE.none,
      review: 'PROVISIONAL',
      provenance: obs(28),
    },
  ],
};

export function getPriceBook(market: Market = 'tbilisi'): PriceBook {
  if (market !== 'tbilisi') throw new Error(`no price book for market: ${market}`);
  return TBILISI_PRICE_BOOK;
}

export function findItem(book: PriceBook, key: string): PriceItem | null {
  return book.items.find((i) => i.key === key) ?? null;
}

export interface UsabilityVerdict {
  usable: boolean;
  reviewed: number;
  provisional: number;
  reason: string;
}

/**
 * The honesty gate. A price book whose entries no human has reviewed may not
 * silently produce a customer-facing number.
 *
 * `allowProvisional` exists so the engine can be developed and tested, and so
 * an internal preview can be shown — but any surface using it MUST label the
 * output as provisional.
 */
export function assertPriceBookUsable(book: PriceBook, allowProvisional = false): UsabilityVerdict {
  const provisional = book.items.filter((i) => i.review === 'PROVISIONAL').length;
  const reviewed = book.items.length - provisional;
  if (provisional === 0) return { usable: true, reviewed, provisional, reason: 'all_reviewed' };
  if (allowProvisional) return { usable: true, reviewed, provisional, reason: 'provisional_explicitly_allowed' };
  return { usable: false, reviewed, provisional, reason: 'unreviewed_provisional_prices' };
}

/** Every item must carry real provenance — this is what stops a number being
 * added with no idea where it came from. */
export function validatePriceBook(book: PriceBook): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const i of book.items) {
    if (seen.has(i.key)) problems.push(`duplicate item: ${i.key}`);
    seen.add(i.key);
    if (!i.provenance.length) problems.push(`${i.key}: no provenance`);
    for (const p of i.provenance) {
      if (!p.source) problems.push(`${i.key}: observation without a source`);
      if (Number.isNaN(Date.parse(p.observedAt))) problems.push(`${i.key}: bad observedAt`);
    }
    if (i.labour.low > i.labour.typical || i.labour.typical > i.labour.high) {
      problems.push(`${i.key}: labour range is not ordered low <= typical <= high`);
    }
    if (i.material && (i.material.low > i.material.typical || i.material.typical > i.material.high)) {
      problems.push(`${i.key}: material range is not ordered low <= typical <= high`);
    }
    if (i.wasteFactor < 0 || i.wasteFactor > 0.3) problems.push(`${i.key}: implausible waste factor`);
  }
  return problems;
}
