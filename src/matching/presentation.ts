// TURNING A CLASSIFIER'S OUTPUT INTO SOMETHING A PROPERTY OWNER WANTS TO READ.
//
// The match card used to show its own working: "Transaction intent matches", "Country
// matches", "City matches", "Property type matches", a platform code, a language code
// and a confidence percentage. Every one of those is true and none of them is what the
// person is there for. They want to know who this is, what they want, whether it fits,
// and what to do next.
//
// So this module is the translation layer, and it is a MODULE rather than a handful of
// ternaries in the card for two reasons: it is pure and therefore testable, and the
// mapping from five internal strengths to three customer words is a claim that has to
// be defensible rather than improvised per screen.
//
// WHAT IT REFUSES TO DO
//
// Invent a tier that the data does not support, or soften one. The five internal values
// map onto three labels by a fixed rule written down below, and nothing here looks at a
// score to decide a word — `signal_strength` is what the matcher recorded and it is the
// only input.

/** The three words a customer sees. Five internal strengths collapse onto these. */
export type FitTier = 'STRONG' | 'GOOD' | 'POSSIBLE';

/**
 * The internal strength vocabulary, as run-matching-v2 records it.
 *
 * Listed here rather than imported so this module stays free of the page, but the
 * values are the matcher's and a new one must be added deliberately — see `fitTier`,
 * which refuses to guess.
 */
export const SIGNAL_STRENGTHS = [
  'EXCEPTIONAL', 'VERY_STRONG', 'STRONG', 'GOOD', 'POTENTIAL',
] as const;

export type SignalStrength = (typeof SIGNAL_STRENGTHS)[number];

/**
 * Five recorded strengths, three words.
 *
 * THE MAPPING IS THE CLAIM, so it is fixed and written down:
 *
 *   EXCEPTIONAL, VERY_STRONG, STRONG  →  STRONG    "a strong fit"
 *   GOOD                              →  GOOD      "a good fit"
 *   POTENTIAL                         →  POSSIBLE  "possibly a fit"
 *
 * Three rather than five because a customer cannot act differently on "exceptional"
 * than on "very strong", and offering them the distinction implies they should.
 *
 * An unrecognised value returns POSSIBLE, the most cautious of the three. That is the
 * honest failure: a strength this module has never heard of might be anything, and
 * calling it strong would be inventing confidence from ignorance.
 */
export function fitTier(strength: string | null | undefined): FitTier {
  switch (String(strength ?? '').trim().toUpperCase()) {
    case 'EXCEPTIONAL':
    case 'VERY_STRONG':
    case 'STRONG':
      return 'STRONG';
    case 'GOOD':
      return 'GOOD';
    default:
      return 'POSSIBLE';
  }
}

/** Who the person on the other side of this property is. */
export type Counterpart = 'BUYER' | 'TENANT' | 'INVESTOR';

/**
 * The counterpart a property's transaction type implies.
 *
 * A match on a property is a DEMAND signal the matcher judged compatible with it, so
 * the transaction type of the property is what names the person: a listing for sale is
 * matched against buyers, a rental against tenants.
 *
 * Null when the transaction type is absent or unrecognised — a real state for a
 * half-finished import — and the card then says something true but unspecific rather
 * than guessing which half of the market somebody is in.
 */
export function counterpartFor(transactionType: string | null | undefined): Counterpart | null {
  switch (String(transactionType ?? '').trim().toUpperCase()) {
    case 'SALE': return 'BUYER';
    case 'RENT': return 'TENANT';
    case 'INVESTMENT': return 'INVESTOR';
    default: return null;
  }
}

/**
 * The i18n key for a card's headline — who this is and what they are after.
 *
 * Returns a KEY, never a sentence: this is read in six languages and a phrase built by
 * concatenation here would be English word order imposed on all of them. Georgian and
 * Arabic do not put "looking for" where English does.
 *
 * The generic key is not a failure state to be hidden. "Someone interested in your
 * property" is true of every match, and it is a better thing to show than a confident
 * guess about a person whose intent was never recorded.
 */
export function headlineKey(counterpart: Counterpart | null): string {
  const who = counterpart ? counterpart.toLowerCase() : 'generic';
  /*
   * IT NAMES A POSSIBILITY, NOT A PERSON'S STATUS.
   *
   * This said "A buyer looking for a 3-bedroom in Tbilisi", and the first two words were
   * a claim the product cannot support. What was found is a DISCOVERED INTENT SIGNAL: a
   * person who wrote something compatible with this property. They are not a buyer. They
   * have not agreed to anything, may have bought elsewhere in the seventeen years since
   * some of these were posted, and calling them a buyer sets an expectation the evidence
   * does not carry.
   *
   * So the line describes potential interest and the DIRECTION of it — buying, renting,
   * investing — which the property's own transaction type establishes and which is
   * therefore safe to say. The counterpart enum keeps its internal names; only the
   * customer wording changes.
   *
   * The city and the room count moved to the facts row, where they are facts rather than
   * part of an identity claim.
   */
  return `match_headline_${who}`;
}

/**
 * How many matching dimensions agreed, as a plain count.
 *
 * The card shows a SENTENCE about the fit rather than a checklist, and this is what
 * that sentence is built from. `match_reasons` is the matcher's own list — each entry
 * is one dimension it found agreement on — so its length is a real number and not a
 * derived score.
 */
/*
 * THE HEDGES DO NOT COUNT AS AGREEMENT.
 *
 * run-matching-v2 pushes 'Transaction intent partially known' into `reasons` and awards
 * it 12 points, which is defensible arithmetic: a signal that never said whether it
 * wanted to buy or rent is not evidence against the match. But it is not agreement
 * either, and counting it lets a card say "agrees on 4 points" when three of the four
 * are agreements and the fourth is an absence. The set is named so the exception is
 * inspectable rather than implicit.
 */
const HEDGE_REASONS: ReadonlySet<string> = new Set([
  'transaction intent partially known',
]);

export function agreementCount(reasons: readonly string[] | null | undefined): number {
  return (reasons ?? [])
    .map((reason) => String(reason ?? '').trim())
    .filter((reason) => reason.length > 0 && !HEDGE_REASONS.has(reason.toLowerCase()))
    .length;
}

/**
 * THE MATCHER'S PHRASES, TRANSLATED — AND IT IS THE MATCHER THAT WRITES THEM.
 *
 * `match_reasons` and `mismatch_reasons` are not free text. run-matching-v2's score()
 * pushes literals from a closed set of sixteen, in English, and the card rendered them
 * verbatim: a Georgian customer read "Transaction intent matches", "Country matches",
 * "City matches". Two faults at once — English inside a Georgian page, and the matcher's
 * vocabulary where a person's belongs.
 *
 * So the mapping lives HERE, on the client, and the engine is not touched. These strings
 * are stored on every historical match row; a server-side change would have to migrate
 * them and would still leave the existing rows in English. Translating at the point of
 * display fixes the old rows and the new ones together.
 *
 * Keyed on the lowercased literal, copied from supabase/functions/run-matching-v2
 * (score()). If a new reason is added there and not here, `reasonKey` returns null and
 * the caller shows the raw phrase — English, but present. Dropping it would be worse:
 * the evidence drawer is the product's account of why a match exists, and silently
 * shortening that account is the one thing it must not do.
 */
const REASON_KEYS: Readonly<Record<string, string>> = {
  /* agreement */
  'transaction intent matches': 'match_reason_transaction',
  'country matches': 'match_reason_country',
  'city matches': 'match_reason_city',
  'location broadly compatible': 'match_reason_location_near',
  'district/neighborhood matches': 'match_reason_district',
  'property type matches': 'match_reason_type',
  'budget compatible': 'match_reason_budget',
  'budget near range': 'match_reason_budget_near',
  'area compatible': 'match_reason_area',
  'description/needs overlap': 'match_reason_description',
  /* the hedge — said as the absence it is, not as an agreement */
  'transaction intent partially known': 'match_reason_transaction_unstated',
  /* disagreement */
  'transaction differs': 'match_gap_transaction',
  'country differs': 'match_gap_country',
  'city differs': 'match_gap_city',
  'property type differs': 'match_gap_type',
  'budget differs': 'match_gap_budget',
};

/**
 * WHAT AGREED, AS THREE NOUNS RATHER THAN A CHECKLIST.
 *
 * The card said "Matches on 5 points". A count is not a reason — it tells somebody how
 * much agreement there was without telling them what agreed, which is the half that
 * decides whether a lead is worth opening.
 *
 * So the eleven agreement literals collapse onto SIX FACETS, and the card says "Fits your
 * property on location, type and budget." Four separate location reasons (country, city,
 * district, broadly-compatible) are one fact to a reader; listing them four times is the
 * checklist dump this replaces.
 *
 * Order is fixed and meaningful — deal, location, type, budget, size, needs — so two
 * cards never phrase the same agreement differently. Deduplicated, because a match with
 * country AND city AND district agreement has agreed about ONE thing: where.
 *
 * The hedge contributes nothing, for the same reason agreementCount() will not count it.
 */
const REASON_FACETS: Readonly<Record<string, string>> = {
  'transaction intent matches': 'match_facet_deal',
  'country matches': 'match_facet_location',
  'city matches': 'match_facet_location',
  'location broadly compatible': 'match_facet_location',
  'district/neighborhood matches': 'match_facet_location',
  'property type matches': 'match_facet_type',
  'budget compatible': 'match_facet_budget',
  'budget near range': 'match_facet_budget',
  'area compatible': 'match_facet_size',
  'description/needs overlap': 'match_facet_needs',
};

const FACET_ORDER = [
  'match_facet_deal',
  'match_facet_location',
  'match_facet_type',
  'match_facet_budget',
  'match_facet_size',
  'match_facet_needs',
] as const;

/**
 * The facets a match agreed on, deduplicated and in a fixed order.
 *
 * Empty when nothing recognised agreed — a real state for the earliest matches, and the
 * card then says nothing rather than asserting a fit it cannot name.
 */
export function matchFacets(reasons: readonly string[] | null | undefined): string[] {
  const found = new Set<string>();
  for (const reason of reasons ?? []) {
    const facet = REASON_FACETS[String(reason ?? '').trim().toLowerCase()];
    if (facet) found.add(facet);
  }
  return FACET_ORDER.filter((facet) => found.has(facet));
}

/**
 * The i18n key for one stored reason, or null when we have never seen the phrase.
 *
 * Null rather than a guess, and the caller then shows the raw phrase. A reason we cannot
 * translate is still a reason we recorded.
 */
export function reasonKey(reason: string | null | undefined): string | null {
  return REASON_KEYS[String(reason ?? '').trim().toLowerCase()] ?? null;
}

/**
 * "12d ago", said in the reader's language.
 *
 * `preview_recency` is a STRING the matcher wrote, not a timestamp — formatRecency()
 * turns hours-since-publication into a label at match time and stores it. So the card had
 * "2 days ago" and "5m ago" in English on a Georgian page, beside a Georgian city name,
 * and the hardcoded-string audit never saw it because the English is in a database column.
 *
 * TWO GENERATIONS OF THE SAME FUNCTION WROTE THESE, and they disagree about minutes:
 * run-matching says "5 min ago", run-matching-v2 says "5m ago". Both are on real rows.
 * Hours and days agree.
 *
 * Returns the unit and the number, or null for a label neither of them produced — and the
 * caller shows the stored text in that case. An unparsed label is still true; inventing a
 * duration for it, or hiding when the person spoke, would not be.
 *
 * Deliberately NOT re-derived from created_at: that is when the MATCH was made, and this
 * is when the PERSON SPOKE. A signal read a week after it was posted would report the
 * wrong one.
 */
export function recencyParts(
  label: string | null | undefined,
): { key: string; count: number } | null {
  const match = /^(\d+)\s*(min|m|h|d)\s*ago$/i.exec(String(label ?? '').trim());
  if (!match) return null;
  const count = Number(match[1]);
  if (!Number.isFinite(count)) return null;
  switch (match[2].toLowerCase()) {
    case 'min':
    case 'm': return { key: 'match_recency_minutes', count };
    case 'h': return { key: 'match_recency_hours', count };
    case 'd': return scaleDays(count);
    default: return null;
  }
}

/**
 * Days, in the unit somebody can actually read.
 *
 * FOUND ON PRODUCTION, on a real customer's matches, in Georgian: "6309 დღის წინ".
 * Six thousand three hundred and nine days. Nobody parses that as seventeen years, and
 * that particular card was asking 35 credits for the contact details.
 *
 * The number is NOT wrong and it is not hidden. raw_signals.published_at for that row is
 * 2009-06-18 and the matcher's arithmetic is exact — these are genuinely old forum
 * threads, not bad timestamps, which was worth checking before writing this. So the age
 * stays on the card; it is the single most decision-relevant fact about a lead. What
 * changes is the unit, so that the fact arrives.
 *
 * The thresholds are chosen so the label rounds to something with meaning rather than
 * precision nobody needs: below two months, days; below two years, months; after that,
 * years. "4 months ago" and "17 years ago" are both more honest to a reader than the day
 * count that produced them, because a reader can act on them.
 */
function scaleDays(days: number): { key: string; count: number } {
  if (days >= 730) return { key: 'match_recency_years', count: Math.round(days / 365) };
  if (days >= 60) return { key: 'match_recency_months', count: Math.round(days / 30) };
  return { key: 'match_recency_days', count: days };
}

/**
 * A matching dimension, as the word the customer used for it.
 *
 * `agreed`, `conflicted` and `preference_misses` are arrays of the MatchDimension enum —
 * CITY, DISTRICT, PROPERTY_TYPE, PRICE — and a card that printed them showed a Georgian
 * customer "DISTRICT". They are the same six things the search plan asks about, so the
 * plan's own labels are the translation, already written in six languages.
 *
 * Null for a dimension with no customer-facing name. The caller shows the raw token
 * rather than dropping it: an English word is a smaller failure than a missing one.
 */
const DIMENSION_KEYS: Readonly<Record<string, string>> = {
  TRANSACTION: 'plan_row_goal',
  CITY: 'plan_field_city',
  DISTRICT: 'plan_field_districts',
  PROPERTY_TYPE: 'plan_field_types',
  PRICE: 'plan_field_budget',
  AREA: 'plan_field_area',
  BEDROOMS: 'plan_row_bedrooms',
};

export function dimensionKey(dimension: string | null | undefined): string | null {
  return DIMENSION_KEYS[String(dimension ?? '').trim().toUpperCase()] ?? null;
}

/**
 * The same units, from a timestamp instead of a label.
 *
 * Matches carry a preformatted "6309d ago"; a discovered listing carries an ISO date. Two
 * inputs, one scale — because "4 months ago" has to mean the same thing on both screens,
 * and a second rounding rule written next to a second screen is how they stop meaning the
 * same thing.
 *
 * Null for a listing whose publication date nobody recorded, which is a real state: the
 * card says nothing about age rather than implying it is fresh.
 */
export function recencyFromDate(
  iso: string | null | undefined,
  now: number = Date.now(),
): { key: string; count: number } | null {
  if (!iso) return null;
  const published = Date.parse(String(iso));
  if (!Number.isFinite(published)) return null;
  const days = Math.floor((now - published) / 86_400_000);
  /* A future timestamp is bad data, not a fresh listing, and "-3 days ago" is worse than
     saying nothing. Today and yesterday both read as days, which is what they are. */
  if (days < 0) return null;
  return scaleDays(days);
}

/**
 * Whether a card should offer the "why this match?" disclosure at all.
 *
 * Nothing to disclose means no control: a chevron that opens an empty drawer is worse
 * than no chevron, and a card with no recorded reasons is a real state rather than a
 * bug — the earliest matches predate reason recording.
 */
export function hasEvidence(
  reasons: readonly string[] | null | undefined,
  mismatches: readonly string[] | null | undefined,
): boolean {
  return agreementCount(reasons) > 0 || agreementCount(mismatches) > 0;
}
