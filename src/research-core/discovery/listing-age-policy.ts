// HOW OLD A LISTING MAY BE AND STILL BE WORTH SHOWING.
//
// This exists because of a number I invented. The first live Telegram sync stored
// seven posts published in October and November 2022 -- 1,399 to 1,449 days old --
// and a TOUCH had just confirmed them, so judgeDelivery() called all seven FRESH.
// Correctly: the OBSERVATION was minutes old. The CLAIM was nearly four years old.
//
// The fix at the time hardcoded 90 days in supply-discovery and my own commit
// message admitted it was "my guess at the Tbilisi rental market, not a measured
// number". A guess is an acceptable default. A guess frozen into one call site and
// presented as the market's answer is not, and the next person to read it would
// have had no way to tell which it was.
//
// SO THIS FILE IS HONEST ABOUT ITS OWN CONFIDENCE.
//
// Every ceiling carries a `basis` saying where it came from:
//
//   ASSUMED    a reasonable starting point. NOT measured. Says so.
//   CONFIGURED an operator set it for this market.
//   MEASURED   derived from observed relisting/withdrawal behaviour.
//
// Nothing in this file claims MEASURED today, because nothing has been measured
// today. When the calibration work happens it changes data, not logic.
//
// WHY THE CEILING DEPENDS ON WHAT IS BEING SOLD
//
// A single number cannot be right for the whole market, and being wrong is
// expensive in both directions:
//
//   too SHORT and fresh evidence is discarded, the coverage gate reports a gap
//   that is not there, and the campaign pays to re-find what it already had
//   too LONG and a customer is shown a flat that went three years ago
//
// A short-stay rental turns over in weeks. A residential rental posted three
// months ago is gone. Land advertised two years ago may very well still be for
// sale, and an investment thesis ages slower than any of them. Those are different
// markets wearing one word, so the ceiling is keyed by transaction context.
//
// WHAT THIS IS NOT
//
// It is NOT a freshness rule about our own observations, and the separation is
// deliberate and load-bearing. discovered_at, last_seen_at, last_verified_at and
// content_changed_at all describe what HOMATCH did. published_at describes what the
// SELLER did. Re-reading a post cannot make it newly published, and no function
// here touches judgeDelivery() -- that contract is proven and answers a different
// question. This one is consulted alongside it, never instead of it.

/** What kind of market the evidence belongs to. */
export type ListingContext =
  /** Freehold sale of residential property. */
  | 'SALE'
  /** Long-term residential letting. */
  | 'RENT'
  /** Nightly or weekly letting. */
  | 'SHORT_STAY'
  /** Offices, retail, warehousing. */
  | 'COMMERCIAL'
  /** Plots, agricultural, development land. */
  | 'LAND'
  /** Yield, fund and cross-border investment material. */
  | 'INVESTMENT';

export const LISTING_CONTEXTS: readonly ListingContext[] = [
  'SALE', 'RENT', 'SHORT_STAY', 'COMMERCIAL', 'LAND', 'INVESTMENT',
];

/** Where a ceiling's number came from. Never decorative. */
export type CeilingBasis =
  /** A reasonable starting point that nobody has measured. */
  | 'ASSUMED'
  /** An operator set this for this market. */
  | 'CONFIGURED'
  /** Derived from observed withdrawal or relisting behaviour. */
  | 'MEASURED';

export interface AgeCeiling {
  days: number;
  basis: CeilingBasis;
  /** Plain words, for an operator reading a skipped or scoped sweep. */
  rationale: string;
  /** The context this ceiling was resolved FOR, after any fallback. */
  context: ListingContext | null;
  /** True when no context-specific ceiling existed and the default was used. */
  fellBack: boolean;
}

const DAY_MS = 86_400_000;

/**
 * The ceiling used when nothing more specific exists.
 *
 * Ninety days, carried over from the hardcoded value it replaces so this refactor
 * changes structure and not behaviour. ASSUMED, explicitly: it is the same guess it
 * always was, now labelled as one.
 */
export const DEFAULT_CEILING_DAYS = 90;

/**
 * Starting points per context. Every one is ASSUMED.
 *
 * The relative ORDER is the part worth defending even before anything is measured
 * -- a short-stay listing really does go stale faster than a plot of land, and
 * getting the ordering right matters more than getting any single number right.
 * The magnitudes are placeholders awaiting calibration.
 */
const DEFAULTS: Readonly<Record<ListingContext, { days: number; rationale: string }>> = {
  SHORT_STAY: {
    days: 21,
    rationale: 'nightly and weekly lets turn over in weeks, so a month-old post is usually gone',
  },
  RENT: {
    days: 60,
    rationale: 'a residential letting posted two months ago has almost always been taken',
  },
  SALE: {
    days: 120,
    rationale: 'a sale runs longer than a letting, and a listing can legitimately sit for months',
  },
  COMMERCIAL: {
    days: 180,
    rationale: 'commercial space is marketed for longer and moves slower than residential',
  },
  LAND: {
    days: 365,
    rationale: 'land is often advertised for a year or more and does not go stale the same way',
  },
  INVESTMENT: {
    days: 365,
    rationale: 'investment material describes a thesis rather than one available unit',
  },
};

/**
 * An operator's overrides, as read from configuration.
 *
 * Keyed by context and optionally scoped to a market, so calibrating Tbilisi
 * rentals does not silently re-calibrate Batumi short-stays. Unparseable or
 * non-positive entries are IGNORED rather than clamped: a misconfigured ceiling
 * that silently becomes 1 day would empty the coverage gate and look like a market
 * with no supply.
 */
export interface AgeCeilingConfig {
  /** `{ RENT: 45 }` — applies to every market. */
  byContext?: Partial<Record<ListingContext, number>>;
  /** `{ GE: { RENT: 30 } }` — applies to one market, and wins over byContext. */
  byMarket?: Record<string, Partial<Record<ListingContext, number>>>;
  /** Replaces DEFAULT_CEILING_DAYS when no context is known. */
  defaultDays?: number;
}

/** A positive finite whole number of days, or null. */
function usableDays(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const days = Math.trunc(n);
  return days > 0 ? days : null;
}

/**
 * Normalise whatever the caller knows about the transaction into a context.
 *
 * Returns null rather than guessing. A campaign that has not stated a transaction
 * type gets the default ceiling and is TOLD it fell back, which is better than
 * being silently assigned SALE and given four months of latitude it never asked
 * for.
 */
export function listingContextFrom(input: {
  transaction?: string | null;
  propertyType?: string | null;
}): ListingContext | null {
  const transaction = String(input.transaction ?? '').trim().toUpperCase();
  const propertyType = String(input.propertyType ?? '').trim().toUpperCase();

  /*
   * PROPERTY TYPE FIRST, because it overrules the verb. Land for sale ages like
   * land, not like a flat -- and 'SALE' would otherwise hide that entirely.
   */
  if (/\bLAND\b|\bPLOT\b|AGRICULTUR/.test(propertyType)) return 'LAND';
  if (/COMMERCIAL|OFFICE|RETAIL|WAREHOUSE|INDUSTRIAL/.test(propertyType)) return 'COMMERCIAL';

  if (/SHORT|DAILY|NIGHTLY|HOLIDAY|VACATION|PER_NIGHT/.test(transaction)) return 'SHORT_STAY';
  if (/RENT|LEASE|LET\b|QIRAVDEBA/.test(transaction)) return 'RENT';
  if (/SALE|SELL|BUY|PURCHASE|IKIDEBA/.test(transaction)) return 'SALE';
  if (/INVEST|YIELD|FUND/.test(transaction) || /INVEST/.test(propertyType)) return 'INVESTMENT';

  return null;
}

/**
 * Resolve the ceiling for a context, honouring configuration.
 *
 * Precedence, most specific first: market+context override, context override,
 * the built-in per-context default, then the global default. Each step records
 * what it used and whether it had to fall back — so a coverage decision can be
 * explained without anybody guessing which number applied.
 */
export function resolveAgeCeiling(
  context: ListingContext | null,
  options: { market?: string | null; config?: AgeCeilingConfig } = {},
): AgeCeiling {
  const config = options.config ?? {};
  const market = String(options.market ?? '').trim().toUpperCase();

  if (context) {
    const scoped = market
      ? usableDays(config.byMarket?.[market]?.[context])
      : null;
    if (scoped !== null) {
      return {
        days: scoped,
        basis: 'CONFIGURED',
        context,
        fellBack: false,
        rationale: `set by an operator for ${context} in ${market}`,
      };
    }

    const global = usableDays(config.byContext?.[context]);
    if (global !== null) {
      return {
        days: global,
        basis: 'CONFIGURED',
        context,
        fellBack: false,
        rationale: `set by an operator for ${context} in every market`,
      };
    }

    const builtIn = DEFAULTS[context];
    return {
      days: builtIn.days,
      basis: 'ASSUMED',
      context,
      fellBack: false,
      rationale: `${builtIn.rationale}. Assumed, not measured`,
    };
  }

  /*
   * NO CONTEXT. The fallback applies and says so, because "we used 90 days" and
   * "we used 90 days because nobody told us what this is" are different facts and
   * only the second one is a prompt to fix something.
   */
  const configured = usableDays(config.defaultDays);
  return {
    days: configured ?? DEFAULT_CEILING_DAYS,
    basis: configured !== null ? 'CONFIGURED' : 'ASSUMED',
    context: null,
    fellBack: true,
    rationale: configured !== null
      ? 'no transaction context was stated; an operator-configured default applied'
      : `no transaction context was stated, so the ${DEFAULT_CEILING_DAYS}-day fallback applied. `
        + 'Assumed, not measured, and not a claim about any particular market',
  };
}

/** The same answer in milliseconds, which is what assessCoverage() consumes. */
export function ageCeilingMs(ceiling: AgeCeiling): number {
  return ceiling.days * DAY_MS;
}

/**
 * One line an operator can read next to a coverage verdict.
 *
 * Always names the basis. A number without its provenance is the thing this file
 * was written to stop.
 */
export function describeCeiling(ceiling: AgeCeiling): string {
  const scope = ceiling.context ?? 'unspecified transaction';
  return `${ceiling.days} day(s) for ${scope} [${ceiling.basis}]: ${ceiling.rationale}`;
}
