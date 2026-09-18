// storage-inventory — what is ACTUALLY in the bucket.
//
// WHY THIS IS NOT A QUERY AGAINST storage_objects
//
// The metadata index can only report what it was told. An object nothing
// wrote a row for — an abandoned upload, a stray from a tool, a key written
// by hand in a dashboard — is invisible to it, and those are precisely the
// objects an inventory is for. So the count comes from R2's own listing, and
// the ledger count is reported ALONGSIDE it rather than instead of it. Two
// numbers that should agree are worth more than one number that cannot be
// wrong by construction.
//
// It also names any diagnostic object it finds separately, so a self-test
// left behind is visible rather than quietly counted as production data.
//
// Ticket-gated like the other proof tools: no account, no copy of the
// service key anywhere. It reads and reports; it changes nothing.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { listObjects } from '../_shared/objectStore.ts';

declare const Deno: { env: { get(k: string): string | undefined } };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-proof-ticket',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body, null, 2), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ error: 'UNAVAILABLE' }, 503);
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  const token = req.headers.get('x-proof-ticket') ?? '';
  if (token.length < 32 || token.length > 200) return json({ error: 'FORBIDDEN' }, 403);
  const { data: ticket } = await db.from('storage_proof_tickets')
    .update({ used_at: new Date().toISOString() })
    .eq('token_sha256', await sha256Hex(token))
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('id').maybeSingle();
  if (!ticket) return json({ error: 'FORBIDDEN' }, 403);

  const entries = await listObjects();

  const byPrefix: Record<string, { objects: number; bytes: number }> = {};
  for (const entry of entries) {
    const prefix = entry.key.includes('/') ? `${entry.key.split('/')[0]}/` : '(root)';
    byPrefix[prefix] ??= { objects: 0, bytes: 0 };
    byPrefix[prefix].objects += 1;
    byPrefix[prefix].bytes += entry.size;
  }

  const diagnostics = entries
    .filter((e) => e.key.startsWith('diagnostics/') || e.key.startsWith('site-assets/proof/'))
    .map((e) => e.key);

  const { count: ledgerActive } = await db.from('storage_objects')
    .select('id', { count: 'exact', head: true }).neq('lifecycle', 'DELETED');

  return json({
    TOTAL_R2_OBJECTS: entries.length,
    TOTAL_R2_BYTES: entries.reduce((sum, e) => sum + e.size, 0),
    R2_PREFIX_INVENTORY: byPrefix,
    diagnostic_objects_present: diagnostics,
    // Should equal TOTAL_R2_OBJECTS. A gap either way is the finding.
    ledger_active_rows: ledgerActive ?? null,
    measured_at: new Date().toISOString(),
  });
});
