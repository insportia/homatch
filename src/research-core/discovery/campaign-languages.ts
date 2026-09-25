// HOMATCH RESEARCH CORE — which languages a campaign searches in, and who decided.
//
// WHY THIS IS NOT A PLANNER DETAIL
//
// planQueries() already builds a multilingual plan from languagesForMarket():
// a Georgian market means ka, ru, en, tr, ar, he, hi, every time, whoever
// asked. That is the right default and the wrong contract. A customer running
// a Tbilisi investor campaign who knows their buyers are Israeli and Russian
// is paying for four languages they did not want, and cannot say so.
//
// So the language set is a CAMPAIGN PARAMETER with an owner, and this module
// is the only thing that decides it. Everything downstream — source
// selection, query generation, job fan-out, coverage reporting, the resume
// path — is handed the result rather than working it out again, because a
// second opinion computed in a worker is how "the customer chose Hebrew" turns
// into "we searched six languages and billed for them".
//
// THREE THINGS CALLED LANGUAGE, AND THEY ARE NOT THE SAME
//
//   UI LANGUAGE       what the customer reads Homatch in. Never an input
//                     here — see the test that asserts this module cannot
//                     see a locale. Someone using the Georgian interface may
//                     run a Hebrew + Russian campaign, and routinely should.
//   SEARCH LANGUAGE   what this module decides. Which lexicons build the
//                     queries and which sources are eligible.
//   SOURCE LANGUAGE   what a discovered signal turned out to be written in.
//                     Observed, never assumed, and stored on the evidence.
//
// AUTO IS A RECOMMENDATION, NOT A SECRET
//
// AUTO exists because most customers do not know which languages their
// buyers write in, and the registry does: it has a record of which languages
// actually produced useful results in this market for this kind of job. But
// the recommendation is returned WITH its reasons and is overridable, because
// a set of languages chosen on the customer's behalf and never shown to them
// is a charge they cannot check.
//
// EXPLICIT IS A CEILING, NOT A HINT
//
// The one invariant worth stating on its own: when a customer names a
// language set, nothing may widen it. Not the market default, not a
// productive-source heuristic, not a "we noticed Georgian sources were
// cheaper". resolveCampaignLanguages returns exactly what was chosen, and a
// test asserts that adding market languages to an EXPLICIT selection changes
// nothing.

import {
  isResearchLanguage,
  languagesForMarket,
  RESEARCH_LANGUAGES,
  type ResearchLanguage,
} from './lexicon.ts';

/**
 * The languages a customer may choose for a campaign.
 *
 * A SUBSET of RESEARCH_LANGUAGES, not a second taxonomy: `hi` is a research
 * language because there is a real Indian buyer population in Georgia worth
 * reaching, but Homatch renders no Hindi interface and there is no Hindi
 * lexicon review path, so offering it as a campaign checkbox would be
 * offering something nobody here can check the quality of.
 *
 * Adding a language later is adding it to this array. The assertion below
 * makes that impossible to do wrongly.
 */
export const CAMPAIGN_SEARCH_LANGUAGES = ['ka', 'en', 'ru', 'he', 'ar', 'tr'] as const;

export type CampaignSearchLanguage = (typeof CAMPAIGN_SEARCH_LANGUAGES)[number];

/*
 * Every campaign language must be a research language, or the planner would
 * be handed a key its lexicon does not have. Checked at module load rather
 * than in a test, so it cannot be true only on the machine that ran the test.
 */
for (const language of CAMPAIGN_SEARCH_LANGUAGES) {
  if (!isResearchLanguage(language)) {
    throw new Error(`campaign language "${language}" is not a research language`);
  }
}

export function isCampaignSearchLanguage(value: unknown): value is CampaignSearchLanguage {
  return typeof value === 'string'
    && (CAMPAIGN_SEARCH_LANGUAGES as readonly string[]).includes(value);
}

/**
 * How the language set was arrived at.
 *
 *   EXPLICIT  the customer ticked boxes. Authoritative; never widened.
 *   AUTO      Homatch recommended, the customer accepted. Shown, overridable.
 *   ALL       every supported language. A deliberate, expensive choice.
 */
export type LanguageMode = 'EXPLICIT' | 'AUTO' | 'ALL';

export interface LanguageRationale {
  language: CampaignSearchLanguage;
  /** Operator- and customer-facing. Why this language is in the plan. */
  reason: string;
  /**
   * What the reason rests on. `MARKET` is a standing fact about where the
   * campaign is; `REGISTRY` is evidence from sources that actually produced
   * something; `CUSTOMER` is a choice, which needs no justification at all.
   */
  basis: 'CUSTOMER' | 'MARKET' | 'REGISTRY' | 'ALL_SUPPORTED';
}

export interface CampaignLanguageSelection {
  /** The set the campaign will actually search. Ordered, de-duplicated. */
  languages: CampaignSearchLanguage[];
  mode: LanguageMode;
  /**
   * What AUTO would have chosen, always populated — including under EXPLICIT,
   * so the UI can show "you chose HE, RU; we would have suggested HE, RU, EN"
   * without a second call and without acting on it.
   */
  recommended: CampaignSearchLanguage[];
  /** One entry per selected language. Never empty when languages is not. */
  rationale: LanguageRationale[];
  /**
   * Set when the request asked for something that could not be honoured —
   * an unsupported code, or an empty explicit set. The selection still
   * resolves to something usable; this says what was dropped, so the caller
   * can tell the customer rather than quietly searching a different set.
   */
  warnings: string[];
}

/**
 * What the registry knows about which languages pay off here.
 *
 * Supplied by the caller from source productivity, so this module stays pure
 * and testable. Absent means "no evidence yet", which is different from
 * "evidence of nothing" and is treated that way below.
 */
export interface LanguageEvidence {
  language: CampaignSearchLanguage;
  /** Sources known to carry this language in this market. */
  knownSources: number;
  /** Signals from them that survived a job filter, ever. */
  usefulSignals: number;
}

export interface ResolveLanguagesRequest {
  mode: LanguageMode;
  /** Required for EXPLICIT; ignored otherwise. */
  selected?: readonly string[];
  countryCode: string;
  /**
   * What the registry has seen in this market. Optional: AUTO falls back to
   * the market default, which is a worse recommendation and an honest one.
   */
  evidence?: readonly LanguageEvidence[];
  /** Cap on how many languages AUTO will recommend. Budget lives upstream. */
  maxAuto?: number;
}

/**
 * The languages this market is written in, narrowed to what a campaign may
 * choose and kept in the market's own order of importance.
 */
export function marketLanguages(countryCode: string): CampaignSearchLanguage[] {
  return languagesForMarket(countryCode).filter(isCampaignSearchLanguage);
}

/**
 * Decide the campaign's language set.
 *
 * Pure. Given the same request it returns the same answer, which is what lets
 * a resumed campaign be compared against its original selection instead of
 * being re-derived and silently drifting.
 */
export function resolveCampaignLanguages(
  request: ResolveLanguagesRequest,
): CampaignLanguageSelection {
  const warnings: string[] = [];
  const recommended = recommendLanguages(request);

  if (request.mode === 'ALL') {
    return {
      languages: [...CAMPAIGN_SEARCH_LANGUAGES],
      mode: 'ALL',
      recommended,
      rationale: CAMPAIGN_SEARCH_LANGUAGES.map((language) => ({
        language,
        reason: 'Every supported discovery language was requested.',
        basis: 'ALL_SUPPORTED' as const,
      })),
      warnings,
    };
  }

  if (request.mode === 'EXPLICIT') {
    const chosen: CampaignSearchLanguage[] = [];
    for (const raw of request.selected ?? []) {
      const value = String(raw).trim().toLowerCase();
      if (!isCampaignSearchLanguage(value)) {
        warnings.push(`"${raw}" is not a supported discovery language and was ignored.`);
        continue;
      }
      if (!chosen.includes(value)) chosen.push(value);
    }

    if (chosen.length === 0) {
      /*
       * An empty explicit set would search nothing, which is not a campaign.
       * Falling back to the recommendation is the only outcome that produces
       * work — but it is a DIFFERENT set from the one that was asked for, so
       * the mode changes to AUTO and it is said out loud. Silently running
       * the recommendation under an EXPLICIT label is the exact failure this
       * module exists to prevent.
       */
      warnings.push('No supported language was selected; the recommended set is used instead.');
      return { languages: recommended, mode: 'AUTO', recommended, rationale: rationaleFor(recommended, request, 'AUTO'), warnings };
    }

    return {
      languages: chosen,
      mode: 'EXPLICIT',
      recommended,
      rationale: chosen.map((language) => ({
        language,
        reason: 'Selected for this campaign.',
        basis: 'CUSTOMER' as const,
      })),
      warnings,
    };
  }

  return {
    languages: recommended,
    mode: 'AUTO',
    recommended,
    rationale: rationaleFor(recommended, request, 'AUTO'),
    warnings,
  };
}

/**
 * What AUTO suggests: the market's languages, re-ordered by what has actually
 * worked here, capped.
 *
 * Evidence RE-RANKS, it does not filter. A language with no record is not a
 * language known to be useless — every language had no record once, and a
 * recommender that only ever suggests what already worked can never discover
 * that a market has an Arabic-speaking investor population. So the market set
 * is the candidate pool and evidence decides the order within it.
 */
function recommendLanguages(request: ResolveLanguagesRequest): CampaignSearchLanguage[] {
  const pool = marketLanguages(request.countryCode);
  if (pool.length === 0) return [];

  const byLanguage = new Map<CampaignSearchLanguage, LanguageEvidence>();
  for (const row of request.evidence ?? []) {
    if (isCampaignSearchLanguage(row.language)) byLanguage.set(row.language, row);
  }

  const marketRank = new Map(pool.map((language, index) => [language, index]));
  const scored = pool.map((language) => ({ language, score: evidenceScore(byLanguage.get(language)) }));

  scored.sort((a, b) =>
    b.score - a.score
    // Ties keep the market's own ordering, which puts the local language
    // first rather than whichever sorted alphabetically.
    || (marketRank.get(a.language) ?? 0) - (marketRank.get(b.language) ?? 0));

  const cap = Math.max(1, Math.min(request.maxAuto ?? 3, CAMPAIGN_SEARCH_LANGUAGES.length));
  return scored.slice(0, cap).map((entry) => entry.language);
}

/**
 * How much a language has earned its place, 0..1.
 *
 * No evidence scores as UNPROVEN rather than 0, above a language that has a
 * long record of producing nothing and below one that has produced something
 * — the same shape as the source registry's prior, and for the same reason.
 */
const UNPROVEN = 0.3;

function evidenceScore(evidence: LanguageEvidence | undefined): number {
  if (!evidence) return UNPROVEN;
  if (evidence.knownSources <= 0) return UNPROVEN;
  if (evidence.usefulSignals <= 0) {
    // Sources exist and have never produced anything useful. That IS evidence,
    // and it is bad — but not disqualifying, because they may never have been
    // scanned for this kind of job.
    return 0.1;
  }
  const perSource = evidence.usefulSignals / evidence.knownSources;
  return Math.min(1, 0.4 + Math.min(0.6, perSource / 10));
}

function rationaleFor(
  languages: readonly CampaignSearchLanguage[],
  request: ResolveLanguagesRequest,
  _mode: LanguageMode,
): LanguageRationale[] {
  const byLanguage = new Map<CampaignSearchLanguage, LanguageEvidence>();
  for (const row of request.evidence ?? []) {
    if (isCampaignSearchLanguage(row.language)) byLanguage.set(row.language, row);
  }

  return languages.map((language) => {
    const evidence = byLanguage.get(language);
    if (evidence && evidence.usefulSignals > 0) {
      return {
        language,
        basis: 'REGISTRY' as const,
        reason: `${evidence.usefulSignals} useful result${evidence.usefulSignals === 1 ? '' : 's'} `
          + `from ${evidence.knownSources} known source${evidence.knownSources === 1 ? '' : 's'} in this market.`,
      };
    }
    return {
      language,
      basis: 'MARKET' as const,
      reason: `Commonly written in ${request.countryCode.trim().toUpperCase()}; no result history yet.`,
    };
  });
}

/* ────────────────────────────────────────────────────────────────────────
 * Resume, and the work that must not be paid for twice
 * ──────────────────────────────────────────────────────────────────────── */

export interface LanguageDelta {
  /** Languages to discover now. The only ones that should produce new jobs. */
  added: CampaignSearchLanguage[];
  /** Languages the customer removed. Their existing evidence is KEPT. */
  removed: CampaignSearchLanguage[];
  /** Already discovered under this campaign. Never re-run by a resume. */
  unchanged: CampaignSearchLanguage[];
}

/**
 * What changed between a campaign's last language set and its next one.
 *
 * The case this exists for: a campaign ran HE + EN, the customer adds RU.
 * Resuming must run RUSSIAN discovery and nothing else. Re-running Hebrew
 * because the language set "changed" would bill a second time for work whose
 * results are already sitting in the campaign, and the customer would be
 * paying for the edit rather than for the language.
 *
 * Removal never deletes anything. Hebrew results found last week are still
 * real evidence about the world; a customer narrowing a campaign is saying
 * "stop spending on this", not "pretend you never found it".
 */
export function languageDelta(
  previous: readonly string[],
  next: readonly string[],
): LanguageDelta {
  const before = new Set(previous.filter(isCampaignSearchLanguage));
  const after = next.filter(isCampaignSearchLanguage);
  const afterSet = new Set(after);

  return {
    added: after.filter((language) => !before.has(language)),
    removed: [...before].filter((language) => !afterSet.has(language)),
    unchanged: after.filter((language) => before.has(language)),
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * What another language actually costs
 * ──────────────────────────────────────────────────────────────────────── */

export interface LanguageCostInput {
  language: CampaignSearchLanguage;
  /** Sources the plan would scan for this language, from the registry. */
  plannedSources: number;
  /** Of those, how many are ALSO planned for another language in this set. */
  sharedSources: number;
  /** Of those, how many hold intelligence still inside the freshness window. */
  freshSources: number;
}

export interface LanguagePlanEstimate {
  perLanguage: Array<{
    language: CampaignSearchLanguage;
    /** Source-scans this language adds that no other language already pays for. */
    incrementalScans: number;
    /** Scans avoided because the source was shared with another language. */
    sharedWith: number;
    /** Scans avoided because what we hold is still fresh. */
    servedFromFresh: number;
  }>;
  /** Total scans the whole set needs. NOT the sum of each language alone. */
  incrementalScans: number;
  /** What the set would cost if every language were run on its own. */
  naiveScans: number;
  /** naive - incremental. What sharing and freshness saved. */
  savedScans: number;
}

/**
 * What a language set actually costs to run, before it is run.
 *
 * NOT a multiplication. Adding Russian to a Hebrew campaign in Tbilisi does
 * not double the work: a Tbilisi expat group carries both languages and is
 * scanned once, and anything inside the freshness window is not re-fetched at
 * all. Quoting six languages at six times one language would overprice the
 * exact configuration Homatch is trying to encourage.
 *
 * It is also not free. `incrementalScans` counts only the sources a language
 * adds that nothing else in the set already covers, which is the honest
 * number to put in front of somebody choosing a budget.
 *
 * A scan is the unit because it is what the registry can count. Turning scans
 * into credits is a billing decision and belongs with the billing code, not
 * here.
 */
export function estimateLanguagePlan(
  inputs: readonly LanguageCostInput[],
): LanguagePlanEstimate {
  const perLanguage = inputs.map((input) => {
    const planned = Math.max(0, Math.trunc(input.plannedSources));
    const shared = clamp(input.sharedSources, planned);
    const fresh = clamp(input.freshSources, planned);

    /*
     * A shared source is counted once for the SET, so each language after the
     * first carries half of it -- not zero, because a second language still
     * costs its own queries and its own extraction pass over the same page,
     * and not one, because the fetch is not paid for twice.
     */
    const sharedCost = shared / 2;
    const remaining = Math.max(0, planned - shared - fresh);

    return {
      language: input.language,
      incrementalScans: round1(remaining + sharedCost),
      sharedWith: shared,
      servedFromFresh: fresh,
    };
  });

  const incrementalScans = round1(perLanguage.reduce((sum, row) => sum + row.incrementalScans, 0));
  const naiveScans = inputs.reduce((sum, input) => sum + Math.max(0, Math.trunc(input.plannedSources)), 0);

  return {
    perLanguage,
    incrementalScans,
    naiveScans,
    savedScans: round1(Math.max(0, naiveScans - incrementalScans)),
  };
}

function clamp(value: number, max: number): number {
  const n = Number.isFinite(value) ? Math.trunc(value) : 0;
  return Math.max(0, Math.min(n, max));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/* ────────────────────────────────────────────────────────────────────────
 * Coverage, per language, without inventing a percentage
 * ──────────────────────────────────────────────────────────────────────── */

export interface LanguageCoverage {
  language: CampaignSearchLanguage;
  /** Sources the plan intended to scan. */
  attempted: number;
  /** Sources that answered with content. */
  reached: number;
  /** Sources that refused: a wall, a block, a removal. Named, not hidden. */
  blocked: number;
  /** Raw items read. */
  signalsFound: number;
  /** Items that survived the job's filter AND were not already known. */
  uniqueResults: number;
}

/**
 * Coverage for one language, as a statement rather than a percentage.
 *
 * `attempted` is what the plan intended, and `reached + blocked` is what
 * happened to it. The gap between them is sources still in flight, which is a
 * real third state and not a rounding error. Nothing here divides by a total
 * number of sources in the world, because no such number exists — a "73%
 * coverage" figure would be a fraction of a denominator nobody can produce.
 */
export function summariseCoverage(
  rows: readonly LanguageCoverage[],
): {
  byLanguage: LanguageCoverage[];
  totals: Omit<LanguageCoverage, 'language'>;
  /** True when at least one language attempted a source and reached none. */
  anyLanguageFullyBlocked: boolean;
} {
  const byLanguage = [...rows].sort((a, b) => a.language.localeCompare(b.language));
  const sum = (pick: (row: LanguageCoverage) => number) => rows.reduce((total, row) => total + pick(row), 0);

  return {
    byLanguage,
    totals: {
      attempted: sum((row) => row.attempted),
      reached: sum((row) => row.reached),
      blocked: sum((row) => row.blocked),
      signalsFound: sum((row) => row.signalsFound),
      uniqueResults: sum((row) => row.uniqueResults),
    },
    anyLanguageFullyBlocked: rows.some((row) => row.attempted > 0 && row.reached === 0),
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * The other thing called language, kept apart on purpose
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Whether a discovered person can be TALKED TO, which is not where they were
 * found.
 *
 * WHY THIS IS A SEPARATE FUNCTION IN A SEPARATE SHAPE
 *
 * Because merging it with the search languages would be so easy and so
 * wrong. A Hebrew-speaking investor found in a Hebrew-language forum is an
 * excellent match for a Georgian-language listing in Tbilisi — the property
 * does not care what language the buyer reads, and a broker who speaks
 * English can work with both. Treating "we searched Hebrew sources" as "this
 * buyer requires Hebrew" would throw away most of the point of searching
 * several languages at once.
 *
 * So a communication requirement is a SEPARATE, EXPLICIT, usually EMPTY
 * constraint. A campaign that sets none matches across every language, which
 * is the default and the right one. A broker who genuinely only speaks
 * Russian can say so, and then it filters — on the person, not on the source.
 */
export interface CommunicationRequirement {
  /**
   * Languages the customer must be able to communicate in. EMPTY means no
   * requirement, which is the default and not the same as "all".
   */
  required: readonly string[];
}

export type CommunicationVerdict = 'NO_REQUIREMENT' | 'COMPATIBLE' | 'INCOMPATIBLE' | 'UNKNOWN';

/**
 * Can this person be communicated with, given the campaign's requirement?
 *
 *   NO_REQUIREMENT  the campaign set none. Everything matches.
 *   COMPATIBLE      a stated language of theirs is one the campaign needs.
 *   UNKNOWN         a requirement exists and we do not know their languages.
 *                   NOT the same as incompatible: a person whose languages we
 *                   never observed has not failed the test, and dropping them
 *                   silently would hide every lead whose post was too short
 *                   to detect a language from.
 *   INCOMPATIBLE    we know their languages and none is required.
 */
export function communicationVerdict(
  requirement: CommunicationRequirement | null | undefined,
  personLanguages: readonly (string | null | undefined)[],
): CommunicationVerdict {
  const required = (requirement?.required ?? [])
    .map((value) => String(value).trim().toLowerCase())
    .filter(Boolean);
  if (required.length === 0) return 'NO_REQUIREMENT';

  const theirs = personLanguages
    .map((value) => String(value ?? '').trim().toLowerCase())
    .filter(Boolean);
  if (theirs.length === 0) return 'UNKNOWN';

  return theirs.some((language) => required.includes(language)) ? 'COMPATIBLE' : 'INCOMPATIBLE';
}

/**
 * Should this person be excluded from the results?
 *
 * Only on a definite INCOMPATIBLE. UNKNOWN is delivered with the uncertainty
 * attached rather than dropped, because "we could not tell what language they
 * write in" is a fact about our reading and not about them.
 */
export function excludedByCommunication(verdict: CommunicationVerdict): boolean {
  return verdict === 'INCOMPATIBLE';
}

/** Every research language, for callers that need the superset. */
export const ALL_RESEARCH_LANGUAGES: readonly ResearchLanguage[] = RESEARCH_LANGUAGES;
