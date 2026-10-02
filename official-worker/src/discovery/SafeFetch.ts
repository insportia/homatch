// SafeFetch.ts — one SSRF-guarded HTTP hop for HOMATCH discovery.
//
// PHASE 2 (docs/claude/PHASE2_DISCOVERY.md). Discovery's edge runtime decides
// WHAT may be fetched (host allowlist, robots.txt, rate limits, circuit
// breakers) and follows redirects itself, re-checking every hop. When a job is
// routed through the official worker, this is the hop: the worker resolves the
// hostname itself, refuses any address that is not public unicast, and then
// connects to EXACTLY the address it validated (the `lookup` override), so a
// DNS answer cannot change between the check and the connection.
//
// It never follows a redirect (the 3xx goes back to the caller, whose policy
// decides the next hop), caps the body, times out, and speaks only http/https
// on ports 80 and 443. Nothing here is Verify; nothing here touches Verify.

import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { URL } from 'node:url';

export type FetchErrorKind =
  | 'BAD_URL' | 'BLOCKED_PROTOCOL' | 'BLOCKED_PORT' | 'BLOCKED_ADDRESS' | 'DNS_FAILED'
  | 'TIMEOUT' | 'NETWORK_ERROR' | 'TOO_BUSY';

export class SafeFetchError extends Error {
  constructor(readonly kind: FetchErrorKind, message: string) { super(message); }
}

export interface SafeFetchRequest {
  url: string;
  method?: 'GET' | 'HEAD';
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface SafeFetchResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  bytes: number;
  truncated: boolean;
  durationMs: number;
  remoteAddress: string;
}

const MAX_BYTES = 4_000_000;
const MAX_TIMEOUT_MS = 20_000;
/* Only these request headers are forwarded; nothing can smuggle auth or hosts. */
const FORWARDED_HEADERS = new Set(['accept', 'accept-language', 'user-agent', 'if-none-match', 'if-modified-since']);

/** True only for public unicast addresses. Everything else is refused. */
export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a === 169 && b === 254) return false; // link-local, cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    if (a >= 224) return false; // multicast, reserved, broadcast
    return true;
  }
  if (family === 6) {
    const v = address.toLowerCase();
    if (v === '::' || v === '::1') return false;
    if (v.startsWith('::ffff:')) return isPublicAddress(v.slice(7));
    if (/^f[cd]/.test(v)) return false; // unique local
    if (/^fe[89ab]/.test(v)) return false; // link-local
    if (v.startsWith('ff')) return false; // multicast
    if (v.startsWith('2001:db8')) return false; // documentation
    if (v.startsWith('64:ff9b')) return false; // NAT64 can reach private v4
    return true;
  }
  return false;
}

/** Validate a URL and resolve it to one public address, or refuse. */
export async function resolveSafeTarget(
  rawUrl: string,
  resolver: (host: string) => Promise<Array<{ address: string; family: number }>> =
    (host) => lookup(host, { all: true, verbatim: true }),
): Promise<{ url: URL; address: string; family: number }> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new SafeFetchError('BAD_URL', 'unparseable URL'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new SafeFetchError('BLOCKED_PROTOCOL', url.protocol);
  if (url.username || url.password) throw new SafeFetchError('BAD_URL', 'credentials in URL');
  const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80);
  if (port !== 80 && port !== 443) throw new SafeFetchError('BLOCKED_PORT', String(port));
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) throw new SafeFetchError('BLOCKED_ADDRESS', 'literal IP addresses are not fetched');
  let answers: Array<{ address: string; family: number }>;
  try { answers = await resolver(host); } catch { throw new SafeFetchError('DNS_FAILED', host); }
  if (!answers.length) throw new SafeFetchError('DNS_FAILED', host);
  /* EVERY answer must be public: a name that resolves to one private address
     among public ones is treated as hostile, not load-balanced. */
  if (answers.some((a) => !isPublicAddress(a.address))) throw new SafeFetchError('BLOCKED_ADDRESS', host);
  return { url, address: answers[0].address, family: answers[0].family };
}

let inFlight = 0;
const MAX_IN_FLIGHT = Math.max(1, Math.min(8, Number(process.env.DISCOVERY_FETCH_CONCURRENCY) || 4));

export function discoveryFetchLoad() { return { inFlight, max: MAX_IN_FLIGHT }; }

export async function safeFetch(request: SafeFetchRequest): Promise<SafeFetchResponse> {
  if (inFlight >= MAX_IN_FLIGHT) throw new SafeFetchError('TOO_BUSY', 'discovery fetch concurrency reached');
  inFlight += 1;
  try {
    const target = await resolveSafeTarget(request.url);
    return await sendPinned(target, request);
  } finally {
    inFlight -= 1;
  }
}

export function sendPinned(
  target: { url: URL; address: string; family: number },
  request: SafeFetchRequest,
): Promise<SafeFetchResponse> {
  const started = Date.now();
  const maxBytes = Math.max(1, Math.min(MAX_BYTES, Number(request.maxBytes) || MAX_BYTES));
  const timeoutMs = Math.max(1000, Math.min(MAX_TIMEOUT_MS, Number(request.timeoutMs) || 15_000));
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    if (FORWARDED_HEADERS.has(key.toLowerCase())) headers[key.toLowerCase()] = String(value).slice(0, 300);
  }
  const lib = target.url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = lib.request({
      protocol: target.url.protocol,
      hostname: target.url.hostname,
      port: target.url.port || undefined,
      path: `${target.url.pathname}${target.url.search}`,
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
      headers,
      servername: target.url.hostname,
      /* PINNED: connect to the address validated above, never a fresh lookup. */
      lookup: (_host: string, options: any, callback: any) => {
        if (options && options.all) callback(null, [{ address: target.address, family: target.family }]);
        else callback(null, target.address, target.family);
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      let truncated = false;
      res.on('data', (chunk: Uint8Array) => {
        if (truncated) return;
        bytes += chunk.length;
        if (bytes > maxBytes) {
          truncated = true;
          chunks.push(chunk.subarray(0, chunk.length - (bytes - maxBytes)));
          res.destroy();
          return;
        }
        chunks.push(chunk);
      });
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        const responseHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(res.headers)) {
          if (value !== undefined) responseHeaders[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
        }
        resolve({
          url: target.url.toString(),
          status: res.statusCode ?? 0,
          headers: responseHeaders,
          body: decode(chunks),
          bytes: Math.min(bytes, maxBytes),
          truncated,
          durationMs: Date.now() - started,
          remoteAddress: target.address,
        });
      };
      res.on('end', finish);
      res.on('close', () => { if (truncated) finish(); });
      res.on('error', (error) => (truncated ? finish() : reject(new SafeFetchError('NETWORK_ERROR', error.message))));
    });
    req.on('timeout', () => req.destroy(new SafeFetchError('TIMEOUT', `exceeded ${timeoutMs}ms`)));
    req.on('error', (error) => reject(error instanceof SafeFetchError ? error : new SafeFetchError('NETWORK_ERROR', error.message)));
    req.end();
  });
}

function decode(chunks: Uint8Array[]): string {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}
