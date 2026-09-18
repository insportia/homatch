// The SSRF boundary.
//
// Everything below is a URL somebody would actually send. An attacker does not
// type http://127.0.0.1/ — they type http://2130706433/, or 0177.0.0.1, or
// [::ffff:127.0.0.1], or a public hostname whose A record points home, or a
// public URL that 302s to one. A checker that only understands dotted-quad is
// not a checker, and the only way to know it understands the rest is to send
// it the rest.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NetworkPolicy,
  StaticDnsResolver,
  redactUrl,
} from '../net/network-policy.ts';
import { classifyIp, parseIpLiteral } from '../net/ip.ts';

const publicDns = new StaticDnsResolver({
  'example.com': ['93.184.216.34'],
  'rebind.example': ['127.0.0.1'],
  'split.example': ['93.184.216.34', '10.0.0.5'],
  'v6.example': ['2606:4700::1111'],
});

const policy = () => new NetworkPolicy({ resolver: publicDns });

const LOOPBACK_SPELLINGS = [
  ['dotted quad', 'http://127.0.0.1/'],
  ['32-bit decimal', 'http://2130706433/'],
  ['octal octets', 'http://0177.0.0.1/'],
  ['hex octets', 'http://0x7f.0x0.0x0.0x1/'],
  ['short form', 'http://127.1/'],
  ['IPv6 loopback', 'http://[::1]/'],
  ['IPv4-mapped IPv6', 'http://[::ffff:127.0.0.1]/'],
];

for (const [name, url] of LOOPBACK_SPELLINGS) {
  test(`loopback is blocked when written as ${name}`, async () => {
    const decision = await policy().check(url);
    assert.equal(decision.allowed, false, `${url} was allowed`);
    assert.equal(decision.reason, 'PRIVATE_ADDRESS');
  });
}

test('cloud instance metadata is blocked and named as such', async () => {
  const decision = await policy().check('http://169.254.169.254/latest/meta-data/');
  assert.equal(decision.allowed, false);
  assert.equal(decision.category, 'CLOUD_METADATA');
});

test('an IP literal is reported as a private ADDRESS, not an internal hostname', async () => {
  // Both refuse the request. Only one of them tells the operator what
  // happened, and the reason is what somebody debugs from at 2am.
  const decision = await policy().check('http://[::1]/');
  assert.equal(decision.reason, 'PRIVATE_ADDRESS');
});

test('a public hostname that resolves to loopback is blocked', async () => {
  const decision = await policy().check('https://rebind.example/data');
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'PRIVATE_ADDRESS');
});

test('a hostname with one public and one private record is blocked', async () => {
  // Connecting would pick whichever record the resolver felt like returning
  // first, so "one of them is fine" is not a safety property.
  const decision = await policy().check('https://split.example/');
  assert.equal(decision.allowed, false);
});

test('an ordinary public host is allowed and its addresses are returned', async () => {
  const decision = await policy().check('https://example.com/page');
  assert.equal(decision.allowed, true);
  assert.equal(decision.addresses.length, 1);
  assert.equal(decision.addresses[0].address, '93.184.216.34');
});

test('non-http schemes are refused', async () => {
  for (const url of ['file:///etc/passwd', 'gopher://x/', 'data:text/html,hi']) {
    const decision = await policy().check(url);
    assert.equal(decision.allowed, false, url);
    assert.equal(decision.reason, 'SCHEME_NOT_ALLOWED');
  }
});

test('credentials in a URL are refused by default', async () => {
  const decision = await policy().check('https://user:secret@example.com/');
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'CREDENTIALS_IN_URL');
});

test('internal hostnames are blocked before DNS is consulted', async () => {
  // `.internal` in a container frequently resolves to something useful to an
  // attacker, so it must not reach the resolver at all.
  const resolver = {
    calls: 0,
    async resolve() {
      this.calls += 1;
      return ['93.184.216.34'];
    },
  };
  const decision = await new NetworkPolicy({ resolver }).check('http://vault.internal/');
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'INTERNAL_HOSTNAME');
  assert.equal(resolver.calls, 0, 'the internal hostname was sent to DNS');
});

test('with no resolver and DNS not skipped, the policy FAILS CLOSED', async () => {
  // The most important assertion in the file. A policy that cannot check
  // where a hostname points must refuse, not shrug: failing open here would
  // make every other test in this file decorative.
  const decision = await new NetworkPolicy().check('https://example.com/');
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'DNS_UNAVAILABLE');
});

test('a host allowlist refuses everything not on it', async () => {
  const strict = new NetworkPolicy({
    resolver: publicDns,
    hostAllowlistOnly: ['example.com'],
  });
  assert.equal((await strict.check('https://example.com/')).allowed, true);
  const denied = await strict.check('https://v6.example/');
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, 'HOST_NOT_ALLOWLISTED');
});

test('an explicit allowlist entry can reach a private address, a CIDR cannot widen past itself', async () => {
  const internal = new NetworkPolicy({
    resolver: new StaticDnsResolver({ 'intranet.homatch.test': ['10.1.2.3'] }),
    allowedHosts: ['intranet.homatch.test'],
  });
  assert.equal((await internal.check('https://intranet.homatch.test/')).allowed, true);

  const cidrOnly = new NetworkPolicy({
    resolver: new StaticDnsResolver({ 'a.test': ['10.1.2.3'], 'b.test': ['10.9.9.9'] }),
    allowedCidrs: ['10.1.2.0/24'],
  });
  assert.equal((await cidrOnly.check('https://a.test/')).allowed, true);
  assert.equal((await cidrOnly.check('https://b.test/')).allowed, false);
});

test('a DNS failure is a refusal, not a pass', async () => {
  const decision = await policy().check('https://nowhere.example/');
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'DNS_FAILURE');
});

test('redactUrl removes credentials and named private parameters', () => {
  assert.equal(redactUrl('https://u:p@example.com/x'), 'https://***:***@example.com/x');
  assert.match(redactUrl('https://example.com/x?sid=abc123', ['sid']), /sid=\*\*\*/);
  // A URL that will not parse must not be echoed back verbatim into a log.
  assert.equal(redactUrl('::::'), '[unparseable url]');
});

test('classification covers the ranges a policy has to know', () => {
  const cases = [
    ['10.0.0.1', 'PRIVATE'],
    ['172.16.0.1', 'PRIVATE'],
    ['192.168.1.1', 'PRIVATE'],
    ['100.64.0.1', 'CGNAT'],
    ['169.254.1.1', 'LINK_LOCAL'],
    ['0.0.0.0', 'UNSPECIFIED'],
    ['255.255.255.255', 'BROADCAST'],
    ['224.0.0.1', 'MULTICAST'],
    ['8.8.8.8', 'PUBLIC'],
  ];
  for (const [address, expected] of cases) {
    assert.equal(classifyIp(parseIpLiteral(address)), expected, address);
  }
  assert.equal(classifyIp(parseIpLiteral('[fd00::1]')), 'UNIQUE_LOCAL');
  assert.equal(classifyIp(parseIpLiteral('[fe80::1]')), 'LINK_LOCAL');
});

test('a real hostname is not mistaken for an IP literal', () => {
  assert.equal(parseIpLiteral('example.com'), null);
  assert.equal(parseIpLiteral('1.2.3.4.example.com'), null);
});
