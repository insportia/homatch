// The Admin Discovery Control Center's data: one admin-only RPC for every
// count and state, the discovery switches in admin_settings, and the two
// actions the discovery driver accepts from an admin session.
//
// Nothing here reads a token, a Telegram credential or message text: the RPC
// excludes *_token settings by name and returns counts, states and ids only.
import { supabase } from '@/db/supabase';

export interface DiscoveryOverview {
  generated_at: string;
  settings: Record<string, unknown>;
  telegram_health: {
    provider: string; status: string | null; last_tested_at: string | null; last_success_at: string | null;
    latency_ms: number | null; last_error: string | null; success_count: number; failure_count: number;
  } | null;
  targets: Array<{ lifecycle: string; readability: string; discovery_enabled: boolean; targets: number;
    items_read: number; demand_found: number; last_checked_at: string | null }>;
  queue: Array<{ provider: string; status: string; jobs: number; last_activity: string | null }>;
  labels_7d: Array<{ label: string; signals: number }>;
  pending_classification: number;
  current_demand: { d7: number; d14: number; d30: number };
  jobs: Array<{ id: string; property_id: string; status: string; progress: number; current_step: string | null;
    fresh_matches_created: number; failure_reason: string | null; started_at: string | null;
    completed_at: string | null; discovery_deadline_at: string | null; budget_credits: number | null;
    source_jobs: Record<string, number> }>;
}

export const DISCOVERY_SWITCHES = [
  'telegram_discovery_enabled',
  'campaign_source_discovery_enabled',
  'discovery_background_refresh_enabled',
  'forum_discovery_enabled',
  'forum_schedule_enabled',
  'classifier_schedule_enabled',
] as const;
export type DiscoverySwitch = typeof DISCOVERY_SWITCHES[number];

export async function getDiscoveryOverview(): Promise<DiscoveryOverview> {
  const { data, error } = await supabase.rpc('admin_discovery_overview');
  if (error) throw new Error(error.message);
  return data as DiscoveryOverview;
}

export async function setDiscoverySwitch(key: DiscoverySwitch, on: boolean): Promise<void> {
  const { error } = await supabase.from('admin_settings')
    .upsert({ key, value: on, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
}

async function driverAction(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('discovery-queue-worker', { body });
  if (error) throw new Error(error.message);
  if (data?.success === false) throw new Error(String(data?.error ?? 'refused'));
  return data;
}

/** Admin-only Telegram health check. Reads the worker's status and records it;
 *  collects nothing and never returns a credential. */
export const testTelegramHealth = () => driverAction({ mode: 'admin_telegram_health' }) as Promise<{ healthy: boolean; error: string | null }>;

/** Stop a running campaign; the server releases its whole reservation. */
export const stopCampaignJob = (jobId: string) => driverAction({ mode: 'admin_stop', jobId });
/** Re-queue a searching campaign's failed source jobs. */
export const retryCampaignSources = (jobId: string) => driverAction({ mode: 'admin_retry', jobId });

export const settingOn = (value: unknown) => value === true || value === 'true';

// ── PHASE 2: ADMIN INTELLIGENCE ──────────────────────────────────────────────

export interface DiscoveryIntelligence {
  generated_at: string;
  switches: Record<string, unknown>;
  runs: Array<{ id: string; user_id: string; status: string; stage: string; progress: number; results_found: number;
    credits_charged: number | null; provider_cost_usd: number | null; failure_reason: string | null;
    started_at: string; completed_at: string | null; elapsed_seconds: number; source_jobs: Record<string, number> | null }>;
  plans_7d: Record<string, number>;
  queue: Array<{ provider: string; executor: string; status: string; jobs: number; oldest_waiting: string | null;
    last_activity: string | null; expired_leases: number }>;
  live_checks: Array<{ source_key: string; route: string; market: string; checked_at: string; ok: boolean;
    http_status: number | null; latency_ms: number | null; collection_items: number | null;
    detail_ok: boolean | null; normalized_ok: boolean | null; limitation: string | null }>;
  supply_by_adapter: Array<{ adapter_id: string; observations: number; entities: number; new_7d: number;
    last_seen: string | null; valid: number; gone: number; avg_quality: number | null }>;
  entities: { total: number; multi_observation: number; multi_source: number; observations: number;
    resolved_observations: number;
    largest: Array<{ id: string; city: string | null; transaction: string | null; property_type: string | null;
      observation_count: number; source_count: number; min_price: number | null; max_price: number | null;
      price_currency: string | null; price_spread: number | null; last_seen_at: string | null }> };
  resolution_7d: Record<string, number>;
  matches: { external_listing: number; external_intelligence: number; internal_homatch: number; demand_matches_30d: number };
  community_supply: { listing_posts: number; stored_as_supply: number };
}

export async function getDiscoveryIntelligence(): Promise<DiscoveryIntelligence> {
  const { data, error } = await supabase.rpc('admin_discovery_intelligence');
  if (error) throw new Error(error.message);
  return data as DiscoveryIntelligence;
}

export const PHASE2_SWITCHES = ['find_property_discovery_enabled', 'discovery_worker_route_enabled'] as const;
export type Phase2Switch = typeof PHASE2_SWITCHES[number];

export async function setPhase2Switch(key: Phase2Switch, on: boolean): Promise<void> {
  const { error } = await supabase.from('admin_settings')
    .upsert({ key, value: on, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
}

/** Bounded live checks of the priority sources, on every configured route. */
export const runSourceLiveChecks = () =>
  driverAction({ mode: 'admin_live_check' }) as Promise<{ checks: number; routes: string[] }>;
