// ONE FLAT, THREE PRICES, AND THE MERGE THAT MUST NOT HAPPEN.
//
// The resolver's job is to find that the same property appears on several
// sources. Its harder job is to refuse when it is not sure, because the two
// mistakes are not symmetric:
//
//   two entities that should be one   a duplicate a customer sees and a
//                                     human can merge later
//   one entity that should be two     two properties' evidence fused into a
//                                     record describing neither, with the
//                                     observations that would prove it wrong
//                                     now attributed to the wrong thing
//
// The first is untidy. The second cannot be undone. So most of these tests
// are about what the resolver declines to do.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LIKELY_THRESHOLD,
  mergesEntity,
  priceRange,
  representative,
  resolve,
} from '../discovery/entity-resolution.ts';
import { stripComments } from '../../../scripts/lib/stripComments.mjs';

/** A Vake flat, as one source sees it. */
function obs(overrides = {}) {
  return {
    id: overrides.id ?? 'o1',
    sourceId: 'src-a',
    adapterId: 'ss-ge',
    externalId: '36474494',
    canonicalUrl: 'https://home.ss.ge/ka/udzravi-qoneba/iyideba-bina-36474494',
    countryCode: 'GE',
    city: 'Tbilisi',
    district: 'Saburtalo',
    transaction: 'SALE',
    propertyType: 'APARTMENT',
    areaSqm: 82,
    rooms: 3,
    bedrooms: 2,
    floor: 5,
    saleAmount: 163000,
    saleCurrency: 'USD',
    contentFingerprint: 'fp-a',
    quality: 1,
    ...overrides,
  };
}

/* ── the same listing seen twice ───────────────────────────────────────── */

test('the same source id is a duplicate, not a judgement', () => {
  // One source cannot publish the same id for two properties. If it does,
  // its id is not an identity and everything downstream is already wrong.
  const decision = resolve(obs({ id: 'o1' }), obs({ id: 'o2' }));
  assert.equal(decision.verdict, 'EXACT_DUPLICATE');
  assert.equal(decision.confidence, 1);
  assert.equal(mergesEntity(decision.verdict), true);
});

test('the same canonical URL is a duplicate however the ids differ', () => {
  const decision = resolve(
    obs({ id: 'o1', sourceId: 'src-a', externalId: 'A' }),
    obs({ id: 'o2', sourceId: 'src-b', externalId: 'B' }),
  );
  assert.equal(decision.verdict, 'EXACT_DUPLICATE');
});

/* ── the case the whole thing exists for ───────────────────────────────── */

test('the same flat on three sources at three prices is one entity', () => {
  /*
   * This is the requirement, verbatim: Source A $150,000, Source B $162,000,
   * Source C $155,000. A resolver that split these on price would destroy
   * exactly the question a customer would ask.
   */
  const a = obs({ id: 'a', sourceId: 'src-a', externalId: 'A', canonicalUrl: 'https://a/1', saleAmount: 150000, contentFingerprint: 'fp-a' });
  const b = obs({ id: 'b', sourceId: 'src-b', externalId: 'B', canonicalUrl: 'https://b/2', saleAmount: 162000, contentFingerprint: 'fp-b' });
  const c = obs({ id: 'c', sourceId: 'src-c', externalId: 'C', canonicalUrl: 'https://c/3', saleAmount: 155000, contentFingerprint: 'fp-c' });

  for (const [left, right] of [[a, b], [b, c], [a, c]]) {
    const decision = resolve(left, right);
    assert.equal(decision.verdict, 'LIKELY_SAME_ENTITY',
      `${left.id}/${right.id} came back ${decision.verdict}: ${decision.reason}`);
  }
});

test('a price difference is never evidence against one property', () => {
  /*
   * Two sources listing one flat routinely differ by ten percent — a stale
   * listing, a negotiated reduction, an agency's margin. Treating that as
   * evidence of two properties splits the exact case this module is for.
   */
  const a = obs({ id: 'a', sourceId: 'src-a', externalId: 'A', canonicalUrl: 'https://a/1', saleAmount: 150000, contentFingerprint: 'x' });
  const b = obs({ id: 'b', sourceId: 'src-b', externalId: 'B', canonicalUrl: 'https://b/2', saleAmount: 180000, contentFingerprint: 'y' });
  const decision = resolve(a, b);
  assert.equal(decision.verdict, 'LIKELY_SAME_ENTITY');
  const priceSignal = decision.signals.find((s) => s.name === 'price differs');
  assert.ok(priceSignal, 'the price difference was not even recorded');
  assert.equal(priceSignal.weight, 0, 'a price difference pushed the two apart');
});

test('identical text across two sources is strong, and not conclusive', () => {
  /*
   * Cross-posting is routine and identical prose is very good evidence. Not
   * conclusive: a developer's boilerplate is identical across genuinely
   * different units in one building, which is why this reaches LIKELY and
   * never EXACT.
   */
  const a = obs({ id: 'a', sourceId: 'src-a', externalId: 'A', canonicalUrl: 'https://a/1', contentFingerprint: 'same' });
  const b = obs({ id: 'b', sourceId: 'src-b', externalId: 'B', canonicalUrl: 'https://b/2', contentFingerprint: 'same' });
  const decision = resolve(a, b);
  assert.equal(decision.verdict, 'LIKELY_SAME_ENTITY');
  assert.notEqual(decision.verdict, 'EXACT_DUPLICATE');
});

/* ── what cannot disagree ──────────────────────────────────────────────── */

test('two very different areas are not one flat, whatever else agrees', () => {
  // Physics, not preference. Everything else here is identical.
  const a = obs({ id: 'a', sourceId: 'src-a', externalId: 'A', canonicalUrl: 'https://a/1', areaSqm: 45, contentFingerprint: 'same' });
  const b = obs({ id: 'b', sourceId: 'src-b', externalId: 'B', canonicalUrl: 'https://b/2', areaSqm: 120, contentFingerprint: 'same' });
  const decision = resolve(a, b);
  assert.equal(decision.verdict, 'DISTINCT');
  assert.equal(mergesEntity(decision.verdict), false);
  assert.match(decision.reason, /areas cannot describe one property/);
});

test('a small area difference is rounding, not a different flat', () => {
  // Portals round, and include or exclude balconies.
  const a = obs({ id: 'a', sourceId: 'src-a', externalId: 'A', canonicalUrl: 'https://a/1', areaSqm: 82, contentFingerprint: 'x' });
  const b = obs({ id: 'b', sourceId: 'src-b', externalId: 'B', canonicalUrl: 'https://b/2', areaSqm: 83.5, contentFingerprint: 'y' });
  assert.equal(resolve(a, b).verdict, 'LIKELY_SAME_ENTITY');
});

test('different cities are different properties', () => {
  const a = obs({ id: 'a', sourceId: 'src-a', externalId: 'A', canonicalUrl: 'https://a/1', city: 'Tbilisi', contentFingerprint: 'same' });
  const b = obs({ id: 'b', sourceId: 'src-b', externalId: 'B', canonicalUrl: 'https://b/2', city: 'Batumi', contentFingerprint: 'same' });
  assert.equal(resolve(a, b).verdict, 'DISTINCT');
});

test('a flat and a house are not the same thing', () => {
  const a = obs({ id: 'a', sourceId: 'src-a', externalId: 'A', canonicalUrl: 'https://a/1', propertyType: 'APARTMENT' });
  const b = obs({ id: 'b', sourceId: 'src-b', externalId: 'B', canonicalUrl: 'https://b/2', propertyType: 'HOUSE' });
  assert.equal(resolve(a, b).verdict, 'DISTINCT');
});

/* ── refusing ──────────────────────────────────────────────────────────── */

test('two observations with nothing comparable stay two', () => {
  /*
   * THE DEFAULT, and the most important behaviour in the file. Two thin
   * listings from two sources that published almost nothing must not be
   * fused because neither contradicted the other.
   */
  const thin = (id, source) => obs({
    id, sourceId: source, externalId: id, canonicalUrl: `https://${source}/${id}`,
    areaSqm: null, rooms: null, bedrooms: null, floor: null,
    saleAmount: null, saleCurrency: null, city: null, district: null,
    propertyType: null, contentFingerprint: `fp-${id}`, quality: 0.4,
  });
  const decision = resolve(thin('a', 'src-a'), thin('b', 'src-b'));
  assert.equal(decision.verdict, 'UNRESOLVED');
  assert.equal(mergesEntity(decision.verdict), false);
});

test('absence is neither agreement nor disagreement', () => {
  // One source published an area and the other did not. That is not a
  // contradiction, and it is not a match either.
  const a = obs({ id: 'a', sourceId: 'src-a', externalId: 'A', canonicalUrl: 'https://a/1', areaSqm: 82, contentFingerprint: 'x' });
  const b = obs({ id: 'b', sourceId: 'src-b', externalId: 'B', canonicalUrl: 'https://b/2', areaSqm: null, contentFingerprint: 'y' });
  const decision = resolve(a, b);
  assert.notEqual(decision.verdict, 'DISTINCT');
  assert.equal(mergesEntity(decision.verdict), false, 'merged on an absence');
});

test('some agreement without enough is RELATED, which does not merge', () => {
  const a = obs({ id: 'a', sourceId: 'src-a', externalId: 'A', canonicalUrl: 'https://a/1', areaSqm: 82, rooms: 3, floor: null, saleAmount: null, contentFingerprint: 'x' });
  const b = obs({ id: 'b', sourceId: 'src-b', externalId: 'B', canonicalUrl: 'https://b/2', areaSqm: null, rooms: 3, floor: null, saleAmount: null, district: 'Saburtalo', contentFingerprint: 'y' });
  const decision = resolve(a, b);
  assert.ok(['RELATED', 'UNRESOLVED'].includes(decision.verdict), decision.verdict);
  assert.equal(mergesEntity(decision.verdict), false);
});

test('the same flat for sale and for rent is RELATED, not one entity', () => {
  /*
   * One flat, two offers. Fusing them would make a monthly rent and a
   * purchase price properties of the same record.
   */
  const a = obs({ id: 'a', sourceId: 'src-a', externalId: 'A', canonicalUrl: 'https://a/1', transaction: 'SALE', contentFingerprint: 'same' });
  const b = obs({ id: 'b', sourceId: 'src-b', externalId: 'B', canonicalUrl: 'https://b/2', transaction: 'RENT', contentFingerprint: 'same' });
  const decision = resolve(a, b);
  assert.equal(decision.verdict, 'RELATED');
  assert.equal(mergesEntity(decision.verdict), false);
  assert.match(decision.reason, /one flat, two offers/);
});

/* ── AI is a signal, never the decision ────────────────────────────────── */

test('a model cannot create a merge on its own', () => {
  /*
   * An irreversible merge decided by something that cannot be re-derived is
   * a merge nobody can audit. Two observations with nothing in common and a
   * similarity of 0.99 stay two.
   */
  const thin = (id, source) => obs({
    id, sourceId: source, externalId: id, canonicalUrl: `https://${source}/${id}`,
    areaSqm: null, rooms: null, floor: null, saleAmount: null,
    city: null, district: null, propertyType: null,
    contentFingerprint: `fp-${id}`, semanticSimilarity: 0.99,
  });
  const decision = resolve(thin('a', 'src-a'), thin('b', 'src-b'));
  assert.notEqual(decision.verdict, 'LIKELY_SAME_ENTITY');
  assert.equal(mergesEntity(decision.verdict), false);
});

test('nothing in the resolver calls a model', () => {
  const code = stripComments(readFileSync('src/research-core/discovery/entity-resolution.ts', 'utf8'));
  for (const forbidden of [/openai/i, /fetch\s*\(/, /await /, /async /]) {
    assert.equal(forbidden.test(code), false, `the resolver is not pure: ${forbidden}`);
  }
});

/* ── what the entity says afterwards ───────────────────────────────────── */

test('the representative is the best-evidenced observation, not an average', () => {
  /*
   * An average of three asking prices is a number no source published, and a
   * customer shown it could not be told where it came from.
   */
  const rich = obs({ id: 'rich', quality: 0.95, saleAmount: 150000 });
  const thin = obs({ id: 'thin', quality: 0.4, saleAmount: 162000, areaSqm: null, rooms: null });
  assert.equal(representative([thin, rich]).id, 'rich');
});

test('an entity reports the price RANGE, preserving the disagreement', () => {
  const observations = [
    obs({ id: 'a', saleAmount: 150000 }),
    obs({ id: 'b', saleAmount: 162000 }),
    obs({ id: 'c', saleAmount: 155000 }),
  ];
  const range = priceRange(observations);
  assert.equal(range.min, 150000);
  assert.equal(range.max, 162000);
  assert.equal(range.currency, 'USD');
  assert.ok(range.spread > 0.07 && range.spread < 0.08, `spread ${range.spread}`);
});

test('prices in different currencies are not silently pooled', () => {
  // Converting needs a rate, and a rate has a date and a source this module
  // does not have.
  const range = priceRange([
    obs({ id: 'a', saleAmount: 150000, saleCurrency: 'USD' }),
    obs({ id: 'b', saleAmount: 400000, saleCurrency: 'GEL' }),
  ]);
  assert.equal(range.currency, 'USD');
  assert.equal(range.max, 150000, 'a GEL amount was pooled with USD');
});

test('an entity with no priced observation reports no range', () => {
  assert.equal(priceRange([obs({ id: 'a', saleAmount: null })]), null);
});

/* ── the database agrees ───────────────────────────────────────────────── */

test('the verdicts are the same five in both languages', () => {
  const sql = readFileSync('supabase/migrations/20260925220000_supply_intelligence.sql', 'utf8');
  const block = sql.slice(sql.indexOf("check (verdict in ("));
  const declared = [...block.slice(0, block.indexOf('))')).matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(declared, ['DISTINCT', 'EXACT_DUPLICATE', 'LIKELY_SAME_ENTITY', 'RELATED', 'UNRESOLVED']);
});

test('the decisions table keeps refusals, not just merges', () => {
  /*
   * An ambiguous pair stays two entities AND the doubt is written down,
   * because a destructive merge cannot be undone once the evidence that
   * justified it has aged out.
   */
  const sql = readFileSync('supabase/migrations/20260925220000_supply_intelligence.sql', 'utf8');
  assert.match(sql, /INCLUDING the refusals/);
  assert.match(sql, /supply_resolution_decisions/);
});

test('the intelligence tables belong to no campaign', () => {
  // A campaign REFERENCES them; a second campaign in the same market reuses
  // the same rows rather than re-fetching.
  const sql = readFileSync('supabase/migrations/20260925220000_supply_intelligence.sql', 'utf8');
  const observations = sql.slice(sql.indexOf('create table if not exists public.supply_observations'));
  const columns = observations.slice(0, observations.indexOf(');'));
  assert.equal(/campaign_id/.test(columns), false, 'an observation belongs to a campaign');
  assert.match(sql, /campaign_supply_references/);
});

test('LIKELY_THRESHOLD is high enough that one weak signal cannot reach it', () => {
  // The strongest single positive signal is identical content at 0.6.
  assert.ok(LIKELY_THRESHOLD > 0.6, `threshold ${LIKELY_THRESHOLD} can be reached by one signal`);
});
