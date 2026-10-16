// The admin console's strings ship in their own chunks (src/i18n/adminSplit.ts,
// vite.config.ts i18nLanguageChunks, src/i18n/bundles.ts loadAdminStrings).
// A customer screen that names one of them would read English-or-nothing until
// an admin page had loaded, so: no file outside the admin console may name an
// admin-only key, literally or as the head of a template.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const { translations } = await import(join(ROOT, 'src/i18n/translations.ts'));
const { isAdminOnlyKey, CUSTOMER_ADMIN_PREFIXES } = await import(join(ROOT, 'src/i18n/adminSplit.ts'));
const en = translations.en;
const keys = Object.keys(en);

/* The admin console: everything that only ever renders inside AdminLayout. */
const ADMIN_CONSOLE = /^src\/(pages\/admin|components\/admin|admin)\/|^src\/components\/layouts\/AdminLayout\.tsx$|^src\/i18n\//;

function sources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { if (entry !== '__tests__') sources(full, out); continue; }
    if (/\.(tsx?|mjs|js)$/.test(entry)) out.push(full);
  }
  return out;
}

test('no customer screen names an admin-only key', () => {
  const offenders = [];
  for (const file of sources(join(ROOT, 'src'))) {
    const rel = relative(ROOT, file).split(sep).join('/');
    if (ADMIN_CONSOLE.test(rel)) continue;
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/['"`](admin_[a-z0-9_]*)(\$\{|['"`])/g)) {
      const [, lit, end] = m;
      // A template head (`admin_x_${…}`) names every key it can expand to;
      // a whole literal names a key only if English has it (RPC names do not).
      const named = end === '${' ? keys.filter((k) => k.startsWith(lit)) : (en[lit] !== undefined ? [lit] : []);
      const adminOnly = named.filter(isAdminOnlyKey);
      if (adminOnly.length) offenders.push(`${rel}: ${lit}${end === '${' ? '…' : ''} → ${adminOnly.slice(0, 3).join(', ')}`);
    }
  }
  assert.deepEqual(offenders, [], 'these customer files read admin-only strings; add their family to CUSTOMER_ADMIN_PREFIXES or rename the keys');
});

test('the split is real: most admin_ keys leave the entry, the customer families stay', () => {
  const admin = keys.filter((k) => k.startsWith('admin_'));
  const leaving = admin.filter(isAdminOnlyKey);
  assert.ok(leaving.length > admin.length * 0.9, `only ${leaving.length}/${admin.length} admin_ keys are split out`);
  for (const p of CUSTOMER_ADMIN_PREFIXES) {
    const family = keys.filter((k) => k.startsWith(p));
    assert.ok(family.length > 0, `${p} names no key any more; drop it from CUSTOMER_ADMIN_PREFIXES`);
    assert.ok(family.every((k) => !isAdminOnlyKey(k)), `${p} keys must stay in the entry`);
  }
});

test('the admin layout is lazy and waits for the admin strings', () => {
  const routes = readFileSync(join(ROOT, 'src/routes.tsx'), 'utf8');
  assert.doesNotMatch(routes, /^import AdminLayout from/m, 'a static import puts the admin console back in the entry chunk');
  assert.match(routes, /const AdminLayout = lazyRoute\(\(\) =>\s*Promise\.all\(\[import\('\.\/components\/layouts\/AdminLayout'\), loadAdminStrings\(\)\]\)/);
  const bundles = readFileSync(join(ROOT, 'src/i18n/bundles.ts'), 'utf8');
  for (const lang of ['en', 'ka', 'ru', 'tr', 'ar', 'he']) {
    assert.ok(bundles.includes(`import('virtual:homatch-i18n/admin-${lang}')`), `no admin chunk loader for ${lang}`);
  }
});
