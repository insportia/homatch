// V3 research: hard reuse of PUBLIC web research across jobs (owner, 2026-10-29).
//
// The second flat in a building used to pay for the same identity search and
// the same public-research sweep as the first, within days. Public web
// findings about a parcel or a project do not change in a week, so a V3 job
// may take them from a recent COMPLETE job instead of buying them again:
//
// - IDENTITY: only from a job for the EXACT same cadastral code (it carries
//   the exact-unit identification).
// - PUBLIC_RESEARCH: from a job for any unit on the same parcel (developer,
//   project, architect, media, reputation: project-level facts).
//
// What is never reused: anything from the registers. The official stages
// (TAS, Service 176 / NAPR, enreg, RS, debtors) always run, and owner-level
// keys (owners, mortgages, liens, seizures) are removed from a reused
// output before it is stored, so one buyer's job can never carry another
// buyer's register data. Personal numbers are scrubbed too.
//
// Reuse is always LABELLED: the output keeps the date it was OBSERVED (the
// original job's completion, carried through reuse chains, never refreshed
// by reusing), the job records which stages were reused (_reusedStages,
// internal), and the evidence package dates every reused item, so the report
// says when it was seen. The window counts from the observation, so a chain
// of reuses can never keep a finding alive past it.
//
// Pure: the caller fetches candidates, this decides.

import { normalizeCadastral, parentParcelOf } from '../intelligence/harvest.ts';
import { scrubPersonalNumbersDeep } from '../intelligence/peopleIntelligence.ts';
import { stageOutputUsable } from './researchRequest.ts';

export type ReusableStage = 'identity' | 'public_research';
export const REUSABLE_STAGES: ReusableStage[] = ['identity', 'public_research'];

/** One earlier job, as the caller reads it (its stored reusable outputs only). */
export interface ReuseCandidate {
  id: string;
  query: string | null;
  completedAt: string | null;
  /** result_json._reusable: { identity?: {output, observedAt}, public_research?: {output, observedAt} } */
  reusable: unknown;
}

export interface ReuseDecision {
  stage: ReusableStage;
  fromJobId: string;
  /** When the findings were observed (ISO). Never later than the original job. */
  observedAt: string;
  output: Record<string, unknown>;
}

/** The parcel a code sits on (the code itself when it is a parcel). */
export function parcelKey(query: unknown): string | null {
  const code = normalizeCadastral(query);
  if (!code) return null;
  return parentParcelOf(code) ?? code;
}

/** The query prefix a caller filters candidates by (same parcel), or null when the query is not a cadastral code. */
export function reuseQueryPrefix(query: unknown): string | null {
  return parcelKey(query);
}

const OWNER_LEVEL_KEY = /^(owners?|ownerNames?|registeredOwners?|propertyOwners?|currentOwners?|ownership|ownershipHistory|mortgages?|mortgagees?|encumbrances?|liens?|seizures?|arrests?|prohibitions?|rightsAndRestrictions|registerExtract|registryExtract|service176Evidence|personalId|personalNumber|idNumber)$/i;

/** A deep copy without owner-level register keys, with personal numbers scrubbed. */
export function withoutOwnerLevel<T>(value: T): T {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!OWNER_LEVEL_KEY.test(k)) out[k] = strip(x);
      return out;
    }
    return v;
  };
  return scrubPersonalNumbersDeep(strip(value) as T);
}

const DAY_MS = 86_400_000;
const STAGE_NAME: Record<ReusableStage, string> = { identity: 'IDENTITY', public_research: 'PUBLIC_RESEARCH' };

/**
 * The freshest reusable output for this stage, or null. Candidates must be
 * other COMPLETE jobs (the caller filters status); the code match is checked
 * here again, so a loose caller query can never widen the scope.
 */
export function pickReuse(
  stage: ReusableStage,
  query: unknown,
  candidates: ReuseCandidate[],
  opts: { now: number; freshnessDays: number; jobId?: string | null },
): ReuseDecision | null {
  if (!(opts.freshnessDays > 0)) return null;
  const exact = normalizeCadastral(query);
  const parcel = parcelKey(query);
  if (!exact || !parcel) return null;
  const oldest = opts.now - opts.freshnessDays * DAY_MS;
  let best: ReuseDecision | null = null;
  for (const c of candidates) {
    if (!c?.id || c.id === opts.jobId) continue;
    const theirs = normalizeCadastral(c.query);
    if (!theirs) continue;
    if (stage === 'identity' ? theirs !== exact : parcelKey(theirs) !== parcel) continue;
    const r = (c.reusable && typeof c.reusable === 'object' ? (c.reusable as Record<string, any>)[stage] : null) ?? null;
    const output = r?.output;
    if (!output || typeof output !== 'object' || Array.isArray(output) || !stageOutputUsable(STAGE_NAME[stage], output)) continue;
    const observed = Date.parse(String(r.observedAt ?? c.completedAt ?? ''));
    if (!Number.isFinite(observed) || observed < oldest || observed > opts.now) continue;
    if (best && Date.parse(best.observedAt) >= observed) continue;
    best = { stage, fromJobId: c.id, observedAt: new Date(observed).toISOString(), output: withoutOwnerLevel(output as Record<string, unknown>) };
  }
  return best;
}

/**
 * What a finished stage stores for later jobs: its output without
 * owner-level data, and the date it was observed (a reused output keeps its
 * original date).
 */
export function reusableRecord(output: unknown, observedAt: string): { output: Record<string, unknown>; observedAt: string } | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null;
  return { output: withoutOwnerLevel(output as Record<string, unknown>), observedAt };
}

/** The customer-safe label of reused research, for the evidence package: stage and observation day only. */
export function reusedObservations(resultJson: unknown): { stage: ReusableStage; observedOn: string }[] {
  const r = resultJson && typeof resultJson === 'object' ? (resultJson as Record<string, any>)._reusedStages : null;
  if (!r || typeof r !== 'object') return [];
  return REUSABLE_STAGES.flatMap((stage) => {
    const at = r[stage]?.observedAt;
    return typeof at === 'string' && Number.isFinite(Date.parse(at)) ? [{ stage, observedOn: at.slice(0, 10) }] : [];
  });
}
