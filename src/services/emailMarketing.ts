// EMAIL MARKETING — the browser's side: plan/quota (my_email_plan RPCs), the
// email-marketing edge function (plans, domains, inbox replies, provider usage)
// and the CRM inbox read through the owner's own RLS (comm_conversations /
// comm_messages, EMAIL channel only).
import { supabase } from '@/db/supabase';

export class EmailMarketingError extends Error {
  constructor(public code: string, public detail?: unknown) { super(code); }
}

async function edge<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('email-marketing', { body: { action, ...payload } });
  if (error) {
    let code = 'REQUEST_FAILED';
    try {
      const ctx = (error as { context?: Response }).context;
      const body = ctx ? await ctx.json() : null;
      if (body?.error) code = String(body.error);
    } catch { /* keep generic */ }
    throw new EmailMarketingError(code);
  }
  const d = data as { ok?: boolean; error?: string } & T;
  if (d?.ok === false) throw new EmailMarketingError(d.error ?? 'REQUEST_FAILED', d);
  return d;
}

/* ── plan & quota ────────────────────────────────────────────────────────── */

export interface EmailPlanView {
  plan: 'FREE' | 'PRO' | 'SCALE';
  status: 'ACTIVE' | 'LAPSED' | 'CANCELLED';
  effectivePlan: 'FREE' | 'PRO' | 'SCALE';
  autoRenew: boolean;
  pendingPlan: 'PRO' | 'SCALE' | null;
  overageEnabled: boolean;
  overageConsentedAt: string | null;
  overageMaxBlocks: number | null;
  period: {
    id: string; kind: 'FREE_LIFETIME' | 'MONTHLY'; startsAt: string; endsAt: string | null;
    included: number; used: number; reserved: number; remaining: number; overageUsed: number; overageBlocksBilled: number;
  };
  freeRemaining: number;
  plans: Array<{ code: 'FREE' | 'PRO' | 'SCALE'; name: string; priceUsd: number; includedEmails: number; period: 'LIFETIME' | 'MONTH'; credits: number }>;
  overagePricePer1kUsd: number;
}

export async function getEmailPlan(): Promise<EmailPlanView> {
  const { data, error } = await supabase.rpc('my_email_plan');
  if (error) throw new EmailMarketingError('PLAN_UNAVAILABLE', error.message);
  return data as EmailPlanView;
}

export async function setOverage(enabled: boolean, maxBlocks: number | null): Promise<EmailPlanView> {
  const { data, error } = await supabase.rpc('my_email_set_overage', { p_enabled: enabled, p_max_blocks: maxBlocks });
  if (error) throw new EmailMarketingError('OVERAGE_UPDATE_FAILED', error.message);
  return data as EmailPlanView;
}

export async function setAutoRenew(enabled: boolean, nextPlan: 'PRO' | 'SCALE' | null): Promise<EmailPlanView> {
  const { data, error } = await supabase.rpc('my_email_set_auto_renew', { p_enabled: enabled, p_next_plan: nextPlan });
  if (error) throw new EmailMarketingError('RENEWAL_UPDATE_FAILED', error.message);
  return data as EmailPlanView;
}

/** `confirmed` is true only when the customer pressed Pay in the price confirmation dialog. */
export const purchasePlan = (plan: 'PRO' | 'SCALE', requestId: string, confirmed: boolean) =>
  edge<{ periodId: string; duplicate: boolean }>('plan_purchase', { plan, requestId, confirmed });

export interface BillingEvent { id: string; kind: string; plan_code: string | null; blocks: number | null; credits: number; gross_usd: number; created_at: string }

export async function listBillingEvents(): Promise<BillingEvent[]> {
  const { data } = await supabase.from('email_billing_events')
    .select('id, kind, plan_code, blocks, credits, gross_usd, created_at').order('created_at', { ascending: false }).limit(24);
  return (data ?? []) as BillingEvent[];
}

/* ── sending domains ─────────────────────────────────────────────────────── */

export interface DnsRecord { record: string; name: string; type: string; ttl?: string; status?: string; value: string; priority?: number }
export interface SendingDomain {
  id: string; domain: string; status: 'NOT_CONFIGURED' | 'DNS_PENDING' | 'VERIFICATION_PENDING' | 'VERIFIED' | 'FAILED' | 'RESTRICTED' | 'DISCONNECTED';
  provider_status: string | null; region: string; records: DnsRecord[]; sender_local_part: string | null; sender_name: string | null;
  last_error: string | null; last_checked_at: string | null; verified_at: string | null; created_at: string;
}

export const listDomains = () => edge<{ domains: SendingDomain[] }>('domains_list').then((r) => r.domains);
export const addDomain = (domain: string, region?: string) => edge<{ domain: SendingDomain }>('domain_add', { domain, region }).then((r) => r.domain);
export const refreshDomain = (id: string) => edge<{ domain: SendingDomain }>('domain_refresh', { id }).then((r) => r.domain);
export const verifyDomainNow = (id: string) => edge<{ domain: SendingDomain }>('domain_verify', { id }).then((r) => r.domain);
export const setDomainSender = (id: string, localPart: string, name: string) => edge('domain_set_sender', { id, localPart, name });
export const disconnectDomain = (id: string) => edge('domain_disconnect', { id });

/* ── CRM inbox ───────────────────────────────────────────────────────────── */

export interface InboxConversation {
  id: string; peer_address: string; peer_name: string | null; unread_count: number; last_message_at: string | null;
  last_message_preview: string | null; status: string; lead_stage: string | null; campaign_id: string | null; metadata: Record<string, unknown> | null;
}
export interface InboxMessage {
  id: string; direction: 'INBOUND' | 'OUTBOUND'; author: string; body: string | null; html_body: string | null; status: string;
  email_meta: Record<string, unknown> | null; error_message: string | null; sent_at: string | null; delivered_at: string | null; created_at: string;
}

export async function listInbox(opts: { q?: string; unreadOnly?: boolean; limit?: number } = {}): Promise<InboxConversation[]> {
  let q = supabase.from('comm_conversations')
    .select('id, peer_address, peer_name, unread_count, last_message_at, last_message_preview, status, lead_stage, campaign_id, metadata')
    .eq('channel', 'EMAIL').order('last_message_at', { ascending: false, nullsFirst: false }).limit(opts.limit ?? 100);
  if (opts.unreadOnly) q = q.gt('unread_count', 0);
  const term = (opts.q ?? '').trim().replace(/[%,()]/g, ' ').slice(0, 80);
  if (term) q = q.or(`peer_address.ilike.%${term}%,peer_name.ilike.%${term}%,last_message_preview.ilike.%${term}%`);
  const { data, error } = await q;
  if (error) throw new EmailMarketingError('INBOX_UNAVAILABLE', error.message);
  return (data ?? []) as InboxConversation[];
}

export async function getThread(conversationId: string): Promise<InboxMessage[]> {
  const { data, error } = await supabase.from('comm_messages')
    .select('id, direction, author, body, html_body, status, email_meta, error_message, sent_at, delivered_at, created_at')
    .eq('conversation_id', conversationId).order('created_at', { ascending: true }).limit(200);
  if (error) throw new EmailMarketingError('THREAD_UNAVAILABLE', error.message);
  return (data ?? []) as InboxMessage[];
}

export async function markRead(conversationId: string): Promise<void> {
  await supabase.from('comm_conversations').update({ unread_count: 0 }).eq('id', conversationId);
}

export const sendReply = (conversationId: string, text: string, requestId: string, domainId?: string | null) =>
  edge<{ providerMessageId: string }>('inbox_reply', { conversationId, text, requestId, domainId: domainId ?? null });

/* ── admin ───────────────────────────────────────────────────────────────── */

export async function adminEmailOps(days = 30): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('email_ops_overview', { p_days: days });
  if (error) throw new EmailMarketingError('OPS_UNAVAILABLE', error.message);
  return (data ?? {}) as Record<string, unknown>;
}

export async function adminEmailEconomics(days = 30): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('email_economics_overview', { p_days: days });
  if (error) throw new EmailMarketingError('ECONOMICS_UNAVAILABLE', error.message);
  return (data ?? {}) as Record<string, unknown>;
}

export const adminRefreshUsage = () =>
  edge<{ usage: Record<string, unknown> | null; alerts: string[]; keyEnv: string | null; keyFallback: boolean; error: string | null }>('usage_refresh');

/* ── contact marketing consent ──────────────────────────────────────────── */

export type LawfulBasis = 'CONSENT' | 'CONTRACT' | 'LEGITIMATE_INTEREST_EXISTING_CUSTOMER';
export interface ContactConsent { consentStatus: string; lawfulBasis: LawfulBasis | null; recordedAt: string | null }

const CONSENT_ERRORS = ['CONTACT_OPTED_OUT', 'CONTACT_HAS_NO_EMAIL', 'LAWFUL_BASIS_REQUIRED', 'CONTACT_NOT_FOUND'] as const;

/** Record (with a lawful basis) or withdraw marketing-email consent for one of the owner's contacts. */
export async function setContactEmailConsent(contactId: string, grant: boolean, basis: LawfulBasis | null): Promise<ContactConsent> {
  const { data, error } = await supabase.rpc('my_outreach_contact_set_email_consent', { p_contact: contactId, p_grant: grant, p_basis: basis });
  if (error) {
    const code = CONSENT_ERRORS.find((c) => error.message.includes(c)) ?? 'CONSENT_UPDATE_FAILED';
    throw new EmailMarketingError(code, error.message);
  }
  return data as ContactConsent;
}
