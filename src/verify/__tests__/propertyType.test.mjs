// What the property-type badge is allowed to say.
//
// Every label below is a VERBATIM entityType from a production report. They
// come from sixteen runs of the SAME cadastral code, which between them
// produced thirteen different answers to "what is this property?" — several
// of which just handed the customer's own input back to them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assetClassLabelKey,
  isUsableTypeLabel,
  propertyTypeDisplay,
  ASSET_CLASS_LABEL_KEYS,
} from '../propertyType.ts';

const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const code = (p) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

/* ── labels that restate the customer's own input ────────────────────── */

test('a label that only describes the cadastral reference is rejected', () => {
  // All six were shown to customers as the property type.
  for (const label of [
    'საკადასტრო იდენტიფიკატორი',
    'ინდივიდუალური საკადასტრო ერთეული',
    'უძრავი ქონების ერთეული',
    'უძრავი ქონების საკადასტრო ერთეული',
    'კადასტრული ერთეული',
    'საკადასტრო კოდით იდენტიფიცირებული ერთეული',
    'ინდივიდუალური უძრავი ერთეული',
  ]) {
    assert.equal(isUsableTypeLabel(label), false, `"${label}" would still be shown`);
  }
});

test('a label that actually describes the property survives', () => {
  for (const label of [
    'საცხოვრებელი ბინა',
    'მშენებარე ბინა',
    'მშენებარე საცხოვრებელი ბინა',
    'მშენებარე ბინა N601',
    'ბინა / უძრავი ქონების ერთეული',
    'ინდივიდუალური საკუთრების ერთეული / ბინა / ფართი',
  ]) {
    assert.equal(isUsableTypeLabel(label), true, `"${label}" was dropped`);
  }
});

test('an internal enum never reaches the badge', () => {
  // REAL_ESTATE_UNIT was a real production entityType; UNKNOWN was the
  // server's own fallback string.
  assert.equal(isUsableTypeLabel('REAL_ESTATE_UNIT'), false);
  assert.equal(isUsableTypeLabel('UNKNOWN'), false);
  assert.equal(isUsableTypeLabel('MIXED_OR_UNKNOWN'), false);
});

test('a caveat pinned to the label with a semicolon is not badge material', () => {
  // Real information, wrong place — a badge cannot carry a qualification.
  assert.equal(
    isUsableTypeLabel('ცალკე საკადასტრო ერთეული; ფუნქციური სახეობა დაუდასტურებელია'),
    false
  );
});

test('empty and non-string labels are rejected without throwing', () => {
  for (const v of ['', '  ', null, undefined, 42, {}, '—']) {
    assert.equal(isUsableTypeLabel(v), false);
  }
});

/* ── the class is what the badge prefers ─────────────────────────────── */

test('a resolved class wins over the model prose, so the label is stable', () => {
  // The same property must not be a different kind of thing on a rerun.
  const a = propertyTypeDisplay({ assetClass: 'APARTMENT_IN_PROJECT', entityType: 'საცხოვრებელი ბინა' });
  const b = propertyTypeDisplay({ assetClass: 'APARTMENT_IN_PROJECT', entityType: 'მშენებარე ბინა N601' });
  assert.deepEqual(a, b);
  assert.deepEqual(a, { kind: 'LABEL', labelKey: 'verify_asset_apartment_in_project' });
});

test('the description is used only when there is no class to show', () => {
  assert.deepEqual(
    propertyTypeDisplay({ assetClass: 'MIXED_OR_UNKNOWN', entityType: 'მშენებარე საცხოვრებელი ბინა' }),
    { kind: 'TEXT', text: 'მშენებარე საცხოვრებელი ბინა' }
  );
});

test('an unknown class with a tautological description shows nothing at all', () => {
  // Better a gap than handing the customer their own input back.
  assert.deepEqual(
    propertyTypeDisplay({ assetClass: 'MIXED_OR_UNKNOWN', entityType: 'საკადასტრო იდენტიფიკატორი' }),
    { kind: 'NONE' }
  );
  assert.deepEqual(propertyTypeDisplay({}), { kind: 'NONE' });
  assert.deepEqual(propertyTypeDisplay(null), { kind: 'NONE' });
});

test('MIXED_OR_UNKNOWN has no label of its own', () => {
  // "Mixed or unknown" is an engineering answer, not something to tell a buyer.
  assert.equal(assetClassLabelKey('MIXED_OR_UNKNOWN'), null);
  assert.equal(assetClassLabelKey(null), null);
  assert.equal(assetClassLabelKey('APARTMENT_IN_PROJECT'), 'verify_asset_apartment_in_project');
});

/* ── the server resolves the class from evidence ─────────────────────── */

test('an unknown class is repaired from evidence already in the report', () => {
  const agent = code('supabase/functions/research-agent/index.ts');
  const fn = agent.slice(agent.indexOf('function resolveAssetClass'));
  const body = fn.slice(0, fn.indexOf('\n}'));

  assert.ok(/declared !== 'MIXED_OR_UNKNOWN'/.test(body),
    'a confident classification from the model is no longer preserved');
  assert.ok(/projectName && developer && unitCode/.test(body),
    'the class is inferred from less than a named project, a developer and a unit');
  assert.ok(/return declared \|\| 'MIXED_OR_UNKNOWN'/.test(body),
    'an unevidenced property is given a class anyway');
});

test('a present-but-null profile is not evidence of anything', () => {
  // Reports carry "landProfile": null as a KEY — the field is present and
  // empty. Testing for the key rather than for a value would classify every
  // apartment in the database as a land plot. (Found while simulating this
  // classifier in SQL, where the key test does match and produced exactly
  // that false LAND upgrade.)
  const agent = code('supabase/functions/research-agent/index.ts');
  const fn = agent.slice(agent.indexOf('function resolveAssetClass'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.ok(/if \(r\?\.landProfile && !projectName\)/.test(body),
    'the land branch no longer requires a truthy profile');
  assert.ok(!/'landProfile' in r|hasOwnProperty\('landProfile'\)/.test(body),
    'the land branch tests for the key rather than for a value');
});

test('the repair runs on READ, so reports already in the database benefit', () => {
  // The privacy work established the rule: a fix at the customer-report
  // boundary has to cover what is already persisted, not only new runs.
  const agent = code('supabase/functions/research-agent/index.ts');
  const readPath = agent.slice(agent.indexOf('const r: any = sanitizeCustomerReport'));
  assert.ok(/r\.assetClass = resolveAssetClass\(r\)/.test(readPath.slice(0, 400)),
    'a historical report keeps its stale MIXED_OR_UNKNOWN forever');
});

test('the classifier reads the report shape, not pipeline internals', () => {
  // That is what lets one rule serve both boundaries.
  const agent = code('supabase/functions/research-agent/index.ts');
  const fn = agent.slice(agent.indexOf('function resolveAssetClass'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.ok(/r\?\.projectProfile\?\.name/.test(body), 'it does not read the assembled report');
  assert.ok(!/\bi\.project\b|\bo\.landProfile\b/.test(body),
    'it reaches into pipeline variables and cannot run on a persisted report');
});

test('the raw UNKNOWN enum is no longer emitted as a customer label', () => {
  const agent = code('supabase/functions/research-agent/index.ts');
  assert.ok(!/i\.entity\?\.type \|\| 'UNKNOWN'/.test(agent),
    "entityType still falls back to the literal 'UNKNOWN'");
});
test('the badge goes through the presentation boundary at every call site', () => {
  const page = code('src/pages/VerifyPage.tsx');
  assert.ok(!/report\.entityType\|\|mode/.test(page),
    'a call site still renders the raw entityType');
  assert.equal(page.split('<PropertyTypeBadge report={report} mode={mode}/>').length - 1, 3,
    'not every badge site uses the shared component');
});

test('the translation bundle actually parses', async () => {
  // Every Verify fix adds copy in six languages, and the six-language
  // assertions elsewhere in this suite read the bundle as TEXT — a regex
  // over a broken file still matches. `tsc --noEmit` does not cover
  // translations.ts either, so an unescaped apostrophe in one string got
  // all the way to the build step before anything complained. Importing it
  // turns that into a failing test instead.
  const bundle = await import('../../i18n/translations.ts');
  assert.ok(bundle.translations, 'the bundle exports no translations');
  for (const lang of ['en', 'ka', 'ru', 'tr', 'ar', 'he']) {
    assert.ok(bundle.translations[lang], `${lang} is missing from the bundle`);
  }
});

test('every asset class has copy in all six languages', () => {
  const bundle = read('src/i18n/translations.ts');
  for (const key of [...Object.values(ASSET_CLASS_LABEL_KEYS), 'verify_mode_cadastral', 'verify_mode_property']) {
    const n = bundle.split(`\n  ${key}: `).length - 1;
    assert.equal(n, 6, `${key} is defined ${n} times, expected all six languages`);
  }
});
