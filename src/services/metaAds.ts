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
  | 'NOT_CONNECTED' | 'CONNECTED' | 'PERMISSION_MISSING' | 'TOKEN_EXPIRED' | 'REVOKED' | 'ERROR';
export interface MetaWallet {
  available_cents: number; reserved_cents: number; spent_cents: number;
  fees_cents: number; deposited_cents: number; currency: string;
}
export interface MetaStatus {
  mode: 'REAL' | 'MOCK';
  connection: {
    status: string; health?: MetaConnectionHealth; granted_scopes?: string[]; missing_scopes?: string[];
    token_expires_at?: string | null; last_checked_at?: string | null;
  };
  assets: MetaAsset[];
  wallet: MetaWallet;
  settings: {
    feePercent: number; minDurationDays: number; minDailyCents: number; maxDailyCents: number;
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
  created_at: string; updated_at: string;
}

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
}

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
