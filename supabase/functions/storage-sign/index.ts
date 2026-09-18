// storage-sign — the one door to object storage.
//
// A browser that wants to read or write a file asks here. This function asks
// Postgres, under the caller's own token, whether that person may touch that
// key; only then does it mint a presigned URL good for one object, one verb,
// and a couple of minutes. The R2 credential exists only inside this runtime:
// not in the bundle, not on Vercel, not on Railway, and not in any response.
//
// WHY THE BROWSER GETS A URL AND NOT A PROXY
//
// Streaming a fifty-megabyte plan through an edge function costs the function
// its memory limit and the person their patience. A presigned URL lets the
// transfer go straight to R2 while the DECISION stays here. The trade is that
// the URL is a bearer capability once minted, which is why it is short,
// single-verb, single-object, and why nothing logs it.
//
// WHY A WRITE IS TWO CALLS
//
//   sign   → authorise, check the type and size, record a PENDING row, and
//            return a URL
//   commit → ask R2 what actually arrived, record the real size and md5, and
//            turn the row ACTIVE
//
// Without the second call an abandoned upload is invisible: bytes in a bucket
// that nothing in Postgres knows about, which is the definition of an orphan.
// A PENDING row that never commits is one query away from being found.
//
// WHY DELETE IS NOT A PRESIGNED URL
//
// Reads and writes are transfers; a delete is an outcome. Handing out a URL
// that destroys an object when opened is a worse bargain than doing it here,
// so DELETE happens server-side and the browser gets a yes.
//
// JWT verification stays ON at the gateway. That only proves the caller holds
// the anon key; the real decision is `authorize()`, and every path through
// this file passes through it.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { authorize, callerClient, type DenyReason } from '../_shared/storageAuth.ts';
import {
  StorageUnavailable, deleteObject, envReport, headObject, signedUrl,
} from '../_shared/objectStore.ts';
import type { ParsedKey, StorageAction } from '../_shared/storage/keys.ts';

declare const Deno: { env: { get(k: string): string | undefined } };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** A denial's HTTP status. 401 means "sign in", 403 means "not you". */
const STATUS: Record<DenyReason, number> = {
  UNAUTHENTICATED: 401,
  NOT_OWNER: 403,
  NOT_ADMIN: 403,
  NO_CAPABILITY: 403,
  INVALID_KEY: 400,
  MIME_NOT_ALLOWED: 415,
  TOO_LARGE: 413,
  UNAVAILABLE: 503,
};

const ACTIONS: StorageAction[] = ['READ', 'WRITE', 'DELETE'];

/** The service client, for the metadata index only — never for deciding. */
function admin() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/** A display name is metadata. It is trimmed, capped, and never a path. */
function safeFilename(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // Control characters are stripped by codepoint rather than by a regex
  // literal, so this source file never has to contain one.
  const cleaned = [...value]
    .filter((ch) => { const c = ch.codePointAt(0) ?? 0; return c > 31 && c !== 127; })
    .join('').trim().slice(0, 255);
  return cleaned.length ? cleaned : null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'BAD_REQUEST' }, 400);
  }

  const op = body.op;

  // `status` answers one bit: is the object store wired up. No names, no
  // values, no shape — nothing an operator could not infer from a 503.
  if (op === 'status') {
    return json({ configured: envReport().allPresent });
  }

  if (op !== 'sign' && op !== 'delete' && op !== 'exists' && op !== 'commit') {
    return json({ error: 'BAD_REQUEST' }, 400);
  }

  const action: StorageAction = op === 'sign'
    ? (ACTIONS.includes(body.action as StorageAction) ? body.action as StorageAction : 'READ')
    : op === 'delete' ? 'DELETE'
      : op === 'commit' ? 'WRITE'
        : 'READ';

  const contentType = typeof body.contentType === 'string' ? body.contentType : undefined;
  const byteSize = typeof body.byteSize === 'number' ? body.byteSize : undefined;

  const decision = await authorize(req, body.key, action, { contentType, byteSize });
  if (!decision.allowed) {
    // The reason is deliberately coarse. It tells the caller what to DO —
    // sign in, ask for access, pick a smaller file — without telling them
    // what exists.
    return json({ error: decision.reason }, STATUS[decision.reason]);
  }

  const parsed: ParsedKey = decision.parsed;
  const objectKey = `${parsed.namespace}/${parsed.rest}`;
  const db = admin();

  try {
    if (op === 'sign') {
      const result = await signedUrl({
        action,
        key: objectKey,
        expiresIn: typeof body.expiresIn === 'number' ? body.expiresIn : undefined,
        downloadAs: typeof body.downloadAs === 'string' ? body.downloadAs : undefined,
      });

      if (action === 'WRITE' && db) {
        // The index learns about the object BEFORE the bytes exist, so an
        // upload that never finishes leaves a PENDING row rather than
        // nothing at all.
        await db.from('storage_objects').upsert({
          provider: 'R2',
          namespace: parsed.namespace,
          category: parsed.category ?? parsed.namespace,
          object_key: objectKey,
          owner_user_id: parsed.accountId,
          entity_type: parsed.entityType,
          entity_id: parsed.entityId,
          purpose: typeof body.purpose === 'string' ? body.purpose.slice(0, 64) : null,
          original_filename: safeFilename(body.originalFilename),
          content_type: contentType ?? null,
          byte_size: byteSize ?? 0,
          visibility: body.visibility === 'PUBLIC' || body.visibility === 'AUTHENTICATED'
            ? body.visibility : 'PRIVATE',
          lifecycle: 'PENDING',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'object_key' });
      }

      // An admin reading somebody else's file is a thing that should leave a
      // trace. The owner reading their own is not.
      if (action === 'READ' && db && decision.caller.authUid && parsed.accountId) {
        const caller = callerClient(req);
        const { data: me } = caller
          ? await caller.rpc('auth_user_id')
          : { data: null };
        if (me && me !== parsed.accountId) {
          await db.from('admin_audit_log').insert({
            admin_id: me,
            target_id: parsed.accountId,
            action: 'STORAGE_SIGNED_READ',
            entity_type: 'storage_object',
            // The key, not the URL: a URL carries a signature and is a
            // working capability for whoever reads the log.
            entity_id: objectKey,
            metadata: { category: parsed.category, namespace: parsed.namespace },
          }).select('id');
        }
      }

      // The URL goes to the caller and nowhere else. It is not logged.
      return json({ url: result.url, expiresAt: result.expiresAt, key: objectKey });
    }

    if (op === 'commit') {
      // What actually arrived, asked of R2 rather than believed from the
      // browser. A PUT that returned 200 proves a PUT returned 200.
      const facts = await headObject(objectKey);
      if (!facts.exists) {
        if (db) {
          await db.from('storage_objects')
            .update({ lifecycle: 'ORPHANED', updated_at: new Date().toISOString() })
            .eq('object_key', objectKey);
        }
        return json({ error: 'NOT_FOUND', key: objectKey }, 404);
      }
      if (db) {
        await db.from('storage_objects').update({
          lifecycle: 'ACTIVE',
          byte_size: facts.size ?? 0,
          checksum_md5: facts.etag,
          content_type: facts.contentType ?? contentType ?? null,
          updated_at: new Date().toISOString(),
        }).eq('object_key', objectKey);
      }
      return json({ key: objectKey, committed: true, size: facts.size, etag: facts.etag });
    }

    if (op === 'exists') {
      const facts = await headObject(objectKey);
      return json({ key: objectKey, ...facts });
    }

    await deleteObject(objectKey);
    if (db) {
      // The row stays, marked. A deleted object that leaves no trace is an
      // object nobody can explain the absence of.
      await db.from('storage_objects').update({
        lifecycle: 'DELETED',
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('object_key', objectKey);
    }
    return json({ key: objectKey, deleted: true });
  } catch (err) {
    if (err instanceof StorageUnavailable) {
      console.error('storage-sign: object store unavailable', op);
      return json({ error: 'UNAVAILABLE' }, 503);
    }
    console.error('storage-sign: unexpected failure', op);
    return json({ error: 'UNAVAILABLE' }, 503);
  }
});
