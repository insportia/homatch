// My Georgia by HOMI: the questionnaire's rules, as data.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_ANSWERS, GUIDE_CATEGORIES, asksArrival, budgetKind, normalise, orderedCategories,
  stepComplete, stepSkippable, toPlanProfile,
} from '../answers.ts';
import { EMPTY_PROFILE } from '../../expats/types.ts';

const A = (p) => ({ ...EMPTY_ANSWERS, ...p });

test('the budget question follows the direction: purchase bands, monthly rent, or none', () => {
  assert.equal(budgetKind('BUY'), 'PURCHASE');
  assert.equal(budgetKind('INVEST'), 'PURCHASE');
  assert.equal(budgetKind('RENT'), 'RENT');
  assert.equal(budgetKind('BROWSING'), null);
  assert.equal(budgetKind(null), null);
});

test('arrival is asked only of someone not living here yet', () => {
  assert.equal(asksArrival('FIRST_TIME'), true);
  assert.equal(asksArrival('BEEN_BEFORE'), true);
  assert.equal(asksArrival(null), true);
  assert.equal(asksArrival('LIVING_HERE'), false);
});

test('only what a step cannot do without is required; steps 3 to 5 may be skipped', () => {
  assert.equal(stepComplete(1, A({})), false);
  assert.equal(stepComplete(1, A({ firstName: ' Nino ' })), true);
  assert.equal(stepComplete(2, A({})), false);
  assert.equal(stepComplete(2, A({ propertyIntent: 'BROWSING' })), true);
  assert.equal(stepComplete(2, A({ propertyIntent: 'RENT', rentBand: 'CUSTOM' })), false, 'a custom rent needs an amount');
  assert.equal(stepComplete(2, A({ propertyIntent: 'RENT', rentBand: 'CUSTOM', rentAmount: 800 })), true);
  for (const s of [3, 4, 5]) { assert.equal(stepComplete(s, A({})), true); assert.equal(stepSkippable(s), true); }
  assert.equal(stepSkippable(1), false); assert.equal(stepSkippable(2), false);
});

test('a later choice clears answers it made irrelevant, so nothing stale is saved', () => {
  const rentThenBuy = normalise(A({ propertyIntent: 'BUY', rentBand: 'FROM_500_TO_1000', rentAmount: 700, budgetBand: 'OVER_200K' }));
  assert.equal(rentThenBuy.rentBand, null); assert.equal(rentThenBuy.rentAmount, null); assert.equal(rentThenBuy.budgetBand, 'OVER_200K');
  const buyThenRent = normalise(A({ propertyIntent: 'RENT', budgetBand: 'OVER_200K', rentBand: 'UP_TO_500', rentAmount: 999 }));
  assert.equal(buyThenRent.budgetBand, null); assert.equal(buyThenRent.rentAmount, null, 'an amount only with a custom band');
  const living = normalise(A({ visitStatus: 'LIVING_HERE', arrivalDate: '2027-01-01', arrivalUnknown: true }));
  assert.equal(living.arrivalDate, null); assert.equal(living.arrivalUnknown, false);
  const unknown = normalise(A({ visitStatus: 'FIRST_TIME', arrivalDate: '2027-01-01', arrivalUnknown: true }));
  assert.equal(unknown.arrivalDate, null);
  const dup = normalise(A({ cities: ['TBILISI', 'TBILISI', 'NOPE'], supportTopics: ['BANKING', 'BANKING', 'X'], notes: 'x'.repeat(5000) }));
  assert.deepEqual(dup.cities, ['TBILISI']); assert.deepEqual(dup.supportTopics, ['BANKING']); assert.equal(dup.notes.length, 2000);
});

test('the answers feed the existing plan engine without inventing household or work', () => {
  const p = toPlanProfile(A({ country: 'DE', propertyIntent: 'INVEST', cities: ['OTHER', 'BATUMI'], stayLength: 'LONG_TERM',
    arrivalDate: '2027-03-01', supportTopics: ['BUSINESS', 'EDUCATION'] }), { ...EMPTY_PROFILE, household: 'COUPLE' });
  assert.equal(p.nationality, 'DE'); assert.equal(p.city, 'Batumi'); assert.equal(p.housingPlan, 'BUY');
  assert.equal(p.arrivalDate, '2027-03-01'); assert.equal(p.intendedStayMonths, 36); assert.equal(p.household, 'COUPLE');
  for (const i of ['MOVE', 'LIVE', 'INVEST', 'BUSINESS', 'FAMILY']) assert.ok(p.intents.includes(i), i);
  const rent = toPlanProfile(A({ propertyIntent: 'RENT' }), EMPTY_PROFILE);
  assert.equal(rent.housingPlan, 'RENT'); assert.ok(!rent.intents.includes('BUY'));
});

test('twelve guide categories, with what the person asked for first', () => {
  assert.equal(GUIDE_CATEGORIES.length, 12);
  const o = orderedCategories(['TRANSPORT'], 'RENT').map((c) => c.key);
  assert.ok(o.indexOf('TRANSPORT') < o.indexOf('LIVING')); assert.ok(o.indexOf('RENTING') < o.indexOf('BUYING'));
});
