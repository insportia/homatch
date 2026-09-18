/**
 * AWS SIGNATURE V4, QUERY-STRING FORM, FOR CLOUDFLARE R2.
 *
 * R2 speaks the S3 API, and the S3 API's presigned URL is the only mechanism
 * that lets a browser talk to object storage directly without ever holding a
 * credential. That property is the whole reason this file exists: the signing
 * key never leaves the edge function, and what reaches the browser is a URL
 * that works for ONE object, ONE verb, for a few minutes.
 *
 * WHY IT IS WRITTEN OUT RATHER THAN IMPORTED
 *
 * An S3 SDK is megabytes and pulls a Node compatibility layer into Deno to
 * sign a string. The algorithm below is about sixty lines, uses only Web
 * Crypto — present in Deno and in Node 20 — and is therefore testable in the
 * ordinary suite with no network and no credentials. A signer nobody can test
 * is a signer nobody can trust.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not decide whether the caller is ALLOWED the object. Signing is
 * arithmetic; authorisation is a question for Postgres, and it is asked in the
 * edge function before this is ever called. A presigned URL is a bearer
 * capability: whoever holds it, opens it. So nothing here should ever be
 * reachable from a path that has not already checked the caller.
 *
 * NOTHING IN THIS FILE LOGS. It receives a secret and returns a URL; a stray
 * console.log here would put a signing key in a log file for ever.
 */

export interface SigV4Input {
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  /** Origin only: https://<account>.r2.cloudflarestorage.com — no path. */
  endpoint: string;
  bucket: string;
  /** Object key, unencoded. Slashes are path separators and stay literal. */
  key: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Seconds the URL stays valid. S3 caps this at seven days. */
  expiresIn: number;
  /** Fixed clock, for tests. Real callers leave it out. */
  now?: Date;
  /** Extra query parameters to sign, e.g. response-content-disposition. */
  query?: Record<string, string>;
}

const ALGORITHM = 'AWS4-HMAC-SHA256';
const SERVICE = 's3';
const MAX_EXPIRY_SECONDS = 604800; // seven days, S3's own ceiling

/**
 * RFC 3986, which is NOT what encodeURIComponent does.
 *
 * encodeURIComponent leaves !'()* alone; S3 expects them percent-encoded, and
 * a single mismatched character changes the canonical request and therefore
 * the signature. This is the classic reason a hand-rolled signer works for
 * every object until somebody uploads `holiday (1).jpg`.
 */
export function uriEncode(value: string, encodeSlash = true): string {
  let out = '';
  for (const ch of value) {
    const isUnreserved = (ch >= 'A' && ch <= 'Z')
      || (ch >= 'a' && ch <= 'z')
      || (ch >= '0' && ch <= '9')
      || ch === '-' || ch === '_' || ch === '.' || ch === '~';
    if (isUnreserved) {
      out += ch;
    } else if (ch === '/') {
      out += encodeSlash ? '%2F' : '/';
    } else {
      for (const byte of new TextEncoder().encode(ch)) {
        out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
      }
    }
  }
  return out;
}

/** `20260919T141530Z` and `20260919`, the only two date forms SigV4 uses. */
export function amzDates(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

const enc = new TextEncoder();

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data));
}

const hex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(value: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(value)));
}

/**
 * The canonical request, built exactly as S3 rebuilds it on the other side.
 *
 * Exported so a test can assert the STRING rather than only the signature:
 * when a signature is wrong, the useful question is which of the six lines
 * differs, and a hex digest cannot answer it.
 */
export function canonicalRequest(input: {
  method: string;
  canonicalUri: string;
  canonicalQuery: string;
  host: string;
}): string {
  return [
    input.method,
    input.canonicalUri,
    input.canonicalQuery,
    `host:${input.host}\n`,
    'host',
    // Presigned URLs carry no body to hash, and S3 accepts this sentinel.
    'UNSIGNED-PAYLOAD',
  ].join('\n');
}

/** Query parameters sorted by key, both sides encoded. S3 requires the order. */
export function canonicalQueryString(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(params[k])}`)
    .join('&');
}

/**
 * The four nested HMACs, then the signature. Exported so the test suite can
 * reproduce AWS's own published example byte for byte — the only way to know
 * this implementation agrees with the server before a real request is made.
 */
export async function signStringToSign(input: {
  secretAccessKey: string;
  dateStamp: string;
  region: string;
  service?: string;
  stringToSign: string;
}): Promise<string> {
  let key: ArrayBuffer | Uint8Array = enc.encode(`AWS4${input.secretAccessKey}`);
  for (const part of [input.dateStamp, input.region, input.service ?? SERVICE, 'aws4_request']) {
    key = await hmac(key, part);
  }
  return hex(await hmac(key, input.stringToSign));
}

export interface PresignResult {
  url: string;
  /** When the URL stops working, so a caller can say so rather than guess. */
  expiresAt: string;
}

/**
 * A URL for one object, one verb, for a few minutes.
 *
 * Path-style addressing (`/bucket/key`) because R2's S3 endpoint serves it and
 * it keeps the bucket name out of the hostname — which matters here, since a
 * virtual-host URL would need a DNS record per bucket and we deliberately have
 * exactly one.
 */
export async function presign(input: SigV4Input): Promise<PresignResult> {
  if (!input.endpoint || !input.bucket || !input.key) {
    throw new Error('presign: endpoint, bucket and key are all required');
  }
  if (!input.accessKeyId || !input.secretAccessKey) {
    // Never echo which one: an error message is a log line somewhere.
    throw new Error('presign: credentials are not configured');
  }
  if (!(input.expiresIn > 0) || input.expiresIn > MAX_EXPIRY_SECONDS) {
    throw new Error(`presign: expiresIn must be 1..${MAX_EXPIRY_SECONDS} seconds`);
  }
  if (input.key.startsWith('/') || input.key.includes('..')) {
    // A key that climbs out of its prefix would escape the authorisation
    // decision that was made about that prefix.
    throw new Error('presign: key must be a relative path with no traversal');
  }

  const now = input.now ?? new Date();
  const { amzDate, dateStamp } = amzDates(now);
  const host = new URL(input.endpoint).host;
  const scope = `${dateStamp}/${input.region}/${SERVICE}/aws4_request`;

  const params: Record<string, string> = {
    ...(input.query ?? {}),
    'X-Amz-Algorithm': ALGORITHM,
    'X-Amz-Credential': `${input.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(Math.floor(input.expiresIn)),
    'X-Amz-SignedHeaders': 'host',
  };

  // Each path segment is encoded, the separators are not.
  const canonicalUri = `/${uriEncode(input.bucket, false)}/${input.key
    .split('/').map((seg) => uriEncode(seg)).join('/')}`;
  const canonicalQuery = canonicalQueryString(params);

  const request = canonicalRequest({
    method: input.method, canonicalUri, canonicalQuery, host,
  });
  const stringToSign = [
    ALGORITHM, amzDate, scope, await sha256Hex(request),
  ].join('\n');

  const signature = await signStringToSign({
    secretAccessKey: input.secretAccessKey,
    dateStamp,
    region: input.region,
    stringToSign,
  });

  return {
    url: `${input.endpoint.replace(/\/$/, '')}${canonicalUri}`
      + `?${canonicalQuery}&X-Amz-Signature=${signature}`,
    expiresAt: new Date(now.getTime() + input.expiresIn * 1000).toISOString(),
  };
}
