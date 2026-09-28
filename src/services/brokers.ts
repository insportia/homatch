// Broker platform client services.
//
// Two identities, never blurred (see research-core/match/broker-identity.ts):
// the PUBLIC DIRECTORY (registered, reviewed, currently paid) is read through
// broker_directory_public; the private FOUND-FOR-YOU library is read through
// list_my_discovered_brokers, which scopes to auth.uid() server-side so no id
// can be manipulated into someone else's discoveries.
//
// No price lives here. broker_discovery_pricing() reads the catalogue row the
// admin controls, and everything money-shaped happens server-side.

import { supabase } from '@/db/supabase';

export interface DiscoveredBroker {
  id: string;
  broker_id: string;
  role: 'AGENCY' | 'BROKER';
  display_name: string | null;
  key_kind: string;
  country_code: string;
  cities: string[];
  languages: string[];
  deal_kinds: string[];
  first_seen_at: string;
  last_seen_at: string;
  validation_state: string;
  observation_count: number;
  source_count: number;
  first_intent: 'SELL' | 'RENT_OUT' | 'BUY' | 'RENT' | null;
  first_campaign_id: string | null;
  context: Record<string, unknown> | null;
  discovered_at: string;
}

export async function listMyDiscoveredBrokers(limit = 200): Promise<DiscoveredBroker[]> {
  const { data, error } = await supabase.rpc('list_my_discovered_brokers', { p_limit: limit });
  if (error) throw new Error(error.message);
  return (data ?? []) as DiscoveredBroker[];
}

export interface BrokerDiscoveryPricing {
  active: boolean;
  charging: boolean;
  unitCredits: number;
  listingPriceCredits: number | null;
  listingDurationDays: number | null;
}

/** The one price source: the admin-controlled catalogue, read server-side. */
export async function brokerDiscoveryPricing(): Promise<BrokerDiscoveryPricing | null> {
  const { data, error } = await supabase.rpc('broker_discovery_pricing');
  if (error || !data) return null;
  const raw = data as Record<string, unknown>;
  return {
    active: raw.active === true,
    charging: raw.charging === true,
    unitCredits: Number(raw.unitCredits ?? 0),
    listingPriceCredits: raw.listingPriceCredits === null ? null : Number(raw.listingPriceCredits),
    listingDurationDays: raw.listingDurationDays === null ? null : Number(raw.listingDurationDays),
  };
}

export type BrokerProfileEvent =
  | 'IMPRESSION' | 'PROFILE_OPEN' | 'PHONE_CLICK' | 'EMAIL_CLICK'
  | 'WHATSAPP_CLICK' | 'WEBSITE_CLICK' | 'MESSAGE_CLICK';

/** A stable, anonymous per-browser key used only to deduplicate events. */
function viewerKey(): string {
  try {
    const stored = window.localStorage.getItem('hm_bpe_key');
    if (stored) return stored;
    const fresh = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    window.localStorage.setItem('hm_bpe_key', fresh);
    return fresh;
  } catch {
    return 'anon';
  }
}

/**
 * Record what actually happened, named as what was measured: a PHONE_CLICK is
 * a click on a phone link, never a completed call. Server-side dedup absorbs
 * rerenders; failures are swallowed because analytics must never break a page.
 */
export function recordBrokerProfileEvent(
  listingId: string,
  event: BrokerProfileEvent,
  surface: string,
): void {
  void supabase.rpc('record_broker_profile_event', {
    p_listing_id: listingId,
    p_event: event,
    p_surface: surface,
    p_viewer_key: viewerKey(),
  }).then(({ error }) => {
    if (error) console.warn('broker event not recorded:', error.message);
  });
}

export interface BrokerEventStats {
  days: number;
  totals: Partial<Record<BrokerProfileEvent, number>>;
  daily: Array<{ day: string; views: number; contacts: number }>;
}

export async function brokerProfileEventStats(listingId: string, days = 30): Promise<BrokerEventStats | null> {
  const { data, error } = await supabase.rpc('broker_profile_event_stats', {
    p_listing_id: listingId,
    p_days: days,
  });
  if (error || !data) return null;
  return data as unknown as BrokerEventStats;
}
