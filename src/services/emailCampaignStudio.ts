// EMAIL STUDIO — the browser's side of campaigns, review, audiences, templates and HOMI.
//
// Reads go through the owner's own RLS (outreach_campaigns, email_campaign_reviews,
// email_templates, outreach_contact_lists). Every write that matters goes through the server:
// campaign_save renders the design there, campaign_submit runs the risk engine and the review
// policy, and the database guard refuses any status the browser may not set (approval is never a
// client write). Schedule/unschedule/pause/cancel are plain row updates the guard permits.

import { supabase } from '@/db/supabase';
import type { CopilotProposal, CopilotTask } from '@/emailMarketing/copilot';
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

export async function saveCampaign(id: string | null, campaign: CampaignPatch): Promise<StudioCampaign> {
  const r = await edge<{ campaign: StudioCampaign }>('campaign_save', { id, campaign });
  return r.campaign;
}

export interface AudienceEstimate {
  total: number; matched: number; withEmail: number; reachable: number; eligible: number; consentUnknown: number;
  suppressed: number; duplicates: number; byLanguage: Record<string, number>; bySource: Record<string, number>;
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
export interface SendRow { status: string; sent_at: string | null; delivered_at: string | null; created_at: string; language: string | null }

export async function campaignSends(id: string): Promise<SendRow[]> {
  const { data } = await supabase.from('outreach_sends').select('status, sent_at, delivered_at, created_at, language')
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
