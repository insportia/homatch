// HOMATCH RESEARCH CORE — one HTTP hop, over the platform's own fetch.
//
// `fetch`, `AbortController`, `TextDecoder` and `ReadableStream` are web
// standards present in Deno, Node 18+ and the browser, so this transport works
// unchanged in all three. No Buffer, no node:http.
//
// It follows no redirects, retries nothing and rate-limits nothing. All of
// that lives in HttpClient, so those behaviours are identical whether the
// bytes came from the network or from a fixture.

import { TimeoutError } from '../core/errors.ts';
import type { RawRequest, RawResponse, Transport } from './transport.ts';

export interface FetchTransportOptions {
  userAgent?: string;
  /** Hard cap on response size. Protects a worker from a multi-GB download. */
  maxBytes?: number;
}

export class FetchTransport implements Transport {
  readonly name = 'fetch';

  /**
   * False, and that is not something to paper over.
   *
   * The standard `fetch` offers no hook to connect to a specific IP, so the
   * hostname is resolved again inside the request — after the network policy
   * validated it. That window is exactly what DNS rebinding exploits.
   *
   * HttpClient refuses to pair a non-pinning transport with a policy in strict
   * mode. This transport is therefore for operator-configured endpoints whose
   * hostname is not attacker-controlled. Reaching an arbitrary user-supplied
   * URL needs a pinning transport, and there is not one that works in an Edge
   * Function — which is a real constraint, stated here rather than discovered
   * later.
   */
  readonly pinsAddresses = false;

  private readonly userAgent: string;
  private readonly maxBytes: number;

  constructor(options: FetchTransportOptions = {}) {
    this.userAgent =
      options.userAgent ?? 'HomatchResearch/1.0 (+respects robots.txt and rate limits)';
    this.maxBytes = options.maxBytes ?? 5_000_000;
  }

  async send(request: RawRequest): Promise<RawResponse> {
    const started = Date.now();
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    request.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);

    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: { 'user-agent': this.userAgent, ...request.headers },
        body: request.body,
        // The client follows redirects itself so it can record the chain and
        // enforce its own hop limit and cross-host policy — and, critically,
        // re-run the network policy on every hop.
        redirect: 'manual',
        signal: controller.signal,
      });

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });

      const maxBytes = request.maxBytes ?? this.maxBytes;
      const declaredLength = Number(headers['content-length'] ?? '0');
      if (declaredLength > maxBytes) {
        // Refuse before reading a byte. A declared length over the cap is the
        // cheapest possible place to stop.
        return {
          url: request.url,
          status: response.status,
          headers,
          body: '',
          bytes: declaredLength,
          truncated: true,
          durationMs: Date.now() - started,
        };
      }

      const capped = await readCapped(response, maxBytes);

      return {
        url: response.url || request.url,
        status: response.status,
        headers,
        body: capped.body,
        bytes: capped.bytes,
        truncated: capped.truncated,
        durationMs: Date.now() - started,
      };
    } catch (error) {
      // A timeout and a caller cancellation both surface as an abort. Only the
      // first is retryable, so they must not be reported as the same thing.
      if (controller.signal.aborted && !request.signal?.aborted) {
        throw new TimeoutError('Request exceeded its timeout', {
          timeoutMs: request.timeoutMs,
        });
      }
      throw error;
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);
    }
  }
}

async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<{ body: string; bytes: number; truncated: boolean }> {
  if (!response.body) return { body: '', bytes: 0, truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    chunks.push(value);
    if (total >= maxBytes) {
      truncated = true;
      await reader.cancel();
      break;
    }
  }

  const merged = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= merged.length) break;
    const room = merged.length - offset;
    merged.set(chunk.length > room ? chunk.subarray(0, room) : chunk, offset);
    offset += Math.min(chunk.length, room);
  }

  return {
    body: new TextDecoder('utf-8', { fatal: false }).decode(merged),
    bytes: merged.length,
    truncated,
  };
}
