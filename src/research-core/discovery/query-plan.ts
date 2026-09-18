// HOMATCH RESEARCH CORE — turning one job into a multilingual search plan.
//
// A broker in Tbilisi types "2BR Krtsanisi, buyers" in English. The people
// they want are writing "ვეძებ ბინას ვაკეში", "ищу квартиру в Тбилиси",
// "Tiflis'te daire arıyorum" — none of which contain an English word. A plan
// built from the job's own language finds none of them.
//
// So a plan is the cross product of:
//
//   languages the MARKET is written in  ×  intent phrasings  ×
//   property nouns  ×  location terms
//
// bounded by a budget, ordered so the most valuable combinations survive the
// cut, and DETERMINISTIC: the same job produces the same plan, today and
// tomorrow, which is what makes coalescing and cache keys work at all.
//
// The old discovery function built something similar inline, but only for the
// demand side, only in six languages, and with a rotation keyed off
// Date.now() — so the same job produced a different plan every six hours and
// nothing could be cached or tested. Rotation survives here as an explicit
// seed the caller passes, which keeps the coverage benefit and loses the
// irreproducibility.
//
// DIRECTION DECIDES THE PHRASES. A PROPERTY_SEARCH plan is built from "for
// sale" and "იყიდება"; a BUYER_SEARCH plan from "looking to buy" and "ვეძებ
// საყიდლად". They are different searches, not one search filtered afterwards.

import { deterministicId } from '../core/ids.ts';
import type { ResearchDirection } from '../core/types.ts';
import {
  LEXICON,
  languagesForMarket,
  type PropertyTerm,
  type ResearchLanguage,
} from './lexicon.ts';

/** What the job is about. Everything a plan needs and nothing more. */
export interface ResearchSubject {
  /** ISO country code. Decides which languages are worth searching. */
  countryCode: string;
  city?: string | null;
  district?: string | null;
  neighborhoods?: string[];
  /** Which property nouns matter. A land job must not search for flats. */
  propertyTerms: PropertyTerm[];
  transaction: 'SALE' | 'RENT' | 'ANY';
  bedrooms?: number | null;
  budgetMax?: number | null;
  currency?: string | null;
}

export type QueryIntent =
  | 'WANT_TO_BUY'
  | 'WANT_TO_RENT'
  | 'WANT_TO_INVEST'
  | 'RELOCATING'
  | 'OFFER_SALE'
  | 'OFFER_RENT';

export interface PlannedQuery {
  /** Stable across runs: the same plan re-dedupes and re-hits the cache. */
  id: string;
  text: string;
  language: ResearchLanguage;
  /** Which side of the market this query is fishing for. */
  direction: ResearchDirection;
  intent: QueryIntent;
  propertyTerm: PropertyTerm;
  locationTerm: string;
  /** Higher runs first when the budget cuts the plan short. */
  priority: number;
}

export interface QueryPlan {
  subject: ResearchSubject;
  direction: ResearchDirection;
  languages: ResearchLanguage[];
  queries: PlannedQuery[];
  /** How many combinations existed before the budget cut it. */
  consideredCount: number;
}

export interface PlanOptions {
  /** Maximum queries to emit. The plan is ordered, so the cut keeps the best. */
  maxQueries?: number;
  /**
   * Which languages to search. Defaults to what the market is written in.
   * Passing this narrows; it never adds a language the caller did not name.
   */
  languages?: readonly ResearchLanguage[];
  /**
   * Rotates which slice of a large plan is taken, so repeated background runs
   * cover ground the first run could not afford. An explicit number rather
   * than a clock read: a plan that changes by itself cannot be cached,
   * coalesced or tested.
   */
  rotationSeed?: number;
}

/** The intents that belong to each direction, in preference order. */
const DEMAND_INTENTS: Record<'SALE' | 'RENT' | 'ANY', QueryIntent[]> = {
  SALE: ['WANT_TO_BUY', 'WANT_TO_INVEST', 'RELOCATING'],
  RENT: ['WANT_TO_RENT', 'RELOCATING'],
  ANY: ['WANT_TO_BUY', 'WANT_TO_RENT', 'WANT_TO_INVEST', 'RELOCATING'],
};

const SUPPLY_INTENTS: Record<'SALE' | 'RENT' | 'ANY', QueryIntent[]> = {
  SALE: ['OFFER_SALE'],
  RENT: ['OFFER_RENT'],
  ANY: ['OFFER_SALE', 'OFFER_RENT'],
};

/**
 * Phrases safe to COMPOSE a query from.
 *
 * Several of the most idiomatic phrasings already contain a property noun —
 * Georgian "ბინა იყიდება" is literally "apartment is for sale", and it is how
 * a Georgian actually writes it. Excellent for recognising a post; wrong for
 * building one, because the planner appends the job's own noun and a land
 * search would end up asking for "apartment for sale land".
 *
 * So composition uses the noun-free subset and classification keeps them all.
 * The filter reads the noun lists rather than a hand-maintained flag, so a
 * phrase added later is handled without anybody remembering this rule.
 */
function composablePhrases(language: ResearchLanguage, intent: QueryIntent): string[] {
  const nouns = Object.values(LEXICON[language].propertyTypes).flat();
  return phrasesFor(language, intent).filter(
    (phrase) => !nouns.some((noun) => phrase.includes(noun)),
  );
}

function phrasesFor(language: ResearchLanguage, intent: QueryIntent): string[] {
  const lex = LEXICON[language];
  switch (intent) {
    case 'WANT_TO_BUY':
      return lex.wantToBuy;
    case 'WANT_TO_RENT':
      return lex.wantToRent;
    case 'WANT_TO_INVEST':
      return lex.wantToInvest;
    case 'RELOCATING':
      return lex.relocating;
    case 'OFFER_SALE':
      return lex.forSale;
    case 'OFFER_RENT':
      return lex.forRent;
  }
}

/**
 * Location terms, most specific first.
 *
 * A neighbourhood query finds fewer posts but nearly all of them are
 * relevant; a country query finds many and nearly all are not. The priority
 * below reflects that, so a small budget spends itself on the narrow ones.
 */
function locationTerms(subject: ResearchSubject): Array<{ term: string; priority: number }> {
  const out: Array<{ term: string; priority: number }> = [];
  const city = (subject.city ?? '').trim();
  const district = (subject.district ?? '').trim();

  for (const neighborhood of subject.neighborhoods ?? []) {
    const value = neighborhood.trim();
    if (!value) continue;
    out.push({ term: city ? `${value} ${city}` : value, priority: 100 });
  }
  if (district) out.push({ term: city ? `${district} ${city}` : district, priority: 90 });
  if (city) out.push({ term: city, priority: 70 });
  if (!city && !district) out.push({ term: subject.countryCode, priority: 40 });

  // De-duplicate while keeping the highest priority for each term.
  const best = new Map<string, number>();
  for (const entry of out) {
    const existing = best.get(entry.term);
    if (existing === undefined || entry.priority > existing) best.set(entry.term, entry.priority);
  }
  return [...best.entries()].map(([term, priority]) => ({ term, priority }));
}

export function planQueries(
  subject: ResearchSubject,
  direction: ResearchDirection,
  options: PlanOptions = {},
): QueryPlan {
  if (direction !== 'DEMAND' && direction !== 'SUPPLY') {
    // REFERENCE and UNKNOWN have no phrase vocabulary of their own. A caller
    // wanting market context searches the supply side and reads it as
    // context; asking for a plan for "unknown" is a caller bug.
    return {
      subject,
      direction,
      languages: [],
      queries: [],
      consideredCount: 0,
    };
  }

  const languages = (options.languages ?? languagesForMarket(subject.countryCode)) as ResearchLanguage[];
  const intents = direction === 'DEMAND'
    ? DEMAND_INTENTS[subject.transaction]
    : SUPPLY_INTENTS[subject.transaction];

  const terms = subject.propertyTerms.length > 0 ? subject.propertyTerms : (['property'] as PropertyTerm[]);
  const locations = locationTerms(subject);

  const all: PlannedQuery[] = [];

  for (const language of languages) {
    const lex = LEXICON[language];
    for (let intentIndex = 0; intentIndex < intents.length; intentIndex += 1) {
      const intent = intents[intentIndex] as QueryIntent;
      const phrases = composablePhrases(language, intent);
      for (let phraseIndex = 0; phraseIndex < phrases.length; phraseIndex += 1) {
        const phrase = phrases[phraseIndex] as string;
        for (const term of terms) {
          const nouns = lex.propertyTypes[term];
          // One noun per (phrase, term): the rest are near-synonyms and
          // multiply the plan without widening it.
          const noun = nouns[0];
          if (!noun) continue;
          for (const location of locations) {
            const text = `${phrase} ${noun} ${location.term}`.replace(/\s+/g, ' ').trim();
            all.push({
              id: deterministicId('q', language, intent, text),
              text,
              language,
              direction,
              intent,
              propertyTerm: term,
              locationTerm: location.term,
              // Specific location first; then the job's primary intent; then
              // the most idiomatic phrasing, which is the one listed first.
              priority: location.priority - intentIndex * 5 - Math.min(phraseIndex, 9),
            });
          }
        }
      }
    }
  }

  // Deterministic order: priority, then id. Never insertion order, which
  // depends on object key iteration and would drift.
  all.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

  const max = options.maxQueries ?? 120;
  const queries = takeRotated(all, max, options.rotationSeed ?? 0);

  return {
    subject,
    direction,
    languages,
    queries,
    consideredCount: all.length,
  };
}

/**
 * Take `count` entries starting at a seeded offset, wrapping around.
 *
 * Interleaved by language so a small budget still covers every language
 * rather than spending itself entirely on Georgian because Georgian sorted
 * first. Losing a language completely is worse than losing depth in all of
 * them: a missed language is a missed population.
 */
function takeRotated(all: PlannedQuery[], count: number, seed: number): PlannedQuery[] {
  if (all.length === 0 || count <= 0) return [];
  if (count >= all.length) return all;

  const byLanguage = new Map<ResearchLanguage, PlannedQuery[]>();
  for (const query of all) {
    const bucket = byLanguage.get(query.language);
    if (bucket) bucket.push(query);
    else byLanguage.set(query.language, [query]);
  }

  const buckets = [...byLanguage.values()];
  const offsets = buckets.map((bucket) => Math.abs(seed) % bucket.length);

  const out: PlannedQuery[] = [];
  let round = 0;
  while (out.length < count) {
    let tookAny = false;
    for (let i = 0; i < buckets.length && out.length < count; i += 1) {
      const bucket = buckets[i] as PlannedQuery[];
      if (round >= bucket.length) continue;
      const index = ((offsets[i] as number) + round) % bucket.length;
      out.push(bucket[index] as PlannedQuery);
      tookAny = true;
    }
    if (!tookAny) break;
    round += 1;
  }
  return out;
}

/**
 * The phrases a job would ACCEPT in a result, as opposed to search for.
 *
 * A plan searches with a handful of idiomatic phrasings for budget reasons.
 * Deciding whether a fetched post is relevant must consider all of them, in
 * every language, because the post was not written to match our query.
 */
export function acceptancePhrases(
  direction: ResearchDirection,
  transaction: 'SALE' | 'RENT' | 'ANY',
  languages: readonly ResearchLanguage[],
): string[] {
  const intents = direction === 'DEMAND' ? DEMAND_INTENTS[transaction] : SUPPLY_INTENTS[transaction];
  const out: string[] = [];
  for (const language of languages) {
    for (const intent of intents) out.push(...phrasesFor(language, intent));
  }
  return [...new Set(out)];
}
