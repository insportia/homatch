// HOMATCH RESEARCH CORE — a signal, on its way into the tables that exist.
//
// `raw_signals` and `source_registry` are already Homatch's durable record of
// discovered public content and of where it came from. They have the columns
// this core needs — source_url, author_public_name, author_public_url,
// original_text, language, published_at, discovered_at, last_seen_at,
// content_fingerprint, classification_status — and the pipeline that reads
// them (classify-signals-v2, intent_profiles, property_signal_candidates,
// the matching engine) is live.
//
// So this file maps between the in-memory shape and those rows. It does not
// define a second signal table, and there is no second source table.
//
// THE PRIVACY LINE, DRAWN HERE
//
// A public post's visible author handle is public and is carried. A phone
// number or an email address that somebody typed into a comment is personal
// data with an existing consent and unlock path in Homatch, and this is not
// it — `stripContactDetails` removes them from the text that gets stored, and
// nothing in this core ever tries to work out who an author "really is" or
// to match one account to another across platforms.

import type { PublicSignal } from '../signals/types.ts';
import type { SourceRecord } from '../discovery/source-registry.ts';

/**
 * The `raw_signals` insert shape.
 *
 * Declared structurally rather than generated: the core holds no Supabase
 * client and no generated types. Pinned against the real migration by
 * __tests__/bridgeSignal.test.mjs, which reads the SQL and fails on drift.
 */
export interface RawSignalRow {
  source_id: string | null;
  platform: string;
  external_id: string | null;
  source_url: string | null;
  author_public_name: string | null;
  author_public_url: string | null;
  original_text: string;
  language: string | null;
  published_at: string | null;
  discovered_at: string;
  last_seen_at: string;
  content_fingerprint: string;
  provider: string | null;
  classification_status: 'PENDING' | 'FILTERED_OUT' | 'CANDIDATE' | 'CLASSIFIED' | 'ERROR';
}

/** Contact details are removed before storage, not collected and kept. */
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]{2,}/g;
const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/g;

export function stripContactDetails(text: string): string {
  return text.replace(EMAIL, '[contact removed]').replace(PHONE, '[contact removed]');
}

export interface ToRowOptions {
  /** The `source_registry.id` this came from, when it came from a known one. */
  sourceId: string | null;
  /**
   * What produced it. Recorded for provenance and for cost attribution.
   *
   * 'RESEARCH_CORE_HTTP' for a deterministic fetch, 'RESEARCH_CORE_BROWSER'
   * when official-worker rendered it, 'HOMATCH_FIRST_PARTY' for our own data.
   * Never a vendor name that was not used.
   */
  provider: string;
  /**
   * Keep the text exactly as written.
   *
   * Defaults to false, i.e. contact details are stripped. A caller that has a
   * genuine, consented reason to keep them must say so explicitly, which
   * makes it reviewable.
   */
  keepContactDetails?: boolean;
}

export function toRawSignalRow(signal: PublicSignal, options: ToRowOptions): RawSignalRow {
  const text = options.keepContactDetails
    ? signal.originalText
    : stripContactDetails(signal.originalText);

  return {
    source_id: options.sourceId,
    platform: signal.platform,
    // The exact content URL is the natural external id; the platform's own
    // (platform, external_id) unique constraint then does the de-duplication
    // for us at insert time, across scans and across jobs.
    external_id: signal.contentUrl ?? signal.id,
    source_url: signal.contentUrl ?? signal.sourceUrl,
    author_public_name: signal.author.publicName,
    author_public_url: signal.author.publicUrl,
    original_text: text,
    language: signal.language,
    // Null when the source stated no date. NEVER the discovery time.
    published_at: signal.publishedAt,
    discovered_at: signal.discoveredAt,
    last_seen_at: signal.lastSeenAt,
    content_fingerprint: signal.contentFingerprint,
    provider: options.provider,
    // The Research Core decides direction and relevance; it does not decide
    // intent_type. That stays with classify-signals-v2 and intent_profiles,
    // so a signal arrives PENDING and the existing pipeline picks it up.
    classification_status: 'PENDING',
  };
}

/**
 * Parent context, for the columns that hold it.
 *
 * A comment's parent post is part of its evidence: "is this still available?"
 * is a strong buyer signal under a listing and noise on its own. It is stored
 * as structured metadata rather than concatenated into the text, so the text
 * stays exactly what the person wrote.
 */
export interface SignalContextRow {
  parent_url: string | null;
  parent_excerpt: string | null;
  content_type: string;
  access_class: string;
  direction: string;
  direction_confidence: number;
}

export function toSignalContextRow(signal: PublicSignal): SignalContextRow {
  return {
    parent_url: signal.parentUrl,
    parent_excerpt: signal.parentExcerpt,
    content_type: signal.contentType,
    access_class: signal.accessClass,
    direction: signal.direction,
    direction_confidence: signal.directionConfidence,
  };
}

/* ── source_registry ──────────────────────────────────────────────────── */

export interface SourceRegistryRow {
  id?: string;
  platform: string;
  source_type: string;
  external_id: string | null;
  name: string | null;
  url: string;
  country_code: string;
  language: string | null;
  active: boolean;
  priority: number;
  quality_score: number | null;
  provider: string | null;
  last_collected_at: string | null;
  last_successful_at: string | null;
  failure_count: number;
  /* Columns added additively by the Research Core migration. */
  access_state: string;
  city: string | null;
  region: string | null;
  languages: string[] | null;
  compatible_profiles: string[] | null;
  property_terms: string[] | null;
  scan_cursor: string | null;
  chronological: boolean;
  last_useful_at: string | null;
  useful_signal_count: number;
  scanned_signal_count: number;
  last_failure_reason: string | null;
}

export function toSourceRegistryRow(
  source: SourceRecord,
  options: { provider: string },
): SourceRegistryRow {
  const totals = source.productivity.reduce(
    (acc, row) => ({ scanned: acc.scanned + row.scanned, useful: acc.useful + row.useful }),
    { scanned: 0, useful: 0 },
  );
  const lastUseful = source.productivity
    .map((row) => row.lastUsefulAt)
    .filter((value): value is string => !!value)
    .sort()
    .pop() ?? null;

  return {
    platform: source.platform,
    source_type: source.sourceType,
    external_id: source.externalId,
    name: source.name,
    url: source.canonicalUrl,
    country_code: source.countryCode,
    // The singular column stays for the existing readers; the plural array
    // below is the truth. Neither is dropped, so nothing breaks.
    language: source.languages[0] ?? null,
    active: source.active,
    // The existing 0-100 priority column, derived from what we have learned.
    priority: Math.round(
      Math.min(100, Math.max(1, 50 + (totals.useful > 0 ? 30 : 0) - source.failureCount * 5)),
    ),
    quality_score: null,
    provider: options.provider,
    last_collected_at: source.lastScanAt,
    last_successful_at: source.lastSuccessAt,
    failure_count: source.failureCount,
    access_state: source.accessState,
    city: source.city,
    region: source.region,
    languages: source.languages,
    compatible_profiles: source.compatibleProfiles,
    property_terms: source.propertyTerms,
    scan_cursor: source.cursor,
    chronological: source.chronological,
    last_useful_at: lastUseful,
    useful_signal_count: totals.useful,
    scanned_signal_count: totals.scanned,
    last_failure_reason: source.lastFailureReason,
  };
}
