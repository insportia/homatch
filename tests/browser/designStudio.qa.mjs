// HOMATCH DESIGN STUDIO — BROWSER QA, DRIVEN IN REAL CHROME.
//
// Serves the HARNESS build (dist/ from `npm run build:harness`, built with
// VITE_FEATURE_DESIGN_STUDIO=on so a non-admin customer sees the product) and
// answers every Supabase request from an in-memory fake that behaves like the
// ds_* tables for ONE signed-in customer. It proves the screens are wired to
// the data layer and lays out at the widths and languages that matter; it
// proves nothing about RLS (scripts/design-studio/rls-check.mjs does that
// against a real Postgres).
//
//   VITE_FEATURE_DESIGN_STUDIO=on npm run build:harness
//   QA_OUT=<dir for screenshots> node tests/browser/designStudio.qa.mjs
//
// Exit code 1 on any failed check. Screenshots are written to QA_OUT (a temp
// directory by default), never into the repository.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PORT = 4193;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.QA_OUT || path.join(os.tmpdir(), 'homatch-design-studio-qa');
mkdirSync(OUT, { recursive: true });

const findChrome = () => [
  process.env.PLAYWRIGHT_CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium-browser',
].filter(Boolean).find((p) => existsSync(p));

const { chromium } = createRequire(import.meta.url)('playwright-core');

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok || !detail ? '' : `\n        ${detail}`}`);
  if (!ok) failures += 1;
};

function fakeSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', role: 'authenticated', exp, aud: 'authenticated' })}.stub`;
  return {
    access_token: jwt, refresh_token: 'stub', token_type: 'bearer', expires_in: 3600, expires_at: exp,
    user: { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'owner@example.test',
      app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  };
}

/* ── The fake data layer ───────────────────────────────────────────── */

export function createStore(seed = {}) {
  const now = () => new Date().toISOString();
  const db = {
    users: [{ id: 'hm1', auth_id: 'u1', email: 'owner@example.test', full_name: 'Nino Owner', is_admin: false,
      preferred_language: null, created_at: now(), updated_at: now() }],
    properties: [
      { id: 'prop-1', user_id: 'hm1', title: 'Two-bedroom apartment, Vake', homatch_id: 482193, cover_photo_url: null,
        is_deleted: false, archived_at: null, facts: [{ city: 'Tbilisi', district: 'Vake', area: 82, rooms: 3 }] },
      { id: 'prop-2', user_id: 'hm1', title: 'Studio near Rustaveli', homatch_id: 519004, cover_photo_url: null,
        is_deleted: false, archived_at: null, facts: [{ city: 'Tbilisi', district: 'Mtatsminda', area: 41, rooms: 1 }] },
    ],
    ds_projects: [],
    ds_spatial_sources: [],
    ds_versions: [],
    ds_version_events: [],
    ds_saved_views: [],
    ds_catalog_assets: [],
    ds_catalog_materials: [],
    ds_styles: [],
    ds_palettes: [],
    ds_floorplans: [],
    ...seed,
  };

  const filters = (url) => {
    const out = [];
    for (const [k, v] of url.searchParams) {
      if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
      const m = v.match(/^(eq|is|neq|lt|gt|in)\.(.*)$/);
      if (m) out.push([k, m[1], m[2]]);
    }
    return out;
  };
  const matches = (row, fs) => fs.every(([k, op, v]) => {
    const cell = row[k];
    if (op === 'eq') return String(cell) === v;
    if (op === 'neq') return String(cell) !== v;
    if (op === 'is') return v === 'null' ? cell == null : String(cell) === v;
    if (op === 'in') return v.replace(/[()]/g, '').split(',').includes(String(cell));
    return true;
  });

  const withProjectEmbeds = (p) => ({
    ...p,
    sources: db.ds_spatial_sources.filter((s) => s.project_id === p.id).map(({ canonical, ...s }) => s),
    head: db.ds_versions.find((v) => v.id === p.head_version_id)
      ? (({ id, name, updated_at }) => ({ id, name, updated_at }))(db.ds_versions.find((v) => v.id === p.head_version_id))
      : null,
    property: db.properties.find((x) => x.id === p.property_id)
      ? (({ id, title, homatch_id, cover_photo_url }) => ({ id, title, homatch_id, cover_photo_url }))(db.properties.find((x) => x.id === p.property_id))
      : null,
  });

  const insertDefaults = {
    ds_projects: (r) => ({ id: randomUUID(), status: 'ACTIVE', active_source_id: null, head_version_id: null,
      thumbnail_key: null, archived_at: null, dev_unit_id: null, property_id: null, created_at: now(), updated_at: now(), ...r }),
    ds_versions: (r) => ({ id: randomUUID(), parent_id: null, origin: 'USER', state_schema: 1, revision: 0, style_tags: [],
      change_summary: [], thumbnail_key: null, archived_at: null, created_at: now(), updated_at: now(), ...r }),
    ds_version_events: (r) => ({ id: randomUUID(), created_at: now(), ...r }),
    ds_saved_views: (r) => ({ id: randomUUID(), sort: 0, room_id: null, created_at: now(), updated_at: now(), ...r }),
  };

  function handle(table, method, url, body) {
    const fs = filters(url);
    const rows = db[table];
    if (!rows) return { status: 200, body: [] };
    if (method === 'GET') {
      let out = rows.filter((r) => matches(r, fs));
      if (table === 'ds_projects' && (url.searchParams.get('select') || '').includes('sources:')) out = out.map(withProjectEmbeds);
      return { status: 200, body: out };
    }
    if (method === 'POST') {
      const list = (Array.isArray(body) ? body : [body]).map((r) => (insertDefaults[table] ?? ((x) => ({ id: randomUUID(), ...x })))(r));
      rows.push(...list);
      return { status: 201, body: list };
    }
    if (method === 'PATCH') {
      const hit = rows.filter((r) => matches(r, fs));
      for (const r of hit) {
        if (table === 'ds_versions' && body.state && JSON.stringify(body.state) !== JSON.stringify(r.state)) r.revision += 1;
        Object.assign(r, { ...body, revision: table === 'ds_versions' ? r.revision : body.revision }, { updated_at: now() });
        if (table === 'ds_projects' && body.status === 'ARCHIVED') r.archived_at = now();
      }
      return { status: 200, body: hit };
    }
    if (method === 'DELETE') {
      const keep = rows.filter((r) => !matches(r, fs));
      const gone = rows.length - keep.length;
      db[table] = keep;
      return { status: 200, body: new Array(gone).fill({}) };
    }
    return { status: 405, body: {} };
  }

  function rpc(name, args) {
    if (name === 'ds_attach_developer_unit') {
      const source = {
        id: randomUUID(), project_id: args.p_project_id, user_id: 'hm1', kind: 'DEVELOPER_UNIT', status: 'READY',
        geometry_state: 'VERIFIED', editability: 'UNCLASSIFIED', dev_unit_id: args.p_unit_id,
        upstream: { scene_id: 'scene-1', version: '3' }, floorplan_id: null, model_object_key: null, model_sha256: null,
        model_bytes: null, model_mime: null, canonical: null, calibration: null, generator_version: null,
        provenance: { origin: 'DEVELOPER_PUBLISHED', unit_number: '704', building_name: 'Building A', floor_level: 7 },
        failure: null, supersedes_id: null, created_at: now(),
      };
      db.ds_spatial_sources.push(source);
      return source.id;
    }
    if (name === 'ds_create_floorplan_source') {
      const source = {
        id: randomUUID(), project_id: db.ds_floorplans.find((f) => f.id === args.p_floorplan_id)?.project_id, user_id: 'hm1',
        kind: 'FLOORPLAN_SCENE', status: 'READY', geometry_state: args.p_geometry_state, editability: 'GENERATED',
        dev_unit_id: null, upstream: null, floorplan_id: args.p_floorplan_id, model_object_key: null, model_sha256: null,
        model_bytes: null, model_mime: null, canonical: args.p_canonical, calibration: args.p_calibration,
        generator_version: args.p_generator_version, provenance: { origin: 'CUSTOMER_FLOORPLAN' }, failure: null,
        supersedes_id: null, created_at: now(),
      };
      for (const s of db.ds_spatial_sources) if (s.floorplan_id === args.p_floorplan_id && s.status === 'READY') s.status = 'SUPERSEDED';
      db.ds_spatial_sources.push(source);
      return source.id;
    }
    return null;
  }

  return { db, handle, rpc };
}

export async function wire(page, store, errors) {
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  page.on('console', (m) => {
    const txt = m.text();
    if (m.type() === 'error' && !/favicon|Failed to load resource|websocket|ERR_NAME_NOT_RESOLVED|WebSocket|realtime/i.test(txt)) {
      errors.push(`console: ${txt.slice(0, 200)}`);
    }
  });
  const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' };
  await page.route('**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.url().startsWith(BASE)) return route.continue();
    if (req.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    }
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
    if (url.pathname.includes('/auth/v1/user')) return json(fakeSession().user);
    if (url.pathname.includes('/auth/v1/token')) return json(fakeSession());
    const rpc = url.pathname.match(/\/rest\/v1\/rpc\/([a-z0-9_]+)/i);
    if (rpc) return json(store.rpc(rpc[1], JSON.parse(req.postData() || '{}')));
    const rest = url.pathname.match(/\/rest\/v1\/([a-z0-9_]+)/i);
    if (!rest) return json({});
    const wantsOne = (req.headers().accept || '').includes('vnd.pgrst.object');
    const result = store.handle(rest[1], req.method(), url, JSON.parse(req.postData() || 'null') ?? {});
    const body = wantsOne ? (Array.isArray(result.body) ? result.body[0] ?? null : result.body) : result.body;
    if (wantsOne && body == null) return json({ code: 'PGRST116', message: 'no rows' }, 406);
    return json(body, result.status);
  });
}

export async function startServer() {
  if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) throw new Error('dist/ is missing — run the harness build first');
  const server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' });
  for (let i = 0; i < 120; i += 1) {
    try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  return server;
}

export async function openContext(browser, { width, height, lang }) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  await ctx.addInitScript(([k, s, l]) => {
    window.localStorage.setItem(k, JSON.stringify(s));
    window.localStorage.setItem('homatch_lang', l);
  }, ['sb-stubproj-auth-token', fakeSession(), lang]);
  return ctx;
}

export const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
export { BASE, OUT, check, findChrome, chromium };

/* ── Checkpoint 1: navigation, launcher, picker, project creation ─── */

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  try {
    const store = createStore();
    const errors = [];

    // Desktop, English
    let ctx = await openContext(browser, { width: 1440, height: 900, lang: 'en' });
    let page = await ctx.newPage();
    await wire(page, store, errors);
    await page.goto(`${BASE}/design-studio`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { level: 1 }).waitFor({ timeout: 20000 });

    const railOrder = await page.evaluate(() => [...document.querySelectorAll('nav a')].map((a) => a.getAttribute('href')));
    const iExp = railOrder.indexOf('/for-expats/georgia');
    const iDs = railOrder.indexOf('/design-studio');
    const iVerify = railOrder.indexOf('/verify');
    check('rail: Design Studio directly after For Expats, before Verify', iExp > -1 && iDs === iExp + 1 && iVerify === iDs + 1,
      JSON.stringify(railOrder));
    check('rail: Design Studio is the active item', await page.locator('nav a[href="/design-studio"][aria-current="page"]').count() === 1);
    check('launcher: three ways in are shown', (await page.getByRole('button', { name: /Choose my property|Upload 3D model|Use floor plan/ }).count()) === 3);
    check('launcher: import buttons are honestly disabled', await page.getByRole('button', { name: 'Upload 3D model' }).isDisabled());
    check('launcher: empty projects state', await page.getByText('No design projects yet').isVisible());
    check('desktop: no horizontal overflow', (await overflowX(page)) <= 0);
    await page.screenshot({ path: path.join(OUT, 'cp1-launcher-1440-en.png') });

    await page.getByRole('button', { name: 'Choose my property' }).click();
    await page.getByRole('dialog').waitFor();
    check('picker: lists the customer\'s properties', await page.getByText('Two-bedroom apartment, Vake').isVisible());
    await page.screenshot({ path: path.join(OUT, 'cp1-picker-1440-en.png') });
    await page.getByRole('dialog').getByRole('button', { name: 'Start designing' }).first().click();
    await page.waitForURL(/\/design-studio\/[0-9a-f-]{36}$/);
    await page.getByText('This project has no 3D space yet').waitFor({ timeout: 15000 });
    check('create: a project is persisted with the property', store.db.ds_projects.length === 1 && store.db.ds_projects[0].property_id === 'prop-1');
    check('no-space: honest panel, no canvas', (await page.locator('canvas').count()) === 0);
    await page.screenshot({ path: path.join(OUT, 'cp1-nospace-1440-en.png') });

    await page.goto(`${BASE}/design-studio`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Two-bedroom apartment, Vake').first().waitFor();
    check('launcher: the new project is listed with its property reference', await page.getByText('Property #482193').first().isVisible());
    check('launcher: project row says no 3D space yet', await page.getByText('No 3D space yet').first().isVisible());
    await page.screenshot({ path: path.join(OUT, 'cp1-launcher-projects-1440-en.png') });

    // Property Details carries context
    await page.goto(`${BASE}/design-studio?property=prop-2`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('dialog').waitFor();
    const firstRow = await page.getByRole('dialog').locator('li').first().innerText();
    check('?property= opens the picker on that property', firstRow.includes('Studio near Rustaveli'), firstRow);
    await ctx.close();

    // Developer unit entry
    ctx = await openContext(browser, { width: 1440, height: 900, lang: 'en' });
    page = await ctx.newPage();
    await wire(page, store, errors);
    await page.goto(`${BASE}/design-studio?unit=00000000-0000-4000-8000-000000000704`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/design-studio\/[0-9a-f-]{36}$/, { timeout: 20000 });
    const devProject = store.db.ds_projects.find((p) => store.db.ds_spatial_sources.some((s) => s.project_id === p.id && s.kind === 'DEVELOPER_UNIT'));
    check('?unit= creates a project pinned to the developer unit', !!devProject && !!devProject.active_source_id);
    check('?unit= creates the Original version', store.db.ds_versions.some((v) => v.project_id === devProject?.id && v.origin === 'ORIGINAL'));
    await ctx.close();

    // Phone widths and languages, including RTL
    for (const [lang, width] of [['en', 390], ['ka', 390], ['ar', 390], ['he', 1440], ['ru', 1440], ['tr', 390]]) {
      ctx = await openContext(browser, { width, height: 844, lang });
      page = await ctx.newPage();
      await wire(page, store, errors);
      await page.goto(`${BASE}/design-studio`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { level: 1 }).waitFor({ timeout: 20000 });
      const dir = await page.evaluate(() => document.documentElement.dir);
      check(`${lang} ${width}: direction`, dir === (['ar', 'he'].includes(lang) ? 'rtl' : 'ltr'), dir);
      check(`${lang} ${width}: no horizontal overflow`, (await overflowX(page)) <= 0, String(await overflowX(page)));
      const clipped = await page.evaluate(() => [...document.querySelectorAll('button, a')]
        .filter((el) => el.offsetParent && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible')
        .map((el) => el.textContent.trim().slice(0, 40)));
      check(`${lang} ${width}: no clipped controls`, clipped.length === 0, JSON.stringify(clipped));
      await page.screenshot({ path: path.join(OUT, `cp1-launcher-${width}-${lang}.png`), fullPage: true });
      await ctx.close();
    }

    check('no page errors (checkpoint 1)', errors.length === 0, errors.join('\n        '));
    await checkpoint2(browser);
    await checkpoint3(browser);
  } finally {
    await browser.close().catch(() => {});
    server.kill();
  }
  console.log(`\nscreenshots: ${OUT}`);
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
}

/* ── Checkpoint 2: the workspace on a floor-plan space ───────────── */

export async function seededStore() {
  const { oneBedroomScene } = await import('../../src/lib/designStudio/__tests__/fixtures.mjs');
  const { DS_GENERATOR_VERSION } = await import('../../src/lib/designStudio/engine.ts');
  const store = createStore();
  const now = new Date().toISOString();
  const project = {
    id: '11111111-1111-4111-8111-111111111111', user_id: 'hm1', name: 'Two-bedroom apartment, Vake',
    property_id: 'prop-1', dev_unit_id: null, active_source_id: '22222222-2222-4222-8222-222222222222',
    head_version_id: '33333333-3333-4333-8333-333333333333', status: 'ACTIVE', thumbnail_key: null,
    created_at: now, updated_at: now, archived_at: null,
  };
  const source = {
    id: project.active_source_id, project_id: project.id, user_id: 'hm1', kind: 'FLOORPLAN_SCENE',
    status: 'READY', geometry_state: 'ESTIMATED', editability: 'GENERATED', dev_unit_id: null, upstream: null,
    floorplan_id: 'fp-1', model_object_key: null, model_sha256: null, model_bytes: null, model_mime: null,
    canonical: {
      schema: 1, units: 'm', generatorVersion: DS_GENERATOR_VERSION, geometryState: 'ESTIMATED',
      metresPerPx: 0.01, scaleUncertainty: 0.12, scene: oneBedroomScene(),
    },
    calibration: null, generator_version: DS_GENERATOR_VERSION, provenance: { origin: 'CUSTOMER_FLOORPLAN' },
    failure: null, supersedes_id: null, created_at: now,
  };
  const version = {
    id: project.head_version_id, project_id: project.id, user_id: 'hm1', source_id: source.id,
    parent_id: null, name: 'Original', origin: 'ORIGINAL',
    state: {
      schema: 1, objects: [], surfaces: {}, palette: [], styleCode: null, locks: {},
      lighting: { timeOfDay: 'DAY', temperature: 'NEUTRAL', interiorIntensity: 0.6, locked: false },
    },
    state_schema: 1, revision: 0, style_tags: [], change_summary: [],
    thumbnail_key: null, archived_at: null, created_at: now, updated_at: now,
  };
  store.db.ds_projects.push(project);
  store.db.ds_spatial_sources.push(source);
  store.db.ds_versions.push(version);
  store.db.ds_catalog_assets.push(...qaCatalogAssets());
  store.db.ds_catalog_materials.push(...qaCatalogMaterials());
  store.db.ds_palettes.push(
    { id: 'pal-1', code: 'warm-neutral', name: 'Warm neutral', colors: ['#f2eee6', '#e2d3b9', '#cdb28b', '#9c7a55', '#4a3f36'], tags: [], sort: 10, active: true },
    { id: 'pal-2', code: 'scandinavian', name: 'Scandinavian', colors: ['#f8f8f6', '#e6e2dc', '#cdb28b', '#8c8f95', '#2e3a52'], tags: [], sort: 20, active: true },
  );
  return { store, project, source, version };
}

/* A few rows shaped exactly like the development seed (20260930091000). */
function qaCatalogAssets() {
  const row = (code, name, category, w, d, h, kind, over = {}) => ({
    id: `asset-${code}`, code, name, category, subcategory: null, room_kinds: ['LIVING'], style_tags: ['contemporary'],
    color_tags: ['neutral'], material_tags: ['fabric'], width_m: w, depth_m: d, height_m: h, placement: 'FLOOR',
    anchor: 'WALL', clearance_m: 0, procedural: { kind }, model_key: null, lods: [], triangles: null, texture_bytes: null,
    thumbnail_key: null, material_slots: [{ id: 'body', defaultColor: '#cfc6b8' }, { id: 'legs', defaultColor: '#3b3128' }],
    variants: [], dominant_colors: [], provenance: 'HOMATCH_DEV_PLACEHOLDER', is_placeholder: true, active: true, ...over,
  });
  return [
    row('dev/sofa-3', 'Three-seat sofa', 'SOFA', 2.2, 0.95, 0.82, 'SOFA', { clearance_m: 0.9,
      variants: [{ id: 'sand', name: 'Sand', colors: { body: '#d8c8b0' } }, { id: 'charcoal', name: 'Charcoal', colors: { body: '#4a4d52' } }] }),
    row('dev/sofa-2', 'Two-seat sofa', 'SOFA', 1.7, 0.9, 0.82, 'SOFA', { clearance_m: 0.8 }),
    row('dev/coffee-table', 'Coffee table', 'TABLE', 1.1, 0.6, 0.42, 'TABLE', { anchor: 'CENTRE',
      material_slots: [{ id: 'top', defaultColor: '#9c7a55' }, { id: 'legs', defaultColor: '#6d5238' }] }),
    row('dev/rug-large', 'Large rug', 'RUG', 2.4, 1.7, 0.01, 'RUG', { anchor: 'CENTRE' }),
    row('dev/bed-double', 'Double bed', 'BED', 1.6, 2.05, 0.95, 'BED', { room_kinds: ['BEDROOM'],
      material_slots: [{ id: 'body', defaultColor: '#a88b6c' }, { id: 'linen', defaultColor: '#efeae2' }] }),
    row('dev/floor-lamp', 'Floor lamp', 'LIGHTING', 0.4, 0.4, 1.6, 'LAMP', { anchor: 'FREE',
      material_slots: [{ id: 'body', defaultColor: '#2b2d31' }, { id: 'shade', defaultColor: '#f1ebe0' }] }),
  ];
}

function qaCatalogMaterials() {
  const m = (code, name, category, appliesTo, baseColor, roughness = 0.9) => ({
    id: `mat-${code}`, code, name, category, applies_to: appliesTo, style_tags: [], color_family: null,
    pbr: { baseColor, roughness, metalness: 0 }, thumbnail_key: null, provenance: 'HOMATCH_DEV_PLACEHOLDER',
    is_placeholder: true, active: true,
  });
  return [
    m('dev/paint-warm-white', 'Warm white paint', 'WALL', ['WALL', 'CEILING'], '#f2eee6'),
    m('dev/paint-sage', 'Sage paint', 'WALL', ['WALL'], '#b6bfa7'),
    m('dev/floor-natural-oak', 'Natural oak (concept)', 'FLOOR', ['FLOOR'], '#b48b5e', 0.7),
    m('dev/floor-walnut', 'Walnut (concept)', 'FLOOR', ['FLOOR'], '#6d4b36', 0.65),
  ];
}

/* ── Checkpoint 3: editing, undo/redo, autosave ─────────────────────── */

async function checkpoint3(browser) {
  const { store, project, version } = await seededStore();
  const v = () => store.db.ds_versions.find((x) => x.id === version.id);
  const errors = [];
  const ctx = await openContext(browser, { width: 1440, height: 900, lang: 'en' });
  const page = await ctx.newPage();
  await wire(page, store, errors);
  await page.goto(`${BASE}/design-studio/${project.id}`, { waitUntil: 'domcontentloaded' });
  await page.locator('main canvas').waitFor({ timeout: 25000 });
  await page.waitForTimeout(800);
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  const modes = page.getByRole('navigation', { name: 'Design tools' }).first();

  // Add a sofa to the living room from the library.
  await page.getByRole('list', { name: 'Rooms' }).getByRole('button', { name: /Living room/ }).click();
  await modes.getByRole('button', { name: 'Furniture' }).click();
  await page.getByRole('searchbox', { name: /Search: warm beige sofa/ }).fill('sofa');
  check('library: natural search finds sofas only', (await page.getByRole('list', { name: 'Furniture' }).getByRole('listitem').count()) === 2);
  check('library: concept blocks are labelled as such', await page.getByText(/HOMATCH concept blocks/).isVisible());
  await page.getByRole('button', { name: 'Add Three-seat sofa' }).click();
  await page.waitForTimeout(400);
  check('add: inspector switches to the new piece', await inspector.getByRole('heading', { name: 'Three-seat sofa' }).isVisible());
  check('add: auto-placement found a clean spot', await inspector.getByText('Fits here').isVisible());
  await page.waitForTimeout(1800);
  check('autosave: the piece is persisted in the version state', v().state.objects?.length === 1 && v().state.objects[0].assetId === 'dev/sofa-3');
  check('autosave: the database revision advanced', v().revision >= 1);
  check('autosave: the operation was appended to history', store.db.ds_version_events.length >= 1);
  check('save status says Saved', await page.getByRole('status').filter({ hasText: 'Saved' }).isVisible());
  await page.screenshot({ path: path.join(OUT, 'cp3-added-sofa-1440-en.png') });

  // Replace with a two-seat sofa, rotate, then undo both.
  await inspector.getByRole('button', { name: 'Replace' }).click();
  check('replace: library narrows to the same category with fit checks', await page.getByText('Replacing: Three-seat sofa').isVisible());
  await page.getByRole('list', { name: 'Furniture' }).getByRole('listitem').filter({ hasText: 'Two-seat sofa' }).getByRole('button', { name: 'Use' }).click();
  await page.waitForTimeout(300);
  check('replace: the same instance now shows the new piece', await inspector.getByRole('heading', { name: 'Two-seat sofa' }).isVisible());
  // Turning a wall-backed sofa 90° would push it into the wall: refused, and nothing enters history.
  const objectsBefore = JSON.stringify(v().state.objects);
  await inspector.getByRole('button', { name: 'Rotate 90° clockwise' }).click();
  await page.waitForTimeout(300);
  check('rotate into a wall is refused with a reason', await page.getByText('That would go through a wall.').first().isVisible());
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  check('undo: one step back restores the original sofa', await inspector.getByRole('heading', { name: 'Three-seat sofa' }).isVisible());
  void objectsBefore;
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(300);
  check('redo: forward again replaces it', await inspector.getByRole('heading', { name: 'Two-seat sofa' }).isVisible());

  // Variant and colour on the object.
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  check('undo again: back to the three-seat sofa', await inspector.getByRole('heading', { name: 'Three-seat sofa' }).isVisible());
  await inspector.getByRole('button', { name: 'Sand' }).click();
  await page.waitForTimeout(1700);
  check('finish: variant stored on the instance', v().state.objects[0].materialVariant === 'sand');

  // Keep the sofa: it refuses to be removed.
  await inspector.getByRole('button', { name: 'Keep as is' }).click();
  check('keep: remove is disabled for a kept piece', await inspector.getByRole('button', { name: 'Remove' }).isDisabled());
  await inspector.getByRole('button', { name: 'Allow changes' }).click();

  // Floor material for the living room.
  await modes.getByRole('button', { name: 'Materials' }).click();
  await page.getByRole('list', { name: 'Rooms' }).count();
  const aside = page.getByRole('complementary', { name: 'Materials' });
  if (await aside.getByText('Choose a room to dress').isVisible().catch(() => false)) await aside.getByRole('button', { name: 'Living room' }).click();
  await aside.getByRole('button', { name: 'Natural oak (concept)' }).click();
  await aside.getByRole('button', { name: 'Sage paint' }).click();
  await page.waitForTimeout(1700);
  const surfaces = v().state.surfaces ?? {};
  check('materials: living room floor is natural oak', surfaces['floor:r-living']?.materialId === 'mat-dev/floor-natural-oak');
  const livingWalls = Object.keys(surfaces).filter((k) => k.startsWith('wall:') && k.endsWith(':r-living'));
  check('materials: every living-room wall face got the paint, no other room', livingWalls.length === 4
    && Object.keys(surfaces).filter((k) => k.startsWith('wall:') && !k.endsWith(':r-living')).length === 0, JSON.stringify(Object.keys(surfaces)));
  await page.screenshot({ path: path.join(OUT, 'cp3-materials-1440-en.png') });

  // Colour scope on one wall: preview counts before applying to all walls.
  await modes.getByRole('button', { name: 'Rooms' }).click();
  await page.getByRole('list', { name: 'Rooms' }).getByRole('button', { name: /Bedroom/ }).click();
  await inspector.getByRole('button', { name: 'Wall 1' }).click();
  const allWalls = inspector.getByRole('radio', { name: /All walls \(\d+\)/ });
  check('scope: the count of an apartment-wide change is shown before it happens', await allWalls.isVisible());
  await inspector.getByRole('radio', { name: /All walls in Bedroom/ }).check();
  await inspector.getByRole('button', { name: /Warm neutral #e2d3b9/ }).click();
  await page.waitForTimeout(1700);
  const bedWalls = Object.entries(v().state.surfaces).filter(([k]) => k.endsWith(':r-bed'));
  check('scope: one action painted every bedroom wall face', bedWalls.length >= 4 && bedWalls.every(([, s]) => s.color === '#e2d3b9'));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(1700);
  check('scope: one undo restores every one of them', Object.entries(v().state.surfaces).filter(([k]) => k.endsWith(':r-bed')).every(([, s]) => !s.color));

  // Lighting.
  await modes.getByRole('button', { name: 'Lighting' }).click();
  await page.getByRole('radio', { name: 'Evening' }).click();
  await page.getByRole('radio', { name: 'Warm' }).click();
  await page.waitForTimeout(1700);
  check('lighting: time of day and colour persisted', v().state.lighting.timeOfDay === 'EVENING' && v().state.lighting.temperature === 'WARM');
  await page.screenshot({ path: path.join(OUT, 'cp3-evening-1440-en.png') });

  // Drag a piece from the library onto the canvas.
  await modes.getByRole('button', { name: 'Furniture' }).click();
  await page.getByRole('searchbox').fill('lamp');
  const before = v().state.objects.length;
  const canvasBox = await page.locator('main canvas').boundingBox();
  await page.getByRole('list', { name: 'Furniture' }).getByRole('listitem').first()
    .dragTo(page.locator('main canvas'), { targetPosition: { x: canvasBox.width * 0.45, y: canvasBox.height * 0.5 } });
  await page.waitForTimeout(1800);
  check('drag & drop: a library piece dropped on the floor is placed', v().state.objects.length === before + 1, `${before} -> ${v().state.objects.length}`);

  // A conflicting save from elsewhere is detected, not overwritten.
  v().revision += 5;
  await page.keyboard.press('Escape');
  await modes.getByRole('button', { name: 'Lighting' }).click();
  await page.getByRole('radio', { name: 'Night' }).click();
  await page.waitForTimeout(1800);
  check('conflict: a stale save is reported, not written', await page.getByRole('status').filter({ hasText: 'Changed in another window' }).isVisible()
    && v().state.lighting.timeOfDay !== 'NIGHT');
  await page.screenshot({ path: path.join(OUT, 'cp3-conflict-1440-en.png') });
  await ctx.close();

  // Phone: add from the furniture sheet.
  const phone = await openContext(browser, { width: 390, height: 844, lang: 'en' });
  const p2 = await phone.newPage();
  await wire(p2, store, errors);
  await p2.goto(`${BASE}/design-studio/${project.id}`, { waitUntil: 'domcontentloaded' });
  await p2.locator('main canvas').waitFor({ timeout: 25000 });
  await p2.waitForTimeout(600);
  await p2.getByRole('navigation', { name: 'Design tools' }).last().getByRole('button', { name: 'Furniture' }).click();
  await p2.waitForTimeout(500);
  await p2.screenshot({ path: path.join(OUT, 'cp3-furniture-sheet-390-en.png') });
  check('phone: furniture opens as a sheet with the library', await p2.getByRole('dialog').getByRole('searchbox').isVisible());
  check('phone: no overflow', (await overflowX(p2)) <= 0);
  await phone.close();
  check('no page errors (checkpoint 3)', errors.length === 0, errors.join('\n        '));
}

async function checkpoint2(browser) {
  const { store, project } = await seededStore();
  const errors = [];
  let ctx = await openContext(browser, { width: 1440, height: 900, lang: 'en' });
  let page = await ctx.newPage();
  await wire(page, store, errors);
  await page.goto(`${BASE}/design-studio/${project.id}`, { waitUntil: 'domcontentloaded' });
  await page.locator('canvas').first().waitFor({ timeout: 25000 });
  await page.waitForTimeout(1200);
  check('workspace: a WebGL canvas fills the centre', await page.evaluate(() => {
    const c = document.querySelector('main canvas');
    return !!c && c.clientWidth > 700 && c.clientHeight > 600;
  }));
  check('workspace: no global rail (full-viewport tool)', (await page.locator('nav a[href="/for-expats/georgia"]').count()) === 0);
  check('workspace: estimated dimensions are said out loud', await page.getByText('Estimated dimensions').first().isVisible());
  check('workspace: rooms listed in the reader language', await page.getByRole('button', { name: /Bedroom/ }).first().isVisible());
  check('workspace: estimated areas carry ≈', await page.getByText(/≈ 42 m²/).first().isVisible());
  check('workspace: plan navigator present', await page.getByRole('navigation', { name: 'Plan navigator' }).isVisible());
  const labels = await page.locator('.ds-room-label').allInnerTexts();
  check('workspace: room names drawn over the floor', labels.includes('Living room') && labels.includes('Bathroom'), JSON.stringify(labels));
  await page.screenshot({ path: path.join(OUT, 'cp2-workspace-1440-en.png') });

  await page.getByRole('list', { name: 'Rooms' }).getByRole('button', { name: /Living room/ }).click();
  await page.waitForTimeout(900);
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  check('select room: inspector names the room', await inspector.getByRole('heading', { name: 'Living room' }).isVisible());
  check('select room: inspector lists its surfaces', await inspector.getByRole('button', { name: 'Floor' }).isVisible());
  await page.screenshot({ path: path.join(OUT, 'cp2-room-1440-en.png') });
  await inspector.getByRole('button', { name: 'Floor' }).click();
  check('select surface: inspector says which surface, in which room', await inspector.getByText('Select Living room').isVisible());

  // Canvas picking: after focusing the living room, the middle of the screen is inside it.
  const box = await page.locator('main canvas').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  const heading = await inspector.getByRole('heading').first().innerText();
  check('canvas click selects something in the space', /Floor|Wall|Ceiling|Living room/.test(heading), heading);
  await page.keyboard.press('Escape');
  check('Escape clears the selection', await page.getByText('Select a room, a wall or the floor to design it.').isVisible());
  check('desktop workspace: no overflow', (await overflowX(page)) <= 0);
  await ctx.close();

  for (const [lang, width, height] of [['en', 390, 844], ['ar', 390, 844], ['ka', 1440, 900], ['he', 1280, 800]]) {
    ctx = await openContext(browser, { width, height, lang });
    page = await ctx.newPage();
    await wire(page, store, errors);
    await page.goto(`${BASE}/design-studio/${project.id}`, { waitUntil: 'domcontentloaded' });
    await page.locator('canvas').first().waitFor({ timeout: 25000 });
    await page.waitForTimeout(900);
    check(`${lang} ${width}: no overflow`, (await overflowX(page)) <= 0);
    const share = await page.evaluate(() => {
      const c = document.querySelector('main canvas');
      return c ? (c.clientWidth * c.clientHeight) / (window.innerWidth * window.innerHeight) : 0;
    });
    check(`${lang} ${width}: the canvas dominates (${Math.round(share * 100)}% of the screen)`, share > (width < 1024 ? 0.7 : 0.45));
    await page.screenshot({ path: path.join(OUT, `cp2-workspace-${width}-${lang}.png`) });
    if (width < 1024) {
      await page.locator('nav.lg\\:hidden button').first().click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(OUT, `cp2-rooms-sheet-${width}-${lang}.png`) });
      const sheetButtons = await page.getByRole('dialog').getByRole('button').count();
      check(`${lang} ${width}: rooms open as a sheet`, sheetButtons >= 4, String(sheetButtons));
    }
    await ctx.close();
  }
  check('no page errors (checkpoint 2)', errors.length === 0, errors.join('\n        '));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  await main();
}
