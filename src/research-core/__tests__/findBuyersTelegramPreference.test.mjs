// FIND BUYERS — paid Telegram first, free reader as fallback (owner preference
// 2026-10-04), behind admin_settings.find_buyers_telegram_preference. Default
// NATIVE_FIRST keeps today's behaviour; PAID_FIRST plans the memo23 Telegram
// Actor on known channels and the free reader is skipped only when paid jobs
// were actually queued. Never without a channel seed; community discovery stays.
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseTelegramPreference, planPaidTelegram, withoutNativeTelegramReader } from '../findBuyers/telegramPreference.ts';
import { initialSocialJobs } from '../findBuyers/campaignPlan.ts';
import { buildPropertyDna } from '../findBuyers/propertyDna.ts';
import { buildQueryPlan } from '../findBuyers/queryPlanner.ts';

const dna = buildPropertyDna({ transactionType: 'SALE', propertyType: 'APARTMENT', countryCode: 'GE', city: 'Tbilisi', district: 'Krtsanisi', totalPrice: 180000, currency: 'USD', area: 95, rooms: 3, bedrooms: 2 });
const plan = buildQueryPlan(dna);
const channel = (i) => ({ id: `t${i}`, platform: 'TELEGRAM', url: `https://t.me/tbilisi_flats_${i}`, languages: ['ru'], city: 'Tbilisi', lastCheckedAt: null, historicalYield: i / 10 });
const actors = { TELEGRAM_CHANNEL: { probeSize: 30, priority: 30 } };
const paid = (opts) => initialSocialJobs({ dna, plan, knownSources: opts.sources ?? [], enabledActors: opts.actors ?? actors, nativeTelegramActive: opts.native ?? true, telegramPreference: opts.pref }).filter((j) => j.stage === 'TELEGRAM_CHANNEL');

test('the preference defaults to NATIVE_FIRST; only an explicit PAID_FIRST switches it', () => {
  for (const v of [undefined, null, '', 'native_first', 'paid', 42, 'PAID_FIRSTX']) assert.equal(parseTelegramPreference(v), 'NATIVE_FIRST', String(v));
  for (const v of ['PAID_FIRST', 'paid_first', '"PAID_FIRST"', ' PAID_FIRST ']) assert.equal(parseTelegramPreference(v), 'PAID_FIRST', String(v));
});

test('NATIVE_FIRST keeps today: paid Telegram only when the free reader is not collecting', () => {
  assert.equal(planPaidTelegram('NATIVE_FIRST', true), false);
  assert.equal(planPaidTelegram('NATIVE_FIRST', false), true);
  assert.equal(paid({ sources: [channel(1)], native: true }).length, 0);
  assert.equal(paid({ sources: [channel(1)], native: false }).length, 1);
});

test('PAID_FIRST plans the memo23 Telegram Actor on known channels even while the free reader is on', () => {
  const sources = [1, 2, 3, 4, 5, 6, 7, 8].map(channel);
  const jobs = paid({ sources, pref: 'PAID_FIRST', native: true });
  assert.equal(jobs.length, 6, 'up to MAX_KNOWN_PER_FAMILY channels, highest yield first');
  assert.ok(jobs.every((j) => j.targetUrl?.startsWith('https://t.me/') && j.actorKey === 'TELEGRAM_CHANNEL'));
  assert.equal(jobs[0].targetUrl, 'https://t.me/tbilisi_flats_8');
});

test('PAID_FIRST never invents a seed and never runs a disabled/unpriced Actor (free reader stays the fallback)', () => {
  assert.equal(paid({ sources: [], pref: 'PAID_FIRST' }).length, 0, 'no channel seed → no paid job');
  assert.equal(paid({ sources: [channel(1)], pref: 'PAID_FIRST', actors: {} }).length, 0, 'Actor not enabled/priced → no paid job');
});

test('skipping the free reader keeps community discovery and every other native source', () => {
  const nativePlan = { tranches: [{ tranche: 1, providers: ['TELEGRAM', 'FORUM', 'PORTAL'] }, { tranche: 2, providers: ['TELEGRAM_SOURCES'] }], other: 'kept' };
  const out = withoutNativeTelegramReader(nativePlan);
  assert.deepEqual(out.tranches.map((t) => t.providers), [['FORUM', 'PORTAL'], ['TELEGRAM_SOURCES']]);
  assert.equal(out.other, 'kept');
  assert.deepEqual(nativePlan.tranches[0].providers, ['TELEGRAM', 'FORUM', 'PORTAL'], 'the original plan is not mutated');
});
