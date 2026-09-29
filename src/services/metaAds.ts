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

export interface MetaAsset {
  id: string; kind: 'BUSINESS' | 'PAGE' | 'INSTAGRAM' | 'AD_ACCOUNT' | 'PIXEL';
  external_id: string; name: string | null; selected: boolean; status: string;
}
export interface MetaWallet {
  available_cents: number; reserved_cents: number; spent_cents: number;
  fees_cents: number; deposited_cents: number; currency: string;
}
export interface MetaStatus {
  mode: 'REAL' | 'MOCK';
  connection: { status: string; granted_scopes?: string[]; token_expires_at?: string | null };
  assets: MetaAsset[];
  wallet: MetaWallet;
  settings: {
    feePercent: number; minDurationDays: number; minDailyCents: number; maxDailyCents: number;
    goalsEnabled: string[]; leadImportEnabled: boolean; audienceCreationEnabled: boolean;
    retargetingEnabled: boolean; aiAssistEnabled: boolean; publishingEnabled: boolean;
  };
}
export const getMetaStatus = () => call<MetaStatus>('status');
export const startMetaOAuth = () => call<{ url?: string; mockConnect?: boolean; mode: string }>('oauth_start');
export const mockConnect = () => call('oauth_mock_connect');
export const refreshMetaAssets = () => call('assets_refresh');
export const selectMetaAsset = (kind: string, assetId: string) => call('select_asset', { kind, assetId });

/* ── CAMPAIGNS (drafts through RLS) ─────────────────────────────────── */

export interface MetaCampaignRow {
  id: string; name: string; property_id: string | null; offer: Record<string, unknown> | null;
  goal: string; status: string; daily_budget_cents: number | null; duration_days: number | null;
  currency: string; destination: { type: string; url?: string } | null; audience_id: string | null;
  placements: { mode: string; list?: string[] }; preflight: { status: string; checks: Array<{ key: string; ok: boolean; detail?: string }> } | null;
  external_status: string | null; spend_cents: number; results: Record<string, unknown> | null;
  special_ad_categories: string[]; last_error: { key?: string } | null;
  created_at: string; updated_at: string;
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

export const planPreview = (campaignId: string) =>
  call<{ issues: Array<{ code: string; field?: string }>; totals: { mediaCents: number; feeCents: number; totalCents: number; feePercent: number }; summary: { adSetCount: number; creativeCount: number; specialAdCategories: string[] } | null }>('plan_preview', { campaignId });
export const runPreflight = (campaignId: string) =>
  call<{ status: string; checks: Array<{ key: string; ok: boolean; detail?: string }> }>('preflight', { campaignId });
export const launchCampaign = (campaignId: string, idempotencyKey: string) =>
  call<{ ok: boolean; status: string; mode: string }>('launch', { campaignId, idempotencyKey });
export const pauseCampaign = (campaignId: string) => call('pause', { campaignId });
export const resumeCampaign = (campaignId: string) => call('resume', { campaignId });
export const syncCampaign = (campaignId: string) =>
  call<{ results: Record<string, unknown> | null; external_status?: string }>('sync', { campaignId });

/* ── CREATIVES ──────────────────────────────────────────────────────── */

export interface MetaCreativeRow {
  id: string; campaign_id: string | null; kind: 'IMAGE' | 'VIDEO' | 'CAROUSEL';
  media: Array<{ path: string; mime: string }>; headline: string; primary_text: string;
  cta: string; destination_url: string | null; safety_status: string; sort: number;
}

export async function listCreatives(campaignId: string): Promise<MetaCreativeRow[]> {
  const { data } = await supabase.from('meta_creatives').select('*')
    .eq('campaign_id', campaignId).order('sort');
  return (data ?? []) as MetaCreativeRow[];
}

export async function addCreative(userId: string, campaignId: string, file: File, copy: {
  headline: string; primaryText: string; cta?: string; destinationUrl?: string | null;
}): Promise<MetaCreativeRow> {
  const path = `${userId}/${crypto.randomUUID()}.${file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : file.type.startsWith('video') ? 'mp4' : 'jpg'}`;
  const { error: upErr } = await supabase.storage.from('meta-ads-media')
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) throw upErr;
  const { data, error } = await supabase.from('meta_creatives').insert({
    user_id: userId, campaign_id: campaignId,
    kind: file.type.startsWith('video') ? 'VIDEO' : 'IMAGE',
    media: [{ path, mime: file.type }],
    headline: copy.headline, primary_text: copy.primaryText,
    cta: copy.cta ?? 'LEARN_MORE', destination_url: copy.destinationUrl ?? null,
  }).select('*').single();
  if (error) throw error;
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
