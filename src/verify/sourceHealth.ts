// HOMATCH VERIFY — what the market lane learned about its sources.
//
// The Source Registry is the research system's memory: which sources exist,
// how they are reached, when each last worked, and — the part that actually
// changes behaviour later — how much of what they returned was any use.
//
// Without this the lane is amnesiac. Every run treats a portal that has
// answered a hundred times and a portal that has never answered as equally
// promising, and a source that has started refusing is rediscovered as a
// surprise on every single verification.
//
// WHAT IS RECORDED, AND WHAT IS NOT
//
// One row per PORTAL, keyed on its canonical origin — not one row per search
// and never one row per listing. A search is an event; a source is a thing
// with a history.
//
// `scanned` is how many adverts were read. `useful` is how many distinct
// properties those adverts turned out to describe. Keeping them apart is what
// makes the productivity figure mean something: a portal that returns forty
// adverts for six flats is not four times better than one that returns ten
// adverts for six flats, and one number cannot say that.
//
// NOTHING IS INVENTED. A portal that was never reached produces no row, and a
// portal that failed records the failure rather than a zero — "we did not ask"
// and "we asked and got nothing" are different facts about a source.

import type { MarketEvidence, PortalOutcome } from '../research-core/market/comparables.ts';

/** The access states the registry's own CHECK constraint accepts. */
export type RegistryAccessState =
  | 'PUBLIC'
  | 'AUTHENTICATED_ACCESS'
  | 'JOIN_REQUIRED'
  | 'INACCESSIBLE'
  | 'DEGRADED';

export interface SourceHealthUpdate {
  /** Canonical origin. The identity of the source, not of a search. */
  url: string;
  /** signal_platform enum. A property portal is a WEBSITE. */
  platform: 'WEBSITE';
  /** source_type enum. */
  sourceType: 'WEBSITE';
  name: string;
  countryCode: string;
  accessState: RegistryAccessState;
  /** Adverts read this run. Never a listing count. */
  scanned: number;
  /** Distinct properties those adverts described. */
  useful: number;
  /** True when the portal answered at all. */
  succeeded: boolean;
  /** Machine-readable, short. Null when nothing failed. */
  failureReason: string | null;
}

/**
 * How a portal outcome maps onto the registry's access vocabulary.
 *
 * DEGRADED rather than INACCESSIBLE for a transient refusal: a rate limit or
 * a one-off network error is a source having a bad minute, and permanently
 * marking it unreachable would retire a working portal over a blip. Only a
 * flat refusal is INACCESSIBLE, and a login or join wall keeps its own state
 * because the answer to those is a human decision, never a retry.
 */
export function accessStateFor(outcome: PortalOutcome): RegistryAccessState {
  switch (outcome.state) {
    case 'OK':
    case 'PARTIAL':
      return 'PUBLIC';
    case 'LOGIN_WALL':
      return 'AUTHENTICATED_ACCESS';
    case 'JOIN_REQUIRED':
      return 'JOIN_REQUIRED';
    case 'BLOCKED':
      return 'INACCESSIBLE';
    default:
      return 'DEGRADED';
  }
}

const ORIGIN_OF = (urlish: string): string | null => {
  try {
    return new URL(urlish).origin;
  } catch {
    return null;
  }
};

/**
 * Turn one lane run into at most one update per portal.
 *
 * `useful` is apportioned to the portal that supplied each primary advert, so
 * a property found by two portals credits the one whose advert was kept as
 * the primary. Anything else would let one flat make two sources look
 * productive.
 */
export function portalHealthUpdates(evidence: MarketEvidence): SourceHealthUpdate[] {
  const usefulByFamily = new Map<string, number>();
  for (const property of evidence.uniqueProperties) {
    const family = property.primary.sourceFamily;
    usefulByFamily.set(family, (usefulByFamily.get(family) ?? 0) + 1);
  }

  const originByFamily = new Map<string, string>();
  for (const advert of evidence.advertisements) {
    if (originByFamily.has(advert.sourceFamily)) continue;
    const origin = ORIGIN_OF(advert.url);
    if (origin) originByFamily.set(advert.sourceFamily, origin);
  }

  const updates: SourceHealthUpdate[] = [];
  for (const outcome of evidence.portals) {
    // A portal we never actually reached leaves no trace. "Not asked" is not
    // a fact about the source.
    if (outcome.state === 'NOT_SUPPORTED' || outcome.state === 'DEADLINE') continue;

    const origin = originByFamily.get(outcome.sourceFamily) ?? `https://${outcome.sourceFamily}`;
    const succeeded = outcome.state === 'OK' || outcome.state === 'PARTIAL';
    updates.push({
      url: origin,
      platform: 'WEBSITE',
      sourceType: 'WEBSITE',
      name: outcome.sourceFamily,
      countryCode: 'GE',
      accessState: accessStateFor(outcome),
      scanned: outcome.listingsFound,
      useful: succeeded ? (usefulByFamily.get(outcome.sourceFamily) ?? 0) : 0,
      succeeded,
      failureReason: succeeded ? null : `${outcome.state}${outcome.detail ? `: ${outcome.detail.slice(0, 120)}` : ''}`,
    });
  }

  // One row per portal even if it answered several envelopes this run.
  const byUrl = new Map<string, SourceHealthUpdate>();
  for (const update of updates) {
    const existing = byUrl.get(update.url);
    if (!existing) {
      byUrl.set(update.url, update);
      continue;
    }
    existing.scanned += update.scanned;
    existing.useful += update.useful;
    existing.succeeded = existing.succeeded || update.succeeded;
    if (!existing.succeeded && update.failureReason) existing.failureReason = update.failureReason;
    if (update.succeeded) {
      existing.accessState = update.accessState;
      existing.failureReason = null;
    }
  }
  return [...byUrl.values()];
}

/**
 * The row shape the registry stores, given what it already holds.
 *
 * Counters ACCUMULATE — the registry's value is the history, not the last
 * run — and the timestamps only move forward on the events they name:
 * `last_successful_at` on a success, `last_useful_at` only when the source
 * actually produced something usable. A source that answered with nothing is
 * reachable and unproductive, and the two columns say so separately.
 */
export function mergeSourceRow(
  existing: Record<string, any> | null,
  update: SourceHealthUpdate,
  nowIso: string,
): Record<string, unknown> {
  const prevScanned = Number(existing?.scanned_signal_count ?? 0) || 0;
  const prevUseful = Number(existing?.useful_signal_count ?? 0) || 0;
  const prevFailures = Number(existing?.failure_count ?? 0) || 0;

  return {
    platform: update.platform,
    source_type: update.sourceType,
    url: update.url,
    name: existing?.name ?? update.name,
    country_code: existing?.country_code ?? update.countryCode,
    active: true,
    access_state: update.accessState,
    scanned_signal_count: prevScanned + update.scanned,
    useful_signal_count: prevUseful + update.useful,
    failure_count: update.succeeded ? prevFailures : prevFailures + 1,
    last_collected_at: nowIso,
    last_successful_at: update.succeeded ? nowIso : (existing?.last_successful_at ?? null),
    last_useful_at: update.useful > 0 ? nowIso : (existing?.last_useful_at ?? null),
    last_failure_reason: update.succeeded ? null : update.failureReason,
    updated_at: nowIso,
  };
}
