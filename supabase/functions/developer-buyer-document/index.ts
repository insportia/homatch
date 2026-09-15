// developer-buyer-document — the one thing a buyer's room needs that SQL cannot do.
//
// A buyer opens their room with a share token and no account. Everything else
// on that page comes from dev_buyer_room(), a SECURITY DEFINER function that
// returns named publishable fields, because `anon` holds no grant on a single
// dev_* table. Downloading the contract they were given is the exception:
// a Supabase signed URL is an HMAC minted with the service key, and Postgres
// cannot produce one.
//
// So this function is the smallest possible bridge. It takes a token and a
// document id, asks the DATABASE whether that pairing is allowed —
// dev_buyer_room_document() resolves a storage path only for a document whose
// visibility is BUYER and whose lead is the one the token belongs to — and
// signs only the path it is handed back. It never takes a path from the
// caller, never lists a bucket, and never reads dev_documents itself. A buyer
// who edits the document id in the request gets NOT_FOUND, not somebody
// else's contract.
//
// JWT verification stays ON. The browser calls this through supabase.functions
// .invoke, which presents the anon key — itself a valid JWT — so the gateway
// check costs nothing and keeps the function off the open internet. The share
// token is the real credential, and it is checked in SQL, not here.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DOCUMENT_BUCKET = 'developer-documents';
// Long enough to start a download on a slow phone, short enough that a URL
// pasted into a group chat has stopped working by the time anyone opens it.
const SIGNED_URL_SECONDS = 120;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  let token: unknown;
  let documentId: unknown;
  try {
    const body = await req.json();
    token = body?.token;
    documentId = body?.documentId;
  } catch {
    return json({ error: 'BAD_REQUEST' }, 400);
  }

  if (typeof token !== 'string' || token.length < 8 || token.length > 128) {
    return json({ error: 'NOT_FOUND' }, 404);
  }
  if (typeof documentId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(documentId)) {
    return json({ error: 'NOT_FOUND' }, 404);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) {
    console.error('developer-buyer-document: service credentials are not configured');
    return json({ error: 'UNAVAILABLE' }, 503);
  }
  const admin = createClient(url, serviceKey);

  // THE AUTHORISATION DECISION HAPPENS HERE, IN SQL, NOT BELOW.
  const { data, error } = await admin.rpc('dev_buyer_room_document', {
    p_token: token,
    p_document_id: documentId,
  });

  if (error) {
    console.error('developer-buyer-document: resolve failed', error.message);
    return json({ error: 'UNAVAILABLE' }, 503);
  }

  const path = (data as { storage_path?: string } | null)?.storage_path;
  if (!path) {
    // EXPIRED, REVOKED and "not your document" all answer the same way. A
    // different message per case would tell somebody probing which document
    // ids exist.
    return json({ error: 'NOT_FOUND' }, 404);
  }

  const signed = await admin.storage.from(DOCUMENT_BUCKET)
    .createSignedUrl(path, SIGNED_URL_SECONDS);

  if (signed.error || !signed.data?.signedUrl) {
    console.error('developer-buyer-document: sign failed', signed.error?.message);
    return json({ error: 'UNAVAILABLE' }, 503);
  }

  return json({ url: signed.data.signedUrl, expires_in: SIGNED_URL_SECONDS });
});
