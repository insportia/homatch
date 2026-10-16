// FIND BUYERS — the owner's campaign report view-model (no network, no
// database): payload parsing, which sentence each Research NOTE becomes,
// limitations, next-search options, lead grouping and fit badges. The main
// fixture is the production report of campaign 70b0d32b (read-only SQL).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  parseReport, noteMessage, researchNotes, nextSearchOptions, limitationMessage, rejectionBreakdown, contentMix, bestSources,
  communityLabel, splitDuration, secondsSinceStart, groupLeads, fitTone, leadCategory, NOTE_CODES,
} from '../../findBuyers/campaignReport.ts';

const PROD = JSON.parse(readFileSync(new URL('../../../tests/fixtures/findBuyersReport-70b0d32b.json', import.meta.url), 'utf8'));
const fmt = { sources: (c) => c.join('+'), languages: (c) => c.join('/') };

/* The same campaign after re-qualification, shaped like the server's qualified output. */
const QUALIFIED = {
  ...PROD, legacy: false,
  results: { ...PROD.results, strong: 1, potential: 2, weak: 1, uncategorised: 0, rejected: 33, visible: 4, genuineSeekers: 4,
    rejectionReasons: { JOB_SEARCH: 14, WRONG_TRANSACTION: 9, SALE_ADVERTISEMENT: 8, SOMETHING_NEW: 2 },
    signalRoles: { SALE_OFFER: 230, BUY_SEEKER: 9, RENT_SEEKER: 31, JOB: 40, IRRELEVANT: 60, UNCLEAR: 42 },
    budgetFit: { UNKNOWN: 3, COMPATIBLE: 1 }, locationFit: { COMPATIBLE: 2, NEARBY: 2 } },
  notes: [
    { code: 'NO_LOCATION_AND_PRICE_MATCH', params: { genuineBuyers: 4 } },
    { code: 'RENTAL_DEMAND_DOMINANT', params: { share: 78, otherSeekers: 31, seekers: 9 } },
    { code: 'JOB_GROUP_NOISE', params: { signals: 40 } },
    ...PROD.notes.filter((n) => n.code !== 'LEGACY_UNCATEGORISED'),
    { code: 'NO_BUDGET_STATED', params: { share: 75 } },
  ],
  bestSources: [
    { platform: 'FACEBOOK', community: 'facebook.com/groups/175357289696998', qualified: 2, weak: 0, uncategorised: 0, postsRead: 103, budgetSharePct: 6.5 },
    { platform: 'FACEBOOK', community: 'facebook.com/groups/jobingeorgia', qualified: 0, weak: 0, uncategorised: 0, postsRead: 100, budgetSharePct: 9.9 },
  ],
};

test('parseReport: the production payload parses; anything not shaped like a report is null', () => {
  const r = parseReport(PROD);
  assert.ok(r);
  assert.equal(r.legacy, true);
  assert.equal(r.results.uncategorised, 37);
  assert.equal(r.results.strong + r.results.potential + r.results.weak, 0, 'legacy leads are never counted as qualified');
  assert.equal(r.coverage.signalsAnalysed, 412);
  assert.equal(r.coverage.postsRetrieved, 958);
  assert.equal(r.budget.usedPct, 88);
  assert.equal(r.property.counterpart, 'BUYER');
  assert.equal(parseReport({}), null, 'an unknown RPC answer ({}) is no report');
  assert.equal(parseReport(null), null);
  assert.equal(parseReport({ jobId: 'x', results: {} }), null);
  assert.ok(!('economics' in r), 'the view model carries no provider economics');
});

test('Research Notes: every production note becomes a sentence with its real numbers; EXPANSION_OPTIONS is not a note', () => {
  const r = parseReport(PROD);
  const notes = researchNotes(r, fmt);
  assert.deepEqual(notes.map((m) => m.key), [
    'fbr_note_legacy', 'fbr_note_supply_dominant', 'fbr_note_sources_failed', 'fbr_note_budget_limited', 'fbr_note_time_limited',
    'fbr_note_comments', 'fbr_note_tg_paid_only',
  ]);
  assert.deepEqual(notes[0].vars, { n: '37' });
  assert.deepEqual(notes[1].vars, { share: '60' });
  assert.deepEqual(notes[2].vars, { sources: 'BLUESKY+VK' });
  assert.deepEqual(notes[3].vars, { pct: '88' });
  assert.equal(notes[6].vars.paid, '130');
  assert.equal(notes[6].vars.paidChannels, '8');
});

test('note selection: buyer vs tenant wording, Telegram variants, unknown codes skipped', () => {
  const n = (code, params = {}, who = 'BUYER') => noteMessage({ code, params }, who, fmt)?.key ?? null;
  assert.equal(n('NO_LOCATION_AND_PRICE_MATCH', { genuineBuyers: 4 }), 'fbr_note_no_fit_buyers');
  assert.equal(n('NO_LOCATION_AND_PRICE_MATCH', { genuineBuyers: 4 }, 'TENANT'), 'fbr_note_no_fit_tenants');
  assert.equal(n('NO_GENUINE_DEMAND', { signals: 9 }, 'TENANT'), 'fbr_note_no_demand_tenants');
  assert.equal(n('NO_BUDGET_STATED', { share: 75 }), 'fbr_note_no_budget_buyers');
  assert.equal(n('TELEGRAM_COVERAGE', { free: 3, paid: 4 }), 'fbr_note_tg_both');
  assert.equal(n('TELEGRAM_COVERAGE', { free: 3, paid: 0 }), 'fbr_note_tg_free_only');
  assert.equal(n('TELEGRAM_COVERAGE', { free: 0, paid: 0, discovered: 31 }), 'fbr_note_tg_none');
  assert.equal(n('BUDGET_LIMITED', { usedPct: null, stoppedJobs: 2 }), 'fbr_note_budget_limited_nopct');
  assert.equal(n('SOURCES_FAILED', { list: [] }), null, 'no list, no sentence');
  assert.equal(n('EXPANSION_OPTIONS', {}), null);
  assert.equal(n('SOMETHING_FROM_A_NEWER_SERVER', {}), null, 'never guessed');
  for (const code of NOTE_CODES) {
    if (code === 'EXPANSION_OPTIONS') continue;
    assert.ok(n(code, { list: ['VK'], share: 1, n: 1, genuineBuyers: 1, signals: 1, usedPct: 1, stoppedJobs: 1, posts: 1, free: 1, paid: 1, leads: 1 }), `${code} is worded`);
  }
  const rental = noteMessage({ code: 'RENTAL_DEMAND_DOMINANT', params: { share: 77.6 } }, 'BUYER', fmt);
  assert.deepEqual(rental, { key: 'fbr_note_rental_dominant', vars: { share: '78' } });
});

test('next search: options come only from the records and never promise buyers', () => {
  const next = nextSearchOptions(parseReport(PROD), fmt);
  assert.deepEqual(next.map((m) => m.key), ['fbr_next_languages', 'fbr_next_groups', 'fbr_next_telegram', 'fbr_next_sources', 'fbr_next_budget', 'fbr_next_comments']);
  assert.deepEqual(next[0].vars, { languages: 'ar/he/ka/ru/tr' });
  assert.deepEqual(next[1].vars, { n: '3' });
  assert.deepEqual(next[2].vars, { n: '31' });
  const q = nextSearchOptions(parseReport(QUALIFIED), fmt);
  assert.ok(q.some((m) => m.key === 'fbr_next_area'), 'no location+price fit → widen the area or band');
  assert.deepEqual(nextSearchOptions(parseReport({ ...PROD, notes: [] }), fmt), []);
});

test('limitations: production limits worded; unknown codes skipped', () => {
  const r = parseReport(PROD);
  const lims = r.limitations.map((l) => limitationMessage(l, fmt));
  assert.deepEqual(lims.map((m) => m.key), ['fbr_lim_failed', 'fbr_lim_empty', 'fbr_lim_discovery_cap', 'fbr_lim_time', 'fbr_lim_comments', 'fbr_lim_legacy']);
  assert.deepEqual(lims[1].vars, { sources: 'LINKEDIN' });
  assert.deepEqual(lims[2].vars, { n: '5' });
  assert.equal(limitationMessage({ code: 'NEW_THING' }, fmt), null);
  assert.deepEqual(limitationMessage({ code: 'BUDGET_UNKNOWN', leads: 3, of: 4 }, fmt), { key: 'fbr_lim_budget_unknown', vars: { n: '3', of: '4' } });
});

test('results: rejections by reason (unknown → OTHER), content mix by role or (legacy) by intent', () => {
  const q = parseReport(QUALIFIED);
  assert.deepEqual(rejectionBreakdown(q), [
    { reason: 'JOB_SEARCH', count: 14 }, { reason: 'WRONG_TRANSACTION', count: 9 }, { reason: 'SALE_ADVERTISEMENT', count: 8 }, { reason: 'OTHER', count: 2 },
  ]);
  assert.equal(contentMix(q).basis, 'ROLE');
  assert.equal(contentMix(q).parts[0].kind, 'SALE_OFFER');
  const legacy = contentMix(parseReport(PROD));
  assert.equal(legacy.basis, 'INTENT', 'a legacy campaign shows its pre-review mix, labelled as such');
  assert.deepEqual(legacy.parts.find((p) => p.kind === 'OFFERS'), { kind: 'OFFERS', count: 242 });
  assert.deepEqual(legacy.parts.find((p) => p.kind === 'DEMAND'), { kind: 'DEMAND', count: 75 });
  assert.equal(rejectionBreakdown(parseReport(PROD)).length, 0);
});

test('best sources: only communities with qualified leads; legacy uncategorised groups are not "best"', () => {
  assert.deepEqual(bestSources(parseReport(PROD)), [], 'jobingeorgia (14 unreviewed) is never presented as a best source');
  const q = bestSources(parseReport(QUALIFIED));
  assert.equal(q.length, 1);
  assert.equal(communityLabel(q[0].community), null, 'a numeric group id has no readable label');
  assert.equal(communityLabel('facebook.com/groups/real.tbilisi'), 'real.tbilisi');
  assert.equal(communityLabel('t.me/arenda_tbilisi'), '@arenda_tbilisi');
});

test('timing helpers', () => {
  assert.deepEqual(splitDuration(1830), { h: 0, m: 30, s: 30 });
  assert.deepEqual(splitDuration(3725), { h: 1, m: 2, s: 5 });
  assert.deepEqual(splitDuration(-5), { h: 0, m: 0, s: 0 });
  const r = parseReport(PROD);
  assert.equal(secondsSinceStart(r, r.timing.firstVisibleAt), 306, 'first lead 5 min 6 s after launch');
  assert.equal(secondsSinceStart(r, r.timing.phase1EndedAt), 232);
  assert.equal(secondsSinceStart(r, null), null);
});

test('leads: grouped Strong → Potential → Weak → not yet reviewed; REJECTED never shown; UNKNOWN is never a fit', () => {
  const rows = [
    { id: 'a', match_category: 'WEAK' }, { id: 'b', match_category: 'STRONG' }, { id: 'c' },
    { id: 'd', match_category: 'REJECTED' }, { id: 'e', match_category: 'POTENTIAL' }, { id: 'f', match_category: 'STRONG' },
  ];
  const g = groupLeads(rows);
  assert.deepEqual(g.map((x) => x.category), ['STRONG', 'POTENTIAL', 'WEAK', 'UNCATEGORISED']);
  assert.deepEqual(g[0].rows.map((x) => x.id), ['b', 'f'], 'server order kept inside a group');
  assert.ok(!g.some((x) => x.rows.some((r) => r.id === 'd')));
  assert.equal(leadCategory({}), 'UNCATEGORISED');
  assert.deepEqual(fitTone('UNKNOWN'), { fit: 'UNKNOWN', tone: 'unknown' });
  assert.deepEqual(fitTone(null), { fit: 'UNKNOWN', tone: 'unknown' });
  assert.deepEqual(fitTone('SOMETHING'), { fit: 'UNKNOWN', tone: 'unknown' });
  assert.deepEqual(fitTone('COMPATIBLE'), { fit: 'COMPATIBLE', tone: 'good' });
  assert.deepEqual(fitTone('NEARBY'), { fit: 'NEARBY', tone: 'near' });
});
