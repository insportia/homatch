// routingDispatcher.ts — the worker's global HTTP dispatcher when metering or the proxy is switched on
// (PROXY_METERING=1 or PROXY_ENABLED=1; both off = Node's default, nothing changes).
//
// Every fetch in the worker passes through dispatch(): the request is attributed (proxyGateway
// currentTraffic), sent direct or through the provider per PROXY_ROUTES, and its bytes are counted
// as they stream. Blocks on a routed domain feed its breaker; while the breaker is open the request
// is refused locally (SOURCE_SUSPENDED) instead of being sent again from another IP.

import { Agent, Dispatcher, DecoratorHandler, ProxyAgent, setGlobalDispatcher } from 'undici';
import { URL } from 'node:url';

/* undici 7's typings still describe the legacy handler; the runtime class has the new methods. */
const HandlerBase = DecoratorHandler as unknown as new (handler: unknown) => any;
const utf8 = new TextEncoder();
import { currentTraffic, DomainBreaker, DomainSuspendedError, isBlock, proxyCredentials, routeFor, TrafficMeter, type ProxyConfig, type TrafficContext } from './proxyGateway.js';

const bodyBytes = (body: unknown): number => {
  if (body == null) return 0;
  if (typeof body === 'string') return utf8.encode(body).length;
  if (body instanceof Uint8Array) return body.byteLength;
  if (body instanceof ArrayBuffer) return body.byteLength;
  return 0; // streams are counted as unknown (0) rather than guessed
};
const headerBytes = (h: unknown): number => {
  if (!h) return 0;
  if (Array.isArray(h)) return h.reduce((n, v) => n + String(v).length + 2, 0);
  if (typeof h === 'object') return Object.entries(h as Record<string, unknown>).reduce((n, [k, v]) => n + k.length + String(v).length + 4, 0);
  return 0;
};

class MeteringHandler extends HandlerBase {
  private down = 0;
  private status = 0;
  private sample = '';
  constructor(handler: Dispatcher.DispatchHandler, private readonly done: (status: number, down: number, sample: string) => void) { super(handler); }
  onResponseStart(controller: any, statusCode: number, headers: any, statusMessage?: string): void {
    this.status = statusCode;
    this.down += headerBytes(headers) + 16;
    return super.onResponseStart(controller, statusCode, headers, statusMessage);
  }
  onResponseData(controller: any, chunk: Uint8Array): void {
    this.down += chunk.length;
    if (this.sample.length < 4096) this.sample += new TextDecoder('latin1').decode(new Uint8Array(chunk.subarray(0, 4096 - this.sample.length)));
    return super.onResponseData(controller, chunk);
  }
  onResponseEnd(controller: any, trailers: any): void {
    try { this.done(this.status, this.down, this.sample); } catch { /* metering never breaks a request */ }
    return super.onResponseEnd(controller, trailers);
  }
  onResponseError(controller: any, err: Error): void {
    try { this.done(this.status || 0, this.down, ''); } catch { /* metering never breaks a request */ }
    return super.onResponseError(controller, err);
  }
}

export class RoutingDispatcher extends Dispatcher {
  private readonly direct: Dispatcher;
  private readonly proxies = new Map<string, ProxyAgent>();
  constructor(private readonly cfg: ProxyConfig, readonly meter: TrafficMeter, readonly breaker: DomainBreaker, direct?: Dispatcher) {
    super();
    this.direct = direct ?? new Agent();
  }

  private proxyAgent(key: string, creds: { server: string; username: string; password: string }): ProxyAgent {
    let a = this.proxies.get(key);
    if (!a) {
      const token = `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}`;
      a = new ProxyAgent({ uri: creds.server, token });
      this.proxies.set(key, a);
      // Sticky agents are per job and domain: keep the map bounded.
      if (this.proxies.size > 500) { const first = this.proxies.keys().next().value as string; void this.proxies.get(first)?.close(); this.proxies.delete(first); }
    }
    return a;
  }

  dispatch(opts: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean {
    let host = '';
    try { host = new URL(String(opts.origin ?? '')).hostname; } catch { /* unknown origin: direct, unmetered domain */ }
    const ctx: TrafficContext = currentTraffic();
    const hit = host ? routeFor(host, this.cfg) : null;
    const domain = hit?.domain ?? (host.split('.').slice(-2).join('.') || 'unknown');
    if (hit && this.breaker.isOpen(hit.domain)) {
      (handler as any).onResponseError?.(null, new DomainSuspendedError(hit.domain)) ?? (handler as any).onError?.(new DomainSuspendedError(hit.domain));
      return false;
    }
    const via: 'proxy' | 'direct' = this.cfg.enabled && hit?.route.mode === 'proxy' ? 'proxy' : 'direct';
    const session = via === 'proxy' ? hit!.route.session : null;
    const up = bodyBytes(opts.body) + headerBytes(opts.headers) + String(opts.path ?? '').length + 16;
    const target = via === 'proxy'
      ? this.proxyAgent(session === 'sticky' ? `${ctx.jobId ?? ctx.worker}|${hit!.domain}` : `rotating|${hit!.domain}`, proxyCredentials(this.cfg, hit!.route, session === 'sticky' ? `${ctx.jobId ?? ctx.worker}${hit!.domain}` : `${Date.now()}`))
      : this.direct;
    const metered = new MeteringHandler(handler, (status, down, sample) => {
      const blocked = isBlock(status, sample);
      this.meter.record(ctx, domain, via, session, up, down, blocked);
      if (hit) this.breaker.onResult(hit.domain, blocked);
    });
    return target.dispatch(opts, metered as unknown as Dispatcher.DispatchHandler);
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.direct.close(), ...[...this.proxies.values()].map((a) => a.close())]);
  }
}

/** Installs the dispatcher for every fetch in the worker when metering or the proxy is on; returns it (or null: untouched). */
export function installNetworkLayer(cfg: ProxyConfig, env: Record<string, string | undefined> = process.env): RoutingDispatcher | null {
  if (!cfg.enabled && !/^(1|true|on)$/i.test(String(env.PROXY_METERING ?? ''))) return null;
  const d = new RoutingDispatcher(cfg, new TrafficMeter(cfg), new DomainBreaker(cfg.breakerBlocks, cfg.breakerCooldownMs));
  setGlobalDispatcher(d);
  return d;
}
