// META ADS — client data layer. Drafts and creatives move through RLS;
// everything that touches Meta or money goes through the meta-ads-api
// edge function. Nothing in this file talks to Meta directly.
import { supabase } from '@/db/supabase';

const FN = 'meta-ads-api';

async function call<T = Record<string, unknown>>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke(FN, { body: { action, ...payload } });
  if (error) {
    // supabase-js wraps non-2xx; surface the function's own error body.
    const ctx = (error as { context?: Response }).context;
    if (ctx) {
      const body = await ctx.json().catch(() => null);
      if (body?.error) throw Object.assign(new Error(String(body.error)), { code: body.code, body });
    }
    throw error;
  }
  if ((data as { error?: string })?.error) {
    throw Object.assign(new Error(String((data as { error: string }).error)), { body: data });
  }
  return data as T;
}

/* ── STATUS / CONNECTION ────────────────────────────────────────────── */

export type MetaAssetKind = 'BUSINESS' | 'PAGE' | 'INSTAGRAM' | 'AD_ACCOUNT' | 'PIXEL' | 'LEAD_FORM' | 'WHATSAPP';
export interface MetaAsset {
  id: string; kind: MetaAssetKind;
  external_id: string; name: string | null; selected: boolean; status: string;
  parent_external_id?: string | null;
  /** Account status, currency, pixel last-fired time, form fields — never a token. */
  capabilities?: Record<string, unknown>;
}
/** One customer-facing connection state, derived server-side. */
export type MetaConnectionHealth =
  | 'NOT_CONNECTED' | 'CONNECTING' | 'CONNECTED' | 'PERMISSION_MISSING' | 'NO_ELIGIBLE_AD_ACCOUNT'
  | 'TOKEN_EXPIRED' | 'REVOKED' | 'RECONNECT_REQUIRED' | 'ERROR';
export interface MetaWallet {
  available_cents: number; reserved_cents: number; spent_cents: number;
  fees_cents: number; deposited_cents: number; currency: string;
}
export interface ServiceBalanceRow {
  currency: string; available_cents: number; deposited_cents: number;
  reserved_service_cents: number; consumed_service_cents: number; released_cents: number;
}
export interface GuardAccountRow { ad_account_external_id: string; status: 'ACTIVE' | 'WATCH' | 'SUSPENDED'; active_strikes: number; active_warnings: number; suspended_at: string | null }
export interface MetaStatus {
  mode: 'REAL' | 'MOCK';
  /** DEPOSIT / AVAILABLE / RESERVED / CONSUMED / RELEASED, per currency. */
  serviceBalance?: ServiceBalanceRow[];
  guard?: { accounts: GuardAccountRow[]; maxStrikes: number; enabled: boolean };
  connection: {
    status: string; health?: MetaConnectionHealth; granted_scopes?: string[]; missing_scopes?: string[]; error_reason?: string | null;
    /** Instant Forms' extra permissions granted (goal LEADS_ON_META). */
    instant_forms_available?: boolean;
    /** AVAILABLE / RECONNECT / COMING_SOON / DISABLED (src/lib/metaAds/instantForms.ts). */
    instant_forms?: 'AVAILABLE' | 'RECONNECT' | 'COMING_SOON' | 'DISABLED';
    token_expires_at?: string | null; last_checked_at?: string | null;
  };
  assets: MetaAsset[];
  wallet: MetaWallet;
  settings: {
    /** This customer's effective service-fee percent (admin policy over the standard). */
    feePercent: number; standardFeePercent?: number; minDurationDays: number; minDailyCents: number; maxDailyCents: number;
    goalsEnabled: string[]; leadImportEnabled: boolean; audienceCreationEnabled: boolean;
    retargetingEnabled: boolean; aiAssistEnabled: boolean; publishingEnabled: boolean;
    whatsappEnabled?: boolean; countries?: string[];
    /** Who pays Meta for the ad budget. Absent from an older server = the customer's ad account. */
    budgetBilling?: 'CUSTOMER_AD_ACCOUNT' | 'HOMATCH_WALLET';
  };
}
export const getMetaStatus = () => call<MetaStatus>('status');
export const startMetaOAuth = () => call<{ url?: string; mockConnect?: boolean; mode: string }>('oauth_start');
export const mockConnect = () => call('oauth_mock_connect');
export const refreshMetaAssets = () => call('assets_refresh');
export const selectMetaAsset = (kind: string, assetId: string) =>
  call<{ ok: boolean; leadgenSubscribed: boolean | null }>('select_asset', { kind, assetId });
export const disconnectMeta = () => call('disconnect');
export const createLeadForm = (input: {
  name: string; privacyPolicyUrl: string; fields: Array<'FULL_NAME' | 'EMAIL' | 'PHONE'>; locale?: string;
}) => call<{ form: { id: string; external_id: string; name: string }; mode: string }>('create_lead_form', input);

/* ── CAMPAIGNS (drafts through RLS) ─────────────────────────────────── */

export interface MetaCampaignRow {
  id: string; name: string; property_id: string | null; offer: Record<string, unknown> | null;
  goal: string; status: string; daily_budget_cents: number | null; duration_days: number | null;
  currency: string;
  destination: {
    type: string; url?: string; formId?: string | null; messagingApp?: 'MESSENGER' | 'INSTAGRAM_DIRECT' | 'WHATSAPP' | null;
  } | null;
  audience_id: string | null;
  placements: { mode: string; list?: string[] };
  preflight: PreflightResult | null;
  external_status: string | null; external_campaign_id?: string | null; spend_cents: number; results: Record<string, unknown> | null;
  special_ad_categories: string[]; last_error: { key?: string; code?: string; detail?: string; review?: unknown } | null;
  launched_at?: string | null; settled_at?: string | null; last_synced_at?: string | null;
  /** Where / ages / gender (targeting.ts TargetingIntent). Locked after launch. */
  targeting?: TargetingIntentRow | null;
  ended_at?: string | null; fee_percent?: number | null;
  guard_state?: 'OK' | 'NEEDS_REVIEW' | 'LOCKED_FOR_REVIEW';
  health?: Record<string, { state: string; code: string }> | null;
  created_at: string; updated_at: string;
}

export interface LocationChoiceRow { type: 'country' | 'region' | 'city'; key: string; name: string; countryCode: string; radiusKm?: number }
export interface TargetingIntentRow { locations: LocationChoiceRow[]; ageMin: number; ageMax: number; gender: 'ALL' | 'MALE' | 'FEMALE' }

export type PreflightState = 'READY' | 'WARNING' | 'ACTION_REQUIRED';
export interface PreflightCheck { key: string; state?: PreflightState; ok: boolean; detail?: string }
export interface PreflightResult {
  status: string; checks: PreflightCheck[]; warnings?: number; checked_at?: string;
  totals?: { mediaCents: number; feeCents: number; totalCents: number; feePercent: number } | null;
}

/** Statuses in which a campaign is still a draft the customer is building. */
export const EDITABLE_STATUSES = ['DRAFT', 'CONNECTION_REQUIRED', 'CREATIVE_REQUIRED', 'AUDIENCE_REQUIRED',
  'PREFLIGHT_REQUIRED', 'NEEDS_CHANGES', 'READY', 'PAYMENT_REQUIRED', 'FAILED'];

/**
 * The customer's most recent unfinished draft, so opening the builder again —
 * after a refresh, a back button, a Facebook login round-trip — continues it
 * instead of inserting another empty row.
 */
export async function latestOpenDraft(): Promise<MetaCampaignRow | null> {
  const { data } = await supabase.from('meta_campaigns').select('*')
    .in('status', EDITABLE_STATUSES).is('external_campaign_id', null)
    .gte('updated_at', new Date(Date.now() - 30 * 86_400_000).toISOString())
    .order('updated_at', { ascending: false }).limit(1).maybeSingle();
  return (data as MetaCampaignRow) ?? null;
}

export async function listMetaCampaigns(): Promise<MetaCampaignRow[]> {
  const { data, error } = await supabase.from('meta_campaigns').select('*')
    .neq('status', 'ARCHIVED').order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []) as MetaCampaignRow[];
}

export async function getMetaCampaign(id: string): Promise<MetaCampaignRow | null> {
  const { data } = await supabase.from('meta_campaigns').select('*').eq('id', id).maybeSingle();
  return (data as MetaCampaignRow) ?? null;
}

export async function createMetaDraft(userId: string, init: Partial<MetaCampaignRow>): Promise<MetaCampaignRow> {
  const { data, error } = await supabase.from('meta_campaigns').insert({
    user_id: userId, status: 'DRAFT',
    goal: init.goal ?? 'LEADS_ON_META',
    name: init.name ?? '', property_id: init.property_id ?? null, offer: init.offer ?? null,
    daily_budget_cents: init.daily_budget_cents ?? 500, duration_days: init.duration_days ?? 7,
    destination: init.destination ?? null, placements: init.placements ?? { mode: 'RECOMMENDED' },
  }).select('*').single();
  if (error) throw error;
  return data as MetaCampaignRow;
}

/** Rename a campaign in HOMATCH (display name only; Meta's name is unchanged). */
export const renameCampaign = (campaignId: string, name: string) => call<{ ok: boolean; name: string }>('campaign_rename', { campaignId, name });

export async function updateMetaDraft(id: string, patch: Partial<MetaCampaignRow>): Promise<void> {
  const { error } = await supabase.from('meta_campaigns').update(patch).eq('id', id);
  if (error) throw error;
}

export interface PlanPreview {
  issues: Array<{ code: string; field?: string }>;
  totals: { mediaCents: number; feeCents: number; totalCents: number; feePercent: number };
  requirements?: string[];
  recommendedPlacements?: string[];
  goalSpec?: { objective: string; optimizationGoal: string; needsPixel: boolean; pixelEvent: string | null; needsLeadForm: boolean; allowedCtas: string[]; defaultCta: string };
  summary: { adSetCount: number; creativeCount: number; specialAdCategories: string[]; placementsMode?: string; objective?: string } | null;
  feePercent?: number;
  strategy?: StrategySummaryRow | null;
}
export const planPreview = (campaignId: string) => call<PlanPreview>('plan_preview', { campaignId });
export const runPreflight = (campaignId: string) => call<PreflightResult>('preflight', { campaignId });
export const launchCampaign = (campaignId: string, idempotencyKey: string) =>
  call<{ ok: boolean; status: string; mode: string; externalCampaignId?: string }>('launch', { campaignId, idempotencyKey });

export type AiCopyOp = 'GENERATE' | 'IMPROVE' | 'SHORTEN' | 'PROFESSIONAL' | 'ALTERNATIVES' | 'TRANSLATE';
export interface AiCopyVariant { primaryText: string; headline: string; description: string }
/** Suggestions only: nothing is saved until the customer accepts one. */
export const aiCopy = (campaignId: string, op: AiCopyOp, language: string, current: Partial<AiCopyVariant>, notes = '') =>
  call<{ variants: AiCopyVariant[] }>('ai_copy', { campaignId, op, language, current, notes });
export const pauseCampaign = (campaignId: string) => call('pause', { campaignId });
export const resumeCampaign = (campaignId: string) => call('resume', { campaignId });
export const syncCampaign = (campaignId: string) =>
  call<{ results: Record<string, unknown> | null; external_status?: string }>('sync', { campaignId });

/* ── CREATIVES ──────────────────────────────────────────────────────── */

export interface MediaMeta {
  path: string; mime: string; size?: number; width?: number | null; height?: number | null; duration?: number | null;
}
export interface MetaCreativeRow {
  id: string; campaign_id: string | null; kind: 'IMAGE' | 'VIDEO' | 'CAROUSEL';
  media: MediaMeta[]; headline: string; primary_text: string; description?: string;
  cta: string; destination_url: string | null; safety_status: string; sort: number;
  safety?: { flags?: string[] } | null;
}

/** Width, height and duration read from the file itself, before upload. */
export async function readMediaFacts(file: File): Promise<{ width: number | null; height: number | null; duration: number | null }> {
  const url = URL.createObjectURL(file);
  try {
    if (file.type.startsWith('video')) {
      return await new Promise((resolve) => {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.onloadedmetadata = () => resolve({ width: v.videoWidth || null, height: v.videoHeight || null, duration: Number.isFinite(v.duration) ? v.duration : null });
        v.onerror = () => resolve({ width: null, height: null, duration: null });
        v.src = url;
      });
    }
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth || null, height: img.naturalHeight || null, duration: null });
      img.onerror = () => resolve({ width: null, height: null, duration: null });
      img.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export async function listCreatives(campaignId: string): Promise<MetaCreativeRow[]> {
  const { data } = await supabase.from('meta_creatives').select('*')
    .eq('campaign_id', campaignId).order('sort');
  return (data ?? []) as MetaCreativeRow[];
}

export async function addCreative(userId: string, campaignId: string, file: File, copy: {
  headline: string; primaryText: string; description?: string; cta?: string; destinationUrl?: string | null;
}, facts?: { width: number | null; height: number | null; duration: number | null }, sort = 0): Promise<MetaCreativeRow> {
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp'
    : file.type === 'video/quicktime' ? 'mov' : file.type.startsWith('video') ? 'mp4' : 'jpg';
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage.from('meta-ads-media')
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) throw upErr;
  const { data, error } = await supabase.from('meta_creatives').insert({
    user_id: userId, campaign_id: campaignId, sort,
    kind: file.type.startsWith('video') ? 'VIDEO' : 'IMAGE',
    media: [{ path, mime: file.type, size: file.size, width: facts?.width ?? null, height: facts?.height ?? null, duration: facts?.duration ?? null }],
    headline: copy.headline, primary_text: copy.primaryText, description: copy.description ?? '',
    cta: copy.cta ?? 'LEARN_MORE', destination_url: copy.destinationUrl ?? null,
  }).select('*').single();
  if (error) {
    // Never leave an orphaned file when the row could not be written.
    await supabase.storage.from('meta-ads-media').remove([path]).catch(() => undefined);
    throw error;
  }
  return data as MetaCreativeRow;
}

export async function updateCreative(id: string, patch: Partial<MetaCreativeRow>): Promise<void> {
  const { error } = await supabase.from('meta_creatives').update(patch).eq('id', id);
  if (error) throw error;
}

export async function removeCreative(id: string): Promise<void> {
  const { error } = await supabase.from('meta_creatives').delete().eq('id', id);
  if (error) throw error;
}

export async function creativeMediaUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('meta-ads-media').createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw (error ?? new Error('media'));
  return data.signedUrl;
}

/* ── LEADS ──────────────────────────────────────────────────────────── */

export interface MetaLeadRow {
  id: string; campaign_id: string | null; source: string; fields: Record<string, string | null>;
  status: string; note: string | null; received_at: string;
  /** Attribution: which ad / ad set / property brought this person. */
  ad_external_id?: string | null; adset_external_id?: string | null; property_id?: string | null;
  /** Qualifying answers from a HOMATCH premium form (buy_or_rent, budget, …). */
  answers?: Record<string, string> | null; meta_created_time?: string | null;
}
/** The Leads Center pipeline. */
export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'VIEWING', 'NEGOTIATING', 'WON', 'LOST'] as const;

export async function listMetaLeads(filter: { campaignId?: string; status?: string; search?: string } = {}): Promise<MetaLeadRow[]> {
  let q = supabase.from('meta_leads').select('*').order('received_at', { ascending: false }).limit(500);
  if (filter.campaignId) q = q.eq('campaign_id', filter.campaignId);
  if (filter.status) q = q.eq('status', filter.status);
  const { data, error } = await q;
  if (error) throw error;
  let rows = (data ?? []) as MetaLeadRow[];
  if (filter.search) {
    const s = filter.search.toLowerCase();
    rows = rows.filter(r => JSON.stringify(r.fields).toLowerCase().includes(s));
  }
  return rows;
}

export async function updateMetaLead(id: string, patch: { status?: string; note?: string }): Promise<void> {
  const { error } = await supabase.from('meta_leads').update(patch).eq('id', id);
  if (error) throw error;
}

export const exportLeadsCsv = (filter: { campaignId?: string; status?: string } = {}) =>
  call<{ csv: string; rows: number }>('leads_export', filter);

export const importLeads = (rows: Array<{ name?: string; email?: string; phone?: string }>, filename: string, consent: boolean) =>
  call<{ accepted: number; duplicates: number; invalid: number }>('lead_import', { rows, filename, consent });

/* ── AUDIENCES ──────────────────────────────────────────────────────── */

export interface MetaAudienceRow {
  id: string; name: string; source: string; known_record_count: number | null;
  sync_status: string; external_audience_id: string | null; created_at: string;
}

export async function listAudiences(): Promise<MetaAudienceRow[]> {
  const { data } = await supabase.from('meta_audiences').select('*')
    .neq('sync_status', 'DELETED').order('created_at', { ascending: false });
  return (data ?? []) as MetaAudienceRow[];
}

export const acceptAudienceTerms = () => call('audience_terms_accept');
export const createAudience = (name: string, source: string, campaignId?: string) =>
  call<{ audienceId: string; accepted: number; rejected: number }>('audience_create', { name, source, campaignId });

/* ── MONEY / MISC ───────────────────────────────────────────────────── */

export const depositCheckout = (amountCents: number) =>
  call<{ url: string }>('deposit_checkout', {
    amountCents,
    successUrl: `${window.location.origin}/outreach/meta?deposit=ok`,
    cancelUrl: `${window.location.origin}/outreach/meta?deposit=cancel`,
  });

export const trackFunnel = (event: string) => call('funnel', { event }).catch(() => ({}));

export async function listHelp(locale: string) {
  const { data } = await supabase.from('meta_help_content').select('*')
    .eq('locale', locale).eq('enabled', true).order('sort');
  return data ?? [];
}

export const money = (cents: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(cents / 100);

/* ── MASTER: strategy, write-through edits, intelligence, Guard ─────── */

export interface StrategySummaryRow {
  campaignCount: 1; adSetCount: number; adCount: number; testingCapacity: number;
  reasonCodes: string[]; confidence: 'HIGH' | 'MEDIUM'; recommendedCreativeCount: number;
  heldBackCreativeIds: string[]; targetingAdjustments: string[];
}
export type AdviceSeverity = 'INFO' | 'RECOMMENDATION' | 'WARNING' | 'BLOCKING_ERROR';
export interface AdviceItemRow { severity: AdviceSeverity; code: string; creativeId?: string; params?: Record<string, string | number> }
export interface FundingRow { plannedMediaCents: number; feePercent: number; requiredCents: number; availableCents: number; shortfallCents: number }
export interface StrategyPreview {
  issues: Array<{ code: string; field?: string }>;
  strategy: StrategySummaryRow | null;
  funding: FundingRow;
  advice: AdviceItemRow[];
  adSets: Array<{ key: string; dailyBudgetCents: number; creativeCount: number; segment: { kind: string; label: string } | null; placements: string[] | null }>;
  targeting: {
    effective: { ageMin: number; ageMax: number; gender: string };
    adjustments: string[];
    constraints: { ageLocked: boolean; genderLocked: boolean; minRadiusKm: number | null; detailedTargetingAllowed: boolean; reason: string | null };
    maxLocations: number;
  };
}
export const strategyPreview = (campaignId: string) => call<StrategyPreview>('strategy_preview', { campaignId });
export const geoSearch = (q: string, type: 'country' | 'region' | 'city', locale: string, country?: string) =>
  call<{ results: LocationChoiceRow[]; reason?: string }>('geo_search', { q, type, locale, country });

export interface PlanChangePreview {
  currentDailyCents: number; currentDays: number; newDailyCents: number; newDays: number; feePercent: number;
  heldFeeCents: number; requiredFeeCents: number; additionalCents: number; releaseCents: number;
  availableCents: number; shortfallCents: number; minDays: number;
}
export const previewBudget = (campaignId: string, dailyBudgetCents: number) =>
  call<{ preview: PlanChangePreview }>('edit_budget', { campaignId, dailyBudgetCents, commit: false });
export const commitBudget = (campaignId: string, dailyBudgetCents: number, idempotencyKey: string) =>
  call<{ ok: boolean; preview: PlanChangePreview }>('edit_budget', { campaignId, dailyBudgetCents, commit: true, idempotencyKey });
export const previewDuration = (campaignId: string, durationDays: number) =>
  call<{ preview: PlanChangePreview }>('edit_duration', { campaignId, durationDays, commit: false });
export const commitDuration = (campaignId: string, durationDays: number, idempotencyKey: string) =>
  call<{ ok: boolean; preview: PlanChangePreview }>('edit_duration', { campaignId, durationDays, commit: true, idempotencyKey });
/** Write-through: resolves only after Meta confirmed the change. */
export const pauseCampaignConfirmed = (campaignId: string, idempotencyKey: string) => call<{ status: string }>('pause', { campaignId, idempotencyKey });
export const resumeCampaignConfirmed = (campaignId: string, idempotencyKey: string) => call<{ status: string }>('resume', { campaignId, idempotencyKey });
export const endCampaign = (campaignId: string, idempotencyKey: string) => call<{ status: string; endedAt?: string }>('end', { campaignId, idempotencyKey });

export type RecommendationAct = 'APPLY' | 'DISMISS' | 'REMIND';
export const actOnRecommendation = (id: string, act: RecommendationAct, idempotencyKey?: string, days?: number) =>
  call<{ ok: boolean; status: string }>('recommendation_act', { id, act, idempotencyKey, days });

export interface MetricTotalsRow {
  currency: string; spendMinor: number; impressions: number; reach: number | null; clicks: number; linkClicks: number;
  landingPageViews: number; leads: number; messages: number; registrations: number; postEngagements: number;
}
export interface KpisRow {
  spendMinor: number; results: number; costPerResultMinor: number | null; ctr: number | null; cpcMinor: number | null; cpmMinor: number | null;
  frequency: number | null; cplMinor: number | null; resultRate: number | null; cpqlMinor: number | null; qualificationRate: number | null;
  costPerViewingMinor: number | null; leadToViewingRate: number | null;
}
export type HealthStateRow = 'HEALTHY' | 'WATCH' | 'ACTION_RECOMMENDED' | 'INSUFFICIENT_DATA' | 'STATE';
export interface RecommendationRow {
  id: string; type: string; affected: string; metric: string; baseline: number | null; candidate: number | null;
  confidence: 'INSUFFICIENT_DATA' | 'EARLY_SIGNAL' | 'MEANINGFUL_SIGNAL' | 'HIGH_CONFIDENCE';
  reason_codes: string[]; actionable: boolean; proposed: { dailyBudgetCents?: number } | null;
  status: 'OPEN' | 'APPLIED' | 'DISMISSED' | 'SNOOZED' | 'EXPIRED'; snooze_until: string | null; outcome: string | null;
  created_at: string; acted_at: string | null; window_current: string;
}
export interface CampaignDetail {
  campaign: MetaCampaignRow & { summary?: { facts: Array<{ code: string; params: Record<string, string | number | null>; confidence?: string }>; evidence: string } | null;
    strategy?: StrategySummaryRow | null; ad_set_count?: number; last_error_key?: string | null; insights_synced_at?: string | null; summary_at?: string | null;
    requested_start_at?: string | null; meta_start_time?: string | null };
  kpis: KpisRow | null;
  evidence: string;
  analysis: null | {
    windows: { current: { since: string; until: string }; previous: { since: string; until: string } };
    lifetime: MetricTotalsRow | null; current: MetricTotalsRow | null; previous: MetricTotalsRow | null;
    daily: Array<{ date: string; totals: MetricTotalsRow }>;
    outcomes: Record<'lifetime' | 'current' | 'previous', { leads?: number; qualifiedLeads?: number; viewings?: number; won?: number }>;
    ads: Array<{ key: string; totals: MetricTotalsRow; kpis: KpisRow }>;
    creativeClasses: Array<{ key: string; cls: string; evidence: string }>;
    segments: Record<'placement' | 'ageGender' | 'country' | 'region' | 'hour', Array<{ key: string; totals: MetricTotalsRow }>>;
    leaders: Record<'placement' | 'audience' | 'creative', { key: string; evidence: string } | null>;
    leadHours: number[];
    health: Record<string, { state: HealthStateRow; code: string }>;
    facts: Array<{ code: string; params: Record<string, string | number | null>; confidence?: string }>;
  };
  recommendations: RecommendationRow[];
  timeline: Array<{ kind: string; customer_key: string; params: Record<string, unknown>; at: string }>;
  entities: Array<{ kind: string; external_id: string; parent_external_id: string | null; local_creative_id: string | null; status: string | null; name: string | null }>;
  creatives: Array<{ id: string; headline: string | null; thumb: string | null; kind: 'IMAGE' | 'VIDEO' }>;
  leads: { total: number; byStatus: Record<string, number>; qualified: number; viewings: number };
  funding: { heldServiceFeeCents: number; feePercent: number | null; ledger: Array<{ entry_type: string; amount_cents: number; created_at: string; labelKey: string | null }> };
  guard: { account: GuardAccountRow | null; incidents: GuardIncidentRow[]; campaignState: string; maxStrikes: number };
  events: Array<{ id: string; type: string; category: string; severity: string; state: string; action_required: boolean; first_seen_at: string; last_seen_at: string; deep_link: string | null }>;
  provenance: { lastSyncedAt: string | null; insightsSyncedAt: string | null; summaryAt: string | null; source: string };
}
export interface GuardIncidentRow {
  id: string; campaign_id?: string | null; action: string; level: 'NOTICE' | 'WARNING' | 'STRIKE' | 'REVIEW_REQUIRED';
  status: string; customer_key: string; protective_action: string; protective_status: string; created_at: string;
}
export const campaignDetail = (campaignId: string) => call<CampaignDetail>('campaign_detail', { campaignId });

export interface DashboardRow extends MetaCampaignRow {
  totals: MetricTotalsRow; kpis: KpisRow; leads: number; outcomes: { qualifiedLeads: number; viewings: number; won: number };
  openRecommendations: number; attention: boolean;
}
export interface DashboardData {
  campaigns: DashboardRow[];
  summary: Array<{ currency: string; totals: MetricTotalsRow; kpis: KpisRow; leads: number; campaigns: number }>;
  /** Canonical (src/lib/metaAds/uiStatus.ts statusCounts). */
  counts: { total: number; active: number; paused: number; attention: number };
  serviceBalance: ServiceBalanceRow[];
}
export const metaDashboard = (filters: { status?: string; goal?: string; currency?: string; from?: string; to?: string } = {}) =>
  call<DashboardData>('dashboard', filters);

export interface LeadFormSpecRow {
  name: string; headline?: string | null; thankYouMessage?: string | null;
  contactFields: Array<'FULL_NAME' | 'PHONE' | 'EMAIL'>;
  questions: Array<'buy_or_rent' | 'budget' | 'preferred_location' | 'property_type' | 'bedrooms' | 'timeframe' | 'agent_contact'>;
  privacyPolicyUrl: string; followUpUrl?: string | null; locale: 'en' | 'ka' | 'ru' | 'tr' | 'ar' | 'he';
}
export const leadFormPreview = (spec: LeadFormSpecRow) =>
  call<{ issues: Array<{ code: string; field: string }>; preview: unknown }>('lead_form_preview', { spec });
export const createPremiumLeadForm = (spec: LeadFormSpecRow, propertyId?: string | null) =>
  call<{ ok: boolean; form: { id: string; external_id: string; name: string }; formId: string }>('lead_form_create_v2', { spec, propertyId });
export const listLeadForms = () => call<{ forms: Array<{ id: string; name: string; spec: LeadFormSpecRow; status: string; meta_form_id: string | null; created_at: string }> }>('lead_forms_list');

export const guardStatus = () => call<{ accounts: GuardAccountRow[]; incidents: GuardIncidentRow[]; maxStrikes: number; enabled: boolean }>('guard_status');

/* ── ADMIN ──────────────────────────────────────────────────────────── */
export const adminGuardOverview = () => call<{ accounts: Array<GuardAccountRow & { user_id: string; updated_at: string }>; incidents: Array<GuardIncidentRow & { user_id: string; ad_account_external_id: string; points: number; meta_guard_evidence?: { evidence: unknown } | null }>; actions: Array<Record<string, unknown>>; policy: Record<string, unknown>; enabled: boolean }>('admin_guard_overview');
export type AdminGuardAct = 'CLEAR_INCIDENT' | 'DISMISS_INCIDENT' | 'MARK_REVIEWED' | 'REINSTATE_ACCOUNT' | 'SUSPEND_ACCOUNT' | 'UNLOCK_CAMPAIGN' | 'ACCEPT_EXTERNAL' | 'RESTORE_CONFIG';
export const adminGuardAct = (act: AdminGuardAct, reason: string, target: { incidentId?: string; targetUserId?: string; adAccountId?: string; campaignId?: string }) =>
  call<{ ok: boolean }>('admin_guard_act', { act, reason, ...target });
export const adminFeePolicyGet = (targetUserId: string) => call<{ policy: { kind: string; percent: number | null }; standardPercent: number; effectivePercent: number | null; audit: Array<Record<string, unknown>> }>('admin_fee_policy_get', { targetUserId });
export const adminFeePolicySet = (targetUserId: string, kind: 'STANDARD_PERCENT' | 'FEE_EXEMPT' | 'CUSTOM_PERCENT', reason: string, percent?: number) =>
  call<{ ok: boolean }>('admin_fee_policy_set', { targetUserId, kind, reason, percent });
export const adminMetaEconomics = (days = 30) => call<{
  since: string;
  ai: { calls: number; inputTokens: number; outputTokens: number; rawCostUsd: number; landedCostUsd: number; unpriced: number; byPurpose: Record<string, number>; byTrigger: Record<string, number>; byModel: Record<string, number> };
  notifications: { total: number; byTransition: Record<string, number>; bySeverity: Record<string, number>; byChannel: Record<string, number> };
  deliveries: { byChannelStatus: Record<string, number>; skippedReasons: Record<string, number> };
  events: { byType: Record<string, number>; open: number };
}>('admin_meta_economics', { days });

/** Money in the viewer's locale; never summed across currencies. */
export const moneyIn = (minor: number | null | undefined, currency: string, locale: string) =>
  minor == null ? '—' : new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(minor / 100);

/* ── ADMIN: ONE CUSTOMER'S MONEY (admin_meta_customer_finance) ─────── */
export interface CustomerFinance {
  policy: { kind: string; percent: number | null; reason: string; updated_at: string } | null;
  effective_fee_percent: number;
  standardPercent: number;
  sampleQuote: { policy: string; fee_percent: number; planned_media_cents: number; service_fee_cents: number } | null;
  balances: Array<{ currency: string; deposited_cents: number; available_cents: number; reserved_service_cents: number; consumed_service_cents: number; released_cents: number }>;
  campaigns: Array<{ id: string; name: string | null; status: string; currency: string; fee_percent: number | null; planned_media_cents: number;
    service_fee_taken_cents: number; service_fee_released_cents: number; service_fee_held_cents: number; meta_media_spend_cents: number;
    launched_at: string | null; ended_at: string | null; settled_at: string | null }>;
  ledger: Array<{ id: number; entry_type: string; amount_cents: number; currency: string; campaign_id: string | null; note: string | null; created_by: string | null; created_at: string }>;
  adjustments: Array<{ id: string; direction: 'CREDIT' | 'DEBIT'; amount_cents: number; currency: string; reason: string; admin_user_id: string;
    campaign_id: string | null; balance_before_cents: number; balance_after_cents: number; created_at: string }>;
  policy_history: Array<{ previous: unknown; next: unknown; reason: string; admin_user_id: string; created_at: string }>;
  revenue_and_costs: Array<{ currency: string; service_fee_revenue_cents: number; service_fee_reserved_cents: number; meta_media_spend_cents: number }>;
  ai_costs_usd: { calls: number; raw_cost_usd: number; landed_cost_usd: number; unpriced_calls: number };
  semantics: { non_refundable_to_cash: boolean; withdrawable: boolean; released_reservations_return_to: string };
}
export const adminCustomerFinance = (targetUserId: string) => call<CustomerFinance>('admin_customer_finance', { targetUserId });
/** Through the canonical ledger: direction + reason + actor + balance before/after, audited. */
export const adminAdjustBalance = (input: { targetUserId: string; direction: 'CREDIT' | 'DEBIT'; amountCents: number; reason: string; currency: string; campaignId?: string | null }) =>
  call<{ ok: boolean; adjustment_id: string; ledger_id: number; balance_before_cents: number; balance_after_cents: number }>('admin_adjust', input);
