// The guided fourteen-step publishing journey: every step is ticked only by server
// state; the steps HOMATCH cannot see happen are ticked only by their outcome.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JOURNEY, handoffText, isRequired, journey, portalDescription, requiredBy } from '../model.ts';

const ready = { listing: [], portals: { myhome: [], ssge: [] }, ready: true };
const draft = { photos: ['p1'], description: { ka: 'ბინა', en: '', ru: '' }, portalTargets: ['myhome'], contacts: [{ phone: '+995555123456', whatsapp: true, viber: false }] };

test('fourteen steps, in the manual-handoff order', () => {
  assert.equal(JOURNEY.length, 14);
  assert.deepEqual([JOURNEY[0], JOURNEY[6], JOURNEY[11], JOURNEY[13]], ['select', 'open', 'paste', 'track']);
});

test('a new, unsaved listing: only "select" is done and "required" is next', () => {
  const j = journey({ saved: false, validation: null, draft: { ...draft, photos: [], contacts: [] }, publications: [] });
  assert.equal(j.select, 'done');
  assert.equal(j.required, 'current');
  assert.equal(j.verify, 'todo');
});

test('saved and complete, nothing prepared: choosing a portal is next', () => {
  const j = journey({ saved: true, validation: ready, draft, publications: [] });
  assert.deepEqual([j.required, j.phones, j.description, j.photos, j.portal], ['done', 'done', 'done', 'done', 'current']);
});

test('prepared but no URL yet: opening the portal is next, and nothing after it is ticked by a click', () => {
  const j = journey({ saved: true, validation: ready, draft, publications: [{ status: 'HANDOFF_READY', external_url: null }] });
  assert.equal(j.portal, 'done');
  assert.equal(j.open, 'current');
  for (const step of ['signin', 'copy', 'publish', 'return', 'paste']) assert.equal(j[step], 'todo', step);
});

test('a pasted URL is not "verified" until the server confirmed the page', () => {
  const pending = journey({ saved: true, validation: ready, draft, publications: [{ status: 'VERIFYING', external_url: 'https://www.myhome.ge/pr/1' }] });
  assert.equal(pending.paste, 'done');
  assert.equal(pending.verify, 'current');
  const live = journey({ saved: true, validation: ready, draft, publications: [{ status: 'PUBLISHED', external_url: 'https://www.myhome.ge/pr/1' }] });
  assert.equal(live.track, 'done');
});

test('a missing or invalid number keeps the phones step open', () => {
  const v = { listing: [{ field: 'contacts.0', code: 'INVALID_PHONE' }], portals: {}, ready: false };
  const j = journey({ saved: true, validation: v, draft, publications: [] });
  assert.equal(j.required, 'done');
  assert.equal(j.phones, 'current');
});

test('required fields: the baseline, plus only what a SELECTED portal asks for', () => {
  const portals = [{ id: 'placege', requiredFields: ['area', 'bathrooms'] }, { id: 'myhome', requiredFields: ['description.ka'] }];
  const none = requiredBy(portals, []);
  assert.equal(isRequired('bathrooms', none), false, 'bathrooms are optional by default');
  assert.equal(isRequired('price', none), true);
  const rules = requiredBy(portals, ['placege']);
  assert.equal(isRequired('bathrooms', rules), true);
  assert.deepEqual(rules.get('area').map((p) => p.id), ['placege'], 'the form can name the portal');
  assert.equal(isRequired('area', requiredBy(portals, ['myhome'])), false);
});

test('portal copies carry the contact footer exactly once', () => {
  const once = portalDescription(draft);
  assert.match(once, /^ბინა\n\nდაგვიკავშირდით/);
  assert.equal(portalDescription({ ...draft, description: { ka: once, en: '', ru: '' } }), once);
  assert.equal((handoffText({ ...draft, title: 'T' }).match(/📞/g) ?? []).length, 1);
});
