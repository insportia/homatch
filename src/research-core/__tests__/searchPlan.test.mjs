// THE MODEL READS THE SENTENCE. NOTHING IT SAYS IS TRUSTED.
//
// A language model is the right tool for reading "2 bedrooms in Vake or Saburtalo, up
// to 150k, ideally a balcony" out of six languages of free prose. It is the wrong tool
// for everything afterwards, and normalisePlan() is the line.
//
// The property under test, stated once: A VALUE SURVIVES ONLY BY BEING RECOGNISED.
// Not corrected, not escaped, not coerced into the nearest legal thing — recognised or
// discarded, with the discard reported so the interface can tell the customer instead
// of silently running a narrower search than they asked for.
//
// The second property: REQUIRED / PREFERRED / FLEXIBLE / UNKNOWN survive the trip in.
// "Must be in Vake" and "ideally Vake" are different searches. A plan vocabulary that
// flattened them would lose the distinction before the matcher built to honour it ever
// saw a difference.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PLAN_CURRENCIES,
  PLAN_PROPERTY_TYPES,
  SEARCH_GOALS,
  intentTypeFor,
  normalisePlan,
  planReadiness,
  planToIntentProfile,
} from '../discovery/search-plan.ts';
import { CONSTRAINT_STRENGTHS } from '../match/compatibility.ts';
import { demandRoleFrom } from '../match/participants.ts';

const base = { goal: 'BUY', city: 'Tbilisi', originalText: 'a flat in Tbilisi' };

/* ────────────────────────────────────────────────────────────────────────
 * Nothing unrecognised gets through
 * ──────────────────────────────────────────────────────────────────────── */

test('a goal that is not a goal produces no plan at all', () => {
  /*
   * NOT DEFAULTED TO BUY. Guessing that somebody wants to buy when what they said
   * could not be read is how a renter is shown sale listings and told it is what they
   * asked for.
   */
  /*
   * ['BUY'] is in this list because it very nearly worked. String(['BUY']) is 'BUY', so
   * an array holding one goal was read as that goal while an array holding two was read
   * as neither -- two behaviours for one mistake. scalarText() now rejects anything that
   * is not a string, a number or a boolean, before String() gets a chance to be helpful.
   */
  for (const goal of ['find me something nice', '', null, undefined, 42, {}, ['BUY'], [], true]) {
    const result = normalisePlan({ ...base, goal });
    assert.equal(result.plan, null, `${JSON.stringify(goal)} produced a plan`);
    assert.equal(result.rejected.length, 1);
    assert.match(result.rejected[0], /goal/);
  }
});

test('a city that is an expression rather than a name is discarded', () => {
  /*
   * THE CASE THAT MATTERS. A city string reaches a database filter. A model that emits
   * `Tbilisi' or '1'='1` or `Tbilisi,Batumi` or `city.ilike.*` is not naming a place --
   * it is emitting something that will be read as more than a name by whatever
   * receives it. The response is to drop it, not to escape it and hope the next layer
   * escapes it too.
   */
  const hostile = [
    "Tbilisi' or '1'='1",
    'Tbilisi,Batumi',
    'Tbilisi or Batumi',
    'city.ilike.%',
    'Tbilisi; drop table supply_observations',
    'Tbilisi%',
    '{Tbilisi}',
    'Tbilisi`',
    'x'.repeat(61),
  ];
  for (const city of hostile) {
    const result = normalisePlan({ ...base, city });
    assert.ok(result.plan, 'the plan should still exist; only the city is dropped');
    assert.equal(result.plan.city, null, `${JSON.stringify(city)} survived as a city`);
    assert.ok(
      result.rejected.some((reason) => /city/.test(reason)),
      `${JSON.stringify(city)} was dropped without saying so`,
    );
  }
});

test('an ordinary place name in any of the six scripts survives', () => {
  for (const city of ['Tbilisi', 'თბილისი', 'Тбилиси', 'Batumi', 'تبليسي', 'Saint-Petersburg']) {
    const result = normalisePlan({ ...base, city });
    assert.equal(result.plan.city.value, city, `${city} was wrongly dropped`);
  }
});

test('an invented property type is dropped and the rest of the list kept', () => {
  const result = normalisePlan({
    ...base,
    propertyTypes: ['APARTMENT', 'penthouse-with-a-pool', 'HOUSE'],
  });
  assert.deepEqual(result.plan.propertyTypes.value, ['APARTMENT', 'HOUSE']);
  assert.ok(result.rejected.some((r) => /penthouse-with-a-pool/.test(r)));
  /* And every surviving value is in the closed set. */
  for (const kind of result.plan.propertyTypes.value) {
    assert.ok(PLAN_PROPERTY_TYPES.includes(kind));
  }
});

test('a currency this market does not quote falls back and says so', () => {
  const result = normalisePlan({ ...base, budgetMax: 150000, currency: 'BTC' });
  assert.equal(result.plan.budget.value.currency, 'USD');
  assert.ok(result.rejected.some((r) => /BTC/.test(r)));
  for (const currency of PLAN_CURRENCIES) {
    const ok = normalisePlan({ ...base, budgetMax: 1, currency });
    assert.equal(ok.plan.budget.value.currency, currency);
    assert.deepEqual(ok.rejected, []);
  }
});

test('a strength that is not a strength falls back rather than reaching the matcher', () => {
  /*
   * The matcher switches on exactly four values. A fifth arriving from a model would
   * fall through every branch, and what a dimension does when its strength is
   * unrecognised is not a question anybody should have to answer.
   */
  const result = normalisePlan({ ...base, cityStrength: 'ABSOLUTELY_ESSENTIAL' });
  assert.ok(CONSTRAINT_STRENGTHS.includes(result.plan.city.strength));
  assert.equal(result.plan.city.strength, 'REQUIRED');

  for (const strength of CONSTRAINT_STRENGTHS) {
    const ok = normalisePlan({ ...base, cityStrength: strength });
    assert.equal(ok.plan.city.strength, strength);
  }
});

test('a nonsense number never becomes a budget', () => {
  for (const value of ['NaN', 'lots', Infinity, -5, 0, null, '', {}, []]) {
    const result = normalisePlan({ ...base, budgetMax: value });
    assert.equal(result.plan.budget, null, `${JSON.stringify(value)} became a budget`);
  }
  assert.equal(normalisePlan({ ...base, budgetMax: '150000' }).plan.budget.value.max, 150000);
});

test('a budget that runs backwards is read the only way it can be, and says so', () => {
  const result = normalisePlan({ ...base, budgetMin: 150000, budgetMax: 100000 });
  assert.deepEqual(
    { min: result.plan.budget.value.min, max: result.plan.budget.value.max },
    { min: 100000, max: 150000 },
  );
  assert.ok(result.rejected.some((r) => /backwards/.test(r)));
});

test('an unsupported language is dropped', () => {
  const result = normalisePlan({ ...base, languages: ['en', 'ka', 'kl', 'EN'] });
  /* 'EN' lowercases to a supported code and dedups against the 'en' already there. */
  assert.deepEqual(result.plan.languages, ['en', 'ka']);
  assert.ok(result.rejected.some((r) => /"kl"/.test(r)));
});

/* ────────────────────────────────────────────────────────────────────────
 * The strengths are the product
 * ──────────────────────────────────────────────────────────────────────── */

test('districts default to PREFERRED and a city defaults to REQUIRED', () => {
  /*
   * A product judgement, stated deliberately. Somebody who names two districts is
   * usually describing where they would LIKE to be; a REQUIRED default would hide a
   * better flat one block over and never mention it. A city is different: somebody
   * searching in Tbilisi does not want Batumi.
   */
  const result = normalisePlan({ ...base, districts: ['Vake', 'Saburtalo'] });
  assert.equal(result.plan.city.strength, 'REQUIRED');
  assert.equal(result.plan.districts.strength, 'PREFERRED');
});

test('FLEXIBLE survives as itself and is not collapsed into UNKNOWN', () => {
  /*
   * "I don't mind which district" and "nobody mentioned a district" are different
   * facts, and folding the first into the second penalises a customer for being easy
   * to please -- the bug compatibility.ts already had to fix once at the scoring end.
   */
  const result = normalisePlan({
    ...base,
    districts: ['Vake'],
    districtsStrength: 'FLEXIBLE',
  });
  assert.equal(result.plan.districts.strength, 'FLEXIBLE');
});

/* ────────────────────────────────────────────────────────────────────────
 * The plan reaches the matcher in the matcher's own vocabulary
 * ──────────────────────────────────────────────────────────────────────── */

test('every goal maps to a deal kind and to an intent the matcher can read', () => {
  for (const goal of SEARCH_GOALS) {
    const result = normalisePlan({ ...base, goal });
    assert.ok(result.plan, `${goal} produced no plan`);
    assert.ok(result.plan.deal, `${goal} produced no deal kind`);

    /*
     * THE ROUND TRIP THAT MATTERS: the intent_type this plan writes must be one
     * demandRoleFrom() can read, or the reverse matcher sees a demand with no role and
     * PARTICIPANTS is UNKNOWN on every result -- the exact bug that made BROKER and
     * AGENCY declared participants who had never participated.
     */
    const intentType = intentTypeFor(goal);
    const role = demandRoleFrom({ intentType });
    assert.ok(role, `intent_type ${intentType} (from goal ${goal}) has no demand role`);
  }
});

test('the row written is the row the matcher reads, and it claims no signal', () => {
  const { plan } = normalisePlan({
    goal: 'RENT',
    city: 'Tbilisi',
    districts: ['Vake', 'Saburtalo'],
    propertyTypes: ['APARTMENT'],
    budgetMin: 800,
    budgetMax: 1200,
    currency: 'USD',
    bedroomsMin: 2,
    languages: ['en', 'ka'],
    originalText: 'two bed in Vake or Saburtalo, 800-1200',
    originalLanguage: 'en',
  });
  const row = planToIntentProfile(plan, { language: 'en' });

  assert.equal(row.intent_type, 'RENT');
  assert.equal(row.city, 'Tbilisi');
  assert.equal(row.district, 'Vake');
  assert.deepEqual(row.neighborhoods, ['Vake', 'Saburtalo']);
  assert.equal(row.transaction_type, 'RENT');
  assert.equal(row.budget_min, 800);
  assert.equal(row.budget_max, 1200);
  assert.equal(row.bedrooms_min, 2);
  assert.equal(row.original_text, 'two bed in Vake or Saburtalo, 800-1200');

  /*
   * NO signal_id. There is no signal: nobody posted this anywhere. The customer said
   * it to us directly, which is better provenance than a scraped post and must not be
   * dressed up as one.
   */
  assert.ok(!('signal_id' in row), 'the row claims a signal that does not exist');

  /* Confidence is 1 because there is nothing to be uncertain about -- the person whose
     requirements these are confirmed them. */
  assert.equal(row.intent_confidence, 1);
});

test('an INVESTMENT deal is stored as a SALE transaction, because that is what it is', () => {
  /*
   * transaction_type is a transaction and INVESTMENT is not one -- an investor buys.
   * The investment intent is carried by investment_intent, which is the column that
   * exists for it, and dealKindFrom reads INVESTMENT back from the goal.
   */
  const { plan } = normalisePlan({ ...base, goal: 'INVEST' });
  const row = planToIntentProfile(plan, { language: null });
  assert.equal(plan.deal, 'INVESTMENT');
  assert.equal(row.transaction_type, 'SALE');
  assert.equal(row.investment_intent, true);
  assert.equal(row.intent_type, 'INVEST');
});

/* ────────────────────────────────────────────────────────────────────────
 * Readiness
 * ──────────────────────────────────────────────────────────────────────── */

test('a plan with no location is not ready, and says which key is missing', () => {
  const { plan } = normalisePlan({ goal: 'BUY', originalText: 'somewhere nice' });
  const readiness = planReadiness(plan);
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.missingKeys, ['plan_missing_location']);
  /* Keys, not sentences: this is read in six languages. */
  for (const key of readiness.missingKeys) assert.match(key, /^plan_missing_/);
});

test('a district alone is enough of a location', () => {
  const { plan } = normalisePlan({ goal: 'BUY', districts: ['Vake'] });
  assert.equal(planReadiness(plan).ready, true);
});

test('no plan is never ready', () => {
  assert.equal(planReadiness(null).ready, false);
});

test('normalising is deterministic', () => {
  const draft = { ...base, districts: ['Vake'], budgetMax: 150000, currency: 'BTC' };
  assert.deepEqual(normalisePlan(draft), normalisePlan(draft));
});
