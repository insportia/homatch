// spend-cap-check — verifies provider spend is within monthly caps before a paid call
// Returns { allowed: boolean, provider_blocked: boolean, global_blocked: boolean }
// Called by other Edge Functions before issuing paid requests.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { checkSpendCap } from '../_shared/spend_cap.ts';

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

export { checkSpendCap };
