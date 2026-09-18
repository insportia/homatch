// storage-selftest — the proof, not a claim.
//
// This function writes a real object into the real bucket, reads it back
// through a real signed URL, shows that the same object is unreachable
// without that signature and after it expires, deletes it, and confirms the
// deletion. It reports what each step ACTUALLY returned, including the HTTP
// status codes, so the answer to "does R2 work" is evidence rather than an
// assertion.
//
// IT TOUCHES NOTHING THAT BELONGS TO ANYONE
//
// Every object it creates lives under `diagnostics/`, a namespace that maps
// to no bucket and that no product code may write to. The key carries the
// run id, so two runs never collide and a leftover object is identifiable.
//
// AUTHORISED BY A SINGLE-USE TICKET
//
// Not by an account, not by the service key in somebody's shell. See
// storage_proof_tickets: the caller presents a token, this function compares
// its SHA-256 against an unused, unexpired row, and marks it used before
// doing any work. Replaying the same token gets nothing.
//
// NOTHING IT RETURNS IS A CREDENTIAL. Signed URLs are reported as host and
// path with the signature stripped, because a URL with the signature on it
// is a working key to the object and this report is meant to be pasted
// somewhere.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  StorageUnavailable, deleteObject, envReport, getObject, headObject, putObject, signedUrl,
} from '../_shared/objectStore.ts';

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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ error: 'UNAVAILABLE' }, 503);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

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
    // ── 1. The five secrets are present. Names and booleans only. ────────
    const env = envReport();
    record('1_secrets_present', env.allPresent, {
      present: env.present,
      bucket: env.bucket,
      signing_region: env.region,
      endpoint: env.endpointSuffix,
      values_printed: false,
    });
    if (!env.allPresent) return json({ ok: false, runId, steps }, 503);

    // ── 2. A real authenticated private upload ───────────────────────────
    const put = await putObject(key, payload, 'text/plain; charset=utf-8');
    cleanupNeeded = true;
    record('2_private_upload', true, { key, bytes: payload.length, etag: put.etag });

    // ── 3. The object really exists, according to R2 itself ──────────────
    // Three independent facts, because "exists" alone would also be true of
    // an empty object written by a half-finished upload: it is there, it is
    // the right length, and its md5 is the one the PUT was acknowledged with.
    const facts = await headObject(key);
    record(
      '3_object_exists_in_r2',
      facts.exists && facts.size === payload.length && facts.etag === put.etag,
      { key, ...facts, expected_bytes: payload.length, expected_etag: put.etag },
    );

    // ── 4. A short-lived signed read returns the same bytes ──────────────
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

    // ── 5a. The same object, unsigned, is refused ────────────────────────
    // This is what "the bucket is private" MEANS, and the only way to know
    // it is to ask for the object with no credential at all.
    const bare = new URL(read.url);
    bare.search = '';
    const unsignedRes = await fetch(bare.toString());
    const unsignedBody = await unsignedRes.text();
    // The question is NOT which status code R2 chooses — it answers an
    // unsigned S3 request with 400 InvalidArgument rather than 403, which is
    // still a refusal. The question is whether the bytes came back. So the
    // test is: not a success, and the response does not contain the object.
    const leaked = unsignedBody.includes(runId);
    record('5a_unsigned_read_refused', !unsignedRes.ok && !leaked, {
      status: unsignedRes.status,
      url: `${bare.origin.replace(/\/\/[^.]+\./, '//***.')}${bare.pathname}`,
      response_contains_the_object: leaked,
      r2_error_code: /<Code>([^<]+)<\/Code>/.exec(unsignedBody)?.[1] ?? null,
      meaning: 'public bucket access is disabled; the object is not served without a signature',
    });

    // ── 5b. A tampered signature is refused ──────────────────────────────
    // A URL whose signature has been altered by one character must fail, or
    // the signature is decorative.
    const tampered = new URL(read.url);
    const sig = tampered.searchParams.get('X-Amz-Signature') ?? '';
    tampered.searchParams.set('X-Amz-Signature', (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1));
    const tamperedRes = await fetch(tampered.toString());
    await tamperedRes.body?.cancel();
    record('5b_tampered_signature_refused', tamperedRes.status === 403, {
      status: tamperedRes.status,
    });

    // ── 5c. A signed URL for a DIFFERENT key does not open this one ──────
    const otherSigned = await signedUrl({
      action: 'READ', key: `diagnostics/selftest/${crypto.randomUUID()}.txt`, expiresIn: 60,
    });
    const swapped = new URL(otherSigned.url);
    // Point the other key's signature at our object.
    swapped.pathname = new URL(read.url).pathname;
    const swappedRes = await fetch(swapped.toString());
    await swappedRes.body?.cancel();
    record('5c_signature_is_bound_to_its_key', swappedRes.status === 403, {
      status: swappedRes.status,
    });

    // ── 5d. Expiry is real, measured by waiting for it ───────────────────
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

    // ── 6. Delete the test object ────────────────────────────────────────
    await deleteObject(key);
    cleanupNeeded = false;
    record('6_delete', true, { key });

    // ── 7. It is really gone ─────────────────────────────────────────────
    const after = await headObject(key);
    const goneRes = await getObject(key);
    await goneRes.body?.cancel();
    record('7_deletion_confirmed', !after.exists && goneRes.status === 404, {
      key, head_exists: after.exists, get_status: goneRes.status,
    });

    const ok = steps.every((s) => s.ok);
    const report = { ok, runId, key, steps, finishedAt: new Date().toISOString() };
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
