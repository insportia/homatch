/*
 * THE MARKET, DESCRIBED BY HOW LOCAL IT ACTUALLY IS.
 *
 * WHAT THE STORED VILLION REPORT SHOWS, AND WHY IT IS WRONG.
 *
 *   tierCounts  SAME_PROJECT 0 · SAME_STREET 0 · SAME_DISTRICT 1 · PEER_PROJECT 37
 *   basis       PEER_PROJECT        median 1,670 USD/m²
 *
 * So the most prominent number in the report is computed from the LEAST local
 * band available, while the two bands that would actually describe this
 * building are empty. The buyer was told:
 *
 *   „37 აქტიური განცხადების peer-project შედარებაში..."
 *
 * which leaks an internal term AND implies those 37 are comparable
 * developments. They are not, and the code is candid about it: `scoreComparable`
 * assigns PEER_PROJECT when a listing merely carries a project NAME, anywhere
 * in the city. Carrying a name is not established similarity, so calling the
 * band „მსგავსი პროექტები" — "similar projects" — is a claim the run never
 * earned.
 *
 * WHAT THIS MODULE CHANGES, AND WHAT IT DOES NOT.
 *
 * It changes nothing about collection, scoring or tiering. The bands, the
 * ordering and the numbers are exactly the ones the research core produced —
 * weakening those would be trading one dishonesty for another.
 *
 * What it decides is presentation: which band may speak first, what each band
 * is HONESTLY called, and whether a headline number has a local enough sample
 * to deserve being a headline at all.
 */

export type MarketTier =
  | 'SAME_PROJECT'
  | 'SAME_STREET'
  | 'SAME_DISTRICT'
  | 'PEER_PROJECT'
  | 'WIDER_MARKET';

/**
 * Most local first. This is the order the buyer's question has — "what is
 * happening in MY building, then my street, then around here" — and the
 * research core's own ranking already agrees with it.
 */
export const TIER_LOCALITY: readonly MarketTier[] = [
  'SAME_PROJECT',
  'SAME_STREET',
  'SAME_DISTRICT',
  'PEER_PROJECT',
  'WIDER_MARKET',
];

/**
 * What each band is called to a customer.
 *
 * PEER_PROJECT is the one that changed. It read „მსგავსი პროექტები" (similar
 * projects), asserting a similarity nothing established; it now says what the
 * band actually is — other residential developments, elsewhere in the city.
 * An honest label costs a little warmth and buys the reader the ability to
 * weigh the number correctly.
 */
export const TIER_LABEL_KEY: Record<MarketTier, string> = {
  SAME_PROJECT: 'verify_mkt_same_project',
  SAME_STREET: 'verify_mkt_same_street',
  SAME_DISTRICT: 'verify_mkt_same_district',
  PEER_PROJECT: 'verify_mkt_other_projects',
  WIDER_MARKET: 'verify_mkt_wider_market',
};

/** The bands that genuinely describe THIS property's immediate market. */
const LOCAL_TIERS = new Set<MarketTier>(['SAME_PROJECT', 'SAME_STREET']);

export interface TierCount {
  tier: MarketTier;
  count: number;
}

export interface MarketShape {
  /** Every band that has at least one listing, most local first. */
  tiers: TierCount[];
  /** The band the median was computed from, as the research core chose it. */
  basis: MarketTier | null;
  /** How many listings that band holds. */
  basisCount: number;
  /**
   * Whether the basis is local enough to headline.
   *
   * False when the number describes the city rather than this address — which
   * is exactly the stored Villion case. The UI still SHOWS the figure; it
   * just stops presenting it as if it measured this building.
   */
  basisIsLocal: boolean;
  /** True when nothing was found in the same project or the same street. */
  noLocalEvidence: boolean;
  /** i18n key for the one sentence that frames the whole block. */
  headlineKey: string;
}

const tierOf = (v: unknown): MarketTier | null => {
  const s = typeof v === 'string' ? v.toUpperCase() : '';
  return (TIER_LOCALITY as readonly string[]).includes(s) ? (s as MarketTier) : null;
};

const count = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/**
 * Reads the stored market block and decides how to talk about it.
 *
 * `tierCounts` is the map the research core persists. Everything else is
 * derived from it, so a report stored before this module existed produces the
 * same answer as one stored after.
 */
export function marketShape(market: unknown): MarketShape | null {
  const m = (market ?? null) as {
    tierCounts?: Record<string, unknown>;
    basis?: unknown;
    basisCount?: unknown;
    count?: unknown;
  } | null;
  if (!m) return null;

  const counts = m.tierCounts ?? {};
  const tiers: TierCount[] = TIER_LOCALITY.map((tier) => ({
    tier,
    count: count(counts[tier]),
  })).filter((t) => t.count > 0);

  const basis = tierOf(m.basis);
  const basisCount = count(m.basisCount) || count(m.count);
  const basisIsLocal = !!basis && LOCAL_TIERS.has(basis);
  const noLocalEvidence = !tiers.some((t) => LOCAL_TIERS.has(t.tier));

  /*
   * The framing sentence, chosen by what the evidence supports:
   *
   *   local        the same building or street answered — say so plainly
   *   surrounding  the figure came from the district — wider, but still here
   *   citywide     the figure came from named developments elsewhere, and the
   *                sentence says so instead of implying otherwise
   *   none         nothing was found at all
   *
   * Keyed on the BASIS, not on which bands merely exist. The stored Villion
   * report holds one district listing beside 37 citywide ones and computes
   * its median from the 37 — so a single local row must not let the block
   * describe itself as local.
   */
  const headlineKey = !tiers.length
    ? 'verify_mkt_frame_none'
    : basisIsLocal
      ? 'verify_mkt_frame_local'
      : basis === 'SAME_DISTRICT'
        ? 'verify_mkt_frame_surrounding'
        : 'verify_mkt_frame_citywide';

  return { tiers, basis, basisCount, basisIsLocal, noLocalEvidence, headlineKey };
}

/* ------------------------------------------------------------------ *
 * Internal vocabulary must not reach a customer                       *
 * ------------------------------------------------------------------ */

/*
 * Terms that describe how Homatch works, not what it found.
 *
 * These reach the customer because the synthesis model is shown the internal
 * field names and sometimes writes them back out — „37 აქტიური განცხადების
 * peer-project შედარებაში" is in the stored report, in production, today.
 *
 * A prompt instruction is a request; this is the control. Stripping happens at
 * render, so it also repairs every report already in the database, which no
 * prompt change can do.
 */
const INTERNAL_TERMS: readonly RegExp[] = [
  /\bpeer[-\s]?projects?\b/gi,
  /\bpeer[-\s]?set\b/gi,
  /\bcomparable\s+universe\b/gi,
  /\bresearch\s+lane\b/gi,
  /\bsource\s+famil(?:y|ies)\b/gi,
  /\bwider[-\s]?market\b/gi,
  /\bsame[-\s]?(?:project|street|district)\b/gi,
  /\btier[-\s]?counts?\b/gi,
];

/**
 * Removes internal vocabulary from a sentence written for a customer.
 *
 * The term is cut rather than translated, and the surrounding punctuation and
 * spacing are repaired, because a phrase like "in the peer-project comparison"
 * still reads correctly as "in the comparison" — whereas substituting a
 * plausible replacement would be putting words in the model's mouth about
 * evidence it may not have had.
 */
export function stripInternalTerms(text: string): string {
  if (!text) return '';
  let out = text;
  for (const re of INTERNAL_TERMS) out = out.replace(re, '');
  return out
    /*
     * ORDER MATTERS, AND IT CAUGHT ME.
     *
     * The bracket a removal emptied has to go BEFORE the space-before-
     * punctuation repair. Run the other way round, "1,670 (peer-project)."
     * becomes "1,670 ()." then "1,670 ." — the stray space outliving the
     * very cleanup meant to remove it.
     */
    .replace(/\s{2,}/g, ' ')
    .replace(/([(\[«„])\s+/g, '$1')
    .replace(/\s+([)\]»"])/g, '$1')
    // An empty bracket is what is left when the whole parenthetical was one;
    // it takes the space in front of it with it.
    .replace(/\s*[([{«„]\s*[)\]}»"]/g, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** True when a customer-facing string still carries internal vocabulary. */
export function hasInternalTerms(text: string): boolean {
  return INTERNAL_TERMS.some((re) => {
    re.lastIndex = 0;
    return re.test(text);
  });
}
