// rawText.ts — text that is a record, not prose (owner, 2026-10-11).
//
// The no-model template once showed buyers lists of dated records
// ("2013-07-17, გადაწყვეტილება:. …") and raw source lines ("Cadastral code:
// …"). These tests keep such text out of every report, new and stored.

/**
 * True when a text is a list of dated records rather than prose: three or
 * more ISO dates and, once the dates and record labels are taken away,
 * almost nothing left to read ("2013-07-17, გადაწყვეტილება:. 2023-08-09, …").
 */
export function isDateList(text: string): boolean {
  const t = String(text ?? '');
  const dates = t.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  if (dates.length < 3) return false;
  const rest = t
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/(გადაწყვეტილება|ნებართვა|შეთანხმება|განცხადება|ცვლილება|ექსპლუატაცია\S*)\s*:?/g, ' ')
    .replace(/[\s,.;:—–-]+/g, ' ')
    .trim();
  const words = rest ? rest.split(' ').length : 0;
  return words < dates.length * 3;
}

/** "Cadastral code: 01.72…", "Application registration: 88…": a record line, not a sentence. */
export function isRawRecord(text: string): boolean {
  return /^\s*[A-Z][A-Za-z ()/-]{2,40}:\s/.test(String(text ?? ''));
}

/** The deterministic template's placeholder consequence; never customer prose. */
export const RAW_FINDING_WHY = 'ეს ჩანაწერი პირდაპირ ამ ქონებას ეხება.';
