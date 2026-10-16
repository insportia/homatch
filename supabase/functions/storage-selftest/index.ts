// storage-selftest — the proof, not a claim.
//
// It writes real objects into the real bucket, reads them back through real
// signed URLs, shows that the same objects are unreachable without those
// signatures, checks that the metadata index knows about them, deletes them,
// and confirms the deletions. It reports what each step ACTUALLY returned,
// including HTTP status codes, so "does R2 work" is answered with evidence.
//
// IT TOUCHES NOTHING THAT BELONGS TO ANYONE
//
// The diagnostics cycle lives under `diagnostics/`, a namespace that maps to
// no bucket and that no product code may write to. The account-scoped cycle
// writes one object under a REAL account's prefix — because the only way to
// prove account-scoped storage works is to write an account-scoped object —
// and deletes it in the same run, having touched no existing object and no
// business row.
//
// AUTHORISED BY A SINGLE-USE TICKET
//
// Not by an account, not by the service key in somebody's shell. See
// storage_proof_tickets: the caller presents a token, this function compares
// its SHA-256 against an unused, unexpired row, and marks it used before
// doing any work. Replaying the same token gets nothing.
//
// NOTHING IT RETURNS IS A CREDENTIAL. Signed URLs are reported as host and
// path with the signature stripped, because a URL with a signature on it is
// a working key to the object and this report is meant to be pasted
// somewhere.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  StorageUnavailable, deleteObject, envReport, getObject, headObject, putObject, signedUrl,
} from '../_shared/objectStore.ts';
import {
  ROUTED_BUCKETS, r2KeyFor, readRouted, removeRouted, signRouted, writeRouted,
} from '../_shared/storage/routed.ts';

declare const Deno: { env: { get(k: string): string | undefined } };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-proof-ticket',
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

/** A signed URL with the signature removed: safe to print, still identifying. */
function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    const kept = new URLSearchParams();
    for (const [k, v] of u.searchParams) {
      if (k === 'X-Amz-Signature') { kept.set(k, `<${v.length} hex chars, withheld>`); continue; }
      if (k === 'X-Amz-Credential') { kept.set(k, '<withheld>'); continue; }
      kept.set(k, v);
    }
    return `${u.origin.replace(/\/\/[^.]+\./, '//***.')}${u.pathname}?${kept.toString()}`;
  } catch {
    return '<unparseable>';
  }
}

interface Step { step: string; ok: boolean; detail: Record<string, unknown> }

/** Only objects this function itself created may be cleaned up through it. */
const CLEANABLE = /^(site-assets\/proof\/|diagnostics\/)/;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ error: 'UNAVAILABLE' }, 503);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* an empty body is the usual case */ }

  // ── The ticket, spent before any work is done ──────────────────────────
  const token = req.headers.get('x-proof-ticket') ?? '';
  if (token.length < 32 || token.length > 200) return json({ error: 'FORBIDDEN' }, 403);
  const tokenHash = await sha256Hex(token);

  const { data: ticket, error: ticketErr } = await admin
    .from('storage_proof_tickets')
    .update({ used_at: new Date().toISOString() })
    .eq('token_sha256', tokenHash)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('id')
    .maybeSingle();

  if (ticketErr) {
    console.error('storage-selftest: ticket lookup failed', ticketErr.code ?? 'unknown');
    return json({ error: 'UNAVAILABLE' }, 503);
  }
  // Expired, already spent and never existed all answer identically.
  if (!ticket) return json({ error: 'FORBIDDEN' }, 403);

  // ── Cleanup mode: remove an object an earlier run left for inspection ──
  if (typeof body.cleanupKey === 'string') {
    if (!CLEANABLE.test(body.cleanupKey)) return json({ error: 'FORBIDDEN' }, 403);
    await deleteObject(body.cleanupKey);
    const after = await headObject(body.cleanupKey);
    await admin.from('storage_objects')
      .update({ lifecycle: 'DELETED', deleted_at: new Date().toISOString() })
      .eq('object_key', body.cleanupKey);
    return json({ cleaned: body.cleanupKey, still_exists: after.exists }, after.exists ? 500 : 200);
  }


  // ── Verify mode: what a REAL upload put into R2, read back and checked ──
  // For objects under a routed bucket's namespace (a customer's actual upload
  // after the bucket's switch moved to R2): GET the bytes from R2 and hash
  // them, compare size and md5 with R2's HEAD and with the index row, fetch
  // the object through a fresh signed URL (same sha256) and through the bare
  // URL (must be refused). Nothing is changed except one thing the browser
  // commit cannot record: an empty checksum_sha256 is filled in, and only
  // when size and md5 already agree. The report holds hashes and sizes, never
  // content and never a URL.
  if (Array.isArray(body.verifyKeys)) {
    const keys = body.verifyKeys.filter((k): k is string => typeof k === 'string').slice(0, 20);
    const results: Record<string, unknown>[] = [];
    const etagOf = (e: string | null | undefined) => (e ?? '').replace(/"/g, '').toLowerCase();
    for (const k of keys) {
      const ns = k.split('/')[0];
      if (!(ROUTED_BUCKETS as readonly string[]).includes(ns) || k.split('/').some((s) => s === '' || s === '.' || s === '..')) {
        results.push({ key: k, ok: false, error: 'NOT_A_ROUTED_KEY' });
        continue;
      }
      const { data: idx } = await admin.from('storage_objects')
        .select('lifecycle, byte_size, checksum_md5, checksum_sha256, owner_user_id, content_type, created_at')
        .eq('object_key', k).maybeSingle();
      const head = await headObject(k);
      const res = await getObject(k);
      const bytes = res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
      if (!res.ok) await res.body?.cancel();
      const sha = bytes ? await sha256Hex(bytes) : null;
      const signed = await signedUrl({ action: 'READ', key: k, expiresIn: 120 });
      const viaSigned = await fetch(signed.url);
      const signedSha = viaSigned.ok ? await sha256Hex(new Uint8Array(await viaSigned.arrayBuffer())) : null;
      if (!viaSigned.ok) await viaSigned.body?.cancel();
      const bare = new URL(signed.url);
      bare.search = '';
      const unsigned = await fetch(bare.toString());
      await unsigned.body?.cancel();
      const checks = {
        indexed_active: idx?.lifecycle === 'ACTIVE',
        size_matches: !!bytes && head.size === bytes.byteLength && idx?.byte_size === bytes.byteLength,
        md5_index_matches_r2_etag: !!idx?.checksum_md5 && etagOf(idx.checksum_md5) === etagOf(head.etag),
        sha256_matches_index: idx?.checksum_sha256 ? idx.checksum_sha256 === sha : null,
        signed_read_200_same_sha256: viaSigned.status === 200 && signedSha === sha,
        unsigned_read_refused: unsigned.status === 400 || unsigned.status === 403,
      };
      let sha256Recorded = false;
      if (idx && !idx.checksum_sha256 && sha && checks.size_matches && checks.md5_index_matches_r2_etag) {
        const now = new Date().toISOString();
        const { error } = await admin.from('storage_objects')
          .update({ checksum_sha256: sha, verified_at: now, updated_at: now })
          .eq('object_key', k).is('checksum_sha256', null);
        sha256Recorded = !error;
      }
      const ok = checks.indexed_active && checks.size_matches && checks.md5_index_matches_r2_etag
        && checks.sha256_matches_index !== false && checks.signed_read_200_same_sha256 && checks.unsigned_read_refused;
      results.push({
        key: k, ok, bytes: bytes?.byteLength ?? null, sha256: sha, content_type: idx?.content_type ?? null,
        owner_user_id: idx?.owner_user_id ?? null, uploaded_at: idx?.created_at ?? null,
        signed_status: viaSigned.status, unsigned_status: unsigned.status, checks, sha256_recorded: sha256Recorded,
      });
    }
    const report = { ok: results.length > 0 && results.every((r) => r.ok === true), mode: 'verify', results, finishedAt: new Date().toISOString() };
    await admin.from('storage_proof_tickets').update({ result: report }).eq('id', ticket.id);
    return json(report, report.ok ? 200 : 500);
  }

  const steps: Step[] = [];
  const runId = crypto.randomUUID();
  const key = `diagnostics/selftest/${runId}.txt`;
  const payload = `homatch r2 selftest ${runId} ${new Date().toISOString()}\n`;
  const payloadHash = await sha256Hex(payload);
  let cleanupNeeded = false;

  const record = (step: string, ok: boolean, detail: Record<string, unknown>) => {
    steps.push({ step, ok, detail });
    return ok;
  };

  try {
    // ── 1. The five secrets are present. Names and booleans only. ───────
    const env = envReport();
    record('1_secrets_present', env.allPresent, {
      present: env.present,
      bucket: env.bucket,
      signing_region: env.region,
      endpoint: env.endpointSuffix,
      values_printed: false,
    });
    if (!env.allPresent) return json({ ok: false, runId, steps }, 503);

    // ── 2. A real authenticated private upload ──────────────────────────
    const put = await putObject(key, payload, 'text/plain; charset=utf-8');
    cleanupNeeded = true;
    record('2_private_upload', true, { key, bytes: payload.length, etag: put.etag });

    // ── 3. The object really exists, according to R2 itself ─────────────
    const facts = await headObject(key);
    record(
      '3_object_exists_in_r2',
      facts.exists && facts.size === payload.length && facts.etag === put.etag,
      { key, ...facts, expected_bytes: payload.length, expected_etag: put.etag },
    );

    // ── 4. A short-lived signed read returns the same bytes ─────────────
    const read = await signedUrl({ action: 'READ', key, expiresIn: 120 });
    const readRes = await fetch(read.url);
    const readBody = await readRes.text();
    const readHash = await sha256Hex(readBody);
    record('4_signed_read', readRes.ok && readHash === payloadHash, {
      status: readRes.status,
      expires_at: read.expiresAt,
      bytes: readBody.length,
      sha256_matches_upload: readHash === payloadHash,
      url: redactUrl(read.url),
    });

    // ── 5a. The same object, unsigned, is refused ───────────────────────
    const bare = new URL(read.url);
    bare.search = '';
    const unsignedRes = await fetch(bare.toString());
    const unsignedBody = await unsignedRes.text();
    const leaked = unsignedBody.includes(runId);
    record('5a_unsigned_read_refused', !unsignedRes.ok && !leaked, {
      status: unsignedRes.status,
      url: `${bare.origin.replace(/\/\/[^.]+\./, '//***.')}${bare.pathname}`,
      response_contains_the_object: leaked,
      r2_error_code: /<Code>([^<]+)<\/Code>/.exec(unsignedBody)?.[1] ?? null,
      meaning: 'public bucket access is disabled; the object is not served without a signature',
    });

    // ── 5b. A tampered signature is refused ─────────────────────────────
    const tampered = new URL(read.url);
    const sig = tampered.searchParams.get('X-Amz-Signature') ?? '';
    tampered.searchParams.set('X-Amz-Signature', (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1));
    const tamperedRes = await fetch(tampered.toString());
    await tamperedRes.body?.cancel();
    record('5b_tampered_signature_refused', tamperedRes.status === 403, {
      status: tamperedRes.status,
    });

    // ── 5c. A signed URL for a DIFFERENT key does not open this one ─────
    const otherSigned = await signedUrl({
      action: 'READ', key: `diagnostics/selftest/${crypto.randomUUID()}.txt`, expiresIn: 60,
    });
    const swapped = new URL(otherSigned.url);
    swapped.pathname = new URL(read.url).pathname;
    const swappedRes = await fetch(swapped.toString());
    await swappedRes.body?.cancel();
    record('5c_signature_is_bound_to_its_key', swappedRes.status === 403, {
      status: swappedRes.status,
    });

    // ── 5d. Expiry is real, measured by waiting for it ──────────────────
    const shortLived = await signedUrl({ action: 'READ', key, expiresIn: 15 });
    const beforeRes = await fetch(shortLived.url);
    await beforeRes.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 17_000));
    const afterRes = await fetch(shortLived.url);
    await afterRes.body?.cancel();
    record('5d_signed_url_expires', beforeRes.ok && afterRes.status === 403, {
      before_expiry_status: beforeRes.status,
      waited_seconds: 17,
      after_expiry_status: afterRes.status,
      requested_lifetime_seconds: 15,
    });

    // ── 6. Delete the test object ───────────────────────────────────────
    await deleteObject(key);
    cleanupNeeded = false;
    record('6_delete', true, { key });

    // ── 7. It is really gone ────────────────────────────────────────────
    const after = await headObject(key);
    const goneRes = await getObject(key);
    await goneRes.body?.cancel();
    record('7_deletion_confirmed', !after.exists && goneRes.status === 404, {
      key, head_exists: after.exists, get_status: goneRes.status,
    });

    // ── 8. A MIGRATED object is byte-identical, read back from R2 ───────
    // Not a test object: two of the fourteen real ones, chosen from the
    // ledger, read out of R2 and compared with the Supabase original that
    // is still sitting there untouched.
    for (const bucket of ['deal-room-documents', 'voice-auditions']) {
      const { data: rows } = await admin.from('storage_objects')
        .select('object_key, source_bucket, source_path, byte_size, checksum_sha256')
        .eq('source_bucket', bucket).limit(1);
      const row = rows?.[0];
      if (!row) { record(`8_${bucket}_migrated_read`, false, { reason: 'no ledger row' }); continue; }

      const src = await admin.storage.from(row.source_bucket!).download(row.source_path!);
      const srcSha = src.data
        ? await sha256Hex(new Uint8Array(await src.data.arrayBuffer())) : null;

      const signedRead = await signedUrl({ action: 'READ', key: row.object_key, expiresIn: 60 });
      const r2Res = await fetch(signedRead.url);
      const r2Bytes = r2Res.ok ? new Uint8Array(await r2Res.arrayBuffer()) : null;
      const r2Sha = r2Bytes ? await sha256Hex(r2Bytes) : null;

      record(`8_${bucket}_migrated_read`,
        r2Res.ok && !!srcSha && srcSha === r2Sha && r2Bytes?.byteLength === Number(row.byte_size),
        {
          r2_key: row.object_key,
          supabase_source: `${row.source_bucket}/${row.source_path}`,
          status: r2Res.status,
          bytes: r2Bytes?.byteLength ?? null,
          ledger_bytes: Number(row.byte_size),
          supabase_sha256_equals_r2_sha256: srcSha === r2Sha,
          ledger_sha256_matches: row.checksum_sha256 === r2Sha,
          supabase_original_still_present: !!src.data,
        });
    }

    // ── 9. A NEW account-scoped private object, end to end ──────────────
    // The key shape the product now writes: users/<account>/<category>/...
    // It is created, proven, indexed, and removed inside this one run.
    const accountId = typeof body.accountId === 'string' ? body.accountId : null;
    if (accountId) {
      const objectId = crypto.randomUUID();
      const acctKey = `users/${accountId}/generated-reports/${objectId}.txt`;
      const acctPayload = `homatch account-scoped proof ${objectId}\n`;
      const acctSha = await sha256Hex(acctPayload);

      const acctPut = await putObject(acctKey, acctPayload, 'text/plain; charset=utf-8');
      await admin.from('storage_objects').upsert({
        provider: 'R2', namespace: 'users', category: 'generated-reports',
        object_key: acctKey, owner_user_id: accountId,
        entity_type: 'report', purpose: 'STORAGE_PROOF',
        original_filename: 'account-scoped-proof.txt',
        content_type: 'text/plain', byte_size: acctPayload.length,
        checksum_sha256: acctSha, checksum_md5: acctPut.etag,
        visibility: 'PRIVATE', lifecycle: 'ACTIVE',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'object_key' });

      const acctFacts = await headObject(acctKey);
      const acctSigned = await signedUrl({ action: 'READ', key: acctKey, expiresIn: 60 });
      const acctRes = await fetch(acctSigned.url);
      const acctBack = await acctRes.text();

      const acctBare = new URL(acctSigned.url);
      acctBare.search = '';
      const acctUnsigned = await fetch(acctBare.toString());
      const acctUnsignedBody = await acctUnsigned.text();

      // The index must be able to find it, by owner.
      const { data: indexed } = await admin.from('storage_objects')
        .select('object_key, owner_user_id, category, byte_size, lifecycle')
        .eq('object_key', acctKey).maybeSingle();

      record('9_account_scoped_object', Boolean(
        acctFacts.exists
        && acctRes.ok
        && acctBack === acctPayload
        && !acctUnsigned.ok
        && !acctUnsignedBody.includes(objectId)
        && indexed?.owner_user_id === accountId,
      ), {
        key: acctKey,
        exists_in_r2: acctFacts.exists,
        signed_read_status: acctRes.status,
        bytes_match: acctBack === acctPayload,
        unsigned_read_status: acctUnsigned.status,
        indexed_owner: indexed?.owner_user_id ?? null,
        indexed_category: indexed?.category ?? null,
        indexed_lifecycle: indexed?.lifecycle ?? null,
      });

      await deleteObject(acctKey);
      const acctGone = await headObject(acctKey);
      await admin.from('storage_objects').update({
        lifecycle: 'DELETED', deleted_at: new Date().toISOString(),
      }).eq('object_key', acctKey);
      record('10_account_scoped_object_removed', !acctGone.exists, {
        key: acctKey, still_exists: acctGone.exists,
      });
    }

    // ── 12. Bucket-path routing (_shared/storage/routed.ts), end to end ──
    // For EVERY routed bucket: a tiny PNG written through writeRouted to R2 at
    // <bucket>/<account>/selftest/ must be confirmed, indexed ACTIVE, read back
    // R2-first with the same sha256, signed, and removed from both stores. A
    // second file that exists ONLY in Supabase Storage must be read through the
    // Supabase fallback. All of them live under the test account's selftest/
    // folder and are gone when the run ends. (Every routed bucket accepts PNG.)
    if (body.routed === true && accountId) {
      const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
      const srcSha = await sha256Hex(png);
      for (const bucket of ROUTED_BUCKETS) {
        const r2Path = `${accountId}/selftest/${crypto.randomUUID()}.png`;
        const r2Key = r2KeyFor(bucket, r2Path);
        const wrote = await writeRouted(admin, bucket, r2Path, png, 'image/png', { ownerUserId: accountId, target: 'R2' });
        const { data: idx } = await admin.from('storage_objects').select('lifecycle, owner_user_id, checksum_sha256, byte_size')
          .eq('object_key', r2Key).maybeSingle();
        const back = await readRouted(admin, bucket, r2Path);
        const signedR2 = await signRouted(admin, bucket, r2Path, 120);
        const fetched = signedR2 ? await fetch(signedR2.url) : null;
        const fetchedSha = fetched?.ok ? await sha256Hex(new Uint8Array(await fetched.arrayBuffer())) : null;
        record(`12a_${bucket}_routed_write_to_r2_confirmed_and_indexed`, !wrote.error && wrote.source === 'R2'
          && idx?.lifecycle === 'ACTIVE' && idx?.owner_user_id === accountId && idx?.checksum_sha256 === srcSha && idx?.byte_size === png.byteLength, {
          key: r2Key, error: wrote.error?.message ?? null, indexed: idx ?? null,
        });
        record(`12b_${bucket}_routed_read_r2_first`, back?.source === 'R2' && !!back && (await sha256Hex(back.bytes)) === srcSha, { source: back?.source ?? null });
        record(`12c_${bucket}_routed_signed_download`, signedR2?.source === 'R2' && fetched?.status === 200 && fetchedSha === srcSha, {
          source: signedR2?.source ?? null, status: fetched?.status ?? null, sha256_matches: fetchedSha === srcSha,
        });
        await removeRouted(admin, bucket, [r2Path]);
        const goneR2 = await headObject(r2Key);
        const { data: idxAfter } = await admin.from('storage_objects').select('lifecycle').eq('object_key', r2Key).maybeSingle();
        record(`12d_${bucket}_routed_remove_confirmed`, !goneR2.exists && idxAfter?.lifecycle === 'DELETED', { r2_exists: goneR2.exists, index: idxAfter?.lifecycle ?? null });

        const supaPath = `${accountId}/selftest/${crypto.randomUUID()}.png`;
        const up = await admin.storage.from(bucket).upload(supaPath, png, { contentType: 'image/png', upsert: false });
        const legacy = up.error ? null : await readRouted(admin, bucket, supaPath);
        const legacySigned = up.error ? null : await signRouted(admin, bucket, supaPath, 120);
        await removeRouted(admin, bucket, [supaPath]);
        const { data: still } = await admin.storage.from(bucket).list(`${accountId}/selftest`, { search: supaPath.split('/').pop() });
        record(`12e_${bucket}_legacy_file_read_through_supabase_fallback`, !up.error && legacy?.source === 'SUPABASE'
          && legacySigned?.source === 'SUPABASE' && (still ?? []).length === 0, {
          upload_error: up.error?.message ?? null, read_source: legacy?.source ?? null, signed_source: legacySigned?.source ?? null,
          removed: (still ?? []).length === 0,
        });
      }
    }

    // ── 11. One object left behind for a LIVE anonymous read ────────────
    // site-assets is the only namespace whose READ is genuinely public
    // today, so it is the only one whose whole chain — browser, edge
    // function, Postgres decision, presigned URL, R2 — can be exercised
    // over HTTP with no privileged caller at all. It is deleted afterwards
    // through this function's cleanup mode.
    let liveKey: string | null = null;
    if (body.leaveLiveReadObject === true) {
      liveKey = `site-assets/proof/${crypto.randomUUID()}.txt`;
      const liveBody = `homatch live read proof ${liveKey}\n`;
      await putObject(liveKey, liveBody, 'text/plain; charset=utf-8');
      await admin.from('storage_objects').upsert({
        provider: 'R2', namespace: 'site-assets', category: 'site-assets',
        object_key: liveKey, purpose: 'STORAGE_PROOF',
        content_type: 'text/plain', byte_size: liveBody.length,
        checksum_sha256: await sha256Hex(liveBody),
        visibility: 'PUBLIC', lifecycle: 'ACTIVE',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'object_key' });
      record('11_live_read_object_placed', true, { key: liveKey, expected_body: liveBody });
    }

    const ok = steps.every((s) => s.ok);
    const report = { ok, runId, key, liveKey, steps, finishedAt: new Date().toISOString() };
    await admin.from('storage_proof_tickets').update({ result: report }).eq('id', ticket.id);
    return json(report, ok ? 200 : 500);
  } catch (err) {
    // A failed run must not leave its object behind: the next reader would
    // find an orphan in the bucket and have no idea what it was.
    if (cleanupNeeded) await deleteObject(key).catch(() => undefined);
    const message = err instanceof StorageUnavailable ? err.message : 'unexpected failure';
    console.error('storage-selftest failed', message);
    const report = { ok: false, runId, key, steps, error: message };
    await admin.from('storage_proof_tickets').update({ result: report }).eq('id', ticket.id);
    return json(report, 500);
  }
});
