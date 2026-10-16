// storage-retention — object-level retention for an allowlist of disposable
// storage objects (docs/infra/STORAGE_RETENTION.md §10).
//
// Two callers, both POST:
//   * the homatch-storage-retention cron (only once an admin switches on the
//     automatic run), presenting x-cron-token = storage_retention_cron_token;
//   * an admin with their own JWT (public.is_admin()), from Admin → Storage.
//
// Actions:
//   {"action":"tick"}      register new cache files, queue expiry notices,
//                          delete what is due — nothing while paused.
//   {"action":"selftest"}  create two disposable test objects (one Supabase
//                          Storage, one R2) under retention-selftest/, register
//                          them with a two-minute life, and return their ids.
//                          A later tick deletes them; that is the end-to-end
//                          proof, run against real storage.
//   {"action":"cachecheck","limit":3}
//                          read-only gate for the official-document cache:
//                          re-fetch up to 5 cached files from their source and
//                          compare type, size and SHA-256. Changes nothing.
//
// Only locations public.retention_location_eligible() accepts can be deleted,
// and the engine checks the same allowlist again before every delete.
// Nothing here reads report or document content.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { deleteObject, headObject, putObject } from '../_shared/objectStore.ts';
import { tasAttachmentId, tick, type Providers, type RegenerationProof, type Rpc } from '../_shared/retention/engine.ts';
// The same private, service-role-only bucket research-agent caches official documents in.
import { DOCUMENT_BUCKET } from '../../../src/verify/officialDocumentLibrary.ts';

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIEWABLE = new Set(['application/pdf', 'image/jpeg', 'image/png']);
// The smallest well-formed PDF the verify-documents bucket accepts.
const SELFTEST_PDF = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n'
  + 'trailer<</Root 1 0 R>>\n%%EOF\n';

const sha256Hex = async (bytes: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** One fetch from the source research-agent document_file uses on a cache miss. */
async function fetchTasSource(id: string): Promise<{ status: number; contentType: string | null; bytes: Uint8Array } | { error: string }> {
  const worker = Deno.env.get('WORKER_URL') || '';
  const token = Deno.env.get('WORKER_TOKEN') || '';
  if (!worker || !token) return { error: 'WORKER_NOT_CONFIGURED' };
  try {
    const res = await fetch(`${worker}/verify/tas-file?attachedFileId=${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(55000),
    });
    const bytes = res.ok ? new Uint8Array(await res.arrayBuffer()) : (await res.body?.cancel(), new Uint8Array());
    return { status: res.status, contentType: res.headers.get('content-type'), bytes };
  } catch (e) {
    return { error: `source unreachable: ${e instanceof Error ? e.message : e}`.slice(0, 200) };
  }
}

/** Can research-agent rebuild this cached official document from its source right now? */
async function regenerateTasDocument(objectKey: string): Promise<RegenerationProof> {
  const checkedAt = new Date().toISOString();
  const id = tasAttachmentId(objectKey);
  if (!id) return { regenerable: false, method: 'VERIFY_TAS_DOCUMENT', error: 'not a cache key', checkedAt };
  const src = await fetchTasSource(id);
  if ('error' in src) return { regenerable: false, method: 'VERIFY_TAS_DOCUMENT', error: src.error, checkedAt };
  const { status, contentType, bytes } = src;
  const regenerable = status === 200 && !!contentType && VIEWABLE.has(contentType) && bytes.byteLength > 0;
  return {
    regenerable, method: 'VERIFY_TAS_DOCUMENT', status, contentType, bytes: bytes.byteLength, checkedAt,
    ...(regenerable ? {} : { error: `source answered ${status} ${contentType ?? ''}`.trim() }),
  };
}

/**
 * Read-only regeneration gate for the official-document cache: for up to
 * `limit` existing cache files, re-fetch from the source and compare with the
 * cached bytes. Deletes, writes and registers nothing.
 */
async function cacheCheck(sb: ReturnType<typeof createClient>, limit: number) {
  const { data: entries, error } = await sb.storage.from(DOCUMENT_BUCKET).list('files', { limit, sortBy: { column: 'created_at', order: 'desc' } });
  if (error) return { error: `list: ${error.message}` };
  const results = [];
  for (const e of (entries ?? []).slice(0, limit)) {
    const key = `files/${e.name}`;
    const id = tasAttachmentId(key);
    if (!id) { results.push({ key, skipped: 'not a cache key' }); continue; }
    const { data: blob, error: dlErr } = await sb.storage.from(DOCUMENT_BUCKET).download(key);
    const cached = blob ? new Uint8Array(await blob.arrayBuffer()) : null;
    const src = await fetchTasSource(id);
    const fresh = 'error' in src ? null : src;
    const [cachedSha, freshSha] = await Promise.all([cached ? sha256Hex(cached) : null, fresh?.bytes.byteLength ? sha256Hex(fresh.bytes) : null]);
    results.push({
      key,
      cached: cached ? { bytes: cached.byteLength, type: blob?.type ?? null, sha256: cachedSha } : { error: dlErr?.message ?? 'missing' },
      source: fresh ? { status: fresh.status, type: fresh.contentType, bytes: fresh.bytes.byteLength, sha256: freshSha } : { error: (src as { error: string }).error },
      regenerable: !!fresh && fresh.status === 200 && !!fresh.contentType && VIEWABLE.has(fresh.contentType) && fresh.bytes.byteLength > 0,
      identical: !!cachedSha && cachedSha === freshSha,
    });
  }
  return { checked: results.length, regenerable: results.filter((r) => 'regenerable' in r && r.regenerable).length,
    identical: results.filter((r) => 'identical' in r && r.identical).length, results };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !serviceKey || !anonKey) return json({ error: 'UNAVAILABLE' }, 503);
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

  const body = await req.json().catch(() => ({})) as { action?: string; owner?: string; limit?: number };
  if (body.action !== 'tick' && body.action !== 'selftest' && body.action !== 'cachecheck') return json({ error: 'BAD_REQUEST' }, 400);

  // Caller: the cron token, or an admin JWT. Nothing else.
  const presented = req.headers.get('x-cron-token') ?? '';
  let allowed = false;
  let adminAuthId: string | null = null;
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
      if (allowed) adminAuthId = (await caller.auth.getUser()).data.user?.id ?? null;
    }
  }
  if (!allowed) return json({ error: 'FORBIDDEN' }, 403);

  const rpc: Rpc = async (fn, args) => {
    const { data, error } = await sb.rpc(fn, args ?? {});
    if (error) throw new Error(`${fn}: ${error.code ?? ''} ${error.message}`.slice(0, 300));
    return data;
  };

  if (body.action === 'cachecheck') {
    const report = await cacheCheck(sb, Math.min(Math.max(Number(body.limit) || 3, 1), 5));
    console.error(JSON.stringify({ scope: 'storage_retention_cachecheck', checked: (report as { checked?: number }).checked ?? 0,
      regenerable: (report as { regenerable?: number }).regenerable ?? 0, identical: (report as { identical?: number }).identical ?? 0 }));
    return json(report, 'error' in report ? 500 : 200);
  }

  if (body.action === 'selftest') {
    // The test notice goes to the admin who ran it, or to an explicit test
    // account when the cron token runs it.
    const owner = adminAuthId ?? (typeof body.owner === 'string' && UUID.test(body.owner) ? body.owner : null);
    if (!owner) return json({ error: 'SELFTEST_NEEDS_OWNER' }, 400);
    const id = crypto.randomUUID();
    const supaKey = `retention-selftest/${id}.pdf`;
    const r2Key = `retention-selftest/${id}.txt`;
    const pdf = new TextEncoder().encode(SELFTEST_PDF);
    const text = new TextEncoder().encode(`HOMATCH retention self-test ${id} ${new Date().toISOString()}\n`);
    try {
      const { error: upErr } = await sb.storage.from(DOCUMENT_BUCKET).upload(supaKey, pdf, { contentType: 'application/pdf' });
      if (upErr) throw new Error(`supabase upload: ${upErr.message}`);
      await putObject(r2Key, text, 'text/plain');
      if (!(await headObject(r2Key)).exists) throw new Error('r2 object not visible after upload');
      const supaArtifact = await rpc('retention_register_artifact', {
        p_category: 'selftest_supabase', p_object_key: supaKey, p_owner_user_id: owner, p_byte_size: pdf.byteLength,
        p_label: 'Retention self-test file', p_deep_link: '/notifications', p_entity_type: 'retention_selftest',
      });
      const r2Artifact = await rpc('retention_register_artifact', {
        p_category: 'selftest_r2', p_object_key: r2Key, p_owner_user_id: owner, p_byte_size: text.byteLength,
        p_label: 'Retention self-test file (R2)', p_entity_type: 'retention_selftest',
      });
      console.error(JSON.stringify({ scope: 'storage_retention_selftest', id, supaArtifact, r2Artifact }));
      return json({ ok: true, id, artifacts: { supabase: supaArtifact, r2: r2Artifact }, keys: { supabase: supaKey, r2: r2Key }, expiresInSeconds: 120 });
    } catch (e) {
      console.error(JSON.stringify({ scope: 'storage_retention_selftest', id, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) }));
      return json({ error: 'SELFTEST_FAILED', detail: (e instanceof Error ? e.message : String(e)).slice(0, 200) }, 500);
    }
  }

  const providers: Providers = {
    async supabaseRemove(bucket, key) {
      const { error } = await sb.storage.from(bucket).remove([key]);
      if (error) throw new Error(`supabase remove failed: ${error.message}`.slice(0, 300));
    },
    async r2Delete(key) { await deleteObject(key); },
    async r2Exists(key) { return (await headObject(key)).exists; },
    async regenerate(method, key) {
      if (method === 'VERIFY_TAS_DOCUMENT') return regenerateTasDocument(key);
      return { regenerable: false, method, error: 'unknown regeneration method', checkedAt: new Date().toISOString() };
    },
  };

  try {
    const cfg = (await rpc('retention_artifacts_status')) as { settings?: { batch_size?: number } } | null;
    const report = await tick(rpc, providers, { batch: Number(cfg?.settings?.batch_size ?? 10), pauseMs: 150 });
    await rpc('retention_artifacts_log_tick', { p_report: { ...report, via: presented ? 'cron' : 'admin' } }).catch(() => undefined);
    // Counts only — never keys or other users' identifiers.
    console.error(JSON.stringify({ scope: 'storage_retention_tick', ...report, errors: report.errors.length }));
    return json(report);
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    await rpc('retention_artifacts_log_tick', { p_report: { error: msg } }).catch(() => undefined);
    console.error(JSON.stringify({ scope: 'storage_retention_tick', error: msg }));
    return json({ error: 'TICK_FAILED' }, 500);
  }
});
