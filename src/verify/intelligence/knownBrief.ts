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
  /** Which thing this is a fact about. See BriefScope for why it matters. */
  entity_id?: string | null;
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
 * What the verification is actually about, and what merely stands near it.
 *
 * WHY THIS EXISTS. Without it the brief had no way to tell a fact about this
 * flat from a fact about a comparable flat down the road, because both arrive
 * as `listing.price`. Production duly briefed five different asking prices
 * under that one key, none of them this property's, all of them introduced as
 * "established by earlier research on this exact property". The unit held four
 * facts; the brief claimed thirteen.
 *
 * A fact key is not an identity. Everything below is scoped by entity.
 */
export interface BriefScope {
  /** The entity the customer asked about. */
  subjectEntityId: string | null;
  /** The lineage entities, for labelling what is said about them. */
  related?: readonly {
    id: string;
    entityType?: string | null;
    naturalKey?: string | null;
    relation?: string | null;
  }[];
}

/** How a related entity is introduced in the brief. */
const RELATION_LABEL: Record<string, string> = {
  HAS_PARENT_PARCEL: 'the land parcel this property sits on',
  IN_BUILDING: 'the building this property is in',
  PART_OF_PROJECT: 'the development this property is part of',
  DEVELOPED_BY: 'the company that developed it',
  IS_COMPANY: 'the company involved',
  LOCATED_IN: 'the area it is in',
};

/**
 * Does this verdict belong to this fact?
 *
 * Once identity is available on either side it is REQUIRED to match. The
 * key-only fallback survives only for callers that carry no entity at all,
 * and it can never be reached by a fact whose key has an identified verdict —
 * otherwise one fresh listing would go on vouching for ten stale ones.
 */
function usableIndex(assessments: readonly FactAssessment[]): {
  qualified: Set<string>;
  unqualified: Set<string>;
  identified: Set<string>;
} {
  const qualified = new Set<string>();
  const unqualified = new Set<string>();
  const identified = new Set<string>();
  for (const a of assessments) {
    if (!a?.factKey) continue;
    if (a.entityId) {
      identified.add(a.factKey);
      if (a.state === 'FRESH') qualified.add(`${a.entityId}::${a.factKey}`);
    } else if (a.state === 'FRESH') {
      unqualified.add(a.factKey);
    }
  }
  return { qualified, unqualified, identified };
}

/**
 * The block handed to a research stage.
 *
 * `fresh` is the planner's own verdict, so the brief and the plan cannot
 * disagree about what counts as usable — one source of truth for freshness,
 * not two.
 *
 * Facts about this property are stated as such. Facts about its parcel,
 * building, project or developer go in a second block that names what they are
 * about, because "true of the land it stands on" and "true of this flat" are
 * the two things a Georgian due-diligence report must never merge. Facts about
 * anything else — a comparable listing is the case that actually arose — are
 * not briefed at all: they are somebody else's property.
 */
export function buildKnownBrief(
  facts: readonly BriefFact[] | null | undefined,
  assessments: readonly FactAssessment[] | null | undefined,
  scope?: BriefScope | null
): KnownBrief {
  const { qualified, unqualified, identified } = usableIndex(assessments ?? []);

  const relatedById = new Map(
    (scope?.related ?? []).map((r) => [r.id, r] as const)
  );
  const scoped = !!scope;

  const mine: string[] = [];
  const theirs: string[] = [];
  const briefed: string[] = [];

  for (const f of facts ?? []) {
    if (!f?.fact_key || !briefable(f.fact_key)) continue;

    const fresh = f.entity_id
      ? qualified.has(`${f.entity_id}::${f.fact_key}`)
      : !identified.has(f.fact_key) && unqualified.has(f.fact_key);
    if (!fresh) continue;

    const v = shortValue(f);
    if (!v) continue;

    // Unscoped callers get the old behaviour: everything handed over is the
    // subject's. Scoped callers get the distinction enforced.
    if (!scoped || !f.entity_id || f.entity_id === scope!.subjectEntityId) {
      mine.push(`  ${f.fact_key} = ${v}`);
      briefed.push(f.fact_key);
      continue;
    }

    const rel = relatedById.get(f.entity_id);
    // Not the subject and not lineage: another property's fact. Drop it.
    if (!rel) continue;

    const about = RELATION_LABEL[rel.relation ?? ''] ?? (rel.entityType ?? 'a related record').toLowerCase();
    theirs.push(`  (${about}) ${f.fact_key} = ${v}`);
    briefed.push(f.fact_key);
  }

  if (!mine.length && !theirs.length) return { text: '', briefed: [] };

  const out: string[] = [];

  if (mine.length) {
    out.push(
      'ALREADY ESTABLISHED BY HOMATCH ABOUT THIS EXACT PROPERTY — verified research, not a hint:',
      ...mine
    );
  }

  if (theirs.length) {
    if (out.length) out.push('');
    out.push(
      'ESTABLISHED ABOUT WHAT THIS PROPERTY BELONGS TO — true of the thing named',
      'in brackets, NOT of this unit unless your own research shows it is:',
      ...theirs
    );
  }

  out.push(
    '',
    'These were established by earlier research and are still current under',
    'their own freshness policy. Treat them as given.',
    'Do NOT spend searches rediscovering them; spend them on what is missing,',
    'unclear or contradicted instead. Restate any of them that belongs in your',
    'answer — they must appear in the result exactly as they would have if you',
    'had just found them, because the report is written from your output.',
    'If your own research CONTRADICTS one of these, say so plainly and prefer',
    'what you actually found: this list is what we knew, not what must be true.'
  );

  return { briefed, text: out.join('\n') };
}
