// The route-only strings of Home Financing, Investment Intelligence and For Expats
// (mortgage_, inv_, expat_) are cut out of the entry into feature-<lang> chunks and load with
// those routes (src/i18n/adminSplit.ts isFeatureOnlyKey, routes.tsx withFeatureStrings).
// A screen outside those routes that names one would print a raw key until somebody happened
// to open Mortgage, so this fails the moment one does, and says which key to keep in the entry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const { translations } = await import(pathToFileURL(join(ROOT, 'src/i18n/translations.ts')).href);
const { isFeatureOnlyKey, FEATURE_ENTRY_KEYS } = await import(pathToFileURL(join(ROOT, 'src/i18n/adminSplit.ts')).href);
const en = translations.en;
const keys = Object.keys(en);

/* Everything that only renders on a route wrapped with withFeatureStrings, plus the admin console
   (it has its own lazy layout and is never the first screen of a visitor). */
const FEATURE_ROUTES = new RegExp([
  '^src/pages/(MortgagePage|InvestmentPage|ForExpatsPage|ExpatTopicPage|ExpatPlanPage)\\.tsx$',
  '^src/pages/property/MatchingWorkspacePage\\.tsx$',
  '^src/components/(mortgage|investment|expats)/',
  '^src/components/matching/workspace/MortgageBuyersSection\\.tsx$',
  '^src/(mortgage|investment|expats)/',
  '^src/(pages/admin|components/admin|admin)/',
  '^src/i18n/',
].join('|'));

function sources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { if (entry !== '__tests__') sources(full, out); continue; }
    if (/\.(tsx?|mjs|js)$/.test(entry)) out.push(full);
  }
  return out;
}

test('no screen outside the feature routes names a feature-only key', () => {
  const offenders = [];
  for (const file of sources(join(ROOT, 'src'))) {
    const rel = relative(ROOT, file).split(sep).join('/');
    if (FEATURE_ROUTES.test(rel)) continue;
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/['"`]((?:mortgage|inv|expat)_[a-z0-9_]*)(\$\{|['"`])/g)) {
      const [, lit, end] = m;
      const named = end === '${' ? keys.filter((k) => k.startsWith(lit)) : (en[lit] !== undefined ? [lit] : []);
      const split = named.filter(isFeatureOnlyKey);
      if (split.length) offenders.push(`${rel}: ${lit}${end === '${' ? '…' : ''} → ${split.slice(0, 4).join(', ')}`);
    }
  }
  assert.deepEqual(offenders, [], 'these files read feature-only strings outside their routes; add the key to FEATURE_ENTRY_KEYS or wrap the route');
});

test('the split is real: the families are cut, the shared keys stay', () => {
  assert.ok(isFeatureOnlyKey('mortgage_term_pti_body'));
  assert.ok(isFeatureOnlyKey('inv_home_title'));
  assert.ok(isFeatureOnlyKey('expat_journey_title'));
  for (const k of FEATURE_ENTRY_KEYS) {
    assert.ok(en[k] !== undefined, `${k} is kept in the entry but no longer exists`);
    assert.equal(isFeatureOnlyKey(k), false, k);
  }
  assert.equal(isFeatureOnlyKey('admin_nav_homi'), false, 'admin keys belong to the admin split');
  assert.equal(isFeatureOnlyKey('home_cta_homi'), false);
});

test('every route that renders these features waits for their strings', () => {
  const routes = readFileSync(join(ROOT, 'src/routes.tsx'), 'utf8');
  for (const page of ['MortgagePage', 'InvestmentPage', 'ForExpatsPage', 'ExpatTopicPage', 'ExpatPlanPage', 'property/MatchingWorkspacePage']) {
    assert.match(routes, new RegExp(`lazyRoute\\(withFeatureStrings\\(\\(\\) => import\\('\\./pages/${page.replace('/', '\\/')}'\\)\\)\\)`), `${page} is not wrapped`);
  }
});
