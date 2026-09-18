// HOMATCH RESEARCH CORE — what we are allowed to do to a source.
//
// Everything permitted against a given source lives in one record, declared by
// the operator rather than decided by whichever adapter happens to handle the
// URL. An adapter author cannot widen the policy by accident, and a reviewer
// can read the whole posture toward a source in one place.
//
// `notes` is not decoration. Whether a source may be fetched at all is a legal
// and commercial question, not a technical one, and the answer belongs next to
// the configuration that acts on it.
//
// HOW THIS RELATES TO research_providers
//
// It does not replace it. `research_providers` remains the single registry of
// paid providers, with `enabled`, `kill_switch`, `daily_cap_cents` and
// `monthly_cap_cents`, and `provider_health` remains the record of whether a
// provider actually answers. A SourcePolicy carries `providerCode` so a
// registry hydrated from that table can switch a source off, and
// `hydrateFromProviderRows` below is the only supported way to do it. A source
// with no `providerCode` is an ordinary public web page that costs nothing and
// has no registry row — which is most of them.

import { hostnameOf, registrableDomainOf } from '../normalize/domain.ts';
import type { CanonicalizeOptions } from '../normalize/url.ts';
import type { LimitPolicy } from '../flow/rate-limiter.ts';
import type { SourceKind } from '../core/types.ts';
import { ResearchError } from '../core/errors.ts';

/**
 * RESPECT actually fetches and honours robots.txt (see ./robots.ts).
 * IGNORE does not — only for a source we have a contract with.
 * NOT_APPLICABLE is for APIs and fixtures, where robots.txt has no meaning.
 */
export type RobotsMode = 'RESPECT' | 'IGNORE' | 'NOT_APPLICABLE';

export type SourceVisibility = 'PUBLIC' | 'PRIVATE';

export interface RedirectPolicy {
  follow: boolean;
  max: number;
  /** Allow a redirect to leave the original registrable domain. */
  allowCrossDomain: boolean;
}

export interface SourcePolicy {
  id: string;
  /** Registrable domains this policy governs. */
  domains: string[];
  /** Optional exact hostnames, checked before the domain list. */
  hosts?: string[];

  /**
   * Publisher group. REQUIRED, because independence counting depends on it:
   * five portals republishing one developer's feed are five observations and
   * one independent source, and nothing in a URL reveals that. Defaulting it
   * to the domain would silently assert independence that was never checked.
   */
  sourceFamily: string;
  kind: SourceKind;

  /** The `research_providers.provider_code` row that governs this, if any. */
  providerCode?: string | null;

  enabled: boolean;
  allowedMethods: Array<'GET' | 'HEAD'>;
  rate: LimitPolicy;

  robots: RobotsMode;

  /** Headless rendering is refused unless this is true AND a renderer exists. */
  browserRenderingAllowed: boolean;

  maxResponseBytes: number;
  timeoutMs: number;
  redirects: RedirectPolicy;

  /**
   * HTTP DOCUMENT cache lifetime — how long a fetched page may be reused
   * before it is re-fetched.
   *
   * This is NOT fact freshness. How long a FACT stays good is decided by
   * intelligence_freshness_policy per fact-key pattern (ownership changes on a
   * Tuesday; a building does not gain a floor), and that model stays
   * authoritative. Confusing the two is how a six-hour mortgage check ends up
   * being answered from a day-old page.
   */
  cacheTtlMs: number;
  cacheStaleMs: number;

  /**
   * PUBLIC documents may be cached and coalesced globally.
   * PRIVATE ones are scoped to the requesting tenant or user.
   */
  visibility: SourceVisibility;

  /** Evidential weight, 0..1. Only for ordering; never a customer-facing score. */
  authority: number;

  /** Identity-only canonicalization. Never applied to the fetch target. */
  canonicalization: CanonicalizeOptions;
  /** Query parameters that make a URL caller-specific, and that must be redacted. */
  privateQueryParams?: string[];

  notes: string;
}

export type ResolvedSourcePolicy = SourcePolicy & { matched: boolean };

/**
 * The policy applied to a source with no entry of its own.
 *
 * Conservative in every direction: enabled so research still works, but with
 * low concurrency, a modest byte cap, robots respected, rendering refused,
 * PUBLIC visibility (an unknown public page is not tenant data) and low
 * authority. The source family is the literal string 'unknown', which makes
 * every unconfigured source a sibling of every other unconfigured source —
 * deliberately pessimistic, so independence is under-counted rather than
 * invented.
 */
export const DEFAULT_SOURCE_POLICY: SourcePolicy = {
  id: 'default',
  domains: [],
  sourceFamily: 'unknown',
  kind: 'OTHER',
  providerCode: null,
  enabled: true,
  allowedMethods: ['GET', 'HEAD'],
  rate: { concurrency: 2, requestsPerSecond: 4, burst: 4 },
  robots: 'RESPECT',
  browserRenderingAllowed: false,
  maxResponseBytes: 3_000_000,
  timeoutMs: 8000,
  redirects: { follow: true, max: 5, allowCrossDomain: true },
  cacheTtlMs: 6 * 60 * 60 * 1000,
  cacheStaleMs: 18 * 60 * 60 * 1000,
  visibility: 'PUBLIC',
  authority: 0.3,
  canonicalization: { stripWww: true, stripTracking: true },
  notes: 'No explicit policy configured; conservative defaults applied.',
};

export class SourceAccessPolicyRegistry {
  private readonly byDomain = new Map<string, SourcePolicy>();
  private readonly byHost = new Map<string, SourcePolicy>();
  private readonly byId = new Map<string, SourcePolicy>();

  private readonly fallback: SourcePolicy;

  constructor(
    policies: SourcePolicy[] = [],
    fallback: SourcePolicy = DEFAULT_SOURCE_POLICY) {
    this.fallback = fallback;

    for (const policy of policies) this.register(policy);
  }

  register(policy: SourcePolicy): this {
    this.byId.set(policy.id, policy);
    for (const domain of policy.domains) this.byDomain.set(domain.toLowerCase(), policy);
    for (const host of policy.hosts ?? []) this.byHost.set(host.toLowerCase(), policy);
    return this;
  }

  /** Exact host wins over registrable domain; neither wins over nothing. */
  resolve(url: string): ResolvedSourcePolicy {
    const host = hostnameOf(url);
    if (host) {
      const exact = this.byHost.get(host);
      if (exact) return { ...exact, matched: true };
    }
    const domain = registrableDomainOf(url);
    if (domain) {
      const byDomain = this.byDomain.get(domain);
      if (byDomain) return { ...byDomain, matched: true };
    }
    return { ...this.fallback, matched: false };
  }

  /** Policy for a named non-HTTP provider (a search API, a document service). */
  resolveProvider(providerId: string): ResolvedSourcePolicy {
    const byId = this.byId.get(providerId);
    return byId ? { ...byId, matched: true } : { ...this.fallback, id: providerId, matched: false };
  }

  all(): SourcePolicy[] {
    return [...this.byId.values()];
  }

  /**
   * Apply the live state of `research_providers` to every policy that names a
   * provider code.
   *
   * Disabling is the ONLY direction this moves. A registry row can switch a
   * source off; it can never switch on a source the code did not already
   * declare, so a bad row cannot widen access. The caller passes plain rows so
   * the core keeps no Supabase dependency.
   */
  hydrateFromProviderRows(
    rows: ReadonlyArray<{ provider_code: string; enabled?: boolean | null; kill_switch?: boolean | null }>,
  ): this {
    const state = new Map(rows.map((row) => [row.provider_code.toUpperCase(), row]));
    for (const policy of this.all()) {
      if (!policy.providerCode) continue;
      const row = state.get(policy.providerCode.toUpperCase());
      // No row at all means the provider is not registered, which is not a
      // licence to call it.
      const live = row ? row.enabled !== false && row.kill_switch !== true : false;
      if (!live) policy.enabled = false;
    }
    return this;
  }
}

export class SourceDisabledError extends ResearchError {
  constructor(policyId: string, url: string) {
    super('POLICY_DENIED', 'Source is disabled by policy', {
      retryable: false,
      details: { policyId, url },
    });
    this.name = 'SourceDisabledError';
  }
}
