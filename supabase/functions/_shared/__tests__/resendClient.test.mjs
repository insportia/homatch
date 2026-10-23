// The Resend client's pure parts: reply tokens route exactly one tenant, provider domain
// states map honestly (only "verified" is VERIFIED), unsubscribe headers follow RFC 8058,
// and provider limit alerts fire at the threshold.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatFrom, listUnsubscribeHeaders, mapDomainStatus, newRouteToken, replyAddress, routeTokenFrom, usageAlerts,
} from '../resend/client.ts';

test('reply tokens: 26 base32 chars, unique, and only accepted on the reply domain', () => {
  const a = newRouteToken();
  const b = newRouteToken();
  assert.match(a, /^[a-z2-7]{26}$/);
  assert.notEqual(a, b);
  const addr = replyAddress(a, 'reply.homatch.live');
  assert.equal(addr, `r-${a}@reply.homatch.live`);
  assert.equal(routeTokenFrom([`"Owner" <${addr}>`], 'reply.homatch.live'), a);
  assert.equal(routeTokenFrom([addr.toUpperCase()], 'reply.homatch.live'), a);
  assert.equal(routeTokenFrom([`r-${a}@evil.example`], 'reply.homatch.live'), null, 'another domain never routes');
  assert.equal(routeTokenFrom(['r-short@reply.homatch.live', 'someone@reply.homatch.live'], 'reply.homatch.live'), null);
  assert.equal(routeTokenFrom(['x@a.test', addr], 'reply.homatch.live'), a, 'found among several recipients');
});

test('domain status is never VERIFIED unless the provider says verified', () => {
  assert.equal(mapDomainStatus('verified'), 'VERIFIED');
  for (const s of ['pending', 'not_started', 'temporary_failure', 'partially_verified', null, undefined, 'something_new']) {
    assert.notEqual(mapDomainStatus(s), 'VERIFIED', String(s));
  }
  assert.equal(mapDomainStatus('failed'), 'FAILED');
});

test('List-Unsubscribe is one-click (RFC 8058)', () => {
  const h = listUnsubscribeHeaders('https://x.test/u?t=1', 'unsub@reply.homatch.live');
  assert.equal(h['List-Unsubscribe'], '<https://x.test/u?t=1>, <mailto:unsub@reply.homatch.live>');
  assert.equal(h['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
});

test('sender display names cannot inject header syntax', () => {
  assert.equal(formatFrom('Ana "<evil>"\r\nBcc: x', 'a@b.test'), '"Ana evilBcc: x" <a@b.test>');
  assert.equal(formatFrom('', 'a@b.test'), 'a@b.test');
});

test('provider usage alerts fire at the threshold and ignore unlimited resources', () => {
  const usage = {
    emails: { daily: { used: 10, limit: 100 }, monthly: { used: 45_000, limit: 50_000 } },
    contacts: { used: 900, limit: 1000 }, domains: { used: 2, limit: null }, broadcasts: { used: 5, limit: null },
  };
  assert.deepEqual(usageAlerts(usage, 80), ['emails_monthly', 'contacts']);
  assert.deepEqual(usageAlerts(null, 80), []);
});
