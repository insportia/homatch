// OWNER DEMO LEAD — the pure rules behind Demo Mode in HOMATCH Leads: the demo buyer as a
// lead card, the eleven guided steps, and the simulated activity / notification feed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEMO_EVENT_KINDS, DEMO_STEPS, DEMO_STEP_SECTION, demoActivity, demoBuyerHistory, demoEventKey, demoProgress,
  demoStepDone, nextDemoStep, toDemoLeadItem, unreadDemoNotifications,
} from '../ownerDemo.ts';
import { OWNER_DEMO_STRINGS } from '../../../scripts/owner-demo-i18n-data.mjs';
import { validate } from '../../../scripts/lib/i18nSplice.mjs';

const NOW = Date.parse('2026-10-10T12:00:00Z');

function payload(over = {}) {
  return {
    is_demo: true,
    conversation_id: '11111111-1111-1111-1111-111111111111',
    property: { id: 'c5c1a6a4-6fed-4764-91c2-3cd7ad090407', homatch_id: 244486, title: 'Krtsanisi' },
    facts: { city: 'Tbilisi', district: 'Krtsanisi', total_price: '213840', currency: 'USD', area: '97.2', rooms: 3, bedrooms: 2 },
    profile: {
      id: 'p', display_label: 'DEMO', display_name: null, transaction_type: 'SALE', property_types: ['APARTMENT'],
      city: 'Tbilisi', districts: ['Krtsanisi', 'Ortachala'], budget_min: 140000, budget_max: 180000, currency: 'USD',
      bedrooms_min: 2, bedrooms_max: 2, timeline_months: 3, search_criteria: { parking: true },
      details: {
        simulated: true, match_score: 92, band: 'STRONG', segment: 'STANDARD', source: 'HOMATCH_DEMO', unlock_credits: 2.5,
        agreed: ['TRANSACTION', 'PROPERTY_TYPE', 'CITY', 'DISTRICT', 'BEDROOMS', 'PARKING'], conflicted: ['PRICE'],
        request_days_ago: 12,
        history: [{ kind: 'SEARCH_ACTIVE', days_ago: 1 }, { kind: 'SEARCH_CREATED', days_ago: 12 }, { kind: 'BUDGET_UPDATED', days_ago: 5 }],
      },
    },
    contact: null,
    unlocked_at: null,
    state: {},
    events: [{ kind: 'MATCH_DISCOVERED', detail: { score: 92 }, at: '2026-10-10T10:00:00Z', simulated: true }],
    messages: [],
    opened_at: '2026-10-10T10:00:00Z',
    ...over,
  };
}

test('the locked demo lead is the specified, simulated profile — no name before the unlock', () => {
  const lead = toDemoLeadItem(payload(), NOW);
  assert.equal(lead.score, 92);
  assert.equal(lead.band, 'STRONG');
  assert.equal(lead.segment, 'STANDARD');
  assert.equal(lead.priceCredits, 2.5);
  assert.equal(lead.unlocked, false);
  assert.equal(lead.displayName, null);
  assert.equal(lead.fresh, true);
  assert.deepEqual(lead.budget, { min: 140000, max: 180000, currency: 'USD' });
  assert.deepEqual(lead.requirements, { bedroomsMin: 2, bedroomsMax: 2 });
  assert.deepEqual(lead.locations, { city: 'Tbilisi', district: 'Krtsanisi', neighborhoods: ['Ortachala'] });
  assert.ok(!lead.agreed.includes('PARKING'), 'parking is shown by the demo panel, not the engine dimension list');
  assert.deepEqual(lead.conflicted, ['PRICE']);
  assert.match(lead.matchId, /^demo-/, 'a demo id can never be mistaken for a supply_matches id');
  assert.equal(lead.demandAt, new Date(NOW - 12 * 86_400_000).toISOString());
});

test('after the simulated unlock the card shows the fictional name and the CRM stage', () => {
  const lead = toDemoLeadItem(payload({
    unlocked_at: '2026-10-10T10:05:00Z',
    profile: { ...payload().profile, display_name: 'Alex Morgan' },
    state: { crm_saved_at: 'x', crm_stage: 'INTERESTED', saved: true },
    messages: [{ id: 'm', seq: 1, sender: 'OWNER', body: 'hi', is_simulated: false, language: 'en', sent_at: 'x', delivered_at: null, seen_at: null, created_at: '2026-10-10T10:06:00Z' }],
  }), NOW);
  assert.equal(lead.unlocked, true);
  assert.equal(lead.displayName, 'Alex Morgan');
  assert.equal(lead.crmStatus, 'INTERESTED');
  assert.equal(lead.contacted, true);
  assert.equal(lead.saved, true);
  assert.equal(lead.fresh, false);
});

test('the eleven steps, in order, each pointing at a section', () => {
  assert.equal(DEMO_STEPS.length, 11);
  for (const s of DEMO_STEPS) assert.match(DEMO_STEP_SECTION[s], /^demo-/);
  const fresh = payload();
  assert.equal(nextDemoStep(fresh), 'lead');
  assert.deepEqual(demoProgress(fresh), { done: 1, total: 11 });
});

test('steps complete from what the server recorded, and the journey can finish', () => {
  const all = payload({
    unlocked_at: 'x',
    state: {
      details_viewed_at: 'x', crm_saved_at: 'x', crm_stage: 'VIEWING_SCHEDULED', chat_opened_at: 'x', offer_attached_at: 'x',
      email_draft: { subject: 's', template_id: 'PERSONAL_FOLLOW_UP', language: 'en', saved_at: 'x' }, notifications_read_at: 'x',
    },
    messages: [{ id: 'm', seq: 1, sender: 'OWNER', body: 'hi', is_simulated: false, language: 'en', sent_at: 'x', delivered_at: null, seen_at: null, created_at: 'x' }],
  });
  assert.ok(Object.values(demoStepDone(all)).every(Boolean));
  assert.equal(nextDemoStep(all), null);
  const noteOnly = demoStepDone(payload({ unlocked_at: 'x', state: { crm_saved_at: 'x', crm_stage: 'UNLOCKED', notes: [{ id: 'n', body: 'b', at: 'x' }] } }));
  assert.equal(noteOnly.crm_manage, true, 'a note alone completes "stage and notes"');
  const savedOnly = demoStepDone(payload({ unlocked_at: 'x', state: { crm_saved_at: 'x', crm_stage: 'UNLOCKED' } }));
  assert.equal(savedOnly.crm_manage, false);
});

test('activity: newest first, each simulated reply is a notification, owner messages are not repeated', () => {
  const p = payload({
    events: [
      { kind: 'MATCH_DISCOVERED', detail: {}, at: '2026-10-10T10:00:00Z', simulated: true },
      { kind: 'UNLOCKED', detail: { charged_credits: 0 }, at: '2026-10-10T10:01:00Z', simulated: true },
      { kind: 'CRM_STAGE', detail: { to: 'INTERESTED' }, at: '2026-10-10T10:02:00Z', simulated: true },
    ],
    messages: [
      { id: 'a', seq: 1, sender: 'OWNER', body: 'hi', is_simulated: false, language: 'en', sent_at: 'x', delivered_at: null, seen_at: null, created_at: '2026-10-10T10:03:00Z' },
      { id: 'b', seq: 2, sender: 'DEMO_BUYER', body: 'hello', is_simulated: true, language: 'en', sent_at: 'x', delivered_at: null, seen_at: null, created_at: '2026-10-10T10:03:03Z' },
    ],
  });
  const rows = demoActivity(p);
  assert.deepEqual(rows.map((r) => r.kind), ['BUYER_REPLIED', 'CRM_STAGE', 'UNLOCKED', 'MATCH_DISCOVERED']);
  assert.equal(rows.filter((r) => r.notification).length, 3);
  assert.equal(unreadDemoNotifications(p), 3);
  assert.equal(unreadDemoNotifications({ ...p, state: { notifications_read_at: '2026-10-10T10:02:30Z' } }), 1);
  assert.equal(demoEventKey('CRM_STAGE'), 'demo_event_crm_stage');
  assert.equal(demoEventKey('SOMETHING'), 'demo_event_other');
});

test('the buyer history is oldest first', () => {
  assert.deepEqual(demoBuyerHistory(payload(), NOW).map((h) => h.kind), ['SEARCH_CREATED', 'BUDGET_UPDATED', 'SEARCH_ACTIVE']);
});

test('the demo strings: six locales, placeholders intact, every built key exists', () => {
  assert.deepEqual(validate(OWNER_DEMO_STRINGS, 'owner-demo-i18n'), []);
  const keys = new Set(Object.keys(OWNER_DEMO_STRINGS));
  for (const s of DEMO_STEPS) {
    assert.ok(keys.has(`demo_step_${s}_title`), s);
    assert.ok(keys.has(`demo_step_${s}_body`), s);
  }
  for (const k of DEMO_EVENT_KINDS) assert.ok(keys.has(demoEventKey(k)), k);
  for (const h of ['SEARCH_CREATED', 'BUDGET_UPDATED', 'ALERT_ENABLED', 'SEARCH_ACTIVE']) assert.ok(keys.has(`demo_history_${h.toLowerCase()}`), h);
  /* Georgian: match = დამთხვევა, never შესატყვისი; never "confirmed buyer". */
  for (const [key, values] of Object.entries(OWNER_DEMO_STRINGS)) {
    assert.ok(!values[1].includes('შესატყვის'), `${key}: Georgian uses დამთხვევა`);
    assert.ok(!/confirmed buyer/i.test(values[0]), `${key}: never "confirmed buyer"`);
  }
});

test('Demo Mode never reaches the real wallet, feed, CRM, chat or sending', () => {
  const ui = readFileSync(new URL('../../components/leads/demo/OwnerDemoJourney.tsx', import.meta.url), 'utf8');
  const svc = readFileSync(new URL('../../services/ownerDemoLead.ts', import.meta.url), 'utf8');
  for (const forbidden of ['unlockLeads', 'quoteUnlock', 'atomic-unlock', 'openLeadConversation', 'crmUpdate', 'emailStudio.send', 'sendTest', 'emailStudio.generate', 'emailStudio.saveDraft', "'send-message'"]) {
    assert.ok(!ui.includes(forbidden) && !svc.includes(forbidden), `Demo Mode must not call ${forbidden}`);
  }
  for (const rpc of svc.matchAll(/rpc\('([a-z_]+)'/g)) {
    assert.match(rpc[1], /^(owner_demo_lead_|demo_)/, `only demo RPCs: ${rpc[1]}`);
  }
  assert.match(ui, /adapter=\{unlockAdapter\} demo/, 'the real UnlockDialog, with the simulated adapter');
  assert.match(ui, /data-testid="demo-email-send"[^>]*|disabled aria-describedby="demo-email-send-note"/, 'the send button is disabled');
});
