// HOMATCH VERIFY — what the customer reads while the research runs.
//
// TWO KINDS OF LINE, AND THE DIFFERENCE MATTERS
//
// PRESENTATION lines describe the SHAPE of the work — resolving identity,
// building location context, comparing market signals. They rotate on their
// own clock and are deliberately abstract: they never name a website, a
// provider, a worker, an internal stage, a table or a prompt. They are not
// evidence, are never persisted, and nothing downstream reads them. A
// customer should be able to see that Homatch is working without learning
// how Homatch works.
//
// FACT lines are the opposite. They are shown ONLY when the running job has
// genuinely persisted that fact, and each one is read straight out of the
// research result. "94.1 m²" appears because the registry said so, never
// because the pipeline reached a stage where an area is usually known.
//
// Confusing the two would turn a loading screen into a source of claims the
// report itself would refuse to make. So they are separated here, at the
// point where they are produced, rather than being told apart later.

import type { Phase } from './progress.ts';

/**
 * ~43 lines across nine conceptual phases, so a long run does not cycle the
 * same four sentences at somebody for twenty minutes.
 *
 * The keys resolve through the normal i18n bundle in all six languages.
 */
export const PHASE_MESSAGES: Record<Phase, string[]> = {
  STARTING: [
    'verify_narr_start_1',
    'verify_narr_start_2',
    'verify_narr_start_3',
  ],
  IDENTITY: [
    'verify_narr_identity_1',
    'verify_narr_identity_2',
    'verify_narr_identity_3',
    'verify_narr_identity_4',
    'verify_narr_identity_5',
  ],
  LOCATION: [
    'verify_narr_location_1',
    'verify_narr_location_2',
    'verify_narr_location_3',
    'verify_narr_location_4',
  ],
  OFFICIAL: [
    'verify_narr_official_1',
    'verify_narr_official_2',
    'verify_narr_official_3',
    'verify_narr_official_4',
    'verify_narr_official_5',
    'verify_narr_official_6',
  ],
  COMPANY: [
    'verify_narr_company_1',
    'verify_narr_company_2',
    'verify_narr_company_3',
    'verify_narr_company_4',
    'verify_narr_company_5',
  ],
  PARTICIPANTS: [
    'verify_narr_people_1',
    'verify_narr_people_2',
    'verify_narr_people_3',
    'verify_narr_people_4',
    'verify_narr_people_5',
  ],
  MARKET: [
    'verify_narr_market_1',
    'verify_narr_market_2',
    'verify_narr_market_3',
    'verify_narr_market_4',
    'verify_narr_market_5',
    'verify_narr_market_6',
  ],
  RECONCILIATION: [
    'verify_narr_recon_1',
    'verify_narr_recon_2',
    'verify_narr_recon_3',
    'verify_narr_recon_4',
  ],
  SYNTHESIS: [
    'verify_narr_synth_1',
    'verify_narr_synth_2',
    'verify_narr_synth_3',
    'verify_narr_synth_4',
    'verify_narr_synth_5',
  ],
  READY: ['verify_narr_synth_5'],
};

/**
 * A quiet machine-ish label under each line. Purely decorative, and
 * deliberately about CONCEPTS rather than systems — no provider, no worker,
 * no API, no internal state name, and nothing resembling a terminal.
 */
export const PHASE_TAG: Record<Phase, string> = {
  STARTING: 'PROPERTY_IDENTITY :: RESOLVING',
  IDENTITY: 'PROPERTY_IDENTITY :: RESOLVING',
  LOCATION: 'GEO_CONTEXT :: BUILDING',
  OFFICIAL: 'OFFICIAL_RECORDS :: READING',
  COMPANY: 'ENTITY_RELATIONS :: MAPPING',
  PARTICIPANTS: 'ENTITY_RELATIONS :: MAPPING',
  MARKET: 'MARKET_CONTEXT :: ANALYZING',
  RECONCILIATION: 'TEMPORAL_CONTEXT :: RECONCILING',
  SYNTHESIS: 'REPORT_MODEL :: SYNTHESIZING',
  READY: 'BUYER_CONTEXT :: BUILDING',
};

/** Rotate deterministically, so two tabs on the same run agree. */
export function messagesFor(phase: Phase, step: number, count = 3): string[] {
  const pool = PHASE_MESSAGES[phase] ?? PHASE_MESSAGES.OFFICIAL;
  const take = Math.min(count, pool.length);
  return Array.from({ length: take }, (_, i) => pool[(step + i) % pool.length]);
}

/* ------------------------------------------------------------------ *
 * Real facts                                                          *
 * ------------------------------------------------------------------ */

export interface LiveFact {
  /** Stable id, so React keys and tests do not depend on the label. */
  id: string;
  /** i18n key for the caption. */
  labelKey: string;
  /** The value itself, exactly as the research recorded it. */
  value: string;
}

/** Junk that reached us from a parser rather than from a source. */
function presentable(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > 90) return null;
  // Mojibake and control characters mean the extraction failed; showing the
  // wreckage to a customer is worse than showing nothing.
  if (/[\u0000-\u001f\u007f\ufffd]/.test(s)) return null;
  if (/^(null|undefined|n\/?a|unknown|-)$/i.test(s)) return null;
  return s;
}

function countOf(v: unknown): number {
  return Array.isArray(v) ? v.filter(Boolean).length : 0;
}

/**
 * Facts the running job has ACTUALLY established, in the order they tend to
 * become known. Every one is read from persisted research output; nothing
 * here is inferred from which stage the pipeline reached.
 *
 * `result` is the customer-sanitised `result_json` the status poll already
 * returns, so this adds no request and can leak nothing the report would not.
 */
export function extractLiveFacts(result: unknown): LiveFact[] {
  const r = (result ?? {}) as Record<string, any>;
  const facts: LiveFact[] = [];
  const push = (id: string, labelKey: string, value: unknown) => {
    const v = presentable(value);
    if (v) facts.push({ id, labelKey, value: v });
  };

  push('cadastral', 'verify_fact_cadastral', r.exactUnit?.code);
  push('address', 'verify_fact_address', r.identifiedParent?.address);
  push('project', 'verify_fact_project', r.projectProfile?.name);
  push(
    'developer',
    'verify_fact_developer',
    r.projectProfile?.developer || r.projectProfile?.developerCompany
  );
  push('company', 'verify_fact_company', r.companyProfile?.name);

  // Areas live with the technical facts rather than in a dedicated field.
  const area = (r.technicalFacts as any[] | undefined)?.find(
    (f) => typeof f?.key === 'string' && /area|ფართ/i.test(f.key)
  );
  push('area', 'verify_fact_area', area?.value);

  // Counts are facts too, but only once there is something to count.
  const comparables = countOf(r.market?.comparables);
  if (comparables > 0) {
    facts.push({ id: 'comparables', labelKey: 'verify_fact_comparables', value: String(comparables) });
  }
  const people = countOf(r.companyProfile?.directors) + countOf(r.companyProfile?.representatives);
  if (people > 0) {
    facts.push({ id: 'participants', labelKey: 'verify_fact_participants', value: String(people) });
  }
  const documents = countOf(r.officialDocuments);
  if (documents > 0) {
    facts.push({ id: 'documents', labelKey: 'verify_fact_documents', value: String(documents) });
  }

  return facts;
}
