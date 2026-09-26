// HOMATCH RESEARCH CORE — a DNS resolver that exists in every runtime.
//
// WHY THIS FILE EXISTS
//
// NetworkPolicy's third and most important rule is "every address the hostname
// actually resolves to is public". Enforcing it needs a resolver, and there is
// no resolver in a Deno Edge Function: `node:dns` is a Node built-in, and
// research-core is forbidden from importing one (see
// __tests__/runtimeNeutrality.test.mjs, which reads every file in this
// directory to keep it that way).
//
// That absence is the entire reason createPortalRuntime() sets
// `skipDnsResolution: true` and leans on a fixed host allowlist instead. That
// is a sound trade for a fixed catalogue of eight operator-chosen portals. It
// is NOT a sound trade for auditing a hostname that arrived in a database row,
// because then the allowlist would have to be widened to whatever the row said,
// which is the same thing as having no boundary.
//
// So the resolver is built on `fetch` — which every runtime has — over DNS
// queries to a fixed public resolver (RFC 8484, DNS-over-HTTPS).
//
// WHAT THIS IS NOT
//
// It is not a general-purpose DNS library. It answers exactly one question:
// "which A and AAAA addresses does this name have, right now, according to a
// resolver we did not obtain from the input?" Anything it cannot answer with
// confidence, it throws on, because NetworkPolicy turns a throw into a refusal
// and a refusal is the safe direction.
//
// TRUST
//
// The endpoint is a constant in this file, never a parameter taken from a row,
// a query string or an environment variable that discovery can influence.
// `fetch` reaches it directly rather than through HttpClient, for the same
// reason the robots fetcher does: HttpClient consults the network policy, the
// network policy consults this resolver, and that is a cycle. A hardcoded,
// public, operator-chosen HTTPS endpoint is precisely the case
// FetchTransport's own comment names as acceptable for a non-pinning fetch.
//
// A LIE THIS CANNOT TELL
//
// A DoH answer cannot make a private address look public: we classify the
// addresses ourselves, in ip.ts, after they come back. The worst a
// compromised resolver could do is deny service (refuse to resolve, or return
// a public address for a name whose real answer is private — which would send
// the fetch to the public address, not the private one, because the fetch uses
// the same public DNS the rest of the internet does). It cannot talk us into
// connecting to 169.254.169.254.

import { ResearchError } from '../core/errors.ts';
import { parseResolvedAddress } from './ip.ts';
import type { DnsResolver } from './network-policy.ts';

/**
 * Cloudflare's public resolver, JSON API. Fixed, not configurable from data.
 *
 * `1.1.1.1` is deliberately NOT used as the host: the certificate for
 * cloudflare-dns.com is what proves we are talking to the resolver we meant,
 * and an IP literal in the URL would skip that.
 */
const DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query';

/** DNS record types we understand. Anything else in the answer is ignored. */
const TYPE_A = 1;
const TYPE_AAAA = 28;

/**
 * A DoH reply is a few hundred bytes. A megabyte of it is a resolver having a
 * very bad day or somebody pointing us at something that is not a resolver,
 * and either way there is nothing in it we want.
 */
const MAX_REPLY_BYTES = 64 * 1024;

/**
 * Hostnames we will even ASK about.
 *
 * This is not a security boundary — the classification in ip.ts is. It is here
 * so a malformed row cannot turn into a strange URL: the name goes into a query
 * string, and a name containing `&`, a space or a slash would be a different
 * question than the one we think we are asking. Labels, dots, hyphens and the
 * `xn--` of punycode, nothing else.
 */
const RESOLVABLE_NAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

export interface DohResolverOptions {
  /** Injected for tests. Defaults to the runtime's own `fetch`. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /**
   * How long an answer may be reused. Short on purpose: the point of resolving
   * is to know what the name points at NOW, and a long cache would re-introduce
   * the validate-then-connect gap this resolver exists to narrow.
   */
  cacheTtlMs?: number;
  now?: () => number;
}

interface CacheEntry {
  addresses: string[];
  expiresAt: number;
}

export class DohResolver implements DnsResolver {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry>();

  /** Resolutions actually put on the wire. For the audit trail and tests. */
  private queries = 0;

  constructor(options: DohResolverOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 4_000;
    this.cacheTtlMs = options.cacheTtlMs ?? 30_000;
    this.now = options.now ?? (() => Date.now());
  }

  queryCount(): number {
    return this.queries;
  }

  async resolve(hostname: string): Promise<string[]> {
    const name = hostname.toLowerCase().replace(/\.$/, '');

    if (!RESOLVABLE_NAME.test(name)) {
      throw new ResearchError('VALIDATION_ERROR', 'Not a resolvable DNS name', {
        retryable: false,
        details: { hostname: name },
      });
    }

    const cached = this.cache.get(name);
    if (cached && cached.expiresAt > this.now()) return cached.addresses;

    // Both families are asked for, and BOTH answers are used. A name with a
    // public A record and an AAAA record pointing at ::1 is one host with one
    // private address on it, and resolving only A would hand NetworkPolicy a
    // clean set to approve while the connection went to the other one.
    const [a, aaaa] = await Promise.all([
      this.query(name, 'A'),
      this.query(name, 'AAAA'),
    ]);

    // A hard failure on either family is a refusal, not a partial answer. If we
    // cannot see the whole picture we do not get to approve part of it.
    if (a.error && aaaa.error) {
      throw new ResearchError('PROVIDER_ERROR', `DNS lookup failed: ${a.error}`, {
        retryable: true,
        details: { hostname: name, a: a.error, aaaa: aaaa.error },
      });
    }
    if (a.error || aaaa.error) {
      throw new ResearchError(
        'PROVIDER_ERROR',
        'DNS lookup answered for one address family and failed for the other',
        {
          retryable: true,
          details: { hostname: name, a: a.error ?? 'ok', aaaa: aaaa.error ?? 'ok' },
        },
      );
    }

    const addresses = [...new Set([...a.addresses, ...aaaa.addresses])];
    if (addresses.length === 0) {
      throw new ResearchError('NOT_FOUND', 'No A or AAAA record', {
        retryable: false,
        details: { hostname: name },
      });
    }

    this.cache.set(name, { addresses, expiresAt: this.now() + this.cacheTtlMs });
    return addresses;
  }

  private async query(
    name: string,
    type: 'A' | 'AAAA',
  ): Promise<{ addresses: string[]; error?: string }> {
    this.queries += 1;

    const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(name)}&type=${type}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        // The JSON flavour of RFC 8484. Without this header the endpoint
        // answers with binary wire-format DNS, which we do not parse.
        headers: { accept: 'application/dns-json' },
        // No credentials, no cookies, and no redirects: a resolver that wants
        // to send us somewhere else is not a resolver we follow.
        redirect: 'error',
        signal: controller.signal,
      });

      if (!response.ok) return { addresses: [], error: `HTTP ${response.status}` };

      const text = await readCapped(response, MAX_REPLY_BYTES);
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        return { addresses: [], error: 'unparseable DoH reply' };
      }

      return { addresses: extractAddresses(payload, type) };
    } catch (error) {
      const aborted = controller.signal.aborted;
      return {
        addresses: [],
        error: aborted ? 'timeout' : error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Pull the addresses out of a DoH JSON reply.
 *
 * Deliberately narrow. `Answer` also carries the CNAME chain that led here,
 * and CNAME targets are NAMES, not addresses — filtering on the record type is
 * what keeps a chain from being mistaken for a destination. Every `data` value
 * is then re-parsed as an IP literal, so a resolver returning `"data":
 * "localhost"` under type 1 produces nothing rather than a hostname that some
 * later string comparison treats as an address.
 *
 * NXDOMAIN (Status 3) and every other non-zero Status yield no addresses,
 * which NetworkPolicy reports as NO_ADDRESSES and refuses.
 */
export function extractAddresses(payload: unknown, type: 'A' | 'AAAA'): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as { Status?: unknown; Answer?: unknown };
  if (record.Status !== 0) return [];
  if (!Array.isArray(record.Answer)) return [];

  const wanted = type === 'A' ? TYPE_A : TYPE_AAAA;
  const out: string[] = [];

  for (const entry of record.Answer) {
    if (!entry || typeof entry !== 'object') continue;
    const answer = entry as { type?: unknown; data?: unknown };
    if (answer.type !== wanted) continue;
    if (typeof answer.data !== 'string') continue;

    const parsed = parseResolvedAddress(answer.data.trim());
    if (!parsed) continue;
    // An A record must hold a v4 address and an AAAA a v6 one. A resolver
    // answering type 1 with an IPv6 address is confused or lying; either way
    // the mismatch is the interesting part, so it is dropped rather than
    // silently reclassified.
    if (parsed.version !== (wanted === TYPE_A ? 4 : 6)) continue;
    out.push(parsed.address);
  }

  return out;
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return await response.text();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    chunks.push(value);
    if (total > maxBytes) {
      await reader.cancel();
      // Truncated JSON will not parse, and that is the correct outcome: we do
      // not want a half-read answer from something behaving like this.
      break;
    }
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}
