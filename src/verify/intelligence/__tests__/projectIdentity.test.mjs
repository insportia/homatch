// One development, one key.
//
// Production held "Kristian Stiven St, 18" and "Kristian Stiven Street, 18" as
// two PROJECT entities, seven facts each. A verification arriving through one
// could not see anything learned through the other, so the project's floors
// were stored twice and reusable half the time.
//
// The tests below come in two halves, and the second half is the important
// one. Merging too eagerly is far worse than not merging: two developments
// wrongly fused would put one building's floor count, developer and
// commissioning status into the other's report.

import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalProjectKey, sameProject, scriptOf, aliasKeysFor } from '../projectIdentity.ts';

/* ── the production case ─────────────────────────────────────────────── */

test('the two entities production actually split now share one key', () => {
  assert.ok(sameProject('Kristian Stiven St, 18', 'Kristian Stiven Street, 18'));
  assert.equal(canonicalProjectKey('Kristian Stiven St, 18'), 'kristian-stiven-street-18');
  assert.equal(canonicalProjectKey('Kristian Stiven Street, 18'), 'kristian-stiven-street-18');
});

test('a house number means the same thing whether it leads or trails', () => {
  assert.ok(sameProject('18 Kristian Stiven Street', 'Kristian Stiven Street, 18'));
  assert.ok(sameProject('18 Kristian Stiven St', 'Kristian Stiven Street 18'));
});

/* ── abbreviations ───────────────────────────────────────────────────── */

test('common Latin street-type abbreviations collapse', () => {
  for (const [a, b] of [
    ['Rustaveli Ave 12', 'Rustaveli Avenue 12'],
    ['Chavchavadze Av 5', 'Chavchavadze Avenue 5'],
    ['Vake Rd 3', 'Vake Road 3'],
    ['Saburtalo Blvd 7', 'Saburtalo Boulevard 7'],
    ['Mtatsminda Sq 1', 'Mtatsminda Square 1'],
    ['Digomi Ln 9', 'Digomi Lane 9'],
    ['Vera Dr 4', 'Vera Drive 4'],
    ['Kakheti Hwy 21', 'Kakheti Highway 21'],
    ['Tabidze Str 6', 'Tabidze Street 6'],
  ]) {
    assert.ok(sameProject(a, b), `${a} and ${b} did not canonicalise together`);
  }
});

test('punctuation, case and spacing are not identity', () => {
  assert.ok(sameProject('Kristian  Stiven   Street,18', 'kristian stiven street 18'));
  assert.ok(sameProject('KRISTIAN-STIVEN-ST-18', 'Kristian Stiven Street, 18'));
});

test('a leading zero on a house number is a spelling, not a different house', () => {
  assert.ok(sameProject('Kristian Stiven Street 018', 'Kristian Stiven Street 18'));
});

/* ── transliteration and script ──────────────────────────────────────── */

test('the Georgian word for street canonicalises to the Latin one', () => {
  // ქუჩა is street. This mapping is fixed, not a guess, so a Georgian-script
  // source and a Latin-script source describing one address agree.
  assert.equal(canonicalProjectKey('ქრისტიან სტივენ ქუჩა 18'), 'ქრისტიან-სტივენ-street-18');
  assert.ok(sameProject('ქრისტიან სტივენ ქუჩა 18', 'ქრისტიან სტივენ ქ. 18'));
});

test('Georgian avenue, square and lane map to their Latin equivalents', () => {
  assert.ok(sameProject('რუსთაველის გამზირი 12', 'რუსთაველის გამზ. 12'));
  assert.equal(canonicalProjectKey('თავისუფლების მოედანი 4'), 'თავისუფლების-square-4');
  assert.equal(canonicalProjectKey('დიღომი ჩიხი 9'), 'დიღომი-lane-9');
});

test('Russian street words from cross-posted listings map too', () => {
  assert.ok(sameProject('Руставели проспект 12', 'Руставели пр 12'));
  assert.ok(sameProject('Табидзе улица 6', 'Табидзе ул 6'));
});

/* ── the half that matters more: what must NOT merge ─────────────────── */

test('a street and an avenue of the same name stay apart', () => {
  // Both exist in Tbilisi. Collapsing the type word instead of canonicalising
  // it would have merged them, and put one building's facts in the other's
  // report.
  assert.ok(!sameProject('Chavchavadze Street 5', 'Chavchavadze Avenue 5'));
});

test('different house numbers on one street stay apart', () => {
  assert.ok(!sameProject('Kristian Stiven Street 18', 'Kristian Stiven Street 20'));
});

test('a project with no number is not the same as one with a number', () => {
  assert.ok(!sameProject('Kristian Stiven Street', 'Kristian Stiven Street 18'));
});

test('two transliterations of one name are still two entities, deliberately', () => {
  // "Kristian Stiven" and "Kristiana Steven" really are the same Georgian
  // name, and this does NOT merge them. A rule loose enough to fuse those
  // spellings is loose enough to fuse two different developments that share a
  // syllable, and one wrong merge costs a buyer more than two entities do.
  // Documented as a known limit rather than silently half-handled.
  assert.ok(!sameProject('Kristian Stiven Street 18', 'Kristiana Steven Street 18'));
});

test('names that merely share a word stay apart', () => {
  assert.ok(!sameProject('Green Park Residence', 'Green Valley Residence'));
  assert.ok(!sameProject('Park Avenue Residence', 'Residence Avenue Park'));
});

/* ── the shape of the key ────────────────────────────────────────────── */

test('too short to be a project name yields nothing', () => {
  assert.equal(canonicalProjectKey('  '), null);
  assert.equal(canonicalProjectKey('A'), null);
  assert.equal(canonicalProjectKey(null), null);
  assert.equal(canonicalProjectKey(undefined), null);
});

test('a plain project name is unchanged apart from shaping', () => {
  assert.equal(canonicalProjectKey('Villion Krtsanisi Homes'), 'villion-krtsanisi-homes');
});

test('sameProject is false when either side has no key at all', () => {
  assert.ok(!sameProject('', ''));
  assert.ok(!sameProject(null, null));
});

/* ── cross-script identity, by evidence rather than by guessing ──────
 *
 * canonicalProjectKey normalises the street-type word across scripts but not
 * the name, so `kristian-stiven-street-18` and `კრისტიან-სტივენის-street-18`
 * stayed two entities and split again in production within the hour.
 *
 * Transliteration does not close it: the Georgian genitive makes
 * "სტივენის" -> "stivenis", not "stiven", and stripping case endings is
 * morphology, not a deterministic rewrite. So spellings are REMEMBERED
 * instead — a name seen for a project resolves to it next time.
 */

test('a name is recognised by its script without being rewritten', () => {
  assert.equal(scriptOf('Kristian Stiven Street, 18'), 'LATIN');
  assert.equal(scriptOf('კრისტიან სტივენის ქუჩა №18'), 'GEORGIAN');
  assert.equal(scriptOf('Руставели проспект 12'), 'CYRILLIC');
  assert.equal(scriptOf('Villion კრწანისი'), 'MIXED');
  assert.equal(scriptOf('18'), 'UNKNOWN');
  assert.equal(scriptOf(null), 'UNKNOWN');
});

test('every observed spelling becomes a key that can be looked up', () => {
  const keys = aliasKeysFor([
    'Kristian Stiven Street, 18',
    '18 Kristian Stiven St',
    'კრისტიან სტივენის ქუჩა №18',
  ]);
  // The two Latin spellings canonicalise together; the Georgian one is its own
  // key, which is exactly why it has to be remembered rather than derived.
  assert.equal(keys.length, 2);
  assert.ok(keys.some((k) => k.key === 'kristian-stiven-street-18' && k.script === 'LATIN'));
  assert.ok(keys.some((k) => k.script === 'GEORGIAN'));
});

test('aliases carry their raw spelling for a human to audit', () => {
  const [a] = aliasKeysFor(['  Kristian Stiven Street, 18  ']);
  assert.equal(a.raw, 'Kristian Stiven Street, 18');
  assert.equal(a.key, 'kristian-stiven-street-18');
});

test('an unusable name yields no alias at all', () => {
  assert.deepEqual(aliasKeysFor(['', '  ', null, undefined, 'A']), []);
  assert.deepEqual(aliasKeysFor([]), []);
});

test('the same spelling twice is remembered once', () => {
  const keys = aliasKeysFor(['Kristian Stiven Street 18', 'kristian stiven st, 18']);
  assert.equal(keys.length, 1, 'one spelling was recorded twice under one key');
});
