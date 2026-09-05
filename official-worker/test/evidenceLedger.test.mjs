// evidenceLedger.test.mjs — evidence/EvidenceLedger.ts, the structural
// version of "NO EVIDENCE = NO FACT" (mandate Section 17/23): refusing to
// store a fact with no named source, and exposing supports()/
// currentVerified() as what a synthesis step must consult instead of
// generating prose from arbitrary browser text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EvidenceLedger } from '../.tstest-build/evidence/EvidenceLedger.js';

function baseItem(overrides = {}) {
  return {
    type: 'PROPERTY_FACT',
    claim: 'registered land parcel 01.18.06.019.055',
    source: 'TAS.GE',
    sourceClass: 'OFFICIAL',
    sourceUrl: 'https://tas.ge/doc/1',
    confidence: 1,
    verificationState: 'VERIFIED',
    supportingText: 'cadastral code 01.18.06.019.055 confirmed on TAS',
    ...overrides,
  };
}

test('add: refuses an item with neither source name nor sourceUrl (NO EVIDENCE = NO FACT)', () => {
  const ledger = new EvidenceLedger();
  assert.throws(() => ledger.add({ ...baseItem(), source: '', sourceUrl: null }), /NO EVIDENCE = NO FACT/);
  assert.equal(ledger.count(), 0);
});

test('add: a properly-sourced item is stored with a generated id and retrievedAt', () => {
  const ledger = new EvidenceLedger();
  const item = ledger.add(baseItem());
  assert.ok(item.id);
  assert.ok(item.retrievedAt);
  assert.equal(ledger.count(), 1);
});

test('supports: true only for a VERIFIED item whose claim/supportingText actually contains the substring', () => {
  const ledger = new EvidenceLedger();
  ledger.add(baseItem());
  assert.ok(ledger.supports('01.18.06.019.055'));
  assert.ok(!ledger.supports('01.18.06.019.099'));
});

test('supports: an UNVERIFIED item does NOT back a claim (the direct fix for narrative-outrunning-evidence)', () => {
  const ledger = new EvidenceLedger();
  ledger.add(baseItem({ verificationState: 'UNVERIFIED', claim: 'developer: შპს Example Development' }));
  assert.ok(!ledger.supports('შპს Example Development'));
});

test('currentVerified: excludes historical items even if VERIFIED', () => {
  const ledger = new EvidenceLedger();
  ledger.add(baseItem({ claim: 'old status: active' }));
  ledger.add(baseItem({ claim: 'superseded status: dissolved', historical: true }));
  const current = ledger.currentVerified();
  assert.equal(current.length, 1);
  assert.equal(current[0].claim, 'old status: active');
});

test('byEntity/byProperty/byType: simple filters over stored items', () => {
  const ledger = new EvidenceLedger();
  ledger.add(baseItem({ relatedEntityId: 'ent_1' }));
  ledger.add(baseItem({ type: 'COMPANY_FACT', relatedEntityId: 'ent_2', claim: 'company fact' }));
  assert.equal(ledger.byEntity('ent_1').length, 1);
  assert.equal(ledger.byType('COMPANY_FACT').length, 1);
});

test('contradictions: a CONTRADICTION-typed item is retrievable separately', () => {
  const ledger = new EvidenceLedger();
  ledger.add(baseItem({ type: 'CONTRADICTION', claim: 'official address disagrees with listing address', contradiction: { evidenceIds: ['a', 'b'], description: 'addresses differ' } }));
  assert.equal(ledger.contradictions().length, 1);
});
