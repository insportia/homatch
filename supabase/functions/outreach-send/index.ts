// outreach-send Edge Function
// Executes a DRAFT/READY/PAUSED/RUNNING outreach campaign: enqueues one
// outreach_sends row per eligible, non-suppressed contact and dispatches it
// through the real provider adapter (Resend/Twilio/Retell) ONLY when the
// matching admin_settings flag is enabled and provider_kill_switch is false;
// otherwise every send silently goes through the zero-network Mock adapter.
// Processes contacts in small batches per invocation (edge functions have a
// wall-clock limit) — call again with the same campaign_id to continue; it
// never re-sends to a contact that already has a non-failed outreach_sends row.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getEmailAdapter, getSmsAdapter, getVoiceAdapter } from '../_shared/outreach_providers.ts';
import { checkSpendCap } from '../_shared/spend_cap.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Same HMAC helper as _shared/suppression.ts's signUnsubscribeToken (and the
// inlined copy in outreach-unsubscribe/index.ts, which verifies this token).
// Duplicated here rather than imported: this function already has a working
// multi-file deploy bundling outreach_providers.ts and spend_cap.ts, but
// adding a third shared file for one small function proved fragile in this
// sandbox's deploy tool during testing, so it's kept self-contained instead.
// Keep in sync with the other two copies if the signing scheme changes.
async function signUnsubscribeToken(contactId: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(contactId));
  return Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const BATCH_SIZE = 40;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    const { data: { user }, error: authErr } = await createClient(
      Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    ).auth.getUser();
    if (authErr || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    const { data: profileRow } = await supabase.from('users').select('id').eq('auth_id', user.id).maybeSingle();
    if (!profileRow) return new Response(JSON.stringify({ error: 'User profile not found' }), { status: 404, headers: corsHeaders });
    const ownerId = profileRow.id;

    const { campaign_id } = await req.json();
    if (!campaign_id) return new Response(JSON.stringify({ error: 'campaign_id required' }), { status: 400, headers: corsHeaders });

    const { data: campaign, error: campErr } = await supabase.from('outreach_campaigns')
      .select('*').eq('id', campaign_id).eq('owner_id', ownerId).maybeSingle();
    if (campErr || !campaign) return new Response(JSON.stringify({ error: 'Campaign not found' }), { status: 404, headers: corsHeaders });
    if (['COMPLETED', 'CANCELLED'].includes(campaign.status)) {
      return new Response(JSON.stringify({ error: `Campaign is ${campaign.status}, cannot send` }), { status: 400, headers: corsHeaders });
    }
    if (!['EMAIL', 'SMS', 'AI_CALL'].includes(campaign.campaign_type)) {
      return new Response(JSON.stringify({ error: `campaign_type ${campaign.campaign_type} not supported by outreach-send yet` }), { status: 400, headers: corsHeaders });
    }
    if (!campaign.contact_list_id) {
      return new Response(JSON.stringify({ error: 'Campaign has no contact_list_id' }), { status: 400, headers: corsHeaders });
    }

    // ── Safety flags ─────────────────────────────────────────
    const { data: settingsRows } = await supabase.from('admin_settings').select('key,value').in('key', [
      'provider_kill_switch', 'outreach_email_sending_enabled', 'outreach_sms_sending_enabled',
      'outreach_calling_enabled', 'outreach_email_provider', 'outreach_sms_provider', 'outreach_calling_provider',
      'outreach_email_price_per_1k', 'outreach_sms_unit_price',
    ]);
    const fm = Object.fromEntries((settingsRows ?? []).map((s: { key: string; value: unknown }) => [s.key, s.value]));
    const truthy = (v: unknown) => v === true || v === 'true';
    const killSwitch = truthy(fm['provider_kill_switch']);
    if (killSwitch) {
      return new Response(JSON.stringify({
        blocked: true, reason: 'PROVIDER_KILL_SWITCH_ACTIVE',
        message: 'Global provider kill switch is on — no sends (real or mock-labelled-real) will be attempted. Turn it off in Admin → Providers to resume.',
      }), { status: 423, headers: corsHeaders });
    }

    const channel = campaign.campaign_type as 'EMAIL' | 'SMS' | 'AI_CALL';
    const emailEnabled = channel === 'EMAIL' && truthy(fm['outreach_email_sending_enabled']);
    const smsEnabled = channel === 'SMS' && truthy(fm['outreach_sms_sending_enabled']);
    const callingEnabled = channel === 'AI_CALL' && truthy(fm['outreach_calling_enabled']);
    const realProviderName = channel === 'EMAIL' ? 'RESEND' : channel === 'SMS' ? 'TWILIO' : 'RETELL';
    const realEnabled = emailEnabled || smsEnabled || callingEnabled;

    if (realEnabled) {
      const cap = await checkSpendCap(supabase, realProviderName);
      if (!cap.allowed) {
        return new Response(JSON.stringify({
          blocked: true, reason: cap.global_blocked ? 'GLOBAL_SPEND_CAP' : 'PROVIDER_SPEND_CAP',
          message: `${realProviderName} sending is blocked: monthly spend cap reached (${cap.provider_pct.toFixed(0)}% provider / ${cap.global_pct.toFixed(0)}% global). Raise the cap in Admin → Spend Caps to continue.`,
        }), { status: 423, headers: corsHeaders });
      }
    }

    // ── Eligible contacts, excluding ones already attempted ───
    const doNotField = channel === 'AI_CALL' ? 'do_not_call' : 'do_not_contact';
    const contactField = channel === 'EMAIL' ? 'email' : 'phone';

    const { data: alreadySent } = await supabase.from('outreach_sends')
      .select('contact_id').eq('campaign_id', campaign_id).neq('status', 'FAILED');
    const excludeIds = (alreadySent ?? []).map((r: { contact_id: string }) => r.contact_id).filter(Boolean);

    let contactsQuery = supabase.from('outreach_contacts')
      .select('id,email,phone,full_name')
      .eq('list_id', campaign.contact_list_id)
      .eq('owner_id', ownerId)
      .eq('suppressed', false)
      .eq(doNotField, false)
      .eq('unsubscribed', false)
      .not(contactField, 'is', null)
      .limit(BATCH_SIZE);
    if (excludeIds.length) contactsQuery = contactsQuery.not('id', 'in', `(${excludeIds.join(',')})`);

    const { data: contacts, error: contactsErr } = await contactsQuery;
    if (contactsErr) return new Response(JSON.stringify({ error: contactsErr.message }), { status: 500, headers: corsHeaders });

    // Mark campaign RUNNING
    if (['DRAFT', 'READY', 'PAUSED'].includes(campaign.status)) {
      await supabase.from('outreach_campaigns').update({ status: 'RUNNING', updated_at: new Date().toISOString() }).eq('id', campaign_id);
    }

    if (!contacts || contacts.length === 0) {
      const stillPending = await supabase.from('outreach_sends').select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaign_id).in('status', ['DIALING', 'ANSWERED']);
      const isFullyDone = !(stillPending.count && stillPending.count > 0);
      if (isFullyDone) {
        await supabase.from('outreach_campaigns').update({ status: 'COMPLETED', updated_at: new Date().toISOString() }).eq('id', campaign_id);
      }
      return new Response(JSON.stringify({ processed: 0, sent: 0, failed: 0, remaining: 0, campaign_status: isFullyDone ? 'COMPLETED' : campaign.status }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const emailAdapter = channel === 'EMAIL' ? getEmailAdapter(emailEnabled, fm['outreach_email_provider'] as string) : null;
    const smsAdapter = channel === 'SMS' ? getSmsAdapter(smsEnabled, fm['outreach_sms_provider'] as string) : null;
    const voiceAdapter = channel === 'AI_CALL' ? getVoiceAdapter(callingEnabled, fm['outreach_calling_provider'] as string) : null;

    const emailUnitPrice = Number(fm['outreach_email_price_per_1k'] ?? 0.5) / 1000;
    const smsUnitPrice = Number(fm['outreach_sms_unit_price'] ?? 0.05);

    let sentCount = 0, failedCount = 0, costTotal = 0, anyMock = false;

    for (const contact of contacts) {
      const baseRow = {
        campaign_id, contact_id: contact.id, owner_id: ownerId, channel,
        recipient_email: channel === 'EMAIL' ? contact.email : null,
        recipient_phone: channel !== 'EMAIL' ? contact.phone : null,
      };

      if (channel === 'EMAIL' && emailAdapter) {
        // Task #64: every outreach email must carry a working one-click
        // unsubscribe link — outreach_contacts.unsubscribed was already
        // enforced (checked below, and by checkEligibility in
        // _shared/suppression.ts) but nothing could ever set it, because no
        // email ever contained a link and no endpoint existed to handle a
        // click. Token is per-contact HMAC-SHA256, verified server-side in
        // outreach-unsubscribe — a contact can only unsubscribe themselves.
        const unsubToken = await signUnsubscribeToken(contact.id, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
        const unsubUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/outreach-unsubscribe?contact=${encodeURIComponent(contact.id)}&token=${unsubToken}`;
        const bodyHtml = campaign.html_body || `<p>${(campaign.text_body || '').replace(/\n/g, '<br/>')}</p>`;
        const htmlWithFooter = `${bodyHtml}\n<hr style="margin-top:24px;border:none;border-top:1px solid #e5e5e5"/>\n<p style="font-size:11px;color:#888;margin-top:12px">Homatch &middot; <a href="${unsubUrl}" style="color:#888">Unsubscribe</a></p>`;
        const textWithFooter = campaign.text_body ? `${campaign.text_body}\n\n---\nUnsubscribe: ${unsubUrl}` : undefined;
        const result = await emailAdapter.send({
          to: contact.email!, subject: campaign.subject || campaign.name,
          html: htmlWithFooter,
          text: textWithFooter,
          from_name: campaign.sender_name || 'Homatch', from_email: campaign.sender_email || undefined,
          reply_to: campaign.reply_to || undefined, campaign_id,
        });
        anyMock = anyMock || result.is_mock;
        const cost = result.success && !result.is_mock ? emailUnitPrice : 0;
        await supabase.from('outreach_sends').insert({
          ...baseRow, status: result.success ? 'SENT' : 'FAILED', provider: result.is_mock ? 'MOCK' : 'RESEND',
          provider_message_id: result.provider_message_id, error_message: result.error, cost_usd: cost, sent_at: new Date().toISOString(),
        });
        if (result.success) { sentCount++; costTotal += cost; } else failedCount++;
        if (!result.is_mock) await logCost(supabase, 'RESEND', 'OUTREACH_EMAIL_SEND', cost, result.success);
      } else if (channel === 'SMS' && smsAdapter) {
        const result = await smsAdapter.send({ to: contact.phone!, body: campaign.sms_template || '', campaign_id });
        anyMock = anyMock || result.is_mock;
        const cost = result.success && !result.is_mock ? smsUnitPrice : 0;
        await supabase.from('outreach_sends').insert({
          ...baseRow, status: result.success ? 'SENT' : 'FAILED', provider: result.is_mock ? 'MOCK' : 'TWILIO',
          provider_message_id: result.provider_message_id, error_message: result.error, cost_usd: cost, sent_at: new Date().toISOString(),
        });
        if (result.success) { sentCount++; costTotal += cost; } else failedCount++;
        if (!result.is_mock) await logCost(supabase, 'TWILIO', 'OUTREACH_SMS_SEND', cost, result.success);
      } else if (channel === 'AI_CALL' && voiceAdapter) {
        const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/retell-webhook`;
        const result = await voiceAdapter.initiateCall({
          to_phone: contact.phone!, agent_config: campaign.call_agent_config || {}, language: campaign.language || 'en',
          campaign_id, max_duration_sec: campaign.max_call_duration_sec || 300, webhook_url: webhookUrl,
        });
        anyMock = anyMock || result.is_mock;
        await supabase.from('outreach_sends').insert({
          ...baseRow, status: result.success ? 'DIALING' : 'FAILED', provider: result.is_mock ? 'MOCK' : 'RETELL',
          provider_message_id: result.provider_call_id, error_message: result.error, call_started_at: result.success ? new Date().toISOString() : null,
        });
        if (result.success) sentCount++; else failedCount++;
        // Mock calls "complete" immediately since nothing will ever call the webhook for them
        if (result.is_mock && result.success) {
          await supabase.from('outreach_sends').update({
            status: 'COMPLETED', duration_sec: 42, call_ended_at: new Date().toISOString(),
            transcript: '[MOCK] Hello, this is the Homatch assistant calling about your property search...',
            summary: '[MOCK] Simulated call — no real telephony occurred.',
          }).eq('campaign_id', campaign_id).eq('contact_id', contact.id).eq('provider_message_id', result.provider_call_id);
        }
      }
    }

    await supabase.from('outreach_campaigns').update({
      sent_count: (campaign.sent_count || 0) + sentCount,
      cost_actual_usd: Number(campaign.cost_actual_usd || 0) + costTotal,
      updated_at: new Date().toISOString(),
    }).eq('id', campaign_id);

    const remaining = contacts.length === BATCH_SIZE; // heuristic: full batch means there may be more
    if (!remaining) {
      const stillDialing = await supabase.from('outreach_sends').select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaign_id).in('status', ['DIALING', 'ANSWERED']);
      if (!(stillDialing.count && stillDialing.count > 0)) {
        await supabase.from('outreach_campaigns').update({ status: 'COMPLETED', updated_at: new Date().toISOString() }).eq('id', campaign_id);
      }
    }

    return new Response(JSON.stringify({
      processed: contacts.length, sent: sentCount, failed: failedCount, remaining_hint: remaining,
      is_mock: anyMock, campaign_status: remaining ? 'RUNNING' : 'COMPLETED_OR_RUNNING',
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('[outreach-send] error:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});

async function logCost(supabase: any, provider: string, operation_type: string, cost_usd: number, success: boolean) {
  await supabase.from('cost_events').insert({ provider, operation_type, source: 'outreach-send', cost_usd, success, units: 1, cache_hit: false });
}
