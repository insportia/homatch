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
  const fn = read('supabase/functions/design-studio-reconstruct/floorplan.ts');
  assert.match(fn, /refuseIfImpersonating\(/, 'an impersonating admin could spend reading on a customer');
  assert.match(fn, /caller\.from\('ds_floorplans'\)/, 'the plan row is not read as the caller (RLS decides ownership)');
  assert.match(fn, /startsWith\(expectedPrefix\)/, 'the object key is not checked against the caller and project');
  assert.match(fn, /sniffType\(bytes/, 'the file type is trusted from the name or header instead of its bytes');
  assert.match(fn, /imageSize\(bytes/, 'the image dimensions are not read from the bytes');
  assert.match(fn, /MAX_BYTES/, 'no size limit');
  assert.ok(!/ds_spatial_sources/.test(fn), 'the reader writes geometry: a reading is a proposal, not a space');
  assert.ok(!/evaluateGate/.test(fn), 'the reader reuses the Developer gate');
  assert.match(fn, /meterAiCall\(admin,/, 'reading is not metered');
  const code = fn.replace(/\/\/.*$/gm, '');
  assert.ok(!/rpc\(['"](charge|debit|reserve|settle)\w*/i.test(code), 'reading charges before billing is confirmed');
});

test('plan reading v2: the same picture is never paid for twice, and the raw reading is kept beside the fused one', () => {
  const fn = read('supabase/functions/design-studio-reconstruct/floorplan.ts');
  // The cache is per customer, per exact bytes, per reader version, plans only.
  assert.match(fn, /\.eq\('user_id', plan\.user_id\)\.eq\('sha256', sha256\)\.eq\('status', 'INTERPRETED'\)\.eq\('purpose', 'PLAN'\)/);
  assert.match(fn, /\.eq\('interpretation->>readVersion', DS_READ_VERSION\)/);
  const cacheAt = fn.indexOf("interpretation->>readVersion");
  assert.ok(cacheAt > 0 && cacheAt < fn.indexOf("fetch('https://api.openai.com/v1/responses'"), 'the cache is consulted before the model is called');
  // Fusion runs on the bytes already checked, and the model's own reading is stored untouched.
  assert.match(fn, /understand\(\{ doc: reading\.doc/);
  assert.match(fn, /rawDoc: reading\.doc/);
  assert.match(fn, /readVersion: reading\.readVersion/);
  assert.match(read('supabase/functions/_shared/designStudio/floorplanRead.ts'), /export const DS_READ_VERSION = 'ds-read-2';/);
  // Decoding is bounded and never fatal: an undecodable picture is fused without its raster.
  const dec = read('supabase/functions/design-studio-reconstruct/rasterDecode.ts');
  assert.match(dec, /MAX_MEGAPIXELS = \d+;/);
  assert.match(dec, /catch \{\s*return \{ ok: false, reason: 'DECODE_FAILED' \}/);
  // The deterministic half never calls a model and never touches the network.
  for (const f of fs.readdirSync('supabase/functions/_shared/designStudio/planRead')) {
    const src = read(`supabase/functions/_shared/designStudio/planRead/${f}`);
    assert.ok(!/fetch\(|Deno\.|from 'npm:|from 'jsr:|https:\/\//.test(src), `${f} must stay pure`);
  }
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
  assert.match(flow, /ceilingM \? 'CUSTOMER' : doc\??\.ceilingHeight \? 'DRAWING' : 'TYPICAL'/);
  assert.match(read('src/components/designStudio/workspace/Inspector.tsx'), /ds_inspector_ceiling_typical/);
});

test('the reader is deployed with JWT verification like every signed-in function', () => {
  assert.match(read('.github/workflows/deploy.yml'), /"design-studio-reconstruct"/);
  assert.match(read('supabase/functions/design-studio-reconstruct/index.ts'), /route === 'floorplan'\) return handleFloorplan\(req\)/);
});

test('table privileges are explicit and sources/jobs are read-only to customers', () => {
  assert.match(MIGRATION, /REVOKE ALL ON [^;]*public\.ds_jobs FROM authenticated;/);
  assert.match(MIGRATION, /GRANT SELECT ON public\.ds_spatial_sources TO authenticated;/);
  assert.match(MIGRATION, /GRANT SELECT ON public\.ds_jobs TO authenticated;/);
  assert.match(MIGRATION, /DS_VERIFICATION_DISAGREES/, 'VERIFIED is not checked against the geometry');
  assert.match(MIGRATION, /DS_OBJECT_KEY_INVALID/, 'a floor-plan row may point at any object');
});

/* ── The customer's own 3D model (checkpoint 6) ──────────────────── */

test('the model importer reads the bytes back and decides on the server', () => {
  const fn = read('supabase/functions/design-studio-model/index.ts');
  assert.match(fn, /refuseIfImpersonating\(/, 'an impersonating admin could import into a customer project');
  assert.match(fn, /caller\.from\('ds_projects'\)/, 'the project is not read as the caller (RLS decides ownership)');
  assert.match(fn, /key\.startsWith\(prefix\)/, 'the object key is not checked against the caller and project');
  assert.match(fn, /inspectModel\(bytes\)/, 'the model is not inspected from its bytes');
  assert.match(fn, /geometry_state: 'ESTIMATED'/, 'an uploaded model claims measured dimensions');
  assert.ok(!/recordUnbilledUsage|charge|debit/i.test(fn.replace(/\/\/.*$/gm, '')), 'model inspection is billed');
  assert.ok(!/openai|anthropic/i.test(fn), 'model inspection calls an AI provider');
  assert.match(read('.github/workflows/deploy.yml'), /"design-studio-model"/);
});

test('the inspector refuses external resources and unknown decoders', () => {
  const src = read('supabase/functions/_shared/designStudio/modelInspect.ts');
  assert.match(src, /refuse\('EXTERNAL_RESOURCE'/);
  assert.match(src, /refuse\('UNSUPPORTED_EXTENSION'/);
  assert.ok(!/\bfetch\(/.test(src), 'the inspector fetches something a model points at');
});

test('the browser only offers glTF and uploads through the shared R2 client', () => {
  const svc = read('src/services/designStudio/models.ts');
  assert.match(svc, /category: 'design-studio-models'/);
  assert.match(svc, /OTHER_FORMATS/, 'other formats are not refused by name');
  assert.ok(!/storage\.from\(/.test(svc), 'models are written to a Supabase bucket instead of R2');
  assert.match(read('supabase/functions/_shared/storage/keys.ts'), /const DS_MODEL: ContentPolicy = \{ mime: \['model\/gltf-binary', 'model\/gltf\+json'\], maxBytes: 100 \* MB \}/);
});

test('model furniture can be hidden, never moved', () => {
  const ops = read('src/lib/designStudio/operations.ts');
  assert.match(ops, /SET_PART_HIDDEN/);
  assert.ok(!/MOVE_PART|ROTATE_PART/.test(ops), 'model parts can be moved: they were modelled in place');
});

/* ── The AI designer (checkpoint 7) ─────────────────────────────── */

test('the AI designer returns a validated plan and never writes a design', () => {
  const fn = read('supabase/functions/design-studio-reconstruct/design.ts');
  assert.match(fn, /refuseIfImpersonating\(/);
  assert.match(fn, /caller\.from\('ds_versions'\)/, 'the version is not read as the caller');
  assert.match(fn, /validatePlan\(raw, ctx, brief\)/, 'the model output is not validated');
  assert.ok(!/from\('ds_versions'\)\.(insert|update|upsert)|from\('ds_version_events'\)/.test(fn), 'the AI function writes a design');
  assert.match(fn, /BILLING_CONFIRMATION_REQUIRED/, 'an enabled billing switch could become a charge without confirmation');
  assert.match(fn, /meterAiCall\(admin,/, 'AI design is not metered');
  assert.ok(!/rpc\(['"](charge|debit|reserve|settle)/i.test(fn.replace(/\/\/.*$/gm, '')), 'AI design charges');
  assert.match(fn, /strict: true/, 'the model is not held to the schema');
  assert.match(read('supabase/functions/design-studio-reconstruct/index.ts'), /route === 'design'\) return handleDesign\(req\)/);
});

test('style codes and plan shape stay in step between server and browser', () => {
  const server = read('supabase/functions/_shared/designStudio/aiPlan.ts');
  const grammar = read('src/lib/designStudio/grammar.ts');
  const codes = (src) => src.match(/STYLE_CODES = \[([^\]]+)\]/)[1].replace(/\s/g, '');
  assert.equal(codes(grammar), codes(server));
  const client = read('src/lib/designStudio/aiPlan.ts');
  for (const field of ['roomId', 'wallColor', 'wallMaterial', 'floorMaterial', 'clearFurniture', 'furniture']) {
    assert.match(server, new RegExp(`${field}: `), `server plan lacks ${field}`);
    assert.match(client, new RegExp(`${field}: `), `browser plan lacks ${field}`);
  }
});

test('the customer look is the same contract on the server and in the browser', () => {
  const browser = read('src/lib/designStudio/planToHome.ts');
  const server = read('supabase/functions/_shared/designStudio/designIntent.ts');
  const list = (src, name) => (src.match(new RegExp(`${name} = \\[([^\\]]+)\\]`)) ?? [])[1]?.replace(/\s/g, '');
  for (const name of ['MOODS', 'FLOOR_DIRECTIONS', 'WALL_DIRECTIONS', 'ACCENTS', 'PALETTES', 'FURNISHING_LEVELS']) {
    assert.ok(list(browser, name), `browser lacks ${name}`);
    assert.equal(list(server, name), list(browser, name), `${name} drifted between server and browser`);
  }
  const cap = (src) => src.match(/FURNISHING_CAP: Record<FurnishingLevel, number> = (\{[^}]+\})/)[1];
  assert.equal(cap(server), cap(browser), 'FURNISHING_CAP drifted');
  const fn = read('supabase/functions/design-studio-reconstruct/design.ts');
  assert.match(fn, /offerFor\(fullCtx, brief\.preferences\)/, 'the model is not limited to what fits the look');
  assert.match(fn, /intent: \{\s*plan, preferences: brief\.preferences, model: MODEL/, 'the validated intent is not recorded on the job');
  assert.match(read('supabase/functions/_shared/designStudio/aiPlan.ts'), /applyIntent\(/, 'the plan is not held to the look');
  assert.match(read('src/services/designStudio/ai.ts'), /export async function designFromPreferences\(/);
});

test('an AI proposal reaches a design only through the operation validator, as AI with its job', () => {
  const conv = read('src/lib/designStudio/aiPlan.ts');
  assert.match(conv, /validateOperation\(working, op, input\.ctx\)/);
  assert.match(conv, /autoPlace\(/, 'AI furniture is not placed by the deterministic engine');
  assert.ok(!/SET_LOCKS/.test(conv), 'a proposal can change what the customer keeps');
  const ws = read('src/components/designStudio/workspace/DesignWorkspace.tsx');
  assert.match(ws, /session\.apply\(proposal\.ops, t\('ds_label_ai'\), 'AI', ai\.jobId\)/);
  assert.match(ws, /origin: 'AI', jobId: ai\.jobId/);
});

test('AI copy never quotes a price', () => {
  const src = read('scripts/design-studio-i18n-data-7.mjs');
  assert.ok(!/[$€₾]\s?\d|\d\s?(GEL|USD|EUR)\b/.test(src), 'AI copy states a price');
  assert.ok(!/\block|\bunlock/i.test(src.split('\n').filter((l) => l.includes("'")).map((l) => l.split("'")[1] ?? '').join(' ')), 'lock words in customer copy');
});

/* ── Public share links (checkpoint 8) ──────────────────────────── */

const SHARES = read('supabase/migrations/20260930094000_design_studio_shares.sql');

test('share tokens are random, hashed at rest, and returned only once', () => {
  assert.match(SHARES, /extensions\.gen_random_bytes\(32\)/, 'a token is not 256 random bits');
  assert.match(SHARES, /token_hash\s+text NOT NULL UNIQUE/);
  assert.ok(!/\btoken\s+text\b/i.test(SHARES.replace(/--.*$/gm, '')), 'a plaintext token column exists');
  assert.match(SHARES, /encode\(extensions\.digest\(p_token, 'sha256'\), 'hex'\)/, 'the public lookup is not by hash');
});

test('the public can read exactly one function; everything else is closed', () => {
  assert.match(SHARES, /GRANT EXECUTE ON FUNCTION public\.ds_public_share\(text\) TO anon, authenticated;/);
  assert.match(SHARES, /REVOKE ALL ON FUNCTION public\.ds_create_share\(uuid, text, text, timestamptz\) FROM public, anon;/);
  assert.match(SHARES, /REVOKE ALL ON FUNCTION public\.ds_revoke_share\(uuid\) FROM public, anon;/);
  assert.match(SHARES, /REVOKE ALL ON public\.ds_published_designs, public\.ds_shares FROM anon, authenticated;/);
  // The public payload names no owner, project, version, source or storage key.
  const payload = SHARES.slice(SHARES.indexOf("RETURN jsonb_build_object(\n    'status', 'ACTIVE'"));
  for (const leak of ["'projectId'", "'userId'", "'versionId'", "'sourceId'", 'model_key', 'object_key', 'thumbnail_key', 'label']) {
    assert.ok(!payload.slice(0, payload.indexOf('END $$')).includes(leak), `the public payload exposes ${leak}`);
  }
});

test('a link freezes a snapshot; snapshots are shared, never copied per link', () => {
  assert.match(SHARES, /CONSTRAINT ds_published_once UNIQUE \(version_id, state_hash\)/);
  assert.match(SHARES, /RAISE EXCEPTION 'DS_SNAPSHOT_IMMUTABLE'/);
  assert.match(SHARES, /ON CONFLICT \(version_id, state_hash\) DO NOTHING/);
});

test('the public viewer is its own small page, not the signed-in app', () => {
  const files = [...walk('src/share'), 'src/components/designStudio/workspace/WalkthroughOverlay.tsx'];
  for (const file of files) {
    const src = read(file);
    for (const banned of ['@/db/supabase', '@/contexts/', '@/i18n/translations', '@/services/', 'react-router']) {
      assert.ok(!src.includes(banned), `${file} pulls ${banned} into the public bundle`);
    }
  }
  const vercel = JSON.parse(read('vercel.json'));
  const rewrites = vercel.rewrites.map((r) => r.source);
  assert.ok(rewrites.indexOf('/w/:token') > -1 && rewrites.indexOf('/w/:token') < rewrites.indexOf('/((?!assets/).*)'), '/w/ is not rewritten to share.html before the app');
  const html = read('share.html');
  assert.match(html, /noindex/);
  assert.match(html, /src="\/src\/share\/main\.tsx"/);
  assert.match(read('vite.config.ts'), /share: path\.resolve\(__dirname, 'share\.html'\)/);
});

test('the /d/ design link is rewritten to the viewer like /w/', () => {
  const vercel = JSON.parse(read('vercel.json'));
  const rewrites = vercel.rewrites.map((r) => r.source);
  assert.ok(rewrites.indexOf('/d/:token') > -1 && rewrites.indexOf('/d/:token') < rewrites.indexOf('/((?!assets/).*)'), '/d/ is not rewritten to share.html before the app');
  assert.match(read('src/services/designStudio/shares.ts'), /'DESIGN' \? 'd' : 'w'|\/d\//);
});

test('what a piece may do is declared on the asset and enforced by the operations', () => {
  assert.match(MIGRATION, /capabilities\s+text\[\] NOT NULL DEFAULT '\{MOVABLE,ROTATABLE,REPLACEABLE,DUPLICATABLE\}'/);
  assert.match(MIGRATION, /interactions\s+jsonb NOT NULL DEFAULT '\[\]'/);
  const ops = read('src/lib/designStudio/operations.ts');
  for (const cap of ['MOVABLE', 'ROTATABLE', 'REPLACEABLE']) assert.match(ops, new RegExp(`'${cap}'`), `operations do not check ${cap}`);
  assert.match(ops, /NOT_ALLOWED_FOR_ASSET/);
});

test('opening doors and cupboards is visitor-only: never an operation, never saved', () => {
  const ops = read('src/lib/designStudio/operations.ts');
  assert.ok(!/TOGGLE|OPEN_PART|INTERACT/.test(ops), 'an open/close state leaked into the design operations');
  const scene = read('src/components/designStudio/canvas/SceneController.ts');
  assert.match(scene, /resetInteractives\(\)/);
  for (const file of ['src/share/ShareViewer.tsx', 'src/components/designStudio/canvas/SceneController.ts']) {
    const src = read(file);
    assert.ok(!/(ds_create_share|saveVersion|applyOperations)\([^)]*interactiveStates/.test(src), `${file} persists walkthrough state`);
  }
  // Motion is time-based and runs in the render loop, not through React state.
  assert.match(read('src/lib/designStudio/interactions.ts'), /export function motionAt/);
  assert.match(scene, /this\.living\.step\(now\)/);
  assert.match(read('src/components/designStudio/canvas/livingRuntime.ts'), /easeInOut\(raw\)/);
});

test('closed doors block the walk; open ones let you through', () => {
  const nav = read('src/lib/designStudio/navigation.ts');
  assert.match(nav, /closedDoors/);
  assert.match(nav, /export function setDoorClosed/);
});

test('downloads are images and a PDF; no 3D file is offered and the walkthrough is not downloadable', () => {
  const dialog = read('src/components/designStudio/workspace/DownloadDialog.tsx');
  assert.ok(!/\.(glb|gltf|obj|fbx|usdz)['"`]/i.test(dialog), 'a 3D file format is offered for download');
  assert.ok(!/walkthrough.*\.(mp4|webm|zip)/i.test(dialog), 'the walkthrough is offered as a download');
  assert.match(dialog, /images\.zip/);
  assert.match(dialog, /presentation\.pdf/);
});

test('the scene debug hook exists only in the QA harness build', () => {
  for (const file of [...DS_SOURCES, ...walk('src/share')]) {
    const src = read(file);
    for (const line of src.split('\n').filter((l) => l.includes('__dsScene'))) {
      assert.match(line, /import\.meta\.env\.MODE === 'harness'/, `${file} exposes the scene outside the harness build`);
    }
  }
});

test('reconstruction reads pictures as the caller, is JWT-verified and shipped, and never writes geometry or a design', () => {
  const fn = read('supabase/functions/design-studio-reconstruct/reconstruct.ts');
  assert.match(fn, /caller\.from\('ds_reconstructions'\)/, 'the reconstruction is read as the caller (RLS decides)');
  assert.match(fn, /sniffType\(/, 'pictures are checked by their bytes');
  assert.match(fn, /BILLING_CONFIRMATION_REQUIRED/, 'refuses rather than charging if billing is switched on early');
  assert.ok(!/from\('ds_spatial_sources'\)\.insert|from\('ds_versions'\)\.insert|rpc\('ds_create_floorplan_source'/.test(fn), 'the reader never builds geometry or a design');
  assert.ok(!/\[functions\.design-studio-reconstruct\][\s\S]{0,40}verify_jwt\s*=\s*false/.test(read('supabase/config.toml')), 'JWT verification stays on');
  assert.match(read('.github/workflows/deploy.yml'), /"design-studio-reconstruct"/);
});

test('the browser and the server read reconstructions with byte-identical code', () => {
  assert.equal(read('src/lib/designStudio/reconstructRead.ts').replace(/\r\n/g, '\n'), read('supabase/functions/_shared/designStudio/reconstructRead.ts').replace(/\r\n/g, '\n'));
});

test('what a picture became stays private: public snapshots strip provenance', () => {
  assert.match(read('supabase/migrations/20260930094000_design_studio_shares.sql'), /o - 'provenance'/);
  // A model built from the customer's picture is owner-private: its key never reaches a public snapshot.
  assert.match(read('supabase/migrations/20261005100000_design_studio_factory.sql'), /o - 'provenance' - 'generated'/);
});

test('reconstructed pieces carry provenance, and only the customer confirms them', () => {
  assert.match(read('src/lib/designStudio/operations.ts'), /if \(meta\.origin === 'USER'\) current = confirmEdited/);
  assert.match(read('src/lib/designStudio/aiPlan.ts'), /!o\.provenance\?\.confirmed/);
});

test('light is a fixed pool, never a light per lamp (every forward-rendered light costs every pixel)', () => {
  const rt = read('src/components/designStudio/canvas/livingRuntime.ts');
  assert.equal((rt.match(/new THREE\.PointLight\(/g) ?? []).length, 1, 'point lights are created once, for the pool');
  assert.match(read('src/components/designStudio/canvas/SceneController.ts'), /maxLights: quality\.tier === 'HIGH' \? 4/);
});

test('mobile: the walking thumb is physically on the left in every language', () => {
  assert.match(read('src/components/designStudio/workspace/WalkthroughOverlay.tsx'), /absolute bottom-0 left-0 top-28/);
});

test('the three AI readings share one deployed function, because the project is at its function cap', () => {
  const index = read('supabase/functions/design-studio-reconstruct/index.ts');
  // One router, three handlers, routed by path: no handler reads another's body.
  assert.match(index, /import \{ handleDesign \} from '\.\/design\.ts'/);
  assert.match(index, /import \{ handleFloorplan \} from '\.\/floorplan\.ts'/);
  assert.match(index, /import \{ handleReconstruct \} from '\.\/reconstruct\.ts'/);
  assert.ok(!/req\.json\(|req\.clone\(/.test(index), 'the router must route by path, not by reading the body');
  // Each handler keeps its own guards.
  for (const f of ['design.ts', 'floorplan.ts', 'reconstruct.ts']) {
    const h = read(`supabase/functions/design-studio-reconstruct/${f}`);
    assert.match(h, /caller\.auth\.getUser\(\)/, `${f}: the caller is not authenticated`);
    assert.match(h, /refuseIfImpersonating\(/, `${f}: an impersonated session could drive it`);
    assert.match(h, /BILLING_CONFIRMATION_REQUIRED/, `${f}: an enabled billing switch could become a charge`);
    assert.ok(!/\bserve\(/.test(h), `${f}: a handler must not start its own server`);
  }
  // The browser calls the routes; the two retired function names are gone.
  assert.match(read('src/services/designStudio/ai.ts'), /invoke\('design-studio-reconstruct\/design'/);
  assert.match(read('src/services/designStudio/floorplans.ts'), /invoke\('design-studio-reconstruct\/floorplan'/);
  assert.ok(!/"design-studio-(ai|floorplan)"/.test(read('.github/workflows/deploy.yml')), 'a function the project cap cannot hold is listed for deploy');
  for (const gone of ['design-studio-ai', 'design-studio-floorplan']) {
    assert.ok(!fs.existsSync(path.join(ROOT, 'supabase/functions', gone)), `${gone} came back as its own function`);
  }
});

/* ── Permanent project deletion ───────────────────────────────────── */

test('permanent deletion is a server lifecycle, not a hidden row', () => {
  const sql = read('supabase/migrations/20261001170000_design_studio_project_deletion.sql');
  assert.ok(!/^\s*(BEGIN|COMMIT)\s*;/im.test(sql), 'the migration runner owns the transaction');
  // The browser can no longer delete the row (that would orphan every upload).
  assert.match(sql, /DROP POLICY IF EXISTS ds_projects_delete ON public\.ds_projects;/);
  assert.match(sql, /REVOKE DELETE ON public\.ds_projects FROM authenticated;/);
  // Begin: the owner only, as themselves; shares revoked in the same step.
  const begin = sql.slice(sql.indexOf('FUNCTION public.ds_project_delete_begin'), sql.indexOf('FUNCTION public.ds_project_delete_finish'));
  assert.match(begin, /public\.auth_user_id\(\)/);
  assert.match(begin, /v_project\.user_id <> v_me THEN\s+RAISE EXCEPTION 'DS_NOT_FOUND'/, 'a non-owner (admins included) must read it as not found');
  assert.match(begin, /UPDATE public\.ds_shares SET revoked_at = now\(\)/);
  // Finish: service only, and only once storage is empty; a tombstone keeps ids.
  const finish = sql.slice(sql.indexOf('FUNCTION public.ds_project_delete_finish'));
  assert.match(finish, /auth\.role\(\) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'DS_SERVICE_ONLY'/);
  assert.match(finish, /lifecycle IN \('ACTIVE', 'PENDING'\)[\s\S]*DS_STORAGE_NOT_EMPTY/);
  assert.match(finish, /INSERT INTO public\.ds_project_tombstones/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.ds_project_delete_finish\(uuid\) TO service_role;/);
  assert.ok(!/GRANT EXECUTE ON FUNCTION public\.ds_project_delete_finish\(uuid\) TO [^;]*authenticated/.test(sql));
  // Money and audit rows are never touched.
  assert.ok(!/usage_events|credit_|wallet|ledger_entries|billing_/i.test(sql.replace(/--.*$/gm, '')), 'deletion must not touch billing or usage rows');
});

test('the delete route asks the bucket, deletes storage first, and finishes only as the service', () => {
  const route = read('supabase/functions/design-studio-reconstruct/project.ts');
  assert.match(read('supabase/functions/design-studio-reconstruct/index.ts'), /route === 'project-delete'\) return handleProjectDelete\(req\)/);
  assert.match(route, /refuseIfImpersonating\(/, 'an impersonated session could delete a customer\'s project');
  assert.match(route, /caller\.rpc\('ds_project_delete_begin'/, 'ownership must be decided by the database, as the caller');
  assert.match(route, /CONFIRMATION_MISMATCH/, 'the typed name is checked on the server too');
  assert.match(route, /listObjects\(prefix\)/, 'objects nothing wrote a row for would be left behind');
  assert.match(route, /await deleteObject\(entry\.key\)/);
  assert.match(route, /'design-studio-floorplans', 'design-studio-models', 'design-studio-thumbnails'/);
  assert.match(route, /admin\.rpc\('ds_project_delete_finish'/);
  assert.ok(route.indexOf("deleteObject(") < route.indexOf("ds_project_delete_finish'"), 'rows must not go before the files');
});

test('the browser deletes only through the server, and a deleting project is gone everywhere', () => {
  const svc = read('src/services/designStudio/projects.ts');
  assert.match(svc, /invoke\('design-studio-reconstruct\/project-delete'/);
  assert.match(svc, /\.is\('deleting_at', null\)/, 'a project being deleted still shows in the list');
  assert.match(svc, /deleting_at\) return null/, 'an old project URL still opens a project being deleted');
  const direct = walk('src').filter((f) => /\.(ts|tsx)$/.test(f))
    .filter((f) => /from\('ds_projects'\)[\s\S]{0,40}\.delete\(/.test(read(f)));
  assert.deepEqual(direct, [], 'something deletes the project row from the browser');
  const page = read('src/pages/designStudio/DesignStudioPage.tsx');
  assert.match(page, /ds_action_rename/);
  assert.match(page, /ds_action_delete_permanent/);
  assert.match(page, /typed\.trim\(\) === project\.name\.trim\(\)/, 'deleting needs the typed name');
  assert.match(page, /resumePendingDeletions\(userId\)/, 'an interrupted deletion is never finished');
});

test('a Design Studio AI call is priced from the book, and an unknown cost is never written as zero', () => {
  // The handlers used to price from two environment rates that were never
  // set, so every job landed as ai_cost_cents 0 / landed 0: a silent zero
  // that reads as "free" in finance. The price book is the one source.
  const dir = 'supabase/functions/design-studio-reconstruct';
  for (const file of ['reconstruct.ts', 'floorplan.ts', 'design.ts']) {
    const src = read(`${dir}/${file}`);
    assert.doesNotMatch(src, /OPENAI_USD_PER_MTOK/, `${file} must not price from environment rates`);
    assert.doesNotMatch(src, /recordUnbilledUsage/, `${file} must meter through metering.ts, not write usage itself`);
    assert.match(src, /meterAiCall\(admin,/, `${file} must meter its AI call`);
  }
  const meter = read(`${dir}/metering.ts`);
  assert.match(meter, /rpc\('ds_ai_cost_evidence'/, 'the meter prices through the canonical book');
  assert.match(meter, /aiCostCents: cost\.aiCents \?\? undefined/, 'an unpriced call leaves the cost unknown');
  assert.match(meter, /pricingState: cost\.pricingState/, 'the meter states how the cost was obtained');
  assert.match(meter, /cached_tokens/, 'cached input is priced at the cached rate, not as fresh input');

  const billing = read('supabase/functions/_shared/billing.ts');
  assert.match(billing, /\.\.\.\(usage\.pricingState \? \{ pricing_state: usage\.pricingState \} : \{\}\)/,
    'recordUnbilledUsage writes pricing_state only when the caller states it, so other writers are unchanged');

  const mig = read('supabase/migrations/20261001190000_design_studio_cogs_evidence.sql');
  assert.match(mig, /if v_in is null or v_out is null then[\s\S]{0,120}'UNPRICED', 'ai_cost_cents', null/,
    'a missing rate is UNPRICED with a null cost');
  assert.match(mig, /REVOKE ALL ON FUNCTION public\.ds_ai_cost_evidence[^;]*FROM PUBLIC, anon, authenticated/);
  assert.match(mig, /finance_design_studio_economics[\s\S]{0,200}perform public\.finance_require_admin\(\)/,
    'the economics report is admin-only');
  assert.match(mig, /filter \(where p\)/, 'statistics are over priced samples only');
});

test('a design rebuilt from pictures never tells anyone it was drawn from a floor plan', () => {
  // The workspace, the public viewer and the downloaded PDF each carry the
  // "sizes are approximate" note; each must know where the space came from.
  const mig = read('supabase/migrations/20261001200000_design_studio_share_origin.sql');
  assert.match(mig, /'origin', CASE v_pub\.origin WHEN 'CUSTOMER_PICTURES' THEN 'PICTURES' WHEN 'CUSTOMER_FLOORPLAN' THEN 'FLOORPLAN' END/,
    'the public payload states the coarse origin');
  // Catalogue assets carry their own (public) provenance; the SOURCE's is read only for its origin.
  assert.equal((mig.match(/src\.provenance/g) ?? []).length, 1, 'the source provenance is read once');
  assert.match(mig, /src\.provenance->>'origin' AS origin/, 'and only its origin');
  assert.doesNotMatch(mig, /v_pub\.provenance|'origin', v_pub\.origin\b/, 'the public payload exposes nothing more of the source');
  const viewer = read('src/share/ShareViewer.tsx');
  assert.match(viewer, /origin === 'PICTURES' \? 'share_estimated_pictures' : 'share_estimated'/);
  assert.doesNotMatch(viewer, /say\('share_estimated'\)/, 'no estimate note is hard-wired to the floor-plan sentence');
  const dl = read('src/components/designStudio/workspace/DownloadDialog.tsx');
  assert.match(dl, /fromPictures \? 'ds_export_truth_estimated_pictures' : 'ds_export_truth_estimated'/);
  assert.match(read('src/components/designStudio/workspace/DesignWorkspace.tsx'), /fromPictures=\{label\.originKey === 'ds_source_pictures'\}/);
});

test('"matched to your picture\'s camera" is said only for a camera the reading trusted', () => {
  const panel = read('src/components/designStudio/workspace/ReferencePanel.tsx');
  assert.match(panel, /fit\.rms <= FIT_TRUST \? 'ds_recon_matched_view' : 'ds_recon_approx_view'/);
  assert.match(read('src/lib/designStudio/reconstructRead.ts'), /export const FIT_TRUST = 0\.025;/);
});

test('catalogue importer: credentials stay in Supabase, runs are deliberate, bulk import needs the owner', () => {
  const route = read('supabase/functions/design-studio-model/catalog.ts');
  assert.match(route, /Deno\.env\.get\('BLENDKIT_API_KEY'\)/, 'the Blendkit key is read by the signing route');
  for (const f of ['scripts/design-studio/catalog-import.mjs', 'src/lib/designStudio/catalogPipeline.ts', 'src/lib/designStudio/catalogProviders/blendkit.ts', '.github/workflows/design-studio-catalog.yml']) {
    assert.doesNotMatch(read(f), /(process\.env|Deno\.env\.get\(|secrets)[.[('"\s]*(BLENDKIT_API_KEY|R2_SECRET_ACCESS_KEY|R2_ACCESS_KEY_ID)/, `${f} never reads a provider or R2 credential`);
  }
  assert.match(route, /isServiceRole\(req\.headers\.get\('Authorization'\)/, 'service role only');
  const wf = read('.github/workflows/design-studio-catalog.yml');
  assert.doesNotMatch(wf, /^\s*schedule:/m, 'no scheduled, unattended runs');
  assert.match(wf, /workflow_dispatch:/);
  // A canary names its assets: discover with ids passes them, and the whole provider needs the owner box.
  assert.match(wf, /if \[ -n "\$IDS" \]; then node scripts\/design-studio\/catalog-import\.mjs discover --provider "\$PROVIDER" --ids "\$IDS"/);
  assert.match(wf, /elif \[ "\$ALL_APPROVED" = "true" \]; then node scripts\/design-studio\/catalog-import\.mjs discover --provider "\$PROVIDER" --all/);
  // GitHub rejects the whole file (a push-triggered "failure" with no jobs, and no Run button) when the
  // runner context is used outside steps; job-level env may not reference it.
  const jobEnv = /\n {4}env:\n((?: {6}.*\n)+)/.exec(wf.replace(/\r\n/g, '\n'))?.[1] ?? '';
  assert.match(jobEnv, /SUPABASE_URL/, 'the job-level env block is found');
  assert.doesNotMatch(jobEnv, /\$\{\{\s*runner\./, 'no runner context in job-level env');
  const runner = read('scripts/design-studio/catalog-import.mjs');
  assert.match(runner, /if \(!args\.includes\('--owner-approved'\)\) throw/, 'queuing a whole provider needs the owner');
  assert.match(runner, /else \{ console\.error\('discover needs --ids a,b,c \(named assets\) or --all \(the whole provider\)'\); process\.exit\(2\); \}/, 'discovery never defaults to the whole provider');
  assert.doesNotMatch(runner, /console\.log\([^)]*\burl\b/i, 'no URL is ever printed');
  // KTX2 is real or the asset fails: KTX-Software >= 4.4 (gltf-transform 4.5 needs `ktx create`; 4.3 fell back to JPEG silently).
  assert.match(wf, /KTX-Software\/releases\/download\/v4\.(4|[5-9])\.\d+\//, 'KTX-Software 4.4+');
  assert.match(runner, /if \(facts\.textures > 0 && !facts\.compressed\) throw new Error/, 'an uncompressed runtime GLB fails');
  assert.match(runner, /=== crypto\.createHash\('md5'\)\.update\(fs\.readFileSync\(main\)\)\.digest\('hex'\);/, 'an identical LOD1 is not stored twice');
  // Every queued asset carries its batch; an admin's decision is never overridden by the importer.
  assert.match(runner, /&import_batch_id=is\.null`, \{\n\s+method: 'PATCH', prefer: 'return=minimal', body: \{ import_batch_id: batch \},/);
  assert.match(runner, /\['DISABLED', 'PENDING_DELETE', 'DELETED'\]\.includes\(r\.lifecycle\)/);
  // Publishing is named and READY-only: never a whole provider, never an unfinished import.
  assert.match(runner, /if \(!named\) throw new Error\('activate needs --ids \(named assets only\)'\);/);
  assert.match(runner, /if \(r\.state !== 'READY'\) \{ log\(`  not activated/);
  assert.match(runner, /\?homatch_asset_id=eq\.\$\{r\.homatch_asset_id\}&quality_state=eq\.READY&select=homatch_asset_id/);
  assert.match(wf, /if \[ -z "\$IDS" \]; then echo "activate needs ids"; exit 2; fi/);
  const pipeline = read('src/lib/designStudio/catalogPipeline.ts');
  assert.match(pipeline, /state: r\.refusal \? 'EXCLUDED' : 'DISCOVERED'/, 'discovery never queues');
});

test('Design Studio catalogue admin: admin-only route, audited RPCs only, typed confirmation for destructive bulk actions', () => {
  const page = read('src/pages/admin/AdminDesignCatalogPage.tsx');
  const svc = read('src/services/designStudio/adminCatalog.ts');
  const routes = read('src/routes.tsx');
  assert.match(routes, /path: '\/admin\/design-catalog', element: adminWrap\(<AdminDesignCatalogPage \/>\), adminOnly: true/);
  // Availability and deletion go through the audited, admin-only database functions / server route — never a direct table write.
  assert.doesNotMatch(svc, /\.(update|insert|delete|upsert)\(/, 'no direct writes from the browser');
  assert.match(svc, /rpc\('ds_catalog_admin_set_lifecycle'/);
  assert.match(svc, /rpc\('ds_catalog_admin_requeue'/);
  assert.match(svc, /functions\.invoke\('design-studio-model\/catalog-purge'/);
  // The list is paged on the server: a 2,000-asset catalogue never comes to the browser at once.
  assert.match(svc, /export const PAGE_SIZE = 50;/);
  assert.match(svc, /\.range\(from, from \+ PAGE_SIZE - 1\)/);
  // Destructive bulk actions need the count typed, and the confirmed count is what the server checks.
  assert.match(page, /export const needsTypedCount = \(action: Action, n: number\) => action === 'PURGE' \|\| action === 'REQUEST_DELETE' \|\| n >= 50;/);
  assert.match(page, /const PURGE_MAX = 200;/);
  assert.match(page, /purge\(ids, ids\.length\)/);
});

test("the customer's original picture is kept, never replaced by the analysis copy", () => {
  const svc = read('src/services/designStudio/reconstructions.ts');
  const up = svc.slice(svc.indexOf('export async function uploadReference'));
  assert.match(up, /purpose: 'DS_REFERENCE_ORIGINAL'/, 'a derived analysis copy never replaces the original upload');
  assert.match(up, /file: input\.file, contentType: input\.file\.type/, 'the original bytes are uploaded as supplied');
  assert.match(up, /original_key: original/);
  assert.match(read('supabase/functions/_shared/storage/keys.ts'), /const DS_FLOORPLAN: ContentPolicy = \{[\s\S]{0,120}maxBytes: 40 \* MB/,
    'the picture category holds what the client accepts (40 MB)');
  const mig = read('supabase/migrations/20261001210000_design_studio_original_source.sql');
  assert.match(mig, /OR NEW\.original_key IS DISTINCT FROM OLD\.original_key/, 'the original is immutable');
});

test('a measured picture: optional evidence, read through the server\'s own validator, never a blocker', () => {
  const svc = read('src/services/designStudio/reconstructions.ts');
  const measure = svc.slice(svc.indexOf('export async function measurePicture'), svc.indexOf('export async function uploadReference'));
  assert.match(measure, /catch \{\s*return null;\s*\}/, 'measuring never blocks an upload');
  const up = svc.slice(svc.indexOf('export async function uploadReference'));
  assert.match(up, /\.catch\(\(\) => null\)/, 'a failed plan-view upload leaves the picture plain');
  assert.match(up, /picture_geometry: planView \? measured!\.frame : null/, 'a frame is stored only with its plan view');
  const fn = read('supabase/functions/design-studio-reconstruct/reconstruct.ts');
  assert.match(fn, /const frame = readFrame\(ref\.picture_geometry\)/, 'the stored frame is re-validated by the server');
  assert.match(fn, /key\.startsWith\(prefix\)/, 'the plan view must be under the project prefix');
  assert.match(fn, /frames: planRooms\.length \? \[\] : frames/, 'the customer\'s own floor plan wins over a measured picture');
  const mig = read('supabase/migrations/20261004100000_design_studio_picture_frame.sql');
  assert.match(mig, /OR NEW\.picture_geometry IS DISTINCT FROM OLD\.picture_geometry/, 'the measured frame is immutable');
  assert.match(mig, /\(plan_view_key IS NULL\) = \(picture_geometry IS NULL\)/, 'both or neither');
  // The trust threshold is unchanged; with a frame, its number is the outline agreement.
  const rr = read('src/lib/designStudio/reconstructRead.ts');
  assert.match(rr, /rms: outlineError\(f\.frame, al, rooms\.map/);
});

/* ── OpenAI-first generation: the first result never touches the 3D path ───── */

/** Code only (comments name what the path does NOT use; a test must not match its own prose). */
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('the first result is OpenAI\'s: no factory, RunPod, Blender, GLB or 3D asset library on its path', () => {
  const route = code('supabase/functions/design-studio-reconstruct/generate.ts');
  for (const banned of [/from '\.\/factory\.ts'/, /handleFactory/, /runpod/i, /RUNPOD/, /blender/i, /compileSceneSpec/, /ds_catalog_assets/, /ds_catalog_materials/, /\.glb/i, /startFactory/]) {
    assert.doesNotMatch(route, banned, `generate.ts: ${banned}`);
  }
  assert.match(route, /selectProvider\(deps, null, await configuredModel\(admin\)\)/, 'the existing OpenAI image provider, no override, no fallback');
  const flow = code('supabase/functions/_shared/designStudio/generationFlow.ts');
  // Its only mention of a factory is the guard that leaves factory rows alone (factory_job_id).
  assert.doesNotMatch(flow, /factory(?!_job_id)|runpod|blender|catalog/i);
  assert.match(flow, /if \(!ai \|\| row\.factory_job_id\) return \{ action: 'NONE' \};/);
  const home = code('src/services/designStudio/planToHome.ts');
  const gen = home.slice(home.indexOf('export async function generateHome'));
  for (const banned of [/runDesignBuild/, /startFactory/, /startRenders/, /listAssets/, /assetsByCode/, /designFromPreferences/, /planToOperations/, /compileSceneSpec/, /factoryStatus/]) {
    assert.doesNotMatch(gen, banned, `generateHome: ${banned}`);
  }
  // The design and its picture are one server-owned run (designRun.ts): spec → version → render, never the factory.
  assert.match(gen, /runDesign\(/);
  const run = code('src/services/designStudio/designRun.ts');
  assert.match(run, /design-studio-reconstruct\/design-spec/);
  assert.match(run, /generateRender\(/);
  for (const banned of [/startFactory/, /startRenders/, /factoryStatus/, /compileSceneSpec/, /listAssets/, /runpod/i, /blender/i]) {
    assert.doesNotMatch(run, banned, `designRun: ${banned}`);
  }
  const spec = code('supabase/functions/_shared/designStudio/designSpec.ts');
  assert.doesNotMatch(spec, /catalog|asset|materialCode/i, 'the specification never sees a catalogue');
  assert.match(spec, /type: 'input_image', image_url: images\.source/, 'the customer\'s own picture reaches OpenAI');
  // The walkthrough stays gated until PR2.
  assert.match(code('src/lib/designStudio/walkthroughOffer.ts'), /export const WALKTHROUGH_OFFERED = false;/);
});


/* ── The unified OpenAI-first product: photos, durable work, the Result, Snake ── */

test('a photo project is OpenAI-first: never the reconstruction, catalogue, factory, Blender or RunPod', () => {
  const flow = code('src/components/designStudio/unified/PhotoFlow.tsx');
  for (const banned of [/ReconstructionFlow/, /runReconstruction/, /measurePicture/, /startFactory/, /startRenders/, /compileSceneSpec/, /listAssets/, /catalog/i, /runpod/i, /blender/i, /DesignWorkspace/]) {
    assert.doesNotMatch(flow, banned, `PhotoFlow: ${banned}`);
  }
  assert.match(flow, /understandPhotos\(/, 'the photos are understood by the server-owned route');
  assert.match(flow, /runDesign\(/, 'the design is the server-owned OpenAI-first run');
  const route = code('supabase/functions/design-studio-reconstruct/photos.ts');
  for (const banned of [/factory/i, /runpod/i, /blender/i, /catalog/i, /reconstructRead/, /planDocument/]) {
    assert.doesNotMatch(route, banned, `photos.ts: ${banned}`);
  }
  assert.match(route, /photoReadRequest\(MODEL, images, language\)/, 'every photo goes to OpenAI in one reading');
  assert.match(route, /kind: 'PHOTO_SET'/, 'the project gets a photo source, not a reconstructed home');
  const service = code('src/services/designStudio/photos.ts');
  assert.match(service, /uploadReference\(\{ userId: input\.userId, projectId: input\.projectId, file, measure: false \}\)/, 'nothing is measured or rebuilt from a photo');
});

test('every Design Studio entry to photos opens the PhotoFlow; the reconstruction flow survives only inside an existing plan design', () => {
  const ws = code('src/pages/designStudio/DesignStudioWorkspacePage.tsx');
  assert.match(ws, /params\.get\('start'\) === 'photos' \|\| params\.get\('start'\) === 'image'/, 'new links and the old ?start=image link both open the PhotoFlow');
  assert.match(ws, /useState<null \| \{ planSource: SpatialSourceRecord \| null \}>\(null\)/, 'nothing opens the reconstruction flow from a launcher link');
  assert.match(ws, /onImage=\{\(\) => setPhotoFlow\(true\)\}/);
  assert.match(ws, /onFurnishFromPictures=\{resolution\.source\.kind === 'FLOORPLAN_SCENE'/, 'kept for compatibility, inside an existing floor-plan design only');
  assert.match(ws, /resolution\?\.source\?\.kind === 'PHOTO_SET'/, 'a photo project never opens the 3D editor');
  const launcher = code('src/pages/designStudio/DesignStudioPage.tsx');
  assert.match(launcher, /startFrom\('photos'\)/);
  assert.match(launcher, /startFrom\('floorplan'\)/);
  assert.doesNotMatch(launcher, /startFrom\('image'\)/);
});

test('reading, understanding and designing are owned by the server: answered at once, claimed once, taken over when abandoned', () => {
  const durable = code('supabase/functions/design-studio-reconstruct/durable.ts');
  assert.match(durable, /EdgeRuntime/);
  for (const rel of ['supabase/functions/design-studio-reconstruct/floorplan.ts', 'supabase/functions/design-studio-reconstruct/photos.ts']) {
    const src = code(rel);
    assert.match(src, /isFresh\(/, `${rel}: a live reading is answered, never started twice`);
    assert.match(src, /\.eq\('updated_at', \w+\.updated_at\)/, `${rel}: the claim is a compare-and-set`);
    assert.match(src, /inBackground\(/, `${rel}: the work continues after the answer`);
    assert.match(src, /json\(\{ state: 'RUNNING' \}, 202\)/, `${rel}: the request answers at once`);
    assert.match(src, /!body\.retry/, `${rel}: a stored failure is only asked again on the customer's own retry`);
    assert.doesNotMatch(src, /return json\(\{ error: 'ALREADY_RUNNING' \}, 409\);/, `${rel}: a reading in progress is not an error for the durable page`);
  }
  // A page loaded before the change (no durable flag) still gets the old, synchronous answer during a rollout.
  assert.match(code('supabase/functions/design-studio-reconstruct/floorplan.ts'), /if \(!body\.durable\) \{[\s\S]*?await work\(\);/);
  assert.match(code('supabase/functions/design-studio-reconstruct/generate.ts'), /if \(!body\.durable\) \{[\s\S]*?await writeSpec\(/);
  assert.match(code('src/services/designStudio/floorplans.ts'), /durable: true/);
  assert.match(code('src/services/designStudio/designRun.ts'), /durable: true/);
  const gen = code('supabase/functions/design-studio-reconstruct/generate.ts');
  assert.match(gen, /isFresh\(prior\.started_at\)/, 'a design in progress is answered, not paid for again');
  assert.match(gen, /failure\('RETRYABLE', 'ABANDONED'\)/, 'an abandoned design is taken over');
  assert.match(gen, /status: 'CANCELLED', error: 'DUPLICATE'/, 'two racing identical requests: one stands down before spending');
  assert.match(gen, /uuidFrom\(`ds-chain:\$\{job\.id\}:version`\)/, 'the chain\'s design version is made once (a deterministic id)');
  assert.match(gen, /kick\(ctx\.authorization, 'render-generate-step'/, 'the edit map is started by the server, not the page');
  const client = code('src/services/designStudio/durable.ts');
  assert.match(client, /DS_STILL_WORKING/, 'giving up watching is not a failure of the work');
});

test('the photo set source: an append-only migration, and the client knows it is never a 3D home', () => {
  const sql = read('supabase/migrations/20261010100100_design_studio_photo_set_source.sql');
  assert.match(sql, /'FLOORPLAN_SCENE','PHOTO_SET'/);
  assert.match(sql, /jsonb_array_length\(provenance->'referenceIds'\) BETWEEN 1 AND 6/);
  assert.doesNotMatch(sql, /\bDROP TABLE\b|\bDELETE FROM\b|\bTRUNCATE\b|\bBEGIN;|\bCOMMIT;/i, 'additive, and the runner owns the transaction');
  assert.match(code('src/lib/designStudio/types.ts'), /'PHOTO_SET'/);
});

test('Snake only watches: no service, no database, no job control', () => {
  const game = code('src/components/games/SnakeGame.tsx');
  for (const banned of [/@\/services\//, /supabase/i, /functions\.invoke/, /runDesign/, /fetch\(/]) {
    assert.doesNotMatch(game, banned, `SnakeGame: ${banned}`);
  }
  assert.match(game, /status: WatchedStatus/);
  const screens = code('src/components/designStudio/unified/Screens.tsx');
  assert.match(screens, /lazy\(\(\) => import\('@\/components\/games\/SnakeGame'\)\)/, 'loaded only when someone plays');
  assert.match(code('src/lib/games/snake.ts'), /export function step\(/);
});

test('Snake plays smoothly on its own clock: one frame loop, no interval, everything it adds it removes', () => {
  const game = code('src/components/games/SnakeGame.tsx');
  assert.match(game, /requestAnimationFrame\(frame\)/);
  assert.match(game, /cancelAnimationFrame\(raf\)/, 'the loop stops when the game closes');
  assert.doesNotMatch(game, /setInterval\(/, 'no runaway timer');
  assert.equal((game.match(/addEventListener\(/g) ?? []).length, (game.match(/removeEventListener\(/g) ?? []).length, 'every listener is removed');
  assert.match(game, /ro\.disconnect\(\)/);
  // The game is a ref read by the loop; React state changes only when the score or the state does.
  assert.match(game, /const engine = useRef</);
  assert.doesNotMatch(game, /setGame\(/);
  assert.match(game, /between\(/, 'drawn between cells, not jumping');
  assert.match(game, /tickMs\(e\.g\.score/, 'speed from the rules, not the refresh rate');
  // Only the board and the pad take touch gestures; the pad never mirrors in a right-to-left language.
  assert.match(game, /ref=\{board\}[\s\S]{0,80}touch-none/);
  assert.match(game, /ref=\{pad\} dir="ltr" className="[^"]*touch-none/);
  assert.doesNotMatch(game, /document\.body\.style|overflow-hidden';|preventDefault\(\);\s*\}\s*,\s*\{ passive: false \}/, 'the page itself is never locked from scrolling');
  // Ready while playing is said above the board; the game is neither paused nor left.
  assert.match(game, /dsx_sn_ready/);
  assert.match(game, /dsx_sn_view_result/);
  assert.doesNotMatch(game, /status === 'READY'[^\n]*togglePause/);
});

test('a design that did not finish: the recovery shows the server\'s real state and continues from the failed step', () => {
  const screens = code('src/components/designStudio/unified/Screens.tsx');
  assert.match(screens, /dsx_rec_title/);
  assert.match(screens, /dsx_rec_body/);
  assert.match(screens, /data-state=\{kept \? 'KEPT' : here \? 'RESUME' : 'PENDING'\}/);
  assert.match(screens, /onOpenProject \? \(/, '"back to project" only when there is a result to open');
  assert.match(screens, /r\.status === 'READY' && !!r\.final_key/);
  // The steps shown are the ones the server recorded (the specification id is saved only once it succeeded).
  assert.match(code('src/components/designStudio/unified/PhotoFlow.tsx'), /flow\?\.specJobId\s*\?\s*\{ done: \['UPLOAD', 'ANALYSIS', 'DESIGN'\], resumeAt: 'IMAGE' \}/);
  assert.match(code('src/components/designStudio/FloorPlanFlow.tsx'), /latestFlow\(plan\)\?\.specJobId\s*\?\s*\{ done: \['UPLOAD', 'ANALYSIS', 'DESIGN'\], resumeAt: 'IMAGE' \}/);
  assert.match(code('src/components/designStudio/FloorPlanFlow.tsx'), /const stored = await getFloorPlan\(plan\.id\)/, 'the record is read back before the recovery is shown');
  // The server: a refused specification is metered (OpenAI was paid) and says why, by code only.
  const gen = code('supabase/functions/design-studio-reconstruct/generate.ts');
  const metered = gen.indexOf('const cost = payload');
  assert.ok(metered > 0 && metered < gen.indexOf("return fail('SPEC_INVALID'"), 'metered before it is judged');
  assert.match(gen, /kind: 'SPEC_REJECTED', problems: specProblems\(raw, modeCtx\.evidence\)/);
  // A retry reuses what succeeded: the same key finds the specification first, and a failed picture keeps it.
  assert.match(gen, /rows\.find\(\(r\) => r\.status === 'SUCCEEDED' && r\.output\?\.kind === 'DESIGN_SPEC'\)/);
  assert.match(code('src/services/designStudio/designRun.ts'), /renderId = await renderDirectly\(input, versionId, progress\.specJobId, attempt\)/);
});

test('the protected edit pipeline (PR #65) is untouched; the 3D walkthrough is the server-built one', () => {
  // The legacy browser-driven walkthrough stays held back.
  assert.match(code('src/lib/designStudio/walkthroughOffer.ts'), /export const WALKTHROUGH_OFFERED = false;/);
  const result = code('src/components/designStudio/unified/DesignResult.tsx');
  assert.match(result, /editRender\(\{ renderId: hero\.id, edit, newVersionId: v\.id, quote: q\.quote/, 'edits go through the stable render-edit route');
  assert.doesNotMatch(result, /WALKTHROUGH_OFFERED/, 'the Result never offers the browser-driven walkthrough');
  assert.match(result, /data\.sourceKind === 'FLOOR_PLAN' && hero \? \(\s*<WalkthroughPanel /, 'a floor-plan design offers its walkthrough; a photo project has no rooms to walk');
  // The walkthrough is made by the server: the page never drives the factory, RunPod or a build.
  for (const file of ['src/components/designStudio/unified/WalkthroughPanel.tsx', 'src/services/designStudio/walkthrough.ts']) {
    for (const banned of [/startFactory/, /factoryStatus/, /runDesignBuild/, /compileSceneSpec/, /runpod/i, /setTimeout\(\s*\(\)\s*=>\s*start/]) assert.doesNotMatch(code(file), banned, `${file}: ${banned}`);
  }
  assert.match(code('src/services/designStudio/walkthrough.ts'), /design-studio-reconstruct\/\$\{route\}/);
});

test('a floor plan sent through Photos continues as a floor plan, and a technical failure never blames the picture', () => {
  const route = code('supabase/functions/design-studio-reconstruct/photos.ts');
  assert.match(route, /u\.unusable === 'FLOOR_PLAN'\) \{ await fail\('IS_FLOOR_PLAN'/, 'a plan is handed on, not refused');
  const flow = code('src/components/designStudio/unified/PhotoFlow.tsx');
  assert.match(flow, /e\.code === 'DS_IS_FLOOR_PLAN'\) \{ void toPlan\(\)/);
  assert.match(flow, /onFloorPlan\(await planFromPhotos\(recon\)\)/, 'the same uploaded file; nothing uploaded again');
  assert.match(code('src/pages/designStudio/DesignStudioWorkspacePage.tsx'), /onFloorPlan=\{\(plan\) => \{[^}]*setFlow\(\{ recalibrate: null, from: null \}\)/);
  // A failed design is technical (its source was already accepted): always the retry screen, never "a clearer photo or plan".
  for (const rel of ['src/components/designStudio/unified/PhotoFlow.tsx', 'src/components/designStudio/FloorPlanFlow.tsx']) {
    assert.match(code(rel), /setGenFailure\(\{ retryable: true,/, rel);
  }
  assert.match(code('supabase/functions/design-studio-reconstruct/generate.ts'), /const SPEC_TERMINAL = new Set\(\['ROOM_UNKNOWN'\]\);/);
});

test('the edit map fits an edge invocation: refinement runs in a window, and a dying map step is not retried forever', () => {
  const map = code('supabase/functions/_shared/designStudio/sceneMap.ts');
  assert.match(map, /export const MAP_MAX_SIDE = 768;/, 'precision is not traded away');
  assert.match(map, /return refineIn\(\{ w: cw, h: ch, rgb, grad \}, local, \{ w: W, h: H, x0: cx0, y0: cy0 \}\)|const r = refineIn\(\{ w: cw, h: ch, rgb, grad \}, local/);
  const flow = code('supabase/functions/_shared/designStudio/generationFlow.ts');
  assert.match(flow, /if \(tries > MAX_MAP_ATTEMPTS\) editMap = \{ state: 'UNAVAILABLE', reason: 'MAP_BUDGET' \};/);
});

test('a walkthrough on corrected geometry: the same drawing, the checking RPC, the design carried, the plan reused at no model cost', () => {
  const w = code('supabase/functions/design-studio-reconstruct/walkthrough.ts');
  assert.match(w, /caller\.rpc\('ds_create_floorplan_source'/, 'geometry only through the checking RPC, as the customer');
  assert.match(w, /before\.sha256 !== again\.sha256\) return json\(\{ error: 'NOT_THE_SAME_DRAWING' \}/, 'only the same drawing read again');
  assert.match(w, /parent_id: version\.id,[\s\S]{0,200}origin: 'AI', job_id: version\.job_id/, 'the design is carried as a child, with its own Design Specification job');
  assert.match(w, /design_dna: version\.design_dna \?\? null/);
  assert.match(w, /!lineage\.includes\(w\.design_version_id\)\) return json\(\{ error: 'PLAN_NOT_REUSABLE' \}/, 'a plan is reused only within the same design');
  assert.match(w, /basis: 'REUSED'/, 'a reused plan is recorded as no model cost');
  assert.doesNotMatch(w, /setActiveSource|active_source_id/, 'the project keeps its geometry; nothing earlier is changed');
  // An opened version stands on the geometry it was made on.
  assert.match(code('src/pages/designStudio/DesignStudioWorkspacePage.tsx'), /preferredSourceId: \(versionId && bundle\.versions\.find\(\(v\) => v\.id === versionId\)\?\.source_id\) \|\| bundle\.project\.active_source_id/);
});
