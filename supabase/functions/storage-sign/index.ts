// storage-sign — the one door to object storage.
//
// A browser that wants to read or write a file asks here. This function asks
// Postgres, under the caller's own token, whether that person may touch that
// key; only then does it mint a presigned URL that works for one object, one
// verb, and a couple of minutes. The R2 credential exists only inside this
// runtime: it is not in the bundle, not on Vercel, not on Railway, and not in
// any response this function produces.
//
// WHY THE BROWSER GETS A URL AND NOT A PROXY
//
// Streaming a fifty-megabyte plan through an edge function costs the function
// its memory limit and the user their patience. A presigned URL lets the
// transfer go straight to R2 while the DECISION stays here. The trade is that
// the URL is a bearer capability once minted, which is why it is short,
// single-verb, single-object, and why nothing logs it.
//
// WHY DELETE IS NOT A PRESIGNED URL
//
// Reads and writes are transfers; a delete is an outcome. Handing out a URL
// that destroys an object when opened is a worse bargain than doing it here,
// so DELETE is performed server-side and the browser gets only a yes.
//
// JWT verification stays ON at the gateway. That only proves the caller holds
// the anon key; the real decision is `authorize()` below, and every path
// through this file passes through it.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { authorize, type DenyReason } from '../_shared/storageAuth.ts';
import {
  StorageUnavailable, deleteObject, envReport, headObject, signedUrl,
} from '../_shared/objectStore.ts';
import type { StorageAction } from '../_shared/storage/keys.ts';

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
  UNAVAILABLE: 503,
};

const ACTIONS: StorageAction[] = ['READ', 'WRITE', 'DELETE'];

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

  // `status` answers one bit and nothing else: is the object store wired up.
  // No names, no values, no shape — the same answer a failed upload would
  // give away anyway, and nothing an operator could not get from a 503.
  if (op === 'status') {
    return json({ configured: envReport().allPresent });
  }

  if (op !== 'sign' && op !== 'delete' && op !== 'exists') {
    return json({ error: 'BAD_REQUEST' }, 400);
  }

  const key = body.key;
  const action: StorageAction = op === 'sign'
    ? (ACTIONS.includes(body.action as StorageAction) ? body.action as StorageAction : 'READ')
    : (op === 'delete' ? 'DELETE' : 'READ');

  const decision = await authorize(req, key, action);
  if (!decision.allowed) {
    // The reason is deliberately coarse. It tells the caller what to DO —
    // sign in, ask for access — without telling them what exists.
    return json({ error: decision.reason }, STATUS[decision.reason]);
  }

  const objectKey = `${decision.parsed.namespace}/${decision.parsed.rest}`;

  try {
    if (op === 'sign') {
      const result = await signedUrl({
        action,
        key: objectKey,
        expiresIn: typeof body.expiresIn === 'number' ? body.expiresIn : undefined,
        downloadAs: typeof body.downloadAs === 'string' ? body.downloadAs : undefined,
      });
      // The URL goes to the caller and nowhere else. It is not logged.
      return json({ url: result.url, expiresAt: result.expiresAt, key: objectKey });
    }

    if (op === 'exists') {
      const facts = await headObject(objectKey);
      return json({ key: objectKey, ...facts });
    }

    await deleteObject(objectKey);
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
