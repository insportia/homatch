/**
 * IP address parsing and classification.
 *
 * This is the ground truth for SSRF protection, so it is deliberately paranoid
 * about *input forms* as well as address ranges. `http://2130706433/`,
 * `http://0177.0.0.1/`, `http://0x7f.1/` and `http://[::ffff:127.0.0.1]/` are
 * all loopback, and an attacker will reach for whichever spelling a naive
 * checker forgot.
 */

export type IpVersion = 4 | 6;

export type IpCategory =
  | 'PUBLIC'
  | 'LOOPBACK'
  | 'PRIVATE'
  | 'LINK_LOCAL'
  | 'CGNAT'
  | 'MULTICAST'
  | 'UNSPECIFIED'
  | 'BROADCAST'
  | 'RESERVED'
  | 'DOCUMENTATION'
  | 'BENCHMARK'
  | 'UNIQUE_LOCAL'
  | 'CLOUD_METADATA';

export interface ParsedIp {
  version: IpVersion;
  /** Canonical textual form. */
  address: string;
  /** IPv4 octets, or the 16 bytes of an IPv6 address. */
  bytes: number[];
}

/** True when the category must never be reachable from a research worker. */
export function isBlockedCategory(category: IpCategory): boolean {
  return category !== 'PUBLIC';
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a host string that might be an IP literal in any legal (or merely
 * tolerated) notation. Returns null when the host is a real hostname.
 */
export function parseIpLiteral(host: string): ParsedIp | null {
  const trimmed = host.trim().replace(/^\[|\]$/g, '');
  if (!trimmed) return null;

  if (trimmed.includes(':')) {
    const v6 = parseIpv6(trimmed);
    return v6;
  }
  return parseIpv4Loose(trimmed);
}

/**
 * Strict dotted-quad parsing. Used when we already know a string came from a
 * DNS resolver rather than from user input.
 */
export function parseIpv4(value: string): ParsedIp | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    bytes.push(n);
  }
  return { version: 4, address: bytes.join('.'), bytes };
}

/**
 * Permissive IPv4 parsing covering the forms `inet_aton` accepts and browsers
 * still honour: decimal (`2130706433`), octal (`0177.0.0.1`), hex (`0x7f.1`),
 * and short forms with fewer than four parts.
 *
 * A checker that only understands dotted-quad is not an SSRF checker.
 */
export function parseIpv4Loose(value: string): ParsedIp | null {
  const parts = value.split('.');
  if (parts.length === 0 || parts.length > 4) return null;

  const numbers: number[] = [];
  for (const part of parts) {
    const n = parseRadixNumber(part);
    if (n === null) return null;
    numbers.push(n);
  }

  // inet_aton semantics: the final part absorbs all remaining low-order bytes.
  const partCount = numbers.length;
  const maxLast = 256 ** (4 - partCount + 1);
  const last = numbers[partCount - 1] as number;
  if (last >= maxLast) return null;
  for (let i = 0; i < partCount - 1; i += 1) {
    if ((numbers[i] as number) > 255) return null;
  }

  let value32 = 0;
  for (let i = 0; i < partCount - 1; i += 1) {
    value32 += (numbers[i] as number) * 256 ** (3 - i);
  }
  value32 += last;
  if (value32 > 0xffffffff) return null;

  const bytes = [
    (value32 >>> 24) & 0xff,
    (value32 >>> 16) & 0xff,
    (value32 >>> 8) & 0xff,
    value32 & 0xff,
  ];
  return { version: 4, address: bytes.join('.'), bytes };
}

function parseRadixNumber(part: string): number | null {
  if (part === '') return null;
  if (/^0[xX][0-9a-fA-F]+$/.test(part)) return Number.parseInt(part.slice(2), 16);
  if (/^0[0-7]+$/.test(part)) return Number.parseInt(part.slice(1), 8);
  if (/^\d+$/.test(part)) return Number.parseInt(part, 10);
  return null;
}

export function parseIpv6(value: string): ParsedIp | null {
  // Strip a zone index; it never changes reachability class.
  const raw = value.split('%')[0] as string;
  if (!/^[0-9a-fA-F:.]+$/.test(raw)) return null;

  const doubleColon = raw.indexOf('::');
  if (doubleColon !== raw.lastIndexOf('::')) return null;

  let head: string[] = [];
  let tail: string[] = [];

  if (doubleColon >= 0) {
    const before = raw.slice(0, doubleColon);
    const after = raw.slice(doubleColon + 2);
    head = before ? before.split(':') : [];
    tail = after ? after.split(':') : [];
  } else {
    head = raw.split(':');
  }

  // A trailing IPv4 form: ::ffff:127.0.0.1
  const expandTrailingIpv4 = (groups: string[]): string[] | null => {
    if (groups.length === 0) return groups;
    const last = groups[groups.length - 1] as string;
    if (!last.includes('.')) return groups;
    const v4 = parseIpv4(last);
    if (!v4) return null;
    const [a, b, c, d] = v4.bytes as [number, number, number, number];
    return [
      ...groups.slice(0, -1),
      ((a << 8) | b).toString(16),
      ((c << 8) | d).toString(16),
    ];
  };

  const expandedHead = expandTrailingIpv4(head);
  const expandedTail = expandTrailingIpv4(tail);
  if (!expandedHead || !expandedTail) return null;

  const missing = 8 - (expandedHead.length + expandedTail.length);
  if (doubleColon < 0 ? missing !== 0 : missing < 0) return null;

  const groups = [
    ...expandedHead,
    ...Array.from({ length: doubleColon >= 0 ? missing : 0 }, () => '0'),
    ...expandedTail,
  ];
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    const n = Number.parseInt(group, 16);
    bytes.push((n >> 8) & 0xff, n & 0xff);
  }

  return { version: 6, address: formatIpv6(bytes), bytes };
}

function formatIpv6(bytes: number[]): string {
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) {
    groups.push((((bytes[i] as number) << 8) | (bytes[i + 1] as number)).toString(16));
  }
  return groups.join(':');
}

/** Parse an address produced by DNS (always strict, never a hostname). */
export function parseResolvedAddress(value: string): ParsedIp | null {
  return value.includes(':') ? parseIpv6(value) : parseIpv4(value);
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** Cloud instance-metadata addresses, which are the classic SSRF payoff. */
const METADATA_V4 = new Set(['169.254.169.254', '169.254.170.2', '100.100.100.200']);

export function classifyIp(ip: ParsedIp): IpCategory {
  return ip.version === 4 ? classifyIpv4(ip.bytes) : classifyIpv6(ip.bytes);
}

function classifyIpv4(bytes: number[]): IpCategory {
  const [a, b] = bytes as [number, number, number, number];
  const address = bytes.join('.');

  if (METADATA_V4.has(address)) return 'CLOUD_METADATA';
  if (a === 0) return 'UNSPECIFIED';
  if (a === 127) return 'LOOPBACK';
  if (a === 10) return 'PRIVATE';
  if (a === 172 && b >= 16 && b <= 31) return 'PRIVATE';
  if (a === 192 && b === 168) return 'PRIVATE';
  if (a === 100 && b >= 64 && b <= 127) return 'CGNAT';
  if (a === 169 && b === 254) return 'LINK_LOCAL';
  if (a === 192 && b === 0 && bytes[2] === 0) return 'RESERVED'; // IETF protocol assignments
  if (a === 192 && b === 0 && bytes[2] === 2) return 'DOCUMENTATION';
  if (a === 198 && (b === 18 || b === 19)) return 'BENCHMARK';
  if (a === 198 && b === 51 && bytes[2] === 100) return 'DOCUMENTATION';
  if (a === 203 && b === 0 && bytes[2] === 113) return 'DOCUMENTATION';
  if (a === 192 && b === 88 && bytes[2] === 99) return 'RESERVED'; // 6to4 relay anycast
  if (address === '255.255.255.255') return 'BROADCAST';
  if (a >= 224 && a <= 239) return 'MULTICAST';
  if (a >= 240) return 'RESERVED';
  return 'PUBLIC';
}

function classifyIpv6(bytes: number[]): IpCategory {
  const allZero = bytes.every((byte) => byte === 0);
  if (allZero) return 'UNSPECIFIED';

  const isLoopback = bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
  if (isLoopback) return 'LOOPBACK';

  const first = bytes[0] as number;
  const second = bytes[1] as number;

  if (first === 0xff) return 'MULTICAST';
  // fe80::/10 link-local
  if (first === 0xfe && (second & 0xc0) === 0x80) return 'LINK_LOCAL';
  // fc00::/7 unique local
  if ((first & 0xfe) === 0xfc) return 'UNIQUE_LOCAL';
  // 2001:db8::/32 documentation
  if (first === 0x20 && second === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) {
    return 'DOCUMENTATION';
  }

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible: classify by the embedded
  // v4 address, or an attacker reaches 127.0.0.1 through an IPv6 spelling.
  const prefixZero = bytes.slice(0, 10).every((byte) => byte === 0);
  if (prefixZero && bytes[10] === 0xff && bytes[11] === 0xff) {
    return classifyIpv4(bytes.slice(12));
  }
  if (prefixZero && bytes[10] === 0 && bytes[11] === 0) {
    const embedded = bytes.slice(12);
    if (!embedded.every((byte) => byte === 0)) return classifyIpv4(embedded);
  }

  // 64:ff9b::/96 NAT64 wraps a v4 address too.
  if (first === 0x00 && second === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
    return classifyIpv4(bytes.slice(12));
  }

  // fd00:ec2::254 is the EC2 IMDSv6 endpoint; already UNIQUE_LOCAL above.
  return 'PUBLIC';
}

// ---------------------------------------------------------------------------
// CIDR matching, for explicit operator allowlists
// ---------------------------------------------------------------------------

export interface Cidr {
  ip: ParsedIp;
  prefixLength: number;
}

export function parseCidr(value: string): Cidr | null {
  const [addr, prefix] = value.split('/');
  if (!addr) return null;
  const ip = parseResolvedAddress(addr) ?? parseIpLiteral(addr);
  if (!ip) return null;

  const maxPrefix = ip.version === 4 ? 32 : 128;
  const prefixLength = prefix === undefined ? maxPrefix : Number(prefix);
  if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > maxPrefix) return null;

  return { ip, prefixLength };
}

export function ipInCidr(ip: ParsedIp, cidr: Cidr): boolean {
  if (ip.version !== cidr.ip.version) return false;
  let remaining = cidr.prefixLength;
  for (let i = 0; i < ip.bytes.length && remaining > 0; i += 1) {
    const take = Math.min(8, remaining);
    const mask = take === 8 ? 0xff : (0xff << (8 - take)) & 0xff;
    if (((ip.bytes[i] as number) & mask) !== ((cidr.ip.bytes[i] as number) & mask)) return false;
    remaining -= take;
  }
  return true;
}
