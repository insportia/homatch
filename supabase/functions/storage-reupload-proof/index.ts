// storage-reupload-proof — a production re-upload through the PRODUCT's own
// server write path, for buckets whose new uploads are routed to R2.
//
// WHAT IT EXERCISES, AND WHAT IT DOES NOT
//
// Every step goes through _shared/storage/routed.ts, the module meta-ads-api,
// deal-room-document-analyze and the developer document functions use:
// readRouted to read an existing file, writeTarget to ask the live per-bucket
// switch where new uploads go, writeRouted (no target override) to write, and
// signRouted / removeRouted to sign and clean up. It never PUTs to R2 itself.
//
// It does NOT exercise the browser path (storage-sign under a signed-in
// customer's token). A PASS here is a backend re-upload PASS only.
//
// IT TOUCHES NOTHING THAT BELONGS TO ANYONE
//
// The source file is only read. The copy goes to a NEW key in the source
// owner's folder, under r2-reupload-test/<uuid>.<ext>, so it can never collide
// with or replace a product file, and no business row (creative, contract,
// offer, document) is created. Cleanup accepts only that shape of path.
//
// AUTHORISED BY A SINGLE-USE TICKET (storage_proof_tickets), like
// storage-selftest. The report carries hashes, sizes and statuses, never file
// content and never a URL.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  ROUTED_BUCKETS, type RoutedBucket, r2KeyFor, r2Store, readRouted, removeRouted, signRouted, writeRouted, writeTarget,
} from '../_shared/storage/routed.ts';

declare const Deno: { env: { get(k: string): string | undefined } };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-proof-ticket',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The only shape this function writes, and so the only one it will remove. */
const TEST_PATH = /^[0-9a-f-]{36}\/r2-reupload-test\/[0-9a-f-]{36}\.[a-z0-9]{1,5}$/i;
const isRouted = (b: unknown): b is RoutedBucket => (ROUTED_BUCKETS as readonly string[]).includes(String(b));
const safeSegments = (p: string) => p.length > 0 && p.length < 512 && !p.split('/').some((s) => s === '' || s === '.' || s === '..');

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ error: 'UNAVAILABLE' }, 503);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* answered below */ }

  // ── The ticket, spent before any work is done ──────────────────────────
  const token = req.headers.get('x-proof-ticket') ?? '';
  if (token.length < 32 || token.length > 200) return json({ error: 'FORBIDDEN' }, 403);
  const { data: ticket, error: ticketErr } = await admin.from('storage_proof_tickets')
    .update({ used_at: new Date().toISOString() })
    .eq('token_sha256', await sha256Hex(token))
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('id')
    .maybeSingle();
  if (ticketErr) {
    console.error('storage-reupload-proof: ticket lookup failed', ticketErr.code ?? 'unknown');
    return json({ error: 'UNAVAILABLE' }, 503);
  }
  if (!ticket) return json({ error: 'FORBIDDEN' }, 403);

  const items = Array.isArray(body.items) ? body.items.slice(0, 4) as Record<string, unknown>[] : [];
  const results: Record<string, unknown>[] = [];

  // Supabase Storage's own copy of the ORIGINAL: present, and the same bytes.
  const supabaseOriginal = async (bucket: RoutedBucket, path: string) => {
    const { data, error } = await admin.storage.from(bucket).download(path);
    if (error || !data) return { present: false, sha256: null as string | null };
    return { present: true, sha256: await sha256Hex(new Uint8Array(await data.arrayBuffer())) };
  };

  if (body.mode === 'upload') {
    for (const it of items) {
      const bucket = it.bucket;
      const sourcePath = String(it.sourcePath ?? '');
      const ownerUserId = String(it.ownerUserId ?? '');
      if (!isRouted(bucket) || !safeSegments(sourcePath) || !UUID.test(ownerUserId)) {
        results.push({ bucket, ok: false, error: 'BAD_ITEM' });
        continue;
      }
      const { data: owner } = await admin.from('users').select('id').eq('id', ownerUserId).maybeSingle();
      const folder = sourcePath.split('/')[0];
      const ext = (sourcePath.split('.').pop() ?? '').toLowerCase();
      if (!owner || !UUID.test(folder) || !/^[a-z0-9]{1,5}$/.test(ext)) {
        results.push({ bucket, ok: false, error: 'BAD_ITEM' });
        continue;
      }

      // 1. Read the original through the product read path.
      const src = await readRouted(admin, bucket, sourcePath);
      if (!src) { results.push({ bucket, sourcePath, ok: false, error: 'SOURCE_UNREADABLE' }); continue; }
      const srcSha = await sha256Hex(src.bytes);
      const before = await supabaseOriginal(bucket, sourcePath);

      // 2. Where the live switch sends new uploads of this bucket.
      const target = await writeTarget(admin, bucket);

      // 3. Write the same bytes to a NEW key through the product write path.
      const testPath = `${folder}/r2-reupload-test/${crypto.randomUUID()}.${ext}`;
      const key = r2KeyFor(bucket, testPath);
      const contentType = src.contentType ?? 'application/octet-stream';
      const wrote = await writeRouted(admin, bucket, testPath, src.bytes, contentType, { ownerUserId });

      // 4. What actually landed, asked of each store and of the index.
      const head = await r2Store.head(key);
      const { data: idx } = await admin.from('storage_objects')
        .select('id, provider, namespace, category, lifecycle, owner_user_id, byte_size, checksum_md5, checksum_sha256, content_type, visibility, verified_at')
        .eq('object_key', key).maybeSingle();
      const back = await readRouted(admin, bucket, testPath);
      const backSha = back ? await sha256Hex(back.bytes) : null;
      const signed = await signRouted(admin, bucket, testPath, 120);
      const viaSigned = signed ? await fetch(signed.url) : null;
      const signedSha = viaSigned?.ok ? await sha256Hex(new Uint8Array(await viaSigned.arrayBuffer())) : null;
      if (viaSigned && !viaSigned.ok) await viaSigned.body?.cancel();
      let unsignedStatus: number | null = null;
      if (signed) {
        const bare = new URL(signed.url);
        bare.search = '';
        const unsigned = await fetch(bare.toString());
        unsignedStatus = unsigned.status;
        await unsigned.body?.cancel();
      }
      const inSupabase = await supabaseOriginal(bucket, testPath);
      const after = await supabaseOriginal(bucket, sourcePath);

      const checks = {
        live_switch_is_r2: target === 'R2',
        write_returned_ok_from_r2: !wrote.error && wrote.source === 'R2',
        r2_object_exists_same_size: head.exists && head.size === src.bytes.byteLength,
        index_active_r2_owner_size_sha256: idx?.provider === 'R2' && idx?.namespace === bucket && idx?.lifecycle === 'ACTIVE'
          && idx?.owner_user_id === ownerUserId && idx?.byte_size === src.bytes.byteLength && idx?.checksum_sha256 === srcSha,
        index_md5_is_r2_etag: !!idx?.checksum_md5 && idx.checksum_md5.replace(/"/g, '') === (head.etag ?? '').replace(/"/g, ''),
        routed_read_from_r2_same_sha256: back?.source === 'R2' && backSha === srcSha,
        signed_url_200_same_sha256: signed?.source === 'R2' && viaSigned?.status === 200 && signedSha === srcSha,
        unsigned_url_refused: unsignedStatus === 400 || unsignedStatus === 403,
        not_written_to_supabase: !inSupabase.present,
        original_untouched_in_supabase: before.present && after.present && after.sha256 === before.sha256 && after.sha256 === srcSha,
      };
      results.push({
        bucket, sourcePath, source_read_from: src.source, testPath, key, storage_object_id: idx?.id ?? null,
        bytes: src.bytes.byteLength, sha256: srcSha, md5_etag: head.etag ?? null, content_type: contentType,
        signed_status: viaSigned?.status ?? null, unsigned_status: unsignedStatus,
        write_error: wrote.error?.message ?? null, checks,
        ok: Object.values(checks).every(Boolean),
      });
    }
  } else if (body.mode === 'cleanup') {
    for (const it of items) {
      const bucket = it.bucket;
      const testPath = String(it.testPath ?? '');
      const sourcePath = String(it.sourcePath ?? '');
      if (!isRouted(bucket) || !TEST_PATH.test(testPath) || !safeSegments(sourcePath)) {
        results.push({ bucket, testPath, ok: false, error: 'NOT_A_TEST_OBJECT' });
        continue;
      }
      const key = r2KeyFor(bucket, testPath);
      const removed = await removeRouted(admin, bucket, [testPath]);
      const head = await r2Store.head(key);
      const { data: idx } = await admin.from('storage_objects').select('lifecycle, deleted_at').eq('object_key', key).maybeSingle();
      const original = await supabaseOriginal(bucket, sourcePath);
      const originalR2 = await r2Store.head(r2KeyFor(bucket, sourcePath));
      const checks = {
        remove_ok: !removed.error,
        r2_object_gone: !head.exists,
        index_marked_deleted: idx?.lifecycle === 'DELETED' && !!idx?.deleted_at,
        original_still_in_supabase: original.present,
        original_still_in_r2: originalR2.exists,
      };
      results.push({ bucket, testPath, key, original_sha256: original.sha256, checks, ok: Object.values(checks).every(Boolean) });
    }
  } else {
    return json({ error: 'BAD_MODE' }, 400);
  }

  const report = { ok: results.length > 0 && results.every((r) => r.ok === true), mode: body.mode, results, finishedAt: new Date().toISOString() };
  await admin.from('storage_proof_tickets').update({ result: report }).eq('id', ticket.id);
  return json(report, report.ok ? 200 : 500);
});
