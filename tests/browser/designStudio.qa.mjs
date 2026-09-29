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

    check('no page errors', errors.length === 0, errors.join('\n        '));
  } finally {
    await browser.close().catch(() => {});
    server.kill();
  }
  console.log(`\nscreenshots: ${OUT}`);
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  await main();
}
