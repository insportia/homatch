// HOMATCH DESIGN STUDIO — signing for the catalogue importer.
//
//   POST …/design-studio-model/catalog      Authorization: Bearer <service role>
//     { op: 'sign', items: [{ key, method: 'PUT'|'GET'|'HEAD' }] }
//         presigned R2 URLs for catalogue keys only, one verb each, ≤ 15 minutes;
//         a PUT only for a recorded asset whose licence is importable, and a
//         PUBLIC key only for CC0 (catalogPolicy.writeRefusal)
//     { op: 'provider-sign', provider: 'blendkit', homatchAssetId, downloads: [downloadUrl] }
//         Blendkit's signed CDN URL for each of ITS OWN download URLs, only for
//         files that recorded, importable asset listed (catalogPolicy.downloadRefusal)
//
// The importer runs in GitHub Actions (bytes go provider → runner → R2, never
// through Supabase). The two credentials it needs to act for — R2's and
// Blendkit's API key (BLENDKIT_API_KEY) — never leave this function: it hands
// out single-object, short-lived URLs instead, and logs none of them.
//
// Blendkit's download mechanism is its documented one (the official client,
// BlenderKit/bk_client: GET <file.downloadUrl>?scene_uuid=<uuid> with
// "Authorization: Bearer <key>" → { filePath: <signed CDN URL> }). Only URLs of
// that exact shape are ever sent the key.
//
// Service role only: this is machinery, not a customer path.

import { r2Config } from '../_shared/objectStore.ts';
import { presign } from '../_shared/storage/sigv4.ts';
import { serviceClient } from '../_shared/billing.ts';
import { assetOfKey, downloadRefusal, type ImportRow, writeRefusal } from './catalogPolicy.ts';

/** The same pattern as catalogSource.ts CATALOG_KEY (a test keeps them equal). */
export const CATALOG_KEY = /^design-studio\/catalog\/(public|licensed|restricted)\/(models|materials|hdri|thumbnails|metadata)\/hma_[0-9a-z]{26}\/hmv_[0-9a-z]{26}\/(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/){0,3}[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;
/** The same pattern as catalogProviders/blendkit.ts DOWNLOAD_URL. */
export const BLENDKIT_DOWNLOAD = /^https:\/\/www\.blendkit\.com\/api\/v1\/downloads\/[0-9a-f-]{36}\/$/;
const METHODS = new Set(['PUT', 'GET', 'HEAD']);
const MAX_ITEMS = 200;
const MAX_DOWNLOADS = 20;
const EXPIRES = 900;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** The gateway has verified the JWT's signature (verify_jwt); its role claim decides. */
export function isServiceRole(authHeader: string): boolean {
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const expected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (expected && token.length === expected.length) {
    let diff = 0;
    for (let i = 0; i < token.length; i += 1) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
    if (diff === 0) return true;
  }
  const part = token.split('.')[1];
  if (!part) return false;
  try {
    const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')));
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}

/** The catalogue's own record of these assets (licence, provider, the files it listed). */
async function importRows(ids: string[]): Promise<Map<string, ImportRow>> {
  const unique = [...new Set(ids)].filter((x) => /^hma_[0-9a-z]{26}$/.test(x));
  if (!unique.length) return new Map();
  const { data } = await serviceClient().from('ds_catalog_imports')
    .select('homatch_asset_id, source_provider, license_class, source_asset').in('homatch_asset_id', unique);
  return new Map(((data ?? []) as ImportRow[]).map((r) => [r.homatch_asset_id, r]));
}

async function signR2(items: Array<{ key?: unknown; method?: unknown }>): Promise<Response> {
  if (items.length === 0 || items.length > MAX_ITEMS) return json({ error: 'BAD_REQUEST' }, 400);
  for (const it of items) {
    if (typeof it?.key !== 'string' || !CATALOG_KEY.test(it.key) || it.key.includes('..') || !METHODS.has(String(it.method))) {
      return json({ error: 'KEY_REFUSED' }, 400);
    }
  }
  // A WRITE stores new bytes: only for a recorded asset whose licence allows it, and public only when CC0.
  const writes = items.filter((it) => it.method === 'PUT') as Array<{ key: string }>;
  if (writes.length) {
    const rows = await importRows(writes.map((w) => assetOfKey(w.key)));
    for (const w of writes) {
      const refusal = writeRefusal(w.key, rows.get(assetOfKey(w.key)));
      if (refusal) return json({ error: refusal }, 403);
    }
  }
  let cfg;
  try { cfg = r2Config(); } catch { return json({ error: 'STORAGE_UNAVAILABLE' }, 503); }
  const signed = [];
  for (const it of items) {
    const { url, expiresAt } = await presign({
      method: String(it.method) as 'PUT' | 'GET' | 'HEAD',
      endpoint: cfg.endpoint, bucket: cfg.bucket, key: it.key as string, region: cfg.region,
      accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, expiresIn: EXPIRES,
    });
    signed.push({ key: it.key, method: it.method, url, expiresAt });
  }
  return json({ signed });
}

/**
 * Blendkit: its signed CDN URL for each of its own download URLs. The answer
 * says per URL whether the account may download it (a paid asset on a plan
 * that does not include it is a refusal, reported, never worked around).
 */
async function signBlendkit(homatchAssetId: unknown, downloads: unknown[]): Promise<Response> {
  const key = Deno.env.get('BLENDKIT_API_KEY') ?? '';
  if (!key) return json({ error: 'PROVIDER_NOT_CONFIGURED' }, 503);
  if (typeof homatchAssetId !== 'string' || !downloads.length || downloads.length > MAX_DOWNLOADS
    || !downloads.every((d) => typeof d === 'string' && BLENDKIT_DOWNLOAD.test(d))) {
    return json({ error: 'DOWNLOAD_REFUSED' }, 400);
  }
  // Only a file the recorded asset listed, and only for a licence HOMATCH may import today.
  const row = (await importRows([homatchAssetId])).get(homatchAssetId);
  for (const d of downloads as string[]) {
    const refusal = downloadRefusal(d, row);
    if (refusal) return json({ error: refusal }, 403);
  }
  const results = [];
  for (const d of downloads as string[]) {
    const res = await fetch(`${d}?scene_uuid=${crypto.randomUUID()}`, {
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Client-Version': 'homatch-catalog/1' },
    });
    const body = await res.json().catch(() => ({}));
    const filePath = typeof body?.filePath === 'string' && /^https:\/\//.test(body.filePath) ? body.filePath : null;
    // The provider's refusal reason is passed on by status and code only: nothing it echoes is trusted into a log.
    results.push({ downloadUrl: d, ok: res.ok && !!filePath, status: res.status, url: res.ok ? filePath : null, reason: res.ok ? null : String(body?.detail ?? body?.code ?? '').slice(0, 120) });
  }
  return json({ results });
}

export async function handleCatalog(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  if (!isServiceRole(req.headers.get('Authorization') ?? '')) return json({ error: 'FORBIDDEN' }, 403);
  let body: { op?: string; items?: Array<{ key?: unknown; method?: unknown }>; provider?: string; homatchAssetId?: unknown; downloads?: unknown[] };
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  if (body.op === 'sign' && Array.isArray(body.items)) return signR2(body.items);
  if (body.op === 'provider-sign' && body.provider === 'blendkit' && Array.isArray(body.downloads)) return signBlendkit(body.homatchAssetId, body.downloads);
  return json({ error: 'BAD_REQUEST' }, 400);
}
