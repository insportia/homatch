import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: { user }, error: authError } = await db.auth.getUser(token);
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);
    const body = await req.json().catch(() => ({}));
    const propertyId = String(body.propertyId || '');
    if (!propertyId) return json({ error: 'propertyId required' }, 400);

    const { data: actor, error: actorError } = await db.from('users').select('id,role,is_admin').or(`id.eq.${user.id},auth_id.eq.${user.id}`).maybeSingle();
    if (actorError) throw actorError;
    if (!actor) return json({ error: 'User not found' }, 404);
    const { data: property, error: propertyError } = await db.from('properties').select('id,user_id').eq('id', propertyId).maybeSingle();
    if (propertyError) throw propertyError;
    const isAdmin = !!actor.is_admin || ['ADMIN', 'SUPER_ADMIN'].includes(String(actor.role || '').toUpperCase());
    if (!property || (property.user_id !== actor.id && !isAdmin)) return json({ error: 'Forbidden' }, 403);

    const settings = await loadSettings(db, ['external_discovery_enabled', 'provider_kill_switch', 'external_discovery_max_jobs_per_property_tick']);
    if (settings.external_discovery_enabled !== true || settings.provider_kill_switch !== false) {
      return json({ success: true, started: false, blocked: true, propertyId, reason: 'EXTERNAL_DISCOVERY_SAFETY_LOCK' });
    }
    const limit = Math.min(25, Math.max(1, Number(body.limit || settings.external_discovery_max_jobs_per_property_tick || 10)));
    const campaignId = body.campaignId ? String(body.campaignId) : null;
    const work = invokeConsumer(baseUrl, serviceKey, { mode: 'execute', propertyId, campaignId, limit });
    EdgeRuntime.waitUntil(work);
    return json({ success: true, started: true, propertyId, campaignId, maxJobs: limit, eventStream: 'external_discovery_events' }, 202);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

async function loadSettings(db: any, keys: string[]) {
  const { data, error } = await db.from('admin_settings').select('key,value').in('key', keys);
  if (error) throw error;
  return Object.fromEntries((data || []).map((row: any) => [row.key, scalar(row.value)]));
}
async function invokeConsumer(baseUrl: string, serviceKey: string, body: any) {
  const response = await fetch(`${baseUrl}/functions/v1/discovery-queue-worker`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300000),
  });
  const text = await response.text();
  if (!response.ok && response.status !== 423) throw new Error(`discovery-queue-worker ${response.status}: ${text.slice(0, 500)}`);
  return text;
}
function scalar(value: any) { if (typeof value === 'string') { try { return JSON.parse(value); } catch { return value; } } return value; }
