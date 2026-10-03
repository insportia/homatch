// PHASE 2 — the portal runtime the SOURCE LIVE CHECK uses, and nothing else.
//
// WHY THIS IS NOT AN OPTION ON createPortalRuntime
//
// market/runtime.ts is imported by Verify (the research-agent edge function
// and the market lane). Any change to it -- even an opt-in option that is off
// by default -- changes Verify's bundle, puts Verify in the release scope and
// makes Verify owe a deployment. Verify is a hard boundary, so the Phase 2
// additions live HERE, in a module no Verify file imports:
//
//   - the CANDIDATE adapters (myhome.ge, livo.ge) and their source policies
//   - the discovery-browser routing (fetch/browser-transport.ts)
//
// It builds the same single door market/runtime.ts builds -- host allowlist
// derived from the policies, robots.txt through the same transport, rate
// limiter, circuit breakers, coalescer, cache -- over the existing portal
// policies PLUS the candidate policies, and registers the existing executable
// adapters (reused as-is from createPortalRuntime's registry) PLUS the
// candidates. Customer runs, campaigns and Verify keep calling
// createPortalRuntime and never see a candidate or a browser.

import { CircuitBreakerRegistry } from '../flow/circuit-breaker.ts';
import { RateLimiter } from '../flow/rate-limiter.ts';
import { RequestCoalescer } from '../flow/coalescer.ts';
import { HttpClient } from '../fetch/http-client.ts';
import { FetchTransport } from '../fetch/fetch-transport.ts';
import type { Transport } from '../fetch/transport.ts';
import { RoutingTransport } from '../fetch/browser-transport.ts';
import { NetworkPolicy } from '../net/network-policy.ts';
import { RobotsChecker, type RobotsFetcher } from '../net/robots.ts';
import { SourceAccessPolicyRegistry } from '../net/source-policy.ts';
import type { AdapterContext, AdapterDocument } from './adapter.ts';
import { PortalRegistry } from '../adapters/portal/types.ts';
import { candidateAdapters, CANDIDATE_POLICIES } from '../adapters/portal/candidates.ts';
import {
  createPortalRuntime, PORTAL_SOURCE_POLICIES, PORTAL_USER_AGENT, portalHostAllowlist,
} from '../market/runtime.ts';

export interface AuditRuntimeOptions {
  /** The hop for ordinary HTTP (edge fetch, or the worker's /discovery/fetch). */
  transport?: Transport;
  /** The discovery browser. Absent = no browser; used only for browser-only candidate hosts. */
  browserTransport?: Transport;
  now?: () => number;
  documentCache?: Map<string, { document: AdapterDocument; expiresAt: number }>;
}

export interface AuditRuntime {
  registry: PortalRegistry;
  context: AdapterContext;
  /** True when this URL would be rendered by the discovery browser. */
  usesBrowser(url: string): boolean;
}

export function createAuditPortalRuntime(options: AuditRuntimeOptions = {}): AuditRuntime {
  const now = options.now ?? (() => Date.now());
  const policies = [...PORTAL_SOURCE_POLICIES, ...CANDIDATE_POLICIES];
  const sourcePolicies = new SourceAccessPolicyRegistry(policies);
  const allowlist = portalHostAllowlist(policies);
  const baseTransport = options.transport ?? new FetchTransport({ maxBytes: 4_000_000, userAgent: PORTAL_USER_AGENT });
  const browserHosts = policies.filter((p) => p.browserRenderingAllowed).flatMap((p) => [...(p.hosts ?? []), ...p.domains]);
  const routing = options.browserTransport && browserHosts.length
    ? new RoutingTransport(baseTransport, options.browserTransport, browserHosts)
    : null;
  const transport: Transport = routing ?? baseTransport;

  const robotsFetcher: RobotsFetcher = {
    async fetch(robotsUrl: string) {
      try {
        const response = await transport.send({ url: robotsUrl, method: 'GET', headers: {}, timeoutMs: 8_000 });
        return { status: response.status, body: response.body };
      } catch {
        return null;
      }
    },
  };

  const client = new HttpClient({
    transport,
    robots: new RobotsChecker({ userAgent: PORTAL_USER_AGENT, fetcher: robotsFetcher, now }),
    rateLimiter: new RateLimiter({ defaultPolicy: { concurrency: 2, requestsPerSecond: 1 } }),
    breakers: new CircuitBreakerRegistry(),
    /* The allowlist IS the boundary: only hosts a policy names, before any DNS work. */
    networkPolicy: new NetworkPolicy({ hostAllowlistOnly: allowlist, skipDnsResolution: true, allowedPorts: [80, 443] }),
    sourcePolicies,
    requirePinningTransport: false,
    defaultTimeoutMs: 12_000,
  });

  const coalescer = new RequestCoalescer();
  const documents = options.documentCache ?? new Map<string, { document: AdapterDocument; expiresAt: number }>();

  const fetchDocument = async (url: string, fetchOptions?: { forceRefresh?: boolean }): Promise<AdapterDocument> => {
    const policy = client.policyFor(url);
    const key = `audit:${url}`;
    if (!fetchOptions?.forceRefresh) {
      const cached = documents.get(key);
      if (cached && cached.expiresAt > now()) return cached.document;
    }
    return coalescer.run(key, async () => {
      const result = await client.fetch(url);
      const document: AdapterDocument = {
        url: result.finalUrl,
        status: result.status,
        body: result.body,
        contentType: result.contentType?.mime ?? null,
        retrievedAt: new Date(now()).toISOString(),
        via: routing?.usesBrowser(url) ? 'browser' : 'http',
      };
      if (result.status >= 200 && result.status < 300) documents.set(key, { document, expiresAt: now() + policy.cacheTtlMs });
      return document;
    });
  };

  /* The executable adapters exactly as customer runs have them, plus the candidates. */
  const registry = new PortalRegistry();
  for (const adapter of createPortalRuntime({ transport: baseTransport }).registry.all()) registry.register(adapter);
  for (const candidate of candidateAdapters()) registry.register(candidate);

  return {
    registry,
    context: { fetchDocument, authenticatedSession: false, now },
    usesBrowser: (url: string) => routing?.usesBrowser(url) ?? false,
  };
}
