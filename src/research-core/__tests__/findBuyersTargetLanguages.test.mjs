// FIND BUYERS — the owner chooses the audience languages at launch
// (owner request 2026-10-08: "maybe only Georgian-speaking clients, or only
// Arabic, and the budget directed there"). Default: all six. An explicit
// choice narrows every paid social search AND the community discovery.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { initialSocialJobs, restrictToLanguages } from '../findBuyers/campaignPlan.ts';
import { buildPropertyDna } from '../findBuyers/propertyDna.ts';
import { buildQueryPlan } from '../findBuyers/queryPlanner.ts';
import { campaignSourceQueries } from '../discovery/sourceNetwork.ts';
import { compileDemandPlan, plannedSourceJobs } from '../discovery/discovery-plan.ts';

const dna = buildPropertyDna({ transactionType: 'SALE', propertyType: 'APARTMENT', countryCode: 'GE', city: 'Tbilisi', district: 'Krtsanisi', totalPrice: 180000, currency: 'USD', area: 95, rooms: 3, bedrooms: 2 });
const plan = buildQueryPlan(dna);
const actors = Object.fromEntries(['FB_GROUP_SEARCH', 'TIKTOK', 'LINKEDIN_POSTS', 'BLUESKY', 'FB_GROUP_POSTS'].map((k) => [k, { probeSize: 10, priority: 50 }]));
const group = (id, languages) => ({ id, platform: 'FACEBOOK', url: `https://www.facebook.com/groups/${id}`, languages, city: 'Tbilisi', lastCheckedAt: null, historicalYield: null });
const jobsFor = (targetLanguages) => initialSocialJobs({ dna, plan, knownSources: [group('ka1', ['ka']), group('ru1', ['ru']), group('any', [])], enabledActors: actors, nativeTelegramActive: true, targetLanguages });

test('no choice: every language the planner covers is searched (unchanged)', () => {
  const all = jobsFor(null);
  const langs = new Set(all.filter((j) => !j.sourceId).map((j) => j.language));
  assert.ok(langs.size >= 4, `several languages: ${[...langs]}`);
  assert.deepEqual(jobsFor([]).length, all.length);
});

test('only Georgian: every search is Georgian; a Russian group is not read; a group with no recorded language stays', () => {
  const ka = jobsFor(['ka']);
  assert.ok(ka.length > 0);
  assert.ok(ka.filter((j) => !j.sourceId).every((j) => j.language === 'ka' || j.language === 'multi'), JSON.stringify(ka.map((j) => j.language)));
  const groups = ka.filter((j) => j.sourceId).map((j) => j.sourceId);
  assert.ok(groups.includes('ka1') && groups.includes('any') && !groups.includes('ru1'));
  assert.ok(ka.length < jobsFor(null).length, 'the budget is not spread over other audiences');
});

test('only Arabic: Arabic searches only', () => {
  const ar = jobsFor(['ar']).filter((j) => !j.sourceId);
  assert.ok(ar.length > 0 && ar.every((j) => j.language === 'ar' || j.language === 'multi'));
});

test('restrictToLanguages is case-insensitive and a pass-through without a choice', () => {
  const jobs = [{ language: 'KA' }, { language: 'ru' }, { language: 'multi' }];
  assert.deepEqual(restrictToLanguages(jobs, ['ka']).map((j) => j.language), ['KA', 'multi']);
  assert.equal(restrictToLanguages(jobs, null).length, 3);
});

test('community discovery follows the same choice', () => {
  const q = campaignSourceQueries({ city: 'Tbilisi', transaction: 'SALE', languages: ['ar', 'ka'] });
  assert.deepEqual([...new Set(q.map((x) => x.language))].sort(), ['ar', 'ka']);
  const p = compileDemandPlan({ market: 'GE', languages: ['ar'], property: { transactionType: 'SALE', propertyType: 'APARTMENT', city: 'Tbilisi', district: null, price: null, currency: null, bedrooms: null, areaSqm: null },
    switches: { telegram: true, forum: false, portals: false, livePortalAdapters: [] }, limits: { maxCredits: 100, deadlineMinutes: 30, targetResults: 3, activeDemandMaxDays: 30 }, targetLanguages: ['ar'] });
  const d = plannedSourceJobs(p, 'r').find((j) => j.provider === 'TELEGRAM_SOURCES');
  assert.deepEqual([...new Set(d.metadata.queryLanguages)], ['ar']);
});

test('wiring: an EXPLICIT launch choice reaches the social planner and the discovery plan; the launch panel sends it', () => {
  const mc = readFileSync(new URL('../../../supabase/functions/match-campaign/index.ts', import.meta.url), 'utf8');
  assert.match(mc, /const explicitLanguages[^=]*= languages\.selection\.mode === 'EXPLICIT'/);
  assert.equal((mc.match(/targetLanguages: explicitLanguages/g) ?? []).length, 2, 'social planner + discovery plan');
  const camp = readFileSync(new URL('../../../supabase/functions/_shared/findBuyers/campaign.ts', import.meta.url), 'utf8');
  assert.match(camp, /targetLanguages: input\.targetLanguages \?\? null/);
  const panel = readFileSync(new URL('../../../src/components/campaign/CampaignLaunchPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /fbAll \? \{ mode: 'ALL', selected: \[\] \} : \{ mode: 'EXPLICIT', selected: \[\.\.\.fbLanguages\] \}/);
  assert.match(panel, /cur\.length > 1 \?/, 'the last language cannot be removed');
});
