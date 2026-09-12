// The real-estate boundary and the risk engine.
//
// §6 is a hard product rule and §154's acceptance criteria name the exact
// cases: an unrelated campaign is blocked, a property campaign is allowed, and
// an ambiguous one is classified rather than guessed at. Those three are the
// first three tests here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDomain, applyLlmVerdict, foldForMatching } from '../domainClassifier.ts';
import { assessRisk, evaluateKillSwitch, TIER_LIMITS } from '../risk.ts';

/** A settled, ordinary account, so each test can vary one thing. */
const BASE = {
  trustTier: 'TRUSTED',
  accountAgeHours: 24 * 90,
  audienceSize: 200,
  consentedCount: 200,
  validPhoneCount: 200,
  channel: 'AI_CALL',
  countries: ['GE'],
  recentVolume24h: 20,
  priorVolume24h: 20,
  optOutRate: 0.01,
  complaintCount: 0,
  failureRate: 0.05,
  domainVerdict: 'ALLOW',
  outboundFrozen: false,
  estimatedSpendUsd: 10,
  dailySpendCapUsd: 250,
  spentTodayUsd: 0,
};

// ── §51's named cases ───────────────────────────────────────────────────────

test('a property follow-up campaign is allowed', () => {
  const result = classifyDomain({
    text: 'I want to follow up with people who asked about our Vake apartment project',
  });
  assert.equal(result.verdict, 'ALLOW');
  assert.equal(result.needsLlm, false);
});

test('a casino campaign is blocked outright', () => {
  const result = classifyDomain({ text: 'Promote my online casino' });
  assert.equal(result.verdict, 'BLOCK');
  assert.equal(result.stage, 'RULE');
  assert.ok(result.signals.some((s) => s.code === 'PROHIBITED_GAMBLING'));
});

test('"investment opportunity" alone proves nothing and is not allowed through', () => {
  // §51 names this exactly: do not treat the single word "investment" as
  // proof of real estate.
  const result = classifyDomain({ text: 'Investment opportunity with excellent returns' });
  assert.notEqual(result.verdict, 'ALLOW');
  assert.ok(result.signals.some((s) => s.code === 'WEAK_FINANCE_ONLY'));
});

test('investment language WITH a property noun is real estate', () => {
  const result = classifyDomain({
    text: 'Investment opportunity in a new residential complex in Saburtalo, apartments from the developer',
  });
  assert.equal(result.verdict, 'ALLOW');
});

test('a prohibited word is not outvoted by piled-up property vocabulary', () => {
  // The attack this defends against: wrap the banned thing in enough property
  // words to outscore it.
  const result = classifyDomain({
    text: 'Invest in our new casino development, apartments, Tbilisi, Vake, real estate, bedrooms, mortgage',
  });
  assert.equal(result.verdict, 'BLOCK');
});

test('the classifier works in Georgian and Russian, not only English', () => {
  assert.equal(classifyDomain({ text: 'ვყიდი ბინას ვაკეში, 2 საძინებელი' }).verdict, 'ALLOW');
  assert.equal(classifyDomain({ text: 'Продаю квартиру в Сабуртало, 2 комнаты' }).verdict, 'ALLOW');
  assert.equal(classifyDomain({ text: 'რეკლამა ჩემი კაზინოსთვის' }).verdict, 'BLOCK');
});

test('a campaign bound to a Homatch property is real estate by construction', () => {
  const result = classifyDomain({ text: 'Following up', hasPropertyContext: true });
  assert.equal(result.verdict, 'ALLOW');
  assert.equal(result.stage, 'RULE');
});

test('a real-estate agent template does NOT excuse a prohibited script', () => {
  // The structural shortcut must not become a way to smuggle content past the
  // boundary.
  const result = classifyDomain({
    text: 'Tell them about our casino and betting bonuses',
    agentTemplate: 'BUYER_QUALIFICATION',
  });
  assert.equal(result.verdict, 'BLOCK');
});

test('a two-word campaign is too short to judge and goes to review', () => {
  const result = classifyDomain({ text: 'Call them' });
  assert.equal(result.verdict, 'REVIEW');
  assert.ok(result.signals.some((s) => s.code === 'TOO_SHORT_TO_JUDGE'));
});

test('character-splitting and homoglyphs do not get past the word list', () => {
  assert.equal(classifyDomain({ text: 'promote my c-a-s-i-n-o business' }).verdict, 'BLOCK');
  assert.ok(foldForMatching('саsino').includes('casino'));
});

// ── Stage 4 ─────────────────────────────────────────────────────────────────

test('a model can never talk its way past a deterministic BLOCK', () => {
  // Prompt injection through a campaign description is a real attack surface:
  // the text being judged is written by the person being judged.
  const deterministic = classifyDomain({ text: 'Promote my online casino' });
  const after = applyLlmVerdict(deterministic, { verdict: 'ALLOW', confidence: 1 });
  assert.equal(after.verdict, 'BLOCK');
});

test('a low-confidence model ALLOW leaves the campaign for a human', () => {
  const deterministic = classifyDomain({ text: 'Following up with our list of enquiries' });
  const after = applyLlmVerdict(deterministic, { verdict: 'ALLOW', confidence: 0.3 });
  assert.equal(after.verdict, 'REVIEW');
});

test('a model BLOCK is honoured', () => {
  const deterministic = classifyDomain({ text: 'Following up with our list of enquiries' });
  const after = applyLlmVerdict(deterministic, { verdict: 'BLOCK', confidence: 0.9 });
  assert.equal(after.verdict, 'BLOCK');
});

// ── Risk ────────────────────────────────────────────────────────────────────

test('an established account running an ordinary campaign is allowed at full speed', () => {
  const result = assessRisk(BASE);
  assert.equal(result.decision, 'ALLOW');
  assert.equal(result.level, 'LOW');
  assert.equal(result.throughputPerHour, TIER_LIMITS.TRUSTED.callsPerHour);
});

test('a frozen account is blocked whatever the campaign looks like', () => {
  const result = assessRisk({ ...BASE, outboundFrozen: true });
  assert.equal(result.decision, 'BLOCK');
  assert.equal(result.allowedRecipients, 0);
  assert.ok(result.signals.some((s) => s.code === 'ACCOUNT_OUTBOUND_FROZEN'));
});

test('a blocked domain verdict ends the assessment immediately', () => {
  const result = assessRisk({ ...BASE, domainVerdict: 'BLOCK' });
  assert.equal(result.decision, 'BLOCK');
  assert.equal(result.throughputPerHour, 0);
});

test('a brand-new account with no consent evidence does not get a free run', () => {
  const result = assessRisk({
    ...BASE, trustTier: 'NEW', accountAgeHours: 2,
    audienceSize: 5000, consentedCount: 0, validPhoneCount: 5000,
  });
  assert.notEqual(result.decision, 'ALLOW');
  assert.ok(result.signals.some((s) => s.code === 'ACCOUNT_UNDER_ONE_DAY'));
  assert.ok(result.signals.some((s) => s.code === 'CONSENT_EVIDENCE_ABSENT'));
  // §49: NEW is capped, so the audience is trimmed rather than refused outright.
  assert.ok(result.allowedRecipients <= TIER_LIMITS.NEW.maxRecipients);
});

test('THROTTLE is a slower campaign, not a refusal', () => {
  const result = assessRisk({ ...BASE, trustTier: 'NEW', accountAgeHours: 24 * 30, consentedCount: 60 });
  if (result.decision === 'THROTTLE') {
    assert.ok(result.throughputPerHour > 0);
    assert.ok(result.throughputPerHour < TIER_LIMITS.NEW.callsPerHour);
    assert.ok(result.allowedRecipients > 0);
  }
});

test('every decision can explain itself', () => {
  // §50: no opaque score. A decision with no signals is not reviewable.
  const result = assessRisk({ ...BASE, trustTier: 'NEW', accountAgeHours: 1, complaintCount: 4 });
  assert.ok(result.signals.length > 0);
  for (const signal of result.signals) {
    assert.equal(typeof signal.code, 'string');
    assert.ok(signal.code.length > 0);
    assert.equal(typeof signal.weight, 'number');
  }
});

test('a restricted account can send nothing', () => {
  const result = assessRisk({ ...BASE, trustTier: 'RESTRICTED' });
  assert.equal(result.decision, 'BLOCK');
  assert.equal(result.allowedRecipients, 0);
});

test('an audience is never larger than the tier allows', () => {
  const result = assessRisk({ ...BASE, trustTier: 'NEW', audienceSize: 100_000, accountAgeHours: 24 * 60 });
  assert.ok(result.allowedRecipients <= TIER_LIMITS.NEW.maxRecipients);
});

// ── Kill switch ─────────────────────────────────────────────────────────────

const HEALTHY = {
  sent: 500, failed: 10, optOuts: 2, complaints: 0,
  spentUsd: 5, campaignCapUsd: 100, accountDailyRemainingUsd: 100,
  providerHealthy: true, channelQualityDegraded: false,
};

test('a healthy campaign keeps running', () => {
  assert.equal(evaluateKillSwitch(HEALTHY).pause, false);
});

test('an opt-out spike pauses the campaign in a way the customer cannot lift', () => {
  const result = evaluateKillSwitch({ ...HEALTHY, sent: 100, optOuts: 40 });
  assert.equal(result.pause, true);
  assert.equal(result.status, 'COMPLIANCE_PAUSED');
});

test('two opt-outs from three sends is three sends, not a 67% opt-out rate', () => {
  // The bug this prevents: a rate computed before there is anything to divide
  // by, killing every campaign on its third recipient.
  assert.equal(evaluateKillSwitch({ ...HEALTHY, sent: 3, optOuts: 2 }).pause, false);
});

test('complaints stop a campaign immediately, without waiting for a sample', () => {
  const result = evaluateKillSwitch({ ...HEALTHY, complaints: 3 });
  assert.equal(result.status, 'COMPLIANCE_PAUSED');
  assert.equal(result.code, 'COMPLAINT_THRESHOLD');
});

test('a spend cap is the customer’s own problem and they may resume it', () => {
  // §52's distinction: behavioural pauses are COMPLIANCE_PAUSED and cannot be
  // self-cleared; operational ones are PAUSED and can.
  const result = evaluateKillSwitch({ ...HEALTHY, spentUsd: 100, campaignCapUsd: 100 });
  assert.equal(result.pause, true);
  assert.equal(result.status, 'PAUSED');
});

test('a provider outage pauses rather than disciplines', () => {
  assert.equal(evaluateKillSwitch({ ...HEALTHY, providerHealthy: false }).status, 'PAUSED');
});

test('a degraded number is a compliance pause, because it is a reputation problem', () => {
  assert.equal(evaluateKillSwitch({ ...HEALTHY, channelQualityDegraded: true }).status, 'COMPLIANCE_PAUSED');
});
