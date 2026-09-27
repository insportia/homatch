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
export function headlineKey(
  counterpart: Counterpart | null,
  known: { city?: boolean; rooms?: boolean } = {},
): string {
  const who = counterpart ? counterpart.toLowerCase() : 'generic';
  /*
   * TEN IDENTICAL HEADLINES IS NOT A LIST.
   *
   * The first version returned one key per counterpart, and a screenshot of ten matches
   * was ten cards each reading "A buyer looking for a property like yours". True of all
   * of them, useful about none of them — the kind of repetition that makes a page read as
   * generated, and it pushed the only distinguishing facts down a line where they were
   * competing with a headline that said nothing.
   *
   * So the headline carries what the signal actually stated. Three shapes, and which one
   * is used depends on what was RECORDED rather than on what would read nicely: a variant
   * naming a city we do not have is a variant that renders "looking in undefined".
   *
   * ROOMS WITHOUT A CITY FALLS BACK TO THE BASE FORM. "A buyer looking for a 3-bedroom",
   * with no place, is a worse headline than the general one — bedroom counts mean
   * something next to a location and very little on their own.
   *
   * Still keys, still never concatenation. Each variant is written per language with its
   * own word order; `{{rooms}}` and `{{city}}` go where that language puts them.
   */
  if (known.city && known.rooms) return `match_headline_${who}_rooms_city`;
  if (known.city) return `match_headline_${who}_city`;
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
    case 'd': return { key: 'match_recency_days', count };
    default: return null;
  }
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
