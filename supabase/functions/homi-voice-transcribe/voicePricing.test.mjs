// HOMI voice messages: the owner's price (2026-10-25) as arithmetic, and the
// money path of the edge function as source facts.
//
//   0.3 credits per minute ($0.03), billed per started 10 seconds = 0.05,
//   two minutes at most, reserve → settle → release, COGS never silently 0.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const {
  DEFAULT_VOICE_PRICING, voicePricingFrom, billableSeconds, priceForSeconds, minimumCredits,
  affordableSeconds, chargedSeconds, MAX_SEGMENTS, MAX_SEGMENT_SECONDS,
} = await import('./voicePricing.ts');

const here = (p) => new URL(p, import.meta.url);

test('the owner price: 0.3 credits a minute, per started 10 seconds', () => {
  assert.deepEqual(DEFAULT_VOICE_PRICING, { creditsPerMinute: 0.3, incrementSeconds: 10, maxSeconds: 120 });
  const cases = [[0, 0], [0.4, 0.05], [1, 0.05], [10, 0.05], [10.2, 0.1], [11, 0.1], [31, 0.2], [59.9, 0.3], [60, 0.3], [61, 0.35], [119, 0.6], [120, 0.6]];
  for (const [s, credits] of cases) assert.equal(priceForSeconds(s), credits, `${s}s → ${credits}`);
  assert.equal(minimumCredits(), 0.05);
  assert.equal(billableSeconds(31), 40);
});

test('never more than two minutes is charged, whatever arrives', () => {
  assert.equal(priceForSeconds(500), 0.6);
  assert.equal(billableSeconds(121), 120);
  assert.equal(priceForSeconds(-5), 0);
  assert.equal(priceForSeconds(Number.NaN), 0);
  assert.equal(MAX_SEGMENTS * MAX_SEGMENT_SECONDS, 120, 'two Google-sized segments make the two minute cap');
});

test('the price is read from the product row, with the owner defaults as fallback', () => {
  assert.deepEqual(voicePricingFrom({ price_credits_per_minute: 0.6, billing_increment_seconds: 5, max_message_seconds: 90 }),
    { creditsPerMinute: 0.6, incrementSeconds: 5, maxSeconds: 90 });
  assert.deepEqual(voicePricingFrom(null), DEFAULT_VOICE_PRICING);
  assert.deepEqual(voicePricingFrom({ price_credits_per_minute: 'x', billing_increment_seconds: -1 }), DEFAULT_VOICE_PRICING);
});

test('what a balance can pay for, in whole steps, capped at two minutes', () => {
  assert.equal(affordableSeconds(0), 0);
  assert.equal(affordableSeconds(0.04), 0, 'below one step cannot record');
  assert.equal(affordableSeconds(0.05), 10);
  assert.equal(affordableSeconds(0.3), 60);
  assert.equal(affordableSeconds(0.34), 60);
  assert.equal(affordableSeconds(25), 120);
  assert.equal(affordableSeconds(Number.NaN), 0);
});

test('Google’s billed duration wins; the recorded length only when Google was silent', () => {
  assert.deepEqual(chargedSeconds([58, 41], 100), { seconds: 99, source: 'PROVIDER' });
  assert.deepEqual(chargedSeconds([58, null], 100), { seconds: 100, source: 'RECORDED' });
  assert.deepEqual(chargedSeconds([], 12), { seconds: 12, source: 'RECORDED' });
  assert.deepEqual(chargedSeconds([90, 90], 120), { seconds: 120, source: 'PROVIDER' }, 'capped at the limit');
});

test('the edge function follows reserve → settle → release and never books unknown COGS as zero', () => {
  const src = readFileSync(here('./index.ts'), 'utf8');
  assert.match(src, /beginExecution\(/);
  assert.match(src, /settleExecution\(/);
  assert.match(src, /releaseExecution\(/);
  assert.match(src, /productCode: PRODUCT/);
  assert.match(src, /const PRODUCT = 'HOMI_VOICE_MESSAGE'/);
  assert.match(src, /allowIncluded: false/, 'PAYG only: never a plan allowance');
  assert.match(src, /priceCredits,/, 'settles the fixed per-minute price');
  assert.match(src, /estimatedProviderCost\(/, 'COGS from the price book');
  assert.match(src, /'UNPRICED'/, 'a missing rate is UNPRICED');
  assert.match(src, /CONSENT_REQUIRED/, 'no transcription without the one time consent');
  assert.match(src, /INSUFFICIENT_CREDITS/);
  assert.match(src, /HOMI_VOICE_NO_SPEECH/, 'a message with no words costs nothing');
  assert.doesNotMatch(src, /console\.(log|error)\([^)]*transcript/, 'the transcript is never logged');
  assert.match(src, /Authorization: `Bearer \$\{token\}`/, 'worker reached with WORKER_TOKEN only');
});

test('the migration registers the product, the finance service and owner-only consent', () => {
  const sql = readFileSync(here('../../migrations/20261204105000_homi_voice_messages.sql'), 'utf8');
  assert.match(sql, /'HOMI_VOICE_MESSAGE'/);
  assert.match(sql, /'price_credits_per_minute', 0\.3/);
  assert.match(sql, /'billing_increment_seconds', 10/);
  assert.match(sql, /'max_message_seconds', 120/);
  assert.match(sql, /'homi_voice'/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /using \(user_id = auth\.uid\(\)\)/);
  assert.doesNotMatch(sql, /for insert to authenticated|for update to authenticated/, 'the browser never writes consent or its price');
});

test('CI deploys the function with the gateway JWT check on', () => {
  const wf = readFileSync(here('../../../.github/workflows/deploy.yml'), 'utf8').replace(/\r\n/g, '\n');
  const jwt = wf.match(/^ *JWT_FUNCTIONS=\(\n([\s\S]*?)\n\s*\)\n/m)?.[1] ?? '';
  assert.match(jwt, /^\s*"homi-voice-transcribe"\s*$/m);
});
