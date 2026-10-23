// HOMATCH — Email Marketing: plans, sending domains, CRM inbox replies, provider usage.
//
//   plan_status / plan_purchase / plan_renew_due (cron)   wallet-paid plans
//   domains_list / domain_add / domain_refresh / domain_verify / domain_set_sender / domain_disconnect
//   inbox_reply                                           one CRM reply in a conversation
//   usage_refresh (admin or cron)                         Resend GET /usage snapshot
//
// Every customer action resolves the caller from their JWT and acts on rows that
// belong to that account; the service role is used for writes the customer may not
// make directly (provider ids, wallet). Nothing here sends bulk mail, and nothing
// here charges without an explicit request (purchase) or prior consent (renewal).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { authenticate, json, preflight, serviceClient, checkRateLimit, logEvent, redact } from '../_shared/comm/auth.ts';
import {
  createDomain, deleteDomain, getDomain, getUsage, listUnsubscribeHeaders, mapDomainStatus, resendKeyNames, sendEmail, usageAlerts, verifyDomain,
} from '../_shared/resend/client.ts';
import {
  createReplyRoute, isSuppressed, loadEmailSettings, loadTestMode, marketingKey, ownerFromAuth, purchasePlan, reserveQuota, resolveSender,
  settleQuota, testModeAllows,
  type EmailSettings, type Owner,
} from '../_shared/emailMarketing/core.ts';
import { renderCampaignEmail } from '../../../src/emailMarketing/campaignTemplate.ts';

type Sb = ReturnType<typeof serviceClient>;

const RESERVED_DOMAINS = ['homatch.live'];
/** An unverified domain claim older than this can be taken over by an account that adds it. */
const UNVERIFIED_CLAIM_MS = 72 * 3_600_000;
/** RFC 5322 msg-id shape; anything else (CR/LF, spaces, brackets) never reaches a header. */
const MESSAGE_ID_RE = /^<[^<>\s]{1,250}>$/;

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'BAD_REQUEST' }, 400); }
  const sb = serviceClient();
  const action = String(body.action ?? '');

  try {
    /* Cron entry points authenticate with the jobs worker token, never a user JWT. */
    if (action === 'plan_renew_due' || action === 'usage_refresh_cron') {
      if (!(await cronAuthorized(sb, req))) return json({ ok: false, error: 'UNAUTHORIZED' }, 401);
      return action === 'plan_renew_due' ? await renewDue(sb) : await usageRefresh(sb);
    }

    const caller = await authenticate(req);
    if (!caller) return json({ ok: false, error: 'UNAUTHORIZED' }, 401);
    const owner = await ownerFromAuth(sb, caller.userId);
    if (!owner) return json({ ok: false, error: 'ACCOUNT_UNAVAILABLE' }, 403);
    const settings = await loadEmailSettings(sb);

    switch (action) {
      case 'plan_status': return await planStatus(caller.sb as unknown as Sb);
      case 'plan_purchase': return await planPurchase(sb, settings, owner, body);
      case 'domains_list': return await domainsList(sb, owner);
      case 'domain_add': return await domainAdd(sb, settings, owner, body);
      case 'domain_refresh': return await domainRefresh(sb, settings, owner, body, false);
      case 'domain_verify': return await domainRefresh(sb, settings, owner, body, true);
      case 'domain_set_sender': return await domainSetSender(sb, owner, body);
      case 'domain_disconnect': return await domainDisconnect(sb, settings, owner, body);
      case 'inbox_reply': return await inboxReply(sb, settings, owner, body);
      case 'campaign_test': return await campaignTest(sb, settings, owner, body);
      case 'usage_refresh': {
        const { data: admin } = await caller.sb.rpc('is_admin');
        if (admin !== true) return json({ ok: false, error: 'FORBIDDEN' }, 403);
        return await usageRefresh(sb);
      }
      default: return json({ ok: false, error: 'UNKNOWN_ACTION' }, 400);
    }
  } catch (e) {
    logEvent('email-marketing', 'action_failed', { action, error: redact((e as Error)?.message) });
    return json({ ok: false, error: 'INTERNAL' }, 500);
  }
});

async function cronAuthorized(sb: Sb, req: Request): Promise<boolean> {
  const token = req.headers.get('x-cron-token') ?? '';
  const { data } = await sb.from('admin_settings').select('value').eq('key', 'jobs_worker_token').maybeSingle();
  const v = (data as { value?: unknown } | null)?.value;
  const expected = v == null ? '' : typeof v === 'string' ? v : String(v);
  if (!expected || token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/* ── plans ───────────────────────────────────────────────────────────────── */

async function planStatus(callerSb: Sb): Promise<Response> {
  const { data, error } = await callerSb.rpc('my_email_plan');
  if (error) return json({ ok: false, error: 'PLAN_UNAVAILABLE' }, 500);
  return json({ ok: true, plan: data });
}

async function planPurchase(sb: Sb, s: EmailSettings, owner: Owner, body: Record<string, unknown>): Promise<Response> {
  const plan = String(body.plan ?? '').toUpperCase();
  if (plan !== 'PRO' && plan !== 'SCALE') return json({ ok: false, error: 'UNKNOWN_PLAN' }, 400);
  const requestId = String(body.requestId ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return json({ ok: false, error: 'REQUEST_ID_REQUIRED' }, 400);
  if (body.confirmed !== true) return json({ ok: false, error: 'CONFIRMATION_REQUIRED' }, 422);

  /* Buying the plan you already have (or a lower one) while more than 3 days are left is refused
     by email_plan_activate under the subscription lock, so two clicks can never both charge. */
  const res = await purchasePlan(sb, s, owner, plan, 'PLAN_PURCHASE', `email-plan:${owner.userId}:${requestId}`);
  if (!res.ok) return json({ ok: false, error: res.reason ?? 'PURCHASE_FAILED' }, res.reason === 'INSUFFICIENT_CREDITS' ? 402 : res.reason === 'ALREADY_ACTIVE' ? 409 : 422);
  logEvent('email-marketing', 'plan_purchased', { plan, duplicate: Boolean(res.duplicate) });
  return json({ ok: true, periodId: res.periodId, duplicate: Boolean(res.duplicate) });
}

/* Opted-in renewals whose period is ending. One charge per (owner, ending period): the key
   names the period, so a re-run of this job cannot renew the same month twice. */
async function renewDue(sb: Sb): Promise<Response> {
  const s = await loadEmailSettings(sb);
  const { data, error } = await sb.rpc('email_plan_due_renewals', { p_limit: 25 });
  if (error) return json({ ok: false, error: error.message }, 500);
  let renewed = 0, insufficient = 0, failed = 0, superseded = 0;
  for (const r of (data ?? []) as Array<{ owner_user_id: string; plan_code: string; period_id: string }>) {
    const { data: u } = await sb.from('users').select('auth_id').eq('id', r.owner_user_id).maybeSingle();
    const owner = u?.auth_id ? await ownerFromAuth(sb, String(u.auth_id)) : null;
    if (!owner || (r.plan_code !== 'PRO' && r.plan_code !== 'SCALE')) { failed++; continue; }
    const res = await purchasePlan(sb, s, owner, r.plan_code, 'PLAN_RENEWAL', `email-renew:${r.owner_user_id}:${r.period_id}`, r.period_id);
    if (res.ok) renewed++;
    else if (res.reason === 'INSUFFICIENT_CREDITS') insufficient++;
    else if (res.reason === 'RENEWAL_SUPERSEDED') superseded++;
    else failed++;
  }
  const { data: lapsed } = await sb.rpc('email_plan_lapse_expired');
  /* Reservations left open by a run that died give their allowance back. */
  const { data: stale } = await sb.rpc('email_quota_release_stale', { p_minutes: 30, p_broadcast_days: 7 });
  const out = { renewed, insufficient, failed, superseded, lapsed: Number(lapsed ?? 0), staleReleased: Number(stale ?? 0) };
  logEvent('email-marketing', 'renewals', out);
  return json({ ok: true, ...out });
}

/* ── domains ─────────────────────────────────────────────────────────────── */

function normaliseDomain(raw: unknown): string | null {
  const d = String(raw ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
  if (!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d) || d.length > 253) return null;
  return d;
}

async function domainsList(sb: Sb, owner: Owner): Promise<Response> {
  const { data } = await sb.from('email_sending_domains')
    .select('id, domain, status, provider_status, region, records, sender_local_part, sender_name, last_error, last_checked_at, verified_at, created_at')
    .eq('owner_user_id', owner.userId).neq('status', 'DISCONNECTED').order('created_at', { ascending: true });
  return json({ ok: true, domains: data ?? [] });
}

async function domainAdd(sb: Sb, s: EmailSettings, owner: Owner, body: Record<string, unknown>): Promise<Response> {
  const domain = normaliseDomain(body.domain);
  if (!domain) return json({ ok: false, error: 'INVALID_DOMAIN' }, 422);
  if (RESERVED_DOMAINS.some((r) => domain === r || domain.endsWith(`.${r}`))) return json({ ok: false, error: 'DOMAIN_RESERVED' }, 422);
  const limit = await checkRateLimit(sb, 'email_domain_add', 10, 86_400, { userId: owner.authId });
  if (!limit.allowed) return json({ ok: false, error: 'RATE_LIMITED' }, 429);

  const key = marketingKey(s).key;
  if (!key) return json({ ok: false, error: 'PROVIDER_NOT_CONFIGURED' }, 503);
  const { data: taken } = await sb.from('email_sending_domains').select('id, owner_user_id, status, resend_domain_id, created_at')
    .eq('domain', domain).neq('status', 'DISCONNECTED').maybeSingle();
  if (taken) {
    const t = taken as { id: string; owner_user_id: string; status: string; resend_domain_id: string | null; created_at: string };
    if (t.owner_user_id === owner.userId) return json({ ok: false, error: 'DOMAIN_ALREADY_ADDED' }, 409);
    /* A claim that never proved DNS control expires after 72 hours, so nobody can squat a
       domain they do not own. A verified domain is never taken over. */
    if (t.status === 'VERIFIED' || Date.parse(t.created_at) > Date.now() - UNVERIFIED_CLAIM_MS) return json({ ok: false, error: 'DOMAIN_IN_USE' }, 409);
    if (t.resend_domain_id) {
      const del = await deleteDomain(key, t.resend_domain_id);
      if (!del.ok && del.status !== 404) return json({ ok: false, error: 'DOMAIN_IN_USE' }, 409);
    }
    const now = new Date().toISOString();
    await sb.from('email_sending_domains').update({ status: 'DISCONNECTED', disconnected_at: now, last_error: 'UNVERIFIED_CLAIM_EXPIRED', updated_at: now })
      .eq('id', t.id).neq('status', 'VERIFIED');
    logEvent('email-marketing', 'domain_claim_expired', {});
  }
  /* Capacity: the account's Resend plan has a domain limit; never promise beyond it. */
  const { data: snap } = await sb.from('email_provider_usage_snapshots').select('usage').eq('ok', true).order('captured_at', { ascending: false }).limit(1).maybeSingle();
  const domains = ((snap as { usage?: { domains?: { used?: number; limit?: number | null } } } | null)?.usage?.domains) ?? null;
  if (domains && typeof domains.limit === 'number' && typeof domains.used === 'number' && domains.used >= domains.limit) {
    return json({ ok: false, error: 'DOMAIN_CAPACITY_REACHED' }, 409);
  }

  const region = ['us-east-1', 'eu-west-1', 'sa-east-1', 'ap-northeast-1'].includes(String(body.region)) ? String(body.region) : 'eu-west-1';
  const created = await createDomain(key, domain, region, `domain-add:${owner.userId}:${domain}`);
  if (!created.ok || !created.json?.id) {
    const err = String(created.error ?? '');
    /* Already registered in the provider account (by another tenant, or outside HOMATCH): never adopt it. */
    if (created.status === 409 || /already|exists/i.test(err)) return json({ ok: false, error: 'DOMAIN_IN_USE' }, 409);
    if (/limit|quota|plan/i.test(err)) return json({ ok: false, error: 'DOMAIN_CAPACITY_REACHED' }, 409);
    logEvent('email-marketing', 'domain_add_provider_error', { error: redact(err.slice(0, 200)) });
    return json({ ok: false, error: 'PROVIDER_ERROR' }, 502);
  }
  const d = created.json;
  const { data: row, error } = await sb.from('email_sending_domains').insert({
    owner_user_id: owner.userId, domain, resend_domain_id: d.id, provider_status: d.status ?? null,
    status: mapDomainStatus(d.status), region, records: d.records ?? [], last_checked_at: new Date().toISOString(),
  }).select('id, domain, status, provider_status, region, records, sender_local_part, sender_name, last_error, last_checked_at, verified_at, created_at').single();
  if (error) {
    /* A concurrent add won the unique index: undo the provider side so no orphan domain remains. */
    await deleteDomain(key, d.id);
    return json({ ok: false, error: 'DOMAIN_IN_USE' }, 409);
  }
  logEvent('email-marketing', 'domain_added', {});
  return json({ ok: true, domain: row });
}

async function ownedDomain(sb: Sb, owner: Owner, id: unknown) {
  const { data } = await sb.from('email_sending_domains').select('*').eq('id', String(id ?? '')).eq('owner_user_id', owner.userId).neq('status', 'DISCONNECTED').maybeSingle();
  return data as Record<string, unknown> | null;
}

async function domainRefresh(sb: Sb, s: EmailSettings, owner: Owner, body: Record<string, unknown>, verify: boolean): Promise<Response> {
  const row = await ownedDomain(sb, owner, body.id);
  if (!row || !row.resend_domain_id) return json({ ok: false, error: 'DOMAIN_NOT_FOUND' }, 404);
  const key = marketingKey(s).key;
  if (!key) return json({ ok: false, error: 'PROVIDER_NOT_CONFIGURED' }, 503);
  if (verify) {
    const limit = await checkRateLimit(sb, 'email_domain_verify', 30, 3600, { userId: owner.authId });
    if (!limit.allowed) return json({ ok: false, error: 'RATE_LIMITED' }, 429);
    const v = await verifyDomain(key, String(row.resend_domain_id));
    if (!v.ok) await sb.from('email_sending_domains').update({ last_error: v.error, updated_at: new Date().toISOString() }).eq('id', row.id);
  }
  const g = await getDomain(key, String(row.resend_domain_id));
  if (!g.ok || !g.json) return json({ ok: false, error: 'PROVIDER_ERROR' }, 502);
  const status = mapDomainStatus(g.json.status);
  const patch: Record<string, unknown> = {
    provider_status: g.json.status ?? null, status, records: g.json.records ?? row.records,
    last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    last_error: status === 'FAILED' ? 'DNS_RECORDS_NOT_FOUND' : null,
  };
  if (status === 'VERIFIED' && !row.verified_at) patch.verified_at = new Date().toISOString();
  const { data } = await sb.from('email_sending_domains').update(patch).eq('id', row.id)
    .select('id, domain, status, provider_status, region, records, sender_local_part, sender_name, last_error, last_checked_at, verified_at, created_at').single();
  return json({ ok: true, domain: data });
}

async function domainSetSender(sb: Sb, owner: Owner, body: Record<string, unknown>): Promise<Response> {
  const row = await ownedDomain(sb, owner, body.id);
  if (!row) return json({ ok: false, error: 'DOMAIN_NOT_FOUND' }, 404);
  const local = String(body.localPart ?? '').trim().toLowerCase();
  if (!/^[a-z0-9._%+-]{1,64}$/.test(local)) return json({ ok: false, error: 'INVALID_SENDER' }, 422);
  const name = String(body.name ?? '').replace(/[<>"\r\n]/g, '').trim().slice(0, 80) || null;
  const { data } = await sb.from('email_sending_domains').update({ sender_local_part: local, sender_name: name, updated_at: new Date().toISOString() })
    .eq('id', row.id).select('id, domain, status, sender_local_part, sender_name').single();
  return json({ ok: true, domain: data });
}

async function domainDisconnect(sb: Sb, s: EmailSettings, owner: Owner, body: Record<string, unknown>): Promise<Response> {
  const row = await ownedDomain(sb, owner, body.id);
  if (!row) return json({ ok: false, error: 'DOMAIN_NOT_FOUND' }, 404);
  const key = marketingKey(s).key;
  if (key && row.resend_domain_id) {
    const del = await deleteDomain(key, String(row.resend_domain_id));
    if (!del.ok && del.status !== 404) return json({ ok: false, error: 'PROVIDER_ERROR' }, 502);
  }
  await sb.from('email_sending_domains').update({ status: 'DISCONNECTED', disconnected_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', row.id);
  return json({ ok: true });
}

/* ── CRM inbox reply ─────────────────────────────────────────────────────── */

const escapeHtml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* ── campaign test send ──────────────────────────────────────────────────── */

/**
 * One copy of an outreach campaign, rendered exactly as recipients will get it, to the owner's
 * OWN account address — never anyone else. The same switches as a real send apply (a
 * controlled live test may lift them for an allowlisted owner), plus suppression, quota (one
 * email) and a per-owner rate limit. Merge fields use the owner's first name.
 */
async function campaignTest(sb: Sb, s: EmailSettings, owner: Owner, body: Record<string, unknown>): Promise<Response> {
  const requestId = String(body.requestId ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return json({ ok: false, error: 'REQUEST_ID_REQUIRED' }, 400);
  const limit = await checkRateLimit(sb, 'email_campaign_test', 20, 3600, { userId: owner.authId });
  if (!limit.allowed) return json({ ok: false, error: 'RATE_LIMITED' }, 429);
  const { data: row } = await sb.from('outreach_campaigns')
    .select('id, name, subject, html_body, text_body, sender_name, language, campaign_type')
    .eq('id', String(body.campaignId ?? '')).eq('owner_id', owner.authId).maybeSingle();
  const c = row as { id: string; name: string; subject: string | null; html_body: string | null; text_body: string | null; sender_name: string | null; language: string | null; campaign_type: string } | null;
  if (!c || c.campaign_type !== 'EMAIL') return json({ ok: false, error: 'CAMPAIGN_NOT_FOUND' }, 404);
  if (!c.text_body?.trim() && !c.html_body?.trim()) return json({ ok: false, error: 'EMPTY_CAMPAIGN' }, 422);
  const to = owner.email;
  if (!to) return json({ ok: false, error: 'NO_ACCOUNT_EMAIL' }, 422);

  const testOk = testModeAllows(await loadTestMode(sb), owner.userId, [to]);
  if (s.killSwitch && !testOk) return json({ ok: false, error: 'PROVIDER_KILL_SWITCH' }, 423);
  if (!s.outreachEnabled && !testOk) return json({ ok: false, error: 'SENDING_DISABLED' }, 423);
  if (await isSuppressed(sb, owner, to)) return json({ ok: false, error: 'RECIPIENT_OPTED_OUT' }, 422);
  const key = marketingKey(s).key;
  if (!key) return json({ ok: false, error: 'PROVIDER_NOT_CONFIGURED' }, 503);

  const grant = await reserveQuota(sb, s, owner, 1, `campaign-test:${owner.userId}:${requestId}`, 'TEST');
  if (!grant.reservationId || grant.granted < 1) return json({ ok: false, error: grant.reason ?? 'QUOTA_EXHAUSTED' }, 402);

  const first = String(owner.name ?? '').trim().split(/\s+/)[0] || '';
  const merge = (text: string) => text.replace(/\{\{\s*(first_name|name)\s*(?:\|([^}]{0,40}))?\}\}/g, (_m, _f, fb?: string) => first || String(fb ?? '').trim());
  const rendered = renderCampaignEmail({
    subject: `[TEST] ${merge(c.subject || c.name)}`,
    bodyHtml: c.html_body ? merge(c.html_body) : null,
    bodyText: c.text_body ? merge(c.text_body) : null,
    senderName: c.sender_name, lang: c.language,
    /* A test has no recipient row to sign: the footer link points at the owner's own settings. */
    unsubscribeUrl: 'https://www.homatch.live/settings',
  });
  const sender = await resolveSender(sb, s, owner, null);
  const result = await sendEmail(key, {
    from: sender.from, to, subject: `[TEST] ${merge(c.subject || c.name)}`, html: rendered.html, text: rendered.text,
    tags: [{ name: 'kind', value: 'campaign_test' }], idempotencyKey: `campaign-test:${requestId}`,
  });
  const accepted = result.ok && Boolean(result.json?.id);
  await settleQuota(sb, grant.reservationId, accepted ? 1 : 0);
  if (!accepted) {
    logEvent('email-marketing', 'campaign_test_provider_error', { error: redact(String(result.error ?? '').slice(0, 200)) });
    return json({ ok: false, error: 'PROVIDER_ERROR' }, 502);
  }
  logEvent('email-marketing', 'campaign_test_sent', { controlledTest: testOk });
  return json({ ok: true, sentTo: to.replace(/^(.).*(@.*)$/, '$1***$2') });
}

async function inboxReply(sb: Sb, s: EmailSettings, owner: Owner, body: Record<string, unknown>): Promise<Response> {
  const text =String(body.text ?? '').replace(/\r\n/g, '\n').trim();
  if (!text || text.length > 20_000) return json({ ok: false, error: 'INVALID_BODY' }, 422);
  const limit = await checkRateLimit(sb, 'email_crm_reply', 60, 3600, { userId: owner.authId });
  if (!limit.allowed) return json({ ok: false, error: 'RATE_LIMITED' }, 429);

  const { data: conv } = await sb.from('comm_conversations')
    .select('id, owner_id, channel, peer_address, peer_name, status, mode')
    .eq('id', String(body.conversationId ?? '')).eq('owner_id', owner.authId).eq('channel', 'EMAIL').maybeSingle();
  const c = conv as { id: string; peer_address: string; peer_name: string | null; mode: string } | null;
  if (!c) return json({ ok: false, error: 'CONVERSATION_NOT_FOUND' }, 404);
  /* Sending switches; a controlled live test (loadTestMode) lifts them for an allowlisted owner
     answering an allowlisted address only. */
  const testOk = testModeAllows(await loadTestMode(sb), owner.userId, [c.peer_address]);
  if (s.killSwitch && !testOk) return json({ ok: false, error: 'PROVIDER_KILL_SWITCH' }, 423);
  if (!s.studioEnabled && !s.outreachEnabled && !testOk) return json({ ok: false, error: 'SENDING_DISABLED' }, 423);
  if (await isSuppressed(sb, owner, c.peer_address)) return json({ ok: false, error: 'RECIPIENT_OPTED_OUT' }, 422);

  const key = marketingKey(s).key;
  if (!key) return json({ ok: false, error: 'PROVIDER_NOT_CONFIGURED' }, 503);
  const requestId = String(body.requestId ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return json({ ok: false, error: 'REQUEST_ID_REQUIRED' }, 400);

  /* Threading: answer the latest message they sent, carrying its references forward. */
  const { data: last } = await sb.from('comm_messages').select('email_meta')
    .eq('conversation_id', c.id).eq('direction', 'INBOUND').order('created_at', { ascending: false }).limit(1).maybeSingle();
  const meta = ((last as { email_meta?: Record<string, unknown> } | null)?.email_meta ?? {}) as Record<string, unknown>;
  /* The inbound Message-ID is sender-controlled: only a well-formed id goes into a header. */
  const parentId = typeof meta.message_id === 'string' && MESSAGE_ID_RE.test(meta.message_id) ? meta.message_id : null;
  const refs = [...(Array.isArray(meta.references) ? meta.references as unknown[] : []), ...(parentId ? [parentId] : [])]
    .filter((r): r is string => typeof r === 'string' && MESSAGE_ID_RE.test(r)).slice(-20);
  const baseSubject = String(meta.subject ?? body.subject ?? '').replace(/^\s*(re:\s*)+/i, '').slice(0, 250);
  const subject = baseSubject ? `Re: ${baseSubject}` : 'Re:';

  const sender = await resolveSender(sb, s, owner, typeof body.domainId === 'string' ? body.domainId : null);
  const replyTo = await createReplyRoute(sb, s, owner, { kind: 'CRM', conversationId: c.id, contactEmail: c.peer_address });
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.6;white-space:pre-wrap">${escapeHtml(text)}</div>`;
  const headers: Record<string, string> = {};
  if (parentId) { headers['In-Reply-To'] = parentId; headers['References'] = refs.join(' '); }
  void listUnsubscribeHeaders; // a 1:1 reply is not a marketing message: no List-Unsubscribe.

  const result = await sendEmail(key, {
    from: sender.from, to: c.peer_address, subject, html, text, replyTo, headers,
    tags: [{ name: 'kind', value: 'crm_reply' }], idempotencyKey: `crm-reply:${c.id}:${requestId}`,
  });
  const providerId = result.json?.id ?? null;
  const accepted = result.ok && Boolean(providerId);
  const now = new Date().toISOString();
  await sb.from('comm_messages').insert({
    conversation_id: c.id, owner_id: owner.authId, direction: 'OUTBOUND', author: 'HUMAN', author_user_id: owner.authId,
    kind: 'TEXT', body: text, html_body: html, status: accepted ? 'SENT' : 'FAILED',
    provider_message_id: providerId ? `resend:${providerId}` : null, error_message: accepted ? null : result.error,
    sent_at: accepted ? now : null,
    email_meta: { subject, in_reply_to: parentId ? [parentId] : [], references: refs, from: sender.address, reply_to: replyTo, request_id: requestId },
  });
  if (accepted) {
    await sb.from('comm_conversations').update({ last_message_at: now, last_message_preview: text.slice(0, 200), unread_count: 0, updated_at: now }).eq('id', c.id);
    await sb.from('cost_events').insert({ provider: 'RESEND', operation_type: 'EMAIL_CRM_REPLY', source: 'email-marketing', units: 1, cost_usd: 0, success: true, cache_hit: false, pricing_state: 'UNPRICED' });
  }
  if (!accepted) {
    logEvent('email-marketing', 'inbox_reply_provider_error', { error: redact(String(result.error ?? '').slice(0, 200)) });
    return json({ ok: false, error: 'PROVIDER_ERROR' }, 502);
  }
  return json({ ok: true, providerMessageId: providerId });
}

/* ── provider usage ──────────────────────────────────────────────────────── */

async function usageRefresh(sb: Sb): Promise<Response> {
  const s = await loadEmailSettings(sb);
  const k = marketingKey(s);
  /* Which key answered — the secret's NAME and whether it fell back to the shared key — is kept
     with every snapshot, so Admin can prove the dedicated marketing key is the one in use. */
  const keyInfo = { keyEnv: k.envName ?? null, keyFallback: Boolean(k.keyFallback), available: resendKeyNames() };
  if (!k.key) {
    await sb.from('email_provider_usage_snapshots').insert({ ok: false, error: 'NO_RESEND_KEY', usage: { _key: keyInfo } });
    return json({ ok: false, error: 'NO_RESEND_KEY' });
  }
  const res = await getUsage(k.key);
  const usage = res.ok ? res.json : null;
  await sb.from('email_provider_usage_snapshots').insert({
    ok: res.ok, error: res.ok ? null : (res.status === 401 || res.status === 403 ? 'KEY_NOT_FULL_ACCESS' : res.error),
    usage: { ...((usage as Record<string, unknown> | null) ?? {}), _key: keyInfo },
  });
  const alerts = res.ok ? usageAlerts(usage as Record<string, unknown>, s.alertPct) : [];
  if (alerts.length) logEvent('email-marketing', 'provider_limit_alert', { alerts: alerts.join(',') });
  return json({ ok: res.ok, keyEnv: k.envName, keyFallback: k.keyFallback, usage, alerts, error: res.ok ? null : res.error });
}
