// Campaign Risk Engine (owner brief §8–§9): links, redirects, gambling, fraud, sender, audience.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assessCampaign, reviewOutcome } from '../risk/engine.ts';
import { checkUrl, extractLinks, isGamblingHost, isPrivateAddress, withUtm } from '../risk/links.ts';
import { inspectLink, inspectLinks } from '../../../supabase/functions/_shared/emailMarketing/linkInspector.ts';

const codes = (fs) => fs.map((f) => f.code);
const base = {
  subject: 'New 2-bedroom apartment in Vake',
  html: '<p>A bright 2-bedroom apartment for sale in Vake, Tbilisi. 85 sqm, balcony.</p><a href="https://www.homatch.live/property/244486">View the apartment</a>',
  senderName: 'Nino from HOMATCH', senderEmail: 'nino@homatch.live', senderVerified: true,
  audience: { total: 40, consented: 40 },
};

test('a clean real-estate campaign is ALLOW / LOW', () => {
  const r = assessCampaign(base);
  assert.equal(r.verdict, 'ALLOW', JSON.stringify(r.findings));
  assert.equal(r.level, 'LOW');
  assert.equal(reviewOutcome(r, 'AUTO_LOW_RISK'), 'APPROVED');
  assert.equal(reviewOutcome(r, 'MANUAL_ALL'), 'UNDER_REVIEW', 'the default policy always holds for a human');
});

test('gambling hosts: brands, labels and TLDs — without false positives', () => {
  for (const h of ['www.bet365.com', '1xbet.com', 'adjarabet.com', 'crystalbet.ge', 'joycasino.net', 'mega-casino.io', 'win.bet', 'royal.casino', 'slots-online.com', 'europebet.com', 'stake.com']) {
    assert.ok(isGamblingHost(h), h);
  }
  for (const h of ['alphabet.com', 'betterhomes.ge', 'between.io', 'homatch.live', 'tbilisi-casino-street-apartments.ge'.replace('casino', 'kazbegi'), 'mistake.org', 'abetter.com']) {
    assert.equal(isGamblingHost(h), false, h);
  }
});

test('a casino link is BLOCK; a link through an open redirect to a casino is BLOCK', () => {
  const r = assessCampaign({ ...base, html: `${base.html}<a href="https://joycasino.com/bonus">Special offer</a>` });
  assert.equal(r.verdict, 'BLOCK');
  assert.ok(codes(r.findings).includes('LINK_GAMBLING'));
  const r2 = assessCampaign({ ...base, html: `${base.html}<a href="https://example.com/out?url=https%3A%2F%2F1xbet.com">More</a>` });
  assert.ok(codes(r2.findings).includes('REDIRECT_TO_GAMBLING'));
  assert.equal(r2.verdict, 'BLOCK');
  assert.equal(reviewOutcome(r2, 'AUTO_LOW_RISK'), 'REJECTED');
});

test('gambling promotion in copy is BLOCK; an unrelated mention is held for review, not rejected', () => {
  const promo = assessCampaign({ ...base, subject: 'Casino bonus: 100 free spins on your first deposit' });
  assert.equal(promo.verdict, 'BLOCK');
  assert.ok(codes(promo.findings).includes('GAMBLING_PROMOTION'));
  const mention = assessCampaign({ ...base, html: '<p>The former casino building on the Batumi boulevard has been converted into 40 apartments for sale.</p>' });
  assert.notEqual(mention.verdict, 'BLOCK');
  assert.equal(mention.verdict, 'REVIEW');
  assert.ok(codes(mention.findings).includes('GAMBLING_MENTION'));
  const ka = assessCampaign({ ...base, subject: 'კაზინოს ბონუსი ახალ მომხმარებლებს' });
  assert.equal(ka.verdict, 'BLOCK', 'Georgian promotion');
  const ru = assessCampaign({ ...base, subject: 'Бонус казино за первый депозит' });
  assert.equal(ru.verdict, 'BLOCK', 'Russian promotion');
});

test('unsafe schemes, private networks, credentials, punycode, shorteners, text mismatch', () => {
  assert.ok(codes(checkUrl('javascript:alert(1)')).includes('LINK_UNSAFE_SCHEME'));
  assert.ok(codes(checkUrl('data:text/html;base64,AAAA')).includes('LINK_UNSAFE_SCHEME'));
  assert.ok(codes(checkUrl('https://127.0.0.1/admin')).includes('LINK_PRIVATE_NETWORK'));
  assert.ok(codes(checkUrl('https://192.168.1.10/')).includes('LINK_PRIVATE_NETWORK'));
  assert.ok(codes(checkUrl('https://metadata.internal/')).includes('LINK_PRIVATE_NETWORK'));
  assert.ok(codes(checkUrl('https://localhost:8443/')).includes('LINK_PRIVATE_NETWORK'));
  assert.ok(codes(checkUrl('https://8.8.8.8/')).includes('LINK_IP_ADDRESS'));
  assert.ok(codes(checkUrl('https://user:pass@example.com/')).includes('LINK_EMBEDDED_CREDENTIALS'));
  assert.ok(codes(checkUrl('https://xn--pypal-4ve.com/')).includes('LINK_PUNYCODE'));
  assert.ok(codes(checkUrl('https://bit.ly/3abc')).includes('LINK_SHORTENER'));
  assert.ok(codes(checkUrl('http://example.com/')).includes('LINK_NOT_HTTPS'));
  assert.ok(codes(checkUrl('https://evil.example/login', { kind: 'a', text: 'www.bankofgeorgia.ge' })).includes('LINK_TEXT_MISMATCH'));
  assert.deepEqual(checkUrl('https://www.homatch.live/x', { kind: 'a', text: 'homatch.live' }), []);
  assert.deepEqual(checkUrl('{{unsubscribe_url}}'), [], 'merge fields are filled per recipient');
  assert.deepEqual(checkUrl('mailto:hello@homatch.live'), []);
  assert.ok(isPrivateAddress('::1') && isPrivateAddress('fd00::1') && isPrivateAddress('100.64.1.1') && isPrivateAddress('169.254.169.254'));
  assert.equal(isPrivateAddress('93.184.216.34'), false);
});

test('phishing, misleading claims, active HTML, unverified sender, impersonation', () => {
  assert.equal(assessCampaign({ ...base, html: '<p>Your account will be suspended. Verify your password here.</p>' }).verdict, 'BLOCK');
  assert.ok(codes(assessCampaign({ ...base, subject: 'Guaranteed return of 20% on this apartment' }).findings).includes('MISLEADING_FINANCIAL_CLAIM'));
  assert.ok(codes(assessCampaign({ ...base, html: `${base.html}<img src=x onerror="alert(1)">` }).findings).includes('HTML_ACTIVE_CONTENT'));
  const unverified = assessCampaign({ ...base, senderVerified: false });
  assert.equal(unverified.verdict, 'BLOCK');
  assert.ok(codes(assessCampaign({ ...base, senderName: 'Bank of Georgia', senderEmail: 'info@my-agency.ge' }).findings).includes('SENDER_IMPERSONATION'));
  assert.ok(!codes(assessCampaign(base).findings).includes('SENDER_IMPERSONATION'), 'HOMATCH from homatch.live is fine');
});

test('audience and account history raise review, never silently pass', () => {
  assert.ok(codes(assessCampaign({ ...base, audience: { total: 10, consented: 0 } }).findings).includes('AUDIENCE_NO_CONSENT'));
  assert.ok(codes(assessCampaign({ ...base, audience: { total: 0, consented: 0 } }).findings).includes('AUDIENCE_EMPTY'));
  const hist = assessCampaign({ ...base, account: { priorBlocked: 3, complaintRate: 0.01 } });
  assert.equal(hist.verdict, 'REVIEW');
});

test('extractLinks reads anchors with their text and images', () => {
  const l = extractLinks('<a href="https://a.ge/x?y=1&amp;z=2"><b>Open</b> a.ge</a><img src="https://img.ge/p.jpg" alt="">');
  assert.deepEqual(l, [{ url: 'https://a.ge/x?y=1&z=2', kind: 'a', text: 'Open a.ge' }, { url: 'https://img.ge/p.jpg', kind: 'img' }]);
  assert.equal(withUtm('https://a.ge/x?utm_source=mine', { source: 'homatch', medium: 'email', campaign: 'c1' }), 'https://a.ge/x?utm_source=mine&utm_medium=email&utm_campaign=c1');
});

/* ── the network inspector, with a stubbed resolver and fetch ─────────────────────────────── */
function stubFetch(routes) {
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push([init?.method, String(url)]);
    const r = routes[String(url)];
    if (!r) throw new TypeError('network');
    return new Response(null, { status: r.status, headers: r.location ? { location: r.location } : {} });
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}
const publicDns = async () => ['93.184.216.34'];

test('inspector: follows redirects, flags a redirect to a casino and stops there', async () => {
  const s = stubFetch({
    'https://go.example.com/a': { status: 302, location: 'https://track.example.net/b' },
    'https://track.example.net/b': { status: 301, location: 'https://www.1xbet.com/promo' },
  });
  try {
    const r = await inspectLink('https://go.example.com/a', { resolve: publicDns });
    assert.ok(codes(r.findings).includes('REDIRECT_TO_GAMBLING'), JSON.stringify(r.findings));
    assert.equal(r.ok, false);
    assert.ok(!s.calls.some(([, u]) => u.includes('1xbet')), 'the casino itself is never requested');
    assert.equal(assessCampaign({ ...base, links: [r] }).verdict, 'BLOCK');
  } finally { s.restore(); }
});

test('inspector: a public name resolving to a private address is refused before any request (SSRF)', async () => {
  const s = stubFetch({});
  try {
    const r = await inspectLink('https://innocent.example.com/', { resolve: async () => ['10.0.0.5'] });
    assert.ok(codes(r.findings).includes('LINK_PRIVATE_NETWORK'));
    assert.equal(s.calls.length, 0);
  } finally { s.restore(); }
  const s2 = stubFetch({ 'https://a.example.com/': { status: 302, location: 'https://meta.example.com/' } });
  try {
    const r = await inspectLink('https://a.example.com/', { resolve: async (h) => (h === 'a.example.com' ? ['93.184.216.34'] : ['169.254.169.254']) });
    assert.ok(codes(r.findings).includes('REDIRECT_TO_PRIVATE_NETWORK'), JSON.stringify(r.findings));
    assert.equal(s2.calls.length, 1, 'the private hop is never requested');
  } finally { s2.restore(); }
});

test('inspector: broken, unreachable, too many hops, HEAD refused falls back to GET', async () => {
  const loop = {};
  for (let i = 0; i < 8; i++) loop[`https://r.example.com/${i}`] = { status: 302, location: `https://r.example.com/${i + 1}` };
  const s = stubFetch({
    'https://ok.example.com/': { status: 200 },
    'https://gone.example.com/': { status: 404 },
    ...loop,
  });
  try {
    assert.equal((await inspectLink('https://ok.example.com/', { resolve: publicDns })).ok, true);
    assert.ok(codes((await inspectLink('https://gone.example.com/', { resolve: publicDns })).findings).includes('LINK_BROKEN'));
    assert.ok(codes((await inspectLink('https://down.example.com/', { resolve: publicDns })).findings).includes('LINK_UNREACHABLE'));
    assert.ok(codes((await inspectLink('https://r.example.com/0', { resolve: publicDns })).findings).includes('REDIRECT_TOO_MANY'));
    assert.ok(codes((await inspectLink('https://nx.example.com/', { resolve: async () => [] })).findings).includes('LINK_DNS_FAILED'));
  } finally { s.restore(); }
  const orig = globalThis.fetch;
  globalThis.fetch = async (_u, init) => new Response(null, { status: init.method === 'HEAD' ? 405 : 200 });
  try { assert.equal((await inspectLink('https://headless.example.com/', { resolve: publicDns })).status, 200); }
  finally { globalThis.fetch = orig; }
  const many = Array.from({ length: 30 }, (_, i) => ({ url: `https://ok.example.com/?i=${i}`, kind: 'a' }));
  globalThis.fetch = async () => new Response(null, { status: 200 });
  try {
    const res = await inspectLinks(many, publicDns);
    assert.ok(res.some((r) => codes(r.findings).includes('TOO_MANY_LINKS')));
    assert.equal(res.length, 26);
  } finally { globalThis.fetch = orig; }
});
