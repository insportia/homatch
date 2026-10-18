// Find Property paid social OFFER campaign: OFF by default, confirmed before any
// reservation, memo23 only through the one client, portals never paid.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const RUN = read('supabase/functions/find-property-run/index.ts');
const OFFERS = read('supabase/functions/_shared/findProperty/socialOffers.ts');
const SQL = read('supabase/migrations/20261107095700_find_property_social_offers.sql');
const SETTLE = read('supabase/functions/_shared/discoveryRun.ts');
const DRIVER = read('supabase/functions/discovery-queue-worker/driver.ts');
const CLAUDE = read('CLAUDE.md');

test('switch OFF by default; APIFY switch and the product switch both enforced in SQL', () => {
  assert.match(SQL, /\('find_property_social_enabled', 'false'::jsonb\)/);
  assert.match(SQL, /'SOCIAL_DISABLED'/);
  assert.match(SQL, /'APIFY_DISABLED_BY_ADMIN'/);
  assert.match(SQL, /if v_committed \+ v_estimate > v_run\.provider_budget_micros then/);
});

test('no reservation without the exact confirmed price; $5 minimum from the policy', () => {
  const confirm = RUN.indexOf("confirm.acceptedTerms !== true || Number(confirm.priceCredits) !== budget");
  const reserve = RUN.indexOf('grant = await beginExecution(');
  assert.ok(confirm > 0 && reserve > confirm, 'confirmation precedes the reservation');
  assert.match(RUN, /Math\.max\(minimumCampaignCredits\(rate\), settings\.campaignMinCredits\)/);
  assert.match(RUN, /if \(action === 'preview'\) return json\(\{ success: true, preview \}\);/);
  assert.doesNotMatch(RUN, /compileSupplyPlan|livePortalAdapters/, 'portals are never part of a paid campaign');
});

test('memo23 only through the one client; capped at the reservation', () => {
  assert.match(OFFERS, /from '\.\.\/findBuyers\/memo23Client\.ts'/);
  assert.doesNotMatch(OFFERS, /api\.apify\.com|fetch\(/);
  assert.match(OFFERS, /maxTotalChargeUsd: Number\(reservation\.reservedMicros\) \/ 1_000_000/);
  assert.match(DRIVER, /job\.metadata\?\.offerCampaign === true && job\.discovery_run_id \? await executeOfferJob/);
});

test('settlement: open runs finished first, consumed ÷ 0.63, failure releases in full', () => {
  assert.match(SETTLE, /if \(socialCampaign\) spendMicros = await finishOfferCampaign\(db, run\.id\);/);
  assert.match(SETTLE, /settlePaidSocialRun\(db, grant/);
  assert.match(SETTLE, /await finishOfferCampaign\(db, runId\)\.catch\(\(\) => undefined\);\n  if \(grant\) await releaseExecution/);
  assert.doesNotMatch(SETTLE, /\}, releaseExecution\)/, 'release is called with the db, not with shifted arguments');
});

test('the third Apify scope is recorded in CLAUDE.md', () => {
  assert.match(CLAUDE, /Third scope \(owner, 2026-10-16; TikTok and batched runs 2026-10-18\): Find\s+Property's paid social OFFER campaign/);
  assert.match(CLAUDE, /Facebook \/ Instagram \/ Telegram \/\s+TikTok \/ VK posts/);
});

test('batched runs (20261114090000): the replacement reservation keeps every money check and reserves exactly its estimate', () => {
  const B = read('supabase/migrations/20261114090000_find_property_batched_offer_runs.sql');
  for (const guard of ["'SOCIAL_DISABLED'", "'APIFY_DISABLED_BY_ADMIN'", "'PRICING_NOT_VERIFIED'", "'ACTOR_BUSY'", "'GLOBAL_BUSY'",
    "'ACTOR_CAMPAIGN_CAP'", "'ACTOR_DAILY_CAP'", "'NOT_A_SOCIAL_CAMPAIGN'"]) assert.ok(B.includes(guard), `missing ${guard}`);
  assert.match(B, /if v_committed \+ v_estimate > v_run\.provider_budget_micros then/);
  assert.match(B, /v_limit := greatest\(1, least\(coalesce\(p_requested_limit, v_a\.probe_size\), v_a\.max_results \* v_targets, 1000\)\);/);
  assert.match(B, /v_targets := greatest\(1, least\(coalesce\(p_target_count, 1\), 25\)\);/);
  assert.match(B, /values \(p_idempotency_key, p_run_id, p_queue_job_id, v_a\.actor_key, v_a\.actor_id, p_stage, p_network, p_source_id, v_limit, 'RESERVED', v_estimate\)/);
  assert.match(B, /grant execute on function public\.find_property_reserve_actor_run\(uuid, text, text, uuid, text, text, uuid, integer, integer\) to service_role;/);
  assert.match(OFFERS, /p_target_count: Math\.max\(1, Number\(meta\.targetCount\) \|\| 1\)/);
  assert.match(OFFERS, /maxTotalChargeUsd: Number\(reservation\.reservedMicros\) \/ 1_000_000/, 'Apify caps the run at its reservation');
});
