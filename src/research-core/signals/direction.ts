// HOMATCH RESEARCH CORE — is this person asking, or offering?
//
// "Looking to buy a 2BR in Tbilisi" and "2BR apartment for sale in Krtsanisi,
// $145,000" are the same market, the same district, very nearly the same
// words — and each is worthless to the job that wanted the other. Getting
// this wrong does not degrade a result, it inverts it: the buyer search
// returns estate agents, and the property search returns people with no
// property.
//
// WHY THIS IS DETERMINISTIC AND NOT A PROMPT
//
// The rule is stated once here, in code, in seven languages, and it is the
// same rule for every job. A prompt asked to remember it gets it right most
// of the time, which for a filter means it is wrong often enough to matter,
// differently on every run, with no diff to review.
//
// Homatch already proves the approach works: classify-signals-v2 runs a
// deterministic `isSupplyAd()` before it spends a token on the model, and the
// reject_non_demand_match() trigger enforces the same thing in SQL. This is
// that logic, generalised to both directions and to every supported language,
// in one place both of them could eventually call.
//
// WHAT IT DELIBERATELY WILL NOT DO
//
// It will not guess. A post that carries no direction signal comes back
// UNKNOWN, and UNKNOWN satisfies no job — not the buyer search, not the
// property search. An engine that resolves ambiguity in favour of whichever
// job is running is an engine that always finds something.

import {
  LEXICON,
  RESEARCH_LANGUAGES,
  type PropertyTerm,
  type ResearchLanguage,
} from '../discovery/lexicon.ts';
import type { ResearchDirection } from '../core/types.ts';

export interface DirectionVerdict {
  direction: ResearchDirection;
  /** 0..1. How strongly the text committed. Never rounded up. */
  confidence: number;
  /** The phrases that decided it, for the audit trail and for review. */
  matched: string[];
  /** Languages whose vocabulary matched. A post can mix two. */
  languages: ResearchLanguage[];
  /**
   * True when the writer looks like an agency rather than a principal.
   *
   * Not a rejection on its own — an agency posting inventory is perfectly
   * good SUPPLY. It is a rejection for DEMAND, where "we have clients looking
   * for 2BR flats" is a sales pitch, not a lead.
   */
  agencyVoice: boolean;
  /** Property nouns present, so a land job can refuse a flat. */
  propertyTerms: PropertyTerm[];
}

/**
 * Structural markers of a LISTING as opposed to a request.
 *
 * A price with a unit, an area with a unit, and a contact handle are the
 * shape of an advertisement whatever language it is in. Kept separate from
 * the phrase lists because the shape survives translation and the phrases do
 * not — this is the same heuristic classify-signals-v2 already relies on.
 */
const PRICE_WITH_UNIT = /(\d[\d\s.,]{1,12})\s*(usd|\$|gel|₾|eur|€|try|₺|₪|ils|aed|د\.إ|₹|inr|руб|lari)/i;
const AREA_WITH_UNIT = /(\d[\d\s.,]{0,8})\s*(sq\.?\s?m|m²|m2|sqm|кв\.?\s?м|კვ\.?\s?მ|מ"ר|متر مربع|वर्ग मीटर)/i;
const CONTACT_HANDLE = /(^|\s)(@\w{3,})|(\+?\d[\d\s()\-]{8,})/;
const LISTING_FEATURES =
  /(deposit|commission|floor|balcony|elevator|furnished|parking|renovated|депозит|этаж|балкон|лифт|мебель|паркинг|სართული|აივანი|ლიფტი|ავეჯით|kat|balkon|asansör|eşyalı|طابق|شرفة|مصعد|مفروش|קומה|מרפסת|מעלית|מרוהט|मंजिल|बालकनी|लिफ्ट)/i;

/**
 * A budget written without a unit: "around 150000", "up to 150k".
 *
 * Demand posts often name a figure with no currency at all, and requiring a
 * currency symbol would score exactly the posts that matter lowest.
 */
const BARE_BUDGET = /\d{2,3}\s?(k|ათას|тыс|bin|ألف|אלף|हज़ार)|\d{4,7}/;

/** A question mark is weak evidence of asking rather than offering. */
const QUESTION_MARK = /[?؟]/;

function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[  ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Phrase containment, not word-boundary matching.
 *
 * `\b` does not work for Georgian, Arabic, Hebrew or Devanagari — it is
 * defined on ASCII word characters, so `\bიყიდება\b` never matches. That
 * exact bug has already been found and fixed twice in this codebase, once in
 * a currency regex and once in an encumbrance regex. Substring containment on
 * a whitespace-normalized string works for every script here.
 */
function countMatches(haystack: string, phrases: readonly string[]): string[] {
  const found: string[] = [];
  for (const phrase of phrases) {
    if (phrase && haystack.includes(phrase)) found.push(phrase);
  }
  return found;
}

export interface ClassifyOptions {
  /** Restrict to these languages. Defaults to all of them. */
  languages?: readonly ResearchLanguage[];
  /**
   * The parent post a comment sits under.
   *
   * A comment inherits its SUBJECT from its parent and nothing else. "Is this
   * still available? Looking to buy" names no property and no price, and read
   * alone it is a weak signal — but under a listing for a 2BR in Vake at
   * $160k it is a person asking about that specific flat, which is one of the
   * strongest leads a housing group produces.
   *
   * So the parent contributes the property noun and the figure, and NEVER a
   * direction phrase. That asymmetry is the whole point: the parent of almost
   * every good buyer comment is a SUPPLY listing, and letting its "for sale"
   * count would flip every one of those comments to the wrong direction —
   * which is precisely the inversion this module exists to prevent.
   */
  parentContext?: string | null;
}

export function classifyDirection(
  rawText: string,
  options: ClassifyOptions = {},
): DirectionVerdict {
  const languages = options.languages ?? RESEARCH_LANGUAGES;
  const text = normalize(rawText);
  // Subject only. Read below for property nouns and figures; never consulted
  // for direction phrases.
  const context = options.parentContext ? normalize(options.parentContext) : '';

  const demandHits: string[] = [];
  const supplyHits: string[] = [];
  const agencyHits: string[] = [];
  const languagesSeen = new Set<ResearchLanguage>();
  const terms = new Set<PropertyTerm>();
  /** Property nouns the parent named. Subject, not direction. */
  const inheritedTerms = new Set<PropertyTerm>();

  for (const language of languages) {
    const lex = LEXICON[language];

    const demand = [
      ...countMatches(text, lex.wantToBuy),
      ...countMatches(text, lex.wantToRent),
      ...countMatches(text, lex.wantToInvest),
    ];
    const supply = [
      ...countMatches(text, lex.forSale),
      ...countMatches(text, lex.forRent),
    ];
    const agency = countMatches(text, lex.agency);

    if (demand.length || supply.length) languagesSeen.add(language);
    demandHits.push(...demand);
    supplyHits.push(...supply);
    agencyHits.push(...agency);

    for (const term of Object.keys(lex.propertyTypes) as PropertyTerm[]) {
      if (countMatches(text, lex.propertyTypes[term]).length > 0) terms.add(term);
      else if (context && countMatches(context, lex.propertyTypes[term]).length > 0) {
        inheritedTerms.add(term);
      }
    }
  }

  // A stated price or size. On the demand side this is the difference
  // between "thinking about buying" and "buying, with a number in mind".
  const hasFigure =
    PRICE_WITH_UNIT.test(text) || AREA_WITH_UNIT.test(text) || BARE_BUDGET.test(text) ||
    (!!context && (PRICE_WITH_UNIT.test(context) || AREA_WITH_UNIT.test(context)));

  const listingShape =
    (PRICE_WITH_UNIT.test(text) || AREA_WITH_UNIT.test(text)) &&
    (CONTACT_HANDLE.test(rawText) || LISTING_FEATURES.test(text));

  const agencyVoice = agencyHits.length > 0;
  // A term the comment itself named outranks one inherited from the parent,
  // but either answers "what is this about".
  const propertyTerms = terms.size > 0 ? [...terms] : [...inheritedTerms];
  const languagesArray = [...languagesSeen];

  // ── DEMAND WINS A TIE, and only when the supply evidence is phrase-only ──
  //
  // "Looking to buy an apartment, anything for sale in Vake?" contains a
  // supply phrase and is plainly a buyer. But a post carrying the STRUCTURE
  // of a listing — a price, an area, a phone number — is an advertisement
  // even when it opens with a friendly "looking for a new owner".
  if (demandHits.length > 0 && !listingShape) {
    return {
      direction: 'DEMAND',
      confidence: demandConfidence({
        demand: demandHits.length,
        supply: supplyHits.length,
        text,
        hasPropertyTerm: propertyTerms.length > 0,
        hasFigure,
      }),
      matched: demandHits,
      languages: languagesArray,
      agencyVoice,
      propertyTerms,
    };
  }

  if (supplyHits.length > 0 || listingShape) {
    const matched = [...supplyHits];
    if (listingShape) matched.push('[listing-structure]');
    return {
      direction: 'SUPPLY',
      confidence: supplyConfidence({
        supply: supplyHits.length,
        demand: demandHits.length,
        listingShape,
        hasPropertyTerm: propertyTerms.length > 0,
      }),
      matched,
      languages: languagesArray,
      agencyVoice,
      propertyTerms,
    };
  }

  // Nothing said which way round it is. That is an answer, and it is not
  // "whichever the caller was hoping for".
  return {
    direction: 'UNKNOWN',
    confidence: 0,
    matched: [],
    languages: languagesArray,
    agencyVoice,
    propertyTerms,
  };
}

/**
 * How committed is this?
 *
 * Not "how many phrases matched" — that rewards verbosity. What separates a
 * lead from a passing remark is whether the writer said WHAT they want and,
 * ideally, HOW MUCH they will pay. "Looking to buy" alone is a thought;
 * "looking to buy a 2BR apartment in Vake, budget 150k" is a person with a
 * plan, and the scoring has to put the second comfortably above a job's
 * floor while leaving the first below it.
 *
 * The numbers are calibrated against exactly that: an unambiguous post that
 * names a phrase, a property noun and a figure clears 0.6, and a bare phrase
 * with nothing else does not.
 */
function demandConfidence(input: {
  demand: number;
  supply: number;
  text: string;
  hasPropertyTerm: boolean;
  hasFigure: boolean;
}): number {
  let score = 0.45;
  // A second distinct phrasing is real corroboration; a tenth is not.
  score += Math.min(0.12, input.demand * 0.06);
  // They said what they want.
  if (input.hasPropertyTerm) score += 0.12;
  // They said what they will spend, or how big. The strongest single signal
  // that somebody is actually in the market rather than musing.
  if (input.hasFigure) score += 0.1;
  if (QUESTION_MARK.test(input.text)) score += 0.03;
  // Supply phrasing alongside demand phrasing means a less clear-cut post.
  if (input.supply > 0) score -= 0.15;
  return clamp(score);
}

function supplyConfidence(input: {
  supply: number;
  demand: number;
  listingShape: boolean;
  hasPropertyTerm: boolean;
}): number {
  let score = input.supply > 0 ? 0.5 : 0.42;
  score += Math.min(0.12, input.supply * 0.06);
  if (input.hasPropertyTerm) score += 0.1;
  // A price, an area and a contact is the shape of an advertisement in any
  // language, and it survives translation where phrasing does not.
  if (input.listingShape) score += 0.15;
  if (input.demand > 0) score -= 0.15;
  return clamp(score);
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, Math.round(value * 100) / 100));
}

/**
 * Would this signal count for a job wanting `wanted`, at `minConfidence`?
 *
 * Three ways to fail, and each of them is a real case:
 *   - the direction is wrong, or unknown;
 *   - the text committed too weakly — "anyone know about property here?" is
 *     not a lead, and treating every commenter as one is the failure mode
 *     this whole layer exists to prevent;
 *   - an agency is talking, and the job wanted a principal.
 */
export function satisfiesJob(
  verdict: DirectionVerdict,
  wanted: ResearchDirection,
  options: { minConfidence?: number; rejectAgencyVoice?: boolean } = {},
): boolean {
  if (verdict.direction === 'UNKNOWN') return false;
  if (verdict.direction !== wanted) return false;
  if (verdict.confidence < (options.minConfidence ?? 0.55)) return false;
  if (options.rejectAgencyVoice && verdict.agencyVoice) return false;
  return true;
}
