// Nine labels, derived deterministically; only demand reaches matching.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  discoveryLabelFor, routeFor, reusableVerdict, CLASSIFIER_VERSION, DISCOVERY_LABELS, DEMAND_LABELS,
} from '../discovery/signal-taxonomy.ts';

test('there are exactly nine labels and two of them are demand', () => {
  assert.equal(DISCOVERY_LABELS.length, 9);
  assert.deepEqual([...DEMAND_LABELS].sort(), ['BUYER_DEMAND', 'TENANT_DEMAND']);
});

test('buyers and tenants are demand only when confident', () => {
  assert.equal(discoveryLabelFor({ intentType: 'BUY', confidence: 0.9 }), 'BUYER_DEMAND');
  assert.equal(discoveryLabelFor({ intentType: 'INVEST', confidence: 0.6 }), 'BUYER_DEMAND');
  assert.equal(discoveryLabelFor({ intentType: 'RELOCATE_RENT', confidence: 0.8 }), 'TENANT_DEMAND');
  assert.equal(discoveryLabelFor({ intentType: 'RENT', confidence: 0.2 }), 'AMBIGUOUS');
});

test('an agency speaking is a broker lead, never demand, whatever it says it wants', () => {
  assert.equal(discoveryLabelFor({ intentType: 'BUY', confidence: 0.95, agencyVoice: true }), 'BROKER_AGENCY');
  assert.equal(discoveryLabelFor({ intentType: 'AGENT_AD' }), 'BROKER_AGENCY');
  assert.equal(routeFor('BROKER_AGENCY'), 'BROKER_REVIEW');
});

test('supply splits into seller and landlord by transaction', () => {
  assert.equal(discoveryLabelFor({ intentType: 'PROPERTY_AD', transactionType: 'RENT' }), 'LANDLORD_SUPPLY');
  assert.equal(discoveryLabelFor({ intentType: 'SELLER', transactionType: 'SALE' }), 'SELLER_SUPPLY');
  assert.equal(discoveryLabelFor({ intentType: 'UNKNOWN', direction: 'SUPPLY' }), 'SELLER_SUPPLY');
  assert.equal(routeFor('SELLER_SUPPLY'), 'NONE');
});

test('developer, discussion, noise and unknown each have their own label', () => {
  assert.equal(discoveryLabelFor({ intentType: 'DEVELOPER' }), 'DEVELOPER');
  assert.equal(discoveryLabelFor({ intentType: 'DISCUSSION' }), 'GENERAL_DISCUSSION');
  assert.equal(discoveryLabelFor({ intentType: 'SPAM' }), 'IRRELEVANT');
  assert.equal(discoveryLabelFor({ intentType: 'UNKNOWN' }), 'AMBIGUOUS');
  assert.equal(discoveryLabelFor({}), 'AMBIGUOUS');
});

test('a cached verdict is reused only from the same classifier version', () => {
  assert.equal(reusableVerdict({ classifierVersion: CLASSIFIER_VERSION, discoveryLabel: 'BUYER_DEMAND' }), true);
  assert.equal(reusableVerdict({ classifierVersion: 'signals-v1', discoveryLabel: 'BUYER_DEMAND' }), false);
  assert.equal(reusableVerdict({ intentType: 'BUY' }), false);
  assert.equal(reusableVerdict(null), false);
});
