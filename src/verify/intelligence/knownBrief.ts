// HOMATCH — telling the research what Homatch already established.
//
// This is how reuse is actually taken, and the shape of it matters more than
// the idea.
//
// THE OBVIOUS IMPLEMENTATION IS WRONG. Skipping a research stage outright
// removes its output from result_json, and the report is written from those
// same fields — so the buyer's report would quietly lose a section. Cheaper
// and worse is not the trade on offer; the acceptance condition is less paid
// research at MATERIALLY EQUIVALENT OR BETTER quality.
//
// So nothing is skipped. The stage still runs, and it is handed what we
// already know as established fact, with an instruction to spend its searches
// on what is missing rather than rediscovering what is not. The report keeps
// every field it had, because the model restates a known fact from context
// instead of paying to find it again.
//
// WHAT MAY GO IN HERE, AND WHAT MAY NOT.
//
// Only facts that are CURRENT, fresh under their own policy, and evidenced —
// the same bar the graph enforces on the way in. Nothing stale, because a
// stale fact handed over as established is exactly how a report comes to
// state last month's ownership as current. Nothing contradicted. And the
// registry families are deliberately absent whatever their age: ownership,
// encumbrances and rights are re-read on every verification, so telling the
// model what we last saw could only bias what it reports seeing now.

import type { FactAssessment } from './freshness.ts';

/** A fact as the graph returns it, with the value the brief will quote. */
export interface BriefFact {
  fact_key: string;
  value_text?: string | null;
  value_number?: number | string | null;
  value_json?: unknown;
  last_verified_at?: string | null;
}

/*
 * NEVER BRIEFED, WHATEVER THE FRESHNESS.
 *
 * These are the facts a buyer is exposed to between agreeing a price and
 * signing. The registry stage re-reads them on every run by design, and a
 * model told "we last saw no mortgage" is a model with a reason to look less
 * hard. The saving is not worth the failure mode.
 */
const NEVER_BRIEFED = ['ownership.', 'encumbrance.', 'rights.', 'registry.'];

export function briefable(factKey: string): boolean {
  return !NEVER_BRIEFED.some((p) => factKey.startsWith(p));
}

const shortValue = (f: BriefFact): string | null => {
  if (f.value_number != null && f.value_number !== '') return String(f.value_number);
  if (typeof f.value_text === 'string' && f.value_text.trim()) return f.value_text.trim().slice(0, 200);
  if (Array.isArray(f.value_json)) {
    const items = f.value_json.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).filter(Boolean);
    return items.length ? items.slice(0, 8).join('; ').slice(0, 300) : null;
  }
  if (f.value_json != null) return JSON.stringify(f.value_json).slice(0, 200);
  return null;
};

export interface KnownBrief {
  /** The prompt fragment, or '' when there is nothing worth saying. */
  text: string;
  /** Which fact keys were briefed. Recorded internally, never shown. */
  briefed: string[];
}

/**
 * The block handed to a research stage.
 *
 * `fresh` is the planner's own verdict, so the brief and the plan cannot
 * disagree about what counts as usable — one source of truth for freshness,
 * not two.
 */
export function buildKnownBrief(
  facts: readonly BriefFact[] | null | undefined,
  assessments: readonly FactAssessment[] | null | undefined
): KnownBrief {
  const usable = new Set(
    (assessments ?? []).filter((a) => a.state === 'FRESH').map((a) => a.factKey)
  );

  const lines: string[] = [];
  const briefed: string[] = [];

  for (const f of facts ?? []) {
    if (!f?.fact_key || !usable.has(f.fact_key) || !briefable(f.fact_key)) continue;
    const v = shortValue(f);
    if (!v) continue;
    lines.push(`  ${f.fact_key} = ${v}`);
    briefed.push(f.fact_key);
  }

  if (!lines.length) return { text: '', briefed: [] };

  return {
    briefed,
    text: [
      'ALREADY ESTABLISHED BY HOMATCH — verified research, not a hint:',
      ...lines,
      '',
      'These were established by earlier research on this exact property and are',
      'still current under their own freshness policy. Treat them as given.',
      'Do NOT spend searches rediscovering them; spend them on what is missing,',
      'unclear or contradicted instead. Restate any of them that belongs in your',
      'answer — they must appear in the result exactly as they would have if you',
      'had just found them, because the report is written from your output.',
      'If your own research CONTRADICTS one of these, say so plainly and prefer',
      'what you actually found: this list is what we knew, not what must be true.',
    ].join('\n'),
  };
}
