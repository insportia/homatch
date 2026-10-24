// EMAIL STUDIO — the browser's side of campaigns, review, audiences, templates and HOMI.
//
// Reads go through the owner's own RLS (outreach_campaigns, email_campaign_reviews,
// email_templates, outreach_contact_lists). Every write that matters goes through the server:
// campaign_save renders the design there, campaign_submit runs the risk engine and the review
// policy, and the database guard refuses any status the browser may not set (approval is never a
// client write). Schedule/unschedule/pause/cancel are plain row updates the guard permits.

import { supabase } from '@/db/supabase';
import type { CopilotProposal, CopilotTask } from '@/emailMarketing/copilot';
import type { DomainAuthReport } from '@/emailMarketing/deliverability/dnsCheck';
import type { EmailDoc } from '@/emailMarketing/designer/document';
import type { RiskResult } from '@/emailMarketing/risk/engine';

export class StudioError extends Error {
  constructor(public code: string, public body?: Record<string, unknown> | null) { super(code); }
}

async function edge<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('email-marketing', { body: { action, ...payload } });
  if (error) {
    let body: Record<string, unknown> | null = null;
    try {
      const ctx = (error as { context?: Response }).context;
      body = ctx ? await ctx.json() : null;
    } catch { /* keep generic */ }
    throw new StudioError(String(body?.error ?? 'REQUEST_FAILED'), body);
  }
  const d = data as { ok?: boolean; error?: string } & T;
  if (d?.ok === false) throw new StudioError(d.error ?? 'REQUEST_FAILED', d as Record<string, unknown>);
  return d;
}

export interface AudienceFilter {
  languages?: string[]; countries?: string[]; leadTypes?: string[]; sources?: string[]; tags?: string[]; excludeListIds?: string[];
  /** Individually selected leads ("selected leads" mode); their lists are the campaign's lists. */
  contactIds?: string[];
}

export interface StudioCampaign {
  id: string;
  name: string;
  objective: string | null;
  description: string | null;
  audience_note?: string | null;
  language: string | null;
  subject: string | null;
  preview_text: string | null;
  sender_name: string | null;
  sender_email: string | null;
  reply_to: string | null;
  contact_list_id: string | null;
  contact_list_ids: string[] | null;
  audience_filter: AudienceFilter | null;
  design: EmailDoc | null;
  status: string;
  content_hash: string | null;
  approved_content_hash: string | null;
  risk_level: string | null;
  risk_score: number | null;
  risk_reasons: RiskResult['findings'] | null;
  review_note: string | null;
  scheduled_at: string | null;
  timezone: string | null;
  created_at: string;
  updated_at: string;
  sent_count: number | null;
  delivered_count: number | null;
  bounce_count: number | null;
  complaint_count: number | null;
  unsubscribe_count: number | null;
  failed_count: number | null;
  audience_count: number | null;
  send_eligibility?: string | null;
  html_body?: string | null;
}

export type CampaignPatch = Partial<Pick<StudioCampaign,
  'name' | 'objective' | 'description' | 'audience_note' | 'language' | 'subject' | 'preview_text' | 'sender_name' | 'sender_email' | 'reply_to'
  | 'contact_list_ids' | 'audience_filter' | 'design'>> & { property_id?: string | null };

const LIST_COLS = 'id, name, objective, language, subject, preview_text, status, risk_level, scheduled_at, created_at, updated_at, sent_count, delivered_count, bounce_count, complaint_count, unsubscribe_count, failed_count, audience_count, contact_list_id, contact_list_ids, send_eligibility, approved_content_hash, content_hash';
const FULL_COLS = `${LIST_COLS}, description, audience_note, sender_name, sender_email, reply_to, audience_filter, design, risk_score, risk_reasons, review_note, timezone, html_body`;

export async function listCampaigns(): Promise<StudioCampaign[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase.from('outreach_campaigns').select(LIST_COLS)
    .eq('owner_id', user.id).eq('campaign_type', 'EMAIL').order('updated_at', { ascending: false }).limit(500);
  if (error) throw new StudioError('LOAD_FAILED');
  return (data ?? []) as unknown as StudioCampaign[];
}

export async function getCampaign(id: string): Promise<StudioCampaign | null> {
  const { data, error } = await supabase.from('outreach_campaigns').select(FULL_COLS).eq('id', id).eq('campaign_type', 'EMAIL').maybeSingle();
  if (error) throw new StudioError('LOAD_FAILED');
  return (data ?? null) as unknown as StudioCampaign | null;
}

/** `draftKey` (first save only) makes a retried create return the same draft, never a second. */
/* `baseUpdatedAt`: the version the browser edited; a newer row → StudioError('STALE') with body.campaign.
   `version`: ask for a MANUAL/RESTORE design snapshot on top of the automatic two-minute one. */
export async function saveCampaign(id: string | null, campaign: CampaignPatch, draftKey?: string | null,
  opts: { baseUpdatedAt?: string | null; version?: 'MANUAL' | 'RESTORE' } = {}): Promise<StudioCampaign> {
  const r = await edge<{ campaign: StudioCampaign }>('campaign_save', {
    id, campaign, draftKey: id ? null : draftKey ?? null,
    ...(id && opts.baseUpdatedAt ? { baseUpdatedAt: opts.baseUpdatedAt } : {}), ...(opts.version ? { version: opts.version } : {}),
  });
  return r.campaign;
}

export interface DesignVersion { id: string; design: EmailDoc; subject: string | null; reason: 'AUTOSAVE' | 'MANUAL' | 'RESTORE' | 'TEMPLATE'; created_at: string }
export async function listDesignVersions(campaignId: string): Promise<DesignVersion[]> {
  const { data, error } = await supabase.from('email_design_versions').select('id, design, subject, reason, created_at')
    .eq('campaign_id', campaignId).order('created_at', { ascending: false }).limit(50);
  if (error) throw new StudioError('VERSIONS_FAILED');
  return (data ?? []) as DesignVersion[];
}

/* ── deliverability (email-marketing deliverability_check; owner-only tables) ──────────────── */
export type CheckState = 'OK' | 'WARN' | 'BAD' | 'UNKNOWN';
export interface DeliverabilityDomain {
  domain: string; shared: boolean; providerStatus: string | null;
  records: Array<{ record: string; name: string; type: string; status?: string }>;
  tracking: { open: boolean | null; click: boolean | null };
  dns: DomainAuthReport;
}
export interface DeliverabilityResult { checkedAt: string; domains: DeliverabilityDomain[]; providerKey: boolean }
/** The live check: provider records + public DNS as receivers read it. Rate-limited server-side. */
export async function runDeliverabilityCheck(): Promise<DeliverabilityResult> {
  return edge<DeliverabilityResult>('deliverability_check', {});
}
/** The last stored check, or null if none was run yet. */
export async function lastDeliverabilityCheck(): Promise<DeliverabilityResult | null> {
  const { data, error } = await supabase.from('email_deliverability_checks').select('result, checked_at').order('checked_at', { ascending: false }).limit(1).maybeSingle();
  if (error || !data) return null;
  const r = data as { result: { domains?: DeliverabilityDomain[] }; checked_at: string };
  return { checkedAt: r.checked_at, domains: r.result.domains ?? [], providerKey: true };
}

export type Mailbox = 'GMAIL' | 'OUTLOOK' | 'YAHOO' | 'APPLE' | 'OTHER';
export type Placement = 'INBOX' | 'SPAM' | 'PROMOTIONS' | 'OTHER_TAB' | 'NOT_RECEIVED';
/** What the owner saw in a real mailbox for a controlled test: the only source of an Inbox/Spam placement. */
export interface PlacementTest { id: string; campaign_id: string | null; mailbox: Mailbox; placement: Placement; auth: Record<string, unknown> | null; note: string | null; observed_at: string }
const PT_COLS = 'id, campaign_id, mailbox, placement, auth, note, observed_at';
export async function listPlacementTests(): Promise<PlacementTest[]> {
  const { data, error } = await supabase.from('email_placement_tests').select(PT_COLS).order('observed_at', { ascending: false }).limit(50);
  if (error) throw new StudioError('PLACEMENT_FAILED');
  return (data ?? []) as PlacementTest[];
}
export async function recordPlacementTest(p: { campaign_id?: string | null; mailbox: Mailbox; placement: Placement; auth?: Record<string, unknown> | null; note?: string | null }): Promise<PlacementTest> {
  const { data, error } = await supabase.from('email_placement_tests')
    .insert({ campaign_id: p.campaign_id ?? null, mailbox: p.mailbox, placement: p.placement, auth: p.auth ?? null, note: p.note?.slice(0, 500) || null })
    .select(PT_COLS).single();
  if (error) throw new StudioError('PLACEMENT_FAILED');
  return data as PlacementTest;
}
export async function deletePlacementTest(id: string): Promise<void> {
  const { error } = await supabase.from('email_placement_tests').delete().eq('id', id);
  if (error) throw new StudioError('PLACEMENT_FAILED');
}

/** A new draft with the same content (never a copy of the approval, the schedule or the results). */
export async function duplicateCampaign(c: StudioCampaign, copyLabel: string): Promise<StudioCampaign> {
  return saveCampaign(null, {
    name: `${copyLabel} ${c.name}`.slice(0, 160), objective: c.objective, description: c.description, audience_note: c.audience_note ?? null,
    language: c.language, subject: c.subject, preview_text: c.preview_text, sender_name: c.sender_name, sender_email: c.sender_email,
    reply_to: c.reply_to, contact_list_ids: c.contact_list_ids?.length ? c.contact_list_ids : c.contact_list_id ? [c.contact_list_id] : [],
    audience_filter: c.audience_filter, design: c.design,
  }, crypto.randomUUID());
}

/* ── sending allowance (my_email_allowance: the same settings email_quota_reserve enforces) ── */
export interface EmailAllowance {
  plan: { code: 'FREE' | 'PRO' | 'SCALE'; periodKind: 'FREE_LIFETIME' | 'MONTHLY'; endsAt: string | null; included: number; used: number; reserved: number; remaining: number };
  overage: { enabled: boolean; room: number | null; pricePer1kUsd: number };
  tenantDaily: { cap: number; used: number; remaining: number; resetsAt: string } | null;
  providerDaily: { remaining: number; resetsAt: string } | null;
  providerMonthly: { remaining: number; resetsAt: string } | null;
  provider: { capturedAt: string; dailyRemaining: number | null; monthlyRemaining: number | null; ratePerSecond: number | null } | null;
  sending: { enabled: boolean };
  computedAt: string;
}

export async function getAllowance(): Promise<EmailAllowance> {
  const { data, error } = await supabase.rpc('my_email_allowance');
  if (error) throw new StudioError('ALLOWANCE_UNAVAILABLE');
  return data as EmailAllowance;
}

/* outreach-send dispatches BATCH_SIZE emails per run and the scheduler runs every 30 s
   (cron "homatch-jobs-worker"); a test pins this against outreach-send's own constant. */
export const SEND_BATCH_SIZE = 40;
export const SEND_TICK_SECONDS = 30;

export type AllowanceLimit = 'PLAN' | 'TENANT_DAILY' | 'PROVIDER_DAILY' | 'PROVIDER_MONTHLY' | 'PROVIDER' | 'SENDING_OFF';

/** What a campaign of `recipients` can actually send right now, and which ceiling stops it. */
export function sendable(a: EmailAllowance, recipients: number): { now: number; limitedBy: AllowanceLimit | null; overage: number } {
  if (!a.sending.enabled) return { now: 0, limitedBy: 'SENDING_OFF', overage: 0 };
  const planRoom = a.plan.remaining + (a.overage.enabled ? a.overage.room ?? Number.POSITIVE_INFINITY : a.overage.room ?? 0);
  const caps: Array<[number, AllowanceLimit]> = [
    [planRoom, 'PLAN'],
    [a.tenantDaily?.remaining ?? Number.POSITIVE_INFINITY, 'TENANT_DAILY'],
    [a.providerDaily?.remaining ?? Number.POSITIVE_INFINITY, 'PROVIDER_DAILY'],
    [a.providerMonthly?.remaining ?? Number.POSITIVE_INFINITY, 'PROVIDER_MONTHLY'],
    [a.provider?.dailyRemaining ?? Number.POSITIVE_INFINITY, 'PROVIDER'],
  ];
  let now = recipients;
  let by: AllowanceLimit | null = null;
  for (const [room, why] of caps) if (room < now) { now = Math.max(0, room); by = why; }
  return { now: Math.floor(now), limitedBy: by, overage: Math.max(0, Math.floor(now) - a.plan.remaining) };
}

/** Rough minutes to DISPATCH `n` emails at the scheduler's pace (dispatch, not delivery). */
export function dispatchMinutes(n: number): number {
  return n <= SEND_BATCH_SIZE ? 1 : Math.ceil((Math.ceil(n / SEND_BATCH_SIZE) * SEND_TICK_SECONDS) / 60);
}

/* ── design images (R2 via email-marketing asset_upload; delivered by email-webhook ?ema=) ── */
export interface EmailAsset { id: string; url: string; content_type: string; byte_size: number; width: number | null; height: number | null; kind: 'IMAGE' | 'LOGO'; original_filename: string | null; created_at: string }

/* The brand-domain image link the server issues (www.homatch.live/m/a/<id>, vercel.json rewrite). */
export const EMAIL_LINK_BASE = 'https://www.homatch.live';
export const assetUrl = (id: string) => `${EMAIL_LINK_BASE}/m/a/${id}`;
export const ASSET_MAX_BYTES = 5 * 1024 * 1024;

export async function listAssets(): Promise<EmailAsset[]> {
  const { data } = await supabase.from('email_assets').select('id, content_type, byte_size, width, height, kind, original_filename, created_at')
    .order('created_at', { ascending: false }).limit(300);
  return ((data ?? []) as Array<Omit<EmailAsset, 'url'>>).map((a) => ({ ...a, url: assetUrl(a.id) }));
}

/**
 * Prepare a picked file for email: decoded in the browser, scaled down to what an email can use
 * (1200 px images, 600 px logos); WebP/HEIC/AVIF and large photos re-encoded as JPEG (Outlook
 * shows no WebP), PNG logos kept PNG for transparency, GIFs kept as they are (animation). The
 * server reads the bytes again and accepts PNG/JPEG/GIF only.
 */
export async function prepareImage(file: File, kind: 'IMAGE' | 'LOGO'): Promise<{ blob: Blob; name: string }> {
  const type = file.type.toLowerCase();
  if (type === 'image/gif') return { blob: file, name: file.name };
  if (!/^image\/(png|jpeg|jpg|webp|heic|heif|avif)$/.test(type)) throw new StudioError('TYPE_NOT_ALLOWED');
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new StudioError('BAD_FILE');
  const max = kind === 'LOGO' ? 600 : 1200;
  const scale = Math.min(1, max / Math.max(bitmap.width, 1));
  const keepPng = type === 'image/png' && (kind === 'LOGO' || file.size < 400_000);
  if ((type === 'image/jpeg' || type === 'image/jpg' || keepPng) && scale === 1 && file.size <= 1_500_000) return { blob: file, name: file.name };
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new StudioError('BAD_FILE');
  if (!keepPng) { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(bitmap, 0, 0, w, h);
  const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, keepPng ? 'image/png' : 'image/jpeg', 0.86));
  if (!out) throw new StudioError('BAD_FILE');
  return { blob: out, name: file.name.replace(/\.[a-z0-9]+$/i, '') + (keepPng ? '.png' : '.jpg') };
}

const toBase64 = (b: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).replace(/^data:[^,]*,/, ''));
  r.onerror = () => rej(new StudioError('BAD_FILE'));
  r.readAsDataURL(b);
});

export async function uploadAsset(file: File, kind: 'IMAGE' | 'LOGO'): Promise<EmailAsset> {
  const { blob, name } = await prepareImage(file, kind);
  if (blob.size > ASSET_MAX_BYTES) throw new StudioError('TOO_LARGE');
  const r = await edge<{ asset: EmailAsset }>('asset_upload', { kind, filename: name, dataBase64: await toBase64(blob) });
  return r.asset;
}

export async function deleteAsset(id: string): Promise<void> {
  await edge('asset_delete', { id });
}

export interface AudienceEstimate {
  total: number; matched: number; withEmail: number; reachable: number; eligible: number; consentUnknown: number;
  suppressed: number; duplicates: number; invalidEmail?: number; byLanguage: Record<string, number>; bySource: Record<string, number>;
}

export async function estimateAudience(listIds: string[], filter: AudienceFilter | null): Promise<AudienceEstimate> {
  const { data, error } = await supabase.rpc('email_audience_estimate', { p_list_ids: listIds, p_filter: filter ?? null });
  if (error) throw new StudioError('ESTIMATE_FAILED');
  return data as AudienceEstimate;
}

export interface CheckResult { risk: RiskResult; audience: AudienceEstimate | null; problems: string[] }

export async function checkCampaign(id: string): Promise<CheckResult> {
  return edge<CheckResult>('campaign_check', { id });
}

export async function submitCampaign(id: string): Promise<{ status: string; risk: RiskResult }> {
  return edge<{ status: string; risk: RiskResult }>('campaign_submit', { id });
}

export async function sendTest(campaignId: string): Promise<{ sentTo: string }> {
  return edge<{ sentTo: string }>('campaign_test', { campaignId, requestId: crypto.randomUUID() });
}

/** Approved → scheduled (the guard allows only a future time on an approved campaign). */
export async function scheduleCampaign(id: string, when: Date, timezone: string): Promise<void> {
  const { error } = await supabase.from('outreach_campaigns')
    .update({ status: 'SCHEDULED', scheduled_at: when.toISOString(), timezone, updated_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'APPROVED');
  if (error) throw new StudioError('SCHEDULE_FAILED');
}

export async function unscheduleCampaign(id: string): Promise<void> {
  const { error } = await supabase.from('outreach_campaigns').update({ status: 'APPROVED', updated_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'SCHEDULED');
  if (error) throw new StudioError('UNSCHEDULE_FAILED');
}

export async function setCampaignStatus(id: string, status: 'DRAFT' | 'CANCELLED' | 'PAUSED'): Promise<void> {
  const { error } = await supabase.from('outreach_campaigns').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new StudioError('STATUS_FAILED');
}

/** Send an approved campaign now: outreach-send enforces the review gate itself. */
export async function sendNow(id: string): Promise<{ sent?: number; remaining?: number; blocked?: boolean; reason?: string }> {
  const { data, error } = await supabase.functions.invoke('outreach-send', { body: { campaign_id: id } });
  if (error) {
    let body: Record<string, unknown> | null = null;
    try { body = await (error as { context?: Response }).context?.json() ?? null; } catch { /* generic */ }
    throw new StudioError(String(body?.reason ?? body?.error ?? 'SEND_FAILED'), body);
  }
  return data as { sent?: number; remaining?: number };
}

export interface ReviewEntry { id: string; action: string; actor_kind: string; reason: string | null; risk_level: string | null; risk_score: number | null; risk_findings: RiskResult['findings'] | null; created_at: string }

export async function campaignReviews(id: string): Promise<ReviewEntry[]> {
  const { data } = await supabase.from('email_campaign_reviews')
    .select('id, action, actor_kind, reason, risk_level, risk_score, risk_findings, created_at')
    .eq('campaign_id', id).order('created_at', { ascending: false }).limit(50);
  return (data ?? []) as ReviewEntry[];
}

/* ── per-campaign delivery records (provider-confirmed statuses only) ─────────────────────── */
export interface SendRow { status: string; sent_at: string | null; delivered_at: string | null; created_at: string; language: string | null; error_message?: string | null }

export async function campaignSends(id: string): Promise<SendRow[]> {
  const { data } = await supabase.from('outreach_sends').select('status, sent_at, delivered_at, created_at, language, error_message')
    .eq('campaign_id', id).limit(5000);
  return (data ?? []) as SendRow[];
}

/* ── templates ────────────────────────────────────────────────────────────────────────────── */
export interface UserTemplate { id: string; name: string; kind: string; language: string | null; subject: string | null; preview_text: string | null; design: EmailDoc; favorite: boolean; updated_at: string }

export async function listTemplates(): Promise<UserTemplate[]> {
  const { data } = await supabase.from('email_templates').select('id, name, kind, language, subject, preview_text, design, favorite, updated_at').order('updated_at', { ascending: false }).limit(200);
  return (data ?? []) as UserTemplate[];
}

export async function saveTemplate(t: { id?: string; name: string; kind?: string; language?: string | null; subject?: string | null; preview_text?: string | null; design: EmailDoc; favorite?: boolean }): Promise<UserTemplate> {
  const row = { name: t.name.slice(0, 120), kind: t.kind ?? 'CUSTOM', language: t.language ?? null, subject: t.subject ?? null, preview_text: t.preview_text ?? null, design: t.design, favorite: t.favorite ?? false, updated_at: new Date().toISOString() };
  const q = t.id ? supabase.from('email_templates').update(row).eq('id', t.id) : supabase.from('email_templates').insert(row);
  const { data, error } = await q.select('id, name, kind, language, subject, preview_text, design, favorite, updated_at').single();
  if (error) throw new StudioError('TEMPLATE_SAVE_FAILED');
  return data as UserTemplate;
}

export async function patchTemplate(id: string, patch: Partial<Pick<UserTemplate, 'name' | 'favorite'>>): Promise<void> {
  const { error } = await supabase.from('email_templates').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new StudioError('TEMPLATE_SAVE_FAILED');
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('email_templates').delete().eq('id', id);
  if (error) throw new StudioError('TEMPLATE_DELETE_FAILED');
}

/* ── lists & senders (for the wizard) ─────────────────────────────────────────────────────── */
export interface ListOption { id: string; name: string; valid_rows: number | null; total_rows: number | null; created_at: string }

export async function myLists(): Promise<ListOption[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase.from('outreach_contact_lists').select('id, name, valid_rows, total_rows, created_at')
    .eq('owner_id', user.id).order('created_at', { ascending: false }).limit(300);
  return (data ?? []) as ListOption[];
}

export interface SenderOption { address: string | null; domain: string | null; name: string | null; verified: boolean; custom: boolean }

export async function mySenders(): Promise<SenderOption[]> {
  const { data } = await supabase.from('email_sending_domains').select('domain, status, sender_local_part, sender_name').is('disconnected_at', null);
  const custom = ((data ?? []) as Array<{ domain: string; status: string; sender_local_part: string | null; sender_name: string | null }>)
    .map((d) => ({ address: d.sender_local_part ? `${d.sender_local_part}@${d.domain}` : null, domain: d.domain, name: d.sender_name, verified: d.status === 'VERIFIED' && Boolean(d.sender_local_part), custom: true }));
  return [{ address: null, domain: 'homatch.live', name: null, verified: true, custom: false }, ...custom];
}

/* ── HOMI ─────────────────────────────────────────────────────────────────────────────────── */
export async function askHomi(input: {
  task: CopilotTask; instruction?: string; language: string; targetLanguage?: string | null; uiLanguage: string;
  campaign: { name?: string; objective?: string; subject?: string; preview_text?: string; audience?: string };
  design: EmailDoc | null; facts?: string; findings?: RiskResult['findings'];
}): Promise<CopilotProposal> {
  const r = await edge<{ proposal: CopilotProposal }>('copilot', input as unknown as Record<string, unknown>);
  return r.proposal;
}

/* ── metrics: provider-confirmed records only ─────────────────────────────────────────────────
   accepted  = Resend returned a message id (status SENT or anything after it)
   delivered / bounced / complained = the provider's webhook said so (email-webhook)
   unsubscribed = the recipient used the one-click link (outreach-unsubscribe)
   Opens and clicks are not tracked for campaign email, and are reported as such — never zero. */
export interface SendFact { campaign_id: string; status: string; created_at: string; sent_at: string | null; delivered_at: string | null; provider_message_id: string | null }

export async function sendFacts(sinceIso: string | null): Promise<SendFact[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  let q = supabase.from('outreach_sends').select('campaign_id, status, created_at, sent_at, delivered_at, provider_message_id')
    .eq('owner_id', user.id).eq('channel', 'EMAIL').order('created_at', { ascending: false }).limit(20000);
  if (sinceIso) q = q.gte('created_at', sinceIso);
  const { data, error } = await q;
  if (error) throw new StudioError('LOAD_FAILED');
  return (data ?? []) as SendFact[];
}

export interface SendTotals { attempted: number; accepted: number; delivered: number; bounced: number; complained: number; unsubscribed: number; failed: number }

export function totalsOf(facts: SendFact[]): SendTotals {
  const t: SendTotals = { attempted: facts.length, accepted: 0, delivered: 0, bounced: 0, complained: 0, unsubscribed: 0, failed: 0 };
  for (const f of facts) {
    if (f.provider_message_id || ['SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'OPTED_OUT', 'READ'].includes(f.status)) t.accepted++;
    if (f.status === 'DELIVERED' || f.status === 'READ' || f.delivered_at) t.delivered++;
    if (f.status === 'BOUNCED') t.bounced++;
    if (f.status === 'COMPLAINED') t.complained++;
    if (f.status === 'OPTED_OUT') t.unsubscribed++;
    if (f.status === 'FAILED') t.failed++;
  }
  return t;
}

export const rate = (n: number, d: number): number | null => (d > 0 ? n / d : null);

/** Daily accepted / delivered / bounced over a window (UTC days), for the trend strip. */
export function dailySeries(facts: SendFact[], days: number): Array<{ day: string; accepted: number; delivered: number; bounced: number }> {
  const out = new Map<string, { accepted: number; delivered: number; bounced: number }>();
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i)).toISOString().slice(0, 10);
    out.set(d, { accepted: 0, delivered: 0, bounced: 0 });
  }
  for (const f of facts) {
    const d = (f.sent_at ?? f.created_at).slice(0, 10);
    const row = out.get(d);
    if (!row) continue;
    if (f.provider_message_id || f.status !== 'FAILED') row.accepted++;
    if (f.status === 'DELIVERED' || f.delivered_at) row.delivered++;
    if (f.status === 'BOUNCED') row.bounced++;
  }
  return [...out.entries()].map(([day, v]) => ({ day, ...v }));
}

export async function myReviewEvents(limit = 12): Promise<Array<ReviewEntry & { campaign_id: string }>> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  /* An admin can read every row (RLS); the customer dashboard shows the caller's own only. */
  const { data } = await supabase.from('email_campaign_reviews')
    .select('id, campaign_id, action, actor_kind, reason, risk_level, risk_score, risk_findings, created_at')
    .eq('owner_id', user.id).order('created_at', { ascending: false }).limit(limit);
  return (data ?? []) as Array<ReviewEntry & { campaign_id: string }>;
}
