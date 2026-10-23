// A discovered lead is only "Discovered" until facts move it: a qualified match, a contact
// detail, and recorded consent with no opt-out. Discovery alone never makes anyone emailable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { crmLadder } from '../prospectLadder.ts';

test('discovery alone is the first step only', () => {
  assert.deepEqual(crmLadder({ matchCategory: 'WEAK' }), ['DISCOVERED']);
  assert.deepEqual(crmLadder({}), ['DISCOVERED']);
});

test('qualified, contactable and email-eligible each need their own fact', () => {
  assert.deepEqual(crmLadder({ matchCategory: 'POTENTIAL' }), ['DISCOVERED', 'QUALIFIED']);
  assert.deepEqual(crmLadder({ matchCategory: 'STRONG', phone: '+995555123456' }), ['DISCOVERED', 'QUALIFIED', 'CONTACTABLE']);
  assert.deepEqual(crmLadder({ email: 'a@b.test', consentStatus: 'UNKNOWN' }), ['DISCOVERED', 'CONTACTABLE'], 'an address is not consent');
  assert.deepEqual(crmLadder({ matchCategory: 'STRONG', email: 'a@b.test', consentStatus: 'CONSENTED' }),
    ['DISCOVERED', 'QUALIFIED', 'CONTACTABLE', 'EMAIL_ELIGIBLE']);
});

test('an opt-out or suppression always removes email eligibility', () => {
  for (const flag of ['suppressed', 'unsubscribed', 'doNotContact']) {
    assert.ok(!crmLadder({ email: 'a@b.test', consentStatus: 'CONSENTED', [flag]: true }).includes('EMAIL_ELIGIBLE'), flag);
  }
  assert.ok(!crmLadder({ phone: '+1', consentStatus: 'CONSENTED' }).includes('EMAIL_ELIGIBLE'), 'no address, no email');
});
