// Live status on the campaign page: quiet motion only on the current step,
// Meta's stored state only, the real sync schedule, and no invented numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../../../../${p}`, import.meta.url), 'utf8');
const card = read('src/components/metaAds/campaign/LiveStatusCard.tsx');
const page = read('src/pages/outreach/MetaAdsCampaignPage.tsx');

test('the next check is the real */15 schedule, as a clock time', () => {
  // Same arithmetic as nextScheduledSync, kept honest against the cron.
  assert.match(card, /export const SYNC_EVERY_MINUTES = 15;/);
  assert.match(card, /Math\.floor\(nowMs \/ step\) \* step \+ step/);
  const cron = read('supabase/migrations/20260930120000_meta_ads_live_readiness.sql') + read('supabase/migrations/20261001120000_workstream_b_final_hardening.sql');
  assert.match(cron, /homatch-meta-ads-maintenance[\s\S]{0,200}\*\/15 \* \* \* \*/, 'the schedule the card describes');
  assert.doesNotMatch(card, /setInterval\([^)]*,\s*1000\)/, 'no second-by-second countdown');
});

test('motion: pulse while reviewing/delivering, still when paused, none when completed; reduced motion respected', () => {
  assert.match(card, /if \(LIVE\.includes\(status\)\) return 'pulse';/);
  assert.match(card, /if \(status === 'PAUSED'\) return 'still';/);
  assert.match(card, /const LIVE = \['SUBMITTED', 'META_REVIEW', 'ACTIVE'\];/, 'COMPLETED is not live');
  for (const cls of card.match(/animate-\[?[a-z-]+/g) ?? []) {
    assert.ok(card.includes(`motion-safe:${cls}`), `${cls} is motion-safe only`);
  }
  assert.match(page, /motion-safe:animate-\[mm-activate_1\.4s_ease-out_1\]/, 'a one-time ring on turning ACTIVE');
  assert.match(page, /status === 'ACTIVE' && seen\.current !== 'ACTIVE'/);
  // Paused is dormant, not an error.
  assert.match(page, /const failed = \['REJECTED', 'FAILED', 'ARCHIVED'\]\.includes\(status\);/);
  assert.match(read('src/index.css'), /@keyframes mm-indeterminate[\s\S]*@keyframes mm-activate/);
});

test('only real data: waiting instead of zeros; status comes from the backend, refreshed quietly', () => {
  assert.match(card, /const delivered = !!life && \(life\.impressions > 0 \|\| life\.spendMinor > 0\);/);
  assert.match(card, /\) : \(\s*<p className="[^"]*" data-mm-live-waiting="">\{t\('mm_c_live_waiting'\)\}<\/p>/);
  assert.match(card, /c\.requested_start_at \? \[\[t\('mm_c_live_requested_start'\)/, 'rows only when present');
  assert.match(card, /c\.meta_start_time \? \[\[t\('mm_c_live_meta_start'\)/);
  // Polling re-reads the backend; nothing sets a status locally.
  assert.match(page, /window\.setInterval\(tick, 60_000\)/);
  assert.match(page, /document\.visibilityState === 'visible'\) void load\(true\)/);
  assert.doesNotMatch(page + card, /status: 'ACTIVE'|setStatus\(/);
});
