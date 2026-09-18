// HOMATCH RESEARCH CORE — free first, expensive last, honest when neither.
//
// Discovery has a cost gradient spanning four orders of magnitude: reading a
// cached document costs nothing, asking the database costs a query, fetching
// a public page costs a request, and driving a browser costs seconds of CPU
// and a container. A pipeline that starts at the expensive end and works
// backwards pays the maximum every time.
//
// So the ladder is explicit, it is climbed in order, and each rung records
// what it produced. The run stops as soon as the job has what it asked for.
//
//   1. CACHE            research_cache, through the shared CachedFetcher
//   2. FIRST_PARTY      Homatch's own consented demand and supply
//   3. KNOWN_SOURCES    source_registry, best-first by productivity
//   4. PUBLIC_WEB       deterministic HTTP discovery of new sources
//   5. BROWSER          the EXISTING official-worker, only where genuinely
//                       required and permitted
//   6. UNAVAILABLE      say so
//
// THERE IS NO PAID-PROVIDER RUNG. Homatch's discovery is Homatch's code.
// DataForSEO and Apify are treated as non-existent: there is no adapter, no
// fallback and no configuration flag that would reach them, and
// __tests__/discoveryLadder.test.mjs asserts the names appear nowhere in the
// core. The previous discovery function was built entirely on those two,
// which is precisely why it now has no capability at all.
//
// RUNG 6 IS A REAL OUTCOME, NOT A FAILURE. "We could not read that source"
// recorded honestly is worth more than a fabricated empty success, and a
// source that cannot be reached must never be reported as a source that
// contained nothing.

import type { ResearchDirection } from '../core/types.ts';
import type { PublicSignal } from '../signals/types.ts';
import type { ProfileId } from '../profiles/types.ts';
import type { ResearchLanguage } from './lexicon.ts';
import type { PlannedQuery } from './query-plan.ts';
import {
  needsRescan,
  selectSources,
  type SourceRecord,
  type SourceSelection,
} from './source-registry.ts';
import {
  supports,
  type AdapterContext,
  type AdapterRegistry,
  type DiscoveredSource,
} from './adapter.ts';

export type LadderRung =
  | 'CACHE'
  | 'FIRST_PARTY'
  | 'KNOWN_SOURCES'
  | 'PUBLIC_WEB'
  | 'BROWSER'
  | 'UNAVAILABLE';

export const LADDER: readonly LadderRung[] = [
  'CACHE',
  'FIRST_PARTY',
  'KNOWN_SOURCES',
  'PUBLIC_WEB',
  'BROWSER',
  'UNAVAILABLE',
];

export interface RungOutcome {
  rung: LadderRung;
  attempted: boolean;
  /** Why a rung was skipped entirely. Shown to operators. */
  skippedReason?: string;
  signals: PublicSignal[];
  discovered: DiscoveredSource[];
  /** Sources that could not be read, and why. Never silently dropped. */
  failures: Array<{ sourceId: string; reason: string }>;
  durationMs: number;
}

export interface LadderResult {
  rungs: RungOutcome[];
  signals: PublicSignal[];
  discovered: DiscoveredSource[];
  /** True when every rung was tried and the job still has nothing. */
  unavailable: boolean;
  /** True when a budget or deadline stopped the climb early. */
  truncated: boolean;
  selection: SourceSelection | null;
}

/**
 * Homatch's own data, as a source.
 *
 * A buyer request somebody typed into Homatch is better evidence of demand
 * than anything on the public web: it is first-party, consented and
 * structured. It is also the one source that must never be read carelessly —
 * the port is implemented above the core, behind the existing
 * privacy/authorization architecture, and returns only what the asking user
 * is entitled to see. The core cannot reach the database and therefore
 * cannot get this wrong on its own.
 */
export interface FirstPartyPort {
  collect(request: {
    profileId: ProfileId;
    direction: ResearchDirection;
    countryCode: string;
    city: string | null;
    limit: number;
  }): Promise<PublicSignal[]>;
}

export interface LadderInput {
  profileId: ProfileId;
  direction: ResearchDirection;
  countryCode: string;
  city: string | null;
  languages: readonly ResearchLanguage[];
  queries: readonly PlannedQuery[];
  /** Everything currently in source_registry for this market. */
  knownSources: readonly SourceRecord[];
  adapters: AdapterRegistry;
  context: AdapterContext;
  firstParty?: FirstPartyPort;
  /** Stop climbing once this many signals are in hand. */
  targetSignals: number;
  maxSources: number;
  /** Do not re-scan a source touched more recently than this. */
  minRescanIntervalMs?: number;
  /** Allow the BROWSER rung. Off unless the caller genuinely needs it. */
  allowBrowser?: boolean;
  includeComments: boolean;
  deadlineAt?: number | null;
  now?: () => number;
}

export async function climbLadder(input: LadderInput): Promise<LadderResult> {
  const now = input.now ?? (() => Date.now());
  const rungs: RungOutcome[] = [];
  const signals: PublicSignal[] = [];
  const discovered: DiscoveredSource[] = [];
  let selection: SourceSelection | null = null;
  let truncated = false;

  const enough = () => signals.length >= input.targetSignals;
  const pastDeadline = () =>
    input.deadlineAt !== null && input.deadlineAt !== undefined && now() >= input.deadlineAt;

  const record = (
    rung: LadderRung,
    started: number,
    partial: Partial<RungOutcome> = {},
  ): RungOutcome => {
    const outcome: RungOutcome = {
      rung,
      attempted: true,
      signals: [],
      discovered: [],
      failures: [],
      durationMs: now() - started,
      ...partial,
    };
    rungs.push(outcome);
    return outcome;
  };

  const skip = (rung: LadderRung, reason: string) => {
    rungs.push({
      rung,
      attempted: false,
      skippedReason: reason,
      signals: [],
      discovered: [],
      failures: [],
      durationMs: 0,
    });
  };

  /* ── 1. CACHE ──────────────────────────────────────────────────────────
   * Not a separate fetch: the shared CachedFetcher answers from
   * research_cache underneath every rung below. Recorded as a rung so the
   * ladder reads honestly, and so the admin area can show that the cheapest
   * path is in the chain rather than bypassed.
   */
  skip('CACHE', 'served transparently by the shared cached fetcher');

  /* ── 2. FIRST_PARTY ─────────────────────────────────────────────────── */
  if (input.firstParty) {
    const started = now();
    const own = await input.firstParty.collect({
      profileId: input.profileId,
      direction: input.direction,
      countryCode: input.countryCode,
      city: input.city,
      limit: input.targetSignals,
    });
    signals.push(...own);
    record('FIRST_PARTY', started, { signals: own });
  } else {
    skip('FIRST_PARTY', 'no first-party port supplied');
  }

  if (enough() || pastDeadline()) {
    return finish(rungs, signals, discovered, selection, pastDeadline());
  }

  /* ── 3. KNOWN_SOURCES ───────────────────────────────────────────────── */
  {
    const started = now();
    selection = selectSources(input.knownSources, {
      profileId: input.profileId,
      countryCode: input.countryCode,
      languages: input.languages,
      limit: input.maxSources,
      authenticatedAvailable: input.context.authenticatedSession,
      now: now(),
    });

    const outcome = record('KNOWN_SOURCES', started);

    for (const source of selection.selected) {
      if (enough() || pastDeadline()) { truncated = true; break; }

      if (
        input.minRescanIntervalMs !== undefined &&
        !needsRescan(source, { minIntervalMs: input.minRescanIntervalMs, now: now() })
      ) {
        outcome.failures.push({ sourceId: source.id, reason: 'SCANNED_RECENTLY' });
        continue;
      }

      const adapter = input.adapters.forUrl(source.canonicalUrl)
        ?? input.adapters.forPlatform(source.platform);
      if (!adapter || !adapter.scan || !supports(adapter, 'scanIncremental')) {
        outcome.failures.push({ sourceId: source.id, reason: 'NO_ADAPTER' });
        continue;
      }

      const result = await adapter.scan(
        {
          source,
          direction: input.direction,
          // The cursor is what makes this incremental: only what is new.
          cursor: source.cursor,
          limit: Math.max(1, input.targetSignals - signals.length),
          includeComments: input.includeComments,
        },
        input.context,
      );

      if (!result.ok) {
        // One source failing is not the job failing. This is the difference
        // between a PARTIAL result and a poisoned one.
        outcome.failures.push({ sourceId: source.id, reason: result.reason });
        continue;
      }

      outcome.signals.push(...result.value.signals);
      signals.push(...result.value.signals);
      outcome.discovered.push(...result.value.discovered);
      discovered.push(...result.value.discovered);
      if (result.value.truncated) truncated = true;
    }
    outcome.durationMs = now() - started;
  }

  if (enough() || pastDeadline()) {
    return finish(rungs, signals, discovered, selection, pastDeadline() || truncated);
  }

  /* ── 4. PUBLIC_WEB — deterministic discovery of sources we do not know ── */
  {
    const started = now();
    const outcome = record('PUBLIC_WEB', started);

    for (const adapter of input.adapters.all()) {
      if (pastDeadline()) { truncated = true; break; }
      if (!adapter.discover || !supports(adapter, 'discover')) continue;

      const found = await adapter.discover(
        {
          queries: input.queries,
          countryCode: input.countryCode,
          languages: input.languages,
          limit: input.maxSources,
        },
        input.context,
      );

      if (!found.ok) {
        outcome.failures.push({ sourceId: adapter.id, reason: found.reason });
        continue;
      }
      outcome.discovered.push(...found.value);
      discovered.push(...found.value);
    }
    outcome.durationMs = now() - started;
  }

  /* ── 5. BROWSER — the existing official-worker, only if truly needed ─── */
  if (!input.allowBrowser) {
    skip('BROWSER', 'not requested for this run');
  } else if (!input.context.renderDocument) {
    // Honest: the capability was wanted and is not available. Not silence.
    skip('BROWSER', 'no browser capability available to this run');
  } else {
    skip('BROWSER', 'reached only by an adapter that asks for it during a scan');
  }

  const unavailable = signals.length === 0 && discovered.length === 0;
  if (unavailable) {
    skip('UNAVAILABLE', 'every rung was attempted and produced nothing');
  }

  return finish(rungs, signals, discovered, selection, truncated);
}

function finish(
  rungs: RungOutcome[],
  signals: PublicSignal[],
  discovered: DiscoveredSource[],
  selection: SourceSelection | null,
  truncated: boolean,
): LadderResult {
  return {
    rungs,
    signals,
    discovered,
    unavailable: signals.length === 0 && discovered.length === 0,
    truncated,
    selection,
  };
}
