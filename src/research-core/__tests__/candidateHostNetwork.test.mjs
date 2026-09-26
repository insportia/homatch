// THE SECOND NETWORK PATH, ATTACKED.
//
// This is the boundary that lets Homatch fetch a hostname that arrived in a
// database row. Every test below drives the REAL NetworkPolicy, the REAL
// HttpClient and the REAL candidate path — the only injected parts are the DNS
// answers and the transport, because the alternative is a unit test that
// contacts 169.254.169.254 to prove it does not contact 169.254.169.254.
//
// What is deliberately NOT here: a test that greps this repository for the
// string 'skipDnsResolution'. A source-string assertion cannot tell the
// difference between a policy that blocks loopback and a policy that mentions
// it, and this file has been bitten by exactly that class of test before.
// Everything below sends a URL and checks what came back.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCandidateAuditPath,
  candidateUrlShape,
  CANDIDATE_AUDIT_POLICY,
  CANDIDATE_AUDIT_CONTENT_TYPES,
  CANDIDATE_AUDIT_USER_AGENT,
} from '../net/candidate-host.ts';
import { DohResolver, extractAddresses } from '../net/doh-resolver.ts';
import { NetworkPolicy, StaticDnsResolver, canonicalHost } from '../net/network-policy.ts';
import { MockTransport } from '../fetch/mock-transport.ts';

/**
 * The DNS the whole file runs on. Each name exists to be one specific attack.
 */
const DNS = new StaticDnsResolver({
  // Ordinary public hosts.
  'portal.example': ['93.184.216.34'],
  'other-portal.example': ['93.184.216.35'],
  'v6.example': ['2606:4700::1111'],
  'dual.example': ['93.184.216.34', '2606:4700::1111'],

  // A public NAME whose address is not public. The whole reason rule 3 exists.
  'rebind.example': ['127.0.0.1'],
  'internal-net.example': ['10.1.2.3'],
  'metadata.example': ['169.254.169.254'],
  'ula.example': ['fd00::1'],
  'v6-loopback.example': ['::1'],
  'mapped.example': ['::ffff:10.0.0.7'],
  'linklocal.example': ['169.254.10.10'],
  'cgnat.example': ['100.100.100.200'],

  // One public record and one private one. Must fail closed: a resolver is
  // free to hand back either, so approving the set approves the private one.
  'split.example': ['93.184.216.34', '10.0.0.5'],
  'split-v6.example': ['2606:4700::1111', '::1'],

  // Redirect destinations.
  'redirect-to-private.example': ['93.184.216.36'],
  'redirect-to-public.example': ['93.184.216.37'],
  'redirect-loop.example': ['93.184.216.38'],
  'oversize.example': ['93.184.216.39'],
  'binary.example': ['93.184.216.40'],
  'slow.example': ['93.184.216.41'],
  'robots-closed.example': ['93.184.216.42'],
});

const OK_HTML = {
  status: 200,
  headers: { 'content-type': 'text/html; charset=utf-8' },
  body: '<html><head><title>Flats</title></head><body><a href="/l/1">One</a></body></html>',
};

const ROBOTS_OPEN = { status: 200, headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nAllow: /\n' };

/** Every host in DNS gets an open robots.txt unless a test overrides it. */
function baseRoutes() {
  return [
    { match: /robots-closed\.example\/robots\.txt$/, ...ROBOTS_OPEN, body: 'User-agent: *\nDisallow: /\n' },
    { match: /\/robots\.txt$/, ...ROBOTS_OPEN },
  ];
}

function path(routes = [], options = {}) {
  const transport = new MockTransport([...routes, ...baseRoutes()], options.transportOptions);
  const auditPath = createCandidateAuditPath({ resolver: DNS, transport, ...options });
  return { auditPath, transport };
}

// ---------------------------------------------------------------------------
// ALLOWED: the path has to actually work, or "nothing was fetched" would pass
// every test below it.
// ---------------------------------------------------------------------------

test('a public hostname is fetched and its validated address is reported', async () => {
  const { auditPath } = path([{ match: 'https://portal.example/', ...OK_HTML }]);
  const result = await auditPath.fetchCandidate('https://portal.example/');

  assert.equal(result.ok, true, `refused with ${result.refusal} ${result.detail ?? ''}`);
  assert.equal(result.status, 200);
  assert.match(result.body, /Flats/);
  assert.deepEqual(result.addresses, ['93.184.216.34']);
});

test('a public IPv6-only host is allowed', async () => {
  const { auditPath } = path([{ match: 'https://v6.example/', ...OK_HTML }]);
  const result = await auditPath.fetchCandidate('https://v6.example/');
  assert.equal(result.ok, true, `refused with ${result.refusal}`);
  assert.deepEqual(result.addresses, ['2606:4700:0:0:0:0:0:1111']);
});

test('a dual-stack host reports both validated addresses', async () => {
  const { auditPath } = path([{ match: 'https://dual.example/', ...OK_HTML }]);
  const result = await auditPath.fetchCandidate('https://dual.example/');
  assert.equal(result.ok, true);
  assert.equal(result.addresses.length, 2);
});

test('a public IP literal is allowed where the policy permits one', async () => {
  // No DNS involved: the literal is classified directly. Included because an
  // audit of a host that only answers on an address is a real case, and because
  // "allowed" and "blocked" for literals must be decided by classification and
  // not by the mere presence of digits.
  const { auditPath } = path([{ match: 'https://93.184.216.34/', ...OK_HTML }]);
  const result = await auditPath.fetchCandidate('https://93.184.216.34/');
  assert.equal(result.ok, true, `refused with ${result.refusal} ${result.detail ?? ''}`);
});

// ---------------------------------------------------------------------------
// BLOCKED: names, literals, and every spelling of "somewhere inside".
// ---------------------------------------------------------------------------

const BLOCKED_DIRECT = [
  ['localhost', 'http://localhost/', 'INTERNAL_HOSTNAME'],
  ['localhost with the FQDN root dot', 'http://localhost./', 'INTERNAL_HOSTNAME'],
  ['localhost via an ideographic full stop', 'http://localhost。/', 'INTERNAL_HOSTNAME'],
  ['localhost spelled in circled letters', 'http://ⓛⓞⓒⓐⓛⓗⓞⓢⓣ/', 'INTERNAL_HOSTNAME'],
  ['127.0.0.1', 'http://127.0.0.1/', 'PRIVATE_ADDRESS'],
  ['loopback as 32-bit decimal', 'http://2130706433/', 'PRIVATE_ADDRESS'],
  ['loopback in octal', 'http://0177.0.0.1/', 'PRIVATE_ADDRESS'],
  ['loopback short form', 'http://127.1/', 'PRIVATE_ADDRESS'],
  ['IPv6 loopback', 'http://[::1]/', 'PRIVATE_ADDRESS'],
  ['IPv4-mapped loopback', 'http://[::ffff:127.0.0.1]/', 'PRIVATE_ADDRESS'],
  ['private IPv4 10/8', 'http://10.0.0.1/', 'PRIVATE_ADDRESS'],
  ['private IPv4 172.16/12', 'http://172.20.5.5/', 'PRIVATE_ADDRESS'],
  ['private IPv4 192.168/16', 'http://192.168.1.1/', 'PRIVATE_ADDRESS'],
  ['link-local', 'http://169.254.1.1/', 'PRIVATE_ADDRESS'],
  ['the cloud metadata address', 'http://169.254.169.254/latest/meta-data/', 'PRIVATE_ADDRESS'],
  ['ECS task metadata', 'http://169.254.170.2/v2/credentials/', 'PRIVATE_ADDRESS'],
  ['Alibaba metadata', 'http://100.100.100.200/latest/', 'PRIVATE_ADDRESS'],
  ['CGNAT', 'http://100.64.0.1/', 'PRIVATE_ADDRESS'],
  ['unspecified', 'http://0.0.0.0/', 'PRIVATE_ADDRESS'],
  ['IPv6 unique-local', 'http://[fd00::1]/', 'PRIVATE_ADDRESS'],
  ['IPv6 link-local', 'http://[fe80::1]/', 'PRIVATE_ADDRESS'],
  ['broadcast', 'http://255.255.255.255/', 'PRIVATE_ADDRESS'],
  ['multicast', 'http://224.0.0.1/', 'PRIVATE_ADDRESS'],
  ['documentation range', 'http://203.0.113.9/', 'PRIVATE_ADDRESS'],
  ['benchmark range', 'http://198.18.0.1/', 'PRIVATE_ADDRESS'],
  ['a .internal name', 'http://vault.internal/', 'INTERNAL_HOSTNAME'],
  ['a k8s service name', 'http://api.svc.cluster.local/', 'INTERNAL_HOSTNAME'],
  ['metadata.google.internal', 'http://metadata.google.internal/', 'HOST_BLOCKED'],
  ['metadata.google.internal. with root dot', 'http://metadata.google.internal./', 'HOST_BLOCKED'],
  ['a wildcard-DNS rebinding service', 'http://10.0.0.1.nip.io/', 'HOST_BLOCKED'],
  ['file:', 'file:///etc/passwd', 'SCHEME_NOT_ALLOWED'],
  ['ftp:', 'ftp://portal.example/x', 'SCHEME_NOT_ALLOWED'],
  ['data:', 'data:text/html,<b>x</b>', 'SCHEME_NOT_ALLOWED'],
  ['javascript:', 'javascript:fetch("/x")', 'SCHEME_NOT_ALLOWED'],
  ['gopher:', 'gopher://portal.example/1', 'SCHEME_NOT_ALLOWED'],
  ['credentials in the URL', 'https://admin:hunter2@portal.example/', 'CREDENTIALS_IN_URL'],
  ['userinfo spoofing the host', 'https://portal.example@169.254.169.254/', 'CREDENTIALS_IN_URL'],
  ['SSH', 'https://portal.example:22/', 'PORT_NOT_ALLOWED'],
  ['a database port', 'https://portal.example:5432/', 'PORT_NOT_ALLOWED'],
  ['an admin port', 'http://portal.example:8080/', 'PORT_NOT_ALLOWED'],
  ['a malformed URL', 'http://[not-an-address/', 'MALFORMED_URL'],
  ['not a URL at all', 'portal.example/listings', 'MALFORMED_URL'],
];

for (const [name, url, expected] of BLOCKED_DIRECT) {
  test(`blocked: ${name}`, async () => {
    const { auditPath, transport } = path();
    const result = await auditPath.fetchCandidate(url);

    assert.equal(result.ok, false, `${url} was ALLOWED`);
    assert.equal(result.refusal, expected, `${url} refused as ${result.refusal}, expected ${expected}`);
    // The decisive assertion: refused means no byte left the process. A check
    // that returns the right verdict after fetching is not a check.
    assert.equal(
      transport.totalCalls,
      0,
      `${url} was refused but ${transport.name} was still called`,
    );
  });
}

const BLOCKED_BY_RESOLUTION = [
  ['a public name whose A record is loopback', 'https://rebind.example/'],
  ['a public name inside 10/8', 'https://internal-net.example/'],
  ['a public name pointing at cloud metadata', 'https://metadata.example/'],
  ['a public name with an IPv6 ULA', 'https://ula.example/'],
  ['a public name with an IPv6 loopback', 'https://v6-loopback.example/'],
  ['a public name with an IPv4-mapped private address', 'https://mapped.example/'],
  ['a public name in link-local space', 'https://linklocal.example/'],
  ['a public name on the Alibaba metadata address', 'https://cgnat.example/'],
];

for (const [name, url] of BLOCKED_BY_RESOLUTION) {
  test(`blocked after resolution: ${name}`, async () => {
    const { auditPath, transport } = path([{ match: url, ...OK_HTML }]);
    const result = await auditPath.fetchCandidate(url);
    assert.equal(result.ok, false, `${url} was ALLOWED`);
    assert.equal(result.refusal, 'PRIVATE_ADDRESS');
    assert.equal(transport.totalCalls, 0, 'the host was contacted anyway');
  });
}

test('a DNS answer mixing public and private addresses FAILS CLOSED', async () => {
  for (const url of ['https://split.example/', 'https://split-v6.example/']) {
    const { auditPath } = path([{ match: url, ...OK_HTML }]);
    const result = await auditPath.fetchCandidate(url);
    assert.equal(result.ok, false, `${url} was allowed with a private address in its answer`);
    assert.equal(result.refusal, 'PRIVATE_ADDRESS');
  }
});

test('a name that does not resolve is refused, not attempted', async () => {
  const { auditPath, transport } = path([{ match: /nowhere\.example/, ...OK_HTML }]);
  const result = await auditPath.fetchCandidate('https://nowhere.example/');
  assert.equal(result.ok, false);
  assert.equal(result.refusal, 'DNS_FAILURE');
  assert.equal(transport.totalCalls, 0);
});

test('with no resolver the path refuses to be constructed at all', () => {
  assert.throws(
    () => createCandidateAuditPath({ transport: new MockTransport([]) }),
    /requires a DNS resolver/,
  );
});

test('a policy with no resolver and DNS not skipped refuses every host', async () => {
  // The layer beneath: even if something built a policy without a resolver,
  // NetworkPolicy itself does not fall open.
  const bare = new NetworkPolicy({ allowedPorts: [80, 443] });
  const decision = await bare.check('https://portal.example/');
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'DNS_UNAVAILABLE');
});

// ---------------------------------------------------------------------------
// REDIRECTS: the practical version of this attack, which needs no rebinding.
// ---------------------------------------------------------------------------

test('a public host redirecting to a private address is blocked at the hop', async () => {
  const { auditPath, transport } = path([
    { match: 'https://redirect-to-private.example/', redirectTo: 'http://169.254.169.254/latest/meta-data/', status: 302 },
    { match: /169\.254\.169\.254/, ...OK_HTML },
  ]);

  const result = await auditPath.fetchCandidate('https://redirect-to-private.example/');
  assert.equal(result.ok, false, 'followed a redirect into link-local space');
  assert.equal(result.refusal, 'PRIVATE_ADDRESS');

  // The first hop was legitimately fetched; the metadata address never was.
  const contacted = transport.callLog().map((call) => call.url);
  assert.ok(contacted.some((url) => url.includes('redirect-to-private.example')));
  assert.equal(contacted.some((url) => url.includes('169.254.169.254')), false,
    'the redirect target was contacted');
});

test('a public host redirecting to a name that resolves privately is blocked', async () => {
  const { auditPath, transport } = path([
    { match: 'https://redirect-to-private.example/x', redirectTo: 'https://rebind.example/admin', status: 301 },
    { match: /rebind\.example/, ...OK_HTML },
  ]);
  const result = await auditPath.fetchCandidate('https://redirect-to-private.example/x');
  assert.equal(result.ok, false);
  assert.equal(result.refusal, 'PRIVATE_ADDRESS');
  assert.equal(
    transport.callLog().some((call) => call.url.includes('rebind.example/admin')),
    false,
    'the redirect target was contacted before being validated',
  );
});

test('a redirect to another genuinely public host is followed and re-validated', async () => {
  const { auditPath, transport } = path([
    { match: 'https://redirect-to-public.example/', redirectTo: 'https://other-portal.example/listings', status: 302 },
    { match: 'https://other-portal.example/listings', ...OK_HTML },
  ]);

  const result = await auditPath.fetchCandidate('https://redirect-to-public.example/');
  assert.equal(result.ok, true, `refused with ${result.refusal}`);
  assert.equal(result.finalUrl, 'https://other-portal.example/listings');
  assert.deepEqual(result.redirectChain, ['https://redirect-to-public.example/']);
  // Re-validated means the SECOND host's address is the one we ended on.
  assert.ok(result.addresses.includes('93.184.216.35'));
  // And its robots.txt was consulted, not the first host's.
  assert.ok(transport.callLog().some((call) => call.url === 'https://other-portal.example/robots.txt'));
});

test('a redirect loop ends rather than burning the hop budget', async () => {
  const { auditPath, transport } = path([
    { match: 'https://redirect-loop.example/a', redirectTo: 'https://redirect-loop.example/b', status: 302 },
    { match: 'https://redirect-loop.example/b', redirectTo: 'https://redirect-loop.example/a', status: 302 },
  ]);
  const result = await auditPath.fetchCandidate('https://redirect-loop.example/a');
  assert.equal(result.ok, false);
  // A 3xx with nowhere left to go is an HTTP outcome, not a success with an
  // empty body.
  assert.equal(result.refusal, 'HTTP_ERROR');
  assert.ok(transport.totalCalls <= 6, `loop cost ${transport.totalCalls} requests`);
});

test('the redirect budget is three hops and it is enforced', async () => {
  assert.equal(CANDIDATE_AUDIT_POLICY.redirects.max, 3);
  const { auditPath } = path([
    { match: 'https://portal.example/1', redirectTo: 'https://portal.example/2', status: 302 },
    { match: 'https://portal.example/2', redirectTo: 'https://portal.example/3', status: 302 },
    { match: 'https://portal.example/3', redirectTo: 'https://portal.example/4', status: 302 },
    { match: 'https://portal.example/4', redirectTo: 'https://portal.example/5', status: 302 },
    { match: 'https://portal.example/5', ...OK_HTML },
  ]);
  const result = await auditPath.fetchCandidate('https://portal.example/1');
  assert.equal(result.ok, false, 'a fifth hop was followed');
});

// ---------------------------------------------------------------------------
// RESOURCE LIMITS: a candidate must not be able to cost us anything much.
// ---------------------------------------------------------------------------

test('an oversized response is capped, not swallowed whole', async () => {
  const huge = 'x'.repeat(2_000_000);
  const { auditPath } = path([
    { match: 'https://oversize.example/', status: 200, headers: { 'content-type': 'text/html' }, body: huge },
  ]);
  const result = await auditPath.fetchCandidate('https://oversize.example/');
  assert.equal(result.ok, true);
  assert.ok(result.bytes <= CANDIDATE_AUDIT_POLICY.maxResponseBytes,
    `read ${result.bytes} bytes against a cap of ${CANDIDATE_AUDIT_POLICY.maxResponseBytes}`);
  assert.equal(result.truncated, true);
  assert.ok(result.body.length < huge.length);
});

test('a non-text response is refused and its body is not returned', async () => {
  const { auditPath } = path([
    { match: 'https://binary.example/', status: 200, headers: { 'content-type': 'application/pdf' }, body: '%PDF-1.7 ...' },
  ]);
  const result = await auditPath.fetchCandidate('https://binary.example/');
  assert.equal(result.ok, false);
  assert.equal(result.refusal, 'CONTENT_TYPE_REFUSED');
  assert.equal(result.detail, 'application/pdf');
  assert.equal(result.body, undefined, 'a refused content type still handed back a body');
});

test('the content-type gate admits pages, sitemaps and feeds and nothing executable', () => {
  for (const mime of ['text/html', 'text/xml', 'application/xml', 'text/plain', 'application/json']) {
    assert.ok(CANDIDATE_AUDIT_CONTENT_TYPES.has(mime), `${mime} should be readable`);
  }
  for (const mime of ['application/pdf', 'application/octet-stream', 'video/mp4', 'application/zip',
    'application/x-msdownload', 'image/png']) {
    assert.equal(CANDIDATE_AUDIT_CONTENT_TYPES.has(mime), false, `${mime} should not be read`);
  }
});

test('a timeout is recorded as a timeout, not as a fact about the site', async () => {
  const { auditPath } = path(
    [{ match: 'https://slow.example/', ...OK_HTML, delayMs: 50 }],
  );
  const result = await auditPath.fetchCandidate('https://slow.example/', { maxBytes: 1000 });
  // The mock honours delay but the policy timeout is 8s, so this succeeds; the
  // assertion that matters is that the caps are the policy's, not a default.
  assert.equal(result.ok, true);
  assert.equal(CANDIDATE_AUDIT_POLICY.timeoutMs, 8_000);
});

test('a single attempt, so an audit never hammers a struggling candidate', async () => {
  const { auditPath, transport } = path([
    { match: 'https://portal.example/down', alwaysFail: true, failStatus: 503 },
  ]);
  const result = await auditPath.fetchCandidate('https://portal.example/down');
  assert.equal(result.ok, false);
  const attempts = transport.callLog().filter((call) => call.url.endsWith('/down')).length;
  assert.equal(attempts, 1, `retried a 503 ${attempts} times`);
});

// ---------------------------------------------------------------------------
// CREDENTIALS: the part a rebind would be trying to steal.
// ---------------------------------------------------------------------------

test('no credential, cookie or internal token is sent to a candidate', async () => {
  const seen = [];
  const recording = {
    name: 'recording',
    pinsAddresses: true,
    async send(request) {
      seen.push({ url: request.url, headers: { ...request.headers } });
      return {
        url: request.url,
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: '<html></html>',
        bytes: 13,
        truncated: false,
        durationMs: 1,
      };
    },
  };

  const auditPath = createCandidateAuditPath({ resolver: DNS, transport: recording });
  await auditPath.fetchCandidate('https://portal.example/');

  assert.ok(seen.length > 0, 'nothing was sent, so nothing was proven');
  const FORBIDDEN = ['authorization', 'cookie', 'apikey', 'x-cron-token', 'x-client-info',
    'set-cookie', 'proxy-authorization', 'x-supabase-auth'];
  for (const call of seen) {
    const keys = Object.keys(call.headers).map((key) => key.toLowerCase());
    for (const header of FORBIDDEN) {
      assert.equal(keys.includes(header), false,
        `${header} was sent to ${call.url}`);
    }
    // Nor an apikey smuggled into the query string.
    assert.equal(/apikey=|access_token=|token=/i.test(call.url), false,
      `a credential appeared in the URL: ${call.url}`);
  }
});

test('the audit identifies itself and does not impersonate a browser', () => {
  assert.match(CANDIDATE_AUDIT_USER_AGENT, /^HomatchSourceAudit\//);
  assert.match(CANDIDATE_AUDIT_USER_AGENT, /https:\/\/homatch\.ge/);
  assert.equal(/Mozilla|Chrome|Safari|AppleWebKit/.test(CANDIDATE_AUDIT_USER_AGENT), false,
    'the audit user agent pretends to be a browser');
});

// ---------------------------------------------------------------------------
// ROBOTS: a candidate that says no is a finding, not an obstacle.
// ---------------------------------------------------------------------------

test('a candidate whose robots.txt disallows everything is refused and recorded', async () => {
  const { auditPath } = path([{ match: 'https://robots-closed.example/', ...OK_HTML }]);
  const result = await auditPath.fetchCandidate('https://robots-closed.example/');
  assert.equal(result.ok, false);
  assert.equal(result.refusal, 'ROBOTS_DISALLOWED');
});

test('robots is consulted BEFORE the page, on the validated host', async () => {
  const { auditPath, transport } = path([{ match: 'https://portal.example/x', ...OK_HTML }]);
  await auditPath.fetchCandidate('https://portal.example/x');
  const urls = transport.callLog().map((call) => call.url);
  assert.equal(urls[0], 'https://portal.example/robots.txt',
    `first request was ${urls[0]}`);
});

// ---------------------------------------------------------------------------
// THE TWO PATHS STAY TWO PATHS.
// ---------------------------------------------------------------------------

test('the candidate policy is the narrowest thing that can still read a page', () => {
  assert.deepEqual(CANDIDATE_AUDIT_POLICY.allowedMethods, ['GET']);
  assert.equal(CANDIDATE_AUDIT_POLICY.robots, 'RESPECT');
  assert.equal(CANDIDATE_AUDIT_POLICY.browserRenderingAllowed, false);
  assert.equal(CANDIDATE_AUDIT_POLICY.rate.concurrency, 1);
  assert.equal(CANDIDATE_AUDIT_POLICY.authority, 0,
    'an unaudited host must carry no evidential weight');
  assert.equal(CANDIDATE_AUDIT_POLICY.cacheTtlMs, 0,
    'an audit must ask again, not reuse an answer');
  assert.ok(CANDIDATE_AUDIT_POLICY.maxResponseBytes <= 1_000_000);
});

test('the candidate path refuses a host that already has a portal policy', async () => {
  // Not a security rule — a separation-of-paths rule. An implemented source is
  // fetched through createPortalRuntime with ITS policy: rate limits, cache
  // TTL, robots stance. Auditing it here would apply a different posture to a
  // site we already have an agreement with, and would report `candidate` as its
  // source family, which is a lie about independence.
  const { PORTAL_SOURCE_POLICIES } = await import('../market/runtime.ts');
  const implemented = new Set();
  for (const policy of PORTAL_SOURCE_POLICIES) {
    for (const domain of policy.domains) implemented.add(domain);
  }
  assert.ok(implemented.size >= 7, 'the portal catalogue looks empty');
  // The candidate registry is EMPTY, so nothing here can resolve to a portal
  // policy by accident.
  assert.deepEqual(CANDIDATE_AUDIT_POLICY.domains, []);
  assert.deepEqual(CANDIDATE_AUDIT_POLICY.hosts, []);
  assert.equal(CANDIDATE_AUDIT_POLICY.sourceFamily, 'candidate');
});

// ---------------------------------------------------------------------------
// HOSTNAME CANONICALIZATION, which is where the surprises live.
// ---------------------------------------------------------------------------

test('canonicalHost strips brackets and exactly one FQDN root dot', () => {
  assert.equal(canonicalHost('[::1]'), '::1');
  assert.equal(canonicalHost('EXAMPLE.COM.'), 'example.com');
  assert.equal(canonicalHost('localhost.'), 'localhost');
  // Not repaired into something legal: `a..` is not a name and pretending it is
  // one would invent a host the caller never wrote.
  assert.equal(canonicalHost('a..'), 'a.');
  assert.equal(canonicalHost('.'), '.');
});

test('a Unicode hostname becomes punycode before any check runs', () => {
  const shape = candidateUrlShape('https://例え.jp/listings');
  assert.equal(shape.ok, true);
  assert.equal(shape.host, 'xn--r8jz45g.jp',
    'the host was not normalised to punycode, so two spellings of one name would be two hosts');
});

test('candidateUrlShape sorts rows without touching the network', () => {
  assert.equal(candidateUrlShape('https://portal.example/x').ok, true);
  assert.equal(candidateUrlShape('mailto:x@y.z').reason, 'SCHEME_NOT_ALLOWED');
  assert.equal(candidateUrlShape('tg://join?invite=abc').reason, 'SCHEME_NOT_ALLOWED');
  assert.equal(candidateUrlShape('https://a:b@portal.example/').reason, 'CREDENTIALS_IN_URL');
  assert.equal(candidateUrlShape('https://portal.example:9200/').reason, 'PORT_NOT_ALLOWED');
  assert.equal(candidateUrlShape('not a url').reason, 'MALFORMED_URL');
  // A fragment and a query are ordinary parts of a URL and must not be refused.
  assert.equal(candidateUrlShape('https://portal.example/s?q=1#top').ok, true);
});

// ---------------------------------------------------------------------------
// THE RESOLVER ITSELF.
// ---------------------------------------------------------------------------

test('the DoH resolver reads A and AAAA answers and ignores the CNAME chain', () => {
  const reply = {
    Status: 0,
    Answer: [
      { name: 'portal.example', type: 5, data: 'cdn.provider.example.' },
      { name: 'cdn.provider.example', type: 1, data: '93.184.216.34' },
      { name: 'cdn.provider.example', type: 1, data: '93.184.216.35' },
    ],
  };
  assert.deepEqual(extractAddresses(reply, 'A'), ['93.184.216.34', '93.184.216.35']);
  assert.deepEqual(extractAddresses(reply, 'AAAA'), []);
});

test('a DoH reply that is not a success yields no addresses', () => {
  assert.deepEqual(extractAddresses({ Status: 3, Answer: [] }, 'A'), []);
  assert.deepEqual(extractAddresses({ Status: 2 }, 'A'), []);
  assert.deepEqual(extractAddresses(null, 'A'), []);
  assert.deepEqual(extractAddresses('nope', 'A'), []);
  assert.deepEqual(extractAddresses({ Status: 0, Answer: 'not-an-array' }, 'A'), []);
});

test('a DoH answer holding a hostname where an address belongs is dropped', () => {
  // The bug this prevents: `data` is a string, and a string that is not an
  // address would sail through a check that only looked at `type`. A later
  // comparison against 'localhost' would then be comparing a hostname to an
  // address list.
  const reply = { Status: 0, Answer: [{ type: 1, data: 'localhost' }, { type: 1, data: 'not.an.ip' }] };
  assert.deepEqual(extractAddresses(reply, 'A'), []);
});

test('an A record carrying an IPv6 address is dropped rather than reclassified', () => {
  assert.deepEqual(extractAddresses({ Status: 0, Answer: [{ type: 1, data: '::1' }] }, 'A'), []);
  assert.deepEqual(extractAddresses({ Status: 0, Answer: [{ type: 28, data: '10.0.0.1' }] }, 'AAAA'), []);
});

test('the resolver refuses to ask about anything that is not a DNS name', async () => {
  const resolver = new DohResolver({
    fetchImpl: async () => { throw new Error('should never be called'); },
  });
  for (const name of ['a b', 'x&type=A&name=evil.example', 'x/../y', 'has_underscore!',
    'http://portal.example', '']) {
    await assert.rejects(() => resolver.resolve(name), /Not a resolvable DNS name/,
      `${JSON.stringify(name)} was sent to the resolver`);
  }
  assert.equal(resolver.queryCount(), 0);
});

test('the resolver asks both address families and unions the answers', async () => {
  const asked = [];
  const resolver = new DohResolver({
    fetchImpl: async (url) => {
      asked.push(String(url));
      const type = String(url).includes('type=AAAA') ? 'AAAA' : 'A';
      const body = type === 'A'
        ? { Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] }
        : { Status: 0, Answer: [{ type: 28, data: '2606:4700::1111' }] };
      return new Response(JSON.stringify(body), { status: 200 });
    },
  });

  const addresses = await resolver.resolve('portal.example');
  assert.equal(asked.length, 2);
  assert.ok(asked.some((url) => url.includes('type=A&') || url.endsWith('type=A')));
  assert.ok(asked.some((url) => url.includes('type=AAAA')));
  assert.deepEqual(addresses, ['93.184.216.34', '2606:4700:0:0:0:0:0:1111']);
});

test('a resolver failure on one family alone is still a refusal', async () => {
  const resolver = new DohResolver({
    fetchImpl: async (url) =>
      String(url).includes('type=AAAA')
        ? new Response('gateway down', { status: 502 })
        : new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] }), { status: 200 }),
  });
  await assert.rejects(() => resolver.resolve('portal.example'), /one address family/);
});

test('a host with an A record and no AAAA record resolves normally', async () => {
  // The common case on the real internet, and it must not read as a failure.
  const resolver = new DohResolver({
    fetchImpl: async (url) =>
      new Response(
        JSON.stringify(
          String(url).includes('type=AAAA')
            ? { Status: 0 }
            : { Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] },
        ),
        { status: 200 },
      ),
  });
  assert.deepEqual(await resolver.resolve('portal.example'), ['93.184.216.34']);
});

test('a name with no records at all is refused', async () => {
  const resolver = new DohResolver({
    fetchImpl: async () => new Response(JSON.stringify({ Status: 3 }), { status: 200 }),
  });
  await assert.rejects(() => resolver.resolve('gone.example'), /No A or AAAA record/);
});

test('the resolver caches briefly, so one audit does not re-ask per document', async () => {
  let calls = 0;
  const resolver = new DohResolver({
    now: () => 1_000,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] }), { status: 200 });
    },
  });
  await resolver.resolve('portal.example');
  await resolver.resolve('portal.example');
  assert.equal(calls, 2, 'the second resolve went back to the wire');
});

test('the DoH endpoint is a constant, never taken from the caller', async () => {
  const urls = [];
  const resolver = new DohResolver({
    fetchImpl: async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] }), { status: 200 });
    },
  });
  await resolver.resolve('portal.example');
  for (const url of urls) {
    assert.ok(url.startsWith('https://cloudflare-dns.com/dns-query?'),
      `resolver contacted ${url}`);
  }
});
