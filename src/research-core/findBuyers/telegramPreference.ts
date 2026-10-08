// FIND BUYERS — how the free and the paid Telegram paths share a search.
//
// COMBINED (default; owner decision 2026-10-08): both are used. The free
// HOMATCH Telegram reader reads the communities it has switched on; the memo23
// Telegram Actor reads the channels the free reader does NOT cover — found
// and verified by Phase 1 but not switched on, discovered but not yet
// audited, or not readable by the free client — for this campaign's city.
// A channel is never read by both, so no search, lead or dollar is spent twice.
// Paid runs go through the same atomic reservation as every memo23 run
// (campaign hard cap, per-Actor and daily caps, global concurrency).
// NATIVE_FIRST (admin setting): paid Telegram only when the free reader is
// not collecting at all.
// PAID_FIRST (admin setting): the memo23 Actor reads the known channels first
// and the free reader is skipped for that search when paid jobs were queued.
// The free community discovery (TELEGRAM_SOURCES) always runs in Phase 1.

import { communityFitFor } from '../discovery/sourceNetwork.ts';

export type TelegramPreference = 'COMBINED' | 'PAID_FIRST' | 'NATIVE_FIRST';

export function parseTelegramPreference(value: unknown): TelegramPreference {
  const v = typeof value === 'string' ? value.replace(/^"|"$/g, '').trim().toUpperCase() : '';
  if (v === 'PAID_FIRST') return 'PAID_FIRST';
  if (v === 'NATIVE_FIRST') return 'NATIVE_FIRST';
  return 'COMBINED';
}

/** Plan the memo23 Telegram Actor on known channels AT LAUNCH? (COMBINED adds the uncovered ones after Phase 1.) */
export function planPaidTelegram(pref: TelegramPreference, nativeTelegramActive: boolean): boolean {
  return pref === 'PAID_FIRST' || !nativeTelegramActive;
}

/** The native plan without the free Telegram READER (community discovery stays). */
export function withoutNativeTelegramReader<P extends { tranches: Array<{ providers: string[] }> }>(plan: P): P {
  return { ...plan, tranches: plan.tranches.map((t) => ({ ...t, providers: t.providers.filter((p) => p !== 'TELEGRAM') })) };
}

export interface TelegramCommunity {
  id: string;
  external_id: string;
  name?: string | null;
  lifecycle: string;
  readability?: string | null;
  discovery_enabled: boolean;
  last_error_code?: string | null;
  relevance_score?: number | string | null;
  source_registry_id?: string | null;
  languages?: string[] | null;
  metadata?: Record<string, unknown> | null;
}

/** The free reader covers a community it has switched on and can read. */
export function nativeCovers(c: TelegramCommunity): boolean {
  if (!c.discovery_enabled || ['BLOCKED', 'RETIRED'].includes(c.lifecycle)) return false;
  return c.readability !== 'API_UNAVAILABLE' && c.readability !== 'PRIVATE';
}

/**
 * The channels the paid Actor reads in a COMBINED search: not covered by the
 * free reader, public, not judged low-signal or dead, about this campaign's
 * city or country-wide. Verified (audited) first, then the most relevant,
 * then the not-yet-audited (a paid probe of 30 messages also verifies them).
 */
export function paidTelegramChannels(communities: readonly TelegramCommunity[], campaignCity: string | null | undefined, limit: number): TelegramCommunity[] {
  const usable = communities.filter((c) => /^[A-Za-z0-9_]{4,64}$/.test(c.external_id)
    && !nativeCovers(c)
    && ['DISCOVERED', 'AUDITED', 'REACHABLE', 'PRODUCTIVE'].includes(c.lifecycle)
    && c.readability !== 'PRIVATE'
    && !(c.readability === 'API_UNAVAILABLE' && c.last_error_code !== 'CAPABILITY_NOT_SUPPORTED'));
  const fit = usable.map((c) => ({ c, fit: communityFitFor(c, campaignCity) })).filter((x) => x.fit !== 'OTHER');
  const verified = (c: TelegramCommunity) => (c.lifecycle === 'DISCOVERED' ? 1 : 0);
  return fit
    .sort((a, b) => (a.fit === 'MATCH' ? 0 : 1) - (b.fit === 'MATCH' ? 0 : 1)
      || verified(a.c) - verified(b.c)
      || Number(b.c.relevance_score ?? 0) - Number(a.c.relevance_score ?? 0))
    .slice(0, Math.max(0, limit))
    .map((x) => x.c);
}
