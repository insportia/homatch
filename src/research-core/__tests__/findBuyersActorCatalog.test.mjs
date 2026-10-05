// FIND BUYERS — the Actor catalog: every registered memo23 Actor has exactly
// one class grounded in how the campaign plan uses it; lifecycle never says
// PROVEN without a real run (output contract); the proof bound never exceeds
// the provider budget or the customer reservation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ACTOR_PROFILES, classifyActor, actorLifecycle, runEstimateMicros, proofPlan } from '../findBuyers/actorCatalog.ts';
import { STAGE_ACTOR } from '../findBuyers/actorInputs.ts';

const seed = readFileSync(new URL('../../../supabase/migrations/20261014100000_find_buyers_social_intelligence.sql', import.meta.url), 'utf8');
const registered = [...seed.matchAll(/\('([A-Z_]+)', 'memo23~/g)].map((m) => m[1]);

test('all 16 registered Actors are classified, and nothing else is', () => {
  assert.equal(registered.length, 16);
  assert.deepEqual([...registered].sort(), Object.keys(ACTOR_PROFILES).sort());
  for (const k of registered) assert.ok(['PRIMARY_DISCOVERY', 'ENRICHMENT', 'UNSUITABLE'].includes(classifyActor(k).cls), k);
  assert.equal(classifyActor('NOPE').cls, 'UNSUITABLE');
});

test('every Actor the plan can stage is in the catalog; seeded Actors name a real seeder', () => {
  for (const k of new Set(Object.values(STAGE_ACTOR))) assert.ok(ACTOR_PROFILES[k], k);
  for (const [k, p] of Object.entries(ACTOR_PROFILES)) {
    if (p.seededBy) assert.ok(ACTOR_PROFILES[p.seededBy], `${k} seeded by unknown ${p.seededBy}`);
    if (p.cls === 'PRIMARY_DISCOVERY' && p.needsSeed) assert.ok(p.seededBy, `${k}: a primary Actor needing a seed must get it inside the plan`);
  }
});

test('group discovery that yields no post text is never primary on its own; native Telegram duplicate is unsuitable', () => {
  assert.equal(classifyActor('LINKEDIN_GROUPS').cls, 'ENRICHMENT');
  assert.equal(classifyActor('TELEGRAM_CHANNEL').cls, 'UNSUITABLE');
  for (const k of ['FB_COMMENTS', 'IG_COMMENTS', 'YOUTUBE_COMMENTS']) assert.equal(classifyActor(k).cls, 'ENRICHMENT');
});

test('lifecycle: metadata verifies, only a real run proves, enabling a proven Actor activates it', () => {
  const base = { enabled: false, health: 'UNKNOWN', pricing_model: 'PAY_PER_RESULT', price_per_1k_micros: 500000 };
  assert.equal(actorLifecycle({ ...base, pricing_model: 'UNKNOWN' }), 'REGISTERED');
  assert.equal(actorLifecycle({ ...base, enabled: true }), 'REGISTERED', 'enabling an unverified Actor proves nothing');
  const verified = { ...base, pricing_verified_at: '2026-10-04', input_contract_verified_at: '2026-10-04' };
  assert.equal(actorLifecycle(verified), 'VERIFIED');
  assert.equal(actorLifecycle({ ...verified, health: 'HEALTHY' }), 'VERIFIED', 'a health flag is not a run');
  assert.equal(actorLifecycle({ ...verified, output_contract_verified_at: '2026-10-04' }), 'PROVEN');
  assert.equal(actorLifecycle({ ...verified, output_contract_verified_at: '2026-10-04', enabled: true }), 'ACTIVE');
  assert.equal(actorLifecycle({ ...verified, emergency_disabled: true }), 'DISABLED');
  assert.equal(actorLifecycle({ ...verified, health: 'FAILED' }), 'BLOCKED');
});

test('run estimate uses the reserve formula; unknown price is never zero', () => {
  assert.equal(runEstimateMicros({ start_fee_micros: 0, price_per_1k_micros: 500000 }, 20), 10000);
  assert.equal(runEstimateMicros({ start_fee_micros: 5000, price_per_1k_micros: 800000 }, 3), 7400);
  assert.equal(runEstimateMicros({ price_per_1k_micros: null }, 20), null);
});

test('proof bound: provider exposure ≤ min(caps, budget); customer charge ≤ reservation; unpriced is reported, not zeroed', () => {
  const a = (k, price) => ({ actor_key: k, enabled: false, price_per_1k_micros: price, start_fee_micros: 0, probe_size: 20, max_results: 100, campaign_spend_cap_micros: 2000000 });
  const p = proofPlan([a('FB_GROUP_SEARCH', 3000000), a('FB_GROUP_POSTS', 2000000), a('TIKTOK', 5000000)], { credits: 100, creditsPerUsd: 10, providerShareBps: 5000 });
  assert.equal(p.estimatedProviderMicros, 60000 + 40000 + 100000);
  assert.equal(p.maxProviderMicros, 5000000);
  assert.equal(p.customerReservationCredits, 100);
  assert.equal(p.maxCustomerChargeCredits, 100);
  const u = proofPlan([a('TIKTOK', null)], { credits: 100, creditsPerUsd: 10, providerShareBps: 5000 });
  assert.equal(u.estimatedProviderMicros, null);
  assert.deepEqual(u.unpriced, ['TIKTOK']);
  assert.equal(u.maxProviderMicros, 2000000);
});

test('output contract: proven only by real text at a real https URL; empty or URL-less datasets prove nothing', async () => {
  const { provesOutputContract } = await import('../findBuyers/actorCatalog.ts');
  assert.equal(provesOutputContract([]), false);
  assert.equal(provesOutputContract([{ text: 'ვეძებ ბინას ვაკეში', url: null }]), false);
  assert.equal(provesOutputContract([{ text: '', url: 'https://www.facebook.com/groups/1/posts/2' }]), false);
  assert.equal(provesOutputContract([{ text: 'looking to rent', url: 'javascript:alert(1)' }]), false);
  assert.equal(provesOutputContract([{ text: 'ищу квартиру', url: 'https://www.facebook.com/groups/1/posts/2' }]), true);
});
