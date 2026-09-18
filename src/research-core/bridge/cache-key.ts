// HOMATCH RESEARCH CORE — keys into the cache that already exists.
//
// `research_cache` is Homatch's store of fetched records: a UNIQUE
// `fingerprint`, a `provider`, `query_json`, `content_hash`, `hit_count`,
// `retention_expires_at` and a `freshness_status` of LIVE / FRESH / AGING /
// STALE. It is the right table and this core adds no other.
//
// TWO RULES, BOTH LEARNED THE HARD WAY ELSEWHERE
//
// 1. NEVER REDEFINE AN EXISTING FINGERPRINT. `homatch-research` computes its
//    own as a bare 64-character SHA-256 hex of "mode:query:lang". Changing how
//    any existing key is derived would invalidate the whole cache at once —
//    a real cost event, not merely a slow afternoon. So every key this core
//    produces carries a version prefix, is structurally distinguishable from
//    the existing form, and lives alongside it rather than over it.
//
// 2. THE SCOPE IS PART OF THE KEY. A page fetched under one customer's
//    session must never be served to another. `research_cache` has no tenant
//    column and does not need one: folding the scope into the fingerprint
//    makes a cross-tenant hit impossible by construction, and needs no
//    migration. A PUBLIC source is scoped globally, which is what makes
//    caching worth anything at all.

import { sha256Hex } from '../core/sha256.ts';
import { canonicalizeUrl } from '../normalize/url.ts';
import type { RequestContext, VisibilityScope } from '../core/types.ts';
import type { CanonicalizeOptions } from '../normalize/url.ts';
import type { SourceVisibility } from '../net/source-policy.ts';

/** Bumping this invalidates only keys THIS core produced. */
const KEY_VERSION = 'rc1';

/**
 * The scope a cached item belongs to, as a short opaque token.
 *
 * PUBLIC_GLOBAL is the literal string 'public'; anything else hashes the
 * identifying id, so a tenant id never appears in a key that might be logged.
 */
export function scopeToken(context: RequestContext, visibility: SourceVisibility): string {
  // A PRIVATE source narrows the scope even when the caller asked for global.
  // The reverse is never true: a caller cannot widen a private scope.
  const effective: VisibilityScope =
    visibility === 'PRIVATE' && context.visibilityScope === 'PUBLIC_GLOBAL'
      ? 'TENANT_PRIVATE'
      : context.visibilityScope;

  switch (effective) {
    case 'PUBLIC_GLOBAL':
      return 'public';
    case 'TENANT_PRIVATE': {
      const tenant = context.tenantId ?? context.userId;
      if (!tenant) {
        // No identity to scope to, and a private item with no scope must not
        // become a public one. 'orphan' can never collide with a real id, so
        // such an item is cached only against other orphans — effectively not
        // shared at all, which is the safe reading.
        return 'tenant:orphan';
      }
      return `tenant:${sha256Hex(tenant).slice(0, 16)}`;
    }
    case 'USER_PRIVATE': {
      const user = context.userId;
      if (!user) return 'user:orphan';
      return `user:${sha256Hex(user).slice(0, 16)}`;
    }
  }
}

export interface DocumentKeyInput {
  /** The URL as it will be fetched — canonicalized for identity only. */
  url: string;
  canonicalization: CanonicalizeOptions;
  /** research_providers.provider_code, or a source id for a free page. */
  provider: string;
  context: RequestContext;
  visibility: SourceVisibility;
  /** Anything else that changes what comes back (a language, a depth). */
  variant?: Record<string, string | number | boolean | null> | null;
}

/**
 * A fingerprint for one fetched document.
 *
 * Shaped `rc1:<32 hex>` so it is impossible to confuse with an existing bare
 * 64-hex fingerprint, by a human or by a query.
 */
export function documentFingerprint(input: DocumentKeyInput): string {
  const identity = canonicalizeUrl(input.url, input.canonicalization) ?? input.url;
  return fingerprint([
    'doc',
    input.provider,
    scopeToken(input.context, input.visibility),
    identity,
    variantToken(input.variant),
  ]);
}

export interface ProfileKeyInput {
  profileId: string;
  /** The normalized subject — a cadastral code, a project id, a URL. */
  subject: string;
  provider: string;
  context: RequestContext;
  visibility: SourceVisibility;
  variant?: Record<string, string | number | boolean | null> | null;
}

/** A fingerprint for a whole profile run over one subject. */
export function profileFingerprint(input: ProfileKeyInput): string {
  return fingerprint([
    'profile',
    input.profileId,
    input.provider,
    scopeToken(input.context, input.visibility),
    input.subject.trim().toLowerCase(),
    variantToken(input.variant),
  ]);
}

/**
 * The key concurrent callers coalesce on.
 *
 * Identical to the cache fingerprint on purpose. If the two could differ, a
 * hundred requests would coalesce onto one fetch and then miss the cache they
 * just populated — which is a coalescer that works exactly once.
 */
export function coalescingKey(fingerprintValue: string): string {
  return fingerprintValue;
}

function fingerprint(parts: readonly string[]): string {
  return `${KEY_VERSION}:${sha256Hex(parts.join('\u001f')).slice(0, 32)}`;
}

function variantToken(
  variant: Record<string, string | number | boolean | null> | null | undefined,
): string {
  if (!variant) return '';
  return Object.keys(variant)
    .sort()
    .map((key) => `${key}=${String(variant[key])}`)
    .join('&');
}

/**
 * True when a fingerprint was produced by this core.
 *
 * Lets a retention or invalidation job act on the core's entries without
 * touching the ones `homatch-research` owns.
 */
export function isResearchCoreFingerprint(value: string): boolean {
  return value.startsWith(`${KEY_VERSION}:`);
}
