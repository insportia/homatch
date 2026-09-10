// ONE HOMATCH — the product-shape invariants.
//
// These assert what must NOT exist. That is an unusual thing to test, and it
// is the point: a second customer-facing workspace does not come back as a
// deliberate decision, it comes back one route and one button at a time,
// and by then the customer has two mental models for the same property.
//
// The internal implementation still uses deal_room* names in the database
// and in module paths. That is deliberate and stays: renaming live tables
// for branding is migration risk with no customer benefit. What matters is
// that no CUSTOMER ever meets the term.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

function* walk(dir, skip = new Set(['node_modules', 'dist', '.git', '.dist-ci'])) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full, skip);
    else if (['.ts', '.tsx'].includes(extname(name))) yield full;
  }
}

/* ── one verification experience, not two products ──────────────────── */

test('no customer-facing string anywhere says "Deal Room"', () => {
  // The database and the module paths may say it; a screen may not.
  const offenders = [];
  for (const file of walk(join(ROOT, 'src'))) {
    const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/');
    // Strip what is legitimately allowed to say it: import specifiers (the
    // module tree keeps its names), and comments — explaining why the product
    // was removed is not the same as shipping the term to a customer.
    const src = readFileSync(file, 'utf8')
      .replace(/import\s*\{?[^;]*?\}?\s*from\s*['"][^'"]+['"];?/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const m of src.matchAll(/['"`>]\s*([^'"`<>]{0,40}?Deal\s?Rooms?[^'"`<>]{0,40}?)\s*['"`<]/gi)) {
      offenders.push(`${rel}: ${m[1].trim()}`);
    }
  }
  assert.deepEqual(offenders, [], `customer-facing "Deal Room" copy:\n${offenders.join('\n')}`);
});

test('the translation bundle has no Deal Room terminology in any language', () => {
  const bundle = read('src/i18n/translations.ts');
  assert.equal(/deal[_ ]?room/i.test(bundle), false, 'Deal Room copy is back in the bundle');
});

test('there is one verification destination, and legacy links redirect to it', () => {
  const routes = read('src/routes.tsx');
  assert.ok(/path: '\/verify'/.test(routes), 'the Verification Center route is gone');
  assert.ok(/path: '\/verify\/:id'/.test(routes), 'the Verification Case route is gone');
  // Old deep links must keep working rather than 404 — but only as redirects.
  assert.ok(/\/deal-rooms[\s\S]{0,120}LegacyDealRoomRedirect/.test(routes),
    'old /deal-rooms links no longer redirect to the canonical case');
  assert.ok(!/path: '\/deal-rooms'[^\n]*element: <(?!LegacyDealRoomRedirect)/.test(routes),
    'a real Deal Room page is mounted again');
});

test('Deal Room is not a navigation destination', () => {
  const header = read('src/components/layouts/AppHeader.tsx');
  const mobile = existsSync(join(ROOT, 'src/components/layouts/MobileBottomNav.tsx'))
    ? read('src/components/layouts/MobileBottomNav.tsx') : '';
  for (const [name, src] of [['header', header], ['mobile nav', mobile]]) {
    assert.ok(!/deal-rooms/.test(src), `${name} links to a Deal Room product`);
    assert.ok(!/Deal Room/i.test(src), `${name} names Deal Room`);
  }
});

test('finishing a verification does not offer to create a second thing', () => {
  // "Create Deal Room" after Verify was the moment the product split in two.
  const page = read('src/pages/VerifyPage.tsx');
  assert.ok(!/create[_ ]?deal[_ ]?room/i.test(page.replace(/createDealRoomFromVerify/g, '')),
    'the page offers to create a separate workspace');
  // The case is SAVED automatically instead — the same run becomes the case.
  assert.ok(/saveCase\(/.test(page), 'the verification no longer persists as its own case');
});

/* ── the customer never meets engineering vocabulary ─────────────────── */

test('no internal vocabulary is rendered by the verification screens', () => {
  const surfaces = [
    'src/pages/VerifyPage.tsx',
    'src/components/verify/VerifyReport.tsx',
    'src/components/verify/ResearchStream.tsx',
  ].map(read).join('\n');
  // Strip comments: prose ABOUT the rule must not trip the rule.
  const code = surfaces.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .filter((l) => !l.trim().startsWith('//')).join('\n');
  // Rendered text only — identifiers legitimately mention these.
  for (const word of ['FSM', 'browserless', 'playwright', 'research-agent']) {
    const inJsxText = new RegExp(`>[^<>{}]*\\b${word}\\b[^<>{}]*<`, 'i');
    assert.ok(!inJsxText.test(code), `"${word}" is rendered to the customer`);
  }
});

/* ── the security tightening is recorded, not just applied ───────────── */

test('the anon grant revoke on research_jobs is committed as a migration', () => {
  // It was applied to production directly; without the file the repository
  // would disagree with the database and the next reader would not know why
  // research_jobs differs from every other case table.
  const dir = join(ROOT, 'supabase/migrations');
  const file = readdirSync(dir).find((f) => f.includes('revoke_anon_grants_on_research_jobs'));
  assert.ok(file, 'the revoke migration is not in the repository');
  const sql = readFileSync(join(dir, file), 'utf8');
  assert.ok(/revoke\s+select,\s*insert,\s*update,\s*delete\s+on\s+public\.research_jobs\s+from\s+anon/i.test(sql),
    'the migration does not actually revoke the anon grants');
});

test('research_jobs is aligned with the other case tables on forced RLS', () => {
  // Deliberately recorded as alignment, not as a protection win: both
  // postgres (the owner) and service_role hold BYPASSRLS, so FORCE changes
  // no behaviour today. It matters if ownership ever moves to a role without
  // that attribute.
  const dir = join(ROOT, 'supabase/migrations');
  const file = readdirSync(dir).find((f) => f.includes('force_rls_on_research_jobs'));
  assert.ok(file, 'the force-RLS migration is not in the repository');
  const sql = readFileSync(join(dir, file), 'utf8');
  assert.ok(/alter table public\.research_jobs force row level security/i.test(sql),
    'the migration does not force RLS');
  assert.ok(/BYPASSRLS/.test(sql), 'the migration does not record why this is not a protection win');
});

test('the mobile regression needs no undocumented machine state', () => {
  // It used to run only if you knew to set PLAYWRIGHT_CORE_PATH. A suite
  // that skips for an unexplained reason is a suite nobody turns back on.
  const suite = readFileSync(join(ROOT, 'tests/mobile/mobileOverflow.test.mjs'), 'utf8');
  assert.ok(/test:mobile:setup/.test(suite), 'the skip message does not name the fix');
  assert.ok(/\.tooling/.test(suite), 'the provisioned driver location is not consulted');
  assert.ok(/function findChrome/.test(suite), 'Chrome is hardcoded to one machine again');
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  for (const s of ['test:mobile', 'test:mobile:setup', 'build:harness']) {
    assert.ok(pkg.scripts[s], `npm script ${s} is missing`);
  }
});

test('every migration has a unique version prefix', () => {
  // Two files once shared 20260910120000, which is exactly the collision that
  // makes a replay tool pick the wrong one.
  const versions = readdirSync(join(ROOT, 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.split('_')[0]);
  const dupes = versions.filter((v, i) => versions.indexOf(v) !== i);
  assert.deepEqual([...new Set(dupes)], [], 'duplicate migration version prefixes');
});
