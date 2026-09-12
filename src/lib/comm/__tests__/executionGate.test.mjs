// The financial invariant, asserted with a spy that counts provider calls.
//
// Every test here answers one question: did Homatch spend money it could not
// bill for? The assertion is not "the gate returned false" — it is
// `provider.calls === 0`. A gate that refuses correctly and a caller that
// ignores the refusal is the same bug as no gate at all, so the caller is
// modelled too.
//
// The ten cases below are the ten ways this can go wrong. Nine of them refuse.
// The tenth is the one that must NOT refuse, because a gate that blocks
// everything is not a safety feature, it is an outage.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { evaluateExecutionGate, isCustomerVisible } from '../executionGate.ts';

/**
 * A provider adapter that counts. If a single test drives this above zero on
 * a refusal, real money moved in production under the same conditions.
 */
function providerSpy() {
  const spy = { calls: 0, lastArgs: null };
  spy.placeCall = (args) => { spy.calls++; spy.lastArgs = args; return { ok: true }; };
  spy.send = (args) => { spy.calls++; spy.lastArgs = args; return { ok: true }; };
  return spy;
}

/**
 * The dispatcher's shape, reduced to the decision under test: consult the
 * gate, and touch the provider only on allow. This mirrors executeSend() in
 * comm-dispatch-worker — if that function ever calls the adapter before
 * consulting the gate, this model stops representing it and the mirror test
 * at the bottom of this file fails.
 */
function dispatch(input, provider) {
  const gate = evaluateExecutionGate(input);
  if (!gate.allow) return gate;
  provider.placeCall({ to: '+995599123456' });
  return gate;
}

/** Everything valid. Each test below breaks exactly one thing. */
const HEALTHY = {
  action: 'PLACE_CALL',
  requestValid: true,
  contactContactable: true,
  domainVerdict: 'ALLOW',
  riskDecision: 'ALLOW',
  killSwitchPaused: false,
  channelEnabled: true,
  channelKillSwitch: false,
  providerHealthy: true,
  productFound: true,
  productEnabled: true,
  pricingActive: true,
  unitNetCents: 44,
  freeAllowed: false,
  availableCredits: 5000,
  requiredCredits: 120,
  reservationRequired: true,
  reservationHeld: true,
  spentCents: 0,
  inFlightCents: 0,
  nextUnitMaxCents: 132,
  campaignCapCents: 15000,
  accountDailyRemainingCents: 250000,
};

/** Break one field, dispatch, and assert nothing was bought. */
function refuses(patch, expectedRefusal) {
  const provider = providerSpy();
  const gate = dispatch({ ...HEALTHY, ...patch }, provider);
  assert.equal(provider.calls, 0,
    `THE PROVIDER WAS CALLED. With ${JSON.stringify(patch)} this spends real money and bills nobody.`);
  assert.equal(gate.allow, false);
  assert.equal(gate.refusal, expectedRefusal);
  return gate;
}

/* ── 1. The case that must be allowed ────────────────────────────────────── */

test('1. active product, valid price and sufficient balance may execute', () => {
  const provider = providerSpy();
  const gate = dispatch(HEALTHY, provider);
  assert.equal(gate.allow, true, 'a fully valid send must not be blocked — a gate that refuses everything is an outage');
  assert.equal(gate.refusal, null);
  assert.equal(provider.calls, 1, 'the provider should have been called exactly once');
});

/* ── 2-10. The cases that must not ───────────────────────────────────────── */

test('2. an inactive product does not reach the provider', () => {
  const gate = refuses({ pricingActive: false }, 'PRODUCT_PRICING_INACTIVE');
  assert.equal(gate.pauseCampaign, true,
    'every remaining unit would fail identically, so the campaign stops rather than burning through the queue');
});

test('3. a disabled product does not reach the provider', () => {
  refuses({ productEnabled: false }, 'PRODUCT_DISABLED');
});

test('4. a missing price does not reach the provider', () => {
  refuses({ unitNetCents: null }, 'PRODUCT_PRICE_MISSING');
  // And an absent product row is the same refusal, not a default price.
  refuses({ productFound: false }, 'PRODUCT_PRICE_MISSING');
});

test('5. a malformed price does not reach the provider', () => {
  // Each of these would have become a charge nobody could defend.
  refuses({ unitNetCents: Number.NaN }, 'PRODUCT_PRICE_INVALID');
  refuses({ unitNetCents: Number.POSITIVE_INFINITY }, 'PRODUCT_PRICE_INVALID');
  refuses({ unitNetCents: -12 }, 'PRODUCT_PRICE_INVALID');
  // Zero is the dangerous one: it is almost always an unconfigured column, and
  // it is the exact shape the products ship in. Free must be declared.
  refuses({ unitNetCents: 0 }, 'PRODUCT_PRICE_INVALID');
});

test('5b. a product deliberately declared free at zero may execute', () => {
  // The other half of the rule above. Without this, the AI Talk demo could
  // never run, and the zero check would be a blanket ban rather than a
  // requirement to say what you mean.
  const provider = providerSpy();
  const gate = dispatch({ ...HEALTHY, unitNetCents: 0, freeAllowed: true, requiredCredits: 0 }, provider);
  assert.equal(gate.allow, true);
  assert.equal(provider.calls, 1);
});

test('6. an insufficient balance does not reach the provider', () => {
  refuses({ availableCredits: 10, requiredCredits: 120 }, 'INSUFFICIENT_CREDIT');
  // A balance that could not be read is not a balance of zero and not a pass.
  refuses({ availableCredits: null }, 'INSUFFICIENT_CREDIT');
  refuses({ availableCredits: Number.NaN }, 'INSUFFICIENT_CREDIT');
});

test('7. a failed reservation does not reach the provider', () => {
  refuses({ reservationHeld: false }, 'RESERVATION_FAILED');
});

test('7b. a product that needs no reservation is not blocked for lacking one', () => {
  const provider = providerSpy();
  const gate = dispatch({ ...HEALTHY, reservationRequired: false, reservationHeld: false }, provider);
  assert.equal(gate.allow, true);
  assert.equal(provider.calls, 1);
});

test('8. an active kill switch does not reach the provider', () => {
  refuses({ channelKillSwitch: true }, 'KILL_SWITCH_ACTIVE');
  refuses({ channelEnabled: false }, 'CHANNEL_DISABLED');
  // No routing row at all is not permission either.
  refuses({ channelEnabled: false, channelKillSwitch: false }, 'CHANNEL_DISABLED');
});

test('9. a risk rejection does not reach the provider', () => {
  refuses({ riskDecision: 'BLOCK' }, 'RISK_REJECTED');
  refuses({ killSwitchPaused: true }, 'COMPLIANCE_PAUSED');
});

test('10. a domain rejection does not reach the provider', () => {
  refuses({ domainVerdict: 'BLOCK' }, 'DOMAIN_REJECTED');
  // Never classified is not the same as allowed. §6 requires the gate to have
  // run, and a null verdict means it did not.
  refuses({ domainVerdict: null }, 'DOMAIN_REJECTED');
});

/* ── Caps, suppression, and ordering ─────────────────────────────────────── */

test('a spend cap that would be exceeded does not reach the provider', () => {
  const gate = refuses(
    { spentCents: 14900, inFlightCents: 0, nextUnitMaxCents: 200, campaignCapCents: 15000 },
    'SPEND_CAP_REACHED');
  assert.equal(gate.pauseCampaign, false,
    'a cap is raisable, so the unit goes back rather than the campaign being marked non-compliant');
});

test('work already on the wire counts against the cap', () => {
  // The failure this prevents: a cap exceeded by exactly the amount already
  // in flight, because connected calls keep costing while the check ignores them.
  refuses(
    { spentCents: 10000, inFlightCents: 4900, nextUnitMaxCents: 200, campaignCapCents: 15000 },
    'SPEND_CAP_REACHED');
});

test('the account daily limit does not reach the provider', () => {
  refuses({ accountDailyRemainingCents: 50, nextUnitMaxCents: 132 }, 'SPEND_CAP_REACHED');
});

test('a contact who opted out is skipped, and the campaign keeps running', () => {
  const gate = refuses({ contactContactable: false }, 'CONTACT_SUPPRESSED');
  assert.equal(gate.pauseCampaign, false,
    'the next contact may be perfectly contactable; pausing here would end a campaign over one opt-out');
});

test('an unusable destination never reaches the provider', () => {
  refuses({ requestValid: false }, 'INVALID_REQUEST');
});

test('policy is reported before money', () => {
  // A campaign that is both domain-blocked and unpriced must say domain-blocked.
  // Reporting "no price configured" would send the owner to the pricing screen
  // to fix a campaign that is never going to be allowed to run.
  const gate = evaluateExecutionGate({ ...HEALTHY, domainVerdict: 'BLOCK', pricingActive: false });
  assert.equal(gate.refusal, 'DOMAIN_REJECTED');
});

/* ── Exhaustive: no single missing fact can open the gate ─────────────────── */

test('no single falsy or absent input opens the gate', () => {
  /*
   * A blunt sweep over every boolean and nullable field. Its job is to catch
   * the field somebody adds later and forgets to check — the gate is only
   * worth anything if it is total.
   */
  const mustRefuse = {
    requestValid: false, contactContactable: false,
    channelEnabled: false, providerHealthy: false,
    productFound: false, productEnabled: false, pricingActive: false,
    reservationHeld: false,
  };
  const opened = [];
  for (const [field, value] of Object.entries(mustRefuse)) {
    const provider = providerSpy();
    const gate = dispatch({ ...HEALTHY, [field]: value }, provider);
    if (gate.allow || provider.calls > 0) opened.push(field);
  }
  const nullable = ['unitNetCents', 'availableCredits', 'domainVerdict'];
  for (const field of nullable) {
    const provider = providerSpy();
    const gate = dispatch({ ...HEALTHY, [field]: null }, provider);
    if (gate.allow || provider.calls > 0) opened.push(`${field}=null`);
  }
  assert.deepEqual(opened, [],
    'these inputs can be falsy or absent and the gate still permits spending: ' + opened.join(', '));
});

test('an empty input object refuses rather than throwing', () => {
  // Fail closed even on a caller that passes nothing. A thrown exception here
  // would be caught by the dispatcher's per-campaign try/catch and logged as
  // "campaign_failed", which is indistinguishable from a transient fault.
  const gate = evaluateExecutionGate({});
  assert.equal(gate.allow, false);
  assert.ok(gate.refusal, 'a refusal must be named even for a malformed call');
});

/* ── What a customer is allowed to be told ───────────────────────────────── */

test('provider plumbing is never named to a customer', () => {
  assert.equal(isCustomerVisible('PROVIDER_UNAVAILABLE'), false,
    '"the provider is unavailable" names our plumbing and tells a customer nothing they can act on');
  assert.equal(isCustomerVisible('KILL_SWITCH_ACTIVE'), false);
  assert.equal(isCustomerVisible('RESERVATION_FAILED'), false);

  assert.equal(isCustomerVisible('INSUFFICIENT_CREDIT'), true, 'a customer can top up');
  assert.equal(isCustomerVisible('SPEND_CAP_REACHED'), true, 'a customer can raise their own cap');
  assert.equal(isCustomerVisible('DOMAIN_REJECTED'), true, 'a customer can rewrite a campaign');
});

/* ── The model above must keep matching the real dispatcher ──────────────── */

test('the dispatcher consults the gate before it touches an adapter', () => {
  /*
   * Everything above tests a MODEL of executeSend(). This reads the real one.
   *
   * If a future edit calls createVapiProvider() or createMetaProvider() before
   * evaluateExecutionGate(), every test in this file still passes while
   * production spends money ungated. So the ordering is asserted against the
   * shipped source.
   */
  const src = readFileSync(
    join(process.cwd(), 'supabase', 'functions', 'comm-dispatch-worker', 'index.ts'), 'utf8');

  const body = src.slice(src.indexOf('async function executeSend('), src.indexOf('async function resolveBilling('));
  assert.ok(body.length > 200, 'executeSend could not be located; this guard has gone stale');

  const gateAt = body.indexOf('evaluateExecutionGate(');
  assert.ok(gateAt > -1, 'executeSend no longer consults the execution gate');

  for (const adapter of ['sendWhatsApp(', 'placeCall(']) {
    const callAt = body.indexOf(adapter);
    assert.ok(callAt > gateAt,
      `executeSend reaches ${adapter} before the execution gate — the gate is decorative`);
  }

  // And the refusal must actually stop it.
  assert.ok(/if \(!gate\.allow\)/.test(body),
    'the gate result is computed but never acted on');
});
