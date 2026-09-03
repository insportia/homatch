// outreach-provider-status Edge Function
// Read-only, no side effects. Tells the outreach UI pages (Email/SMS/AI Call
// campaigns) the TRUE resolved sending status per channel — not just the
// admin_settings on/off flag, but whether that flag AND the provider's API
// credentials are both actually present. This exists because
// outreach-campaign-preview's `sending_flags` (and the old static, hardcoded
// "sending is disabled" banners on each page) only ever reflected the
// admin_settings flag: an admin could flip outreach_calling_enabled=true
// without RETELL_API_KEY/RETELL_AGENT_ID/RETELL_FROM_NUMBER configured, and
// every page would tell the user real calls were happening while
// getVoiceAdapter() (supabase/functions/_shared/outreach_providers.ts) was
// silently still falling back to the zero-network Mock adapter underneath.
// Never returns the credential VALUES — only booleans — so it's safe for any
// authenticated user, not just admins (admin_settings itself is admin-only).
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    const { data: { user }, error: authErr } = await createClient(
      Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    ).auth.getUser();
    if (authErr || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: settingsRows } = await supabase.from('admin_settings').select('key,value').in('key', [
      'provider_kill_switch', 'outreach_email_sending_enabled', 'outreach_sms_sending_enabled',
      'outreach_calling_enabled', 'outreach_email_provider', 'outreach_sms_provider', 'outreach_calling_provider',
    ]);
    const fm = Object.fromEntries((settingsRows ?? []).map((s: { key: string; value: unknown }) => [s.key, s.value]));
    const truthy = (v: unknown) => v === true || v === 'true';
    const killSwitch = truthy(fm['provider_kill_switch']);

    const emailEnabled = truthy(fm['outreach_email_sending_enabled']) && !killSwitch;
    const smsEnabled = truthy(fm['outreach_sms_sending_enabled']) && !killSwitch;
    const callingEnabled = truthy(fm['outreach_calling_enabled']) && !killSwitch;

    // Mirrors the exact credential checks in _shared/outreach_providers.ts'
    // getEmailAdapter/getSmsAdapter/getVoiceAdapter — a real adapter is only
    // ever returned when the flag is on AND every required secret is set.
    const emailReal = emailEnabled
      && (fm['outreach_email_provider'] ?? 'RESEND').toString().toUpperCase() === 'RESEND'
      && !!Deno.env.get('RESEND_API_KEY');
    const smsReal = smsEnabled
      && (fm['outreach_sms_provider'] ?? 'TWILIO').toString().toUpperCase() === 'TWILIO'
      && !!Deno.env.get('TWILIO_ACCOUNT_SID') && !!Deno.env.get('TWILIO_AUTH_TOKEN') && !!Deno.env.get('TWILIO_FROM_NUMBER');
    const callingReal = callingEnabled
      && (fm['outreach_calling_provider'] ?? 'RETELL').toString().toUpperCase() === 'RETELL'
      && !!Deno.env.get('RETELL_API_KEY') && !!Deno.env.get('RETELL_AGENT_ID') && !!Deno.env.get('RETELL_FROM_NUMBER');

    return new Response(JSON.stringify({
      kill_switch: killSwitch,
      email: { flag_enabled: emailEnabled, real: emailReal, provider: (fm['outreach_email_provider'] ?? 'RESEND').toString().toUpperCase() },
      sms: { flag_enabled: smsEnabled, real: smsReal, provider: (fm['outreach_sms_provider'] ?? 'TWILIO').toString().toUpperCase() },
      calling: { flag_enabled: callingEnabled, real: callingReal, provider: (fm['outreach_calling_provider'] ?? 'RETELL').toString().toUpperCase() },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('[outreach-provider-status] error:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
