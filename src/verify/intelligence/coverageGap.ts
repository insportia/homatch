/*
 * WHAT WE KNOW ABOUT THE PROPERTY — NOT WHAT HOMATCH FAILED TO FIND.
 *
 * The live Villion report told a buyer, in their own language:
 *
 *   „ამ შენობაში ან ამ ქუჩაზე გასაყიდი განცხადება ვერ მოიძებნა…"
 *   „ჩვენამდე მისულმა წყარომ ამაზე არაფერი თქვა…"
 *   „კომუნიკაციების მიერთება ამ შემოწმებისას არ გადამოწმებულა"
 *   „ჩვენს მოძიებულ წყაროებში სხვა დასრულებული პროექტი ვერ დადასტურდა"
 *
 * Every one of those is a diagnostic about OUR CRAWLER. None is a fact about
 * the flat. Printed in a due-diligence report they read as findings against
 * the property, so a buyer discounts a building because our search was thin —
 * and worse, they are the sentences a reader remembers.
 *
 * (They are also mine. I wrote several of them last week while moving gaps out
 * of the report's opening. Moving a diagnostic somewhere politer is not the
 * same as deciding it does not belong to the customer at all.)
 *
 * ── THE THREE CLASSES ────────────────────────────────────────────────
 *
 * PROPERTY_RISK
 *   A source established something adverse. A registered mortgage, a
 *   restriction, a lien. ALWAYS shown, never softened — hiding one of these
 *   to make a report read nicely is the worst thing this module could cause.
 *
 * PROPERTY_UNKNOWN
 *   An authoritative source was consulted and the answer is genuinely open in
 *   a way that changes a decision. Shown — but phrased as the check to run,
 *   not as our failure to run it.
 *
 * RESEARCH_COVERAGE_GAP
 *   We did not reach a source, or reached too few. NEVER customer-facing.
 *   It lowers internal confidence and it disappears from the page.
 *
 * The distinction is not about how bad the news is. It is about whether the
 * sentence describes the WORLD or describes US.
 */

export type FactClass = 'PROPERTY_RISK' | 'PROPERTY_UNKNOWN' | 'RESEARCH_COVERAGE_GAP';

/**
 * How each gap key is classified.
 *
 * Anything absent from this table is treated as a coverage gap, which is the
 * safe default: a new gap nobody classified stays out of the customer's report
 * until somebody decides it belongs there.
 */
const GAP_CLASS: Record<string, FactClass> = {
  /*
   * The registry was READ and the answer is open. That is about the property
   * and it changes what a buyer should do before signing, so it stays — as an
   * instruction rather than as a confession.
   */
  verify_unconf_rights: 'PROPERTY_UNKNOWN',
  verify_unconf_commissioning: 'PROPERTY_UNKNOWN',

  /*
   * Verify runs from a cadastral code. Not being given an asking price is the
   * normal shape of the input, not a property fact, and section 8 is explicit:
   * omit the comparison until it can be calculated rather than explaining why
   * it cannot.
   */
  verify_unconf_subject_price: 'RESEARCH_COVERAGE_GAP',
  /* Nobody we reached published a utility status. That is our coverage. */
  verify_unconf_utilities: 'RESEARCH_COVERAGE_GAP',
};

export function classifyGap(key: string): FactClass {
  return GAP_CLASS[key] ?? 'RESEARCH_COVERAGE_GAP';
}

/** Gaps a customer may see: never a statement about our own reach. */
export function customerFacingGaps<T extends { key: string }>(items: T[]): T[] {
  return items.filter((i) => classifyGap(i.key) !== 'RESEARCH_COVERAGE_GAP');
}

/* ------------------------------------------------------------------ *
 * Prose written by the synthesis model                                *
 * ------------------------------------------------------------------ */

/*
 * Sentences describing OUR SEARCH rather than the property.
 *
 * Matched on the shape of the claim — a first-person research subject plus a
 * failure-to-find — in the six languages the product ships. Deliberately
 * NARROW: a registry statement of established absence ("no encumbrance is
 * registered") is a finding and must survive, so the patterns require a
 * research actor (we / our sources / this check) rather than merely a
 * negative.
 */
const COVERAGE_SENTENCE: readonly RegExp[] = [
  // Georgian: ვერ მოიძებნა / ვერ დადასტურდა / არ გადამოწმებულა with a
  // research subject (წყარო, კვლევა, შემოწმება, ჩვენ).
  /[^.!?]*(?:ჩვენ|წყარო|კვლევ|შემოწმებ|მოძიებ)[^.!?]*(?:ვერ (?:მოიძებნ|დადასტურ|ვიპოვ|გადავამოწმ)|არ (?:გადამოწმ|მოგვეწოდ))[^.!?]*[.!?]/gu,
  /[^.!?]*(?:ვერ მოიძებნა|ვერ ვიპოვეთ|ვერ გადავამოწმეთ|მონაცემი არ გვაქვს)[^.!?]*[.!?]/gu,
  // English
  /[^.!?]*(?:we|our (?:sources|research|search|crawler))[^.!?]*(?:could not|couldn't|did not|didn't|were unable)[^.!?]*(?:find|verify|confirm|reach)[^.!?]*[.!?]/gi,
  /[^.!?]*(?:no (?:listings?|data|sources?) (?:were |was )?(?:found|available))[^.!?]*[.!?]/gi,
  // Russian
  /[^.!?]*(?:мы|наши источники|наше исследование|поиск)[^.!?]*(?:не (?:удалось|нашли|смогли|найдено))[^.!?]*[.!?]/gi,
  /[^.!?]*(?:не удалось (?:найти|проверить|подтвердить))[^.!?]*[.!?]/gi,
  // Turkish
  /[^.!?]*(?:kaynaklarımız|araştırmamız|bulamadık)[^.!?]*[.!?]/gi,
  // Arabic
  /[^.!?]*(?:لم نتمكن|لم نعثر|مصادرنا)[^.!?]*[.!?]/g,
  // Hebrew
  /[^.!?]*(?:לא הצלחנו|לא מצאנו|המקורות שלנו)[^.!?]*[.!?]/g,
];

/** True when a sentence is about our own reach rather than the property. */
export function isCoverageLanguage(text: string): boolean {
  return COVERAGE_SENTENCE.some((re) => {
    re.lastIndex = 0;
    return re.test(text);
  });
}

/**
 * Removes whole sentences that describe our search, leaving the rest intact.
 *
 * Sentence-level rather than phrase-level on purpose: cutting "we could not
 * find" out of a sentence leaves a fragment that often reverses the meaning.
 * A paragraph that becomes empty returns empty, and the caller renders
 * nothing — which is the correct outcome for a paragraph that only ever said
 * what we did not manage to do.
 */
export function scrubCoverageLanguage(text: string): string {
  if (!text) return '';
  let out = text;
  for (const re of COVERAGE_SENTENCE) out = out.replace(re, ' ');
  return out.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
}

/* ------------------------------------------------------------------ *
 * Sections with nothing in them                                       *
 * ------------------------------------------------------------------ */

/**
 * Whether a set of rows carries anything worth a customer's attention.
 *
 * The utilities block rendered five rows saying „ჯერ არ გადამოწმებულა" — a
 * section whose entire content was a list of things Homatch does not know.
 * The rule is global: a section with no meaningful row does not render, and a
 * section with two meaningful rows renders those two and not the placeholders.
 */
export function meaningful<T>(rows: T[], isKnown: (row: T) => boolean): T[] {
  return rows.filter(isKnown);
}

/** True when a section should be rendered at all. */
export function sectionHasContent<T>(rows: T[], isKnown: (row: T) => boolean): boolean {
  return rows.some(isKnown);
}
