// The notification contract: a stable campaign is silent; a real change is
// one event; repetition is not news; worsening escalates; resolution closes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { transition, eventKey, evidenceFingerprint, changeBucket, route, scrubPii, buildBrief, DEFAULT_PREFERENCES } from '../events.ts';

const cond = (over = {}) => ({
  type: 'PERFORMANCE_DETERIORATED', subject: 'campaign', severity: 'IMPORTANT',
  evidence: { metric: 'CPR', change: changeBucket(0.31), confidence: 'MEANINGFUL_SIGNAL' },
  facts: { change: 0.31 }, deepLink: '/outreach/meta/campaigns/c1', ...over,
});
const at = (m) => new Date(Date.parse('2026-09-30T00:00:00Z') + m * 60_000).toISOString();

test('a stable campaign over hundreds of cycles: zero notifications, zero AI', () => {
  let state = null;
  let notifications = 0;
  let ai = 0;
  for (let i = 0; i < 300; i += 1) {
    const r = transition(state, null, 'k', at(i * 15));
    if (r) { state = r.next; notifications += r.notify ? 1 : 0; ai += r.mayUseAi ? 1 : 0; }
  }
  assert.equal(notifications, 0);
  assert.equal(ai, 0);
});

test('a meaningful event is one canonical event; the unchanged condition is never resent', () => {
  const c = cond();
  const key = eventKey('c1', c);
  let r = transition(null, c, key, at(0));
  assert.equal(r.transition, 'OPEN');
  assert.equal(r.notify, true);
  let sent = 1;
  let ai = r.mayUseAi ? 1 : 0;
  for (let i = 1; i < 100; i += 1) {
    // Noise inside the same bucket: +31% → +34% is the same evidence.
    r = transition(r.next, cond({ facts: { change: 0.31 + (i % 4) / 100 } }), key, at(i * 15));
    sent += r.notify ? 1 : 0; ai += r.mayUseAi ? 1 : 0;
  }
  assert.equal(sent, 1);
  assert.equal(ai, 1);
});

test('material worsening escalates severity and notifies again', () => {
  const key = eventKey('c1', cond());
  const open = transition(null, cond(), key, at(0));
  const worse = transition(open.next, cond({ severity: 'CRITICAL', actionRequired: true, evidence: { metric: 'CPR', change: changeBucket(0.8), confidence: 'HIGH_CONFIDENCE' } }), key, at(15));
  assert.equal(worse.transition, 'ESCALATED');
  assert.equal(worse.notify, true);
  assert.deepEqual(route('PERFORMANCE_DETERIORATED', 'CRITICAL', 'ESCALATED', DEFAULT_PREFERENCES, { hasPush: true, hasEmail: true }), ['IN_APP', 'PUSH', 'EMAIL']);
});

test('same-severity material change re-notifies at most once per policy window', () => {
  const key = 'k';
  const open = transition(null, cond(), key, at(0));
  const changedSoon = transition(open.next, cond({ evidence: { metric: 'CPR', change: changeBucket(0.6), confidence: 'MEANINGFUL_SIGNAL' } }), key, at(60));
  assert.equal(changedSoon.transition, 'UPDATED');
  assert.equal(changedSoon.notify, false, 'within 24h: tracked, not resent');
  const changedLater = transition(changedSoon.next, cond({ evidence: { metric: 'CPR', change: changeBucket(1.2), confidence: 'MEANINGFUL_SIGNAL' } }), key, at(60 * 26));
  assert.equal(changedLater.notify, true);
});

test('resolution closes the event once, after the condition is gone for two cycles', () => {
  const key = 'k';
  const open = transition(null, cond(), key, at(0));
  const gone1 = transition(open.next, null, key, at(15));
  assert.equal(gone1.notify, false);
  const gone2 = transition(gone1.next, null, key, at(30));
  assert.equal(gone2.transition, 'RESOLVED');
  assert.equal(gone2.notify, true);
  assert.deepEqual(route('PERFORMANCE_DETERIORATED', 'IMPORTANT', 'RESOLVED', DEFAULT_PREFERENCES, { hasPush: true, hasEmail: true }), ['IN_APP']);
  const still = transition(gone2.next, null, key, at(45));
  assert.equal(still.notify, false);
});

test('critical action-required events remind a bounded number of times', () => {
  const c = cond({ type: 'CONTROL_ACCESS_LOST', severity: 'CRITICAL', actionRequired: true, evidence: { reason: 'TOKEN' } });
  let r = transition(null, c, 'k', at(0));
  let reminders = 0;
  for (let h = 1; h <= 24 * 5; h += 1) { r = transition(r.next, c, 'k', at(h * 60)); reminders += r.transition === 'REMINDER' ? 1 : 0; }
  assert.equal(reminders, 2);
});

test('routing: INFO in-app; IMPORTANT + push; CRITICAL + email; toggles respected; integrity mandatory', () => {
  const reach = { hasPush: true, hasEmail: true };
  assert.deepEqual(route('PLACEMENT_FINDING', 'INFO', 'OPEN', DEFAULT_PREFERENCES, reach), ['IN_APP']);
  assert.deepEqual(route('PERFORMANCE_DETERIORATED', 'IMPORTANT', 'OPEN', DEFAULT_PREFERENCES, reach), ['IN_APP', 'PUSH']);
  assert.deepEqual(route('PERFORMANCE_DETERIORATED', 'IMPORTANT', 'OPEN', { ...DEFAULT_PREFERENCES, performance: false }, reach), []);
  assert.deepEqual(route('GUARD_STRIKE', 'CRITICAL', 'OPEN', { ...DEFAULT_PREFERENCES, push: false, email: false }, reach), ['IN_APP', 'PUSH', 'EMAIL']);
  assert.deepEqual(route('LAUNCH_FAILED', 'CRITICAL', 'OPEN', DEFAULT_PREFERENCES, { hasPush: false, hasEmail: true }), ['IN_APP', 'EMAIL']);
});

test('keys are deterministic; evidence noise does not change the fingerprint', () => {
  assert.equal(eventKey('c1', cond()), eventKey('c1', cond({ facts: { change: 0.4 } })));
  assert.equal(evidenceFingerprint(cond()), evidenceFingerprint(cond({ facts: { change: 0.33 } })));
  assert.notEqual(evidenceFingerprint(cond()), evidenceFingerprint(cond({ evidence: { metric: 'CPR', change: changeBucket(0.55), confidence: 'MEANINGFUL_SIGNAL' } })));
});

test('lock-screen and email text never carry lead contact details', () => {
  assert.equal(scrubPii('New lead: nino@example.com +995 555 12 34 56'), 'New lead: ••• •••');
});

test('brief: one aggregate, totals by currency, silent when nothing happened', () => {
  const b = buildBrief('DAILY', '2026-09-30', [
    { id: 'a', name: 'A', status: 'ACTIVE', currency: 'USD', spendMinor: 1840, results: 6, leads: 6, qualified: 4, prevSpendMinor: 1500, prevResults: 4, attention: false },
    { id: 'b', name: 'B', status: 'ACTIVE', currency: 'GEL', spendMinor: 900, results: 1, leads: 1, qualified: null, prevSpendMinor: null, prevResults: null, attention: true }], 1, 0);
  assert.equal(b.totals.length, 2);
  assert.equal(b.totals.find((t) => t.currency === 'USD').costPerResultMinor, 307);
  assert.equal(b.worthSending, true);
  assert.equal(buildBrief('DAILY', 'x', [{ id: 'a', name: 'A', status: 'ACTIVE', currency: 'USD', spendMinor: 0, results: 0, leads: 0, qualified: 0, prevSpendMinor: null, prevResults: null, attention: false }], 0, 0).worthSending, false);
});

import { detect } from '../detect.ts';
import { emptyTotals } from '../kpi.ts';

const T = (o) => ({ ...emptyTotals('USD'), ...o });
const snap = (over = {}) => ({
  id: 'c1', goal: 'LEADS_ON_META', status: 'ACTIVE', currency: 'USD', current: null, previous: null,
  outcomesCurrent: {}, outcomesPrevious: {}, leadsCurrent: 0, leadsPrevious: 0, health: {}, recommendations: [],
  creativeClasses: [], connectionOk: true, ...over,
});

test('detect: a quiet or thin-data campaign produces no condition', () => {
  assert.deepEqual(detect(snap()), []);
  assert.deepEqual(detect(snap({ current: T({ spendMinor: 500, impressions: 400, leads: 1 }), previous: T({ spendMinor: 100, impressions: 300, leads: 1 }) })), []);
});

test('detect: a meaningful cost rise is an IMPORTANT deterioration; a severe, confident one is CRITICAL', () => {
  const a = detect(snap({ current: T({ spendMinor: 20000, impressions: 20000, leads: 12 }), previous: T({ spendMinor: 15000, impressions: 20000, leads: 12 }) }));
  assert.equal(a[0].type, 'PERFORMANCE_DETERIORATED');
  assert.equal(a[0].severity, 'IMPORTANT');
  const b = detect(snap({ current: T({ spendMinor: 90000, impressions: 90000, leads: 32 }), previous: T({ spendMinor: 40000, impressions: 90000, leads: 40 }) }));
  assert.equal(b[0].severity, 'CRITICAL');
});

test('detect: integrity and lifecycle conditions', () => {
  const types = detect(snap({ status: 'REJECTED', connectionOk: false, serviceShortfallMinor: 500 })).map((c) => c.type).sort();
  assert.deepEqual(types, ['CAMPAIGN_REJECTED', 'SERVICE_BALANCE_LOW']);
  assert.ok(detect(snap({ connectionOk: false })).some((c) => c.type === 'CONTROL_ACCESS_LOST' && c.severity === 'CRITICAL'));
});
