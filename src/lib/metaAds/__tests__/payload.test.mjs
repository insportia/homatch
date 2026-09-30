// The Graph payload per goal: every goal gets the objective, optimisation,
// destination and promoted_object it needs, creatives always carry media,
// and the tree starts delivery only when the campaign itself is switched on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan } from '../strategy.ts';
import {
  GOAL_SPECS, adSetParams, creativeParams, campaignParams, adParams, missingRequirements, placementTargeting,
  checkMedia, nameRatio, recommendedPlacements, mapMetaStatus, settlement, isHttpsUrl,
  feeOnlySettlement, launchCharge, parseBudgetBilling,
} from '../payload.ts';

const plan = (over = {}) => buildPlan({
  goal: 'LEADS_ON_META', dailyBudgetCents: 500, durationDays: 7, currency: 'USD', specialAdCategories: ['HOUSING'],
  creatives: [{ id: 'cr-1', kind: 'IMAGE', ready: true }], destination: { type: 'META_FORM' },
  placementsMode: 'RECOMMENDED', ...over,
});
const ctx = (over = {}) => ({
  pageId: 'p1', instagramUserId: null, pixelId: null, leadFormId: null, messagingApp: null, whatsappNumber: null,
  countries: ['GE'], startTime: '2026-10-01T00:00:00Z', endTime: '2026-10-08T00:00:00Z', websiteUrl: null, ...over,
});
const creative = (over = {}) => ({
  id: 'cr-1-abcdef', kind: 'IMAGE', imageHash: 'hash1', videoId: null, thumbnailUrl: null,
  primaryText: 'Two-bedroom in Vake', headline: 'Vake 2BR', description: '', cta: null, ...over,
});

test('campaign is created PAUSED with the housing category and its country', () => {
  const p = plan();
  const c = campaignParams(p, 'HOMATCH test', ['GE']);
  assert.equal(c.status, 'PAUSED');
  assert.deepEqual(c.special_ad_categories, ['HOUSING']);
  assert.deepEqual(c.special_ad_category_country, ['GE']);
  assert.equal(c.is_adset_budget_sharing_enabled, false);
  const plain = campaignParams(plan({ specialAdCategories: [] }), 'x', ['GE']);
  assert.equal('special_ad_category_country' in plain, false);
});

test('lead-form ads: LEAD_GENERATION on ad, promoted page, the form in the CTA, media attached', () => {
  const p = plan();
  const s = adSetParams('LEADS_ON_META', p, p.adSets[0], ctx({ leadFormId: 'form9' }), 'camp1');
  assert.equal(s.optimization_goal, 'LEAD_GENERATION');
  assert.equal(s.destination_type, 'ON_AD');
  assert.deepEqual(s.promoted_object, { page_id: 'p1' });
  assert.equal(s.status, 'ACTIVE', 'children ACTIVE under a PAUSED campaign');
  assert.equal(s.daily_budget, 500);
  const cr = creativeParams('LEADS_ON_META', creative(), ctx({ leadFormId: 'form9' }));
  const ld = cr.object_story_spec.link_data;
  assert.equal(ld.image_hash, 'hash1');
  assert.equal(ld.call_to_action.value.lead_gen_form_id, 'form9');
  assert.equal(ld.call_to_action.type, 'SIGN_UP');
});

test('website leads and registrations optimise for the pixel event; traffic needs no pixel', () => {
  const p = plan({ goal: 'LEADS_ON_WEBSITE', destination: { type: 'WEBSITE', url: 'https://x.ge' } });
  const lead = adSetParams('LEADS_ON_WEBSITE', p, p.adSets[0], ctx({ pixelId: 'px1', websiteUrl: 'https://x.ge' }), 'c');
  assert.deepEqual(lead.promoted_object, { pixel_id: 'px1', custom_event_type: 'LEAD' });
  assert.equal(lead.optimization_goal, 'OFFSITE_CONVERSIONS');
  const reg = adSetParams('SITE_REGISTRATIONS', p, p.adSets[0], ctx({ pixelId: 'px1' }), 'c');
  assert.equal(reg.promoted_object.custom_event_type, 'COMPLETE_REGISTRATION');
  const traffic = adSetParams('PROMOTE', p, p.adSets[0], ctx(), 'c');
  assert.equal(traffic.optimization_goal, 'LINK_CLICKS');
  assert.equal('promoted_object' in traffic, false);
  const cr = creativeParams('PROMOTE', creative({ cta: 'CONTACT_US' }), ctx({ websiteUrl: 'https://x.ge/p' }));
  assert.equal(cr.object_story_spec.link_data.link, 'https://x.ge/p');
  assert.equal(cr.object_story_spec.link_data.call_to_action.type, 'CONTACT_US');
});

test('messaging ads carry the messaging app in the ad set and the CTA', () => {
  const p = plan({ goal: 'MESSAGES' });
  const s = adSetParams('MESSAGES', p, p.adSets[0], ctx({ messagingApp: 'MESSENGER' }), 'c');
  assert.equal(s.destination_type, 'MESSENGER');
  assert.equal(s.optimization_goal, 'CONVERSATIONS');
  const cr = creativeParams('MESSAGES', creative(), ctx({ messagingApp: 'MESSENGER' }));
  assert.equal(cr.object_story_spec.link_data.call_to_action.type, 'MESSAGE_PAGE');
  assert.equal(cr.object_story_spec.link_data.call_to_action.value.app_destination, 'MESSENGER');
});

test('engagement uses a photo post; video creatives carry video id and thumbnail', () => {
  const eng = creativeParams('ENGAGEMENT', creative(), ctx());
  assert.equal(eng.object_story_spec.photo_data.image_hash, 'hash1');
  const vid = creativeParams('PROMOTE', creative({ kind: 'VIDEO', videoId: 'v1', thumbnailUrl: 'https://t/1.jpg' }), ctx({ websiteUrl: 'https://x.ge' }));
  assert.equal(vid.object_story_spec.video_data.video_id, 'v1');
  assert.equal(vid.object_story_spec.video_data.image_url, 'https://t/1.jpg');
  assert.equal(vid.object_story_spec.video_data.call_to_action.value.link, 'https://x.ge');
});

test('instagram identity rides on the creative when connected', () => {
  const cr = creativeParams('PROMOTE', creative(), ctx({ instagramUserId: 'ig7', websiteUrl: 'https://x.ge' }));
  assert.equal(cr.object_story_spec.instagram_user_id, 'ig7');
});

test('custom placements become real targeting; recommended leaves Meta automatic placements', () => {
  assert.deepEqual(placementTargeting(['facebook_feed', 'instagram_reels', 'bogus']), {
    publisher_platforms: ['facebook', 'instagram'], facebook_positions: ['feed'], instagram_positions: ['reels'],
  });
  assert.equal(placementTargeting([]), null);
  const p = plan({ placementsMode: 'CUSTOM', customPlacements: ['instagram_stories'] });
  const s = adSetParams('LEADS_ON_META', p, p.adSets[0], ctx({ leadFormId: 'f' }), 'c');
  assert.deepEqual(s.targeting.publisher_platforms, ['instagram']);
  const auto = adSetParams('LEADS_ON_META', plan(), plan().adSets[0], ctx({ leadFormId: 'f' }), 'c');
  assert.equal('publisher_platforms' in auto.targeting, false);
});

test('missing requirements are named per goal', () => {
  assert.deepEqual(missingRequirements('LEADS_ON_META', ctx()), ['LEAD_FORM_REQUIRED']);
  assert.deepEqual(missingRequirements('LEADS_ON_WEBSITE', ctx({ websiteUrl: 'http://x.ge' })), ['PIXEL_REQUIRED', 'DESTINATION_URL_INVALID']);
  assert.deepEqual(missingRequirements('MESSAGES', ctx({ messagingApp: 'INSTAGRAM_DIRECT' })), ['INSTAGRAM_REQUIRED']);
  assert.deepEqual(missingRequirements('PROMOTE', ctx({ pageId: '', websiteUrl: 'https://x.ge' })), ['PAGE_REQUIRED']);
  assert.equal(isHttpsUrl('https://localhost/x'), false);
  assert.equal(isHttpsUrl('https://homatch.live/p/123456'), true);
});

test('every goal spec is complete', () => {
  for (const [goal, spec] of Object.entries(GOAL_SPECS)) {
    assert.ok(spec.objective.startsWith('OUTCOME_'), goal);
    assert.ok(spec.optimizationGoal, goal);
  }
  assert.equal(adParams('', 'as', 'cr').status, 'ACTIVE');
});

test('media: ratio naming, placement verdicts, hard limits', () => {
  assert.equal(nameRatio(1080, 1350), '4:5');
  assert.equal(nameRatio(1080, 1920), '9:16');
  assert.equal(nameRatio(1000, 700), null);
  const square = checkMedia({ mime: 'image/jpeg', sizeBytes: 1e6, width: 1080, height: 1080 });
  assert.equal(square.verdict, 'WARNING');
  assert.equal(square.placements.instagram_reels, 'INCOMPATIBLE');
  assert.equal(square.placements.facebook_feed, 'WARNING');
  const vertical = checkMedia({ mime: 'video/mp4', sizeBytes: 1e7, width: 1080, height: 1920, durationSeconds: 15 }, ['instagram_reels', 'instagram_stories']);
  assert.equal(vertical.verdict, 'READY');
  assert.equal(checkMedia({ mime: 'image/gif', sizeBytes: 10 }).verdict, 'INCOMPATIBLE');
  assert.equal(checkMedia({ mime: 'image/png', sizeBytes: 31 * 1024 * 1024, width: 2000, height: 2000 }).verdict, 'INCOMPATIBLE');
  assert.equal(checkMedia({ mime: 'image/png', sizeBytes: 1e5, width: 200, height: 200 }).verdict, 'INCOMPATIBLE');
  assert.deepEqual(recommendedPlacements({ hasInstagram: false, hasVideo: false, goal: 'PROMOTE' }), ['facebook_feed', 'facebook_stories']);
  assert.ok(recommendedPlacements({ hasInstagram: true, hasVideo: true, goal: 'PROMOTE' }).includes('instagram_reels'));
});

test('status: ACTIVE only when Meta says so; review, rejection and pause are distinct', () => {
  assert.equal(mapMetaStatus({ campaign: 'ACTIVE', ads: ['PENDING_REVIEW'] }).status, 'META_REVIEW');
  assert.equal(mapMetaStatus({ campaign: 'ACTIVE', ads: ['ACTIVE'] }).status, 'ACTIVE');
  assert.equal(mapMetaStatus({ campaign: 'ACTIVE', ads: ['DISAPPROVED'] }).status, 'REJECTED');
  const partial = mapMetaStatus({ campaign: 'ACTIVE', ads: ['ACTIVE', 'DISAPPROVED'] });
  assert.equal(partial.status, 'ACTIVE');
  assert.equal(partial.issue, 'PARTIALLY_REJECTED');
  assert.equal(mapMetaStatus({ campaign: 'PAUSED', ads: ['ACTIVE'] }).status, 'PAUSED');
  assert.equal(mapMetaStatus({ campaign: 'WITH_ISSUES', ads: [] }).issue, 'WITH_ISSUES');
  assert.equal(mapMetaStatus({ campaign: 'ACTIVE', ads: ['ACTIVE'], endTimePassed: true }).status, 'COMPLETED');
  assert.equal(mapMetaStatus({ campaign: null, ads: [] }).status, 'SUBMITTED');
});

test('settlement: reserve back, real spend out, unspent fee refunded, spend never above the reserve', () => {
  assert.deepEqual(settlement(3500, 315, 2000), { releaseCents: 3500, spendCents: 2000, feeRefundCents: 135 });
  assert.deepEqual(settlement(3500, 315, 9999), { releaseCents: 3500, spendCents: 3500, feeRefundCents: 0 });
  assert.deepEqual(settlement(3500, 315, 0), { releaseCents: 3500, spendCents: 0, feeRefundCents: 315 });
});

test('billing model: the default never charges the customer twice for the same ad budget', () => {
  assert.equal(parseBudgetBilling(undefined), 'CUSTOMER_AD_ACCOUNT');
  assert.equal(parseBudgetBilling('"HOMATCH_WALLET"'), 'HOMATCH_WALLET');
  const totals = { mediaCents: 3500, feeCents: 315 };
  /* Meta bills the customer's ad account for the budget; HOMATCH takes its fee only. */
  assert.deepEqual(launchCharge(totals, 'CUSTOMER_AD_ACCOUNT'), { reserveCents: 0, feeCents: 315, requiredCents: 315 });
  assert.deepEqual(launchCharge(totals, 'HOMATCH_WALLET'), { reserveCents: 3500, feeCents: 315, requiredCents: 3815 });
});

test('fee-only settlement refunds the fee on the budget Meta did not spend', () => {
  assert.deepEqual(feeOnlySettlement(3500, 315, 2000), { releaseCents: 0, spendCents: 2000, feeRefundCents: 135 });
  assert.deepEqual(feeOnlySettlement(3500, 315, 9999), { releaseCents: 0, spendCents: 3500, feeRefundCents: 0 });
  assert.deepEqual(feeOnlySettlement(3500, 315, 0), { releaseCents: 0, spendCents: 0, feeRefundCents: 315 });
});
