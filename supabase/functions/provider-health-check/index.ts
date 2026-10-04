// provider-health-check — tests a single provider and updates provider_health table
// Called by Admin UI "Run Test" button. Returns real status — never marks mock as real.
//
// APIFY (restored 2026-10-04, memo23 only) is tested through memo23Client's
// accountCheck: one free account read, no run, no Actor, no secret returned.
//
// RETIRED PROVIDERS ARE REPORTED, NOT TESTED. DataForSEO is retired
// from the Homatch architecture. This function used to send a live DataForSEO
// SERP query and a live Apify account request whenever an admin pressed "Test"
// -- a billed call to DataForSEO on every press, to a provider nothing may use.
// They now answer RETIRED before any request is built, and the stored row says
// RETIRED so the admin screen stops showing a months-old REAL_TEST_PASSED as if
// the provider were available. Their success/failure counters are left as
// they were: they are history, and a report is not a test.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isRetiredProvider, retiredReason } from '../_shared/retiredProviders.ts';
import { accountCheck, providerConfigured as apifyConfigured, Memo23Error } from '../_shared/findBuyers/memo23Client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Auth — admin only
  const authHeader = req.headers.get('Authorization') ?? '';
  const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
  if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
  const { data: homatchUser } = await supabase.from('users').select('is_admin').eq('auth_id', user.id).single();
  if (!homatchUser?.is_admin) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: corsHeaders });

  const { provider } = await req.json();
  if (!provider) return new Response(JSON.stringify({ error: 'provider required' }), { status: 400, headers: corsHeaders });

  const upper = String(provider).toUpperCase();
  if (isRetiredProvider(upper)) {
    const now = new Date().toISOString();
    await supabase.from('provider_health').upsert({
      provider: upper,
      status: 'RETIRED',
      last_error: null,
      latency_ms: null,
      updated_at: now,
    }, { onConflict: 'provider' });
    return new Response(JSON.stringify({
      provider: upper, status: 'RETIRED', retired: true, latency_ms: null, error: null, note: retiredReason(upper),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const start = Date.now();
  let status = 'NOT_CONFIGURED';
  let lastError: string | null = null;
  let success = false;

  try {
    switch (provider.toUpperCase()) {
      case 'ZENROWS': {
        const key = Deno.env.get('ZENROWS_API_KEY');
        if (!key) { status = 'NOT_CONFIGURED'; break; }
        const r = await fetch(`https://api.zenrows.com/v1/?apikey=${key}&url=https://httpbin.org/get&js_render=false`);
        success = r.ok;
        status = success ? 'REAL_TEST_PASSED' : 'ERROR';
        if (!success) lastError = `HTTP ${r.status}`;
        break;
      }
      case 'APIFY': {
        /* Free account read through the single memo23 client; never a run. */
        if (!apifyConfigured()) { status = 'NOT_CONFIGURED'; break; }
        try {
          await accountCheck();
          success = true; status = 'REAL_TEST_PASSED';
        } catch (e) {
          success = false; status = 'ERROR';
          lastError = e instanceof Memo23Error ? e.message : 'APIFY_CHECK_FAILED';
        }
        break;
      }
      case 'SCRAPINGBEE': {
        const key = Deno.env.get('SCRAPINGBEE_API_KEY');
        if (!key) { status = 'NOT_CONFIGURED'; break; }
        const r = await fetch(`https://app.scrapingbee.com/api/v1/?api_key=${key}&url=https://httpbin.org/get&render_js=false`);
        success = r.ok;
        status = success ? 'REAL_TEST_PASSED' : 'ERROR';
        if (!success) lastError = `HTTP ${r.status}`;
        break;
      }
      case 'BRIGHTDATA': {
        const key = Deno.env.get('BRIGHTDATA_API_KEY');
        if (!key) { status = 'NOT_CONFIGURED'; break; }
        // Minimal check — just validate credentials via account API
        const r = await fetch('https://api.brightdata.com/zones', {
          headers: { Authorization: `Bearer ${key}` },
        });
        success = r.ok;
        status = success ? 'REAL_TEST_PASSED' : 'ERROR';
        if (!success) lastError = `HTTP ${r.status}`;
        break;
      }
      case 'OPENAI': {
        const key = Deno.env.get('OPENAI_API_KEY');
        if (!key) { status = 'NOT_CONFIGURED'; break; }
        const r = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
        });
        success = r.ok;
        status = success ? 'REAL_TEST_PASSED' : 'ERROR';
        if (!success) lastError = `HTTP ${r.status}`;
        break;
      }
      case 'STRIPE': {
        const key = Deno.env.get('PAYMENT_PROVIDER_SECRET');
        if (!key) { status = 'NOT_CONFIGURED'; break; }
        const r = await fetch('https://api.stripe.com/v1/balance', {
          headers: { Authorization: `Bearer ${key}` },
        });
        success = r.ok;
        status = success ? 'REAL_TEST_PASSED' : 'ERROR';
        if (!success) lastError = `HTTP ${r.status}`;
        break;
      }
      case 'RESEND': {
        const key = Deno.env.get('RESEND_API_KEY');
        if (!key) { status = 'NOT_CONFIGURED'; break; }
        const r = await fetch('https://api.resend.com/emails', {
          method: 'GET',
          headers: { Authorization: `Bearer ${key}` },
        });
        // Resend returns 200 or 401 — either way API is reachable
        success = r.status !== 0;
        status = r.status === 401 ? 'ERROR' : 'REAL_TEST_PASSED';
        if (!success) lastError = `HTTP ${r.status}`;
        break;
      }
      case 'TWILIO': {
        const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
        const token = Deno.env.get('TWILIO_AUTH_TOKEN');
        if (!sid || !token) { status = 'NOT_CONFIGURED'; break; }
        const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
          headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}` },
        });
        success = r.ok;
        status = success ? 'REAL_TEST_PASSED' : 'ERROR';
        if (!success) lastError = `HTTP ${r.status}`;
        break;
      }
      case 'RETELL': {
        const key = Deno.env.get('RETELL_API_KEY');
        if (!key) { status = 'NOT_CONFIGURED'; break; }
        const r = await fetch('https://api.retellai.com/list-agents', {
          headers: { Authorization: `Bearer ${key}` },
        });
        success = r.ok;
        status = success ? 'REAL_TEST_PASSED' : 'ERROR';
        if (!success) lastError = `HTTP ${r.status}`;
        break;
      }
      default:
        status = 'NOT_CONFIGURED';
    }
  } catch (e: any) {
    status = 'ERROR';
    lastError = e.message ?? 'Unknown error';
    success = false;
  }

  const latencyMs = Date.now() - start;
  const now = new Date().toISOString();

  // Update provider_health
  const existing = await supabase.from('provider_health').select('success_count, failure_count').eq('provider', provider.toUpperCase()).single();
  const sc = (existing.data?.success_count ?? 0) + (success ? 1 : 0);
  const fc = (existing.data?.failure_count ?? 0) + (success ? 0 : 1);

  await supabase.from('provider_health').upsert({
    provider: provider.toUpperCase(),
    status,
    last_tested_at: now,
    last_success_at: success ? now : existing.data ? undefined : null,
    latency_ms: latencyMs,
    last_error: lastError,
    success_count: sc,
    failure_count: fc,
    updated_at: now,
  }, { onConflict: 'provider' });

  return new Response(JSON.stringify({ provider, status, latency_ms: latencyMs, error: lastError }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
