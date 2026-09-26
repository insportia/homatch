// THE FILTER THAT HID HALF THE MARKET.
//
// placeNamesFor() returns the canonical spellings this core knows, and every one of
// them is LOWERCASE, because that is how the PLACES table stores them:
//
//   placeNamesFor('Tbilisi') -> ["tbilisi", "თბილისი", "тбилиси", "tiflis"]
//
// supply_observations holds 'Tbilisi' with a capital T. Measured in production
// 2026-09-26:
//
//   'Tbilisi'  12 rows   (2 of them older than the 120-day SALE ceiling)
//   'თბილისი'   8 rows
//   'tbilisi'   1 row
//
// Postgres IN is case-SENSITIVE, so `.in('city', placeNamesFor(city))` matched 9 of 21
// and silently dropped the 12 capitalised ones -- including BOTH rows old enough to
// fail the publication-age ceiling. A run that should have rejected two rejected none,
// and the number looked perfectly healthy.
//
// Nothing else could have caught this. tsgo sees a valid query, the edge parser sees
// valid syntax, and every unit test passes because the module-level comparison
// (comparePlaces) handles case perfectly well -- it simply never saw the rows. It was
// found by checking that 9 and 21 did not add up.
//
// So this asserts the SHAPE of the filter at every call site that narrows by city.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { comparePlaces, placeNamesFor } from '../../src/research-core/normalize/place.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every edge function that narrows a query by city through placeNamesFor(). */
const CALLERS = ['supply-matching', 'supply-discovery'];

function sourceOf(slug) {
  return readFileSync(join(root, 'supabase', 'functions', slug, 'index.ts'), 'utf8');
}

test('placeNamesFor returns lowercase, which is the premise of the bug', () => {
  // If this ever starts returning capitalised names, the ilike filters below become
  // belt-and-braces rather than load-bearing -- and this test should be the thing that
  // tells somebody, rather than a silently under-read market.
  const names = placeNamesFor('Tbilisi');
  assert.ok(names.length > 1, 'guard: Tbilisi has several known spellings');
  for (const name of names) {
    assert.equal(
      name, name.toLowerCase(),
      `placeNamesFor returned a name with uppercase characters: ${name}`,
    );
  }
});

test('the module-level comparison is case-insensitive, so only the QUERY was wrong', () => {
  // comparePlaces handles case perfectly. That is exactly why the bug was invisible:
  // the decision was right and the rows never arrived to be decided about.
  assert.equal(comparePlaces('Tbilisi', 'tbilisi'), 'AGREE');
  assert.equal(comparePlaces('Tbilisi', 'თბილისი'), 'AGREE');
  assert.equal(comparePlaces('TBILISI', 'Tbilisi'), 'AGREE');
});

test('no city filter uses a case-sensitive IN against placeNamesFor', () => {
  for (const slug of CALLERS) {
    const code = sourceOf(slug)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(
      code,
      /\.in\(\s*'city'/,
      `${slug} narrows by city with a case-sensitive IN, which hid 12 of 21 Tbilisi rows`,
    );
  }
});

test('every city filter is a case-insensitive ilike over the known spellings', () => {
  for (const slug of CALLERS) {
    const code = sourceOf(slug)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    assert.match(
      code,
      /placeNamesFor\(/,
      `${slug} must narrow by the known spellings rather than one string`,
    );
    assert.match(
      code,
      /city\.ilike\./,
      `${slug} must compare case-insensitively; the column holds 'Tbilisi' and the `
      + 'vocabulary holds "tbilisi"',
    );
  }
});

test('the filter is built from every known spelling, not just the first', () => {
  // `city.ilike.tbilisi` alone would still miss 'თბილისი' -- the whole point of having
  // a place vocabulary is that one market has several names.
  for (const slug of CALLERS) {
    const code = sourceOf(slug);
    assert.match(
      code,
      /\.map\(\(name\) => `city\.ilike\.\$\{name\}`\)\.join\(','\)/,
      `${slug} must expand every spelling into the filter`,
    );
  }
});

test('an ilike without a wildcard is an exact match, so the filter cannot over-read', () => {
  /*
   * The other direction of the same risk. If a future edit added a `%`, 'tbilisi' would
   * start matching anything containing it -- and there is no city this would help with
   * while there are plenty it would wrongly include.
   */
  for (const slug of CALLERS) {
    const code = sourceOf(slug);
    assert.doesNotMatch(
      code,
      /city\.ilike\.%/,
      `${slug} uses a wildcard city match, which over-reads instead of under-reading`,
    );
    assert.doesNotMatch(code, /city\.ilike\.\$\{name\}%/, `${slug} appends a wildcard`);
  }
});
