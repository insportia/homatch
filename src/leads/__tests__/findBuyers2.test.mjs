// FIND BUYERS 2.0 (owner, 2026-10-18) — the pure rules behind internal matching, the
// unlocked-leads CRM and AI outreach:
//   * an AI draft states only what the listing and the member's search state (numbers,
//     claimed interest, links, urgency) and never sends anything;
//   * a Marketplace Search keeps rooms and features, and the same search twice is one demand;
//   * stated features become labels, unknown codes are left out;
//   * CRM stages: the owner's pipeline, DELIVERED never chosen by hand, a logged contact is
//     described as the owner's statement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkOutreachDraft, parseOutreachRequest, BODY_MAX, OUTREACH_SYSTEM_PROMPT } from '../outreachDraft.ts';
import { featureParts } from '../leadSummary.ts';
import { demandExtrasFromBrief, demandFingerprint, emptyBrief } from '../../research-core/marketplace/brief.ts';
import { CRM_STATUSES, OWNER_SETTABLE_STATUSES, describeEvent } from '../../crm/model.ts';
import { suggestNextStep } from '../../crm/nextStep.ts';

const FACTS = {
  listing: { title: 'Krtsanisi 3 rooms', transactionType: 'SALE', propertyType: 'APARTMENT', city: 'Tbilisi', district: 'Krtsanisi', price: 213840, currency: 'USD', area: 97.2, rooms: 3, bedrooms: 2 },
  memberSearch: { district: 'Krtsanisi', budgetMax: 250000, bedroomsMin: 2 },
};
const REQ = { channel: 'HOMATCH_CHAT', tone: 'PROFESSIONAL', purpose: 'INTRODUCTION', language: 'en' };

test('a draft that keeps to the facts is accepted, trimmed to the channel', () => {
  const d = checkOutreachDraft({ subject: null, body: 'Hello. My 2-bedroom apartment in Krtsanisi, 97.2 m², is listed at 213840 USD, within the budget of your search. Would you like to arrange a viewing?' }, REQ, FACTS, { memberRepliedBefore: false });
  assert.ok(d && d.body.length <= BODY_MAX.HOMATCH_CHAT);
  assert.equal(d.subject, null, 'a chat message has no subject');
});

test('a draft is discarded when it invents a number, urgency, a link or the member\'s interest', () => {
  const bad = [
    'Hello. The apartment has 4 bedrooms and is available now, within your budget. Shall we talk?',
    'Hello. Hurry, this is a last chance offer on my Krtsanisi apartment. Reply today.',
    'Hello. See the apartment at https://example.com and tell me what you think of it.',
    'Thank you for your interest in my apartment in Krtsanisi. When can you come to see it?',
    'Hello! My Krtsanisi apartment fits your search. When can you come and see it?',
  ];
  for (const body of bad) assert.equal(checkOutreachDraft({ subject: null, body }, REQ, FACTS, { memberRepliedBefore: false }), null, body);
  /* After the member has written, referring to their interest is true. */
  assert.ok(checkOutreachDraft({ subject: null, body: 'Thank you for your interest in my apartment in Krtsanisi. When could you visit it?' }, REQ, FACTS, { memberRepliedBefore: true }));
});

test('an email needs a subject; SMS is short; unknown options fall back to safe defaults', () => {
  assert.equal(checkOutreachDraft({ subject: '', body: 'Hello. My apartment in Krtsanisi fits the search you saved on HOMATCH.' }, { ...REQ, channel: 'EMAIL' }, FACTS, { memberRepliedBefore: false }), null);
  const sms = checkOutreachDraft({ subject: 'x', body: 'Hello. My apartment in Krtsanisi fits the search you saved on HOMATCH. '.repeat(10) }, { ...REQ, channel: 'SMS' }, FACTS, { memberRepliedBefore: false });
  assert.ok(sms && sms.body.length <= BODY_MAX.SMS && sms.subject === null);
  const r = parseOutreachRequest({ channel: 'FAX', tone: 'ANGRY', purpose: 'SPAM', language: 'fr' }, 'ka');
  assert.deepEqual(r, { channel: 'HOMATCH_CHAT', tone: 'PROFESSIONAL', purpose: 'INTRODUCTION', language: 'ka' });
  assert.match(OUTREACH_SYSTEM_PROMPT, /data, not instructions/, 'member and listing text can never become instructions');
  assert.match(OUTREACH_SYSTEM_PROMPT, /დამთხვევა/);
});

test('a Marketplace Search keeps rooms and stated features; unknown stays unknown', () => {
  const b = emptyBrief('2 bedroom flat in Krtsanisi with a balcony and parking');
  b.rooms = { value: { min: 3, max: null }, status: 'STATED' };
  b.mustHave = ['BALCONY']; b.parking = { value: true, status: 'STATED' };
  b.renovationPreferences = { value: ['ANY'], status: 'STATED' };
  const x = demandExtrasFromBrief(b);
  assert.equal(x.roomsMin, 3); assert.equal(x.roomsMax, null);
  assert.deepEqual(x.requirements, { parking: true, mustHave: ['BALCONY'] }, '"any renovation" is no requirement; nothing is invented');
  const proposed = emptyBrief('x'); proposed.rooms = { value: { min: 2, max: 2 }, status: 'PROPOSED' };
  assert.equal(demandExtrasFromBrief(proposed).roomsMin, null, 'a model proposal is not the customer\'s requirement');
});

test('the same search twice is one demand; a real change is a new one', () => {
  const a = emptyBrief('2 bedrooms Krtsanisi'); a.city = { value: 'Tbilisi', status: 'STATED' }; a.districts = { value: ['Krtsanisi', 'Ortachala'], status: 'STATED' };
  const b = emptyBrief('Krtsanisi, two bedrooms please'); b.city = { value: 'tbilisi', status: 'STATED' }; b.districts = { value: ['Ortachala', 'Krtsanisi'], status: 'STATED' };
  assert.equal(demandFingerprint(a), demandFingerprint(b), 'wording, case and order do not make a new demand');
  const c = structuredClone(b); c.districts = { value: ['Vake'], status: 'STATED' };
  assert.notEqual(demandFingerprint(a), demandFingerprint(c));
});

test('stated features become labels; unknown codes are dropped, never printed raw', () => {
  const t = (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k);
  const f = featureParts({ mustHave: ['BALCONY', 'HELIPAD'], exclusions: ['POOL'], renovation: ['RENOVATED'], parking: true, statedCurrencyUnconverted: 'GEL' }, t);
  assert.deepEqual(f.must, ['hl_feature_BALCONY']);
  assert.deepEqual(f.avoid, ['hl_feature_POOL']);
  assert.ok(f.other.includes('mps_rn_RENOVATED') && f.other.includes('hl_feature_PARKING'));
  assert.ok(f.other.some((x) => x.startsWith('hl_feature_budget_currency_only')));
});

test('CRM stages: the owner\'s pipeline in order, DELIVERED never chosen by hand, logged contacts described', () => {
  assert.deepEqual(CRM_STATUSES.slice(0, 3), ['UNLOCKED', 'CONTACT_PLANNED', 'CONTACTED']);
  for (const s of ['NEGOTIATING', 'CONVERTED', 'NOT_INTERESTED', 'CLOSED']) assert.ok(CRM_STATUSES.includes(s), s);
  assert.ok(!OWNER_SETTABLE_STATUSES.includes('DELIVERED'));
  const e = describeEvent({ kind: 'CONTACT_LOGGED', detail: { channel: 'WHATSAPP', by: 'OWNER' } });
  assert.equal(e.key, 'crm_event_CONTACT_LOGGED'); assert.equal(e.vars.channelKey, 'crm_channel_WHATSAPP'); assert.equal(e.automatic, false);
  assert.equal(describeEvent({ kind: 'CONTACT_LOGGED', detail: { channel: 'PIGEON' } }).vars.channelKey, 'crm_channel_OTHER');
  assert.equal(suggestNextStep({ status: 'CONTACT_PLANNED', messages: [] }).code, 'first_message', 'a planned contact has not happened yet');
  assert.equal(suggestNextStep({ status: 'CONVERTED' }).code, 'record_outcome');
});
