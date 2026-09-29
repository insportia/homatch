// HOMATCH DESIGN STUDIO — the seams that must not move.
//
// Source-level guards, in the style of the rest of tests/matrix. The
// behaviour of the migration itself is proven against a real Postgres by
// scripts/design-studio/rls-check.mjs; these assertions keep the shape of
// the product honest as other workstreams edit the shared files.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const MIGRATION = read('supabase/migrations/20260930090000_design_studio_foundation.sql');

function walk(rel, out = []) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) walk(child, out);
    else if (/\.(tsx?|mjs)$/.test(entry.name) && !child.includes('__tests__')) out.push(child);
  }
  return out;
}
const DS_SOURCES = [
  ...walk('src/lib/designStudio'),
  ...walk('src/services/designStudio'),
  ...walk('src/components/designStudio'),
  ...walk('src/pages/designStudio'),
];

/* ── Navigation ──────────────────────────────────────────────────── */

test('Design Studio sits directly below For Expats and above Intelligence', () => {
  const shell = read('src/components/layouts/HomatchShell.tsx');
  const nav = shell.slice(shell.indexOf('export const NAV'));
  const expats = nav.indexOf('nav_group_expats');
  const design = nav.indexOf('nav_group_design');
  const intelligence = nav.indexOf('nav_group_intelligence');
  assert.ok(expats > -1 && design > -1 && intelligence > -1);
  assert.ok(expats < design && design < intelligence, 'Design Studio is not between For Expats and Intelligence');
  assert.match(nav, /\{ key: 'nav_design_studio', path: '\/design-studio', glyph: 'design_studio', gate: 'designStudio' \}/);
});

test('the rail hides gated items and any group left empty', () => {
  const shell = read('src/components/layouts/HomatchShell.tsx');
  assert.match(shell, /designStudioEnabled\(homatchUser\)/);
  assert.match(shell, /\.filter\(group => group\.items\.length > 0\)/);
  assert.match(shell, /\{nav\.map\(\(group, gi\) =>/, 'the rail still renders the unfiltered NAV');
});

test('Design Studio has its own drawn glyph, not a generic icon', () => {
  const glyphs = read('src/components/layouts/NavGlyph.tsx');
  assert.match(glyphs, /'design_studio'/);
  const body = glyphs.slice(glyphs.indexOf('design_studio: ('), glyphs.indexOf('design_studio: (') + 600);
  assert.match(body, /fill=\{GOLD\}/, 'the glyph has no gold accent');
});

/* ── Feature flag ───────────────────────────────────────────────── */

test('the feature is OFF by default and every entry point is gated', () => {
  assert.match(read('src/config/features.ts'), /designStudio: false,/);
  const access = read('src/lib/designStudio/access.ts');
  assert.match(access, /FEATURES\.designStudio/);
  assert.match(access, /VITE_FEATURE_DESIGN_STUDIO === 'on'/);
  for (const page of ['src/pages/designStudio/DesignStudioPage.tsx', 'src/pages/designStudio/DesignStudioWorkspacePage.tsx']) {
    const src = read(page);
    assert.match(src, /<RouteGuard>/, `${page} is not signed-in only`);
    assert.match(src, /<DesignStudioGate>/, `${page} is not gated`);
  }
});

test('routes are registered, lazy, and not public', () => {
  const routes = read('src/routes.tsx');
  assert.match(routes, /const DesignStudioPage = lazyRoute\(/);
  assert.match(routes, /const DesignStudioWorkspacePage = lazyRoute\(/);
  for (const p of ["'/design-studio'", "'/design-studio/:projectId'", "'/design-studio/:projectId/design/:versionId'", "'/design-studio/:projectId/walkthrough'"]) {
    const line = routes.split('\n').find((l) => l.includes(`path: ${p},`));
    assert.ok(line, `route ${p} missing`);
    assert.match(line, /public: false/, `route ${p} is public`);
  }
});

/* ── Separation from the Developer Digital Twin ─────────────────── */

test('Design Studio code never writes developer tables or calls studio services', () => {
  for (const file of DS_SOURCES) {
    const src = read(file);
    assert.ok(!/from\(['"](dt|dev)_/.test(src), `${file} queries a dt_/dev_ table directly`);
    assert.ok(!/services\/developer\/studio/.test(src), `${file} imports the Studio authoring service`);
    assert.ok(!/rpc\(['"]dt_studio_/.test(src), `${file} calls a Studio authoring RPC`);
  }
});

test('the migration never writes dt_* or dev_* and reads developer geometry only through dt_unit_scene', () => {
  const statements = MIGRATION.replace(/--.*$/gm, '');
  assert.ok(!/\b(insert\s+into|update|delete\s+from)\s+public\.(dt|dev)_/i.test(statements),
    'the Design Studio migration writes a developer table');
  assert.match(statements, /public\.dt_unit_scene\(p_unit_id\)/);
  assert.ok(!/\bdt_scene_versions\b/.test(statements), 'reads unpublished developer versions directly');
});

test('Design Studio never calls the Developer floor-plan gate', () => {
  for (const file of DS_SOURCES) {
    const src = read(file);
    assert.ok(!/evaluateGate\s*\(|import[^;]*evaluateGate/.test(src),
      `${file} reuses the Developer gate instead of its own confidence logic`);
  }
});

/* ── Schema discipline ──────────────────────────────────────────── */

const TABLES = ['ds_projects', 'ds_floorplans', 'ds_spatial_sources', 'ds_versions', 'ds_version_events',
  'ds_saved_views', 'ds_catalog_assets', 'ds_catalog_materials', 'ds_styles', 'ds_palettes', 'ds_jobs'];

test('every Design Studio table has RLS enabled and anon revoked', () => {
  for (const table of TABLES) {
    assert.match(MIGRATION, new RegExp(`ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY`), `${table} has no RLS`);
  }
  const revoke = MIGRATION.match(/REVOKE ALL ON ([^;]+) FROM anon;/);
  assert.ok(revoke, 'no table-level anon revoke');
  for (const table of TABLES) assert.ok(revoke[1].includes(`public.${table}`), `${table} not revoked from anon`);
});

test('spatial sources have no customer write policy', () => {
  const policies = [...MIGRATION.matchAll(/CREATE POLICY (\w+) ON public\.ds_spatial_sources\s+FOR (\w+)/g)];
  const customerWrites = policies.filter(([, name, op]) => op !== 'SELECT' && !name.endsWith('_service'));
  assert.deepEqual(customerWrites.map(([, n]) => n), [], 'a browser could assert geometry truth by inserting a row');
});

test('SECURITY DEFINER functions pin search_path and revoke from named roles', () => {
  const defs = [...MIGRATION.matchAll(/CREATE OR REPLACE FUNCTION public\.(ds_\w+)\(([^)]*)\)[\s\S]*?(?=\$\$;|END \$\$;)/g)];
  assert.ok(defs.length >= 6);
  for (const [block, name] of defs) {
    if (/SECURITY DEFINER/.test(block)) assert.match(block, /SET search_path TO ''/, `${name} leaves search_path open`);
    assert.match(MIGRATION, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM public, anon`), `${name} not revoked from anon`);
  }
});

/* ── Storage: the existing R2 path, nothing parallel ─────────────── */

test('Design Studio files use the existing account-scoped R2 categories', () => {
  const keys = read('supabase/functions/_shared/storage/keys.ts');
  for (const cat of ['design-studio-floorplans', 'design-studio-models', 'design-studio-thumbnails']) {
    assert.match(keys, new RegExp(`'${cat}': owned\\(`), `${cat} is not an owned account category`);
  }
  for (const file of ['supabase/functions/_shared/storage/keys.ts', 'src/services/storage/objectStore.ts']) {
    assert.match(read(file), /'model\/gltf-binary': 'glb'/, `${file} gives a GLB no extension`);
  }
  const files = read('src/services/designStudio/files.ts');
  assert.match(files, /from '@\/services\/storage\/objectStore'/, 'Design Studio uploads bypass the shared storage client');
  assert.ok(!/storage\.from\(/.test(files), 'Design Studio writes to a Supabase bucket instead of R2');
});

test('no Design Studio code stores bytes in a database row', () => {
  for (const file of DS_SOURCES) {
    const src = read(file);
    assert.ok(!/toDataURL\(/.test(src), `${file} builds a data URL (bytes that could end up in a row)`);
  }
  const all = [MIGRATION, read('supabase/migrations/20260930091000_design_studio_dev_catalog.sql')].join('\n');
  assert.ok(!/\bbytea\b/i.test(all), 'a Design Studio table stores binary data');
});

test('storage_authorize is re-created verbatim plus only the Design Studio branch', () => {
  const extract = (sql) => {
    const start = sql.indexOf('create or replace function public.storage_authorize(p_key text, p_action text)');
    return sql.slice(start, sql.indexOf('$fn$;', start) + 5);
  };
  const before = extract(read('supabase/migrations/20260918213458_storage_account_scope_and_explorer.sql'));
  const after = extract(read('supabase/migrations/20260930092000_design_studio_storage_categories.sql'));
  const branchStart = after.indexOf('    -- HOMATCH Design Studio:');
  const branchEnd = after.indexOf("    if v_cat not in ('property-photos'");
  assert.ok(branchStart > 0 && branchEnd > branchStart, 'the Design Studio branch is missing or misplaced');
  assert.equal(after.slice(0, branchStart) + after.slice(branchEnd), before, 'storage_authorize changed beyond the Design Studio branch');
});

test('an upload commit declares the type the signer requires', () => {
  const store = read('src/services/storage/objectStore.ts');
  assert.match(store, /op: 'commit', key, contentType, byteSize: file\.size/);
});

test('the migration leaves transactions to the runner', () => {
  assert.ok(!/^\s*(BEGIN|COMMIT)\s*;/im.test(MIGRATION));
});

/* ── The customer floor plan (checkpoint 5) ─────────────────────── */

test('the floor-plan reader treats the upload as untrusted and stores only a proposal', () => {
  const fn = read('supabase/functions/design-studio-floorplan/index.ts');
  assert.match(fn, /refuseIfImpersonating\(/, 'an impersonating admin could spend reading on a customer');
  assert.match(fn, /caller\.from\('ds_floorplans'\)/, 'the plan row is not read as the caller (RLS decides ownership)');
  assert.match(fn, /startsWith\(expectedPrefix\)/, 'the object key is not checked against the caller and project');
  assert.match(fn, /sniffType\(bytes/, 'the file type is trusted from the name or header instead of its bytes');
  assert.match(fn, /imageSize\(bytes/, 'the image dimensions are not read from the bytes');
  assert.match(fn, /MAX_BYTES/, 'no size limit');
  assert.ok(!/ds_spatial_sources/.test(fn), 'the reader writes geometry: a reading is a proposal, not a space');
  assert.ok(!/evaluateGate/.test(fn), 'the reader reuses the Developer gate');
  assert.match(fn, /recordUnbilledUsage\(/, 'reading is not metered');
  const code = fn.replace(/\/\/.*$/gm, '');
  assert.ok(!/rpc\(['"](charge|debit|reserve|settle)\w*/i.test(code), 'reading charges before billing is confirmed');
});

test('the customer path creates geometry only through the checking RPC', () => {
  const svc = read('src/services/designStudio/floorplans.ts');
  assert.match(svc, /rpc\('ds_create_floorplan_source'/);
  assert.ok(!/from\('ds_spatial_sources'\)\.(insert|update|upsert)/.test(svc), 'the browser writes a spatial source directly');
  assert.match(svc, /isEvalSupported: false/, 'pdf.js may evaluate code from an uploaded PDF');
  assert.match(MIGRATION, /DS_CALIBRATION_REQUIRED|anchors/, 'the database does not check the truth claim of a calibrated source');
});

test('an unmeasured ceiling is recorded as typical, never as a fact', () => {
  const flow = read('src/components/designStudio/FloorPlanFlow.tsx');
  assert.match(flow, /ceilingM \? 'CUSTOMER' : doc\.ceilingHeight \? 'DRAWING' : 'TYPICAL'/);
  assert.match(read('src/components/designStudio/workspace/Inspector.tsx'), /ds_inspector_ceiling_typical/);
});

test('the reader is deployed with JWT verification like every signed-in function', () => {
  assert.match(read('.github/workflows/deploy.yml'), /design-studio-floorplan/);
});
