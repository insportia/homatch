// The real-estate domain gate, over the corpus the release asks for.
//
// Homatch sells property work. The gate exists so the platform cannot be
// turned into a generic outbound dialler by anyone who can write a campaign
// description — which matters commercially, legally, and for the WhatsApp
// business account, because Meta suspends numbers that send unrelated
// marketing.
//
// policy.test.mjs already checks the classifier's individual behaviours. This
// is the release corpus: nine kinds of work that MUST be allowed and six that
// MUST NOT, each run end to end through the execution gate so the assertion is
// `provider.calls === 0` rather than a verdict string.
//
// A rejected campaign that still dials is the failure this file exists to make
// impossible.

import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyDomain } from '../domainClassifier.ts';
import { evaluateExecutionGate } from '../executionGate.ts';

/** Counts. Above zero on a rejection means real money moved. */
function providerSpy() {
  return { calls: 0, placeCall() { this.calls++; } };
}

/** Everything else valid, so the domain verdict is the only thing under test. */
const READY = {
  action: 'PLACE_CALL',
  requestValid: true, contactContactable: true,
  riskDecision: 'ALLOW', killSwitchPaused: false,
  channelEnabled: true, channelKillSwitch: false, providerHealthy: true,
  productFound: true, productEnabled: true, pricingActive: true,
  unitNetCents: 44, availableCredits: 5000, requiredCredits: 120,
  reservationRequired: true, reservationHeld: true,
  spentCents: 0, inFlightCents: 0, nextUnitMaxCents: 132,
  campaignCapCents: null, accountDailyRemainingCents: null,
};

/** Classify, then dispatch as the worker would, and report what happened. */
function run(text, agentTemplate) {
  // `agentTemplate`, not `templateCode`. The first draft of this file passed
  // the wrong key, so every case was classified as if no template had been
  // chosen — which made two legitimate real-estate campaigns look blocked.
  // A fixture that misnames a field tests the wrong system.
  const domain = classifyDomain({ text, agentTemplate });
  const provider = providerSpy();
  const gate = evaluateExecutionGate({ ...READY, domainVerdict: domain.verdict });
  if (gate.allow) provider.placeCall();
  return { verdict: domain.verdict, signals: domain.signals, providerCalls: provider.calls, gate };
}

/* ── Work Homatch is for ─────────────────────────────────────────────────── */

const ALLOWED = [
  ['apartment buyer qualification',
   'Call buyers who enquired about two-bedroom apartments in Vake and find out their budget, timeline and whether they want a viewing.',
   'BUYER_QUALIFICATION'],

  ['seller qualification',
   'Contact owners who requested a valuation, confirm the property address and number of rooms, and ask when they want to sell.',
   'SELLER_QUALIFICATION'],

  ['viewing confirmation',
   'Ring people who booked a property viewing tomorrow to confirm they are still coming and remind them of the address.',
   'VIEWING_CONFIRMATION'],

  ['rental inquiry',
   'Follow up with tenants enquiring about long-term rental apartments in Saburtalo, confirm their monthly budget and move-in date.',
   'RENTAL_INQUIRY'],

  ['developer sales',
   'Call registered interest for the new residential development in Didi Dighomi and book appointments at the sales office.',
   'DEVELOPER_SALES'],

  ['mortgage follow-up',
   'Follow up with clients who started a mortgage pre-approval for a property purchase and ask whether they need help with the bank.',
   'MORTGAGE_FOLLOWUP'],

  ['property contract workflow',
   'Contact buyers whose purchase contract is awaiting signature and confirm the notary appointment for the property sale.',
   'PROPERTY_FOLLOWUP'],

  ['property management',
   'Call landlords whose tenancy agreement expires next month about renewing the lease on their rental property.',
   'PROPERTY_FOLLOWUP'],

  ['renovation tied to a property',
   'Contact owners of apartments we listed who asked about renovation before sale, and arrange a site visit to quote the work.',
   'PROPERTY_FOLLOWUP'],
];

for (const [name, text, template] of ALLOWED) {
  test(`ALLOWED: ${name}`, () => {
    const r = run(text, template);
    assert.notEqual(r.verdict, 'BLOCK',
      `real-estate work was blocked — the gate is too tight and the product stops working.\n` +
      `  verdict: ${r.verdict}\n  signals: ${JSON.stringify(r.signals)}`);
    if (r.verdict === 'ALLOW') {
      assert.equal(r.providerCalls, 1, 'an allowed real-estate campaign must be able to dial');
    } else {
      // REVIEW is an acceptable answer for genuine work — a human looks at it.
      // What is NOT acceptable is dialling anyway, so that is asserted too.
      assert.equal(r.providerCalls, 0, 'a campaign held for review must not dial while it waits');
    }
  });
}

/* ── Work Homatch is not for ─────────────────────────────────────────────── */

const REJECTED = [
  ['generic crypto campaign',
   'Call our leads about our new cryptocurrency token presale and the guaranteed returns on staking.'],

  ['gambling promotion',
   'Promote our online casino and sports betting bonus to everyone on the list, free spins for new depositors.'],

  ['political campaign',
   'Call voters in the district to ask them to support our candidate in the parliamentary election and remind them to vote.'],

  ['unrelated ecommerce',
   'Ring customers about the seasonal sale on our clothing store, thirty percent off shoes and handbags this week.'],

  ['generic marketing blast',
   'Call everyone on the purchased list and tell them about our services, whatever they might need, and try to book a meeting.'],

  ['unrelated sales lead generation',
   'Cold call businesses to sell our SaaS analytics subscription and book demos with their marketing directors.'],
];

for (const [name, text] of REJECTED) {
  test(`REJECTED: ${name} — and the provider is never called`, () => {
    const r = run(text, 'CUSTOM');
    assert.notEqual(r.verdict, 'ALLOW',
      `this is not real-estate work and the gate allowed it:\n  "${text}"\n  signals: ${JSON.stringify(r.signals)}`);
    assert.equal(r.providerCalls, 0,
      'THE PROVIDER WAS CALLED on a non-real-estate campaign. This is the exact failure the domain gate exists to prevent.');
  });
}

/* ── The shapes that get a gate wrong ────────────────────────────────────── */

test('property words sprinkled on unrelated work do not buy a pass', () => {
  // The obvious evasion: name-drop the domain and carry on selling crypto.
  const r = run(
    'Call our property investor list about our cryptocurrency token presale — real estate investors love guaranteed staking returns on apartments.',
    'CUSTOM');
  assert.notEqual(r.verdict, 'ALLOW',
    'prohibited work escaped by mentioning property; the gate is keyword-fooled');
  assert.equal(r.providerCalls, 0);
});

test('an empty or contentless campaign is not allowed through', () => {
  for (const text of ['', '   ', 'hello', 'test', 'asdf']) {
    const r = run(text, 'CUSTOM');
    assert.notEqual(r.verdict, 'ALLOW',
      `"${text}" was allowed — a campaign with no stated purpose cannot have been classified as real-estate work`);
    assert.equal(r.providerCalls, 0);
  }
});

test('a real-estate template code cannot launder unrelated text', () => {
  /*
   * The template is a hint, not a permission. Choosing BUYER_QUALIFICATION
   * from a dropdown and then writing a casino campaign underneath it must not
   * be enough, or the gate is a formality anyone can click past.
   */
  const r = run(
    'Promote our online casino and sports betting bonus, free spins for new depositors.',
    'BUYER_QUALIFICATION');
  assert.notEqual(r.verdict, 'ALLOW',
    'a prohibited campaign passed because it was filed under a real-estate template');
  assert.equal(r.providerCalls, 0);
});

test('the corpus is big enough to mean something', () => {
  // Guards against a future edit quietly shrinking the lists until the gate is
  // tested by three sentences.
  assert.ok(ALLOWED.length >= 9, `only ${ALLOWED.length} allowed cases`);
  assert.ok(REJECTED.length >= 6, `only ${REJECTED.length} rejected cases`);
});
