// The parcel, the building and the flat are not the same thing.
//
// Fixtures are the verbatim identifiedParent/exactUnit shapes from a
// production report, including the one that broke the existing distinction:
// identifiedParent.code is null and the code lives inside the name.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  extractCadastralCode,
  isCadastralCode,
  parentParcelCode,
  isUnitWithinParcel,
  parcelRelation,
  isNameJustACode,
  parentDisplayName,
} from '../cadastral.ts';

const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const code = (p) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

const UNIT = '01.18.06.019.055.03.01.601';
const PARCEL = '01.18.06.019.055';

/* ── the hierarchy is in the code ────────────────────────────────────── */

test('the parcel is the first five groups of a unit code', () => {
  assert.equal(parentParcelCode(UNIT), PARCEL);
  assert.equal(parentParcelCode('01.18.06.019.055.03.01.603'), PARCEL);
});

test('a parcel code has no parent, and none is invented for it', () => {
  // This is what stops the report inventing a parent for a plot of land.
  assert.equal(parentParcelCode(PARCEL), null);
  assert.equal(isUnitWithinParcel(PARCEL), false);
  assert.equal(isUnitWithinParcel(UNIT), true);
});

test('a non-code is never treated as one', () => {
  for (const v of ['', 'Villion', '01.18', '1.2.3', null, undefined, 42, {}]) {
    assert.equal(parentParcelCode(v), null);
    assert.equal(isCadastralCode(v), false);
  }
});

test('a code embedded in prose is recovered', () => {
  // The production shape: the code arrives inside the name.
  assert.equal(extractCadastralCode('საკადასტრო კოდი 01.18.06.019.055'), PARCEL);
  assert.equal(extractCadastralCode(`ბინა N601, ს/კ ${UNIT}`), UNIT);
  assert.equal(extractCadastralCode('no code here'), null);
});

/* ── the relation the card renders ───────────────────────────────────── */

test('the distinction survives a null parent code — the production case', () => {
  // identifiedParent.code was null, so the old gate never fired and the
  // parcel was rendered as though it were the project.
  const rel = parcelRelation({
    exactUnit: { code: UNIT, verified: false, note: 'ზუსტი მიმდინარე სტატუსი საჯარო მტკიცებულებით ვერ დადასტურდა.' },
    identifiedParent: { code: null, name: 'საკადასტრო კოდი 01.18.06.019.055' },
  });
  assert.equal(rel.unitCode, UNIT);
  assert.equal(rel.parcelCode, PARCEL);
  assert.equal(rel.differs, true, 'the parcel and the flat were treated as the same thing');
  assert.equal(rel.unitVerified, false);
});

test('an unverified unit is never reported as verified', () => {
  // verified must be exactly true; a truthy string or a missing field is not
  // confirmation of anything.
  for (const v of ['false', 'true', 1, null, undefined]) {
    assert.equal(parcelRelation({ exactUnit: { code: UNIT, verified: v } }).unitVerified, v === true);
  }
  assert.equal(parcelRelation({ exactUnit: { code: UNIT, verified: true } }).unitVerified, true);
});

test('a bare parcel query has no parcel/unit split to draw', () => {
  const rel = parcelRelation({ exactUnit: { code: PARCEL, verified: true }, identifiedParent: {} });
  assert.equal(rel.parcelCode, null);
  assert.equal(rel.differs, false);
});

test('a missing or malformed report yields no relation, never a throw', () => {
  for (const v of [null, undefined, {}, 'nope', 7]) {
    const rel = parcelRelation(v);
    assert.equal(rel.differs, false);
    assert.equal(rel.unitVerified, false);
  }
});

/* ── a code is not a name ────────────────────────────────────────────── */

test('a parent whose name is only its own code is not given a name', () => {
  // "საკადასტრო კოდი 01.18.06.019.055" was rendered under the label "Project:".
  assert.equal(isNameJustACode('საკადასტრო კოდი 01.18.06.019.055'), true);
  assert.equal(parentDisplayName('საკადასტრო კოდი 01.18.06.019.055'), null);
  assert.equal(parentDisplayName(PARCEL), null);
});

test('a real project name is kept', () => {
  assert.equal(isNameJustACode('Villion'), false);
  assert.equal(parentDisplayName('Villion'), 'Villion');
  assert.equal(parentDisplayName('Villion Krtsanisi Homes'), 'Villion Krtsanisi Homes');
  // A name that carries a code as well as a real name keeps both.
  assert.equal(parentDisplayName(`Villion, ს/კ ${PARCEL}`), `Villion, ს/კ ${PARCEL}`);
});

/* ── the card uses it ────────────────────────────────────────────────── */

test('the card derives the relation instead of trusting the parent code field', () => {
  const page = code('src/pages/VerifyPage.tsx');
  const card = page.slice(page.indexOf('function IdentifiedPropertyCard'));
  const body = card.slice(0, card.indexOf('\nfunction '));

  assert.ok(/parcelRelation\(report\)/.test(body), 'the card does not derive the relation');
  assert.ok(!/parentDiffers/.test(body), 'the old null-dependent gate is still in place');
  assert.ok(/rel\.differs&&/.test(body), 'the parent-parcel label is not driven by the relation');
  assert.ok(/verify_parent_parcel_note/.test(body),
    'nothing tells the reader those records describe the land, not the unit');
  assert.ok(/parentDisplayName\(identifiedParent\?\.name\)/.test(body),
    'a bare cadastral code can still be rendered as the project name');
});

test('the parent-parcel note exists in all six languages', () => {
  const bundle = read('src/i18n/translations.ts');
  const n = bundle.split('\n  verify_parent_parcel_note: ').length - 1;
  assert.equal(n, 6, `the note is defined ${n} times, expected all six languages`);
});

test('the note never claims the unit itself was checked', () => {
  const bundle = read('src/i18n/translations.ts');
  for (const c of bundle.split('verify_parent_parcel_note: ').slice(1)) {
    const line = c.slice(0, c.indexOf('\n'));
    assert.ok(/not|არ |не |değil|ليس|אין/i.test(line),
      'the parent-parcel note reads as confirmation rather than as a limit');
  }
});
