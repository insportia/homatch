// PHASE 2 hardening (D1) — ss.ge is planned under the id its adapter runs as.
//
// find-property-run used to intersect the live source registry with the ids of
// PORTAL_SOURCES, where home.ss.ge is described as `home-ss-ge`; the adapter
// that executes it, the registry and every stored observation say `ss-ge`. The
// intersection dropped ss.ge from every Find Property run, silently.
import test from 'node:test';
import assert from 'node:assert/strict';

import { livePortalAdaptersFor, runtimePortalAdapterIds } from '../discovery/portal-selection.ts';
import { compileSupplyPlan, plannedSourceJobs } from '../discovery/discovery-plan.ts';
import { normalisePlan } from '../discovery/search-plan.ts';
import { PORTAL_SOURCES } from '../adapters/portal/sources.ts';

/* source_registry rows LIVE_TESTED/PRODUCTIVE + active + GE with an adapter_id,
   as production holds them (2026-10-02), in priority order. */
const PRODUCTION_LIVE_REGISTRY = [
  'ss-ge', 'zaraya-properties', 'realting-com', 'place-ge', 'estatemarket-ge',
  'home24-ge', 'forum-ge', 'home-ge', 'telegram:preview',
];

test('the runtime executes ss.ge as `ss-ge`; the config label `home-ss-ge` is not an executable id', () => {
  const ids = runtimePortalAdapterIds();
  assert.ok(ids.includes('ss-ge'));
  assert.ok(!ids.includes('home-ss-ge'));
  assert.ok(PORTAL_SOURCES.some((s) => s.id === 'home-ss-ge'), 'the premise of the bug: the config says home-ss-ge');
});

test('ss-ge survives source selection; forum and Telegram rows drop out; registry order kept', () => {
  const picked = livePortalAdaptersFor(PRODUCTION_LIVE_REGISTRY);
  assert.equal(picked[0], 'ss-ge', 'ss.ge is not filtered out');
  assert.deepEqual(picked, ['ss-ge', 'zaraya-properties', 'realting-com', 'place-ge', 'estatemarket-ge', 'home24-ge', 'home-ge']);
  assert.ok(!picked.includes('forum-ge') && !picked.includes('telegram:preview'));
  assert.deepEqual(livePortalAdaptersFor(['ss-ge', 'ss-ge', null, '', 'home-ss-ge']), ['ss-ge'], 'deduped; unknown ids dropped');
});

test('with Find Property discovery on, ss-ge generates a PORTAL job (edge or worker-routed)', () => {
  const { plan: search } = normalisePlan({ goal: 'RENT', countryCode: 'GE', city: 'Tbilisi', cityStrength: 'REQUIRED', languages: ['ka'] });
  const live = livePortalAdaptersFor(PRODUCTION_LIVE_REGISTRY);
  const limits = { maxCredits: 50, deadlineMinutes: 30, targetResults: 5, activeDemandMaxDays: 30 };

  const plan = compileSupplyPlan({ plan: search, switches: { telegram: false, forum: false, portals: true, livePortalAdapters: live }, limits });
  assert.ok(plan.portalAdapters.includes('ss-ge'));
  const ss = plannedSourceJobs(plan, 'run-ss').find((j) => j.provider === 'PORTAL' && j.metadata.adapterId === 'ss-ge');
  assert.ok(ss, 'a PORTAL job is queued for ss-ge');
  assert.equal(ss.executor, 'EDGE');

  const routed = compileSupplyPlan({
    plan: search, limits,
    switches: { telegram: false, forum: false, portals: true, livePortalAdapters: live, workerRoutedAdapters: ['ss-ge'] },
  });
  const viaWorker = plannedSourceJobs(routed, 'run-ss2').find((j) => j.metadata.adapterId === 'ss-ge');
  assert.equal(viaWorker.executor, 'WORKER');
});
