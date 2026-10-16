// Per-language outcome of a search (find_buyers_campaigns.stats.languageOutcomes), parsed
// defensively: older campaigns have none, and an unknown outcome is dropped rather than
// shown as searched. Pure: no imports, so node:test loads it directly.

export type LanguageOutcome = 'NOT_PLANNED' | 'NOT_RUN' | 'SOURCE_UNAVAILABLE' | 'SEARCHED_NO_RESULTS' | 'RESULTS_FILTERED' | 'RESULTS';
export interface LanguageOutcomeRow { language: string; outcome: LanguageOutcome; people: number }

const OUTCOMES = new Set<LanguageOutcome>(['NOT_PLANNED', 'NOT_RUN', 'SOURCE_UNAVAILABLE', 'SEARCHED_NO_RESULTS', 'RESULTS_FILTERED', 'RESULTS']);
const LANGS = ['ka', 'en', 'ru', 'ar', 'he', 'tr'];

export function parseLanguageOutcomes(stats: unknown): LanguageOutcomeRow[] {
  const raw = stats && typeof stats === 'object' ? (stats as { languageOutcomes?: unknown }).languageOutcomes : null;
  if (!Array.isArray(raw)) return [];
  const out: LanguageOutcomeRow[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const x = r as Record<string, unknown>;
    const language = String(x.language ?? '').toLowerCase();
    const outcome = String(x.outcome ?? '') as LanguageOutcome;
    if (!LANGS.includes(language) || !OUTCOMES.has(outcome) || out.some((o) => o.language === language)) continue;
    const people = Number(x.people);
    out.push({ language, outcome, people: Number.isFinite(people) && people > 0 ? Math.floor(people) : 0 });
  }
  return out.sort((a, b) => LANGS.indexOf(a.language) - LANGS.indexOf(b.language));
}

/** Only these outcomes mean the language was actually searched. */
export const searchedIn = (o: LanguageOutcome) => o === 'SEARCHED_NO_RESULTS' || o === 'RESULTS_FILTERED' || o === 'RESULTS';
