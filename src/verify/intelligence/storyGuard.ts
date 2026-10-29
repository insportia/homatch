// storyGuard.ts — the project story, kept to what the records connect.
//
// Owner, 2026-10-11 (job eeefada9, Dighomi): the model's five chapters are
// the editorial baseline and stay as written, with one correction. The
// 2012–2013 cases on the same parcel were an individual single-family house;
// the multi-apartment building starts in 2023 under another applicant. The
// prose joined them ("the old permit was replaced by…", "the old history
// merges with the new developer") although no document shows that
// continuity. Here, deterministically:
//
//   - a sentence that ties the earlier records to the current development
//     with a continuity verb is cut back to its documented part (a relative
//     clause is removed) or dropped;
//   - the earliest chapter gains one sentence saying what the earlier cases
//     were about, when the records show a different kind of building.
//
// Runs at build time (verify-synthesis) and again at render time, so reports
// already stored are read the same way. Idempotent.

import { storyFitsKind } from './kindGuard.ts';

export interface GuardChapter {
  key: string;
  title: string;
  period?: string;
  body: string;
}

interface EvolutionCase {
  filedOn?: string | null;
  nomenclature?: unknown;
  acts?: Array<{ buildingType?: string | null }>;
}

const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});

const SINGLE_HOUSE = /ინდივიდუალურ[ია]?\s+(?:ერთბინიან[ია]?\s+)?საცხოვრებელ[ია]?\s+სახლ/;
const MULTI_APARTMENT = /მრავალბინიან/;

/** The earlier project on the parcel, when the records show it was a different kind of building. */
export function earlierDifferentProject(evolution: unknown): { kind: 'SINGLE_HOUSE'; fromYear: string; toYear: string; currentFromYear: string } | null {
  const cases = (Array.isArray(evolution) ? evolution : []) as EvolutionCase[];
  const kindOf = (c: EvolutionCase): 'SINGLE' | 'MULTI' | null => {
    const text = [
      ...(Array.isArray(c.nomenclature) ? c.nomenclature.map(String) : []),
      ...(Array.isArray(c.acts) ? c.acts.map((a) => String(a?.buildingType ?? '')) : []),
    ].join(' ');
    if (MULTI_APARTMENT.test(text)) return 'MULTI';
    if (SINGLE_HOUSE.test(text)) return 'SINGLE';
    return null;
  };
  const dated = cases
    .map((c) => ({ year: String(c.filedOn ?? '').slice(0, 4), kind: kindOf(c) }))
    .filter((c) => /^\d{4}$/.test(c.year) && c.kind)
    .sort((a, b) => a.year.localeCompare(b.year));
  const firstMulti = dated.find((c) => c.kind === 'MULTI');
  if (!firstMulti) return null;
  const single = dated.filter((c) => c.kind === 'SINGLE' && c.year < firstMulti.year);
  if (!single.length) return null;
  return { kind: 'SINGLE_HOUSE', fromYear: single[0].year, toYear: single[single.length - 1].year, currentFromYear: firstMulti.year };
}

/** A verb that asserts the earlier records continue into, or were replaced by, the current development. */
const CONTINUITY = /(ჩაანაცვლ|შეცვალა|ერთიანდებ|გაერთიან|გააგრძელ|გაგრძელებ|დაუკავშირდ|გადაიზარდ|ერწყმ)/;

function mentionsEarlier(sentence: string, e: NonNullable<ReturnType<typeof earlierDifferentProject>>): boolean {
  if (/ძველ/.test(sentence)) return true;
  for (let y = Number(e.fromYear); y <= Number(e.toYear); y++) if (sentence.includes(String(y))) return true;
  return false;
}

const splitSentences = (body: string): string[] => body.split(/(?<=[.!?])\s+/).filter((s) => s.trim());

/** One sentence, guarded: kept, cut back to its documented part, or dropped (null). */
function guardSentence(s: string, e: NonNullable<ReturnType<typeof earlierDifferentProject>>): string | null {
  if (!CONTINUITY.test(s) || !mentionsEarlier(s, e)) return s;
  // "X was issued, which replaced the 2012 permit." → "X was issued."
  const clause = s.match(/^(.*?),\s*რომელ[^,.]*?(?:[.!?])?$/);
  if (clause && clause[1] && !CONTINUITY.test(clause[1]) && clause[1].trim().length > 12) {
    return `${clause[1].trim().replace(/[,;:]$/, '')}.`;
  }
  return null;
}

export const EARLIER_PROJECT_NOTE = (e: NonNullable<ReturnType<typeof earlierDifferentProject>>): string => {
  const span = e.fromYear === e.toYear ? `${e.fromYear} წლის` : `${e.fromYear}–${e.toYear} წლების`;
  return `${span} საქმეები ამავე მიწის ნაკვეთზე ინდივიდუალური ერთბინიანი საცხოვრებელი სახლის პროექტს ეხებოდა. მრავალბინიანი საცხოვრებელი სახლის პროექტი ოფიციალურ ჩანაწერებში ${e.currentFromYear} წლიდან ჩნდება, და დოკუმენტებში არ ჩანს, რომ ადრინდელი პროექტი დღევანდელ შენობას პირდაპირ უკავშირდება. ამიტომ მას ნაკვეთის ადრინდელ ისტორიად განვიხილავთ.`;
};

/**
 * The chapters with unsupported continuity removed and, when the records show
 * a different earlier project, that fact stated once in the earliest chapter.
 * Unchanged when the evolution shows no such earlier project.
 */
export function guardStoryContinuity<T extends GuardChapter>(chapters: T[] | null | undefined, evolution: unknown): T[] {
  const list = Array.isArray(chapters) ? chapters : [];
  const e = earlierDifferentProject(evolution);
  if (!e || !list.length) return list;
  const note = EARLIER_PROJECT_NOTE(e);
  const guarded = list.map((c) => {
    const body = String(c.body ?? '');
    const paragraphs = body.split(/\n{2,}/).map((p) => splitSentences(p).map((s) => guardSentence(s, e)).filter((s): s is string => !!s).join(' ')).filter(Boolean);
    return { ...c, body: paragraphs.join('\n\n') };
  });
  // The earliest chapter that talks about the earlier years carries the note, once.
  const already = guarded.some((c) => c.body.includes('ინდივიდუალური ერთბინიანი საცხოვრებელი სახლის პროექტს ეხებოდა'));
  if (!already) {
    const i = guarded.findIndex((c) => mentionsEarlier(`${c.period ?? ''} ${c.body}`, e) || c.key === 'EARLIEST');
    if (i >= 0) guarded[i] = { ...guarded[i], body: `${guarded[i].body}${guarded[i].body ? ' ' : ''}${note}` };
  }
  return guarded;
}

/** Stray list markers ("1.", "2)") left between chapters or opening a paragraph. */
export function stripListMarkers(text: string): string {
  return String(text ?? '')
    .split(/\n/)
    .filter((line) => !/^\s*\d{1,2}[.)]\s*$/.test(line))
    .map((line) => line.replace(/^\s*\d{1,2}[.)]\s+(?=\S)/, ''))
    .join('\n')
    .trim();
}

/** "2012-2013" → "2012–2013" (a range, not a minus). */
export function periodLabel(period: unknown): string | null {
  const p = typeof period === 'string' ? period.trim() : '';
  return p ? p.replace(/(\d{4})\s*-\s*(\d{4})/, '$1–$2') : null;
}

/** The evolution the guard reads, from report.projectSignals. */
export function evolutionOf(signals: unknown): unknown {
  return obj(signals).evolution;
}

/**
 * The story a rebuild publishes (owner, 2026-10-11 v7: "keep the current
 * five-chapter narrative as the editorial baseline"). An automatic rebuild
 * (logic upgrade, market refresh) of a report that already has a v6+ story
 * keeps that story instead of the model's new wording; a first build or a
 * forced rebuild takes the new one. Either way the continuity guard applies.
 *
 * v7 (kindGuard.ts): the stored story is kept only when it fits the
 * registry kind: always for an apartment or an unsettled kind, and for a
 * parking space / land / house / commercial / office / storage only when no
 * sentence of it describes the subject as an apartment. An apartment-flavoured
 * story of a parking space (job dbf04e48) is replaced by the new, kind-aware one.
 */
export function keepStoryOnRebuild<T extends { chapters?: GuardChapter[] }>(
  previousSynthesis: unknown,
  fresh: T | undefined,
  opts: { autoUpgrade: boolean; evolution: unknown; kind?: unknown },
): T | { chapters: GuardChapter[] } | undefined {
  const prev = obj(previousSynthesis);
  const prevStory = obj(obj(prev.report).propertyStory);
  const prevChapters = Array.isArray(prevStory.chapters) ? (prevStory.chapters as GuardChapter[]).filter((c) => c && typeof c.body === 'string' && c.body.trim()) : [];
  const keep = opts.autoUpgrade && Number(prev._logicVersion) >= 6 && prevChapters.length >= 3 && storyFitsKind(prevChapters, opts.kind);
  const base = keep ? { ...prevStory, chapters: prevChapters } : fresh;
  if (!base?.chapters?.length) return base;
  return { ...base, chapters: guardStoryContinuity(base.chapters, opts.evolution) };
}

/**
 * Whether keepStoryOnRebuild will keep the stored story for this build: the
 * same test, so the report call can skip asking for (and paying for) a story
 * that would be discarded (owner, 2026-10-29).
 */
export function storyKeptOnRebuild(previousSynthesis: unknown, opts: { autoUpgrade: boolean; kind?: unknown }): boolean {
  if (!opts.autoUpgrade) return false;
  const prev = obj(previousSynthesis);
  const prevStory = obj(obj(prev.report).propertyStory);
  const prevChapters = Array.isArray(prevStory.chapters) ? (prevStory.chapters as GuardChapter[]).filter((c) => c && typeof c.body === 'string' && c.body.trim()) : [];
  return Number(prev._logicVersion) >= 6 && prevChapters.length >= 3 && storyFitsKind(prevChapters, opts.kind);
}
