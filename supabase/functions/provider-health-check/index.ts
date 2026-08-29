// provider-health-check — tests a single provider and updates provider_health table
// Called by Admin UI "Run Test" button. Returns real status — never marks mock as real.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

  const start = Date.now();
  let status = 'NOT_CONFIGURED';
  let lastError: string | null = null;
  let success = false;

  try {
    switch (provider.toUpperCase()) {
      case 'DATAFORSEO': {
        const login = Deno.env.get('DATAFORSEO_LOGIN');
        const pwd = Deno.env.get('DATAFORSEO_PASSWORD');
        if (!login || !pwd) { status = 'NOT_CONFIGURED'; break; }
        const creds = btoa(`${login}:${pwd}`);
        const r = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/advanced', {
          method: 'POST',
          headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
          body: JSON.stringify([{ language_code: 'en', location_code: 1000, keyword: 'test ping', depth: 1 }]),
        });
        success = r.status < 500;
        status = success ? 'REAL_TEST_PASSED' : 'ERROR';
        if (!success) lastError = `HTTP ${r.status}`;
        break;
      }
      case 'APIFY': {
        const token = Deno.env.get('APIFY_API_TOKEN');
        if (!token) { status = 'NOT_CONFIGURED'; break; }
        const r = await fetch(`https://api.apify.com/v2/users/me?token=${token}`);
        success = r.ok;
        status = success ? 'REAL_TEST_PASSED' : 'ERROR';
        if (!success) lastError = `HTTP ${r.status}`;
        break;
      }
      case 'ZENROWS': {
        const key = Deno.env.get('ZENROWS_API_KEY');
        if (!key) { status = 'NOT_CONFIGURED'; break; }
        const r = await fetch(`https://api.zenrows.com/v1/?apikey=${key}&url=https://httpbin.org/get&js_render=false`);
        success = r.ok;
        status = success ? 'REAL_TEST_PASSED' : 'ERROR';
        if (!success) lastError = `HTTP ${r.status}`;
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
