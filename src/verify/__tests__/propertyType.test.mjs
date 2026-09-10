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
import { resolveAssetClass } from '../researchPlan.ts';

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
  // A named project, a developer behind it, and an identified unit inside it.
  assert.equal(
    resolveAssetClass({
      assetClass: 'MIXED_OR_UNKNOWN',
      projectProfile: { name: 'Villion', developer: 'Millenio Group' },
      exactUnit: { code: '01.18.06.019.055.03.01.601' },
    }),
    'APARTMENT_IN_PROJECT'
  );
});

test('a class the model committed to is never overridden', () => {
  // The repair fills in an unknown; it does not second-guess a decision.
  assert.equal(
    resolveAssetClass({
      assetClass: 'PRIVATE_RESALE',
      projectProfile: { name: 'Villion', developer: 'Millenio Group' },
      exactUnit: { code: '01.18.06.019.055.03.01.601' },
    }),
    'PRIVATE_RESALE'
  );
});

test('an unevidenced property is left unknown rather than given a class', () => {
  assert.equal(resolveAssetClass({ assetClass: 'MIXED_OR_UNKNOWN' }), 'MIXED_OR_UNKNOWN');
  assert.equal(resolveAssetClass({}), 'MIXED_OR_UNKNOWN');
  // Two of the three pieces is not enough.
  assert.equal(
    resolveAssetClass({ projectProfile: { name: 'Villion', developer: 'Millenio Group' } }),
    'MIXED_OR_UNKNOWN'
  );
});

test('a present-but-null profile is not evidence of anything', () => {
  // Reports carry "landProfile": null as a KEY — present and empty. Testing
  // for the key rather than a value classifies every apartment as land.
  assert.equal(resolveAssetClass({ landProfile: null, exactUnit: { code: '01.18.06.019.055.03.01.603' } }), 'MIXED_OR_UNKNOWN');
  // A real land profile with no project on it does classify as land.
  assert.equal(resolveAssetClass({ landProfile: { area: '1,240 კვ.მ' } }), 'LAND');
});

test('the repair runs on READ, so reports already in the database benefit', () => {
  const agent = code('supabase/functions/research-agent/index.ts');
  const readPath = agent.slice(agent.indexOf('const r: any = sanitizeCustomerReport'));
  assert.ok(/r\.assetClass = resolveAssetClass\(r\)/.test(readPath.slice(0, 400)),
    'a historical report keeps its stale MIXED_OR_UNKNOWN forever');
});

test('the classifier is shared with the edge function, not duplicated in it', () => {
  // A copy kept in sync by hand proves nothing about what ships.
  const agent = code('supabase/functions/research-agent/index.ts');
  assert.ok(!/function resolveAssetClass\(/.test(agent), 'the classifier was copied back into the edge function');
  assert.ok(/from '\.\.\/\.\.\/\.\.\/src\/verify\/researchPlan\.ts'/.test(agent),
    'the edge function no longer imports the shared classifier');
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
