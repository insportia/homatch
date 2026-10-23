// EMAIL MARKETING — the shared server core: settings, sender identity, reply
// routing, plan quota, and wallet charges for plans and consented overage.
//
// THE BILLABLE UNIT. One email = one recipient message the provider ACCEPTED
// (Resend returned an id). Quota is reserved before a batch, settled with the
// accepted count, and the remainder released; a provider refusal, a suppressed
// address or a crash before acceptance consumes nothing. Retries reuse the same
// idempotency keys, so a repeated request never reserves or charges twice.
//
// MONEY. Plans and overage blocks are charged from the credit wallet through
// wallet_reserve → wallet_settle (10 credits = $1, read from billing settings),
// priced VAT-inclusive; Finance V2 extracts VAT and allocates 37/63. A charge is
// only attempted for an explicit customer action (purchase), an opted-in renewal,
// or overage the customer enabled. Nothing here charges a card.

/* Any service-role client (esm.sh or jsr build): only from()/rpc() are used. */
// deno-lint-ignore no-explicit-any
type SupabaseClient = any;
import { formatFrom, newRouteToken, replyAddress, resolveResendKey, type ResolvedKey } from '../resend/client.ts';

export interface EmailSettings {
  killSwitch: boolean;
  studioEnabled: boolean;
  outreachEnabled: boolean;
  route: 'TRANSACTIONAL' | 'BROADCAST';
  replyDomain: string;
  defaultSender: string;
  keyEnvName: string | null;
  alertPct: number;
  creditsPerUsd: number;
}

const truthy = (v: unknown) => v === true || v === 'true';
const str = (v: unknown, d: string) => (typeof v === 'string' && v.trim() ? v.trim() : d);

export async function loadEmailSettings(sb: SupabaseClient): Promise<EmailSettings> {
  const { data } = await sb.from('admin_settings').select('key,value').in('key', [
    'provider_kill_switch', 'email_studio_sending_enabled', 'outreach_email_sending_enabled', 'email_marketing_route',
    'email_marketing_reply_domain', 'email_marketing_default_sender', 'email_marketing_resend_key_env',
    'email_marketing_provider_alert_pct', 'credits_per_usd',
  ]);
  const m = Object.fromEntries((data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
  const cpu = Number(m.credits_per_usd);
  return {
    killSwitch: truthy(m.provider_kill_switch),
    studioEnabled: truthy(m.email_studio_sending_enabled),
    outreachEnabled: truthy(m.outreach_email_sending_enabled),
    route: m.email_marketing_route === 'BROADCAST' ? 'BROADCAST' : 'TRANSACTIONAL',
    replyDomain: str(m.email_marketing_reply_domain, 'reply.homatch.live').toLowerCase(),
    defaultSender: str(m.email_marketing_default_sender, 'CSmarketing@homatch.live'),
    keyEnvName: typeof m.email_marketing_resend_key_env === 'string' ? m.email_marketing_resend_key_env : null,
    alertPct: Number.isFinite(Number(m.email_marketing_provider_alert_pct)) ? Number(m.email_marketing_provider_alert_pct) : 80,
    creditsPerUsd: Number.isFinite(cpu) && cpu > 0 ? cpu : 10,
  };
}

export function marketingKey(s: EmailSettings): ResolvedKey {
  return resolveResendKey('marketing', s.keyEnvName);
}

/* ── identity ────────────────────────────────────────────────────────────── */

export interface Owner { userId: string; authId: string; email: string | null; name: string | null }

export async function ownerFromAuth(sb: SupabaseClient, authId: string): Promise<Owner | null> {
  const { data } = await sb.from('users').select('id, auth_id, email, full_name, nickname').eq('auth_id', authId).maybeSingle();
  if (!data) return null;
  const d = data as { id: string; auth_id: string; email: string | null; full_name: string | null; nickname: string | null };
  return { userId: d.id, authId: d.auth_id, email: d.email, name: d.nickname || d.full_name || null };
}

/* ── sender ──────────────────────────────────────────────────────────────── */

export interface Sender { from: string; address: string; domainId: string | null; custom: boolean }

/**
 * The address a campaign or reply is sent FROM. A customer's own domain only when
 * Resend verified it AND the customer chose a sender on it; otherwise the HOMATCH
 * default identity. Never a free-text address the customer typed.
 */
export async function resolveSender(sb: SupabaseClient, s: EmailSettings, owner: Owner, preferredDomainId?: string | null): Promise<Sender> {
  if (preferredDomainId) {
    const { data } = await sb.from('email_sending_domains')
      .select('id, domain, status, sender_local_part, sender_name')
      .eq('id', preferredDomainId).eq('owner_user_id', owner.userId).maybeSingle();
    const d = data as { id: string; domain: string; status: string; sender_local_part: string | null; sender_name: string | null } | null;
    if (d && d.status === 'VERIFIED' && d.sender_local_part) {
      const address = `${d.sender_local_part}@${d.domain}`;
      return { from: formatFrom(d.sender_name ?? owner.name, address), address, domainId: d.id, custom: true };
    }
  }
  return { from: formatFrom(owner.name ? `${owner.name} via HOMATCH` : 'HOMATCH', s.defaultSender), address: s.defaultSender, domainId: null, custom: false };
}

/* ── reply routing ───────────────────────────────────────────────────────── */

export async function createReplyRoute(
  sb: SupabaseClient, s: EmailSettings, owner: Owner,
  r: { kind: 'STUDIO' | 'OUTREACH' | 'CRM'; campaignId?: string | null; recipientId?: string | null; conversationId?: string | null; contactEmail?: string | null },
): Promise<string> {
  if (r.kind === 'CRM' && r.conversationId) {
    const { data } = await sb.from('email_reply_routes').select('token')
      .eq('conversation_id', r.conversationId).eq('kind', 'CRM').is('revoked_at', null).maybeSingle();
    if (data?.token) return replyAddress(String(data.token), s.replyDomain);
  }
  for (let i = 0; i < 3; i++) {
    const token = newRouteToken();
    const { error } = await sb.from('email_reply_routes').insert({
      token, owner_user_id: owner.userId, owner_auth_id: owner.authId, kind: r.kind,
      campaign_id: r.campaignId ?? null, recipient_id: r.recipientId ?? null,
      conversation_id: r.conversationId ?? null, contact_email: r.contactEmail ? r.contactEmail.toLowerCase() : null,
    });
    if (!error) return replyAddress(token, s.replyDomain);
    if (r.kind === 'CRM' && /email_reply_routes_crm_conv/.test(error.message)) {
      const { data } = await sb.from('email_reply_routes').select('token').eq('conversation_id', r.conversationId!).eq('kind', 'CRM').is('revoked_at', null).maybeSingle();
      if (data?.token) return replyAddress(String(data.token), s.replyDomain);
    }
  }
  throw new Error('REPLY_ROUTE_FAILED');
}

export interface ResolvedRoute {
  token: string; ownerUserId: string; ownerAuthId: string; kind: string;
  campaignId: string | null; recipientId: string | null; conversationId: string | null;
}

/** A live route for a token, or null. Expired and revoked routes do not resolve. */
export async function resolveReplyRoute(sb: SupabaseClient, token: string): Promise<ResolvedRoute | null> {
  const { data } = await sb.from('email_reply_routes')
    .select('token, owner_user_id, owner_auth_id, kind, campaign_id, recipient_id, conversation_id, expires_at, revoked_at')
    .eq('token', token).maybeSingle();
  const d = data as Record<string, string | null> | null;
  if (!d || d.revoked_at || (d.expires_at && Date.parse(d.expires_at) < Date.now())) return null;
  return {
    token: String(d.token), ownerUserId: String(d.owner_user_id), ownerAuthId: String(d.owner_auth_id), kind: String(d.kind),
    campaignId: d.campaign_id, recipientId: d.recipient_id, conversationId: d.conversation_id,
  };
}

/* ── quota ───────────────────────────────────────────────────────────────── */

export interface QuotaGrant {
  reservationId: string | null;
  granted: number;
  included: number;
  overage: number;
  status: string;
  reason?: string;
  remaining?: number;
}

/**
 * Reserve quota for `count` emails and, when the reservation needs new overage
 * blocks, charge them first (email_quota_bill_overage: wallet charge + record in
 * one transaction). If the charge fails the reservation is released and only the
 * included part is offered again (never a send without either allowance or a
 * settled overage charge). A key whose reservation already settled is refused
 * (STALE_KEY): callers use one key per send attempt.
 */
export async function reserveQuota(
  sb: SupabaseClient, s: EmailSettings, owner: Owner, count: number, key: string, source: string,
): Promise<QuotaGrant> {
  const { data, error } = await sb.rpc('email_quota_reserve', {
    p_owner: owner.userId, p_count: count, p_key: key, p_source: source, p_allow_partial: true,
  });
  if (error) throw new Error(`QUOTA_RESERVE_FAILED: ${error.message}`);
  const r = data as { reservationId: string | null; granted: number; included: number; overage: number; blocksToBill: number; status: string; reason?: string; remaining?: number };
  if (!r.reservationId || r.status !== 'RESERVED') {
    return { reservationId: null, granted: 0, included: 0, overage: 0, status: 'REFUSED', reason: r.reason ?? 'QUOTA_EXHAUSTED', remaining: r.remaining };
  }
  if (!r.blocksToBill || r.blocksToBill <= 0) {
    return { reservationId: r.reservationId, granted: r.granted, included: r.included, overage: r.overage, status: r.status, reason: r.reason, remaining: r.remaining };
  }
  const { error: billErr } = await sb.rpc('email_quota_bill_overage', {
    p_reservation: r.reservationId, p_credits_per_block: round4(OVERAGE_BLOCK_USD * s.creditsPerUsd), p_gross_usd_per_block: OVERAGE_BLOCK_USD,
  });
  if (billErr) {
    const m = billErr.message ?? '';
    const reason = m.includes('INSUFFICIENT_CREDITS') ? 'INSUFFICIENT_CREDITS' : m.includes('PRODUCT') ? 'PRODUCT_DISABLED' : 'WALLET_ERROR';
    await sb.rpc('email_quota_release', { p_reservation: r.reservationId });
    if (r.included <= 0) return { reservationId: null, granted: 0, included: 0, overage: 0, status: 'REFUSED', reason };
    return await reserveQuota(sb, { ...s }, owner, r.included, `${key}:included`, source);
  }
  return { reservationId: r.reservationId, granted: r.granted, included: r.included, overage: r.overage, status: 'RESERVED' };
}

/** HOMATCH's overage price: $2.20 per 1,000 emails, VAT-inclusive, sold in whole blocks. */
export const OVERAGE_BLOCK_USD = 2.2;

export async function settleQuota(sb: SupabaseClient, reservationId: string | null, accepted: number): Promise<void> {
  if (!reservationId) return;
  const { error } = await sb.rpc('email_quota_settle', { p_reservation: reservationId, p_sent: Math.max(0, accepted) });
  if (error) console.error('[email-marketing] quota settle failed', reservationId, error.message);
}

/* ── wallet ──────────────────────────────────────────────────────────────── */

/** Release a wallet reservation that will not be settled (purchase rolled back before settlement). */
export async function releaseWallet(sb: SupabaseClient, reservationId: string, reason: string): Promise<void> {
  await sb.rpc('wallet_release', { p_reservation_id: reservationId, p_reason: reason, p_usage: {} });
}

export const PLAN_PRICES: Record<'PRO' | 'SCALE', { grossUsd: number; product: string }> = {
  PRO: { grossUsd: 50, product: 'EMAIL_PLAN_PRO' },
  SCALE: { grossUsd: 220, product: 'EMAIL_PLAN_SCALE' },
};

/**
 * Buy (or renew) a plan month from the wallet. The wallet hold is taken here;
 * email_plan_activate checks it is still held and settles it in the same
 * transaction that activates the period, so a plan is never active without its
 * charge. If activation refuses, the hold is released (a settled hold is not
 * touched: wallet_release is a no-op on it).
 */
export async function purchasePlan(
  sb: SupabaseClient, s: EmailSettings, owner: Owner, plan: 'PRO' | 'SCALE', kind: 'PLAN_PURCHASE' | 'PLAN_RENEWAL', key: string,
  renewsPeriodId: string | null = null,
): Promise<{ ok: boolean; reason?: string; periodId?: string; duplicate?: boolean }> {
  const price = PLAN_PRICES[plan];
  const credits = round4(price.grossUsd * s.creditsPerUsd);
  const { data: res, error } = await sb.rpc('wallet_reserve', {
    p_user_id: owner.userId, p_product_code: price.product, p_authorized_max_credits: credits,
    p_idempotency_key: key, p_estimate_min_credits: credits, p_estimate_max_credits: credits,
    p_job_ref: key.slice(0, 120), p_metadata: { service: 'email_marketing', plan, kind },
  });
  if (error) {
    const m = error.message ?? '';
    return { ok: false, reason: m.includes('INSUFFICIENT_CREDITS') ? 'INSUFFICIENT_CREDITS' : m.includes('PRODUCT') ? 'PRODUCT_DISABLED' : 'WALLET_ERROR' };
  }
  const row = Array.isArray(res) ? res[0] : res;
  const reservationId = row?.reservation_id as string | undefined;
  if (!reservationId) return { ok: false, reason: 'WALLET_ERROR' };

  const { data: act, error: actErr } = await sb.rpc('email_plan_activate', {
    p_owner: owner.userId, p_plan: plan, p_kind: kind, p_credits: credits, p_gross_usd: price.grossUsd,
    p_wallet_reservation: reservationId, p_key: key, p_renews_period: renewsPeriodId,
  });
  if (actErr) {
    const m = actErr.message ?? '';
    const reason = (['ALREADY_ACTIVE', 'RENEWAL_SUPERSEDED', 'WALLET_RESERVATION_NOT_HELD'] as const).find((r) => m.includes(r)) ?? 'ACTIVATION_FAILED';
    await releaseWallet(sb, reservationId, `email_plan_${reason.toLowerCase()}`);
    return { ok: false, reason };
  }
  const a = act as { periodId?: string; duplicate?: boolean };
  return { ok: true, periodId: a?.periodId, duplicate: Boolean(a?.duplicate) };
}

/* ── suppression ─────────────────────────────────────────────────────────── */

export async function isSuppressed(sb: SupabaseClient, owner: Owner, email: string): Promise<boolean> {
  const { data, error } = await sb.rpc('email_address_suppressed', { p_owner_auth: owner.authId, p_email: email });
  if (error) return true; // fail closed: an unanswerable suppression check never sends
  return Boolean(data);
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
