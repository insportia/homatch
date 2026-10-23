// BROADCAST ROUTE — consented bulk marketing through Resend Broadcasts.
//
// Used only when admin_settings.email_marketing_route = "BROADCAST" (default
// TRANSACTIONAL). Resend Marketing is priced by CONTACTS, not sends, so this route
// pays off only when the same contacts are emailed repeatedly; see
// src/emailMarketing/economics.ts.
//
// One outreach campaign = one Resend segment + one broadcast, built in resumable
// steps (each invocation stays inside the edge time budget):
//   1. sync up to SYNC_BATCH eligible contacts into the campaign's segment, each
//      claimed as an outreach_sends row (status QUEUED, provider RESEND_BROADCAST)
//      and covered by a plan-quota reservation kept OPEN until the broadcast sends;
//   2. when nothing is left to sync, create and send the broadcast once
//      (idempotency keys per campaign), then settle every reservation with the
//      synced count and mark the rows SENT with the broadcast id.
// Eligibility is exactly the transactional route's: CONSENTED, not suppressed or
// unsubscribed, not a duplicate — and checked again per address.
//
// Unsubscribing: Resend's own one-click link ({{{RESEND_UNSUBSCRIBE_URL}}}) is
// required in a broadcast; the webhook mirrors contact unsubscribes into HOMATCH's
// global suppression. A Resend contact is account-wide, so an unsubscribe from one
// HOMATCH customer's broadcast stops every broadcast to that address — the
// conservative outcome.

import { createBroadcast, createContact, resendFetch, sendBroadcast } from '../resend/client.ts';
import { type EmailSettings, type Owner, createReplyRoute, isSuppressed, reserveQuota, settleQuota } from './core.ts';

// deno-lint-ignore no-explicit-any
type Sb = any;

export const SYNC_BATCH = 100;

interface BroadcastMeta {
  segmentId?: string;
  broadcastId?: string;
  reservations?: string[];
  synced?: number;
  state?: 'SYNCING' | 'SENT' | 'FAILED';
  error?: string;
}

/** Our {{first_name|fallback}} merge fields in Resend's contact-property syntax. */
export function toBroadcastMergeFields(text: string): string {
  return text.replace(/\{\{\s*(first_name|name)\s*(?:\|([^}]{0,40}))?\}\}/g, (_m, _field: string, fallback?: string) =>
    `{{{contact.first_name|${String(fallback ?? '').replace(/[{}|]/g, '').trim()}}}}`)
    /* A designed email's own unsubscribe block → Resend's per-contact unsubscribe link. */
    .replace(/\{\{\s*unsubscribe_url\s*\}\}/g, '{{{RESEND_UNSUBSCRIBE_URL}}}');
}

export interface BroadcastStepResult {
  state: 'SYNCING' | 'SENT' | 'FAILED' | 'NOTHING_TO_SEND' | 'QUOTA_EXHAUSTED';
  synced: number;
  sent: number;
  broadcastId: string | null;
  error?: string;
}

export async function broadcastStep(
  sb: Sb, key: string, s: EmailSettings, owner: Owner,
  campaign: { id: string; name: string; subject: string | null; html_body: string | null; text_body: string | null; sender_name: string | null; reply_to: string | null; metadata: Record<string, unknown> | null },
  senderFrom: string,
  contacts: Array<{ id: string; email: string | null; full_name: string | null }>,
): Promise<BroadcastStepResult> {
  const meta: BroadcastMeta = { ...((campaign.metadata?.broadcast ?? {}) as BroadcastMeta) };
  const save = async () => {
    await sb.from('outreach_campaigns').update({
      metadata: { ...(campaign.metadata ?? {}), broadcast: meta }, updated_at: new Date().toISOString(),
    }).eq('id', campaign.id);
  };
  if (meta.state === 'SENT') return { state: 'SENT', synced: meta.synced ?? 0, sent: meta.synced ?? 0, broadcastId: meta.broadcastId ?? null };

  if (!meta.segmentId) {
    const seg = await resendFetch<{ id?: string }>(key, 'POST', '/segments', { name: `homatch-campaign-${campaign.id}` }, { idempotencyKey: `segment:${campaign.id}` });
    if (!seg.ok || !seg.json?.id) return { state: 'FAILED', synced: 0, sent: 0, broadcastId: null, error: seg.error ?? 'SEGMENT_FAILED' };
    meta.segmentId = seg.json.id;
    meta.state = 'SYNCING';
    await save();
  }

  /* 1 · sync this batch into the segment */
  if (contacts.length) {
    const digest = await sha(`broadcast:${campaign.id}:${contacts.map((c) => c.id).sort().join(',')}`);
    const grant = await reserveQuota(sb, s, owner, contacts.length, `broadcast-batch:${digest}`, 'BROADCAST');
    if (!grant.reservationId || grant.granted <= 0) return { state: 'QUOTA_EXHAUSTED', synced: meta.synced ?? 0, sent: 0, broadcastId: null, error: grant.reason };
    meta.reservations = [...new Set([...(meta.reservations ?? []), grant.reservationId])];
    let synced = 0;
    for (const c of contacts.slice(0, grant.granted)) {
      if (!c.email) continue;
      if (await isSuppressed(sb, owner, c.email)) {
        await sb.from('outreach_contacts').update({ suppressed: true, suppressed_reason: 'ADDRESS_SUPPRESSED', updated_at: new Date().toISOString() }).eq('id', c.id);
        continue;
      }
      const { data: claim, error: claimErr } = await sb.from('outreach_sends').insert({
        campaign_id: campaign.id, contact_id: c.id, owner_id: owner.authId, channel: 'EMAIL',
        recipient_email: c.email, status: 'QUEUED', provider: 'RESEND_BROADCAST',
      }).select('id').single();
      if (claimErr || !claim) continue; // claimed by a concurrent step: the guard working
      const first = String(c.full_name ?? '').trim().split(/\s+/)[0] || null;
      let added = await createContact(key, { email: c.email, firstName: first, segmentId: meta.segmentId! }, `contact:${campaign.id}:${c.id}`);
      if (!added.ok && (added.status === 409 || /exist/i.test(String(added.error)))) {
        /* Already an account contact (possibly another campaign's): just add it to this segment. */
        added = await resendFetch(key, 'POST', `/contacts/${encodeURIComponent(c.email)}/segments/${encodeURIComponent(meta.segmentId!)}`, undefined, { idempotencyKey: `seg-add:${campaign.id}:${c.id}` });
      }
      if (added.ok) synced++;
      else await sb.from('outreach_sends').update({ status: 'FAILED', error_message: `CONTACT_SYNC:${added.error ?? added.status}`, updated_at: new Date().toISOString() }).eq('id', claim.id);
    }
    meta.synced = (meta.synced ?? 0) + synced;
    await save();
    return { state: 'SYNCING', synced: meta.synced, sent: 0, broadcastId: null };
  }

  /* 2 · nothing left to sync: create and send the broadcast exactly once */
  if (!meta.synced) {
    meta.state = 'SENT';
    await save();
    return { state: 'NOTHING_TO_SEND', synced: 0, sent: 0, broadcastId: null };
  }
  /* Every synced contact is covered by a reservation still open. One the stale sweep released
     (a sync that stalled for days) no longer pays for its contacts: stop rather than send free. */
  const { data: open } = await sb.from('email_quota_reservations').select('id, status').in('id', meta.reservations ?? []);
  if ((open ?? []).length !== (meta.reservations ?? []).length || (open ?? []).some((r: { status: string }) => r.status !== 'RESERVED')) {
    meta.state = 'FAILED'; meta.error = 'QUOTA_RESERVATION_EXPIRED';
    await save();
    for (const r of meta.reservations ?? []) await settleQuota(sb, r, 0);
    return { state: 'FAILED', synced: meta.synced, sent: 0, broadcastId: null, error: meta.error };
  }
  const replyTo = campaign.reply_to || await createReplyRoute(sb, s, owner, { kind: 'OUTREACH', campaignId: campaign.id }).catch(() => undefined);
  const bodyHtml = toBroadcastMergeFields(campaign.html_body || `<p>${(campaign.text_body || '').replace(/\n/g, '<br/>')}</p>`);
  const html = `${bodyHtml}\n<hr style="margin-top:24px;border:none;border-top:1px solid #e5e5e5"/>\n<p style="font-size:11px;color:#888;margin-top:12px">Homatch &middot; <a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#888">Unsubscribe</a></p>`;
  const text = campaign.text_body ? `${toBroadcastMergeFields(campaign.text_body)}\n\n---\nUnsubscribe: {{{RESEND_UNSUBSCRIBE_URL}}}` : undefined;
  if (!meta.broadcastId) {
    const b = await createBroadcast(key, {
      segmentId: meta.segmentId!, from: senderFrom, subject: toBroadcastMergeFields(campaign.subject || campaign.name),
      html, text, replyTo: replyTo ?? undefined, name: `homatch ${campaign.id}`,
    }, `broadcast:${campaign.id}`);
    if (!b.ok || !b.json?.id) {
      meta.state = 'FAILED'; meta.error = b.error ?? 'BROADCAST_CREATE_FAILED';
      await save();
      return { state: 'FAILED', synced: meta.synced, sent: 0, broadcastId: null, error: meta.error };
    }
    meta.broadcastId = b.json.id;
    await save();
  }
  const sent = await sendBroadcast(key, meta.broadcastId!, `broadcast-send:${campaign.id}`);
  if (!sent.ok) {
    meta.state = 'FAILED'; meta.error = sent.error ?? 'BROADCAST_SEND_FAILED';
    await save();
    /* Nothing went out: every reservation is released, so no allowance is consumed. */
    for (const r of meta.reservations ?? []) await settleQuota(sb, r, 0);
    return { state: 'FAILED', synced: meta.synced, sent: 0, broadcastId: meta.broadcastId ?? null, error: meta.error };
  }
  /* Accepted for sending: each synced row is SENT under the broadcast id; delivery comes from webhooks. */
  const { data: rows } = await sb.from('outreach_sends').update({
    status: 'SENT', provider_message_id: meta.broadcastId, sent_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('campaign_id', campaign.id).eq('provider', 'RESEND_BROADCAST').eq('status', 'QUEUED').select('id');
  const sentCount = (rows ?? []).length;
  /* Reservations settle in order until the sent count is used up; the rest is released. */
  let left = sentCount;
  for (const r of meta.reservations ?? []) {
    const { data: res } = await sb.from('email_quota_reservations').select('included_part, overage_part').eq('id', r).maybeSingle();
    const cap = Number(res?.included_part ?? 0) + Number(res?.overage_part ?? 0);
    const use = Math.min(cap, left);
    await settleQuota(sb, r, use);
    left -= use;
  }
  meta.state = 'SENT';
  await save();
  return { state: 'SENT', synced: meta.synced, sent: sentCount, broadcastId: meta.broadcastId ?? null };
}

async function sha(v: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

export { createBroadcast, createContact, sendBroadcast };
