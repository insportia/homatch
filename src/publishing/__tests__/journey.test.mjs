// The guided publishing journey: every step is ticked only by server state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { journey } from '../model.ts';

const ready = { listing: [], portals: { myhome: [], ssge: [] }, ready: true };
const draft = { photos: ['p1'], description: { ka: 'ბინა', en: '', ru: '' }, portalTargets: ['myhome'] };

test('a new, unsaved listing: only "select" is done and "review" is the next step', () => {
  const j = journey({ saved: false, validation: null, draft: { ...draft, photos: [] }, publications: [] });
  assert.equal(j.select, 'done');
  assert.equal(j.review, 'current');
  assert.equal(j.verified, 'todo');
});

test('saved and complete, nothing prepared: the next step is opening a portal', () => {
  const j = journey({ saved: true, validation: ready, draft, publications: [] });
  assert.deepEqual([j.review, j.media, j.portal], ['done', 'done', 'current']);
});

test('prepared but no URL yet: publishing on the portal is the next step', () => {
  const j = journey({ saved: true, validation: ready, draft, publications: [{ status: 'HANDOFF_READY', external_url: null }] });
  assert.equal(j.open, 'done');
  assert.equal(j.publish, 'current');
});

test('a pasted URL is not "verified" until the server confirmed the page', () => {
  const pending = journey({ saved: true, validation: ready, draft, publications: [{ status: 'VERIFYING', external_url: 'https://www.myhome.ge/pr/1' }] });
  assert.equal(pending.link, 'done');
  assert.equal(pending.verified, 'current');
  const live = journey({ saved: true, validation: ready, draft, publications: [{ status: 'PUBLISHED', external_url: 'https://www.myhome.ge/pr/1' }] });
  assert.equal(live.verified, 'done');
});

test('missing photos keep "photos & description" open even when the rest is filled', () => {
  const v = { listing: [{ field: 'photos', code: 'PHOTO_REQUIRED' }], portals: {}, ready: false };
  const j = journey({ saved: true, validation: v, draft: { ...draft, photos: [] }, publications: [] });
  assert.equal(j.review, 'done');
  assert.equal(j.media, 'current');
});
