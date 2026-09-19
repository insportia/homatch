/*
 * THE FIRST SENTENCE A BUYER READS, AND WHERE THE GAPS GO INSTEAD.
 *
 * The stored Villion report opens with:
 *
 *   „ფასის შეფასება ჯერ ვერ კეთდება, რადგან ბინის ფართობი და მოთხოვნილი ფასი
 *    მოწოდებულ მასალაში არ ჩანს."
 *
 * Verify runs from a cadastral code. It almost never has an asking price or a
 * floor area, because nobody gave it one — so this is not a finding about the
 * property at all, it is a description of the input. Leading with it makes
 * every verification of an unlisted flat open by apologising, and buries the
 * eight things the run genuinely established underneath.
 *
 * WHAT THIS MODULE DOES
 *
 * It does NOT invent a verdict. The model's own label (POSITIVE / BALANCED /
 * NEEDS_ATTENTION) is derived from evidence and is left exactly as it is —
 * turning an attention label into a positive one would be the worse defect in
 * the other direction.
 *
 * What it changes is which SENTENCE carries that label. When the model's
 * statement is about absent input rather than about the property, the sentence
 * is replaced by one that states the same label in plain language, and the
 * missing input is moved to "what remains unconfirmed", which is where a
 * reader goes looking for it.
 *
 * Everything here is deterministic and reads only what the run already
 * produced. No model call, no new evidence, and it works against reports that
 * were stored months ago — which is the whole requirement: the acceptance
 * fixture is a report nobody is allowed to re-run.
 */

/** The three verdicts the synthesis may carry. */
export type OverallLabel = 'POSITIVE' | 'BALANCED' | 'NEEDS_ATTENTION';

export interface SummaryLike {
  label?: unknown;
  statement?: unknown;
  highlights?: unknown;
}

export interface HighlightLike {
  headline?: unknown;
  detail?: unknown;
  sentiment?: unknown;
  dimension?: unknown;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * A sentence that describes MISSING INPUT rather than the property.
 *
 * Matched in the six languages the product ships, and on the shape of the
 * claim rather than on one phrasing: something about price or area, plus
 * something about it being absent or not yet possible. Both halves are
 * required, so "the asking price is 15% above the local median" — a real
 * finding that mentions price — is never caught.
 */
export function isMissingInputStatement(text: string): boolean {
  const s = text.toLowerCase();
  if (!s) return false;

  const subject =
    /ფასი|ფართობ|цен|площад|price|area|fiyat|alan|سعر|مساح|מחיר|שטח/.test(s);
  const absent =
    /ვერ კეთდება|არ ჩანს|არ არის მითითებ|ვერ დგინდება|უცნობი|не удалось|не указан|отсутству|невозможно|cannot|not available|not provided|unavailable|is missing|yok|belirtilme|mümkün değil|غير متاح|لم يتم|لا يمكن|אין|לא ניתן|לא צוין/.test(
      s
    );

  return subject && absent;
}

/**
 * Which verdict this report carries. The model's own, untouched, with an
 * unrecognised value falling to the middle rather than to either extreme.
 */
export function labelOf(summary: SummaryLike | null | undefined): OverallLabel {
  const v = str(summary?.label).toUpperCase();
  return v === 'POSITIVE' || v === 'NEEDS_ATTENTION' ? v : 'BALANCED';
}

export interface Opening {
  label: OverallLabel;
  /**
   * The model's sentence, when it is genuinely about the property. Absent
   * when it described missing input and the UI should render `fallbackKey`.
   */
  statement?: string;
  /** i18n key for the replacement sentence. Present only when replacing. */
  fallbackKey?: string;
  /** True when the model's own sentence was set aside. */
  replaced: boolean;
  /**
   * A very short second line: the headlines of the strongest things the run
   * actually established. Empty when the run established nothing positive,
   * because an encouraging line with nothing behind it is the fabrication
   * this module exists to avoid.
   */
  support: string[];
}

/** One sentence per verdict, stating it plainly and claiming nothing more. */
const FALLBACK_KEY: Record<OverallLabel, string> = {
  POSITIVE: 'verify_open_positive',
  BALANCED: 'verify_open_balanced',
  NEEDS_ATTENTION: 'verify_open_attention',
};

/** How many supporting headlines the opening may carry. */
const SUPPORT_LIMIT = 2;

export function buyerOpening(
  summary: SummaryLike | null | undefined,
  /*
   * The deterministic verdict, when the caller can compute one.
   *
   * The model's own label counts unfinished things; this one weighs them. The
   * stored Villion report is the case: two open questions outvoted five
   * verified positives and produced an alarming headline for a sound property.
   * Absent, the model's label is used unchanged — a report with no structured
   * evidence to weigh should not be re-judged on nothing.
   */
  weighed?: { label: OverallLabel } | null
): Opening {
  const label = weighed?.label ?? labelOf(summary);
  const statement = str(summary?.statement);
  const replaced = !statement || isMissingInputStatement(statement);

  /*
   * The support line is built from POSITIVE highlights only, and only from
   * their headlines. A headline is the model's own compressed claim about
   * something it evidenced; the detail beneath it is a paragraph and belongs
   * further down the report, not in the opening.
   */
  const support = arr(summary?.highlights)
    .map((h) => h as HighlightLike)
    .filter((h) => str(h?.sentiment).toUpperCase() === 'POSITIVE')
    .map((h) => str(h?.headline))
    .filter(Boolean)
    .slice(0, SUPPORT_LIMIT);

  return {
    label,
    ...(replaced ? { fallbackKey: FALLBACK_KEY[label] } : { statement }),
    replaced,
    support,
  };
}

/* ------------------------------------------------------------------ *
 * What remains unconfirmed                                            *
 * ------------------------------------------------------------------ */

export interface UnconfirmedItem {
  /** Stable key: the UI translates it, tests assert on it. */
  key: string;
  /** A value worth showing beside the label, when there is one. */
  detail?: string;
  /**
   * MATERIAL when the gap could change a buying decision, ROUTINE when it is
   * the ordinary consequence of verifying from a cadastral code. The
   * distinction is the point of section 10: a reader must be able to tell
   * "we were not given a price" from "the encumbrance status is unknown".
   */
  weight: 'MATERIAL' | 'ROUTINE';
}

export interface UnconfirmedInput {
  /** synthesis.market — for the subject's own price and area. */
  market?: { subjectValuation?: unknown; contextAvailable?: unknown } | null;
  /** synthesis.snapshot — area lives here when it is known at all. */
  snapshot?: { area?: unknown; constructionStatus?: unknown } | null;
  /** result_json.rightsAndRestrictions — registry-level open questions. */
  rights?: { status?: unknown; items?: unknown } | null;
  /** result_json.utilitiesMatrix — null on every run that never looked. */
  utilities?: unknown;
  /** The summary statement, when it was set aside for describing a gap. */
  replacedStatement?: string;
}

/**
 * The open questions, gathered where a reader expects to find them.
 *
 * Deliberately conservative: an item appears only when the run actually shows
 * the gap. Nothing is listed speculatively, because a long list of things
 * nobody checked reads as a failed verification rather than an honest one.
 */
export function unconfirmedItems(input: UnconfirmedInput): UnconfirmedItem[] {
  const items: UnconfirmedItem[] = [];

  /*
   * The subject's own price and area — the thing that used to be the headline.
   *
   * `subjectValuation` is a STATUS, not a value, and the status for the stored
   * Villion report is the string 'NO_SUBJECT_PRICE'. A truthiness check on it
   * is therefore true precisely when the price is missing, which is backwards:
   * the gap disappeared from this list on the one report that has it. Only
   * 'AVAILABLE' means the unit can actually be placed in its market.
   */
  if (String(input.market?.subjectValuation ?? '') !== 'AVAILABLE') {
    items.push({ key: 'verify_unconf_subject_price', weight: 'ROUTINE' });
  }

  const status = str((input.rights as { status?: unknown } | null)?.status).toUpperCase();
  if (status && status !== 'NONE_FOUND_IN_CHECKED_SOURCE') {
    items.push({ key: 'verify_unconf_rights', weight: 'MATERIAL' });
  }

  // Null means the run never established them, which is not the same as
  // "this building has no utilities" and must never be rendered as if it were.
  if (!input.utilities) {
    items.push({ key: 'verify_unconf_utilities', weight: 'ROUTINE' });
  }

  const construction = str(input.snapshot?.constructionStatus);
  if (construction && /არ წარმოადგენს|not .*proof|не является/i.test(construction)) {
    items.push({ key: 'verify_unconf_commissioning', weight: 'MATERIAL' });
  }

  return items;
}
