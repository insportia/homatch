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

/** Stop a running campaign; the server releases its whole reservation. */
export const stopCampaignJob = (jobId: string) => driverAction({ mode: 'admin_stop', jobId });
/** Re-queue a searching campaign's failed source jobs. */
export const retryCampaignSources = (jobId: string) => driverAction({ mode: 'admin_retry', jobId });

export const settingOn = (value: unknown) => value === true || value === 'true';
