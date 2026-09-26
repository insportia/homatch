// A NUMBER THAT KNOWS WHERE IT CAME FROM.
//
// The 90-day ceiling was hardcoded in supply-discovery, and the commit that added
// it admitted in writing that it was "my guess at the Tbilisi rental market, not a
// measured number". A guess is a fine default. A guess frozen into one call site
// and read later as the market's answer is not, and nothing in the code said which
// it was.
//
// So the property under test throughout is PROVENANCE, not the numbers. Every
// ceiling carries a basis, no basis is MEASURED until something is measured, and
// the fallback announces itself as a fallback.
//
// The relative ORDER of the contexts is the one substantive claim worth defending
// before calibration: a nightly let really does go stale faster than a plot of
// land. Getting that ordering right matters more than any single magnitude.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DEFAULT_CEILING_DAYS,
  LISTING_CONTEXTS,
  ageCeilingMs,
  describeCeiling,
  listingContextFrom,
  resolveAgeCeiling,
} from '../discovery/listing-age-policy.ts';

const DAY = 86_400_000;

/* ────────────────────────────────────────────────────────────────────────
 * Nothing claims to be measured
 * ──────────────────────────────────────────────────────────────────────── */

test('no built-in ceiling claims to be MEASURED', () => {
  // Nothing has been calibrated, so nothing may say it has been. This is the
  // assertion that stops a future edit quietly promoting a guess.
  for (const context of LISTING_CONTEXTS) {
    const ceiling = resolveAgeCeiling(context);
    assert.equal(ceiling.basis, 'ASSUMED', `${context} must not claim to be measured`);
    assert.match(ceiling.rationale, /[Aa]ssumed, not measured/);
  }
});

test('the fallback says it is a fallback and claims no market', () => {
  const ceiling = resolveAgeCeiling(null);
  assert.equal(ceiling.days, DEFAULT_CEILING_DAYS);
  assert.equal(ceiling.basis, 'ASSUMED');
  assert.equal(ceiling.fellBack, true);
  assert.match(ceiling.rationale, /not a claim about any particular market/);
});

test('every description names its basis', () => {
  // A number without its provenance is the thing this module exists to prevent.
  for (const context of [...LISTING_CONTEXTS, null]) {
    assert.match(describeCeiling(resolveAgeCeiling(context)), /\[(ASSUMED|CONFIGURED|MEASURED)\]/);
  }
});

/* ────────────────────────────────────────────────────────────────────────
 * The ordering is the real claim
 * ──────────────────────────────────────────────────────────────────────── */

test('a short stay goes stale faster than a letting, a sale, and land', () => {
  const days = (c) => resolveAgeCeiling(c).days;
  assert.ok(days('SHORT_STAY') < days('RENT'), 'nightly lets turn over in weeks');
  assert.ok(days('RENT') < days('SALE'), 'a letting is taken sooner than a sale completes');
  assert.ok(days('SALE') < days('COMMERCIAL'), 'commercial space is marketed longer');
  assert.ok(days('COMMERCIAL') <= days('LAND'), 'land ages slowest of the physical assets');
  assert.ok(days('LAND') <= days('INVESTMENT'), 'a thesis outlives any single unit');
});

test('the refactor preserves the behaviour it replaces', () => {
  // 90 days was the hardcoded value. With no context and no config it must still
  // be 90, or this became a behaviour change disguised as a refactor.
  assert.equal(resolveAgeCeiling(null).days, 90);
  assert.equal(ageCeilingMs(resolveAgeCeiling(null)), 90 * DAY);
});

/* ────────────────────────────────────────────────────────────────────────
 * Configuration wins, most specific first
 * ──────────────────────────────────────────────────────────────────────── */

test('a market-scoped override beats a global one', () => {
  const config = { byContext: { RENT: 45 }, byMarket: { GE: { RENT: 30 } } };

  const ge = resolveAgeCeiling('RENT', { market: 'GE', config });
  assert.equal(ge.days, 30);
  assert.equal(ge.basis, 'CONFIGURED');
  assert.match(ge.rationale, /for RENT in GE/);

  const other = resolveAgeCeiling('RENT', { market: 'AM', config });
  assert.equal(other.days, 45, 'a different market falls to the global override');
  assert.equal(other.basis, 'CONFIGURED');
});

test('calibrating one context leaves the others alone', () => {
  // The whole point of keying by context: tuning Tbilisi rentals must not
  // re-calibrate short-stays.
  const config = { byMarket: { GE: { RENT: 30 } } };
  assert.equal(resolveAgeCeiling('RENT', { market: 'GE', config }).days, 30);
  assert.equal(
    resolveAgeCeiling('SHORT_STAY', { market: 'GE', config }).days,
    resolveAgeCeiling('SHORT_STAY').days,
    'untouched',
  );
});

test('the market key is matched case-insensitively', () => {
  const config = { byMarket: { GE: { SALE: 200 } } };
  assert.equal(resolveAgeCeiling('SALE', { market: 'ge', config }).days, 200);
});

test('a configured global default replaces the 90-day fallback', () => {
  const ceiling = resolveAgeCeiling(null, { config: { defaultDays: 150 } });
  assert.equal(ceiling.days, 150);
  assert.equal(ceiling.basis, 'CONFIGURED');
  assert.equal(ceiling.fellBack, true, 'still a fallback: no context was known');
});

/* ────────────────────────────────────────────────────────────────────────
 * A broken configuration must not empty the market
 * ──────────────────────────────────────────────────────────────────────── */

test('a non-positive or unparseable override is ignored, never clamped', () => {
  // Clamping a misconfigured 0 to 1 day would exclude essentially all evidence,
  // report a market with no supply, and look like a data problem rather than a
  // typo in a settings row.
  for (const bad of [0, -30, Number.NaN, 'soon', null, undefined, {}]) {
    const ceiling = resolveAgeCeiling('RENT', { config: { byContext: { RENT: bad } } });
    assert.equal(ceiling.days, resolveAgeCeiling('RENT').days, `override ${String(bad)} must be ignored`);
    assert.equal(ceiling.basis, 'ASSUMED');
  }
});

test('a fractional override is truncated rather than rejected', () => {
  assert.equal(resolveAgeCeiling('RENT', { config: { byContext: { RENT: 45.9 } } }).days, 45);
});

test('a broken default falls back to 90 rather than to zero', () => {
  for (const bad of [0, -1, Number.NaN, 'later']) {
    assert.equal(resolveAgeCeiling(null, { config: { defaultDays: bad } }).days, DEFAULT_CEILING_DAYS);
  }
});

/* ────────────────────────────────────────────────────────────────────────
 * Reading the context off what a campaign actually states
 * ──────────────────────────────────────────────────────────────────────── */

test('the ordinary transaction words resolve', () => {
  assert.equal(listingContextFrom({ transaction: 'rent' }), 'RENT');
  assert.equal(listingContextFrom({ transaction: 'SALE' }), 'SALE');
  assert.equal(listingContextFrom({ transaction: 'for_sale' }), 'SALE');
  assert.equal(listingContextFrom({ transaction: 'short_stay' }), 'SHORT_STAY');
  assert.equal(listingContextFrom({ transaction: 'daily' }), 'SHORT_STAY');
});

test('property type overrules the verb, because land for sale ages like land', () => {
  // 'SALE' alone would give a plot four months when it deserves a year, and the
  // verb is the less specific of the two facts.
  assert.equal(listingContextFrom({ transaction: 'SALE', propertyType: 'LAND' }), 'LAND');
  assert.equal(listingContextFrom({ transaction: 'RENT', propertyType: 'OFFICE' }), 'COMMERCIAL');
  assert.equal(listingContextFrom({ transaction: 'SALE', propertyType: 'WAREHOUSE' }), 'COMMERCIAL');
});

test('a short stay is distinguished from an ordinary letting', () => {
  assert.notEqual(
    listingContextFrom({ transaction: 'daily rent' }),
    listingContextFrom({ transaction: 'long term rent' }),
  );
  assert.equal(listingContextFrom({ transaction: 'daily rent' }), 'SHORT_STAY');
  assert.equal(listingContextFrom({ transaction: 'long term rent' }), 'RENT');
});

test('an unstated transaction is null, never guessed', () => {
  // Silently assigning SALE would hand a campaign four months of latitude it never
  // asked for, and nothing would say so.
  for (const input of [{}, { transaction: null }, { transaction: '' }, { transaction: 'unknown' }]) {
    assert.equal(listingContextFrom(input), null);
  }
});

test('the Georgian portal words resolve, since that is the market we read', () => {
  assert.equal(listingContextFrom({ transaction: 'qiravdeba' }), 'RENT');
  assert.equal(listingContextFrom({ transaction: 'ikideba' }), 'SALE');
});

/* ────────────────────────────────────────────────────────────────────────
 * It stays out of judgeDelivery's way
 * ──────────────────────────────────────────────────────────────────────── */

test('this module knows nothing about our own observation timestamps', () => {
  // published_at is the SELLER's clock. discovered_at, last_seen_at,
  // last_verified_at and content_changed_at are ours, and a re-read must never
  // make an old listing newly published. The separation is enforced by this module
  // having no opinion about any of them.
  const source = readFileSync(
    new URL('../discovery/listing-age-policy.ts', import.meta.url),
    'utf8',
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  for (const ours of ['discovered_at', 'last_seen_at', 'last_verified_at', 'content_changed_at',
    'judgeDelivery', 'validation_state']) {
    assert.doesNotMatch(
      code,
      new RegExp(ours),
      `${ours} is about what WE did; this module only bounds what the SELLER said`,
    );
  }
});
