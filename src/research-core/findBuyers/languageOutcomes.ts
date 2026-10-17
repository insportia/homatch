// FIND BUYERS — what happened in each language (2026-10-16). A missing Arabic or Turkish
// result is never one thing: the language was not planned, its searches never ran (budget
// or time), the source could not be read, it ran and found nothing, or it found content
// that the gates filtered out (sellers, brokers, other markets). Translation is a display
// step on top of a result, never a reason a result is missing.
// Pure: built from the campaign's queue rows and leads; counts only what ran.

export const OUTCOME_LANGUAGES = ['ka', 'en', 'ru', 'ar', 'he', 'tr'] as const;
export type LanguageOutcome =
  | 'NOT_PLANNED'          // no search in this language was queued
  | 'NOT_RUN'              // queued, but cancelled before running (budget, time window)
  | 'SOURCE_UNAVAILABLE'   // every run in this language failed
  | 'SEARCHED_NO_RESULTS'  // ran, the platforms returned nothing
  | 'RESULTS_FILTERED'     // ran, content came back, none of it was a buyer/tenant
  | 'RESULTS';             // at least one person kept

export interface QueueRowLike { language: string | null; status: string; result_count?: number | null; cancel_reason?: string | null }
export interface LeadLike { language: string | null }
/** An Actor run's language and the items it returned (find_buyers_actor_runs). */
export interface RunLike { language: string | null; items_fetched?: number | null }

export interface LanguageReport { language: string; outcome: LanguageOutcome; planned: number; ran: number; items: number; people: number; notRunReason: string | null }

/* `items` is what the platforms RETURNED in the language. A queue row's result_count is the
   number of qualified people (executor), so counting it made every language read 0 items
   (campaign 719a57ac: 414 items fetched, items = 0 everywhere, 2026-10-17); the runs are
   used when given. */
export function languageOutcomes(queue: readonly QueueRowLike[], leads: readonly LeadLike[], runs?: readonly RunLike[]): LanguageReport[] {
  return OUTCOME_LANGUAGES.map((language) => {
    const rows = queue.filter((q) => String(q.language ?? '').toLowerCase() === language);
    const ran = rows.filter((q) => q.status === 'DONE' || q.status === 'FAILED');
    const done = rows.filter((q) => q.status === 'DONE');
    const items = runs
      ? runs.filter((r) => String(r.language ?? '').toLowerCase() === language).reduce((n, r) => n + Number(r.items_fetched || 0), 0)
      : done.reduce((n, q) => n + Number(q.result_count || 0), 0);
    const people = leads.filter((l) => String(l.language ?? '').toLowerCase() === language).length;
    const cancelled = rows.filter((q) => q.status === 'CANCELLED');
    let outcome: LanguageOutcome;
    if (!rows.length) outcome = people ? 'RESULTS' : 'NOT_PLANNED';
    else if (people > 0) outcome = 'RESULTS';
    else if (!ran.length) outcome = cancelled.length ? 'NOT_RUN' : 'NOT_PLANNED';
    else if (!done.length) outcome = 'SOURCE_UNAVAILABLE';
    else if (items === 0) outcome = 'SEARCHED_NO_RESULTS';
    else outcome = 'RESULTS_FILTERED';
    const reasons = [...new Set(cancelled.map((q) => q.cancel_reason).filter(Boolean))] as string[];
    return { language, outcome, planned: rows.length, ran: ran.length, items, people, notRunReason: outcome === 'NOT_RUN' ? reasons[0] ?? null : null };
  });
}
