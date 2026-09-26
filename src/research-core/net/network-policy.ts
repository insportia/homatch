// HOMATCH RESEARCH CORE — the SSRF boundary.
//
// The rule is easy to state and easy to get wrong: a URL that arrived from a
// customer, a search provider or a redirect header is attacker-controlled, and
// must not be allowed to make Homatch talk to anything inside its own network.
//
// Three things must be true, and checking only the first two is the usual bug:
//
//   1. the scheme is http(s) — not file:, data:, gopher:, javascript:
//   2. the hostname is neither an internal name nor an IP literal in a private
//      range, in ANY of its legal spellings (see ./ip.ts)
//   3. EVERY address the hostname actually resolves to is public
//
// Rule 3 is the one that matters, because a public hostname can resolve to
// 127.0.0.1 and in an attack routinely does. It also means the check must be
// repeated for every redirect target, never only for the first URL.
//
// WHY THERE IS NO BUILT-IN RESOLVER
//
// This module runs in a Deno Edge Function, in the Node test runner, and is
// type-checked by the Vite build. `node:dns` exists in exactly one of those.
// So the resolver is injected, and a policy with no resolver and DNS not
// explicitly skipped FAILS CLOSED: if we cannot prove the host is public, we
// do not connect to it. Failing open here would make the whole file
// decorative.
//
// DNS REBINDING: resolving and then connecting by hostname leaves a window in
// which the answer can change between the two. `resolveTarget` returns the
// validated addresses so a transport that is able to pin the connection can do
// so. The WHATWG `fetch` available in every runtime cannot pin, and that is
// named as a limitation in fetch/fetch-transport.ts rather than papered over.

import { ResearchError } from '../core/errors.ts';
import {
  classifyIp,
  ipInCidr,
  isBlockedCategory,
  parseCidr,
  parseIpLiteral,
  parseResolvedAddress,
  type Cidr,
  type IpCategory,
  type ParsedIp,
} from './ip.ts';

export type DenyReason =
  | 'SCHEME_NOT_ALLOWED'
  | 'CREDENTIALS_IN_URL'
  | 'MALFORMED_URL'
  | 'HOST_BLOCKED'
  | 'HOST_NOT_ALLOWLISTED'
  | 'INTERNAL_HOSTNAME'
  | 'PORT_NOT_ALLOWED'
  | 'PRIVATE_ADDRESS'
  | 'DNS_FAILURE'
  | 'DNS_UNAVAILABLE'
  | 'NO_ADDRESSES';

export interface NetworkDecision {
  allowed: boolean;
  reason?: DenyReason;
  detail?: string;
  host: string;
  addresses: ParsedIp[];
  /** Category of the first offending address, when one was the cause. */
  category?: IpCategory;
}

export interface ResolvedTarget {
  url: string;
  host: string;
  port: number;
  protocol: 'http:' | 'https:';
  /** Validated addresses. A transport able to pin should connect to one. */
  addresses: ParsedIp[];
}

export interface DnsResolver {
  /** Resolve a hostname to every A/AAAA address. */
  resolve(hostname: string): Promise<string[]>;
}

/** Resolver for tests and fixtures: a fixed hostname -> addresses map. */
export class StaticDnsResolver implements DnsResolver {
  private readonly table: Record<string, string[]>;

  constructor(table: Record<string, string[]>) {
    this.table = table;
  }

  async resolve(hostname: string): Promise<string[]> {
    const addresses = this.table[hostname.toLowerCase()];
    if (!addresses) {
      throw new ResearchError('NOT_FOUND', 'No DNS record', {
        retryable: false,
        details: { hostname },
      });
    }
    return addresses;
  }
}

export interface NetworkPolicyOptions {
  /**
   * Allow private/loopback/link-local destinations. Off by default and should
   * stay off; use `allowedHosts`/`allowedCidrs` for deliberate exceptions.
   */
  allowPrivateNetworks?: boolean;
  /**
   * Hosts that bypass the private-range check entirely. Exact match, or a
   * leading-dot suffix (".internal.example.com").
   */
  allowedHosts?: string[];
  /** Address ranges that bypass the private-range check. */
  allowedCidrs?: string[];
  /** Hosts denied regardless of what they resolve to. */
  blockedHosts?: string[];
  /** Default: http and https only. */
  allowedSchemes?: string[];
  /** Default: null (any port). Set to restrict, e.g. [80, 443]. */
  allowedPorts?: number[] | null;
  /** Allow user:password@host URLs. Off by default: credentials leak in logs. */
  allowCredentials?: boolean;
  /**
   * When set, ONLY these hosts may be contacted at all. The strictest mode and
   * the right one for a deployment with a fixed source catalogue — which is
   * what Homatch has.
   */
  hostAllowlistOnly?: string[];
  resolver?: DnsResolver;
  /**
   * Skip DNS entirely. ONLY legitimate with a mock transport, where no socket
   * is ever opened. Setting this with a real transport disables rule 3.
   */
  skipDnsResolution?: boolean;
}

/**
 * The host as every check below must see it.
 *
 * Two things are stripped, and forgetting the second one was a real hole.
 *
 * Brackets: `[::1]` arrives bracketed from `URL.hostname` and no IP parser
 * wants them.
 *
 * THE FQDN ROOT DOT. `localhost.` and `localhost` are the same name — the
 * trailing dot only says "already absolute" — but `INTERNAL_HOST_EXACT` is a
 * string set, and `'localhost.'` is not in it. So `http://localhost。/`
 * (U+3002 IDEOGRAPHIC FULL STOP, which IDNA maps to an ordinary dot) walked
 * straight past the pre-DNS check, as did `metadata.google.internal.`. Rule 3
 * still caught both wherever a resolver was configured, which is exactly why
 * this was worth fixing rather than shrugging at: a defence-in-depth layer
 * that silently stopped defending would not have announced itself until the
 * day it was the only layer left.
 *
 * Only ONE trailing dot is removed. `host..` is not a legal name, and quietly
 * repairing it into one would be inventing a host the caller did not ask for.
 */
export function canonicalHost(hostname: string): string {
  const unbracketed = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return unbracketed.length > 1 && unbracketed.endsWith('.')
    ? unbracketed.slice(0, -1)
    : unbracketed;
}

/**
 * Hostnames that are internal by convention. Blocked before DNS, because in a
 * container these often resolve to something useful to an attacker.
 */
const INTERNAL_HOST_SUFFIXES = [
  'localhost',
  '.localhost',
  '.local',
  '.internal',
  '.intranet',
  '.private',
  '.corp',
  '.lan',
  '.home.arpa',
  '.cluster.local',
  '.svc',
  '.svc.cluster.local',
];

const INTERNAL_HOST_EXACT = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
  'instance-data',
  'instance-data.ec2.internal',
  '169.254.169.254.nip.io',
]);

export class NetworkPolicy {
  private readonly resolver: DnsResolver | null;
  private readonly allowedCidrs: Cidr[];
  private readonly allowedHosts: string[];
  private readonly blockedHosts: string[];
  private readonly allowlistOnly: string[] | null;
  private readonly allowedSchemes: Set<string>;

  private readonly options: NetworkPolicyOptions;

  constructor(options: NetworkPolicyOptions = {}) {
    this.options = options;

    this.resolver = options.resolver ?? null;
    this.allowedCidrs = (options.allowedCidrs ?? [])
      .map((value) => parseCidr(value))
      .filter((cidr): cidr is Cidr => cidr !== null);
    this.allowedHosts = (options.allowedHosts ?? []).map((host) => host.toLowerCase());
    this.blockedHosts = (options.blockedHosts ?? []).map((host) => host.toLowerCase());
    this.allowlistOnly = options.hostAllowlistOnly
      ? options.hostAllowlistOnly.map((host) => host.toLowerCase())
      : null;
    this.allowedSchemes = new Set(
      (options.allowedSchemes ?? ['http:', 'https:']).map((scheme) =>
        scheme.endsWith(':') ? scheme.toLowerCase() : `${scheme.toLowerCase()}:`,
      ),
    );
  }

  /** Non-throwing check. Returns WHY a URL was refused, for the operator. */
  async check(url: string): Promise<NetworkDecision> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { allowed: false, reason: 'MALFORMED_URL', host: '', addresses: [] };
    }

    const host = canonicalHost(parsed.hostname);

    if (!this.allowedSchemes.has(parsed.protocol.toLowerCase())) {
      return {
        allowed: false,
        reason: 'SCHEME_NOT_ALLOWED',
        detail: parsed.protocol,
        host,
        addresses: [],
      };
    }

    if (!this.options.allowCredentials && (parsed.username || parsed.password)) {
      return { allowed: false, reason: 'CREDENTIALS_IN_URL', host, addresses: [] };
    }

    if (this.options.allowedPorts) {
      const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
      if (!this.options.allowedPorts.includes(port)) {
        return {
          allowed: false, reason: 'PORT_NOT_ALLOWED', detail: String(port), host, addresses: [],
        };
      }
    }

    if (this.matchesHostList(host, this.blockedHosts)) {
      return { allowed: false, reason: 'HOST_BLOCKED', host, addresses: [] };
    }

    if (this.allowlistOnly && !this.matchesHostList(host, this.allowlistOnly)) {
      return { allowed: false, reason: 'HOST_NOT_ALLOWLISTED', host, addresses: [] };
    }

    const explicitlyAllowedHost = this.matchesHostList(host, this.allowedHosts);

    // IP literals are checked BEFORE the hostname heuristics. `[::1]` has no
    // dot in it and would otherwise be reported as an internal *hostname* —
    // still blocked, but with a reason that misdescribes what was blocked, and
    // the reason is what an operator debugs from.
    const literal = parseIpLiteral(host);
    if (literal) {
      const verdict = this.judgeAddress(literal, explicitlyAllowedHost);
      return verdict.allowed
        ? { allowed: true, host, addresses: [literal] }
        : {
            allowed: false, reason: 'PRIVATE_ADDRESS', category: verdict.category,
            host, addresses: [literal],
          };
    }

    if (!explicitlyAllowedHost && this.isInternalHostname(host)) {
      return { allowed: false, reason: 'INTERNAL_HOSTNAME', host, addresses: [] };
    }

    if (this.options.skipDnsResolution) {
      return { allowed: true, host, addresses: [] };
    }

    // FAIL CLOSED. No resolver means rule 3 cannot be enforced, and a policy
    // that silently skips its most important rule is worse than no policy,
    // because it reads like protection.
    if (!this.resolver) {
      return { allowed: false, reason: 'DNS_UNAVAILABLE', host, addresses: [] };
    }

    let resolved: string[];
    try {
      resolved = await this.resolver.resolve(host);
    } catch (error) {
      return {
        allowed: false,
        reason: 'DNS_FAILURE',
        detail: error instanceof Error ? error.message : String(error),
        host,
        addresses: [],
      };
    }

    const addresses = resolved
      .map((value) => parseResolvedAddress(value))
      .filter((ip): ip is ParsedIp => ip !== null);

    if (addresses.length === 0) {
      return { allowed: false, reason: 'NO_ADDRESSES', host, addresses: [] };
    }

    // EVERY address must pass. A hostname with one public and one loopback
    // record is an attack, not a misconfiguration, and connecting would pick
    // whichever the resolver felt like returning first.
    for (const address of addresses) {
      const verdict = this.judgeAddress(address, explicitlyAllowedHost);
      if (!verdict.allowed) {
        return {
          allowed: false,
          reason: 'PRIVATE_ADDRESS',
          category: verdict.category,
          detail: address.address,
          host,
          addresses,
        };
      }
    }

    return { allowed: true, host, addresses };
  }

  /** Throwing variant that returns the pinned target on success. */
  async resolveTarget(url: string): Promise<ResolvedTarget> {
    const decision = await this.check(url);
    if (!decision.allowed) throw new NetworkPolicyError(url, decision);

    const parsed = new URL(url);
    const protocol = parsed.protocol === 'https:' ? 'https:' : 'http:';
    return {
      url,
      host: decision.host,
      port: Number(parsed.port || (protocol === 'https:' ? 443 : 80)),
      protocol,
      addresses: decision.addresses,
    };
  }

  private judgeAddress(
    address: ParsedIp,
    hostExplicitlyAllowed: boolean,
  ): { allowed: boolean; category: IpCategory } {
    const category = classifyIp(address);
    if (!isBlockedCategory(category)) return { allowed: true, category };
    if (this.options.allowPrivateNetworks) return { allowed: true, category };
    if (hostExplicitlyAllowed) return { allowed: true, category };
    if (this.allowedCidrs.some((cidr) => ipInCidr(address, cidr))) {
      return { allowed: true, category };
    }
    return { allowed: false, category };
  }

  private isInternalHostname(host: string): boolean {
    if (INTERNAL_HOST_EXACT.has(host)) return true;
    if (!host.includes('.')) return true; // bare single-label names are internal
    return INTERNAL_HOST_SUFFIXES.some((suffix) =>
      suffix.startsWith('.') ? host.endsWith(suffix) : host === suffix,
    );
  }

  private matchesHostList(host: string, list: readonly string[]): boolean {
    return list.some((entry) => {
      if (entry.startsWith('.')) return host === entry.slice(1) || host.endsWith(entry);
      if (entry.startsWith('*.')) return host === entry.slice(2) || host.endsWith(entry.slice(1));
      return host === entry;
    });
  }
}

export class NetworkPolicyError extends ResearchError {
  readonly decision: NetworkDecision;

  constructor(url: string, decision: NetworkDecision) {
    // The URL goes in `details`, never in the message: the message is the part
    // most likely to be logged, and a URL can carry a token.
    super('NETWORK_DENIED', `Blocked by network policy (${decision.reason})`, {
      retryable: false,
      details: {
        reason: decision.reason,
        host: decision.host,
        category: decision.category,
        detail: decision.detail,
        url: redactUrl(url),
      },
    });
    this.name = 'NetworkPolicyError';
    this.decision = decision;
  }
}

/**
 * Strip credentials, and any named query parameter, before a URL reaches a log
 * line or an error message. `privateQueryParams` comes from the source policy,
 * which is where a source's session/token parameters are declared.
 */
export function redactUrl(url: string, privateQueryParams: readonly string[] = []): string {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = '***';
      parsed.password = '***';
    }
    for (const key of privateQueryParams) {
      if (parsed.searchParams.has(key)) parsed.searchParams.set(key, '***');
    }
    return parsed.toString();
  } catch {
    return '[unparseable url]';
  }
}

/**
 * Policy that permits everything. ONLY for tests driving a mock transport,
 * where no socket is opened. Never construct this on a path that can reach the
 * network.
 */
export function permissiveNetworkPolicy(): NetworkPolicy {
  return new NetworkPolicy({
    allowPrivateNetworks: true,
    skipDnsResolution: true,
    allowCredentials: true,
  });
}
