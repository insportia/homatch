// Go-live readiness — the one screen allowed to say "ready".
//
// The dangerous failure is not a false blocker, it is a false GREEN: an owner
// told telephony is ready, who turns off the kill switch and dials two
// thousand people through an unpriced product behind an unverified webhook.
//
// Every test below is written from that direction. A check that cannot be
// evaluated must block. A credential that is present but rejected must block.
// A retail price of zero must block, because zero is an unset price and not a
// free product.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGoLive } from '../goLive.ts';

const secretsFrom = (names) => (name) => new Set(names).has(name);

const ROUTES = (over = {}) => ([
  { role: 'TELEPHONY', provider: 'VAPI', enabled: true, kill_switch: true, ...over.TELEPHONY },
  { role: 'ORCHESTRATOR', provider: 'CARTESIA', enabled: true, kill_switch: false, ...over.ORCHESTRATOR },
  { role: 'MESSAGING', provider: 'META', enabled: true, kill_switch: true, ...over.MESSAGING },
]);

const PRODUCT = (code, over = {}) => ({
  code, enabled: false, pricing_active: false,
  standard_retail_cents: 0, reference_landed_cogs_cents: 0, ...over,
});

const BASE = (over = {}) => ({
  routes: ROUTES(over.routes ?? {}),
  products: [PRODUCT('AI_CALL'), PRODUCT('WHATSAPP')],
  accounts: [],
  hasSecret: secretsFrom(over.secrets ?? []),
  probes: { cartesiaOk: true, vapiOk: true, metaPhoneStatus: 401, metaWabaStatus: 401 },
  baseAgentReady: true,
  walletBalance: 0,
  ...over,
});

const byChannel = (result, channel) => result.find((r) => r.channel === channel);

test('production as it actually stands: nothing paid is ready, AI Talk is', () => {
  const out = evaluateGoLive(BASE({
    secrets: [
      'CARTESIA_API_KEY', 'VAPI_PRIVATE_API_KEY',
      'META_WHATSAPP_ACCESS_TOKEN', 'META_WHATSAPP_PHONE_NUMBER_ID',
      'META_WHATSAPP_BUSINESS_ACCOUNT_ID',
    ],
  }));

  assert.equal(byChannel(out, 'TELEPHONY').ready, false);
  assert.equal(byChannel(out, 'WHATSAPP').ready, false);
  assert.equal(byChannel(out, 'NUMBERS').ready, false);

  // AI Talk genuinely is ready: real credential, reachable provider, base
  // agent cached, route live and never kill-switched.
  assert.equal(byChannel(out, 'AI_TALK').ready, true);
});

test('a present but rejected Meta token is not a pass', () => {
  const wa = byChannel(evaluateGoLive(BASE({
    secrets: [
      'META_WHATSAPP_ACCESS_TOKEN', 'META_WHATSAPP_PHONE_NUMBER_ID',
      'META_WHATSAPP_BUSINESS_ACCOUNT_ID', 'META_WHATSAPP_VERIFY_TOKEN',
      'META_WHATSAPP_APP_SECRET',
    ],
  })), 'WHATSAPP');

  // Every secret is present...
  assert.equal(wa.checks.find((c) => c.key === 'ACCESS_TOKEN').ok, true);
  // ...and the channel is still blocked, on the probe.
  assert.ok(wa.blockedBy.includes('TOKEN_ACCEPTED'));
  assert.equal(wa.ready, false);
  assert.match(
    wa.checks.find((c) => c.key === 'TOKEN_ACCEPTED').detail, /401/,
    'the admin detail must carry the status the provider actually returned',
  );
});

test('a check that could not be evaluated blocks rather than passes', () => {
  const talk = byChannel(evaluateGoLive(BASE({
    secrets: ['CARTESIA_API_KEY'],
    probes: { cartesiaOk: null, vapiOk: null, metaPhoneStatus: null, metaWabaStatus: null },
  })), 'AI_TALK');

  assert.equal(talk.ready, false);
  assert.ok(talk.blockedBy.includes('PROVIDER_REACHABLE'));
  assert.equal(talk.checks.find((c) => c.key === 'PROVIDER_REACHABLE').detail, 'not probed');
});

test('a retail price of zero blocks: zero is unset, not free', () => {
  const tel = byChannel(evaluateGoLive(BASE({
    secrets: ['VAPI_PRIVATE_API_KEY', 'VAPI_WEBHOOK_SECRET'],
    products: [PRODUCT('AI_CALL', { enabled: true, pricing_active: true, standard_retail_cents: 0 })],
  })), 'TELEPHONY');

  assert.ok(tel.blockedBy.includes('AI_CALL_RETAIL_SET'));
  assert.match(
    tel.checks.find((c) => c.key === 'AI_CALL_RETAIL_SET').detail,
    /owner must set the retail price/,
  );
});

test('pricing_active alone is not enough, and neither is a price alone', () => {
  const priced = PRODUCT('AI_CALL', {
    enabled: true, pricing_active: false,
    standard_retail_cents: 500, reference_landed_cogs_cents: 100,
  });
  const tel = byChannel(evaluateGoLive(BASE({
    secrets: ['VAPI_PRIVATE_API_KEY'], products: [priced],
  })), 'TELEPHONY');
  assert.ok(tel.blockedBy.includes('AI_CALL_PRICING_ACTIVE'));
  assert.ok(!tel.blockedBy.includes('AI_CALL_RETAIL_SET'));
});

test('telephony needs an ACTIVE voice number, not merely any channel account', () => {
  const withWhatsAppOnly = evaluateGoLive(BASE({
    secrets: ['VAPI_PRIVATE_API_KEY'],
    accounts: [{ channel: 'WHATSAPP', phone_e164: '+995500000000', status: 'ACTIVE' }],
  }));
  assert.ok(byChannel(withWhatsAppOnly, 'TELEPHONY').blockedBy.includes('CALLER_NUMBER'));

  const pendingVoice = evaluateGoLive(BASE({
    secrets: ['VAPI_PRIVATE_API_KEY'],
    accounts: [{ channel: 'VOICE', phone_e164: '+995500000000', status: 'PENDING' }],
  }));
  assert.ok(byChannel(pendingVoice, 'TELEPHONY').blockedBy.includes('CALLER_NUMBER'),
    'a number that is not ACTIVE cannot place a call');

  const activeVoice = evaluateGoLive(BASE({
    secrets: ['VAPI_PRIVATE_API_KEY'],
    accounts: [{ channel: 'VOICE', phone_e164: '+995500000000', status: 'ACTIVE' }],
  }));
  assert.ok(!byChannel(activeVoice, 'TELEPHONY').blockedBy.includes('CALLER_NUMBER'));
});

test('the kill switch is reported last, after everything that must precede it', () => {
  const tel = byChannel(evaluateGoLive(BASE({ secrets: ['VAPI_PRIVATE_API_KEY'] })), 'TELEPHONY');
  const keys = tel.checks.map((c) => c.key);
  assert.equal(keys[keys.length - 1], 'KILL_SWITCH_OFF');
});

test('a missing webhook secret blocks telephony and names the unset variable', () => {
  const tel = byChannel(evaluateGoLive(BASE({ secrets: ['VAPI_PRIVATE_API_KEY'] })), 'TELEPHONY');
  const c = tel.checks.find((x) => x.key === 'WEBHOOK_SECRET');
  assert.equal(c.ok, false);
  assert.match(c.detail, /VAPI_WEBHOOK_SECRET/);
  assert.equal(c.ownerAction, true);
});

test('no check ever carries anything token-shaped', () => {
  const all = evaluateGoLive(BASE({
    secrets: ['VAPI_PRIVATE_API_KEY', 'CARTESIA_API_KEY'],
  })).flatMap((r) => r.checks);

  for (const c of all) {
    const text = `${c.key} ${c.detail ?? ''}`;
    // Credential NAMES are allowed and necessary; values are not.
    assert.doesNotMatch(text, /sk_[A-Za-z0-9]/, `${c.key} leaked something token-shaped`);
    assert.doesNotMatch(text, /EAA[A-Za-z0-9]/, `${c.key} leaked something token-shaped`);
    assert.doesNotMatch(text, /Bearer\s+\S/, `${c.key} leaked an authorization header`);
  }
});

test('numbers reports the one real blocker and names the credentials that clear it', () => {
  const numbers = byChannel(evaluateGoLive(BASE({ secrets: ['VAPI_PRIVATE_API_KEY'] })), 'NUMBERS');
  assert.equal(numbers.ready, false);
  assert.match(
    numbers.checks.find((x) => x.key === 'PROCUREMENT_PROVIDER').detail,
    /TWILIO_ACCOUNT_SID|TELNYX_API_KEY/,
  );

  const withTwilio = evaluateGoLive(BASE({ secrets: ['TWILIO_ACCOUNT_SID'] }));
  assert.equal(
    byChannel(withTwilio, 'NUMBERS').checks.find((x) => x.key === 'PROCUREMENT_PROVIDER').ok,
    true,
  );
});

test('every failing check appears in blockedBy, and a ready channel has none', () => {
  const out = evaluateGoLive(BASE({ secrets: ['CARTESIA_API_KEY'] }));
  for (const channel of out) {
    const failing = channel.checks.filter((c) => !c.ok).map((c) => c.key);
    assert.deepEqual(channel.blockedBy, failing, `${channel.channel} blockedBy disagrees with its checks`);
    assert.equal(channel.ready, failing.length === 0);
  }
});
