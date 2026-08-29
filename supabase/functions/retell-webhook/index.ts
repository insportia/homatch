// retell-webhook Edge Function
// Receives call_started / call_ended / call_analyzed events from Retell AI
// and updates the matching outreach_sends row so the AI Call Center page's
// live view (Supabase Realtime on outreach_sends) reflects real call state,
// transcript and recording. Also books the actual per-minute cost once the
// call has ended (duration is only known then).
//
// Signature verification: Retell signs the raw body with your Retell API key
// (header x-retell-signature). Verifying it precisely requires Retell's own
// SDK; we do a best-effort HMAC-SHA256 check here and only WARN (not reject)
// when it can't be confirmed, since the exact signing scheme should be
// re-verified against a live Retell account before this goes fully live —
// see the accompanying report for details.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-retell-signature',
};

const STATUS_MAP: Record<string, string> = {
  registered: 'DIALING', ongoing: 'ANSWERED', ended: 'COMPLETED', error: 'FAILED',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const rawBody = await req.text();
    let payload: any;
    try { payload = JSON.parse(rawBody); } catch { return new Response('Invalid JSON', { status: 400, headers: corsHeaders }); }

    const signature = req.headers.get('x-retell-signature');
    const apiKey = Deno.env.get('RETELL_API_KEY');
    if (signature && apiKey) {
      const ok = await verifyHmac(rawBody, apiKey, signature);
      if (!ok) console.warn('[retell-webhook] signature did not verify — proceeding but flagging for review');
    }

    const event = String(payload?.event || '');
    const call = payload?.call || {};
    const callId = String(call?.call_id || '');
    if (!callId) return new Response(JSON.stringify({ error: 'missing call.call_id' }), { status: 400, headers: corsHeaders });

    const { data: sendRow } = await supabase.from('outreach_sends')
      .select('id, campaign_id, contact_id, owner_id')
      .eq('provider_message_id', callId).eq('channel', 'AI_CALL').maybeSingle();
    if (!sendRow) {
      console.warn('[retell-webhook] no matching outreach_sends row for call_id', callId);
      return new Response(JSON.stringify({ ok: true, matched: false }), { headers: corsHeaders });
    }

    const status = STATUS_MAP[String(call?.call_status || '')] ?? (event === 'call_analyzed' ? 'COMPLETED' : undefined);
    const durationSec = call?.start_timestamp && call?.end_timestamp
      ? Math.max(0, Math.round((Number(call.end_timestamp) - Number(call.start_timestamp)) / 1000))
      : undefined;

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (status) update.status = status;
    if (call?.transcript) update.transcript = String(call.transcript).slice(0, 20000);
    if (call?.recording_url) update.recording_url = call.recording_url;
    if (durationSec !== undefined) update.duration_sec = durationSec;
    if (event === 'call_ended' || event === 'call_analyzed') update.call_ended_at = new Date().toISOString();
    if (payload?.call?.call_analysis?.call_summary) update.summary = String(payload.call.call_analysis.call_summary).slice(0, 4000);

    await supabase.from('outreach_sends').update(update).eq('id', sendRow.id);

    // Book real per-minute cost once we know the duration (call_ended / call_analyzed only)
    if (durationSec !== undefined && (event === 'call_ended' || event === 'call_analyzed')) {
      const { data: settingsRow } = await supabase.from('admin_settings').select('value').eq('key', 'outreach_call_price_per_min').maybeSingle();
      const perMin = Number(settingsRow?.value ?? 0.2);
      const cost = Number(((durationSec / 60) * perMin).toFixed(4));
      await supabase.from('outreach_sends').update({ cost_usd: cost }).eq('id', sendRow.id);
      await supabase.from('cost_events').insert({ provider: 'RETELL', operation_type: 'OUTREACH_CALL', source: 'retell-webhook', cost_usd: cost, success: true, units: durationSec, cache_hit: false });
      const { data: camp } = await supabase.from('outreach_campaigns').select('cost_actual_usd').eq('id', sendRow.campaign_id).maybeSingle();
      await supabase.from('outreach_campaigns').update({ cost_actual_usd: Number(camp?.cost_actual_usd || 0) + cost, updated_at: new Date().toISOString() }).eq('id', sendRow.campaign_id);
    }

    return new Response(JSON.stringify({ ok: true, matched: true, status }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('[retell-webhook] error:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});

async function verifyHmac(rawBody: string, secret: string, signature: string): Promise<boolean> {
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
    const hex = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    return hex === signature || `v0=${hex}` === signature || `sha256=${hex}` === signature;
  } catch { return false; }
}
