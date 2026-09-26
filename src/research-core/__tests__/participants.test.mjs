// WHO IS ON EACH SIDE, AND WHAT THEY WANT FROM EACH OTHER.
//
// Five supply roles, four demand roles, six deal kinds. They do not pair off
// arbitrarily, and until this existed the knowledge was implicit in whichever
// function happened to be matching — expressed as a transaction comparison, which is
// why INVESTMENT kept needing a special case in run-matching-v2.
//
// The property under test throughout: CANNOT_TRANSACT is a fact about the
// participants and must never be reachable as a low score, while UNKNOWN must never
// be mistaken for either answer. Production rows frequently name no role at all.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEAL_KINDS,
  DEMAND_ROLES,
  SUPPLY_ROLES,
  canTransact,
  dealKindFrom,
  dealsFor,
  demandRoleFrom,
  supplyRoleFrom,
  supplyRolesFor,
} from '../match/participants.ts';

/* ────────────────────────────────────────────────────────────────────────
 * The pairings that must not happen
 * ──────────────────────────────────────────────────────────────────────── */

test('a landlord has nothing to offer a buyer', () => {
  const result = canTransact('BUYER', 'LANDLORD', 'RENT');
  assert.equal(result.verdict, 'CANNOT_TRANSACT');
  assert.deepEqual(result.deals, []);
  assert.match(result.reason, /nothing to offer/);
});

test('a developer does not let nights to a guest', () => {
  // A developer sells units. Nobody books a night from one.
  assert.equal(canTransact('GUEST', 'DEVELOPER', 'SHORT_STAY').verdict, 'CANNOT_TRANSACT');
});

test('a tenant is not in the market for a sale', () => {
  // The roles CAN transact -- a landlord and a tenant obviously do business -- and it
  // is the DEAL that disqualifies. Both checks are needed; either alone would let this
  // through.
  const result = canTransact('TENANT', 'LANDLORD', 'SALE');
  assert.equal(result.verdict, 'CANNOT_TRANSACT');
  assert.match(result.reason, /not looking for a sale deal/);
});

test('a guest is not offered a long-term letting', () => {
  assert.equal(canTransact('GUEST', 'LANDLORD', 'RENT').verdict, 'CANNOT_TRANSACT');
});

/* ────────────────────────────────────────────────────────────────────────
 * The pairings that must
 * ──────────────────────────────────────────────────────────────────────── */

test('every required relationship transacts', () => {
  // The Master Prompt's own list: SALE ↔ BUY, RENT ↔ TENANT, SHORT_STAY ↔ GUEST,
  // COMMERCIAL, LAND, INVESTMENT ↔ INVESTOR.
  const required = [
    ['BUYER', 'SELLER', 'SALE'],
    ['BUYER', 'DEVELOPER', 'SALE'],
    ['BUYER', 'AGENCY', 'SALE'],
    ['BUYER', 'BROKER', 'SALE'],
    ['TENANT', 'LANDLORD', 'RENT'],
    ['TENANT', 'AGENCY', 'RENT'],
    ['GUEST', 'LANDLORD', 'SHORT_STAY'],
    ['GUEST', 'AGENCY', 'SHORT_STAY'],
    ['INVESTOR', 'SELLER', 'INVESTMENT'],
    ['INVESTOR', 'DEVELOPER', 'INVESTMENT'],
    ['BUYER', 'SELLER', 'LAND'],
    ['BUYER', 'SELLER', 'COMMERCIAL'],
    ['TENANT', 'LANDLORD', 'COMMERCIAL'],
  ];
  for (const [demand, supply, deal] of required) {
    const result = canTransact(demand, supply, deal);
    assert.equal(
      result.verdict, 'CAN_TRANSACT',
      `${demand}/${supply}/${deal} must be able to transact: ${result.reason}`,
    );
    assert.deepEqual(result.deals, [deal]);
  }
});

test('an investor transacts in RENT too, because a tenanted flat is the product', () => {
  /*
   * The case run-matching-v2 already special-cased in code. An investor buying a
   * let flat with its income is transacting in a rental asset; excluding RENT would
   * hide the yield-bearing half of the investment market.
   */
  assert.equal(canTransact('INVESTOR', 'LANDLORD', 'RENT').verdict, 'CANNOT_TRANSACT',
    'a landlord letting is still not selling');
  assert.equal(canTransact('INVESTOR', 'SELLER', 'RENT').verdict, 'CAN_TRANSACT',
    'a seller disposing of a tenanted flat IS an investor deal');
  assert.ok(dealsFor('INVESTOR').includes('RENT'));
});

/* ────────────────────────────────────────────────────────────────────────
 * UNKNOWN is neither answer
 * ──────────────────────────────────────────────────────────────────────── */

test('an unstated role is UNKNOWN, never a refusal and never a pairing', () => {
  // Production rows frequently name no role. Refusing them would discard most of the
  // corpus; assuming they pair would invent a relationship nobody claimed.
  for (const [d, s] of [[null, 'SELLER'], ['BUYER', null], [null, null]]) {
    const result = canTransact(d, s, 'SALE');
    assert.equal(result.verdict, 'UNKNOWN');
    assert.deepEqual(result.deals, []);
  }
});

test('an unstated deal leaves every deal the roles allow open', () => {
  const result = canTransact('BUYER', 'SELLER', null);
  assert.equal(result.verdict, 'CAN_TRANSACT');
  assert.deepEqual(result.deals.sort(), ['COMMERCIAL', 'LAND', 'SALE']);
});

/* ────────────────────────────────────────────────────────────────────────
 * Reading roles off what rows actually hold
 * ──────────────────────────────────────────────────────────────────────── */

test('supply roles resolve from the words listings use, in three languages', () => {
  assert.equal(supplyRoleFrom('developer'), 'DEVELOPER');
  assert.equal(supplyRoleFrom('Застройщик'), 'DEVELOPER');
  assert.equal(supplyRoleFrom('real estate agency'), 'AGENCY');
  assert.equal(supplyRoleFrom('АГЕНТСТВО'), 'AGENCY');
  assert.equal(supplyRoleFrom('broker'), 'BROKER');
  assert.equal(supplyRoleFrom('owner'), 'SELLER');
  assert.equal(supplyRoleFrom('Собственник'), 'SELLER');
  assert.equal(supplyRoleFrom('landlord'), 'LANDLORD');
});

test('demand roles resolve from intent_type as production writes it', () => {
  assert.equal(demandRoleFrom({ intentType: 'RENT_SEEKING' }), 'TENANT');
  assert.equal(demandRoleFrom({ intentType: 'BUY_INTENT' }), 'BUYER');
  assert.equal(demandRoleFrom({ intentType: 'INVESTMENT_INTENT' }), 'INVESTOR');
  assert.equal(demandRoleFrom({ transactionType: 'SHORT_STAY' }), 'GUEST');
});

test('INVEST wins over the SALE it implies', () => {
  // An investor is a buyer, but a more specific one, and the specific answer is the
  // useful one: it is what opens the RENT deal kind.
  assert.equal(demandRoleFrom({ intentType: 'INVEST', transactionType: 'SALE' }), 'INVESTOR');
});

test('an unstated intent is null, never guessed into a role', () => {
  for (const input of [{}, { intentType: null }, { intentType: 'SOMETHING_ELSE' }]) {
    assert.equal(demandRoleFrom(input), null);
  }
});

/* ────────────────────────────────────────────────────────────────────────
 * The deal kind, read off the supply row
 * ──────────────────────────────────────────────────────────────────────── */

test('property type overrules the verb, so land for sale is a LAND deal', () => {
  // The same precedence listing-age-policy.ts uses, for the same reason: a plot
  // behaves like land, not like a flat, whatever verb the listing chose.
  assert.equal(dealKindFrom({ transaction: 'SALE', propertyType: 'LAND' }), 'LAND');
  assert.equal(dealKindFrom({ transaction: 'RENT', propertyType: 'OFFICE' }), 'COMMERCIAL');
  assert.equal(dealKindFrom({ transaction: 'SALE', propertyType: 'APARTMENT' }), 'SALE');
});

test('the Georgian and Russian listing verbs resolve', () => {
  assert.equal(dealKindFrom({ transaction: 'qiravdeba' }), 'RENT');
  assert.equal(dealKindFrom({ transaction: 'Сдается' }), 'RENT');
  assert.equal(dealKindFrom({ transaction: 'Продается' }), 'SALE');
});

test('a short stay is not a long letting', () => {
  assert.equal(dealKindFrom({ transaction: 'daily' }), 'SHORT_STAY');
  assert.notEqual(
    dealKindFrom({ transaction: 'daily' }),
    dealKindFrom({ transaction: 'rent' }),
  );
});

test('an unstated transaction yields no deal kind', () => {
  assert.equal(dealKindFrom({}), null);
  assert.equal(dealKindFrom({ transaction: 'something' }), null);
});

/* ────────────────────────────────────────────────────────────────────────
 * The table is complete and self-consistent
 * ──────────────────────────────────────────────────────────────────────── */

test('every demand role can reach at least one supply role and one deal', () => {
  // A role with an empty row is a role the product silently cannot serve.
  for (const role of DEMAND_ROLES) {
    assert.ok(supplyRolesFor(role).length > 0, `${role} can reach no supply role`);
    assert.ok(dealsFor(role).length > 0, `${role} has no deal kinds`);
  }
});

test('every deal kind and every supply role is reachable by somebody', () => {
  // An unreachable entry is either dead vocabulary or a missing relationship, and
  // both are worth failing over rather than discovering in production.
  const reachableDeals = new Set(DEMAND_ROLES.flatMap((r) => dealsFor(r)));
  for (const deal of DEAL_KINDS) {
    assert.ok(reachableDeals.has(deal), `no demand role is interested in ${deal}`);
  }
  const reachableRoles = new Set(DEMAND_ROLES.flatMap((r) => supplyRolesFor(r)));
  for (const role of SUPPLY_ROLES) {
    assert.ok(reachableRoles.has(role), `${role} can serve nobody`);
  }
});
