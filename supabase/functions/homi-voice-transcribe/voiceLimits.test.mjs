// HOMI voice messages: free and unlimited in every plan (owner, 2026-10-29).
//
// Premise changed from 2026-10-25 (0.3 credits a minute, consent popup,
// reserve → settle → release): there is no price any more. What these tests
// pin now is what stays: the two minute cap, the size limits, an account, a
// per-user burst rate, and COGS recorded as unbilled usage, never as $0.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const {
  MAX_MESSAGE_SECONDS, MAX_SEGMENTS, MAX_SEGMENT_SECONDS, MAX_SEGMENT_BYTES, DEFAULT_VOICE_RATE_LIMITS,
  voiceRateLimitsFrom, voiceRateExceeded, measuredSeconds,
} = await import('./voiceLimits.ts');

const here = (p) => new URL(p, import.meta.url);
const src = readFileSync(here('./index.ts'), 'utf8');
const code = src.replace(/^\s*\/\/.*$/gm, '');

test('two minutes per message, two Google-sized segments, a size ceiling', () => {
  assert.equal(MAX_MESSAGE_SECONDS, 120);
  assert.equal(MAX_SEGMENTS * MAX_SEGMENT_SECONDS, 120, 'two segments make the two minute cap');
  assert.equal(MAX_SEGMENT_BYTES, 2 * 1024 * 1024);
  assert.match(code, /recordedSeconds > MAX_MESSAGE_SECONDS \+ 3/);
  assert.match(code, /segments\.length > MAX_SEGMENTS/);
  assert.match(code, /s\.size > MAX_SEGMENT_BYTES/);
});

test('the burst rate is an abuse safeguard far above a person talking', () => {
  assert.deepEqual(DEFAULT_VOICE_RATE_LIMITS, { perMinute: 6, perHour: 60 });
  assert.equal(voiceRateExceeded({ minute: 5, hour: 59 }), false);
  assert.equal(voiceRateExceeded({ minute: 6, hour: 6 }), true);
  assert.equal(voiceRateExceeded({ minute: 0, hour: 60 }), true);
  assert.deepEqual(voiceRateLimitsFrom({ perMinute: '10', perHour: -1 }), { perMinute: 10, perHour: 60 });
  assert.match(code, /RATE_LIMITED/);
  assert.match(code, /'homi_voice_per_minute'/);
});

test('Google’s billed duration wins; the recorded length only when Google was silent', () => {
  assert.deepEqual(measuredSeconds([58, 41], 100), { seconds: 99, source: 'PROVIDER' });
  assert.deepEqual(measuredSeconds([58, null], 100), { seconds: 100, source: 'RECORDED' });
  assert.deepEqual(measuredSeconds([], 12), { seconds: 12, source: 'RECORDED' });
  assert.deepEqual(measuredSeconds([90, 90], 120), { seconds: 120, source: 'PROVIDER' }, 'capped at the limit');
});

test('free: no reservation, no settlement, no consent, no balance', () => {
  for (const gone of [/beginExecution\(/, /settleExecution\(/, /releaseExecution\(/, /CONSENT_REQUIRED/, /INSUFFICIENT_CREDITS/,
    /homi_voice_consents/, /priceForSeconds|creditsPerMinute: pricing/]) {
    assert.doesNotMatch(code, gone, `voice is free: ${gone}`);
  }
  assert.match(code, /chargedCredits: 0/);
  // Old clients still get "go ahead" from status and consent.
  assert.match(code, /consented: true/);
  assert.match(code, /affordableSeconds: null/);
});

test('COGS is still recorded, as unbilled usage, and never as an assumed zero', () => {
  assert.match(code, /recordUnbilledUsage\(/);
  assert.match(code, /const PRODUCT = 'HOMI_VOICE_MESSAGE'/);
  assert.match(code, /estimatedProviderCost\(/, 'COGS from the price book');
  assert.match(code, /'UNPRICED'/, 'a missing rate is UNPRICED');
  assert.match(code, /recordCogs\('FAILED'/, 'a failed message Google billed is still recorded');
  assert.match(code, /recordCogs\('NO_SPEECH'\)/);
  assert.doesNotMatch(src, /console\.(log|error)\([^)]*transcript/, 'the transcript is never logged');
  assert.match(src, /Authorization: `Bearer \$\{token\}`/, 'worker reached with WORKER_TOKEN only');
});

test('an account is required; anonymous callers are refused', () => {
  assert.match(code, /\(user as any\)\.is_anonymous\) return json\(\{ error: 'sign in required', code: 'UNAUTHORIZED' \}, 401\)/);
  assert.match(code, /serviceBackendEnabled\(sb, 'ai_assistant'\)/);
});

test('the original migration is history; the cost round retires the price and keeps the rows', () => {
  const original = readFileSync(here('../../migrations/20261204105000_homi_voice_messages.sql'), 'utf8');
  assert.match(original, /'HOMI_VOICE_MESSAGE'/);
  assert.match(original, /create table if not exists public\.homi_voice_consents/);
  const sql = readFileSync(here('../../migrations/20261207130000_homi_unlimited_cost_round.sql'), 'utf8');
  assert.match(sql, /set pricing_active = false/);
  assert.match(sql, /where code = 'HOMI_VOICE_MESSAGE'/);
  assert.match(sql, /'FREE_UNLIMITED'/);
  assert.doesNotMatch(sql, /\bdelete\b|\bdrop\b|\btruncate\b/i, 'history is kept');
  assert.doesNotMatch(sql, /set enabled = false|kill_switch = true/, 'voice stays switchable, not switched off');
});

test('CI deploys the function with the gateway JWT check on', () => {
  const wf = readFileSync(here('../../../.github/workflows/deploy.yml'), 'utf8').replace(/\r\n/g, '\n');
  const jwt = wf.match(/^ *JWT_FUNCTIONS=\(\n([\s\S]*?)\n\s*\)\n/m)?.[1] ?? '';
  assert.match(jwt, /^\s*"homi-voice-transcribe"\s*$/m);
});
