// HOMATCH RESEARCH CORE — the way out.
//
// An Observation is internal transport. An EvidenceItem is what Homatch
// already uses everywhere — official-worker's ledger, the synthesis path, the
// customer report. This file is the ONLY place the first becomes the second,
// which is what keeps the core from becoming a second evidence model.
//
// TWO THINGS THIS FILE REFUSES TO DO
//
// It does not write `claim`. That string reaches the customer report, and
// Homatch's customer-facing text is localized across six locales and passes
// through sanitizeCustomerReport/assertNoLeaks. A core that composed it would
// be an unlocalized, unsanitized seventh path into the report. So `claim` is
// an INPUT to this function, written by the caller that owns the locale.
//
// It does not round confidence up. EvidenceTypes.ts is explicit that an
// AI-extracted claim "should be lower and never silently rounded up", and
// nothing here nudges a number toward looking better.
//
// The EvidenceItem type is deliberately declared structurally rather than
// imported: official-worker is a separate Deno-free Node service with its own
// tsconfig, and importing across that boundary would couple two deployment
// units. The shape is pinned by __tests__/bridge-evidence.test.mjs, which
// reads the real EvidenceTypes.ts and fails if the two ever drift.

import type { Observation, SourceKind } from '../core/types.ts';
import type { SupportCount } from '../score/independence.ts';
import type { DedupedObservation } from '../score/document-dedupe.ts';

/* ── The authoritative vocabulary, mirrored ───────────────────────────── */

export type EvidenceType =
  | 'PROPERTY_FACT'
  | 'COMPANY_FACT'
  | 'PERMIT_EVENT'
  | 'REGISTRY_EVENT'
  | 'DOCUMENT_FACT'
  | 'WEB_CLAIM'
  | 'MARKET_COMPARABLE'
  | 'PUBLIC_DISCUSSION'
  | 'RISK_CANDIDATE'
  | 'CONTRADICTION';

export type SourceClass =
  | 'OFFICIAL'
  | 'COMPANY_PUBLISHED'
  | 'REPUTABLE_MEDIA'
  | 'OTHER_PUBLIC_SOURCE'
  | 'SOCIAL_USER_GENERATED'
  | 'UNVERIFIED_CLAIM';

export type VerificationState = 'VERIFIED' | 'UNVERIFIED' | 'DISPUTED';

export interface ContradictionRefs {
  evidenceIds: string[];
  description: string;
}

export interface EvidenceItem {
  id: string;
  type: EvidenceType;
  claim: string;
  source: string;
  sourceClass: SourceClass;
  sourceUrl: string | null;
  sourceDocumentId?: string | null;
  date?: string | null;
  retrievedAt: string;
  relatedPropertyId?: string | null;
  relatedEntityId?: string | null;
  confidence: number;
  verificationState: VerificationState;
  supportingText?: string | null;
  historical?: boolean;
  contradiction?: ContradictionRefs;
}

/* ── Mapping ──────────────────────────────────────────────────────────── */

/**
 * A source KIND maps to a source CLASS, and the mapping is deliberately
 * pessimistic at the bottom end.
 *
 * Nothing the HTTP research tier fetches can ever be OFFICIAL. Official
 * evidence in Homatch means a government registry read through
 * official-worker's recorded workflows, with a screenshot and a traversal
 * trace behind it. A page on gov.ge fetched over plain HTTP is not the same
 * artefact, and letting it claim the same class would let the cheapest path
 * in the system wear the most authoritative badge.
 */
export function sourceClassFor(kind: SourceKind): SourceClass {
  switch (kind) {
    case 'OFFICIAL_REGISTRY':
    case 'OFFICIAL_DOCUMENT':
      // Reachable only when a caller explicitly asserts the kind for a
      // document it obtained through the official worker.
      return 'OFFICIAL';
    case 'DEVELOPER_SITE':
      return 'COMPANY_PUBLISHED';
    case 'MEDIA':
      return 'REPUTABLE_MEDIA';
    case 'PROPERTY_PORTAL':
    case 'SEARCH_PROVIDER':
      return 'OTHER_PUBLIC_SOURCE';
    case 'FORUM':
    case 'SOCIAL':
      return 'SOCIAL_USER_GENERATED';
    case 'OTHER':
      return 'UNVERIFIED_CLAIM';
  }
}

export interface ToEvidenceInput {
  /** The observation being converted. */
  entry: DedupedObservation;
  /**
   * The claim text, already localized and sanitized by the caller. Required:
   * there is no default, because a default would be English prose written
   * inside the core.
   */
  claim: string;
  /** Human-readable source name, e.g. "myhome.ge listing #12345". */
  source: string;
  type: EvidenceType;
  /**
   * 0..1. The caller's own assessment. Passed through untouched — including
   * when it is low.
   */
  confidence: number;
  /** Support for the claim this observation carries, if computed. */
  support?: SupportCount | null;
  relatedPropertyId?: string | null;
  relatedEntityId?: string | null;
  /** True when this describes a past or superseded state. */
  historical?: boolean;
  /** Set when this observation is one side of a detected disagreement. */
  contradiction?: ContradictionRefs;
}

/**
 * Build an EvidenceItem from one observation.
 *
 * The verification state is derived, not asserted:
 *
 *   DISPUTED    a contradiction was attached — disagreement is preserved,
 *               never resolved, and it survives all the way to the ledger.
 *   UNVERIFIED  there is no supporting text, or the observation was folded in
 *               as a duplicate. EvidenceTypes.ts requires supporting text for
 *               anything above UNVERIFIED, so this is that rule enforced.
 *   VERIFIED    an independent observation with traceable supporting text.
 *
 * Note what VERIFIED does NOT mean here: it is not "Homatch verified this
 * against a registry". It is the ledger's own sense — the claim can be traced
 * to the exact text it came from.
 */
export function toEvidenceItem(input: ToEvidenceInput): EvidenceItem {
  const { entry, claim, source, type, confidence } = input;
  const observation = entry.observation;

  const hasSupportingText =
    typeof observation.supportingText === 'string' && observation.supportingText.trim().length > 0;

  const verificationState: VerificationState = input.contradiction
    ? 'DISPUTED'
    : entry.independent && hasSupportingText
      ? 'VERIFIED'
      : 'UNVERIFIED';

  const item: EvidenceItem = {
    id: observation.id,
    type,
    claim,
    source,
    sourceClass: sourceClassFor(observation.source.kind),
    // The IDENTITY url, not the fetch url: the fetch url can carry a session
    // parameter, and this field is shown and stored.
    sourceUrl: observation.canonicalIdentityUrl || null,
    // `date` is what the SOURCE says, and stays null when it said nothing.
    // retrievedAt is when we read it. Conflating them is how a scrape date
    // becomes a document date.
    date: observation.observedAt,
    retrievedAt: observation.retrievedAt,
    confidence: clampConfidence(confidence),
    verificationState,
    supportingText: observation.supportingText,
  };

  if (input.relatedPropertyId !== undefined) item.relatedPropertyId = input.relatedPropertyId;
  if (input.relatedEntityId !== undefined) item.relatedEntityId = input.relatedEntityId;
  if (input.historical !== undefined) item.historical = input.historical;
  if (input.contradiction) item.contradiction = input.contradiction;

  return item;
}

/**
 * The support numbers, rendered as a machine-readable suffix for the
 * operator-facing `source` field.
 *
 * Observation count and independent source count are kept as separate,
 * labelled numbers. "obs=9 ind=3" reads very differently from "9 sources",
 * and the second is the sentence syndication uses to look like corroboration.
 */
export function supportAnnotation(support: SupportCount): string {
  return `obs=${support.observationCount} ind=${support.independentSourceCount} eff=${support.effectiveSourceCount}`;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  // Clamped, never rounded up.
  return Math.min(1, Math.max(0, value));
}

/** Observations that were folded in as duplicates, for the audit trail. */
export function duplicateTrail(
  entries: readonly DedupedObservation[],
): Array<{ id: string; duplicateOf: string; reason: string }> {
  return entries
    .filter((entry) => !entry.independent && entry.duplicateOf)
    .map((entry) => ({
      id: entry.observation.id,
      duplicateOf: entry.duplicateOf as string,
      reason: entry.duplicateReason ?? 'ENTITY_IDENTITY',
    }));
}

/** Narrow helper so callers do not reach into `entry.observation` themselves. */
export function observationOf(entry: DedupedObservation): Observation {
  return entry.observation;
}
