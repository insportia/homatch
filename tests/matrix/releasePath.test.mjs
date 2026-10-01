/*
 * HOMATCH FAST RELEASE — the rules that decide how much validation a change
 * gets, and when merged code may be promoted on validation it already passed.
 *
 * What these tests guard is the asymmetry: being wrong toward a wider plan
 * costs minutes, being wrong toward a narrower one ships unvalidated code. So
 * every narrowing is earned by the component model and the dependency graph,
 * every FAST by a complete positive proof, and every doubt is repository-wide
 * or VALIDATE.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  SUITES, ALWAYS, TIERS, classifyChanges, promotionDecision, RECORD_VERSION, GATEKEEPER, migrationObjects,
  translationChange, upgradeSuiteNames,
} from '../../scripts/release/classify.mjs';
import { SUITE_CATALOGUE, COMPONENTS, ownerOf } from '../../scripts/release/components.mjs';
import { buildGraph, dependentsOf, parseImports } from '../../scripts/release/graph.mjs';
import { findEvidence, RECORD_ARTIFACT, RECORD_FILE } from '../../scripts/release/provenance.mjs';
import { affectedFunctions } from '../../scripts/deploy-scope.mjs';

const ROOT = process.cwd();
// CRLF-normalised: a Windows checkout parses exactly like CI's LF one.
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const PR = read('.github/workflows/pr-check.yml');
const DEPLOY = read('.github/workflows/deploy.yml');
const PKG = JSON.parse(read('package.json'));

/* A small dependency world for the classifier: files and their importers. */
function fakeGraph(edges = {}) {
  const importers = new Map();
  for (const [target, froms] of Object.entries(edges)) {
    importers.set(target, froms.map((f) => (typeof f === 'string' ? { from: f, dynamic: false } : f)));
  }
  return { files: new Set(), importers };
}
const NO_EDGES = fakeGraph();
const ctx = (extra = {}) => ({ graph: NO_EDGES, read: () => '', diff: () => '', edgeFunctionsFor: () => [], ...extra });
const mobile = SUITES.filter((s) => s.startsWith('mobile:'));
const studio = SUITES.filter((s) => s.startsWith('studio:'));
const journeys = ['developer', 'onboarding', 'floorplan'];

const DS_POLICY_SQL = `
create table if not exists public.ds_catalog_files (id uuid primary key, asset_id uuid);
alter table public.ds_catalog_files enable row level security;
drop policy if exists ds_catalog_files_select on public.ds_catalog_files;
create policy ds_catalog_files_select on public.ds_catalog_files for select using (auth.uid() is not null);
create or replace function public.ds_catalog_claim(p uuid) returns void language plpgsql security definer as $fn$ begin update public.users set x = 1; end $fn$;
grant execute on function public.ds_catalog_claim(uuid) to service_role;`;
const META_SQL = 'create table if not exists public.meta_api_usage (id bigint primary key, pct int);\ncreate index if not exists idx_meta_usage on public.meta_api_usage (pct);';
const META_POLICY_SQL = 'alter table public.meta_api_usage enable row level security;\ncreate policy meta_api_usage_admin on public.meta_api_usage for select using (public.is_admin());';

/* ── 1. Component isolation ──────────────────────────────────────────── */

test('1. a Design Studio-only migration does not trigger Meta Ads suites', () => {
  const r = classifyChanges(['supabase/migrations/20990101000000_ds.sql'], ctx({ read: () => DS_POLICY_SQL }));
  assert.equal(r.tier, 'COMPONENT_FULL');
  assert.deepEqual(Object.keys(r.components), ['DESIGN_STUDIO']);
  assert.ok(!r.suites.includes('mobile:meta-ads'));
  assert.ok(!r.suites.some((s) => studio.includes(s) || journeys.includes(s)), r.suites.join(' '));
  assert.deepEqual(migrationObjects(DS_POLICY_SQL).filter((o) => !o.startsWith('public.ds_')), [], 'a function body is not a definition: public.users inside $fn$ is not claimed');
});

test('2. a Meta Ads-only migration does not trigger Design Studio suites', () => {
  const plain = classifyChanges(['supabase/migrations/20990101000001_meta.sql'], ctx({ read: () => META_SQL }));
  assert.equal(plain.tier, 'TARGETED');
  assert.deepEqual(Object.keys(plain.components), ['META_ADS']);
  assert.deepEqual(plain.suites, ALWAYS, 'a plain schema change is invisible to every browser suite');
  const policy = classifyChanges(['supabase/migrations/20990101000002_meta_rls.sql'], ctx({ read: () => META_POLICY_SQL }));
  assert.equal(policy.tier, 'COMPONENT_FULL');
  assert.deepEqual(policy.suites, [...ALWAYS, 'mobile:meta-ads']);
});

test('3. the Design Studio catalogue workflow and scripts do not trigger unrelated product journeys', () => {
  const r = classifyChanges([
    '.github/workflows/design-studio-catalog.yml', 'scripts/design-studio/catalog-import.mjs', 'scripts/design-studio/rls-check.mjs',
  ], ctx());
  assert.equal(r.tier, 'COMPONENT_FULL', 'a workflow carries permissions and secrets: security-relevant for its component');
  assert.deepEqual(Object.keys(r.components), ['DESIGN_STUDIO']);
  assert.deepEqual(r.suites, ALWAYS);
  // ...while a workflow no component owns is still repository-wide.
  assert.equal(classifyChanges(['.github/workflows/nightly.yml'], ctx()).tier, 'REPO_FULL');
});

test('4. a component-local edge change validates only its own closure', () => {
  const r = classifyChanges(['supabase/functions/meta-ads-api/engine.ts', 'supabase/functions/meta-ads-api/__tests__/engine.test.mjs'], ctx());
  assert.equal(r.tier, 'TARGETED');
  assert.deepEqual(r.suites, ALWAYS);
  assert.deepEqual(r.deploy.functions, ['meta-ads-api']);
  assert.deepEqual(Object.keys(r.components), ['META_ADS']);
});

test('5. a component-local security / RLS change runs that component\'s complete suite set', () => {
  const site = classifyChanges(['supabase/migrations/20990101000003_site.sql'], ctx({ read: () => 'create policy site_pages_admin on public.site_pages for all using (public.is_admin());' }));
  assert.equal(site.tier, 'COMPONENT_FULL');
  for (const s of [...ALWAYS, ...COMPONENTS.SITE_STUDIO.suites]) assert.ok(site.suites.includes(s), s);
  assert.ok(!site.suites.includes('mobile:meta-ads') && !site.suites.includes('developer'));
  // A security-named path inside a component: same answer, scoped to it.
  const oauth = classifyChanges(['src/components/metaAds/MetaOAuthConnect.tsx'], ctx({ graph: fakeGraph({ 'src/components/metaAds/MetaOAuthConnect.tsx': ['src/pages/outreach/MetaAdsPage.tsx'] }) }));
  assert.equal(oauth.tier, 'COMPONENT_FULL');
  assert.deepEqual(oauth.suites, [...ALWAYS, 'mobile:meta-ads']);
  // AUTH / BILLING / STORAGE are security components: any change is COMPONENT_FULL.
  assert.equal(classifyChanges(['supabase/functions/storage-sign/index.ts'], ctx()).tier, 'COMPONENT_FULL');
  assert.equal(classifyChanges(['supabase/functions/billing/index.ts'], ctx()).tier, 'COMPONENT_FULL');
});

test('6. a global auth / RLS primitive escalates repository-wide', () => {
  const cases = {
    'users policy': 'create policy users_self on public.users for select using (auth.uid() = id);',
    'admin predicate': 'create or replace function public.is_admin() returns boolean language sql security definer as $$ select true $$;',
    'storage.objects': 'create policy obj on storage.objects for select using (true);',
    'default privileges': 'alter default privileges in schema public grant select on tables to anon;',
    'grant on an unowned table': 'grant select on public.mystery_table to anon;',
  };
  for (const [name, sql] of Object.entries(cases)) {
    assert.equal(classifyChanges(['supabase/migrations/20990101000004_x.sql'], ctx({ read: () => sql })).tier, 'REPO_FULL', name);
  }
  assert.equal(classifyChanges(['supabase/functions/_shared/auth.ts'], ctx()).tier, 'REPO_FULL');
  assert.equal(classifyChanges(['src/contexts/AuthContext.tsx'], ctx()).tier, 'REPO_FULL');
  // Shared edge code reaching three or more components is global too.
  const wide = classifyChanges(['supabase/functions/_shared/llm.ts'], ctx({ edgeFunctionsFor: () => ['meta-ads-api', 'design-studio-model', 'research-agent'] }));
  assert.equal(wide.tier, 'REPO_FULL');
});

test('7. a root dependency / toolchain change escalates repository-wide', () => {
  for (const f of ['package.json', 'pnpm-lock.yaml', 'vite.config.ts', 'tsconfig.check.json', 'biome.json', 'scripts/run-tests.mjs', 'scripts/lint.sh', '.rules/no-x.yml', 'index.html', 'src/App.tsx', 'src/components/ui/button.tsx', 'src/i18n/bundles.ts', 'supabase/config.toml']) {
    const r = classifyChanges([f], ctx());
    assert.equal(r.tier, 'REPO_FULL', f);
    assert.deepEqual(r.suites, SUITES, f);
  }
  // One repository-wide path makes the whole change repository-wide.
  assert.equal(classifyChanges(['docs/x.md', 'pnpm-lock.yaml'], ctx()).tier, 'REPO_FULL');
});

test('8. unknown impact escalates safely', () => {
  assert.equal(classifyChanges(['weird/location.txt'], ctx()).tier, 'REPO_FULL');
  assert.equal(classifyChanges(['scripts/brand-new-tool.mjs'], ctx()).tier, 'REPO_FULL');
  assert.equal(classifyChanges([], ctx()).tier, 'REPO_FULL');
  assert.equal(classifyChanges(['supabase/migrations/20990101000005_x.sql'], ctx({ read: () => { throw new Error('gone'); } })).tier, 'REPO_FULL');
  assert.equal(classifyChanges(['src/components/metaAds/X.tsx'], { read: () => '' }).tier, 'REPO_FULL', 'no dependency graph → cannot prove the blast radius');
  assert.equal(classifyChanges(['supabase/functions/_shared/x.ts'], ctx({ edgeFunctionsFor: () => { throw new Error('x'); } })).tier, 'REPO_FULL');
  // A file that reaches the application shell through a static import.
  const g = fakeGraph({ 'src/lib/designStudio/access.ts': ['src/components/layouts/HomatchShell.tsx'] });
  assert.equal(classifyChanges(['src/lib/designStudio/access.ts'], ctx({ graph: g })).tier, 'REPO_FULL');
  // ...but a page the route table only lazy-loads changes its route, not the shell.
  const lazy = fakeGraph({ 'src/pages/designStudio/DesignStudioPage.tsx': [{ from: 'src/routes.tsx', dynamic: true }] });
  assert.equal(classifyChanges(['src/pages/designStudio/DesignStudioPage.tsx'], ctx({ graph: lazy })).tier, 'TARGETED');
});

test('the import graph carries a change to every component that depends on it', () => {
  const g = fakeGraph({
    'src/lib/designStudio/catalog.ts': ['src/components/designStudio/Picker.tsx', 'src/pages/property/PropertyDetailPage.tsx'],
    'src/pages/property/PropertyDetailPage.tsx': [{ from: 'src/routes.tsx', dynamic: true }],
  });
  const r = classifyChanges(['src/lib/designStudio/catalog.ts'], ctx({ graph: g }));
  assert.deepEqual(Object.keys(r.components).sort(), ['DESIGN_STUDIO', 'PRODUCT']);
  for (const s of COMPONENTS.PRODUCT.suites) assert.ok(r.suites.includes(s), s);
  // A shared test fixture runs exactly the suites whose files import it.
  const fx = classifyChanges(['tests/mobile/mortgageFixture.mjs'], ctx({ graph: fakeGraph({ 'tests/mobile/mortgageFixture.mjs': ['tests/mobile/mortgageHuman.test.mjs', 'tests/mobile/mortgageConsultant.test.mjs'] }) }));
  assert.deepEqual(fx.suites, [...ALWAYS, 'mobile:mortgage']);
});

test('translations reach the components whose keys changed; anything else reaches every screen', () => {
  const t = 'src/i18n/translations.ts';
  const meta = "@@ -1 +1 @@\n-  madsb_step_account: 'Meta account',\n+  madsb_step_account: 'Meta ad account',\n+  mm_b_loc_title: 'Where it runs',";
  assert.deepEqual(classifyChanges([t], ctx({ diff: () => meta })).suites, [...ALWAYS, 'mobile:meta-ads']);
  const ds = "+  ds_launcher_title: 'Bring it in',";
  assert.deepEqual(classifyChanges([t], ctx({ diff: () => ds })).suites, ALWAYS, 'Design Studio has no browser suite of its own');
  const broad = "+  nav_home: 'Home',";
  const b = classifyChanges([t], ctx({ diff: () => broad }));
  for (const s of [...mobile, 'a11y']) assert.ok(b.suites.includes(s), s);
  const structural = "-  ka: { ...en, ...ka },\n+  ka: { ...ka },";
  assert.ok(translationChange(structural).structural || classifyChanges([t], ctx({ diff: () => structural })).suites.includes('a11y'));
  assert.ok(classifyChanges([t], ctx({ diff: () => null })).suites.includes('mobile:auth'), 'no diff → every screen');
});

/* ── 2. Promotion ───────────────────────────────────────────────────── */

const TREE = 'a'.repeat(40);
const goodRun = { conclusion: 'success', event: 'pull_request', path: '.github/workflows/pr-check.yml' };
const metaChange = ['supabase/functions/meta-ads-api/engine.ts'];
const goodRecord = { version: RECORD_VERSION, tier: 'TARGETED', suites: [...ALWAYS], validatedTree: TREE, runId: '42' };

test('9. the exact validated post-merge tree is promoted without re-running its suites', () => {
  const d = promotionDecision({ mergedTree: TREE, record: goodRecord, run: goodRun, changed: metaChange, ...ctx() });
  assert.equal(d.path, 'FAST');
  assert.match(d.reasons.join(' '), /byte-identical/);
  // ...and the deploy workflow then runs no validation job at all.
  assert.match(DEPLOY, /validate:\n {4}name: Validate\n {4}needs: provenance\n {4}if: needs\.provenance\.outputs\.path != 'FAST'\n {4}uses: \.\/\.github\/workflows\/pr-check\.yml/);
});

test('10. squash-merge provenance: a new commit id with the validated tree promotes', () => {
  const r = repo({ 'docs/a.md': 'hi\n' });
  execFileSync(process.execPath, [resolve(ROOT, 'scripts/release/record.mjs'), 'rec.json', '--tier', 'TARGETED', '--suites', 'static unit', '--components', 'TOOLING'], { cwd: r.dir });
  const rec = JSON.parse(readFileSync(join(r.dir, 'rec.json'), 'utf8'));
  assert.equal(rec.version, RECORD_VERSION);
  assert.equal(rec.validatedTree, r.g('rev-parse', 'HEAD^{tree}'));
  assert.deepEqual(rec.components, ['TOOLING']);
  r.g('checkout', '-q', 'main'); r.g('merge', '-q', '--squash', 'feature'); r.g('commit', '-qm', 'squash');
  assert.notEqual(r.g('rev-parse', 'HEAD'), rec.validatedCommit);
  assert.equal(r.g('rev-parse', 'HEAD^{tree}'), rec.validatedTree);
  const d = promotionDecision({ mergedTree: r.g('rev-parse', 'HEAD^{tree}'), record: rec, run: goodRun, changed: ['docs/a.md'], ...ctx() });
  assert.equal(d.path, 'FAST');
});

test('11. the release engine cannot certify itself', () => {
  for (const f of ['.github/workflows/pr-check.yml', '.github/workflows/deploy.yml', 'scripts/release/classify.mjs', 'scripts/release/components.mjs', 'scripts/deploy-scope.mjs']) {
    assert.ok(GATEKEEPER.some((re) => re.test(f)), f);
    const d = promotionDecision({ mergedTree: TREE, record: { ...goodRecord, tier: 'REPO_FULL', suites: [...SUITES] }, run: goodRun, changed: [f], ...ctx() });
    assert.equal(d.path, 'VALIDATE', f);
    assert.equal(classifyChanges([f], ctx()).tier, 'REPO_FULL', f);
  }
  assert.ok(!GATEKEEPER.some((re) => re.test('.github/workflows/design-studio-catalog.yml')), 'only the engine, not every workflow');
});

test('11b. the PR plan is also made by the base branch\'s engine, and the stricter answer wins', () => {
  const stub = (body) => `#!/usr/bin/env node\n${body}\n`;
  const plan = (dir) => cli(dir, 'scripts/release/plan.mjs', '--base', 'main', '--json');
  // The base engine says repository-wide: the head engine cannot narrow it.
  const a = repo({ 'docs/a.md': 'hi\n' }, { 'scripts/release/plan.mjs': stub("console.log(JSON.stringify({ tier: 'FULL', suites: [], reasons: ['old rule'] }))") });
  assert.equal(plan(a.dir).tier, 'REPO_FULL');
  // The base engine requires an old-named suite: it is honoured, upgraded.
  const b = repo({ 'docs/a.md': 'hi\n' }, { 'scripts/release/plan.mjs': stub("console.log(JSON.stringify({ tier: 'TARGETED', suites: ['static','unit','studio'], reasons: [] }))") });
  const pb = plan(b.dir);
  assert.equal(pb.tier, 'TARGETED');
  for (const s of studio) assert.ok(pb.suites.includes(s), s);
  // A base engine that cannot run plans repository-wide.
  const c = repo({ 'docs/a.md': 'hi\n' }, { 'scripts/release/plan.mjs': stub('process.exit(3)') });
  assert.equal(plan(c.dir).tier, 'REPO_FULL');
  assert.deepEqual(upgradeSuiteNames(['mobile']).sort(), [...mobile].sort());
  assert.equal(upgradeSuiteNames(['mystery']), null);
});

test('12. CRLF and LF, backslash and slash: identical classification', () => {
  const crlf = (s) => s.replace(/\n/g, '\r\n');
  const f = 'supabase/migrations/20990101000006_ds.sql';
  const strip = (r) => ({ tier: r.tier, suites: r.suites, components: Object.keys(r.components) });
  assert.deepEqual(strip(classifyChanges([f], ctx({ read: () => crlf(DS_POLICY_SQL) }))), strip(classifyChanges([f], ctx({ read: () => DS_POLICY_SQL }))));
  const t = 'src/i18n/translations.ts';
  const diff = "+  madsb_step_account: 'Meta ad account',\n";
  assert.deepEqual(strip(classifyChanges([t], ctx({ diff: () => crlf(diff) }))), strip(classifyChanges([t], ctx({ diff: () => diff }))));
  assert.deepEqual(strip(classifyChanges(['supabase\\functions\\meta-ads-api\\engine.ts\r'], ctx())), strip(classifyChanges(['supabase/functions/meta-ads-api/engine.ts'], ctx())));
  assert.deepEqual(parseImports(crlf("import { a } from '@/lib/x';\nimport('./y');\n")), parseImports("import { a } from '@/lib/x';\nimport('./y');\n"));
});

test('13. the shards are exactly the canonical suites — no file lost, none duplicated', () => {
  const listed = (script) => PKG.scripts[script].match(/tests\/[\w/.-]+\.test\.mjs/g);
  const shardFiles = (prefix) => SUITES.filter((s) => s.startsWith(prefix)).flatMap((s) => SUITE_CATALOGUE[s].files);
  assert.deepEqual([...shardFiles('mobile:')].sort(), [...listed('test:mobile')].sort());
  assert.equal(new Set(shardFiles('mobile:')).size, shardFiles('mobile:').length);
  assert.deepEqual([...shardFiles('studio:')].sort(), [...listed('test:studio')].sort());
  for (const [id, s] of Object.entries(SUITE_CATALOGUE)) {
    for (const f of s.files ?? []) assert.ok(existsSync(join(ROOT, f)), `${id}: ${f} is missing`);
    if (s.script) assert.deepEqual(listed(s.script), s.files, `${id} must run exactly ${s.script}`);
  }
  // Every browser test is gated by a suite, by the unit runner, or is a
  // declared manual suite — nothing silently runs nowhere.
  const gated = new Set(Object.values(SUITE_CATALOGUE).flatMap((s) => s.files ?? []));
  const unitExcluded = read('scripts/run-tests.mjs');
  for (const dir of ['tests/mobile', 'tests/browser', 'tests/studio']) {
    for (const f of execFileSync('git', ['ls-files', dir], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((x) => x.endsWith('.test.mjs'))) {
      const name = f.split('/').pop().replace(/\./g, '\\.');
      const runByUnit = dir === 'tests/browser' && !new RegExp(name).test(unitExcluded);
      assert.ok(gated.has(f) || runByUnit || ownerOf(f) === 'TESTS', `${f} runs in no gate and is not declared manual`);
    }
  }
});

test('14. edge deployment selects only the owed functions', () => {
  assert.deepEqual(classifyChanges(['supabase/functions/push-send/index.ts'], ctx()).deploy.functions, ['push-send']);
  const shared = classifyChanges(['supabase/functions/_shared/storage/keys.ts'], ctx({ edgeFunctionsFor: () => ['design-studio-model', 'storage-sign'] }));
  assert.deepEqual(shared.deploy.functions, ['design-studio-model', 'storage-sign']);
  assert.equal(shared.tier, 'COMPONENT_FULL');
  // The real closure on this repository: one function's own file owes one function.
  assert.deepEqual(affectedFunctions(['supabase/functions/push-send/index.ts'], ROOT), ['push-send']);
  assert.ok(!affectedFunctions(['supabase/functions/push-send/index.ts'], ROOT).includes('meta-ads-api'));
});

test('15. a missing validation record falls back to validation', () => {
  for (const input of [{ record: null }, { run: null }, { changed: null }]) {
    const d = promotionDecision({ mergedTree: TREE, record: goodRecord, run: goodRun, changed: metaChange, ...ctx(), ...input });
    assert.equal(d.path, 'VALIDATE', JSON.stringify(input));
  }
});

test('16. invalid or stale provenance falls back to validation', () => {
  const base = { mergedTree: TREE, record: goodRecord, run: goodRun, changed: metaChange, ...ctx() };
  const cases = {
    'different tree (main moved / merge changed code)': { mergedTree: 'b'.repeat(40) },
    'unknown tree id': { mergedTree: '' },
    'failed run': { run: { ...goodRun, conclusion: 'failure' } },
    'push run, not a PR': { run: { ...goodRun, event: 'push' } },
    'another workflow': { run: { ...goodRun, path: '.github/workflows/other.yml' } },
    'v1 record (old engine)': { record: { ...goodRecord, version: 1 } },
    'unknown tier': { record: { ...goodRecord, tier: 'FULL' } },
    'unknown suite': { record: { ...goodRecord, suites: ['static', 'unit', 'mobile'] } },
    'record does not cover the change': { changed: ['src/components/metaAds/X.tsx'], graph: fakeGraph() },
  };
  for (const [name, over] of Object.entries(cases)) assert.equal(promotionDecision({ ...base, ...over }).path, 'VALIDATE', name);
});

/* ── 3. PR #24 — Design Studio catalogue infrastructure ────────────────── */

const PR24 = [
  '.github/workflows/design-studio-catalog.yml', 'docs/claude/PROJECT_STATE.md', 'scripts/design-studio/catalog-import.mjs',
  'scripts/design-studio/rls-check.mjs', 'src/components/designStudio/canvas/SceneController.ts', 'src/components/designStudio/canvas/modelLoader.ts',
  'src/lib/designStudio/__tests__/catalogPipeline.test.mjs', 'src/lib/designStudio/__tests__/fixtures/blendkit-sample.json',
  'src/lib/designStudio/catalog.ts', 'src/lib/designStudio/catalogPipeline.ts', 'src/lib/designStudio/catalogProviders/blendkit.ts',
  'src/lib/designStudio/catalogResolver.ts', 'src/lib/designStudio/catalogSource.ts', 'src/lib/designStudio/reconstruction.ts',
  'src/services/designStudio/catalog.ts', 'supabase/functions/_shared/storage/__tests__/keys.test.mjs', 'supabase/functions/_shared/storage/keys.ts',
  'supabase/functions/design-studio-model/__tests__/catalogPolicy.test.mjs', 'supabase/functions/design-studio-model/catalog.ts',
  'supabase/functions/design-studio-model/catalogPolicy.ts', 'supabase/functions/design-studio-model/index.ts',
  'supabase/migrations/20261002210000_design_studio_catalog_import.sql', 'tests/matrix/designStudio.test.mjs',
];
const PR24_SQL = `${DS_POLICY_SQL}
create or replace function public.storage_authorize(p_key text, p_action text) returns text language plpgsql stable security definer set search_path to '' as $fn$ begin return 'x'; end $fn$;
grant execute on function public.storage_authorize(text, text) to authenticated;`;

test('PR #24: Design Studio + shared storage security proof, and nothing unrelated', () => {
  const r = classifyChanges(PR24, ctx({
    read: () => PR24_SQL,
    edgeFunctionsFor: () => ['design-studio-model', 'design-studio-reconstruct', 'storage-inventory', 'storage-migrate', 'storage-selftest', 'storage-sign'],
    graph: fakeGraph({ 'src/components/designStudio/canvas/SceneController.ts': ['src/share/ShareViewer.tsx', 'src/components/designStudio/canvas/Stage.tsx'] }),
  }));
  assert.equal(r.tier, 'COMPONENT_FULL');
  assert.deepEqual(Object.keys(r.components).sort(), ['DESIGN_STUDIO', 'STORAGE']);
  assert.deepEqual(r.suites, ['static', 'unit']);
  for (const s of ['mobile:meta-ads', ...studio, ...journeys, 'push', 'a11y']) assert.ok(!r.suites.includes(s), `${s} would be unrelated`);
  assert.ok(r.proofs.some((p) => /storage-selftest/.test(p)), 'the storage primitive owes its production self-test');
  assert.ok(r.proofs.some((p) => /RLS/.test(p)));
  assert.deepEqual(r.deploy.functions, ['design-studio-model', 'design-studio-reconstruct', 'storage-inventory', 'storage-migrate', 'storage-selftest', 'storage-sign']);
});

/* ── 4. The real repository graph ───────────────────────────────────── */

test('the real import graph: the shell lazy-loads Design Studio and statically owns the core', () => {
  const g = buildGraph({ cwd: ROOT });
  const isShell = (f) => ownerOf(f) === 'CORE_SHARED';
  const ds = dependentsOf(g, 'src/lib/designStudio/catalog.ts', isShell);
  assert.ok(![...ds].some((f) => isShell(f)), `catalog.ts must not reach the shell: ${[...ds].filter(isShell).join(', ')}`);
  const utils = dependentsOf(g, 'src/lib/utils.ts', isShell);
  assert.ok([...utils].some((f) => isShell(f)), 'src/lib/utils.ts is used by the shell');
  assert.equal(classifyChanges(['src/lib/utils.ts'], ctx({ graph: g })).tier, 'REPO_FULL');
});

/* ── 5. The workflows do what the policy says ─────────────────────────── */

test('PR workflow: plan → parallel static, unit, browser matrix, worker → one aggregate that records', () => {
  assert.match(PR, /workflow_call:\n\s+inputs:\n\s+base:/);
  assert.match(PR, /RELEASE_BASE: \$\{\{ inputs\.base \|\| format\('origin\/\{0\}', github\.base_ref\) \}\}/);
  assert.match(PR, /include: \$\{\{ fromJSON\(needs\.plan\.outputs\.matrix\) \}\}/);
  assert.match(PR, /run: node scripts\/release\/run-suite\.mjs \$\{\{ matrix\.id \}\}/);
  assert.match(PR, /run: pnpm run build:harness/, 'a browser job builds its own harness');
  assert.match(PR, /npm install -g @ast-grep\/cli/);
  assert.match(PR, /run: pnpm exec tsc -p tsconfig\.check\.json --noEmit/);
  assert.match(PR, /run: npm --prefix official-worker test/);
  const v = PR.slice(PR.indexOf('\n  validate:\n'));
  assert.match(v, /name: Validate PR/);
  assert.match(v, /needs: \[plan, static, unit, browser, worker\]/);
  assert.match(v, /if: always\(\)/);
  const check = v.indexOf('Every planned suite passed');
  const rec = v.indexOf('scripts/release/record.mjs');
  const up = v.indexOf('actions/upload-artifact');
  assert.ok(check > 0 && rec > check && up > rec, 'check → record → upload, in that order');
  assert.match(v, new RegExp(`name: ${RECORD_ARTIFACT}`));
  assert.match(v, /was planned and is/);
  assert.match(v, /the plan produced no tier/);
});

test('deploy workflow: validation only without proof; prerequisites, deploy and proof always gated on one rule', () => {
  assert.match(DEPLOY, /provenance:\n {4}name: Release path[\s\S]*?continue-on-error: true[\s\S]*?run: node scripts\/release\/provenance\.mjs/);
  assert.match(DEPLOY, /actions: read/);
  const prereq = DEPLOY.slice(DEPLOY.indexOf('\n  prerequisites:\n'), DEPLOY.indexOf('\n  # ── Job 2'));
  assert.match(prereq, /run: pnpm run check:edge/);
  assert.match(prereq, /run: node scripts\/migration-baseline\.mjs/);
  assert.doesNotMatch(prereq, /\n\s+if:/, 'prerequisites run on every path');
  const gate = "(needs.validate.result == 'success' || (needs.validate.result == 'skipped' && needs.provenance.outputs.path == 'FAST'))";
  for (const job of ['build-frontend', 'migrate', 'deploy-functions', 'record-deployment']) {
    const start = DEPLOY.indexOf(`\n  ${job}:\n`);
    const body = DEPLOY.slice(start, start + 900);
    assert.ok(body.includes(gate), `${job} must wait for validation or a proven FAST`);
    assert.ok(body.includes("needs.prerequisites.result == 'success'"), `${job} must wait for the prerequisites`);
  }
  // No step anywhere skips on anything but a positive FAST.
  assert.doesNotMatch(DEPLOY, /path == 'VALIDATE'|path != 'VALIDATE'/);
  assert.match(DEPLOY, /- name: Prove it in production\n\s+if: always\(\)/);
  assert.match(DEPLOY, /secrets: inherit/);
  for (const t of TIERS) assert.ok(read('docs/claude/RELEASE.md').includes(t), `RELEASE.md documents ${t}`);
});

/* ── helpers ─────────────────────────────────────────────────────────── */

function repo(files, baseFiles = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'release-path-'));
  const g = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8' }).trim();
  const put = (p, body) => { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), body); };
  g('init', '-q', '-b', 'main');
  put('README.md', 'x\n');
  for (const [p, body] of Object.entries(baseFiles)) put(p, body);
  g('add', '.'); g('commit', '-qm', 'base');
  g('checkout', '-qb', 'feature');
  for (const [p, body] of Object.entries(files)) put(p, body);
  g('add', '.'); g('commit', '-qm', 'change');
  return { dir, g };
}
function cli(dir, script, ...args) {
  const env = { ...process.env, GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '', GITHUB_ACTIONS: 'true' };
  return JSON.parse(execFileSync(process.execPath, [resolve(ROOT, script), ...args], { cwd: dir, encoding: 'utf8', env }));
}

test('plan.mjs plans from the real diff: docs → always-on only; a lockfile → repository-wide', () => {
  const docs = repo({ 'docs/a.md': 'hi\n' }, { 'scripts/release/plan.mjs': "console.log(JSON.stringify({ tier: 'TARGETED', suites: ['static','unit'], reasons: [] }))\n" });
  assert.deepEqual(cli(docs.dir, 'scripts/release/plan.mjs', '--base', 'main', '--json').suites, ALWAYS);
  const lock = repo({ 'pnpm-lock.yaml': 'lockfileVersion: 9\n' });
  assert.equal(cli(lock.dir, 'scripts/release/plan.mjs', '--base', 'main', '--json').tier, 'REPO_FULL');
  const r = repo({ 'docs/a.md': 'hi\n' });
  assert.equal(cli(r.dir, 'scripts/release/plan.mjs', '--base', 'no-such-ref', '--json').tier, 'REPO_FULL');
});

test('evidence: the merged PR, its newest successful pr-check run, and that run\'s record', async () => {
  const sha = 'c'.repeat(40);
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const body = url.includes('/pulls') ? [{ number: 24, merge_commit_sha: sha, merged_at: 'x', head: { sha: 'd'.repeat(40) } }]
      : url.includes('/actions/workflows/pr-check.yml/runs') ? { workflow_runs: [
        { id: 1, conclusion: 'failure', path: '.github/workflows/pr-check.yml', event: 'pull_request', updated_at: '2026-10-01T01:00:00Z' },
        { id: 2, conclusion: 'success', path: '.github/workflows/pr-check.yml', event: 'pull_request', updated_at: '2026-10-01T02:00:00Z', run_attempt: 1 },
      ] }
        : url.includes('/artifacts') && !url.endsWith('/zip') ? { artifacts: [{ id: 7, name: RECORD_ARTIFACT, expired: false }] } : null;
    return { ok: true, status: 200, json: async () => body, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(goodRecord)).buffer };
  };
  const unzip = (buf, name) => { assert.equal(name, RECORD_FILE); return new TextDecoder().decode(buf); };
  const ev = await findEvidence({ api: 'https://api.test', repo: 'o/r', sha, token: 't', fetchImpl, unzip });
  assert.equal(ev.run.id, 2, 'a failed run is never the evidence');
  assert.deepEqual(ev.record, goodRecord);
  assert.ok(calls.some((u) => u.includes(`head_sha=${'d'.repeat(40)}`)), 'runs are looked up by the PR head commit, never a branch');
});
