// FIND BUYERS / FIND TENANTS — the customer's reads (own campaigns and leads,
// RLS-scoped) and the one action (translate), plus the admin control center.
// No provider name, Actor id, cost or token ever reaches the customer screens.
import { supabase } from '@/db/supabase';

export interface FindBuyersConfig { minUsd: number; creditsPerUsd: number; minCredits: number; languages: string[] }

export async function getFindBuyersConfig(): Promise<FindBuyersConfig | null> {
  const { data, error } = await supabase.rpc('find_buyers_public_config');
  if (error || !data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  return {
    minUsd: Number(d.minUsd ?? 10),
    creditsPerUsd: Number(d.creditsPerUsd ?? 10),
    minCredits: Number(d.minCredits ?? 100),
    languages: Array.isArray(d.languages) ? (d.languages as string[]) : ['ka', 'ru', 'en', 'ar', 'he', 'tr'],
  };
}

export interface LeadEvidence {
  signalId: string;
  parentSignalId: string | null;
  kind: 'POST' | 'COMMENT' | 'MESSAGE';
  source: string;
  intentClass: string;
  intentScore: number;
  similarity: number;
  ageDays: number | null;
  text: string;
  url: string | null;
  parentUrl: string | null;
  parentExcerpt: string | null;
  language: string | null;
  publishedAt: string | null;
}

export interface WhyMatched {
  kind: 'COMMENT_ON_SIMILAR' | 'REQUEST_POST' | 'COMMENT_REQUEST';
  bedrooms: number | null;
  propertyType: string | null;
  district: string | null;
  city: string | null;
  agreed: string[];
  parentAgeDays: number | null;
}

export interface PotentialLead {
  id: string;
  matching_job_id: string;
  counterpart: 'BUYER' | 'TENANT';
  source: string;
  intent_class: string;
  overall_score: number;
  strength: 'STRONG' | 'GOOD' | 'POSSIBLE';
  similarity: number | null;
  intent_score: number | null;
  score_components: { why?: WhyMatched | null } & Record<string, unknown>;
  evidence: LeadEvidence[];
  signal_count: number;
  signal_at: string | null;
  seen_before: boolean;
  language: string | null;
  created_at: string;
  author_name: string | null;
  author_profile_url: string | null;
}

/** Leads for one property, strongest first (RLS: the owner's own rows only). */
export async function getPropertyLeads(propertyId: string, limit = 60): Promise<PotentialLead[]> {
  const { data, error } = await supabase
    .from('find_buyers_leads')
    .select('id,matching_job_id,counterpart,source,intent_class,overall_score,strength,similarity,intent_score,score_components,evidence,signal_count,signal_at,seen_before,language,created_at,author_name,author_profile_url')
    .eq('property_id', propertyId)
    .order('overall_score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return ((data ?? []) as unknown as PotentialLead[]).map((l) => ({ ...l, evidence: Array.isArray(l.evidence) ? l.evidence : [] }));
}

export interface FindBuyersCampaignState {
  matching_job_id: string;
  transaction: 'SALE' | 'RENT';
  credits_committed: number;
  languages: string[];
  stats: {
    languagesSearched?: string[];
    sourcesExplored?: string[];
    sourcesProductive?: string[];
    signalsAnalyzed?: number;
    qualified?: number;
    strong?: number;
    duplicatesRemoved?: number;
  };
  finalized_at: string | null;
  last_activity_at: string | null;
  created_at: string;
}

export async function getCampaignState(matchingJobId: string): Promise<FindBuyersCampaignState | null> {
  const { data, error } = await supabase
    .from('find_buyers_campaigns')
    .select('matching_job_id,transaction,credits_committed,languages,stats,finalized_at,last_activity_at,created_at')
    .eq('matching_job_id', matchingJobId)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as FindBuyersCampaignState;
}

/** The latest campaign of this property (for a finished search's empty state). */
export async function getLatestCampaignState(propertyId: string): Promise<FindBuyersCampaignState | null> {
  const { data } = await supabase
    .from('find_buyers_campaigns')
    .select('matching_job_id,transaction,credits_committed,languages,stats,finalized_at,last_activity_at,created_at')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as unknown as FindBuyersCampaignState) ?? null;
}

export async function translateLeadSignal(
  propertyId: string, leadId: string, signalId: string, targetLang: string,
): Promise<{ ok: boolean; translation?: string; sourceLang?: string | null; error?: string }> {
  const { data, error } = await supabase.functions.invoke('match-campaign', {
    body: { propertyId, action: 'translate', leadId, signalId, targetLang },
  });
  if (error) return { ok: false, error: 'TRANSLATION_FAILED' };
  return data as { ok: boolean; translation?: string; sourceLang?: string | null; error?: string };
}

/* ── admin ─────────────────────────────────────────────────────────────── */

export interface FindBuyersCenter {
  generated_at: string;
  window_days: number;
  switches: Record<string, unknown>;
  overview: {
    campaigns: number; credits_committed: number; customer_value_micros: number; revenue_micros: number;
    provider_micros: number; ai_micros: number; translation_micros: number; other_micros: number;
    qualified_leads: number; strong_leads: number;
  };
  campaigns: Array<Record<string, any>>;
  actors: Array<Record<string, any>>;
  sources: Array<Record<string, any>>;
  languages: Array<{ lang: string; spend_micros: number; signals: number; qualified: number; strong: number }>;
  ledger: Array<Record<string, any>>;
}

export async function getFindBuyersCenter(days: number): Promise<FindBuyersCenter | null> {
  const { data, error } = await supabase.rpc('admin_find_buyers_center', { p_days: days });
  if (error) throw new Error(error.message);
  return (data ?? null) as FindBuyersCenter | null;
}

export async function updateActor(actorKey: string, patch: Record<string, unknown>) {
  const { data, error } = await supabase.rpc('admin_find_buyers_actor_update', { p_actor_key: actorKey, p_patch: patch });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; pricingReset?: boolean; error?: string };
}

export async function verifyActorFromApify(actorKey: string) {
  const { data, error } = await supabase.functions.invoke('discovery-queue-worker', { body: { mode: 'admin_actor_verify', actorKey } });
  if (error) throw new Error(error.message);
  return data as { success: boolean; error?: string; priced?: boolean; schemaProperties?: string[] };
}

export const FIND_BUYERS_SWITCHES = ['find_buyers_social_enabled'] as const;

export async function setFindBuyersSetting(key: string, value: unknown) {
  if (!key.startsWith('find_buyers_')) throw new Error('not a Find Buyers setting');
  const { error } = await supabase.from('admin_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
}

/** Integer microdollars → "$1.23" (display only; never arithmetic). */
export function usd(micros: number | null | undefined, digits = 2): string {
  if (micros == null || !Number.isFinite(Number(micros))) return '—';
  return `$${(Number(micros) / 1_000_000).toFixed(digits)}`;
}

/* ── the authoritative campaign lifecycle (find_buyers_campaign_status) ── */

export type CampaignLifecycleState =
  | 'PREPARING' | 'QUEUED' | 'SEARCHING' | 'PARTIAL_RESULTS' | 'PAUSING' | 'PAUSED'
  | 'COMPLETED_WITH_RESULTS' | 'COMPLETED_NO_RESULTS' | 'DEGRADED_COMPLETED' | 'FAILED' | 'UNAVAILABLE' | 'CANCELLED';

export interface SourceNode {
  source: string;
  state: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';
  total: number; running: number; queued: number; done: number; failed: number; results: number;
}

export interface CampaignLifecycle {
  jobId: string;
  campaignId: string | null;
  state: CampaignLifecycleState;
  stage: 'FINISHING' | null;
  active: boolean;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  pausedAt: string | null;
  lastActivityAt: string | null;
  transaction: 'SALE' | 'RENT' | null;
  languages: string[] | null;
  queue: { total: number; queued: number; running: number; done: number; failed: number; cancelled: number; paused: number };
  runs: { inFlight: number; succeeded: number; failed: number };
  sources: SourceNode[];
  signalsAnalyzed: number;
  staleSkipped: number;
  duplicatesRemoved: number;
  newResults: number;
  newLeads: number;
  newMatches: number;
  strong: number;
  executed: boolean;
  failureReason: string | null;
}

export interface SearchReadiness {
  ready: boolean;
  reason: 'DISCOVERY_SWITCHED_OFF' | 'NO_ELIGIBLE_SOURCE' | 'DISCOVERY_UNAVAILABLE' | null;
  sources: string[];
}

export interface CampaignStatus { readiness: SearchReadiness | null; campaign: CampaignLifecycle | null }

/** One server read: can a search run, and what the latest campaign is doing. */
export async function getCampaignStatus(propertyId: string): Promise<CampaignStatus | null> {
  const { data, error } = await supabase.rpc('find_buyers_campaign_status', { p_property_id: propertyId });
  if (error || !data || typeof data !== 'object') return null;
  const d = data as { readiness?: SearchReadiness | null; campaign?: CampaignLifecycle | null };
  return {
    readiness: d.readiness ?? null,
    campaign: d.campaign ? { ...d.campaign, sources: Array.isArray(d.campaign.sources) ? d.campaign.sources : [] } : null,
  };
}

/** One page of leads, strongest first, stable order (server-side range). */
export async function getPropertyLeadsPage(propertyId: string, page: number, pageSize: number): Promise<{ rows: PotentialLead[]; total: number }> {
  const from = Math.max(0, page - 1) * pageSize;
  const { data, error, count } = await supabase
    .from('find_buyers_leads')
    .select('id,matching_job_id,counterpart,source,intent_class,overall_score,strength,similarity,intent_score,score_components,evidence,signal_count,signal_at,seen_before,language,created_at,author_name,author_profile_url', { count: 'exact' })
    .eq('property_id', propertyId)
    .order('overall_score', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(from, from + pageSize - 1);
  if (error) return { rows: [], total: 0 };
  return {
    rows: ((data ?? []) as unknown as PotentialLead[]).map((l) => ({ ...l, evidence: Array.isArray(l.evidence) ? l.evidence : [] })),
    total: Number(count ?? 0),
  };
}
