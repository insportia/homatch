// The Meta Ads builder's guidance logic: what "done" means per step, the
// two-day minimum on the client, URL validation, preflight detail rendering,
// and the "what HOMATCH handles" list staying tied to the goal.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STEPS, stepGap, parseDailyCents, parseDays, urlProblem, preflightDetails, handledTasks,
} from '../steps.ts';

const status = (over = {}) => ({
  mode: 'MOCK',
  connection: { status: 'CONNECTED', health: 'CONNECTED' },
  assets: [
    { id: 'a1', kind: 'PAGE', external_id: 'p1', name: 'Page', selected: true, status: 'ACTIVE' },
    { id: 'a2', kind: 'AD_ACCOUNT', external_id: 'act_1', name: 'Acct', selected: true, status: 'ACTIVE' },
  ],
  wallet: {},
  settings: { goalsEnabled: ['LEADS_ON_META', 'PROMOTE', 'LEADS_ON_WEBSITE'], minDailyCents: 200, minDurationDays: 2 },
  ...over,
});
const campaign = (over = {}) => ({
  id: 'c1', goal: 'LEADS_ON_META', property_id: null, offer: null, daily_budget_cents: 500, duration_days: 7,
  destination: { type: 'META_FORM' }, placements: { mode: 'RECOMMENDED' }, preflight: null, ...over,
});
const creative = (over = {}) => ({ id: 'cr', media: [{ path: 'x', mime: 'image/jpeg' }], primary_text: 'Text', headline: 'Head', cta: 'SIGN_UP', ...over });

test('ten steps, account first, the owner\'s brief right before review, review last', () => {
  assert.equal(STEPS.length, 10);
  assert.equal(STEPS[0], 'account');
  assert.equal(STEPS.at(-2), 'brief');
  assert.equal(STEPS.at(-1), 'review');
  // The brief is optional: it never blocks Continue.
  assert.equal(stepGap('brief', { status: null, campaign: campaign(), creatives: [] }), null);
});

test('account: connection, then Page, then ad account', () => {
  assert.equal(stepGap('account', { status: status({ connection: { status: 'DISCONNECTED', health: 'NOT_CONNECTED' } }), campaign: campaign(), creatives: [] }), 'madsb_gap_connect');
  assert.equal(stepGap('account', { status: status({ connection: { status: 'EXPIRED', health: 'TOKEN_EXPIRED' } }), campaign: campaign(), creatives: [] }), 'madsb_gap_reconnect');
  assert.equal(stepGap('account', { status: status({ assets: [] }), campaign: campaign(), creatives: [] }), 'madsb_gap_page');
  assert.equal(stepGap('account', { status: status(), campaign: campaign(), creatives: [] }), null);
});

test('offer: a property, or another offer with a name — and clearing is a real state', () => {
  const ctx = (c) => ({ status: status(), campaign: campaign(c), creatives: [] });
  assert.equal(stepGap('offer', ctx({})), 'madsb_gap_offer');
  assert.equal(stepGap('offer', ctx({ offer: { isProperty: false, title: '  ' } })), 'madsb_gap_offer_title');
  assert.equal(stepGap('offer', ctx({ offer: { isProperty: false, title: 'Studio for rent' } })), null);
  assert.equal(stepGap('offer', ctx({ property_id: 'uuid' })), null);
});

test('destination depends on the goal', () => {
  const ctx = (c, s = status()) => ({ status: s, campaign: campaign(c), creatives: [] });
  assert.equal(stepGap('destination', ctx({})), 'madsb_gap_form');
  assert.equal(stepGap('destination', ctx({ destination: { type: 'META_FORM', formId: 'f1' } })), null);
  assert.equal(stepGap('destination', ctx({ goal: 'PROMOTE', destination: { type: 'WEBSITE', url: 'http://x.ge' } })), 'madsb_gap_url');
  assert.equal(stepGap('destination', ctx({ goal: 'LEADS_ON_WEBSITE', destination: { type: 'WEBSITE', url: 'https://x.ge' } })), 'madsb_gap_pixel');
  assert.equal(stepGap('destination', ctx({ goal: 'MESSAGES', destination: { type: 'MESSAGING' } })), 'madsb_gap_messaging');
});

test('budget: two-day minimum and minimum daily budget enforced client-side too', () => {
  assert.equal(stepGap('budget', { status: status(), campaign: campaign({ duration_days: 1 }), creatives: [] }), 'madsb_gap_days');
  assert.equal(stepGap('budget', { status: status(), campaign: campaign({ daily_budget_cents: 100 }), creatives: [] }), 'madsb_gap_budget');
  assert.equal(stepGap('budget', { status: status({ settings: { goalsEnabled: [], minDurationDays: 1 } }), campaign: campaign({ duration_days: 1 }), creatives: [] }), 'madsb_gap_days', 'a setting below 2 never lowers the floor');
  assert.deepEqual(parseDays('0', 2), { days: null, tooShort: true });
  assert.deepEqual(parseDays('1', 2), { days: null, tooShort: true });
  assert.deepEqual(parseDays('1', 0), { days: null, tooShort: true });
  assert.deepEqual(parseDays('2', 2), { days: 2, tooShort: false });
  assert.deepEqual(parseDays('2.5', 2), { days: null, tooShort: false });
  assert.deepEqual(parseDays('-3', 2), { days: null, tooShort: false });
  assert.equal(parseDailyCents('5'), 500);
  assert.equal(parseDailyCents('7,25'), 725);
  assert.equal(parseDailyCents('abc'), null);
  assert.equal(parseDailyCents('0'), null);
});

test('creative: media, then primary text, then headline where the goal shows one', () => {
  const ctx = (crs, goal = 'LEADS_ON_META') => ({ status: status(), campaign: campaign({ goal }), creatives: crs });
  assert.equal(stepGap('creative', ctx([])), 'madsb_gap_media');
  assert.equal(stepGap('creative', ctx([creative({ primary_text: '' })])), 'madsb_gap_text');
  assert.equal(stepGap('creative', ctx([creative({ headline: '' })])), 'madsb_gap_headline');
  assert.equal(stepGap('creative', ctx([creative({ headline: '' })], 'MESSAGES')), null);
  assert.equal(stepGap('creative', ctx([creative({ primary_text: '', headline: '' })], 'ENGAGEMENT')), null);
});

test('placements and review', () => {
  assert.equal(stepGap('placements', { status: status(), campaign: campaign({ placements: { mode: 'CUSTOM', list: [] } }), creatives: [] }), 'madsb_gap_placements');
  assert.equal(stepGap('review', { status: status(), campaign: campaign(), creatives: [] }), 'madsb_gap_preflight');
  assert.equal(stepGap('review', { status: status(), campaign: campaign({ preflight: { status: 'READY', checks: [] } }), creatives: [] }), null);
});

test('URL problems are specific', () => {
  assert.equal(urlProblem(''), 'madsb_url_empty');
  assert.equal(urlProblem('http://x.ge'), 'madsb_url_not_https');
  assert.equal(urlProblem('x.ge'), 'madsb_url_scheme');
  assert.equal(urlProblem('https://localhost/a'), 'madsb_url_invalid');
  assert.equal(urlProblem('https://homatch.live/x'), null);
});

test('preflight details keep their values and never show a raw code', () => {
  assert.deepEqual(preflightDetails('SHORT_1250'), [{ key: 'madsb_pfd_short', value: '$12.50' }]);
  assert.deepEqual(preflightDetails('MIN_2_DAYS'), [{ key: 'madsb_pfd_min_days', value: '2' }]);
  assert.deepEqual(preflightDetails('ACCOUNT_CURRENCY_GEL'), [{ key: 'madsb_pfd_account_currency', value: 'GEL' }]);
  assert.deepEqual(preflightDetails('ads_management,leads_retrieval').map((d) => d.key), ['mm_r_pfd_permissions'], 'one action, never scope names');
  assert.deepEqual(preflightDetails('NO_MEDIA,HEADLINE_REQUIRED').map((d) => d.key), ['madsb_pfd_no_media', 'madsb_pfd_headline_required']);
  assert.deepEqual(preflightDetails('meta_err_reconnect'), [{ key: 'meta_err_reconnect', value: '' }]);
});

test('what HOMATCH handles is tied to what the goal really does', () => {
  const lead = handledTasks('LEADS_ON_META', { hasInstagram: false, placementsMode: 'RECOMMENDED', housing: true });
  assert.ok(lead.includes('instant_form') && lead.includes('lead_webhook') && lead.includes('housing_rules'));
  assert.ok(!lead.includes('tracking_pixel') && !lead.includes('instagram_identity'));
  const web = handledTasks('LEADS_ON_WEBSITE', { hasInstagram: true, placementsMode: 'CUSTOM', housing: false });
  assert.ok(web.includes('tracking_pixel') && web.includes('instagram_identity') && web.includes('placements_manual'));
  assert.ok(!web.includes('lead_webhook'), 'website goals do not claim lead delivery');
  const msg = handledTasks('MESSAGES', { hasInstagram: false, placementsMode: 'RECOMMENDED', housing: false });
  assert.ok(msg.includes('messaging_destination') && !msg.includes('lead_webhook'));
});
