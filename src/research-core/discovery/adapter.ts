// HOMATCH RESEARCH CORE — the source adapter contract.
//
// Everything platform-specific lives behind this interface and nothing else
// in the core knows a platform exists. That is the property that matters: a
// Facebook layout change breaks the Facebook adapter and nothing else, and
// adding Telegram, Reddit, TikTok or a property portal later is a new file
// implementing this interface rather than a new job engine.
//
// FOUR CAPABILITIES, DECLARED NOT ASSUMED
//
//   discover        find sources worth remembering
//   fetch           read one specific thing
//   extract         turn fetched content into signals
//   scanIncremental read only what is new since a cursor
//
// An adapter declares which it supports. Asking for one it does not support
// is refused with a reason rather than silently returning nothing, because
// "this source produced no results" and "we cannot read this kind of source"
// are different facts and the admin area has to tell them apart.
//
// WHAT AN ADAPTER MUST NOT CONTAIN
//
// Brittle UI choreography. "Click the third button on the left" is a bug with
// a delay fuse. Adapters navigate by URL, read structured data and stable DOM
// semantics, and when a platform stops serving something they say so.
//
// Nor may an adapter reach the network itself. It is handed a fetcher, which
// is the shared HttpClient behind the SSRF policy, robots, per-source rate
// limits, circuit breakers, caching and coalescing. An adapter that called
// `fetch` directly would bypass every one of those.

import type { ResearchDirection } from '../core/types.ts';
import type { PublicSignal } from '../signals/types.ts';
import type { ResearchLanguage } from './lexicon.ts';
import type { PlannedQuery } from './query-plan.ts';
import type { SourceAccessState, SourceRecord } from './source-registry.ts';

export type AdapterCapability = 'discover' | 'fetch' | 'extract' | 'scanIncremental';

/**
 * How an adapter wants to reach a page.
 *
 * The ladder in ./ladder.ts tries these in order of cost. `browser` is the
 * expensive last resort and is served by the EXISTING official-worker; it is
 * never a new browser pool and never a new service.
 */
export type FetchCapability = 'http' | 'browser';

export interface AdapterContext {
  /**
   * The shared, policy-enforced fetch path. The only way out to the network.
   *
   * Returns the document plus how it was obtained, so the adapter can record
   * provenance without knowing anything about caching or coalescing.
   */
  fetchDocument(url: string, options?: { forceRefresh?: boolean }): Promise<AdapterDocument>;
  /**
   * Ask for browser execution, when and only when deterministic HTTP cannot
   * retrieve content that is genuinely accessible.
   *
   * Absent when no browser capability is available to this run, which is the
   * normal case. An adapter must degrade rather than fail.
   */
  renderDocument?: (url: string, options?: { waitForSelector?: string }) => Promise<AdapterDocument>;
  /** An authenticated session exists for this platform. */
  authenticatedSession: boolean;
  now(): number;
}

export interface AdapterDocument {
  url: string;
  status: number;
  body: string;
  contentType: string | null;
  retrievedAt: string;
  /** 'http' when deterministic fetch sufficed, 'browser' when it did not. */
  via: FetchCapability;
}

export type AdapterOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; reason: AdapterFailure; detail?: string };

/**
 * Why an adapter could not do something.
 *
 * `LOGIN_WALL` and `JOIN_REQUIRED` are separate on purpose: the first means
 * an authenticated session would help, the second means a human has to be
 * asked for access. Neither is ever answered by automating around it.
 */
export type AdapterFailure =
  | 'CAPABILITY_NOT_SUPPORTED'
  | 'LOGIN_WALL'
  | 'JOIN_REQUIRED'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'BLOCKED'
  | 'PARSE_FAILED'
  | 'BROWSER_UNAVAILABLE'
  | 'NETWORK_ERROR';

export interface DiscoverRequest {
  queries: readonly PlannedQuery[];
  countryCode: string;
  languages: readonly ResearchLanguage[];
  limit: number;
}

/** A source we found and think is worth remembering. Not yet scanned. */
export interface DiscoveredSource {
  canonicalUrl: string;
  externalId: string | null;
  name: string | null;
  accessState: SourceAccessState;
  languages: ResearchLanguage[];
  /** Operator-facing: why this looked useful. Shown in the admin area. */
  rationale: string;
}

export interface ScanRequest {
  source: SourceRecord;
  direction: ResearchDirection;
  /** Only read what is newer than this. Null means a first full scan. */
  cursor: string | null;
  /** Stop after this many items, whatever the source still holds. */
  limit: number;
  /** Follow comments. Costs more requests; only demand jobs need it. */
  includeComments: boolean;
}

export interface ScanResult {
  signals: PublicSignal[];
  /** Pass to the next scan. Null when the source has no usable cursor. */
  cursor: string | null;
  /**
   * True when the scan stopped at `limit` rather than at the end.
   *
   * The difference between "that is everything" and "that is all we could
   * afford", which is the difference between an honest empty result and a
   * silently truncated one.
   */
  truncated: boolean;
  /** Sources this scan discovered incidentally. Cheap and worth keeping. */
  discovered: DiscoveredSource[];
}

export interface SourceAdapter {
  /** Stable key, e.g. 'facebook'. Used in source keys and metrics. */
  readonly id: string;
  readonly platform: PublicSignal['platform'];
  readonly capabilities: readonly AdapterCapability[];
  /** True when this adapter can handle the URL. */
  handles(url: string): boolean;
  /** The canonical identity form of a URL on this platform. */
  canonicalize(url: string): string | null;

  discover?(request: DiscoverRequest, context: AdapterContext): Promise<AdapterOutcome<DiscoveredSource[]>>;
  scan?(request: ScanRequest, context: AdapterContext): Promise<AdapterOutcome<ScanResult>>;
}

export function supports(adapter: SourceAdapter, capability: AdapterCapability): boolean {
  return adapter.capabilities.includes(capability);
}

export class AdapterRegistry {
  private readonly adapters: SourceAdapter[] = [];

  register(adapter: SourceAdapter): this {
    this.adapters.push(adapter);
    return this;
  }

  /** The adapter that handles a URL, or null. First registered wins. */
  forUrl(url: string): SourceAdapter | null {
    return this.adapters.find((adapter) => adapter.handles(url)) ?? null;
  }

  forPlatform(platform: PublicSignal['platform']): SourceAdapter | null {
    return this.adapters.find((adapter) => adapter.platform === platform) ?? null;
  }

  all(): readonly SourceAdapter[] {
    return this.adapters;
  }
}
