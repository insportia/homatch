// outreach-sms-webhook Edge Function
// Public, no-auth endpoint (verify_jwt: false, same pattern as retell-webhook
// and outreach-unsubscribe — the caller is Twilio, not a Supabase session)
// that Twilio's inbound-SMS webhook should be pointed at for the number(s)
// SmsCampaignsPage sends from.
//
// Real gap this closes (Task #68, part 1): outreach_contacts.unsubscribed was
// already checked by outreach-send before every SMS send, and
// checkEligibility() in _shared/suppression.ts already treated it as a hard
// stop — but nothing in the system could ever set that flag from a
// recipient's own SMS reply, because no inbound-SMS webhook existed at all.
// A contact texting back "STOP" simply went nowhere.
//
// This does NOT replace carrier/Twilio-level opt-out handling (Twilio's
// Advanced Opt-Out feature, when enabled on the sending number, already
// blocks that number's own future sends automatically at the carrier
// level) — it exists so Homatch's OWN database reflects the same opt-out,
// since a different campaign/list could otherwise still queue that contact
// for a future send that Twilio would silently swallow, and so the contact
// shows as unsubscribed in ContactListsPage/SmsCampaignsPage rather than
// looking reachable when it isn't.
//
// EXTERNAL CONFIGURATION REQUIRED (cannot be done from inside this repo):
// in the Twilio Console, under the sending phone number's Messaging
// configuration, set "A message comes in" to a Webhook pointing at this
// function's URL (https://<project-ref>.supabase.co/functions/v1/outreach-sms-webhook),
// HTTP POST. Until that's configured, Twilio never calls this function and
// inbound replies are simply not delivered anywhere (Twilio's default
// behavior with no webhook configured) — this is the external-provider-
// configuration boundary this implementation goes right up to.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-twilio-signature',
};

// Twilio's own standard keyword sets (https://www.twilio.com/docs/messaging/features/opt-out) —
// matched as the ENTIRE trimmed message body (case-insensitive), same as
// Twilio's own carrier-level matching, not a substring search.
const STOP_KEYWORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit']);
const START_KEYWORDS = new Set(['start', 'yes', 'unstop']);

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string));
}

function twiml(message?: string): Response {
  const body = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  return new Response(body, { headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' } });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });

  try {
    const rawBody = await req.text();
    const params = new URLSearchParams(rawBody);

    const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    const signature = req.headers.get('x-twilio-signature');
    if (authToken && signature) {
      const ok = await verifyTwilioSignature(req.url, params, authToken, signature);
      if (!ok) {
        console.warn('[outreach-sms-webhook] Twilio signature did not verify — rejecting');
        return new Response('Forbidden', { status: 403, headers: corsHeaders });
      }
    } else {
      // Same posture as retell-webhook: proceed but log loudly, since a
      // misconfigured TWILIO_AUTH_TOKEN shouldn't silently swallow real
      // opt-out requests — that's the worse failure mode here.
      console.warn('[outreach-sms-webhook] TWILIO_AUTH_TOKEN not configured or signature missing — proceeding without verification');
    }

    const from = String(params.get('From') || '').trim();
    const body = String(params.get('Body') || '').trim();
    if (!from || !body) return twiml();

    const keyword = body.toLowerCase().replace(/[^a-z]/g, '');
    const isStop = STOP_KEYWORDS.has(keyword);
    const isStart = START_KEYWORDS.has(keyword);
    if (!isStop && !isStart) return twiml(); // an ordinary reply — nothing for this endpoint to do

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: contacts, error } = await supabase
      .from('outreach_contacts')
      .select('id, language')
      .eq('phone', from);
    if (error) {
      console.error('[outreach-sms-webhook] contact lookup failed:', error);
      return twiml();
    }
    if (!contacts || contacts.length === 0) {
      console.warn('[outreach-sms-webhook] no outreach_contacts row for phone', from);
      // Still worth confirming to the sender even if we hold no record for
      // this number under any campaign — Twilio expects an ack either way.
      return twiml(isStop ? 'You have been unsubscribed.' : undefined);
    }

    const ids = contacts.map((c) => c.id);
    if (isStop) {
      await supabase.from('outreach_contacts')
        .update({ unsubscribed: true, unsubscribed_at: new Date().toISOString() })
        .in('id', ids);
      return twiml('You have been unsubscribed from Homatch SMS messages. Reply START to opt back in.');
    }
    await supabase.from('outreach_contacts')
      .update({ unsubscribed: false, unsubscribed_at: null })
      .in('id', ids);
    return twiml('You have been resubscribed to Homatch SMS messages.');
  } catch (err) {
    console.error('[outreach-sms-webhook] error:', err);
    // Twilio expects a 200 + TwiML regardless, or it will retry the webhook
    // repeatedly — an internal error here shouldn't turn into a retry storm.
    return twiml();
  }
});

// Twilio's request-signing scheme: base64(HMAC-SHA1(AuthToken, URL + sorted
// "key"+"value" pairs concatenated in ascending key order)). The URL must be
// exactly what Twilio was configured to call (scheme+host+path, no query
// string differences) — same best-effort caveat as retell-webhook's
// signature check: this should be re-verified against a live Twilio number
// before fully relying on it to reject forged requests.
async function verifyTwilioSignature(url: string, params: URLSearchParams, authToken: string, signature: string): Promise<boolean> {
  try {
    const keys = Array.from(params.keys()).sort();
    let data = url;
    for (const key of keys) data += key + params.get(key);
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(data));
    const b64 = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
    return b64 === signature;
  } catch {
    return false;
  }
}
