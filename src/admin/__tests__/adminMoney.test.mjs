// Admin money formatting: USD as USD, credits with their unit at 10 credits = $1,
// cost per model turn over PRICED turns only, and unknown never read as zero.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CREDITS_PER_USD, toNumber, formatUsd, centsToUsd, creditsToUsd, creditNumber, formatCredits,
  costPerModelTurnUsd, costPerConversationUsd, marginState,
} from '../money.ts';

const CR = String.fromCharCode(13);
const read = (p) => readFileSync(p, 'utf8').split(CR).join('');

test('10 credits = $1', () => {
  assert.equal(CREDITS_PER_USD, 10);
  assert.equal(creditsToUsd(150), 15);
  assert.equal(creditsToUsd('25'), 2.5);
  assert.equal(creditsToUsd(null), null);
  assert.equal(creditsToUsd(10, 0), null);
});

test('unknown is null, not zero', () => {
  for (const v of [null, undefined, '', 'abc', Number.NaN]) assert.equal(toNumber(v), null);
  assert.equal(toNumber(0), 0);
  assert.equal(toNumber('0'), 0);
  assert.equal(formatUsd(null), '—');
  assert.equal(formatCredits(undefined, (n) => `${n} credits`), '—');
});

test('USD formatting', () => {
  assert.equal(formatUsd(1234.5), '$1,234.50');
  assert.equal(formatUsd(0), '$0.00');
  assert.equal(formatUsd(0.01234), '$0.0123');
  assert.equal(formatUsd(-2), '-$2.00');
  assert.equal(formatUsd('3'), '$3.00');
  assert.equal(formatUsd(centsToUsd(1.5)), '$0.0150');
  assert.equal(centsToUsd(250), 2.5);
});

test('credit amounts carry their unit', () => {
  assert.equal(creditNumber(1234.567), '1,234.57');
  assert.equal(formatCredits(30, (n) => `${n} credits`), '30 credits');
  assert.equal(formatCredits(0, (n) => `${n} credits`), '0 credits');
});

test('cost per model turn divides by priced model turns, not all turns', () => {
  // 100 requests, 40 model turns of which 25 priced, $5 priced cost.
  const totals = { cost_usd: 5, requests: 100, model_turns: 40, priced_model_turns: 25 };
  assert.equal(costPerModelTurnUsd(totals), 0.2);
  // The server's own figure wins when present.
  assert.equal(costPerModelTurnUsd({ ...totals, cost_per_model_turn_usd: 0.19 }), 0.19);
  // No priced turn: unknown, not $0.
  assert.equal(costPerModelTurnUsd({ cost_usd: 0, priced_model_turns: 0, cost_per_model_turn_usd: null }), null);
  assert.equal(costPerModelTurnUsd(null), null);
});

test('cost per conversation', () => {
  assert.equal(costPerConversationUsd({ cost_usd: 6, conversations: 3 }), 2);
  assert.equal(costPerConversationUsd({ cost_usd: 6, conversations: 0 }), null);
  assert.equal(costPerConversationUsd({ cost_per_conversation_usd: '0.5' }), 0.5);
});

test('margin: null is an explicit unknown, a number is known', () => {
  assert.deepEqual(marginState(null), { kind: 'unknown' });
  assert.deepEqual(marginState(undefined), { kind: 'unknown' });
  assert.deepEqual(marginState(0), { kind: 'known', pct: 0, text: '0.0%' });
  assert.deepEqual(marginState('62.25'), { kind: 'known', pct: 62.25, text: '62.3%' });
});

test('the HOMI admin page uses the telemetry fields and never divides by all turns', () => {
  const page = read('src/pages/admin/AdminHomiServicesPage.tsx');
  assert.ok(!/cost_usd\)\s*\/\s*Number\(tot\.model_turns\)/.test(page), 'cost per turn must not divide by model_turns');
  assert.match(page, /costPerModelTurnUsd\(tot\)/);
  for (const f of ['priced_model_turns', 'cancelled_turns', 'conversations', 'avg_model_latency_ms', 'p95_model_latency_ms', 'avg_ttft_ms']) {
    assert.ok(page.includes(f), `page reads ${f}`);
  }
  assert.match(page, /error_code !== 'CANCELLED'/, 'cancelled turns are not listed as errors');
  assert.match(page, /MarginTile label=\{t\('admin_hs_ct_margin20'\)\}/);
});

test('Admin metrics: credits are not drawn as dollars and an unknown margin is not 0%', () => {
  const page = read('src/pages/admin/AdminOverviewPage.tsx');
  assert.ok(!/fmtUsd\(stats\?\.credits_/.test(page), 'credit totals must not be formatted as USD');
  assert.ok(!/\(n \?\? 0\)\.toFixed\(1\)/.test(page), 'a null percentage must not become 0.0%');
  const api = read('src/services/api.ts');
  assert.match(api, /const revenue = revenueCredits \/ 10;/);
  assert.match(api, /gross_margin_pct: revenue > 0 && revenueComplete && cogsComplete \?/);
});

test('the Languages coverage waits for the admin and feature halves before counting', () => {
  const page = read('src/pages/admin/AdminHomiServicesPage.tsx');
  const section = page.slice(page.indexOf('function LanguagesSection'));
  const waits = section.indexOf('Promise.all([loadAdminStrings(), loadFeatureStrings()])');
  const counts = section.indexOf('Object.keys(english)');
  assert.ok(waits > 0, 'awaits loadAdminStrings() and loadFeatureStrings()');
  assert.ok(counts > waits, 'counts keys only after both halves are merged');
});
