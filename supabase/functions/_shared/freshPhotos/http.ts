// Fresh photos — polite HTTP for the open image sources.
//
// Every request: identifying User-Agent, an 8 s timeout, and a shared
// deadline so the whole search stays inside its 25 s budget. No proxies, no
// rotation, no cookies, no login: a source that refuses is recorded as
// FAILED, never worked around.

import { FRESH_PHOTO_FETCH_TIMEOUT_MS, FRESH_PHOTO_USER_AGENT } from '../../../../src/verify/freshPhotos.ts';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Milliseconds left before `deadline` (epoch ms), capped at the per-request timeout. */
export function timeLeft(deadline: number, now = Date.now()): number {
  return Math.min(FRESH_PHOTO_FETCH_TIMEOUT_MS, Math.max(0, deadline - now));
}

export async function politeFetch(
  url: string,
  opts: { fetchImpl?: FetchLike; deadline: number; headers?: Record<string, string> },
): Promise<Response> {
  const ms = timeLeft(opts.deadline);
  if (ms < 500) throw new Error('budget_exhausted');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await (opts.fetchImpl ?? fetch)(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': FRESH_PHOTO_USER_AGENT, 'Api-User-Agent': FRESH_PHOTO_USER_AGENT, ...(opts.headers ?? {}) },
    });
  } finally {
    clearTimeout(t);
  }
}

export async function politeJson(url: string, opts: { fetchImpl?: FetchLike; deadline: number; headers?: Record<string, string> }): Promise<unknown> {
  const res = await politeFetch(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers ?? {}) } });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return await res.json();
}

const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const FRESH_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

/** The image bytes of one accepted photo (JPEG/PNG/WebP, ≤ 8 MB), or null. */
export async function fetchImage(
  url: string,
  opts: { fetchImpl?: FetchLike; deadline: number },
): Promise<{ bytes: Uint8Array; mime: string; ext: string } | null> {
  try {
    const res = await politeFetch(url, { ...opts, headers: { Accept: 'image/jpeg,image/png,image/webp' } });
    if (!res.ok) return null;
    const mime = String(res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const ext = IMAGE_TYPES[mime];
    if (!ext) return null;
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > FRESH_IMAGE_MAX_BYTES) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length || bytes.length > FRESH_IMAGE_MAX_BYTES) return null;
    return { bytes, mime, ext };
  } catch {
    return null;
  }
}
