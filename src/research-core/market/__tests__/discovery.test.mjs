import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDiscoveryPlan, localQueries, nameVariants, CORE_LANGUAGES,
} from '../discoveryPlan.ts';
import {
  classifyTier, statsByTier, dedupeSyndicated, headlineTier, syndicationKey,
  TIER_ORDER, LOCAL_TIERS,
} from '../geoTier.ts';

/*
 * DISCOVERY AND GEOGRAPHY, AGAINST THE SUBJECT THAT EXPOSED THE DEFECT.
 *
 * Villion, კრწანისის ქუჩა N6, Krtsanisi, Tbilisi, developed by შპს მილენიო
 * გრუპი. The live run asked one question and returned 37 listings, none of
 * them in the building and none on the street.
 */

const VILLION = {
  project: 'Villion',
  street: 'კრწანისის',
  streetNumber: '6',
  district: 'კრწანისი',
  city: 'თბილისი',
  developer: 'შპს მილენიო გრუპი',
};

/* ------------------------------------------------------------------ *
 * Many formulations, not one                                          *
 * ------------------------------------------------------------------ */

test('one subject becomes many queries across the core languages', () => {
  const plan = buildDiscoveryPlan(VILLION);
  assert.ok(plan.length >= 20, `only ${plan.length} formulations`);
  for (const lang of CORE_LANGUAGES) {
    assert.ok(plan.some((q) => q.language === lang), `no ${lang} query`);
  }
  // Every precision band the subject has the facts for.
  for (const p of ['BUILDING', 'STREET', 'MICROLOCATION', 'DEVELOPER', 'CITY']) {
    assert.ok(plan.some((q) => q.precision === p), `no ${p} query`);
  }
});

test('the narrowest queries come first', () => {
  // A budget that runs out must run out on the queries whose answers were
  // going to be background context.
  const plan = buildDiscoveryPlan(VILLION);
  assert.equal(plan[0].precision, 'BUILDING');
  const lastLocal = plan.findIndex((q) => q.precision === 'CITY');
  assert.ok(
    plan.slice(0, lastLocal).every((q) => q.precision !== 'CITY'),
    'a city query ran before a building query'
  );
});

test('a Georgian place name is also asked under the names it is sold as', () => {
  // „კრწანისი" is advertised as Krtsanisi and Крцаниси. A listing carrying only
  // the Latin form is invisible to a Georgian-only search.
  const variants = nameVariants('კრწანისი');
  assert.ok(variants.includes('კრწანისი'));
  assert.ok(variants.includes('Krtsanisi'));
  assert.ok(variants.includes('Крцаниси'));

  const plan = buildDiscoveryPlan(VILLION);
  assert.ok(plan.some((q) => q.text.includes('Krtsanisi')), 'no transliterated query');
});

test('a Georgian case ending never survives into a romanised query', () => {
  /*
   * FOUND IN THE PROBE'S OWN OUTPUT.
   *
   * Georgian inflects: the street is „კრწანისის ქუჩა" — the stem „კრწანისი"
   * plus the genitive „ს". Replacing only the stem produced „Krtsanisiს 6",
   * a query written in two alphabets that no portal has ever indexed, and it
   * was one of the first three formulations the plan emitted.
   */
  const variants = nameVariants('კრწანისის');
  assert.ok(variants.includes('Krtsanisi'), variants.join(' | '));
  assert.ok(variants.includes('Крцаниси'), variants.join(' | '));
  for (const v of variants) {
    const mixed = /[a-zA-Zа-яА-Я]/.test(v) && /[ა-ჰ]/.test(v);
    assert.ok(!mixed, `a query mixes alphabets: ${v}`);
  }

  // And the same through a whole plan, which is where it actually shipped.
  for (const q of buildDiscoveryPlan(VILLION)) {
    const latinOrCyrillic = /[a-zA-Zа-яА-Я]/.test(q.text);
    const georgian = /[ა-ჰ]/.test(q.text);
    // A project name is Latin by nature, so only flag a Georgian PLACE word
    // left stranded beside a romanised one.
    if (latinOrCyrillic && georgian) {
      assert.ok(
        !/[a-zA-Zа-яА-Я][ა-ჰ]/.test(q.text),
        `a romanised word kept its Georgian suffix: ${q.text}`
      );
    }
  }
});

test('international languages are opt-in, never the default', () => {
  // They reach inventory the local portals do not carry, and asking them on
  // every run spends budget for little.
  const core = buildDiscoveryPlan(VILLION);
  assert.ok(!core.some((q) => ['ar', 'he', 'tr'].includes(q.language)));

  const wide = buildDiscoveryPlan(VILLION, { international: true });
  for (const lang of ['tr', 'ar', 'he']) {
    assert.ok(wide.some((q) => q.language === lang), `no ${lang} query when asked for`);
  }
});

test('the plan is deterministic and free of duplicates', () => {
  const a = buildDiscoveryPlan(VILLION);
  const b = buildDiscoveryPlan(VILLION);
  assert.deepEqual(a.map((q) => q.key), b.map((q) => q.key));
  assert.equal(new Set(a.map((q) => q.key)).size, a.length, 'the plan repeats itself');
});

test('a subject with almost nothing known still produces a usable plan', () => {
  const plan = buildDiscoveryPlan({ city: 'თბილისი' });
  assert.ok(plan.length > 0);
  assert.ok(plan.every((q) => q.text.trim().length > 0), 'an empty query was emitted');
  assert.deepEqual(localQueries(plan), [], 'nothing local can be claimed from a city alone');
});

/* ------------------------------------------------------------------ *
 * Geography                                                           *
 * ------------------------------------------------------------------ */

const SUBJECT = {
  project: 'Villion',
  street: 'კრწანისის ქუჩა',
  streetNumber: '6',
  district: 'კრწანისი',
  city: 'თბილისი',
  adjacentStreets: ['გორგასლის ქუჩა'],
};

test('each tier is recognised from real listing shapes', () => {
  const cases = [
    [{ project: 'Villion', address: 'თბილისი' }, 'TIER_1_SAME_PROJECT'],
    [{ address: 'კრწანისის ქუჩა 6, თბილისი' }, 'TIER_1_SAME_PROJECT'],
    [{ address: 'კრწანისის ქუჩა 14, თბილისი' }, 'TIER_2_SAME_STREET'],
    [{ address: 'გორგასლის ქუჩა 3' }, 'TIER_3_NEARBY_MICROLOCATION'],
    [{ address: 'ორთაჭალა, კრწანისი' }, 'TIER_4_DISTRICT'],
    [{ address: 'ვაკე, თბილისი' }, 'TIER_5_CITY'],
  ];
  for (const [listing, expected] of cases) {
    assert.equal(classifyTier(listing, SUBJECT), expected, JSON.stringify(listing));
  }
});

test('a listing with no location evidence falls to the widest tier', () => {
  // Never optimistically placed somewhere flattering.
  assert.equal(classifyTier({}, SUBJECT), 'TIER_5_CITY');
  assert.equal(classifyTier({ title: 'იყიდება ბინა' }, SUBJECT), 'TIER_5_CITY');
});

test('statistics are per tier and there is no combined figure at all', () => {
  /*
   * THE DEFECT THIS EXISTS TO PREVENT. The live report averaged 37 city
   * listings and one district listing into a single headline. There is
   * deliberately no function here that returns one number across tiers.
   */
  const listings = [
    { address: 'კრწანისის ქუჩა 6', pricePerSqm: 1800 },
    { address: 'კრწანისის ქუჩა 6', pricePerSqm: 1900 },
    { address: 'კრწანისის ქუჩა 20', pricePerSqm: 1600 },
    { address: 'ვაკე', pricePerSqm: 4300 },
    { address: 'ვაკე', pricePerSqm: 3900 },
  ];
  const stats = statsByTier(listings, (l) => classifyTier(l, SUBJECT));
  const byTier = Object.fromEntries(stats.map((s) => [s.tier, s]));

  assert.equal(byTier.TIER_1_SAME_PROJECT.sample, 2);
  assert.equal(byTier.TIER_1_SAME_PROJECT.median, 1850);
  assert.equal(byTier.TIER_2_SAME_STREET.sample, 1);
  assert.equal(byTier.TIER_5_CITY.sample, 2);
  // The expensive city pair must not contaminate the local median.
  assert.ok(byTier.TIER_1_SAME_PROJECT.median < byTier.TIER_5_CITY.median);
  assert.ok(stats.every((s) => TIER_ORDER.includes(s.tier)));
});

test('a city sample can never become the headline', () => {
  // Exactly the Villion shape: nothing local, plenty city-wide.
  const cityOnly = Array.from({ length: 37 }, (_, i) => ({
    address: 'ვაკე, თბილისი', pricePerSqm: 1500 + i,
  }));
  const stats = statsByTier(cityOnly, (l) => classifyTier(l, SUBJECT));
  assert.equal(stats.length, 1);
  assert.equal(stats[0].tier, 'TIER_5_CITY');
  assert.equal(headlineTier(stats), null, '37 city listings must not headline');
});

test('a local tier headlines as soon as it has enough observations', () => {
  const local = Array.from({ length: 3 }, () => ({
    address: 'კრწანისის ქუჩა 6', pricePerSqm: 1800,
  }));
  const stats = statsByTier(local, (l) => classifyTier(l, SUBJECT));
  const head = headlineTier(stats);
  assert.ok(head);
  assert.ok(LOCAL_TIERS.includes(head.tier));
  // Two is not a spread.
  assert.equal(headlineTier(statsByTier(local.slice(0, 2), (l) => classifyTier(l, SUBJECT))), null);
});

/* ------------------------------------------------------------------ *
 * Syndication                                                         *
 * ------------------------------------------------------------------ */

test('the same flat on four portals counts once', () => {
  /*
   * The failure that would make a wider discovery layer WORSE than the narrow
   * one: more sources finding the same flat, and a thin market looking deep.
   */
  const same = ['ss.ge', 'myhome.ge', 'korter.ge', 'place.ge'].map((source) => ({
    source, address: 'კრწანისის ქუჩა 6', area: 62, rooms: 2, price: 108000,
    url: `https://${source}/x`,
  }));
  const { unique, duplicatesRemoved } = dedupeSyndicated(same);
  assert.equal(unique.length, 1);
  assert.equal(duplicatesRemoved, 3);
});

test('two genuinely different flats in one building both survive', () => {
  const two = [
    { address: 'კრწანისის ქუჩა 6', area: 62, rooms: 2, price: 108000 },
    { address: 'კრწანისის ქუჩა 6', area: 88, rooms: 3, price: 151000 },
  ];
  assert.equal(dedupeSyndicated(two).unique.length, 2);
  assert.notEqual(syndicationKey(two[0]), syndicationKey(two[1]));
});

test('the richest copy of a duplicate is the one kept', () => {
  const thin = { address: 'კრწანისის ქუჩა 6', area: 62, rooms: 2, price: 108000 };
  const rich = { ...thin, pricePerSqm: 1742, floor: 4, condition: 'renovated', sellerType: 'OWNER' };
  const { unique } = dedupeSyndicated([thin, rich]);
  assert.equal(unique.length, 1);
  assert.equal(unique[0].sellerType, 'OWNER', 'the poorer copy won');
});

test('listings with no identifying facts are never merged together', () => {
  // Two unknowns are not evidence of one thing.
  const blanks = [{ source: 'a' }, { source: 'b' }];
  assert.equal(dedupeSyndicated(blanks).unique.length, 2);
  assert.equal(dedupeSyndicated(blanks).duplicatesRemoved, 0);
});
