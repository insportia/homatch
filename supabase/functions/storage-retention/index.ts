// storage-retention — the 30-day lifecycle tick for Verify reports and
// Contracts documents (docs/infra/STORAGE_RETENTION.md).
//
// Two callers, both POST {"action":"tick"}:
//   * the homatch-storage-retention cron (scheduled only at activation), which
//     presents x-cron-token = admin_settings.storage_retention_cron_token;
//   * an admin, with their own JWT (public.is_admin()), to run one tick by hand.
//
// What a tick may do is decided in Postgres by admin_settings.storage_retention:
// with the seeded defaults it registers records and does nothing else —
// retention_claim returns no work while purge_enabled is false, so no provider
// is ever called. Nothing here reads report or document content, and nothing
// here is on the Verify or Contracts request path.
//
// Dry run and the admin summary are plain RPCs (retention_admin_dry_run,
// retention_admin_summary) the admin page calls directly.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { deleteObject, headObject } from '../_shared/objectStore.ts';
import { tick, type Providers, type Rpc } from '../_shared/retention/engine.ts';

declare const Deno: { env: { get(k: string): string | undefined } };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

function equalConstantTime(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !serviceKey || !anonKey) return json({ error: 'UNAVAILABLE' }, 503);
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

  const body = await req.json().catch(() => ({})) as { action?: string };
  if (body.action !== 'tick') return json({ error: 'BAD_REQUEST' }, 400);

  // Caller: the cron token, or an admin JWT. Nothing else.
  const presented = req.headers.get('x-cron-token') ?? '';
  let allowed = false;
  if (presented) {
    const { data } = await sb.from('admin_settings').select('value').eq('key', 'storage_retention_cron_token').maybeSingle();
    const expected = typeof data?.value === 'string' ? data.value : '';
    allowed = equalConstantTime(presented, expected);
  } else {
    const auth = req.headers.get('Authorization') ?? '';
    if (auth) {
      const caller = createClient(url, anonKey, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
      const { data: isAdmin } = await caller.rpc('is_admin');
      allowed = isAdmin === true;
    }
  }
  if (!allowed) return json({ error: 'FORBIDDEN' }, 403);

  const rpc: Rpc = async (fn, args) => {
    const { data, error } = await sb.rpc(fn, args ?? {});
    if (error) throw new Error(`${fn}: ${error.code ?? ''} ${error.message}`.slice(0, 300));
    return data;
  };
  const providers: Providers = {
    async supabaseRemove(bucket, key) {
      const { error } = await sb.storage.from(bucket).remove([key]);
      if (error) throw new Error(`supabase remove failed: ${error.message}`.slice(0, 300));
    },
    async r2Delete(key) { await deleteObject(key); },
    async r2Exists(key) { return (await headObject(key)).exists; },
  };

  try {
    const report = await tick(rpc, providers, { pauseMs: 150 });
    // Counts only — never keys, ids of other users' content, or URLs.
    console.error(JSON.stringify({ scope: 'storage_retention_tick', claimed: report.claimed, purged: report.purged,
      failed: report.failed, deleted: report.objectsDeleted, retained: report.objectsRetained }));
    return json(report);
  } catch (e) {
    console.error(JSON.stringify({ scope: 'storage_retention_tick', error: (e instanceof Error ? e.message : String(e)).slice(0, 200) }));
    return json({ error: 'TICK_FAILED' }, 500);
  }
});
