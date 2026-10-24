// proxyGateway.ts — one shared, metered network layer for Verify, Property Search, SS.ge, MyHome and
// URL import (owner 2026-10-24, Verify at scale).
//
// WHAT IT DOES
//   * Meters every outbound HTTP request of the worker (bytes up/down, requests, retries) per job,
//     worker type and domain — whether or not a proxy is used — so proxy bandwidth is measured,
//     never assumed, before a package is bought.
//   * Routes a request through the residential proxy ONLY when its domain is listed in PROXY_ROUTES
//     with mode "proxy" and the provider credentials are set (Railway variables; never logged).
//     Everything else goes direct, exactly as before.
//   * Sticky sessions keep one exit IP for a whole job on a domain (CAPTCHA flows, record continuity);
//     rotating sessions are used only where the route says the requests are independent.
//   * A per-domain breaker counts blocks (403, 429, CAPTCHA pages). Repeated blocks SUSPEND traffic to
//     that domain for a cooldown — they never trigger IP rotation. Access rules are respected.
//
// WHAT IT DOES NOT DO
//   * It never enables a proxy on its own. A domain is proxied only by the owner's PROXY_ROUTES.
//   * It never retries through a new IP after a block.

import { AsyncLocalStorage } from 'node:async_hooks';
import { URL } from 'node:url';

export type RouteMode = 'proxy' | 'direct';
export type SessionMode = 'sticky' | 'rotating';
export interface ProxyRoute { mode: RouteMode; session: SessionMode; blockAssets: boolean }
export interface ProxyConfig {
  enabled: boolean;
  provider: string;
  host: string;
  port: number;
  username: string;
  password: string;
  country: string;
  /** Provider username format: {user} {country} {session}. DataImpulse: "{user}__cr.{country};sessid.{session}". */
  stickyTemplate: string;
  rotatingTemplate: string;
  routes: Record<string, ProxyRoute>;
  costPerGbUsd: number | null;
  breakerBlocks: number;
  breakerCooldownMs: number;
}

const bool = (v: unknown) => /^(1|true|yes|on)$/i.test(String(v ?? ''));

/** PROXY_ROUTES: {"ss.ge":{"mode":"proxy","session":"rotating"},"napr.gov.ge":"direct"} — a suffix match on the host. */
export function parseRoutes(raw: unknown): Record<string, ProxyRoute> {
  let o: unknown = raw;
  if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch { return {}; } }
  const out: Record<string, ProxyRoute> = {};
  if (!o || typeof o !== 'object') return out;
  for (const [domain, v] of Object.entries(o as Record<string, unknown>)) {
    const d = domain.trim().toLowerCase().replace(/^\*?\./, '');
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) continue;
    const r = typeof v === 'string' ? { mode: v } : (v as Record<string, unknown>) ?? {};
    out[d] = {
      mode: r.mode === 'proxy' ? 'proxy' : 'direct',
      session: r.session === 'rotating' ? 'rotating' : 'sticky',
      blockAssets: r.blockAssets !== false,
    };
  }
  return out;
}

export function parseProxyConfig(env: Record<string, string | undefined> = process.env): ProxyConfig {
  const port = Math.trunc(Number(env.PROXY_PORT));
  const cost = Number(env.PROXY_COST_PER_GB_USD);
  const host = String(env.PROXY_HOST ?? '').trim();
  const username = String(env.PROXY_USERNAME ?? '');
  const password = String(env.PROXY_PASSWORD ?? '');
  return {
    enabled: bool(env.PROXY_ENABLED) && !!host && Number.isFinite(port) && port > 0 && !!username && !!password,
    provider: String(env.PROXY_PROVIDER ?? 'unknown').slice(0, 40),
    host,
    port: Number.isFinite(port) ? port : 0,
    username,
    password,
    country: String(env.PROXY_COUNTRY ?? 'ge').toLowerCase().slice(0, 4),
    stickyTemplate: env.PROXY_STICKY_TEMPLATE || '{user}',
    rotatingTemplate: env.PROXY_ROTATING_TEMPLATE || '{user}',
    routes: parseRoutes(env.PROXY_ROUTES),
    costPerGbUsd: Number.isFinite(cost) && cost > 0 ? cost : null,
    breakerBlocks: Math.max(2, Math.trunc(Number(env.PROXY_BREAKER_BLOCKS)) || 5),
    breakerCooldownMs: Math.max(30, Math.trunc(Number(env.PROXY_BREAKER_COOLDOWN_SECONDS)) || 600) * 1000,
  };
}

/** The route for a host: the longest listed suffix, or null (direct, metered). */
export function routeFor(host: string, cfg: ProxyConfig): { domain: string; route: ProxyRoute } | null {
  const h = host.toLowerCase();
  let best: string | null = null;
  for (const d of Object.keys(cfg.routes)) if ((h === d || h.endsWith('.' + d)) && (!best || d.length > best.length)) best = d;
  return best ? { domain: best, route: cfg.routes[best] } : null;
}

/** Proxy credentials for one request: sticky sessions are keyed by job and domain (one exit IP per job per site). */
export function proxyCredentials(cfg: ProxyConfig, route: ProxyRoute, sessionKey: string): { server: string; username: string; password: string } {
  const session = sessionKey.replace(/[^A-Za-z0-9]/g, '').slice(0, 24) || 'homatch';
  const template = route.session === 'sticky' ? cfg.stickyTemplate : cfg.rotatingTemplate;
  const username = template.replaceAll('{user}', cfg.username).replaceAll('{country}', cfg.country).replaceAll('{session}', session);
  return { server: `http://${cfg.host}:${cfg.port}`, username, password: cfg.password };
}

/* ------------------------------------------------------------------ *
 * Who is making the request                                          *
 * ------------------------------------------------------------------ */

export interface TrafficContext { jobId: string | null; worker: string; retry?: boolean }
const context = new AsyncLocalStorage<TrafficContext>();
/** Runs fn with its outbound traffic attributed to a job and worker type (verify, property_search, ssge, myhome, url_import…). */
export function withTraffic<T>(ctx: TrafficContext, fn: () => T): T { return context.run(ctx, fn); }
export function currentTraffic(): TrafficContext { return context.getStore() ?? { jobId: null, worker: 'other' }; }

/* ------------------------------------------------------------------ *
 * Metering                                                            *
 * ------------------------------------------------------------------ */

export interface UsageRow {
  jobId: string | null; worker: string; domain: string; via: 'proxy' | 'direct'; provider: string | null; session: SessionMode | null;
  requests: number; retries: number; bytesUp: number; bytesDown: number; blocked: number; estCostUsd: number | null;
}

export class TrafficMeter {
  private rows = new Map<string, UsageRow>();
  constructor(private readonly cfg: Pick<ProxyConfig, 'provider' | 'costPerGbUsd'>) {}
  record(ctx: TrafficContext, domain: string, via: 'proxy' | 'direct', session: SessionMode | null, up: number, down: number, blocked = false): void {
    const key = [ctx.jobId ?? '-', ctx.worker, domain, via, session ?? '-'].join('|');
    const r = this.rows.get(key) ?? { jobId: ctx.jobId, worker: ctx.worker, domain, via, provider: via === 'proxy' ? this.cfg.provider : null, session, requests: 0, retries: 0, bytesUp: 0, bytesDown: 0, blocked: 0, estCostUsd: null };
    r.requests += 1;
    if (ctx.retry) r.retries += 1;
    r.bytesUp += Math.max(0, up);
    r.bytesDown += Math.max(0, down);
    if (blocked) r.blocked += 1;
    r.estCostUsd = via === 'proxy' && this.cfg.costPerGbUsd != null ? Math.round(((r.bytesUp + r.bytesDown) / 1e9) * this.cfg.costPerGbUsd * 1e6) / 1e6 : null;
    this.rows.set(key, r);
  }
  /** Rows since the last drain (flushed to verify-queue proxy_usage). */
  drain(): UsageRow[] {
    const out = [...this.rows.values()];
    this.rows.clear();
    return out;
  }
  size(): number { return this.rows.size; }
}

/* ------------------------------------------------------------------ *
 * Blocks suspend traffic; they never rotate IPs                       *
 * ------------------------------------------------------------------ */

const CAPTCHA_MARKERS = /g-recaptcha|hcaptcha|cf-challenge|challenge-platform|captcha/i;
export function isBlock(status: number, bodySample = ''): boolean {
  return status === 403 || status === 429 || (status >= 200 && status < 300 && CAPTCHA_MARKERS.test(bodySample) && bodySample.length < 20000);
}

export class DomainBreaker {
  private state = new Map<string, { blocks: number; openUntil: number }>();
  constructor(private readonly blocks: number, private readonly cooldownMs: number, private readonly now: () => number = Date.now) {}
  /** True while the domain is suspended after repeated blocks. */
  isOpen(domain: string): boolean { return (this.state.get(domain)?.openUntil ?? 0) > this.now(); }
  onResult(domain: string, blocked: boolean): void {
    const s = this.state.get(domain) ?? { blocks: 0, openUntil: 0 };
    if (!blocked) { s.blocks = 0; this.state.set(domain, s); return; }
    s.blocks += 1;
    if (s.blocks >= this.blocks) { s.openUntil = this.now() + this.cooldownMs; s.blocks = 0; }
    this.state.set(domain, s);
  }
  snapshot(): Record<string, { open: boolean; openUntil: string | null }> {
    const out: Record<string, { open: boolean; openUntil: string | null }> = {};
    for (const [d, s] of this.state) out[d] = { open: s.openUntil > this.now(), openUntil: s.openUntil > this.now() ? new Date(s.openUntil).toISOString() : null };
    return out;
  }
}

export class DomainSuspendedError extends Error {
  constructor(readonly domain: string) { super(`SOURCE_SUSPENDED ${domain}: repeated blocks, traffic paused`); }
}

/* ------------------------------------------------------------------ *
 * Browser side (Playwright)                                           *
 * ------------------------------------------------------------------ */

/** Asset types a proxied page does not need for verification (bandwidth): images, media, fonts. Never scripts or documents. */
export const BLOCKABLE_RESOURCE_TYPES = new Set(['image', 'media', 'font']);
export const TRACKER_HOSTS = /(^|\.)(google-analytics\.com|googletagmanager\.com|doubleclick\.net|facebook\.net|connect\.facebook\.net|hotjar\.com|yandex\.ru|mc\.yandex\.ru|clarity\.ms)$/i;

/** The Playwright proxy option for a job whose start URL's domain is proxied, or undefined (direct). */
export function browserProxyFor(cfg: ProxyConfig, startUrl: string, jobId: string): { server: string; username: string; password: string } | undefined {
  if (!cfg.enabled) return undefined;
  let host = '';
  try { host = new URL(startUrl).hostname; } catch { return undefined; }
  const hit = routeFor(host, cfg);
  if (!hit || hit.route.mode !== 'proxy') return undefined;
  return proxyCredentials(cfg, { ...hit.route, session: 'sticky' }, `${jobId}${hit.domain}`);
}
