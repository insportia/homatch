// HOMATCH RESEARCH CORE — remembering which sources are worth the trouble.
//
// The expensive half of discovery is not fetching, it is finding out where to
// fetch from. A Facebook group that produced eleven real buyer leads last
// month is worth scanning first and worth scanning often; one that produced
// four hundred posts and no leads is worth scanning rarely or never. An
// engine that rediscovers the world on every run pays that cost every time
// and never gets better at it.
//
// `source_registry` ALREADY EXISTS in Homatch, with platform, source_type,
// external_id, url, country_code, language, active, priority, quality_score,
// last_collected_at, last_successful_at and failure_count. This file is the
// pure in-memory model over it — selection, productivity, incremental
// cursors — plus the concepts it is missing. bridge/source.ts maps between
// the two. There is no second registry and no second table family.
//
// PRODUCTIVITY IS PER (job, market, language), NOT PER SOURCE
//
// The same group is excellent for RENTER_SEARCH in Russian and useless for
// LAND_SEARCH in Georgian. One `quality_score` column cannot express that,
// which is why the productivity records below are keyed by the combination
// and the column stays as the coarse overall signal it already is.

import type { ResearchLanguage } from './lexicon.ts';
import type { PropertyTerm } from './lexicon.ts';
import type { ProfileId } from '../profiles/types.ts';
import type { SignalPlatform } from '../signals/types.ts';

/**
 * How, and whether, we can read a source.
 *
 * The distinction that matters most is PUBLIC vs JOIN_REQUIRED. Public
 * content gets fetched by the simplest deterministic path available. A
 * source that requires membership is RECORDED and queued for a human — it is
 * never joined automatically, and nothing here rotates accounts, evades a
 * challenge or farms memberships to get around it.
 */
export type SourceAccessState =
  /** Readable with no credentials. The cheapest and the preferred path. */
  | 'PUBLIC'
  /** Readable by a session an operator legitimately connected. */
  | 'AUTHENTICATED_ACCESS'
  /** Needs membership or approval. Queued for a human; never auto-joined. */
  | 'JOIN_REQUIRED'
  /** Confirmed unreadable: removed, geo-blocked, permanently refused. */
  | 'INACCESSIBLE'
  /** Was readable, currently failing. Backed off, not abandoned. */
  | 'DEGRADED';

export interface SourceProductivity {
  profileId: ProfileId;
  countryCode: string;
  language: ResearchLanguage | null;
  /** Items scanned from this source for this combination. */
  scanned: number;
  /** Items that survived the job's filter. The numerator that matters. */
  useful: number;
  lastUsefulAt: string | null;
  lastScanAt: string | null;
}

export interface SourceRecord {
  id: string;
  platform: SignalPlatform;
  /** 'FACEBOOK_GROUP', 'INSTAGRAM_PROFILE', … — the existing source_type. */
  sourceType: string;
  /** The canonical, de-parameterised URL. The identity of the source. */
  canonicalUrl: string;
  externalId: string | null;
  name: string | null;

  countryCode: string;
  city: string | null;
  region: string | null;
  /** Plural: a Tbilisi group carries Georgian, Russian and English at once. */
  languages: ResearchLanguage[];

  /** Which jobs this source is worth running. Learned, not declared. */
  compatibleProfiles: ProfileId[];
  /** Property categories seen here, so a land job can skip a rentals group. */
  propertyTerms: PropertyTerm[];

  accessState: SourceAccessState;
  active: boolean;

  discoveredAt: string;
  lastScanAt: string | null;
  lastSuccessAt: string | null;
  /**
   * Where the last successful scan stopped.
   *
   * An opaque, source-defined string — a timestamp for a chronological feed,
   * a paging token for something else. The core never interprets it; the
   * adapter that produced it is the only thing that understands it.
   */
  cursor: string | null;
  /** True only when the source really is ordered by time. See freshness.ts. */
  chronological: boolean;

  failureCount: number;
  lastFailureReason: string | null;

  productivity: SourceProductivity[];
}

/* ────────────────────────────────────────────────────────────────────────
 * Productivity
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The yield we assume for a source nothing is known about.
 *
 * NOT 0.5. A realistic housing-group yield is somewhere in the low tens of
 * percent — most posts in any group are neither demand nor supply for the job
 * at hand. A half-and-half prior would put every unproven source above every
 * proven good one, which is exactly backwards: the whole point of keeping a
 * record is that a group with eleven real leads behind it gets scanned first.
 *
 * Set above a plausible yield rather than at it, so a brand-new source still
 * outranks one with a long record of producing nothing. Unproven should be
 * tried before hopeless, and after proven.
 */
const PRIOR_YIELD = 0.15;

/**
 * How much a source is worth for a job, 0..1.
 *
 * A yield rate on its own is a trap: one useful item out of one scanned is a
 * 100% yield and means nothing. So the rate is shrunk toward PRIOR_YIELD by
 * the evidence count — a source has to keep producing to keep a high score,
 * and a single lucky scan cannot promote a source above one with a long
 * record.
 */
export function productivityScore(
  source: SourceRecord,
  profileId: ProfileId,
  options: { countryCode?: string; language?: ResearchLanguage | null; now?: number } = {},
): number {
  const rows = source.productivity.filter((row) => {
    if (row.profileId !== profileId) return false;
    if (options.countryCode && !eq(row.countryCode, options.countryCode)) return false;
    if (options.language && row.language && row.language !== options.language) return false;
    return true;
  });

  if (rows.length === 0) {
    // No record for this combination. The prior, not zero: an unproven source
    // must be tried, or nothing new ever enters the registry.
    return PRIOR_YIELD;
  }

  const scanned = rows.reduce((sum, row) => sum + row.scanned, 0);
  const useful = rows.reduce((sum, row) => sum + row.useful, 0);
  if (scanned === 0) return PRIOR_YIELD;

  // Bayesian shrinkage toward the prior, which is worth 20 observations. A
  // source needs roughly that many scans before its own record outweighs the
  // assumption, which is about the point at which a yield rate means anything.
  const PRIOR_STRENGTH = 20;
  const rate = (useful + PRIOR_YIELD * PRIOR_STRENGTH) / (scanned + PRIOR_STRENGTH);

  // Decay on staleness: a source that produced well a year ago and nothing
  // since is not currently a good source.
  const now = options.now ?? Date.now();
  const lastUseful = rows
    .map((row) => (row.lastUsefulAt ? Date.parse(row.lastUsefulAt) : Number.NaN))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a)[0];

  let decay = 1;
  if (lastUseful !== undefined) {
    const ageDays = Math.max(0, (now - lastUseful) / 86_400_000);
    if (ageDays > 90) decay = 0.6;
    else if (ageDays > 30) decay = 0.85;
  }

  return round2(Math.min(1, Math.max(0, rate * decay)));
}

export interface SelectionOptions {
  profileId: ProfileId;
  countryCode: string;
  languages?: readonly ResearchLanguage[];
  propertyTerms?: readonly PropertyTerm[];
  /** Maximum sources to scan. The ordering is what makes this a budget. */
  limit: number;
  /** Include sources needing an authenticated session. */
  authenticatedAvailable?: boolean;
  now?: number;
}

export interface SourceSelection {
  selected: SourceRecord[];
  /** Why each rejected source was not selected. The admin area shows this. */
  skipped: Array<{ id: string; reason: SkipReason; detail?: string }>;
}

export type SkipReason =
  | 'INACTIVE'
  | 'INACCESSIBLE'
  | 'JOIN_REQUIRED'
  | 'NO_AUTHENTICATED_SESSION'
  | 'WRONG_MARKET'
  | 'WRONG_LANGUAGE'
  | 'WRONG_PROPERTY_CATEGORY'
  | 'BACKED_OFF_AFTER_FAILURES'
  | 'OVER_BUDGET';

/**
 * Choose which known sources to scan, best first.
 *
 * "Best" is productivity for THIS job in THIS market and language, then
 * recency of a useful result, then a stable id — never insertion order, so
 * the same registry produces the same plan twice.
 */
export function selectSources(
  sources: readonly SourceRecord[],
  options: SelectionOptions,
): SourceSelection {
  const now = options.now ?? Date.now();
  const skipped: SourceSelection['skipped'] = [];
  const eligible: Array<{ source: SourceRecord; score: number }> = [];

  for (const source of sources) {
    const skip = (reason: SkipReason, detail?: string) => {
      skipped.push({ id: source.id, reason, ...(detail ? { detail } : {}) });
    };

    if (!source.active) { skip('INACTIVE'); continue; }
    if (source.accessState === 'INACCESSIBLE') { skip('INACCESSIBLE'); continue; }
    if (source.accessState === 'JOIN_REQUIRED') {
      // Recorded, queued for a human, never auto-joined.
      skip('JOIN_REQUIRED');
      continue;
    }
    if (source.accessState === 'AUTHENTICATED_ACCESS' && !options.authenticatedAvailable) {
      skip('NO_AUTHENTICATED_SESSION');
      continue;
    }
    if (!eq(source.countryCode, options.countryCode)) { skip('WRONG_MARKET', source.countryCode); continue; }

    if (options.languages?.length && source.languages.length > 0) {
      const overlap = source.languages.some((language) => options.languages?.includes(language));
      if (!overlap) { skip('WRONG_LANGUAGE', source.languages.join(',')); continue; }
    }

    if (options.propertyTerms?.length && source.propertyTerms.length > 0) {
      const overlap = source.propertyTerms.some(
        (term) => options.propertyTerms?.includes(term) || term === 'property',
      );
      if (!overlap) { skip('WRONG_PROPERTY_CATEGORY', source.propertyTerms.join(',')); continue; }
    }

    if (shouldBackOff(source, now)) {
      skip('BACKED_OFF_AFTER_FAILURES', `${source.failureCount} failures`);
      continue;
    }

    eligible.push({
      source,
      score: productivityScore(source, options.profileId, {
        countryCode: options.countryCode,
        now,
      }),
    });
  }

  eligible.sort(
    (a, b) =>
      b.score - a.score ||
      lastUsefulAt(b.source) - lastUsefulAt(a.source) ||
      a.source.id.localeCompare(b.source.id),
  );

  const selected = eligible.slice(0, Math.max(0, options.limit)).map((entry) => entry.source);
  for (const entry of eligible.slice(Math.max(0, options.limit))) {
    skipped.push({ id: entry.source.id, reason: 'OVER_BUDGET' });
  }

  return { selected, skipped };
}

/**
 * Exponential back-off after repeated failure.
 *
 * A source that failed twice is retried in an hour; one that has failed ten
 * times in a row is retried daily. It is never dropped outright — a group
 * that went private for a week comes back — which is why DEGRADED exists as
 * a state separate from INACCESSIBLE.
 */
export function shouldBackOff(source: SourceRecord, now: number): boolean {
  if (source.failureCount < 2) return false;
  if (!source.lastScanAt) return false;
  const since = now - Date.parse(source.lastScanAt);
  if (!Number.isFinite(since)) return false;
  const backoffMs = Math.min(24 * 3_600_000, 3_600_000 * 2 ** Math.min(source.failureCount - 2, 5));
  return since < backoffMs;
}

/**
 * Should we re-scan this source at all, or is what we have recent enough?
 *
 * The incremental question. A source scanned ten minutes ago has nothing new
 * worth the request; one never scanned is always worth a first look.
 */
export function needsRescan(
  source: SourceRecord,
  options: { minIntervalMs: number; now?: number },
): boolean {
  if (!source.lastScanAt) return true;
  const since = (options.now ?? Date.now()) - Date.parse(source.lastScanAt);
  if (!Number.isFinite(since)) return true;
  return since >= options.minIntervalMs;
}

/** Fold a completed scan back into the record. Pure: returns a new record. */
export function recordScan(
  source: SourceRecord,
  outcome: {
    profileId: ProfileId;
    countryCode: string;
    language: ResearchLanguage | null;
    scanned: number;
    useful: number;
    /** The adapter's new cursor, when it produced one. */
    cursor?: string | null;
    failed?: boolean;
    failureReason?: string | null;
    at?: string;
  },
): SourceRecord {
  const at = outcome.at ?? new Date().toISOString();
  const rows = [...source.productivity];
  const index = rows.findIndex(
    (row) =>
      row.profileId === outcome.profileId &&
      eq(row.countryCode, outcome.countryCode) &&
      row.language === outcome.language,
  );

  const existing: SourceProductivity = index >= 0
    ? (rows[index] as SourceProductivity)
    : {
        profileId: outcome.profileId,
        countryCode: outcome.countryCode,
        language: outcome.language,
        scanned: 0,
        useful: 0,
        lastUsefulAt: null,
        lastScanAt: null,
      };

  const updated: SourceProductivity = {
    ...existing,
    scanned: existing.scanned + outcome.scanned,
    useful: existing.useful + outcome.useful,
    lastScanAt: at,
    lastUsefulAt: outcome.useful > 0 ? at : existing.lastUsefulAt,
  };

  if (index >= 0) rows[index] = updated;
  else rows.push(updated);

  return {
    ...source,
    lastScanAt: at,
    lastSuccessAt: outcome.failed ? source.lastSuccessAt : at,
    // A cursor only advances on success. Advancing it after a failure would
    // skip the window the failed scan was supposed to cover, permanently.
    cursor: outcome.failed ? source.cursor : (outcome.cursor ?? source.cursor),
    failureCount: outcome.failed ? source.failureCount + 1 : 0,
    lastFailureReason: outcome.failed ? (outcome.failureReason ?? 'unknown') : null,
    accessState: nextAccessState(source, outcome.failed === true),
    productivity: rows,
  };
}

/**
 * A failing source degrades; it does not disappear.
 *
 * Only an explicit, confirmed verdict moves a source to INACCESSIBLE — a
 * string of failures is evidence of a problem, not proof the content is gone.
 */
function nextAccessState(source: SourceRecord, failed: boolean): SourceAccessState {
  if (!failed) {
    return source.accessState === 'DEGRADED' ? 'PUBLIC' : source.accessState;
  }
  if (source.accessState === 'PUBLIC' && source.failureCount + 1 >= 3) return 'DEGRADED';
  return source.accessState;
}

function lastUsefulAt(source: SourceRecord): number {
  const values = source.productivity
    .map((row) => (row.lastUsefulAt ? Date.parse(row.lastUsefulAt) : 0))
    .filter((value) => Number.isFinite(value));
  return values.length ? Math.max(...values) : 0;
}

function eq(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
