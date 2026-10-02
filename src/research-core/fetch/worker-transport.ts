// HOMATCH RESEARCH CORE — one HTTP hop, performed by the official worker.
//
// PHASE 2. Some portals answer the official Railway worker but not an edge
// runtime, and the worker can do what an edge function cannot: resolve the
// hostname itself and pin the connection to the address it validated. This
// transport hands each hop to POST {worker}/discovery/fetch, authenticated
// with WORKER_TOKEN, and returns the worker's answer as a RawResponse.
//
// Everything above the transport is unchanged and still runs HERE first: the
// host allowlist, robots.txt, rate limits, circuit breakers and per-hop
// redirect policy all live in HttpClient. The worker re-checks the target
// (public unicast only, ports 80/443, no literal IPs) and never follows a
// redirect, so policy decides every hop twice.

import { TimeoutError } from '../core/errors.ts';
import type { RawRequest, RawResponse, Transport } from './transport.ts';

export interface WorkerTransportOptions {
  baseUrl: string;
  token: string;
  userAgent?: string;
  trace?: string;
}

export class WorkerTransportError extends Error {
  readonly kind: string;
  constructor(kind: string, message: string) { super(message); this.kind = kind; }
}

export class WorkerTransport implements Transport {
  readonly name = 'official-worker';
  /** The worker connects to the address it validated (SafeFetch.ts). */
  readonly pinsAddresses = true;

  private readonly options: WorkerTransportOptions;
  constructor(options: WorkerTransportOptions) { this.options = options; }

  get configured(): boolean {
    return Boolean(this.options.baseUrl && this.options.token);
  }

  async send(request: RawRequest): Promise<RawResponse> {
    if (!this.configured) throw new WorkerTransportError('NOT_CONFIGURED', 'WORKER_URL or WORKER_TOKEN is not configured');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs + 5_000);
    try {
      const response = await fetch(`${this.options.baseUrl.replace(/\/$/, '')}/discovery/fetch`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.token}`,
          'content-type': 'application/json',
          ...(this.options.trace ? { 'x-homatch-trace': this.options.trace } : {}),
        },
        body: JSON.stringify({
          url: request.url,
          method: request.method === 'HEAD' ? 'HEAD' : 'GET',
          headers: { ...(this.options.userAgent ? { 'user-agent': this.options.userAgent } : {}), ...request.headers },
          timeoutMs: request.timeoutMs,
          maxBytes: request.maxBytes,
        }),
        signal: controller.signal,
      });
      if (response.status === 401) throw new WorkerTransportError('AUTH_FAILED', 'WORKER_TOKEN_REJECTED');
      const payload = await response.json().catch(() => null) as
        | { ok: true; response: RawResponse }
        | { ok: false; error: { kind: string } }
        | null;
      if (!payload) throw new WorkerTransportError('BAD_RESPONSE', `worker answered ${response.status}`);
      if (!payload.ok) {
        if (payload.error.kind === 'TIMEOUT') throw new TimeoutError('Worker hop exceeded its timeout', { timeoutMs: request.timeoutMs });
        throw new WorkerTransportError(payload.error.kind, payload.error.kind);
      }
      return payload.response;
    } catch (error) {
      if (controller.signal.aborted) throw new TimeoutError('Worker hop exceeded its timeout', { timeoutMs: request.timeoutMs });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
