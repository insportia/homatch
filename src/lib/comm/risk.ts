// HOMATCH Communications — campaign risk, and the trust tiers it reads.
//
// §50 forbids an opaque score. "AI says risk = 82" is not a decision anyone
// can review, appeal or debug, so every point here comes from a named signal
// with a weight, and the signals are persisted to comm_risk_assessments
// alongside the verdict. An admin looking at a blocked campaign sees the
// reasons, not the number.
//
// WHAT THIS IS FOR, AND WHAT IT IS NOT FOR
//
// It is not a spam filter. The real-estate boundary is domainClassifier.ts and
// it runs first; a casino campaign is already gone before this file sees it.
// This decides how much rope a LEGITIMATE campaign gets: a verified agency
// calling 200 of its own past enquiries is LOW, and the same campaign from an
// account that signed up an hour ago against a 40,000-row list it uploaded ten
// minutes ago is HIGH, because those are different risks even though the
// property vocabulary is identical.

import type { PolicyDecision, RiskLevel, TrustTier } from './vocabulary.ts';

export interface RiskSignal {
  code: string;
  weight: number;
  detail?: string;
}

export interface RiskInput {
  trustTier: TrustTier;
  /** Hours since the account was created. */
  accountAgeHours: number;
  audienceSize: number;
  /** Of the audience, how many carry an explicit consent record. */
  consentedCount: number;
  /** Of the audience, how many have a valid E.164 phone. */
  validPhoneCount: number;
  channel: string;
  countries: string[];
  /** Recipients this account has already dispatched to in the last 24h. */
  recentVolume24h: number;
  /** The same figure for the 24h before that, so growth is visible. */
  priorVolume24h: number;
  optOutRate: number;        // 0-1, this account's historical rate
  complaintCount: number;
  failureRate: number;       // 0-1, historical delivery/connect failure
  /** The domain gate's own verdict, which is an input here rather than a duplicate check. */
  domainVerdict: 'ALLOW' | 'REVIEW' | 'BLOCK';
  /** Set by the kill switch. Nothing about this campaign can clear it. */
  outboundFrozen: boolean;
  estimatedSpendUsd: number;
  /** The account's own daily ceiling, from comm_account_trust or the global default. */
  dailySpendCapUsd: number;
  spentTodayUsd: number;
}

export interface RiskResult {
  decision: PolicyDecision;
  level: RiskLevel;
  score: number;
  signals: RiskSignal[];
  /** How many recipients per hour this campaign may actually dispatch to. */
  throughputPerHour: number;
  /** Hard ceiling on recipients for this launch, after every cap is applied. */
  allowedRecipients: number;
}

/**
 * Default ceilings per tier. An admin overrides these per account in
 * comm_account_trust; nulls there mean "use this table".
 *
 * NEW is deliberately small. A brand-new account's first campaign being capped
 * at 200 recipients costs a legitimate agency one conversation with support
 * and costs an abuser their entire business model.
 */
export const TIER_LIMITS: Record<TrustTier, {
  maxRecipients: number; callsPerHour: number; messagesPerHour: number;
  dailySpendUsd: number; concurrentCalls: number;
}> = {
  NEW:        { maxRecipients: 200,    callsPerHour: 30,   messagesPerHour: 200,   dailySpendUsd: 25,   concurrentCalls: 2 },
  TRUSTED:    { maxRecipients: 2_000,  callsPerHour: 120,  messagesPerHour: 1_000, dailySpendUsd: 250,  concurrentCalls: 8 },
  VERIFIED:   { maxRecipients: 10_000, callsPerHour: 400,  messagesPerHour: 5_000, dailySpendUsd: 1_500, concurrentCalls: 25 },
  ELEVATED:   { maxRecipients: 50_000, callsPerHour: 1_200, messagesPerHour: 20_000, dailySpendUsd: 10_000, concurrentCalls: 80 },
  RESTRICTED: { maxRecipients: 0,      callsPerHour: 0,    messagesPerHour: 0,     dailySpendUsd: 0,    concurrentCalls: 0 },
};

export function assessRisk(input: RiskInput): RiskResult {
  const signals: RiskSignal[] = [];
  let score = 0;

  const add = (code: string, weight: number, detail?: string) => {
    if (weight === 0) return;
    score += weight;
    signals.push({ code, weight, detail });
  };

  // ── The things that end it immediately ───────────────────────────────────
  if (input.outboundFrozen) {
    return frozen(signals, 'ACCOUNT_OUTBOUND_FROZEN', 'a compliance pause is in force on this account');
  }
  if (input.trustTier === 'RESTRICTED') {
    return frozen(signals, 'ACCOUNT_RESTRICTED', 'account restricted by an administrator');
  }
  if (input.domainVerdict === 'BLOCK') {
    return frozen(signals, 'DOMAIN_BLOCKED', 'campaign is outside the real-estate boundary');
  }

  const limits = TIER_LIMITS[input.trustTier];

  // ── Account maturity ─────────────────────────────────────────────────────
  if (input.accountAgeHours < 24) add('ACCOUNT_UNDER_ONE_DAY', 25, `${Math.round(input.accountAgeHours)}h old`);
  else if (input.accountAgeHours < 24 * 7) add('ACCOUNT_UNDER_ONE_WEEK', 12);
  if (input.trustTier === 'NEW') add('TRUST_TIER_NEW', 10);
  if (input.trustTier === 'VERIFIED' || input.trustTier === 'ELEVATED') add('TRUST_TIER_ESTABLISHED', -15);

  // ── Audience quality ─────────────────────────────────────────────────────
  const size = Math.max(0, input.audienceSize);
  if (size > limits.maxRecipients) {
    add('AUDIENCE_OVER_TIER_LIMIT', 30, `${size} requested, ${limits.maxRecipients} allowed at ${input.trustTier}`);
  } else if (size > limits.maxRecipients * 0.5) {
    add('AUDIENCE_LARGE_FOR_TIER', 10);
  }

  const consentRate = size > 0 ? input.consentedCount / size : 1;
  if (size > 0) {
    if (consentRate < 0.2) add('CONSENT_EVIDENCE_ABSENT', 28, `${Math.round(consentRate * 100)}% of the audience has a consent record`);
    else if (consentRate < 0.6) add('CONSENT_EVIDENCE_THIN', 12, `${Math.round(consentRate * 100)}%`);
    else add('CONSENT_EVIDENCE_GOOD', -8);
  }

  const phoneRate = size > 0 ? input.validPhoneCount / size : 1;
  if (size > 0 && phoneRate < 0.5) {
    // A list where half the numbers do not parse was not collected carefully,
    // whatever the consent checkbox said.
    add('LIST_QUALITY_POOR', 18, `${Math.round(phoneRate * 100)}% of rows have a valid number`);
  }

  // ── Behaviour over time ──────────────────────────────────────────────────
  if (input.priorVolume24h >= 50 && input.recentVolume24h > input.priorVolume24h * 4) {
    add('VOLUME_SPIKE', 22, `${input.priorVolume24h} → ${input.recentVolume24h} in 24h`);
  }
  if (input.optOutRate > 0.08) add('OPT_OUT_RATE_HIGH', 30, `${(input.optOutRate * 100).toFixed(1)}%`);
  else if (input.optOutRate > 0.03) add('OPT_OUT_RATE_ELEVATED', 12, `${(input.optOutRate * 100).toFixed(1)}%`);
  if (input.complaintCount >= 3) add('COMPLAINTS_REGISTERED', 35, `${input.complaintCount}`);
  else if (input.complaintCount >= 1) add('COMPLAINT_REGISTERED', 15, `${input.complaintCount}`);
  if (input.failureRate > 0.4) add('DELIVERY_FAILURE_RATE_HIGH', 20, `${(input.failureRate * 100).toFixed(0)}%`);

  // ── Reach ────────────────────────────────────────────────────────────────
  if (input.countries.length > 5) add('MANY_COUNTRIES', 14, `${input.countries.length} countries`);

  // ── Money ────────────────────────────────────────────────────────────────
  const remainingToday = Math.max(0, input.dailySpendCapUsd - input.spentTodayUsd);
  if (input.estimatedSpendUsd > remainingToday) {
    add('OVER_DAILY_SPEND_CAP', 25,
      `estimate $${input.estimatedSpendUsd.toFixed(2)}, $${remainingToday.toFixed(2)} left today`);
  }

  // ── The domain gate's own uncertainty ────────────────────────────────────
  if (input.domainVerdict === 'REVIEW') add('DOMAIN_NEEDS_REVIEW', 30);

  // ── Verdict ──────────────────────────────────────────────────────────────
  const level: RiskLevel =
    score >= 80 ? 'CRITICAL' :
    score >= 50 ? 'HIGH' :
    score >= 25 ? 'MEDIUM' : 'LOW';

  const decision: PolicyDecision =
    level === 'CRITICAL' ? 'BLOCK' :
    level === 'HIGH' ? 'REVIEW' :
    level === 'MEDIUM' ? 'THROTTLE' : 'ALLOW';

  const isCall = input.channel === 'AI_CALL';
  const baseThroughput = isCall ? limits.callsPerHour : limits.messagesPerHour;
  // THROTTLE is not a refusal. It is the same campaign at a quarter of the
  // pace, which gives the opt-out and complaint signals time to appear before
  // the whole list has been dialled.
  const throughputPerHour = decision === 'THROTTLE' ? Math.max(1, Math.floor(baseThroughput / 4)) : baseThroughput;

  const allowedRecipients =
    decision === 'BLOCK' ? 0 : Math.min(size, limits.maxRecipients);

  return { decision, level, score, signals, throughputPerHour, allowedRecipients };
}

function frozen(signals: RiskSignal[], code: string, detail: string): RiskResult {
  signals.push({ code, weight: 100, detail });
  return {
    decision: 'BLOCK', level: 'CRITICAL', score: 100, signals,
    throughputPerHour: 0, allowedRecipients: 0,
  };
}

/**
 * The triggers that pause a RUNNING campaign (§52). Evaluated by the dispatch
 * worker between batches, not only at launch — a campaign that looked fine at
 * recipient 1 can be doing damage by recipient 400.
 */
export interface KillSwitchInput {
  sent: number;
  failed: number;
  optOuts: number;
  complaints: number;
  spentUsd: number;
  campaignCapUsd: number | null;
  accountDailyRemainingUsd: number;
  providerHealthy: boolean;
  channelQualityDegraded: boolean;
}

export interface KillSwitchResult {
  pause: boolean;
  /** COMPLIANCE_PAUSED cannot be resumed by the customer; PAUSED can. */
  status: 'RUNNING' | 'PAUSED' | 'COMPLIANCE_PAUSED';
  reason?: string;
  code?: string;
}

export function evaluateKillSwitch(input: KillSwitchInput): KillSwitchResult {
  // Rates are only meaningful once there is something to divide by. Two
  // opt-outs from the first three sends is not a 67% opt-out rate, it is three
  // sends.
  const MIN_SAMPLE = 25;

  if (input.complaints >= 3) {
    return { pause: true, status: 'COMPLIANCE_PAUSED', code: 'COMPLAINT_THRESHOLD', reason: `${input.complaints} complaints` };
  }
  if (input.sent >= MIN_SAMPLE && input.optOuts / input.sent > 0.15) {
    return {
      pause: true, status: 'COMPLIANCE_PAUSED', code: 'OPT_OUT_SPIKE',
      reason: `${((input.optOuts / input.sent) * 100).toFixed(0)}% opted out`,
    };
  }
  if (input.channelQualityDegraded) {
    return { pause: true, status: 'COMPLIANCE_PAUSED', code: 'CHANNEL_QUALITY_DEGRADED', reason: 'the provider reports reduced quality on this number' };
  }
  if (input.sent >= MIN_SAMPLE && input.failed / input.sent > 0.5) {
    return { pause: true, status: 'COMPLIANCE_PAUSED', code: 'FAILURE_RATE', reason: `${((input.failed / input.sent) * 100).toFixed(0)}% failing` };
  }

  // Money and provider health are operational, not disciplinary: the customer
  // caused them and the customer may resume once they are fixed.
  if (input.campaignCapUsd !== null && input.spentUsd >= input.campaignCapUsd) {
    return { pause: true, status: 'PAUSED', code: 'CAMPAIGN_SPEND_CAP', reason: 'the campaign reached its spend limit' };
  }
  if (input.accountDailyRemainingUsd <= 0) {
    return { pause: true, status: 'PAUSED', code: 'DAILY_SPEND_CAP', reason: 'the daily spend limit for this account is used up' };
  }
  if (!input.providerHealthy) {
    return { pause: true, status: 'PAUSED', code: 'PROVIDER_UNAVAILABLE', reason: 'the provider is unavailable' };
  }

  return { pause: false, status: 'RUNNING' };
}
