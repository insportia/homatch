// spend-cap-check — verifies provider spend is within monthly caps before a paid call
// Returns { allowed: boolean, provider_blocked: boolean, global_blocked: boolean }
// Called by other Edge Functions before issuing paid requests.
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

  const { provider } = await req.json() as { provider: string };
  if (!provider) {
    return new Response(JSON.stringify({ error: 'provider required' }), { status: 400, headers: corsHeaders });
  }

  const result = await checkSpendCap(supabase, provider);
  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

export async function checkSpendCap(supabase: any, provider: string): Promise<{
  allowed: boolean;
  provider_blocked: boolean;
  global_blocked: boolean;
  provider_pct: number;
  global_pct: number;
  warning: boolean;
}> {
  const monthStart = new Date();
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  const [settingsRes, costsRes] = await Promise.all([
    supabase.from('admin_settings').select('key, value').like('key', 'spend_cap_%'),
    supabase.from('cost_events').select('provider, cost_usd').gte('timestamp', monthStart.toISOString()),
  ]);

  const caps: Record<string, number> = {};
  for (const s of settingsRes.data ?? []) {
    caps[s.key.replace('spend_cap_', '')] = Number(s.value);
  }

  const spent: Record<string, number> = {};
  for (const c of costsRes.data ?? []) {
    const k = (c.provider as string).toLowerCase();
    spent[k] = (spent[k] ?? 0) + Number(c.cost_usd ?? 0);
  }

  const globalSpent = Object.values(spent).reduce((a, b) => a + b, 0);
  const globalCap = caps['global'] ?? 999999;
  const providerKey = provider.toLowerCase();
  const providerSpent = spent[providerKey] ?? 0;
  const providerCap = caps[providerKey] ?? 999999;

  const global_pct = globalCap > 0 ? (globalSpent / globalCap) * 100 : 0;
  const provider_pct = providerCap > 0 ? (providerSpent / providerCap) * 100 : 0;

  const global_blocked = global_pct >= 100;
  const provider_blocked = provider_pct >= 100;
  const warning = global_pct >= 80 || provider_pct >= 80;

  return {
    allowed: !global_blocked && !provider_blocked,
    provider_blocked,
    global_blocked,
    provider_pct,
    global_pct,
    warning,
  };
}
