// entityQueue.test.mjs — entities/EntityQueue.ts + EntityDeduplicator.ts,
// ported from the pre-refactor lib/entityDiscovery.js's test suite, plus
// new coverage of the ResearchEntity/EnregEntityStatus queue bookkeeping
// (mandate Section 16) that didn't exist before this refactor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EntityQueue, extractEntityCandidates } from '../.tstest-build/entities/EntityQueue.js';

test('extractEntityCandidates: finds an LLC name with an adjacent id code', () => {
  const out = extractEntityCandidates('მიწის ნაკვეთი ეკუთვნის შპს Example Development, საიდენტიფიკაციო კოდი 405123456.');
  assert.equal(out.length, 1);
  assert.match(out[0].name, /^შპს Example Development/);
  assert.equal(out[0].idCode, '405123456');
});

test('extractEntityCandidates: a name-only mention (no id code nearby) is still captured as incomplete', () => {
  const out = extractEntityCandidates('დეველოპერია შპს Far Away Group, დამატებითი დეტალების გარეშე.' + ' '.repeat(200) + '405999999 არასწორი კონტექსტი');
  assert.equal(out.length, 1);
  assert.equal(out[0].idCode, null);
});

test('extractEntityCandidates: a bare 9-digit number elsewhere is never treated as an id code', () => {
  const out = extractEntityCandidates('ტელეფონი: 405123456. ' + 'x'.repeat(200) + ' შპს Unrelated Co');
  assert.equal(out.find((c) => c.name.includes('Unrelated'))?.idCode, null);
});

test('EntityQueue.add: merges by id code, upgrades a name-only candidate once an id appears', () => {
  const q = new EntityQueue();
  q.add({ name: 'შპს Example', idCode: null });
  assert.equal(q.incomplete().length, 1);
  q.add({ name: 'შპს Example', idCode: '405123456' });
  assert.equal(q.confirmed().length, 1);
  assert.equal(q.incomplete().length, 0);
  assert.equal(q.all().length, 1);
});

test('EntityQueue.add: two different id codes sharing a similar name are NOT merged', () => {
  const q = new EntityQueue();
  q.add({ name: 'შპს Example', idCode: '111111111' });
  q.add({ name: 'შპს Example', idCode: '222222222' });
  assert.equal(q.confirmed().length, 2);
});

test('EntityQueue.scanText: records discovery metadata for downstream audit', () => {
  const q = new EntityQueue();
  q.scanText('შპს Example, კოდი 405123456', { source: 'tas', sourceDocument: 'https://tas.ge/doc/1', retrievedAt: '2026-09-05T00:00:00.000Z' });
  const e = q.all()[0];
  assert.equal(e.discoveredFrom[0].source, 'tas');
  assert.equal(e.discoveredFrom[0].sourceDocument, 'https://tas.ge/doc/1');
});

// Real production job 08379309-bb2e-4ac6-9d97-727edb3af2b8 regression: the
// bug was a NAME landing in the idCode field before ever reaching the
// EntityQueue (ResearchOrchestrator.startEntity()'s own idCode||name
// fallback) — but EntityDeduplicator.merge() is the shared choke point
// every discovery path (scanText, add()) goes through, so it independently
// guards against a name-shaped idCode ever becoming identificationCode too.
// confirmed()/notYetQueued() trust identificationCode !== null as "safe to
// auto-queue for RS_TAXPAYER/DEBTOR", which have no name fallback of their
// own — this must never be corruptible from any entry point.
test('EntityQueue.add: a name-shaped idCode is never stored as identificationCode', () => {
  const q = new EntityQueue();
  q.add({ name: 'Millenio Group', idCode: 'Millenio Group' });
  assert.equal(q.confirmed().length, 0);
  assert.equal(q.incomplete().length, 1);
  assert.equal(q.all()[0].identificationCode, null);
});
test('EntityQueue.add: a real numeric idCode is still stored normally alongside the guard', () => {
  const q = new EntityQueue();
  q.add({ name: 'შპს Millenio Group', idCode: '404670272' });
  assert.equal(q.confirmed().length, 1);
  assert.equal(q.all()[0].identificationCode, '404670272');
});

test('EntityQueue: notYetQueued/markQueued bookkeeping (mandate Section 16 entity-queue flow)', () => {
  const q = new EntityQueue();
  q.add({ name: 'შპს A', idCode: '111111111' });
  q.add({ name: 'შპს B', idCode: '222222222' });
  const pending = q.notYetQueued();
  assert.equal(pending.length, 2);
  q.markQueued(pending[0].id);
  assert.equal(q.notYetQueued().length, 1);
  q.markResult(pending[0].id, 'RESEARCHED');
  assert.equal(q.all().find((e) => e.id === pending[0].id).enregStatus, 'RESEARCHED');
});
