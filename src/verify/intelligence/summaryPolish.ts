/*
 * THE SUMMARY REWRITE (owner, 2026-10-30).
 *
 * When the report is finished — Luna has written it, the gate, the repair
 * and any escalation are done — Terra rewrites the finished summary and
 * nothing else: the statement and each highlight's headline and detail.
 * It fixes Georgian grammar (case endings, agreement, date forms such as
 * "2017 წლის 22 ივნისის ამონაწერში" instead of "22 ივნისი, 2017-ის
 * ამონაწერში") and wording that misstates the evidence the highlight cites.
 *
 * Terra never decides the report. The label, the dimensions, the sentiments
 * and the citations stay Luna's; every rewritten text is checked here and a
 * text that brings a number, a Latin-script name or a quoted name that is in
 * neither the original nor the evidence it cites is dropped for the
 * original. A failed or unparseable answer keeps the summary as written.
 * Pure: the call itself lives in verify-synthesis.
 */
import type { BuyerSummary } from './report.ts';

export interface PolishEvidence { id: string; claim: string; date?: string }

export interface SummaryPolishResult {
  summary: BuyerSummary;
  /** Texts Terra changed and the guard accepted. */
  changed: number;
  /** Why a rewritten text was dropped for the original (path: reason). */
  rejected: string[];
}

const SYSTEM = [
  'You are the final Georgian editor of a HOMATCH property verification report.',
  'You receive the finished summary (a statement and highlights, each a headline and a detail) and the evidence items each highlight cites.',
  'Rewrite each text so it is correct, natural, professional Georgian:',
  '- fix grammar, case endings, agreement, postpositions and punctuation;',
  '- write dates the Georgian way: "2017 წლის 22 ივნისს", "2017 წლის 22 ივნისის ამონაწერში", "2028 წლის 18 სექტემბრამდე" — never "22 ივნისი, 2017-ის" or "18 სექტემბერი, 2028 წლამდე";',
  '- correct wording that contradicts or overstates the cited evidence, using only that evidence.',
  'Do not add facts, numbers, names, companies, places or advice that are not already in the text or its cited evidence.',
  'Keep every number, every name in Latin script and every name in „quotes“ exactly as written unless the cited evidence shows it is wrong.',
  'Keep each text about the same length and keep its meaning, tone and order. A text that is already correct is returned unchanged.',
  'Answer with JSON only: {"statement": string, "highlights": [{"headline": string, "detail": string}]} with exactly as many highlights, in the same order.',
].join('\n');

/** The rewrite request: the summary's texts and, per highlight, only the evidence it cites. */
export function summaryPolishPrompt(summary: BuyerSummary, evidence: PolishEvidence[]): { system: string; user: string } {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const highlights = summary.highlights.map((h) => ({
    headline: h.headline,
    detail: h.detail,
    evidence: h.cites.map((id) => byId.get(id)).filter(Boolean).map((e) => ({ id: e!.id, claim: e!.claim, ...(e!.date ? { date: e!.date } : {}) })),
  }));
  return { system: SYSTEM, user: JSON.stringify({ statement: summary.statement, highlights }) };
}

/** Whether a summary is worth the call: model prose in Georgian. */
export function summaryNeedsPolish(summary: BuyerSummary | null | undefined): summary is BuyerSummary {
  if (!summary || typeof summary.statement !== 'string' || !summary.statement.trim()) return false;
  const texts = [summary.statement, ...(summary.highlights ?? []).flatMap((h) => [h.headline, h.detail])];
  return texts.some((t) => /[ა-ჿ]/u.test(String(t ?? '')));
}

const numbersOf = (s: string): string[] => s.match(/\d+/g) ?? [];
const latinOf = (s: string): string[] => (s.match(/[A-Za-z][A-Za-z0-9-]*/g) ?? []).map((w) => w.toLowerCase());
const quotedOf = (s: string): string[] => [...s.matchAll(/„([^“”"]{1,120})[“”"]/g)].map((m) => m[1].trim());

function parse(raw: string | null | undefined): { statement?: unknown; highlights?: unknown } | null {
  if (!raw) return null;
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

/** Why `next` may not replace `prev`, or null when it may. `allowed` is prev plus the cited evidence. */
function refusal(prev: string, next: unknown, allowed: string): string | null {
  if (typeof next !== 'string' || !next.trim()) return 'empty';
  const n = next.trim();
  if (n.length < prev.length * 0.6 || n.length > prev.length * 1.6 + 20) return 'length';
  if (/[ა-ჿ]/u.test(prev) && !/[ა-ჿ]/u.test(n)) return 'language';
  const nums = new Set(numbersOf(allowed));
  const newNum = numbersOf(n).find((x) => !nums.has(x));
  if (newNum) return `number ${newNum}`;
  const latin = new Set(latinOf(allowed));
  const newLatin = latinOf(n).find((x) => !latin.has(x));
  if (newLatin) return `name ${newLatin}`;
  const quoted = quotedOf(n).find((q) => !allowed.includes(q));
  if (quoted) return `quoted ${quoted}`;
  return null;
}

/** Terra's answer applied text by text; anything the guard refuses stays as Luna wrote it. */
export function applySummaryPolish(summary: BuyerSummary, raw: string | null | undefined, evidence: PolishEvidence[]): SummaryPolishResult {
  const parsed = parse(raw);
  const out: BuyerSummary = { ...summary, highlights: summary.highlights.map((h) => ({ ...h })) };
  if (!parsed) return { summary: out, changed: 0, rejected: ['answer: not JSON'] };
  const hs = Array.isArray(parsed.highlights) ? parsed.highlights : null;
  if (!hs || hs.length !== summary.highlights.length) return { summary: out, changed: 0, rejected: ['answer: highlight count'] };
  const byId = new Map(evidence.map((e) => [e.id, `${e.claim} ${e.date ?? ''}`]));
  const allCited = summary.highlights.flatMap((h) => h.cites).map((id) => byId.get(id) ?? '').join(' ');
  let changed = 0;
  const rejected: string[] = [];
  const take = (path: string, prev: string, next: unknown, cited: string): string => {
    const why = refusal(prev, next, `${prev} ${cited}`);
    if (why) { rejected.push(`${path}: ${why}`); return prev; }
    const n = (next as string).trim();
    if (n !== prev) changed += 1;
    return n;
  };
  out.statement = take('statement', summary.statement, parsed.statement, allCited);
  out.highlights = summary.highlights.map((h, i) => {
    const r = (hs[i] ?? {}) as { headline?: unknown; detail?: unknown };
    const cited = h.cites.map((id) => byId.get(id) ?? '').join(' ');
    return { ...h, headline: take(`highlights.${i}.headline`, h.headline, r.headline, cited), detail: take(`highlights.${i}.detail`, h.detail, r.detail, cited) };
  });
  return { summary: out, changed, rejected };
}
