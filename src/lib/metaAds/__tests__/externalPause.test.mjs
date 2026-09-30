// A pause or re-enable made directly in Meta Ads Manager reaches HOMATCH only
// through reconciliation, and Meta's returned state always wins: at campaign,
// ad-set or ad level, and over any review state. Nothing is inferred locally.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapMetaStatus } from '../payload.ts';

const read = (p) => readFileSync(new URL(`../../../../${p}`, import.meta.url), 'utf8');

test('reviewing → paused in Ads Manager → the next reconciliation reads PAUSED', () => {
  // Before: the state the real campaign had after launch.
  assert.equal(mapMetaStatus({ campaign: 'ACTIVE', ads: ['IN_PROCESS'] }).status, 'META_REVIEW');
  // Campaign switched off: Meta reports the campaign PAUSED and the ads CAMPAIGN_PAUSED.
  assert.equal(mapMetaStatus({ campaign: 'PAUSED', ads: ['CAMPAIGN_PAUSED'] }).status, 'PAUSED');
  // Even while an ad is still in review, the explicit pause wins.
  assert.equal(mapMetaStatus({ campaign: 'PAUSED', ads: ['PENDING_REVIEW'] }).status, 'PAUSED');
  // Ad set switched off: the campaign still reads ACTIVE, the ads ADSET_PAUSED.
  assert.equal(mapMetaStatus({ campaign: 'ACTIVE', ads: ['ADSET_PAUSED'] }).status, 'PAUSED');
  // Every ad switched off.
  assert.equal(mapMetaStatus({ campaign: 'ACTIVE', ads: ['PAUSED', 'PAUSED'] }).status, 'PAUSED');
  // One ad off, another still in review: not paused as a whole.
  assert.equal(mapMetaStatus({ campaign: 'ACTIVE', ads: ['PAUSED', 'PENDING_REVIEW'] }).status, 'META_REVIEW');
});

test('paused → re-enabled in Ads Manager → HOMATCH follows what Meta returns', () => {
  assert.equal(mapMetaStatus({ campaign: 'ACTIVE', ads: ['ACTIVE'] }).status, 'ACTIVE');
  assert.equal(mapMetaStatus({ campaign: 'ACTIVE', ads: ['PENDING_REVIEW'] }).status, 'META_REVIEW', 'still under review after re-enable');
  assert.equal(mapMetaStatus({ campaign: 'ACTIVE', ads: ['IN_PROCESS'] }).status, 'META_REVIEW');
});

test('reconciliation persists Meta\'s verdict and keeps syncing a paused campaign', () => {
  const engine = read('supabase/functions/meta-ads-api/engine.ts');
  const sync = engine.slice(engine.indexOf('export async function syncCampaign'), engine.indexOf('export const SETTLEMENT_GRACE_DAYS'));
  assert.match(sync, /effective_status/, 'reads Meta\'s effective status');
  assert.match(sync, /status: verdict\.status === 'SUBMITTED' \? c\.status : verdict\.status/, 'writes the verdict');
  assert.match(sync, /last_synced_at: new Date\(\)\.toISOString\(\)/, 'stamps this campaign\'s own sync time');
  const index = read('supabase/functions/meta-ads-api/index.ts');
  assert.match(index, /const LIVE = \['SUBMITTED', 'META_REVIEW', 'ACTIVE', 'PAUSED'\];/, 'paused campaigns are still reconciled');
  // The UI shows the stored status; it never derives one.
  const page = read('src/pages/outreach/MetaAdsCampaignPage.tsx');
  assert.match(page, /<LifecycleStrip status=\{c\.status\} \/>/);
  assert.match(page, /status === 'PAUSED'/);
});
