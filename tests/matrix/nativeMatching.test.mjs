// TWO MATCHING PATHS, ONE ENGINE, AND NOBODY INVENTED.
//
// Homatch matches in two directions that look similar and are not:
//
//   EXTERNAL   a Homatch participant against intelligence discovered elsewhere. The
//              other side is a post somebody wrote on a forum. There is no account
//              there, and there is no column anywhere that could hold one.
//
//   NATIVE     a Homatch participant against another Homatch participant. Both sides
//              resolve to real authenticated accounts, which is what makes a Message
//              and a Call honest rather than theatre.
//
// THE FAILURE THIS FILE EXISTS TO PREVENT is the tempting one: making the external path
// *look* native by attaching a user to a signal. A phone number in a forum post, an email
// in a listing, a name — none of them is a Homatch account, and a synthetic user built
// from one would give a customer a Message button that opens a conversation nobody is on
// the other end of.
//
// THE SECOND FAILURE is a second matcher. The compatibility rules, the constraint
// strengths and the scoring are decided once in research-core; a native path that
// re-implemented any of them would drift, and the two directions would start disagreeing
// about the same pair.
//
// THE THIRD is duplication. A worker re-runs on a schedule. Without a stable identity for
// the RELATIONSHIP, the ninth tick puts the same flat in somebody's list for the ninth
// time.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { assessMatch } from '../../src/research-core/match/compatibility.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');

/** Comments explain what is forbidden; the code is what must not do it. */
const code = (text) => text
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const worker = code(read('supabase', 'functions', 'supply-matching', 'index.ts'));
const migration = read(
  'supabase', 'migrations', '20260927140000_native_supply_demand_matches.sql',
);

/* ────────────────────────────────────────────────────────────────────────
 * Nobody is invented
 * ──────────────────────────────────────────────────────────────────────── */

test('the native pass runs only for a demand that belongs to an account', () => {
  /*
   * An intent_profiles row read off a forum has no subscription and therefore no user.
   * The native pass is guarded on that, so an external demand can never acquire a
   * Homatch counterparty by passing through this code.
   */
  assert.match(worker, /if \(demandUserId\) \{/,
    'the native pass no longer checks that the demand belongs to somebody');
  const nativeBlock = worker.slice(worker.indexOf('if (demandUserId) {'));
  assert.ok(nativeBlock.includes("rpc('upsert_native_match'"),
    'the native pass is not the block guarded by demandUserId');
  /* The function writes only the internal kind — the external path cannot reach it. */
  const pipeline = read('supabase', 'migrations', '20260928010000_native_intent_pipeline.sql');
  assert.match(pipeline, /'INTERNAL_HOMATCH',\s*nullif\(p->>'campaign_id'/,
    'the native write function does not fix the row as INTERNAL_HOMATCH');
});

test('the two identities come from the owning rows, never from the request', () => {
  const nativeBlock = worker.slice(worker.indexOf('if (demandUserId) {'));
  /* properties.user_id for supply; the subscription's user for demand. */
  assert.match(nativeBlock, /supply_user_id: propertyRow\.user_id/,
    'the supply account is not read from the property that carries it');
  assert.match(nativeBlock, /demand_user_id: demandUserId/,
    'the demand account is not the one resolved from the subscription');
  /* And nothing in this worker reads an identity out of the POST body. */
  const body = worker.slice(worker.indexOf('const body = await req.json'));
  assert.doesNotMatch(body.slice(0, 600), /body\.(userId|user_id|supplyUser|demandUser)/,
    'the worker takes a participant identity from the caller');
});

test('a signal never becomes a Homatch user', () => {
  /*
   * THE WHOLE POINT. No phone, email, name or forum handle anywhere in this worker is
   * turned into a users row, and no native row is written with a signal on it.
   */
  assert.ok(!/from\('users'\)[\s\S]{0,200}\.insert/.test(worker),
    'the matcher creates user rows');
  const nativeBlock = worker.slice(worker.indexOf('if (demandUserId) {'));
  assert.ok(!/signal_id:/.test(nativeBlock),
    'a native match is being written with an external signal on it');
});

test('the external path keeps its own identity', () => {
  /* The external upsert still keys on the signal and the observation, and never sets a
     property — the two paths share a table and must not share a row shape. */
  const externalWrite = worker.slice(
    worker.indexOf("'signal_id,observation_id' })") - 2000,
    worker.indexOf("'signal_id,observation_id' })") + 60,
  );
  /* Phase 2: a customer's own plan (no signal) writes the EXTERNAL_LISTING shape;
     an external demand signal still keeps its signal and EXTERNAL_INTELLIGENCE. */
  assert.match(externalWrite, /signal_id: planDemand \? null : signalId/, 'the external write lost its signal');
  assert.match(externalWrite, /source_kind: planDemand \? 'EXTERNAL_LISTING' : 'EXTERNAL_INTELLIGENCE'/);
  assert.match(externalWrite, /observation_id: entry\.observationId/,
    'the external write lost its observation');
  assert.ok(!externalWrite.includes('property_id:'),
    'the external write is attaching a Homatch property');
});

/* ────────────────────────────────────────────────────────────────────────
 * One engine
 * ──────────────────────────────────────────────────────────────────────── */

test('both supply sources are judged by the same function', () => {
  const calls = [...worker.matchAll(/assessMatch\(/g)].length;
  assert.equal(calls, 2, `assessMatch is called ${calls} times; there should be one per supply source`);
  /* And nothing here re-implements a comparison. */
  for (const name of ['comparePrice', 'compareTransaction', 'comparePlaceDimension']) {
    assert.ok(!worker.includes(name), `the worker re-implements ${name}`);
  }
});

test('a property is shaped as supply, with one price in one place', () => {
  /*
   * A property stores one amount and a transaction type says what it means. Putting the
   * figure in both saleAmount and rentAmount would let a 1,200/month rental satisfy a
   * buyer's 150,000 budget.
   */
  /* The mapping moved verbatim into the shared pure helper (native-pair.ts) so the owner's
     profile view and the worker cannot map a pair differently; the worker calls it. */
  const nativeBlock = worker.slice(worker.indexOf('const nativeSupply: SupplySide'));
  assert.match(nativeBlock.slice(0, 300), /supplySideFromProperty\(/, 'the worker uses the shared mapping');
  const mapping = read('src', 'research-core', 'match', 'native-pair.ts');
  const supplyFn = mapping.slice(mapping.indexOf('export function supplySideFromProperty'));
  assert.match(supplyFn.slice(0, 1600), /saleAmount: transaction === 'RENT' \? null : amount/,
    'a rental price can reach the sale field');
  assert.match(supplyFn.slice(0, 1600), /rentAmount: transaction === 'RENT' \? amount : null/,
    'a sale price can reach the rent field');
});

test('the same constraint semantics decide a native pair', () => {
  /*
   * BEHAVIOURAL, not textual. The engine is imported and run against a property-shaped
   * supply, because "it calls assessMatch" is only worth asserting if the result is the
   * one the product depends on.
   */
  const demand = {
    intentType: 'BUY',
    transactionType: 'SALE',
    city: 'Tbilisi',
    district: 'Vake',
    propertyTypes: ['APARTMENT'],
    budgetMin: null,
    budgetMax: 150000,
    currency: 'USD',
    areaMin: null,
    areaMax: null,
    bedroomsMin: 2,
    bedroomsMax: null,
    strength: { DISTRICT: 'PREFERRED' },
  };
  const property = {
    role: 'SELLER',
    transaction: 'SALE',
    city: 'Tbilisi',
    district: 'Vake',
    propertyType: 'APARTMENT',
    saleAmount: 142000,
    saleCurrency: 'USD',
    rentAmount: null,
    rentCurrency: null,
    areaSqm: 78,
    bedrooms: 2,
    rooms: 3,
  };

  const fits = assessMatch(demand, property, { minAgreements: 3 });
  assert.equal(fits.compatibility, 'COMPATIBLE',
    'a buyer and a fitting Homatch flat do not match');

  /* TRANSACTION CANNOT BE SOFTENED. A rental is not a cheap purchase. */
  const rental = {
    ...property,
    transaction: 'RENT',
    saleAmount: null,
    saleCurrency: null,
    rentAmount: 1200,
    rentCurrency: 'USD',
  };
  assert.equal(assessMatch(demand, rental, { minAgreements: 3 }).compatibility, 'INCOMPATIBLE',
    'a buyer matched a rental');

  /* REQUIRED disqualifies; the city was never expressed as a preference. */
  const elsewhere = { ...property, city: 'Batumi', district: null };
  assert.equal(assessMatch(demand, elsewhere, { minAgreements: 3 }).compatibility, 'INCOMPATIBLE',
    'a required city stopped disqualifying');

  /* PREFERRED does not. A different district is a ranking penalty, not a refusal. */
  const otherDistrict = { ...property, district: 'Saburtalo' };
  const softer = assessMatch(demand, otherDistrict, { minAgreements: 3 });
  assert.equal(softer.compatibility, 'COMPATIBLE',
    'a preferred district is being treated as disqualifying');
  assert.ok(softer.preferenceMisses.includes('DISTRICT'),
    'the missed preference is not reported, so nobody can be told why the score is lower');
  assert.ok(softer.score < fits.score,
    'missing a preference costs nothing in the ranking');
});

/* ────────────────────────────────────────────────────────────────────────
 * One row per relationship
 * ──────────────────────────────────────────────────────────────────────── */

test('a re-run updates the relationship rather than adding one', () => {
  const nativeBlock = worker.slice(worker.indexOf('if (demandUserId) {'));
  /* Through a SQL function that names the partial index's predicate: PostgREST cannot,
     and the upsert this replaced failed on every call. */
  assert.match(nativeBlock, /rpc\('upsert_native_match'/,
    'the native write does not go through the predicate-aware function');
  const pipeline = read('supabase', 'migrations', '20260928010000_native_intent_pipeline.sql');
  assert.match(pipeline, /on conflict \(intent_profile_id, property_id\) where property_id is not null/,
    'the native write has no conflict target, so every tick writes another row');
  assert.match(migration, /create unique index if not exists supply_matches_native_key/,
    'the relationship has no identity in the database');
  assert.match(migration, /where property_id is not null/,
    'the native uniqueness rule is not partial, so it collides with the external path');
});

test('nobody is matched with themselves', () => {
  const nativeBlock = worker.slice(worker.indexOf('if (demandUserId) {'));
  assert.match(nativeBlock, /\.neq\('user_id', demandUserId\)/,
    'the worker offers an owner their own property');
  /* And the database refuses it too, so a path that forgets cannot reach it. */
  assert.match(migration, /supply_matches_not_self/,
    'self-matching is only prevented by the worker remembering');
  assert.match(migration, /supply_user_id <> demand_user_id/,
    'the self-match constraint does not compare the two accounts');
});

/* ────────────────────────────────────────────────────────────────────────
 * Both sides are told, and not the same thing
 * ──────────────────────────────────────────────────────────────────────── */

test('a new native match tells both accounts, differently', () => {
  const nativeBlock = worker.slice(worker.indexOf('if (demandUserId) {'));
  const notifies = [...nativeBlock.matchAll(/await notify\(/g)].length;
  assert.equal(notifies, 2, `${notifies} notifications; the owner and the searcher are two people`);
  assert.match(nativeBlock, /kind: 'NATIVE_MATCH_SUPPLY'/, 'the owner side has no kind of its own');
  assert.match(nativeBlock, /kind: 'NATIVE_MATCH_DEMAND'/, 'the searcher side has no kind of its own');
});

test('the matcher does not tell anybody twice', () => {
  /*
   * The dedupe key is the RELATIONSHIP, so the hourly re-evaluation is silent; the group
   * key collapses a first sweep that finds nine into one interruption.
   */
  const nativeBlock = worker.slice(worker.indexOf('if (demandUserId) {'));
  assert.match(nativeBlock, /dedupeKey: `native-match:\$\{matchId\}:supply`/,
    'the owner can be told about the same relationship twice');
  assert.match(nativeBlock, /dedupeKey: `native-match:\$\{matchId\}:demand`/,
    'the searcher can be told about the same relationship twice');
  assert.match(nativeBlock, /groupKey: `native-match-supply:/,
    'a sweep that finds nine interrupts the owner nine times');
  assert.match(nativeBlock, /groupKey: `native-match-demand:/,
    'a sweep that finds nine interrupts the searcher nine times');
});

test('neither notification claims an intention nobody stated', () => {
  const nativeBlock = worker.slice(worker.indexOf('if (demandUserId) {'));
  /* "You have a buyer" is a state that does not exist: somebody wrote down what they
     are looking for, which is not an offer and not a commitment. */
  assert.doesNotMatch(nativeBlock, /you have a (buyer|tenant)/i,
    'a notification claims a confirmed counterparty');
  assert.doesNotMatch(nativeBlock, /interested in your property/i,
    'a notification claims an interest in this specific property that nobody expressed');
});

/* ────────────────────────────────────────────────────────────────────────
 * The demand Find Property persists is reachable
 * ──────────────────────────────────────────────────────────────────────── */

test('a demand the customer confirmed is not waiting for a classifier', () => {
  /*
   * THE BLOCKER THIS FOUND. Every demand row was gated on
   * raw_signals.classification_status = 'CLASSIFIED', joined through signal_id — and a
   * demand written from a confirmed Search Plan has no signal. So the flagship flow's
   * output was structurally invisible to the matcher, and the run reported that every
   * candidate was awaiting classification.
   *
   * The gate is still right for an external row: a provisional reading of a stranger's
   * post must not reach a customer. There is nothing provisional about a plan somebody
   * was shown and approved.
   */
  assert.match(worker, /if \(row\.signal_id === null \|\| row\.signal_id === undefined\) return true;/,
    'a native demand is being dropped for lacking a classification it cannot have');
  assert.match(worker, /classification_status.*=== 'CLASSIFIED'/,
    'the external classification gate has been removed along with it');
});
