// HOMATCH RESEARCH CORE — a deterministic in-memory network. TEST USE ONLY.
//
// Nothing in production may construct this. It exists so that "a hundred
// concurrent requests collapse to one fetch" is a claim backed by a call log
// rather than by a comment, and so no test in this repository ever contacts a
// third-party site.

import { canonicalizeUrl } from '../normalize/url.ts';
import type { RawRequest, RawResponse, Transport } from './transport.ts';

export interface MockRoute {
  /** Exact URL, or a RegExp tested against the full URL. */
  match: string | RegExp;
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  /** Simulated latency for this route. */
  delayMs?: number;
  /**
   * Fail the first N calls with `failStatus`, then succeed. Models the
   * 429-then-200 and flaky-503 behaviour the retry/breaker logic exists for.
   */
  failFirst?: number;
  failStatus?: number;
  failHeaders?: Record<string, string>;
  /** Always fail - used to drive the circuit breaker demo. */
  alwaysFail?: boolean;
  /** Redirect target; the client follows it and records the chain. */
  redirectTo?: string;
}

export interface MockTransportOptions {
  /** Latency applied to routes without their own delay. */
  defaultDelayMs?: number;
  /** Response for unmatched URLs. */
  notFoundStatus?: number;
  /** Optional jitter so the load test is not artificially uniform. */
  jitterMs?: number;
  random?: () => number;
}

export interface MockCallRecord {
  url: string;
  at: number;
  status: number;
}

/**
 * Deterministic in-memory network.
 *
 * Every demo and test in this repo uses it, which is what makes "1,000
 * concurrent requests" a safe thing to run: no third-party site is ever
 * contacted, latency is configurable, and the call log gives us hard evidence
 * for the coalescing and cache claims (`callsFor(url)` is the assertion).
 */
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder('utf-8', { fatal: false });

export class MockTransport implements Transport {
  readonly name = 'mock';
  /**
   * Vacuously true: this transport never opens a socket, so there is no second
   * DNS resolution and nothing to rebind. Declaring it lets the strict-by-
   * default pinning check in HttpClient stay on for tests and demos.
   */
  readonly pinsAddresses = true;
  private readonly routes: MockRoute[] = [];
  private readonly hits = new Map<string, number>();
  private readonly calls: MockCallRecord[] = [];
  private readonly options: Required<Omit<MockTransportOptions, 'random'>> & { random: () => number };

  constructor(routes: MockRoute[] = [], options: MockTransportOptions = {}) {
    this.routes = [...routes];
    this.options = {
      defaultDelayMs: options.defaultDelayMs ?? 0,
      notFoundStatus: options.notFoundStatus ?? 404,
      jitterMs: options.jitterMs ?? 0,
      random: options.random ?? Math.random,
    };
  }

  addRoute(route: MockRoute): this {
    this.routes.push(route);
    return this;
  }

  async send(request: RawRequest): Promise<RawResponse> {
    const started = Date.now();
    const route = this.routes.find((candidate) => matches(candidate.match, request.url));

    const count = (this.hits.get(request.url) ?? 0) + 1;
    this.hits.set(request.url, count);

    const delay =
      (route?.delayMs ?? this.options.defaultDelayMs) +
      (this.options.jitterMs > 0 ? Math.floor(this.options.random() * this.options.jitterMs) : 0);
    if (delay > 0) await sleep(delay, request.signal);

    if (!route) {
      this.calls.push({ url: request.url, at: started, status: this.options.notFoundStatus });
      return this.respond(request, started, {
        status: this.options.notFoundStatus,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: '<html><body>Not found</body></html>',
      });
    }

    if (route.redirectTo) {
      this.calls.push({ url: request.url, at: started, status: route.status ?? 301 });
      return this.respond(request, started, {
        status: route.status ?? 301,
        headers: { location: route.redirectTo, ...(route.headers ?? {}) },
        body: '',
      });
    }

    const shouldFail = route.alwaysFail || (route.failFirst !== undefined && count <= route.failFirst);
    if (shouldFail) {
      const status = route.failStatus ?? 503;
      this.calls.push({ url: request.url, at: started, status });
      return this.respond(request, started, {
        status,
        headers: { 'content-type': 'text/plain', ...(route.failHeaders ?? {}) },
        body: `mock failure ${status}`,
      });
    }

    const status = route.status ?? 200;
    this.calls.push({ url: request.url, at: started, status });

    return this.respond(request, started, {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8', ...(route.headers ?? {}) },
      body: route.body ?? '',
    });
  }

  /** Applies the caller's byte cap the way a real transport would. */
  private respond(
    request: RawRequest,
    started: number,
    parts: { status: number; headers: Record<string, string>; body: string },
  ): RawResponse {
    const full = ENCODER.encode(parts.body);
    const maxBytes = request.maxBytes ?? Number.POSITIVE_INFINITY;
    const truncated = full.byteLength > maxBytes;
    const body = truncated ? DECODER.decode(full.subarray(0, maxBytes)) : parts.body;

    return {
      url: request.url,
      status: parts.status,
      headers: parts.headers,
      body,
      bytes: truncated ? maxBytes : full.byteLength,
      truncated,
      durationMs: Date.now() - started,
    };
  }

  /** Total hops served, including redirects and failures. */
  get totalCalls(): number {
    return this.calls.length;
  }

  /** Hops served for one URL - the coalescing/cache assertion. */
  callsFor(url: string): number {
    const canonical = canonicalizeUrl(url) ?? url;
    return this.calls.filter((call) => (canonicalizeUrl(call.url) ?? call.url) === canonical).length;
  }

  callLog(): readonly MockCallRecord[] {
    return this.calls;
  }

  reset(): void {
    this.hits.clear();
    this.calls.length = 0;
  }
}

function matches(match: string | RegExp, url: string): boolean {
  if (typeof match === 'string') {
    return match === url || (canonicalizeUrl(match) ?? match) === (canonicalizeUrl(url) ?? url);
  }
  return match.test(url);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
