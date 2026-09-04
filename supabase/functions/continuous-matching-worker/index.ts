import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-token',
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json' },
});

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const baseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const db = createClient(baseUrl, serviceKey);
  try {
    const expected = String(await setting(db, 'continuous_worker_token', ''));
    if (!expected || req.headers.get('x-cron-token') !== expected) return json({ error: 'Forbidden' }, 403);
    EdgeRuntime.waitUntil(run(db, baseUrl, serviceKey));
    return json({ success: true, started: true, mode: 'internal-first-controlled-external-consumer' });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

async function run(db: any, baseUrl: string, serviceKey: string) {
  const threshold = Number(await setting(db, 'external_discovery_strong_score', 70));
  const minStrong = Number(await setting(db, 'external_discovery_min_strong_matches', 3));
  const freshHours = Number(await setting(db, 'external_discovery_fresh_hours', 24));
  const enabled = await setting(db, 'external_discovery_enabled', false) === true;
  const kill = await setting(db, 'provider_kill_switch', true) !== false;
  const maxProperties = Math.max(0, Number(await setting(db, 'external_discovery_max_properties_per_tick', 4)));
  const maxJobs = Math.min(25, Math.max(1, Number(await setting(db, 'external_discovery_max_jobs_per_property_tick', 10))));
  const freshSince = new Date(Date.now() - freshHours * 3600000).toISOString();
  let externalProperties = 0;
  // NOTE: matching_campaigns has two status columns from a schema migration
  // (legacy text `status`, default 'PENDING', never updated by real write
  // paths; enum `status_v2`, actually set to 'ACTIVE' by match-campaign and
  // payment-webhook). Filtering on legacy `status` here meant this cron
  // worker matched zero real campaigns -- only demo-seeded rows (which set
  // both columns) ever showed up. Filter on status_v2, the column real
  // campaigns actually carry.
  const { data: campaigns, error } = await db.from('matching_campaigns').select(`id,property_id,status_v2,property:properties!property_id(id,matching_status)`).eq('status_v2', 'ACTIVE');
  if (error) throw error;

  for (const campaign of campaigns || []) {
    try {
      const property = Array.isArray(campaign.property) ? campaign.property[0] : campaign.property;
      if (!property || property.matching_status !== 'ACTIVE') continue;
      await invoke(baseUrl, serviceKey, 'run-matching-v2', { propertyId: campaign.property_id, campaignId: campaign.id, intentProfileBatchSize: 2500 }, 150000);
      const { count, error: countError } = await db.from('matches').select('id', { count: 'exact', head: true }).eq('property_id', campaign.property_id).gte('match_score', threshold).gte('created_at', freshSince);
      if (countError) throw countError;
      const strong = Number(count || 0);
      if (strong >= minStrong) {
        console.log('internal sufficient', { propertyId: campaign.property_id, strong });
        continue;
      }
      if (!enabled || kill || externalProperties >= maxProperties) {
        console.log('external deferred', { propertyId: campaign.property_id, strong, enabled, kill });
        continue;
      }
      externalProperties++;
      const result = await invoke(baseUrl, serviceKey, 'discovery-queue-worker', { mode: 'execute', propertyId: campaign.property_id, campaignId: campaign.id, limit: maxJobs }, 300000);
      console.log('controlled external consumer', { propertyId: campaign.property_id, result });
    } catch (error) {
      console.error('continuous campaign', campaign.property_id, error instanceof Error ? error.message : String(error));
    }
  }
}

async function invoke(baseUrl: string, serviceKey: string, functionName: string, body: any, timeout: number) {
  const response = await fetch(`${baseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  const text = await response.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok && response.status !== 423) throw new Error(`${functionName} ${response.status}: ${data?.error || text}`);
  return data;
}
async function setting(db: any, key: string, fallback: any) {
  const { data, error } = await db.from('admin_settings').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  if (data?.value === null || data?.value === undefined) return fallback;
  if (typeof data.value === 'string') { try { return JSON.parse(data.value); } catch { return data.value; } }
  return data.value;
}
