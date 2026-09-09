// observations.ts — turning what suppliers charge into a price we may publish.
//
// THE ONLY QUESTION THIS FILE ANSWERS
//
//   Do we know enough to put a number in front of a customer?
//
// Usually the answer is no, and saying so is the product. A renovation
// estimate that quotes a confident figure from two stale observations of one
// shop is worse than one that says "we cannot price this yet", because the
// customer budgets against it.
//
// So aggregation is deliberately conservative and every rejection is
// explicit. Nothing here publishes anything; it decides whether an item is
// even eligible, and the publication gate downstream still has to agree.
//
// WHAT IS NEVER DONE
//
// No price is invented, interpolated from a "similar" item, carried over from
// another market, or extrapolated from an old one. An observation that cannot
// be normalized to the item's unit is dropped, not guessed at.

/** How a price was obtained. Self-reported values are weaker evidence. */
export type SourceType = 'SUPPLIER_PRICE_LIST' | 'RETAIL_SITE' | 'QUOTE' | 'CONTRACTOR' | 'MANUAL';

export type ReviewState = 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface Observation {
  id: string;
  itemKey: string;
  market: string;
  region?: string | null;
  observedValue: number;
  observedUnit: string;
  /** Normalized units contained in one purchasable unit. A box of tile
   * covering 1.44 m2 has packSize 1.44. */
  packSize?: number | null;
  currency: string;
  sourceType: SourceType;
  sourceName: string;
  supplier?: string | null;
  brand?: string | null;
  productName?: string | null;
  /** ISO date the price was observed. Freshness is judged from this, not from
   * when somebody got round to entering it. */
  sourceDate?: string | null;
  reviewState: ReviewState;
  availability?: 'IN_STOCK' | 'ORDER' | 'OUT_OF_STOCK' | 'UNKNOWN' | null;
}

/** The rules an item must satisfy before it may be priced for a customer. */
export interface SufficiencyRules {
  /** Distinct verified observations required. */
  minObservations: number;
  /** Distinct suppliers required, so one shop's pricing is never "the market". */
  minSuppliers: number;
  /** Nothing older than this may support a live price. */
  maxAgeDays: number;
}

export const DEFAULT_RULES: SufficiencyRules = Object.freeze({
  minObservations: 3,
  minSuppliers: 2,
  maxAgeDays: 180,
});

export interface AggregateResult {
  itemKey: string;
  /** Null when the item is not eligible. Never a guess. */
  price: { low: number; base: number; high: number } | null;
  currency: string | null;
  /** Observations that actually supported the number. */
  usedIds: string[];
  /** Dropped, with the reason, so an operator can see why an item stays gated. */
  dropped: { id: string; reason: string }[];
  suppliers: string[];
  /** Most recent supporting observation. */
  freshestDate: string | null;
  sufficient: boolean;
  /** Why not, when not. Shown in the admin review surface. */
  reasons: string[];
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const daysBetween = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime()) / 86_400_000;

/**
 * Convert one observation to price per normalized unit.
 *
 * Returns null rather than guessing. "45 GEL" for a box of tile is not a
 * price per square metre, and inferring one from an unknown pack size is
 * exactly the kind of confident arithmetic that produces a budget nobody can
 * honour.
 */
export function normalizedUnitPrice(o: Observation): number | null {
  if (!Number.isFinite(o.observedValue) || o.observedValue <= 0) return null;
  const pack = o.packSize ?? 1;
  if (!Number.isFinite(pack) || pack <= 0) return null;
  return o.observedValue / pack;
}

/**
 * Median Absolute Deviation outlier test.
 *
 * Chosen over standard deviation because a single mistyped price — a decimal
 * point in the wrong place — moves a mean enormously and a median barely at
 * all. With few observations, which is the normal case here, one bad row must
 * not be able to drag the published price with it.
 */
export function outlierIds(values: { id: string; value: number }[], threshold = 3.5): Set<string> {
  if (values.length < 4) return new Set();
  const med = median(values.map((v) => v.value));
  const deviations = values.map((v) => Math.abs(v.value - med));
  const mad = median(deviations);
  if (mad === 0) return new Set();
  const out = new Set<string>();
  for (const v of values) {
    // 0.6745 makes MAD comparable to a standard deviation for normal data.
    if ((0.6745 * Math.abs(v.value - med)) / mad > threshold) out.add(v.id);
  }
  return out;
}

/**
 * Decide whether an item can be priced, and at what.
 *
 * Order matters: filter to admissible evidence FIRST, then judge sufficiency
 * on what survived. Counting rejected, stale or unusable rows toward the
 * minimum would make the gate decorative.
 */
export function aggregateObservations(
  itemKey: string,
  observations: Observation[],
  rules: SufficiencyRules = DEFAULT_RULES,
  now: Date = new Date()
): AggregateResult {
  const dropped: { id: string; reason: string }[] = [];
  const admissible: { o: Observation; unit: number }[] = [];
  let currency: string | null = null;

  for (const o of observations) {
    if (o.itemKey !== itemKey) {
      dropped.push({ id: o.id, reason: 'different item' });
      continue;
    }
    if (o.reviewState !== 'VERIFIED') {
      dropped.push({ id: o.id, reason: `not verified (${o.reviewState})` });
      continue;
    }
    if (o.availability === 'OUT_OF_STOCK') {
      dropped.push({ id: o.id, reason: 'out of stock' });
      continue;
    }
    if (!o.sourceDate) {
      dropped.push({ id: o.id, reason: 'no observation date' });
      continue;
    }
    const d = new Date(o.sourceDate);
    if (Number.isNaN(d.getTime())) {
      dropped.push({ id: o.id, reason: 'unreadable date' });
      continue;
    }
    if (daysBetween(now, d) > rules.maxAgeDays) {
      dropped.push({ id: o.id, reason: 'too old' });
      continue;
    }
    const unit = normalizedUnitPrice(o);
    if (unit === null) {
      dropped.push({ id: o.id, reason: 'cannot normalize to the item unit' });
      continue;
    }
    // Mixing currencies would require a rate we do not hold, and a converted
    // price is a different claim from an observed one.
    if (currency === null) currency = o.currency;
    else if (currency !== o.currency) {
      dropped.push({ id: o.id, reason: `currency ${o.currency} differs from ${currency}` });
      continue;
    }
    admissible.push({ o, unit });
  }

  // Same supplier, same product, same day is one observation reported twice.
  const seen = new Set<string>();
  const deduped: { o: Observation; unit: number }[] = [];
  for (const a of admissible) {
    const k = [
      (a.o.supplier ?? a.o.sourceName).toLowerCase().trim(),
      (a.o.productName ?? '').toLowerCase().trim(),
      a.o.sourceDate,
      a.unit.toFixed(2),
    ].join('|');
    if (seen.has(k)) {
      dropped.push({ id: a.o.id, reason: 'duplicate of another observation' });
      continue;
    }
    seen.add(k);
    deduped.push(a);
  }

  const outliers = outlierIds(deduped.map((a) => ({ id: a.o.id, value: a.unit })));
  const used = deduped.filter((a) => {
    if (outliers.has(a.o.id)) {
      dropped.push({ id: a.o.id, reason: 'outlier' });
      return false;
    }
    return true;
  });

  const suppliers = [...new Set(used.map((a) => (a.o.supplier ?? a.o.sourceName).toLowerCase().trim()))];
  const dates = used.map((a) => a.o.sourceDate!).sort();
  const freshestDate = dates.length ? dates[dates.length - 1] : null;

  const reasons: string[] = [];
  if (used.length < rules.minObservations) {
    reasons.push(`needs ${rules.minObservations} verified observations, has ${used.length}`);
  }
  if (suppliers.length < rules.minSuppliers) {
    reasons.push(`needs ${rules.minSuppliers} suppliers, has ${suppliers.length}`);
  }

  const sufficient = reasons.length === 0;

  // The number is only computed when it may be used. Producing a price and
  // then flagging it as unusable invites somebody downstream to read the
  // field and ignore the flag.
  let price: AggregateResult['price'] = null;
  if (sufficient) {
    const values = used.map((a) => a.unit).sort((x, y) => x - y);
    price = {
      low: round2(values[0]),
      base: round2(median(values)),
      high: round2(values[values.length - 1]),
    };
  }

  return {
    itemKey,
    price,
    currency: sufficient ? currency : null,
    usedIds: used.map((a) => a.o.id),
    dropped,
    suppliers,
    freshestDate,
    sufficient,
    reasons,
  };
}

/**
 * May this set of items be published as a customer price book?
 *
 * All-or-nothing per version, deliberately. A part-published book means some
 * lines in a customer's estimate are real market prices and others are not,
 * with nothing on the total saying which — the failure this whole subsystem
 * exists to prevent.
 */
export function canPublish(results: AggregateResult[]): { ok: boolean; blocking: string[] } {
  const blocking = results
    .filter((r) => !r.sufficient)
    .map((r) => `${r.itemKey}: ${r.reasons.join('; ')}`);
  return { ok: results.length > 0 && blocking.length === 0, blocking };
}
