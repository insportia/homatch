// Email Studio's strings ship in their own chunks (src/i18n/adminSplit.ts isStudioOnlyKey,
// vite.config.ts i18nLanguageChunks, src/i18n/bundles.ts loadStudioStrings). A screen outside
// Email Studio that names one would read the raw key until a studio page had loaded, so: only the
// Email Studio screens (and the admin email review page, which loads them too) may name a
// studio-only key, literally or as the head of a template.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const { translations } = await import(pathToFileURL(join(ROOT, 'src/i18n/translations.ts')).href);
const { isStudioOnlyKey, STUDIO_ENTRY_PREFIXES } = await import(pathToFileURL(join(ROOT, 'src/i18n/adminSplit.ts')).href);
const en = translations.en;
const keys = Object.keys(en);

/* The screens that load Email Studio's strings before they render (routes.tsx withStudioStrings). */
const STUDIO_SCREENS = /^src\/pages\/outreach\/studio\/|^src\/components\/emailStudio\/(EmailDesigner|HomiPanel|shared)\.tsx$|^src\/pages\/admin\/AdminEmailReviewPage\.tsx$|^src\/i18n\//;

function sources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { if (entry !== '__tests__') sources(full, out); continue; }
    if (/\.(tsx?|mjs|js)$/.test(entry)) out.push(full);
  }
  return out;
}

test('no screen outside Email Studio names a studio-only key', () => {
  const offenders = [];
  for (const file of sources(join(ROOT, 'src'))) {
    const rel = relative(ROOT, file).split(sep).join('/');
    if (STUDIO_SCREENS.test(rel)) continue;
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/['"`](ems_[a-z0-9_]*)(\$\{|['"`])/g)) {
      const [, lit, end] = m;
      const named = end === '${' ? keys.filter((k) => k.startsWith(lit)) : (en[lit] !== undefined ? [lit] : []);
      const only = named.filter(isStudioOnlyKey);
      if (only.length) offenders.push(`${rel}: ${lit}${end === '${' ? '…' : ''} → ${only.slice(0, 3).join(', ')}`);
    }
  }
  assert.deepEqual(offenders, [], 'these files read studio-only strings outside Email Studio; keep them in the entry (STUDIO_ENTRY_PREFIXES) or move the screen into Email Studio');
});

test('the split is real: Email Studio strings leave the entry, the rail labels stay', () => {
  const studio = keys.filter((k) => k.startsWith('ems_'));
  const leaving = studio.filter(isStudioOnlyKey);
  assert.ok(leaving.length > studio.length * 0.9, `only ${leaving.length}/${studio.length} ems_ keys are split out`);
  for (const p of STUDIO_ENTRY_PREFIXES) {
    const family = keys.filter((k) => k.startsWith(p));
    assert.ok(family.length > 0, `${p} names no key any more; drop it from STUDIO_ENTRY_PREFIXES`);
    assert.ok(family.every((k) => !isStudioOnlyKey(k)), `${p} keys must stay in the entry`);
  }
});

test('every Email Studio route waits for the studio strings', () => {
  const routes = readFileSync(join(ROOT, 'src/routes.tsx'), 'utf8');
  for (const page of ['EmailDashboardPage', 'EmailCampaignListPage', 'EmailCampaignWorkspacePage', 'EmailTemplatesPage', 'EmailAnalyticsPage', 'EmailDeliverabilityPage', 'AdminEmailReviewPage']) {
    assert.match(routes, new RegExp(`const ${page} = lazyRoute\\(withStudioStrings\\(`), `${page} renders before its strings arrive`);
  }
  const bundles = readFileSync(join(ROOT, 'src/i18n/bundles.ts'), 'utf8');
  for (const lang of ['en', 'ka', 'ru', 'tr', 'ar', 'he']) {
    assert.ok(bundles.includes(`import('virtual:homatch-i18n/studio-${lang}')`), `no studio chunk loader for ${lang}`);
  }
});
