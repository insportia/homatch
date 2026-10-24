// EMAIL STUDIO — design images: the pure half (no Supabase client), testable in Node.
//   · sniffImage / decodeBase64: what an upload is, read from its bytes;
//   · serveAsset: the public delivery a mail client loads (email-webhook ?ema=<asset id>).
// The upload and delete actions, which need the service client, live in assets.ts.

import { getObject } from '../objectStore.ts';

// deno-lint-ignore no-explicit-any
type Sb = any;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ASSET_MAX_BYTES = 5 * 1024 * 1024;
export const ASSET_MAX_ACTIVE = 300;
export const ASSET_MAX_SIDE = 8000;

export interface Sniffed { type: 'image/png' | 'image/jpeg' | 'image/gif'; ext: 'png' | 'jpg' | 'gif'; width: number | null; height: number | null }

/** The image type and size from the first bytes; null for anything that is not PNG/JPEG/GIF. */
export function sniffImage(b: Uint8Array): Sniffed | null {
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { type: 'image/png', ext: 'png', width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) {
    return { type: 'image/gif', ext: 'gif', width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2, width: number | null = null, height: number | null = null;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = (b[i + 2] << 8) | b[i + 3];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        height = (b[i + 5] << 8) | b[i + 6];
        width = (b[i + 7] << 8) | b[i + 8];
        break;
      }
      if (len < 2) break;
      i += 2 + len;
    }
    return { type: 'image/jpeg', ext: 'jpg', width, height };
  }
  return null;
}

export function decodeBase64(s: string): Uint8Array | null {
  try {
    const clean = s.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null;
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}

export function isAssetRequest(url: URL): boolean {
  return url.searchParams.has('ema');
}

/** GET/HEAD ?ema=<id>: the image bytes for an ACTIVE registered asset, nothing else. */
export async function serveAsset(req: Request, url: URL, sb: Sb, get: (key: string) => Promise<Response> = getObject): Promise<Response> {
  const base = { 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'cross-origin', 'Access-Control-Allow-Origin': '*' };
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method not allowed', { status: 405, headers: base });
  const id = url.searchParams.get('ema') ?? '';
  if (!UUID.test(id)) return new Response('not found', { status: 404, headers: { ...base, 'Cache-Control': 'no-store' } });
  const { data } = await sb.from('email_assets').select('object_key, content_type, byte_size').eq('id', id).eq('status', 'ACTIVE').maybeSingle();
  const a = data as { object_key: string; content_type: string; byte_size: number } | null;
  if (!a || !['image/png', 'image/jpeg', 'image/gif'].includes(a.content_type)) {
    return new Response('not found', { status: 404, headers: { ...base, 'Cache-Control': 'public, max-age=300' } });
  }
  const headers = { ...base, 'Content-Type': a.content_type, 'Content-Disposition': 'inline', 'Cache-Control': 'public, max-age=31536000, immutable' };
  if (req.method === 'HEAD') return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': String(a.byte_size) } });
  const res = await get(a.object_key).catch(() => null);
  if (!res || !res.ok || !res.body) {
    await res?.body?.cancel().catch(() => undefined);
    return new Response('unavailable', { status: 502, headers: { ...base, 'Cache-Control': 'no-store' } });
  }
  return new Response(res.body, { status: 200, headers });
}
