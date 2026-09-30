// HOMATCH RESEARCH CORE — FINDING TELEGRAM COMMUNITIES WORTH READING.
//
// A registry that only holds the channels someone typed in is a registry that
// never grows. This is the source-discovery half: the multilingual searches
// that surface public real-estate communities, and the deterministic audit that
// decides whether a surfaced community is worth scanning.
//
// Discovery is GLOBAL. A community found for one campaign is kept for every
// campaign after it, so the same search is not paid for twice. Nothing here is
// campaign-specific except which of the kept communities a campaign selects.
//
// The audit is measured, never declared: a sample of the community's own
// recent messages is read, and relevance is the share that talk about
// property, with demand/supply direction counted separately. A community that
// has not posted inside the active-demand window is not activated whatever its
// topic, because a quiet channel cannot produce current demand.

import { classifyDirection, phraseMatches } from '../signals/direction.ts';
import { allPropertyTerms, PROPERTY_TERMS, RESEARCH_LANGUAGES, type ResearchLanguage } from './lexicon.ts';

export interface SourceQuery {
  language: ResearchLanguage;
  query: string;
}

/**
 * Searches per market. Short, the way people name their groups — Telegram's
 * public-chat search matches titles and usernames, not message bodies.
 * Deliberately six languages wide for Georgia: the buyer populations writing
 * in Russian, Turkish, Arabic and Hebrew are real and each has its own groups.
 */
export const TELEGRAM_SOURCE_QUERIES: Record<string, readonly SourceQuery[]> = {
  GE: [
    { language: 'ka', query: 'ბინები თბილისი' },
    { language: 'ka', query: 'უძრავი ქონება' },
    { language: 'ka', query: 'ქირავდება ბინა' },
    { language: 'ru', query: 'аренда квартир тбилиси' },
    { language: 'ru', query: 'недвижимость тбилиси' },
    { language: 'ru', query: 'недвижимость батуми' },
    { language: 'en', query: 'tbilisi apartments' },
    { language: 'en', query: 'tbilisi rent' },
    { language: 'en', query: 'georgia real estate' },
    { language: 'tr', query: 'tiflis kiralık' },
    { language: 'tr', query: 'batum emlak' },
    { language: 'ar', query: 'عقارات جورجيا' },
    { language: 'ar', query: 'شقق تبليسي' },
    { language: 'he', query: 'דירות טביליסי' },
    { language: 'he', query: 'נדל"ן גאורגיה' },
  ],
};

export function sourceQueriesFor(market: string, languages?: readonly string[] | null): SourceQuery[] {
  const all = TELEGRAM_SOURCE_QUERIES[market.toUpperCase()] ?? [];
  if (!languages?.length) return [...all];
  const wanted = new Set(languages.map((l) => l.toLowerCase()));
  return all.filter((q) => wanted.has(q.language));
}

export interface SampleMessage {
  text: string;
  /** Unix seconds — Telegram's own publication time. */
  date: number;
}

export interface SourceAudit {
  sampled: number;
  propertyMessages: number;
  demandMessages: number;
  supplyMessages: number;
  agencyMessages: number;
  /** propertyMessages / sampled; 0 when nothing was sampled. */
  relevance: number;
  lastMessageAt: string | null;
  /** Posted inside the active window at all. */
  active: boolean;
  qualifies: boolean;
  reason: string;
}

/*
 * phraseMatches leaves the END of a word open so inflections match
 * (квартира → квартиру). For very short nouns that is too generous — Turkish
 * `ev` (house) would match "everyone" — so a noun of three letters or fewer
 * must also END at a word boundary here.
 */
const WORD = /[\p{L}\p{N}]/u;
function nounMatches(haystack: string, noun: string): boolean {
  if (!phraseMatches(haystack, noun)) return false;
  if (noun.length > 3 || /[\u0590-\u05FF\u0600-\u06FF\u0900-\u097F]/.test(noun)) return true;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(noun, from);
    if (at === -1) return false;
    const before = at === 0 ? '' : haystack[at - 1];
    const after = haystack[at + noun.length] ?? '';
    if ((!before || !WORD.test(before)) && (!after || !WORD.test(after))) return true;
    from = at + 1;
  }
}

export function mentionsProperty(text: string): boolean {
  const lower = text.toLowerCase();
  for (const term of PROPERTY_TERMS) {
    for (const noun of allPropertyTerms(term)) {
      if (noun && nounMatches(lower, noun)) return true;
    }
  }
  return false;
}

export function auditSource(
  sample: readonly SampleMessage[],
  options: { now?: number; activeMaxDays: number; minRelevance: number },
): SourceAudit {
  const now = options.now ?? Date.now();
  let propertyMessages = 0;
  let demandMessages = 0;
  let supplyMessages = 0;
  let agencyMessages = 0;
  let newest = 0;
  const texts = sample.filter((m) => String(m.text ?? '').trim().length > 0);
  for (const message of texts) {
    if (message.date > newest) newest = message.date;
    const verdict = classifyDirection(message.text, { languages: [...RESEARCH_LANGUAGES], parentContext: null });
    const property = mentionsProperty(message.text) || verdict.direction === 'DEMAND' || verdict.direction === 'SUPPLY';
    if (property) propertyMessages += 1;
    if (verdict.direction === 'DEMAND') demandMessages += 1;
    if (verdict.direction === 'SUPPLY') supplyMessages += 1;
    if (verdict.agencyVoice) agencyMessages += 1;
  }
  const sampled = texts.length;
  const relevance = sampled ? Math.round((propertyMessages / sampled) * 1000) / 1000 : 0;
  const active = newest > 0 && (now - newest * 1000) <= options.activeMaxDays * 86_400_000;
  const qualifies = sampled >= 5 && relevance >= options.minRelevance && active;
  const reason = sampled < 5 ? `only ${sampled} readable message(s) — too few to judge`
    : !active ? `no post inside the ${options.activeMaxDays}-day active window`
    : relevance < options.minRelevance ? `${Math.round(relevance * 100)}% of messages are about property`
    : `${Math.round(relevance * 100)}% about property, ${demandMessages} demand in sample`;
  return {
    sampled, propertyMessages, demandMessages, supplyMessages, agencyMessages, relevance,
    lastMessageAt: newest ? new Date(newest * 1000).toISOString() : null,
    active, qualifies, reason,
  };
}
