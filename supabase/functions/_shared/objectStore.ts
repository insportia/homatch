// objectStore — the ONLY place in this repository that reads an R2 credential.
//
// Everything else that wants an object asks `storage-sign`, which asks this.
// The browser never sees a key, Vercel never holds one, Railway never holds
// one, and the number of places a secret could leak from is one file long.
//
// WHAT THIS IS AND IS NOT
//
// It is the network half: put, head, get, delete, and the presigned URL that
// lets a browser do the transfer itself without a credential. It is NOT the
// authorisation half — it will sign anything it is asked to sign. The caller
// (`storage-sign`) decides who is allowed, in Postgres, before calling here.
// Keeping those apart is deliberate: signing is arithmetic and is unit
// tested, authorisation is a question about a person and needs a database.
//
// LOGGING RULE: this module logs failures by SHAPE — a status code, an
// operation name — and never a URL, because a presigned URL contains a
// signature and is a working capability for whoever reads the log. It never
// logs an env value under any circumstances.

import { presign } from './storage/sigv4.ts';
import type { StorageAction } from './storage/keys.ts';

declare const Deno: { env: { get(k: string): string | undefined } };

/** The five names the deployment must carry. Nothing here reads a sixth. */
export const REQUIRED_ENV = [
  'R2_S3_ENDPOINT',
  'R2_BUCKET',
  'R2_REGION',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
] as const;

export interface R2Config {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * Presence, never value.
 *
 * Returns one boolean per required name plus the two settings that are not
 * secrets — the bucket, and the region the signature is scoped to — because
 * a wrong region produces SignatureDoesNotMatch and nothing else, and being
 * unable to see it turns a one-minute fix into an afternoon. The endpoint is
 * reported as its SUFFIX only: the account id in the hostname is not a
 * credential, but it is not something to print either.
 */
export function envReport(): {
  present: Record<string, boolean>;
  allPresent: boolean;
  bucket: string | null;
  region: string | null;
  endpointSuffix: string | null;
} {
  const present: Record<string, boolean> = {};
  for (const name of REQUIRED_ENV) {
    const raw = Deno.env.get(name);
    present[name] = typeof raw === 'string' && raw.trim().length > 0;
  }
  let endpointSuffix: string | null = null;
  const endpoint = Deno.env.get('R2_S3_ENDPOINT');
  if (endpoint) {
    try {
      const host = new URL(endpoint).host;
      const parts = host.split('.');
      // Keep everything but the account-id label.
      endpointSuffix = parts.length > 2 ? `***.${parts.slice(1).join('.')}` : '***';
    } catch {
      endpointSuffix = 'MALFORMED';
    }
  }
  return {
    present,
    allPresent: REQUIRED_ENV.every((n) => present[n]),
    bucket: Deno.env.get('R2_BUCKET') ?? null,
    region: Deno.env.get('R2_REGION') ?? null,
    endpointSuffix,
  };
}

export class StorageUnavailable extends Error {}

let cached: R2Config | null = null;

/**
 * The credential, read once.
 *
 * The endpoint is normalised to an origin: Cloudflare shows the S3 API URL
 * both with and without the bucket appended depending on where you copy it
 * from, and a bucket that ends up in the path twice signs a key nobody can
 * reach.
 */
export function r2Config(): R2Config {
  if (cached) return cached;
  const report = envReport();
  if (!report.allPresent) {
    // Which one is missing is useful to an operator and useless to an
    // attacker — it is a NAME, never a value — but it goes to the caller only
    // through the diagnostics path, not through an ordinary error.
    throw new StorageUnavailable('R2 is not configured');
  }
  const bucket = Deno.env.get('R2_BUCKET')!.trim();
  let endpoint = Deno.env.get('R2_S3_ENDPOINT')!.trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(endpoint);
    if (parsed.pathname && parsed.pathname !== '/') {
      const path = parsed.pathname.replace(/^\/+|\/+$/g, '');
      if (path !== bucket) {
        throw new StorageUnavailable('R2_S3_ENDPOINT has an unexpected path');
      }
      endpoint = parsed.origin;
    } else {
      endpoint = parsed.origin;
    }
  } catch (err) {
    if (err instanceof StorageUnavailable) throw err;
    throw new StorageUnavailable('R2_S3_ENDPOINT is not a URL');
  }

  cached = {
    endpoint,
    bucket,
    // R2 scopes its signatures to `auto`. A location hint like `eeur` is
    // where the data LIVES, which is a different question from what the
    // signature says, and putting one in the other's place yields a 403 whose
    // message says nothing about region.
    region: (Deno.env.get('R2_REGION') || 'auto').trim(),
    accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!.trim(),
    secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!.trim(),
  };
  return cached;
}

const METHOD: Record<StorageAction, 'GET' | 'PUT' | 'DELETE'> = {
  READ: 'GET', WRITE: 'PUT', DELETE: 'DELETE',
};

/**
 * A URL the browser can use for exactly one object, one verb, a few minutes.
 *
 * `expiresIn` is capped here rather than trusted from a caller: a request
 * body that could ask for a seven-day URL to a contract would turn a
 * short-lived capability into a durable one.
 */
export async function signedUrl(input: {
  action: StorageAction;
  key: string;
  expiresIn?: number;
  /** Forces a download with a given filename instead of inline display. */
  downloadAs?: string;
}): Promise<{ url: string; expiresAt: string }> {
  const cfg = r2Config();
  const expiresIn = Math.min(Math.max(Math.floor(input.expiresIn ?? 120), 15), 900);
  const query: Record<string, string> = {};
  if (input.downloadAs) {
    query['response-content-disposition'] =
      `attachment; filename="${input.downloadAs.replace(/["\\]/g, '')}"`;
  }
  return presign({
    method: METHOD[input.action],
    endpoint: cfg.endpoint,
    bucket: cfg.bucket,
    key: input.key,
    region: cfg.region,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    expiresIn,
    query: Object.keys(query).length ? query : undefined,
  });
}

/** Server-side request against a presigned URL. Sixty seconds is plenty. */
async function call(
  action: StorageAction | 'HEAD',
  key: string,
  init?: { body?: BodyInit; contentType?: string; range?: string },
): Promise<Response> {
  const cfg = r2Config();
  const method = action === 'HEAD' ? 'HEAD' : METHOD[action];
  const { url } = await presign({
    method,
    endpoint: cfg.endpoint,
    bucket: cfg.bucket,
    key,
    region: cfg.region,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    expiresIn: 60,
  });
  const headers: Record<string, string> = {};
  if (init?.contentType) headers['content-type'] = init.contentType;
  // Neither header is signed — only `host` is — so adding one cannot
  // invalidate the signature.
  if (init?.range) headers.range = init.range;
  return fetch(url, { method, headers, body: init?.body });
}

export interface ObjectFacts {
  exists: boolean;
  size: number | null;
  etag: string | null;
  contentType: string | null;
  lastModified: string | null;
}

/**
 * Does the object exist, and what does R2 say about it?
 *
 * This is how "the upload really happened" gets answered — by asking the
 * service, not by trusting that a PUT returned 200.
 *
 * THE SIZE COMES FROM A RANGE REQUEST, NOT FROM HEAD, AND THIS IS WHY
 *
 * A HEAD response has no body, and the HTTP client underneath Deno's fetch
 * drops `content-length` on the way through: R2 sends 82, the handler reads
 * 0. Believing that would report every object in the bucket as empty, so the
 * size is asked for the only way that survives the client — a one-byte range
 * request, whose `content-range: bytes 0-0/82` carries the total. 416 means
 * the object is genuinely empty, which is a fact and not a failure.
 */
export async function headObject(key: string): Promise<ObjectFacts> {
  const res = await call('HEAD', key);
  if (res.status === 404) {
    return { exists: false, size: null, etag: null, contentType: null, lastModified: null };
  }
  if (!res.ok) {
    console.error('objectStore.head failed', res.status);
    throw new StorageUnavailable(`head failed: ${res.status}`);
  }

  const declared = Number(res.headers.get('content-length') ?? '');
  let size: number | null = Number.isFinite(declared) && declared > 0 ? declared : null;
  if (size === null) {
    const probe = await call('READ', key, { range: 'bytes=0-0' });
    await probe.body?.cancel();
    if (probe.status === 416) {
      size = 0;
    } else {
      const total = /\/(\d+)\s*$/.exec(probe.headers.get('content-range') ?? '');
      size = total ? Number(total[1]) : null;
    }
  }

  return {
    exists: true,
    size,
    // R2 answers HEAD with a weak validator (`W/"<md5>"`) where PUT returned
    // a strong one. Same bytes, different spelling; callers comparing the two
    // want the md5, so the prefix goes.
    etag: normaliseEtag(res.headers.get('etag')),
    contentType: res.headers.get('content-type'),
    lastModified: res.headers.get('last-modified'),
  };
}

/** `W/"abc"` and `"abc"` both become `abc`. */
export function normaliseEtag(etag: string | null): string | null {
  if (!etag) return null;
  return etag.replace(/^W\//, '').replace(/^"|"$/g, '');
}

export async function putObject(
  key: string, body: BodyInit, contentType = 'application/octet-stream',
): Promise<{ etag: string | null }> {
  const res = await call('WRITE', key, { body, contentType });
  if (!res.ok) {
    console.error('objectStore.put failed', res.status);
    throw new StorageUnavailable(`put failed: ${res.status}`);
  }
  // A body left unread keeps the connection open in Deno.
  await res.arrayBuffer().catch(() => undefined);
  return { etag: normaliseEtag(res.headers.get('etag')) };
}

export async function getObject(key: string): Promise<Response> {
  return call('READ', key);
}

/**
 * Delete, reported honestly.
 *
 * S3 answers 204 whether or not the object was there, so this does NOT claim
 * the object existed — only that after the call it does not. Callers that
 * need the difference head first.
 */
export async function deleteObject(key: string): Promise<{ deleted: boolean }> {
  const res = await call('DELETE', key);
  if (res.status !== 204 && res.status !== 200 && res.status !== 404) {
    console.error('objectStore.delete failed', res.status);
    throw new StorageUnavailable(`delete failed: ${res.status}`);
  }
  await res.arrayBuffer().catch(() => undefined);
  return { deleted: true };
}

/** Only for tests: forget the memoised configuration. */
export function resetConfigForTests(): void { cached = null; }
