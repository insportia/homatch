// FIND BUYERS / FIND TENANTS — can a search execute anything right now?
//
// A paid campaign may only start when at least one executable discovery path
// exists: the social switch on, the provider credential present and at least
// one eligible memo23 Actor (enabled, price verified recently), or native
// source discovery (Telegram / forums) switched on. Otherwise the launch is
// refused BEFORE any credit is reserved — a customer never pays for a search
// that could not search. The database mirror is find_buyers_readiness().

export type ReadinessReason =
  | 'DISCOVERY_SWITCHED_OFF'
  | 'NO_ELIGIBLE_SOURCE'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'DISCOVERY_UNAVAILABLE';

export interface ReadinessInput {
  socialEnabled: boolean;
  providerConfigured: boolean;
  eligibleActors: number;
  nativeSourceDiscoveryEnabled: boolean;
  telegramEnabled: boolean;
  forumEnabled: boolean;
}

export interface Readiness {
  ready: boolean;
  social: boolean;
  native: boolean;
  reason: ReadinessReason | null;
}

export function decideReadiness(i: ReadinessInput): Readiness {
  const social = i.socialEnabled && i.providerConfigured && i.eligibleActors > 0;
  const native = i.nativeSourceDiscoveryEnabled && (i.telegramEnabled || i.forumEnabled);
  const ready = social || native;
  let reason: ReadinessReason | null = null;
  if (!ready) {
    if (!i.socialEnabled && !i.nativeSourceDiscoveryEnabled) reason = 'DISCOVERY_SWITCHED_OFF';
    else if (i.socialEnabled && !i.providerConfigured) reason = 'PROVIDER_NOT_CONFIGURED';
    else if (i.socialEnabled && i.eligibleActors === 0) reason = 'NO_ELIGIBLE_SOURCE';
    else reason = 'DISCOVERY_UNAVAILABLE';
  }
  return { ready, social, native, reason };
}

/**
 * After planning: did the campaign get any executable work? A campaign that
 * queued nothing external and found nothing internally is UNAVAILABLE (its
 * reservation is released), never "completed with 0 results".
 */
export function outcomeWithoutExternalWork(freshFromInternal: number): 'UNAVAILABLE' | 'INTERNAL_RESULTS' {
  return freshFromInternal > 0 ? 'INTERNAL_RESULTS' : 'UNAVAILABLE';
}
