// THE 2D → 3D PIPELINE, DRIVEN LINK BY LINK IN A REAL BROWSER.
//
// WHAT THIS PROVES, AND — MORE IMPORTANTLY — WHAT IT DOES NOT
//
// The pure functions underneath this pipeline are already tested: the geometry
// generator thirteen ways, the opening arithmetic eight, the interior
// placement ten. None of that proves the CHAIN. A generator that works and a
// screen that never calls it are the same product from a customer's side, and
// this project has shipped that exact defect twice.
//
// So this drives the chain in Chrome:
//
//   the overlay draws what the reading found, on the drawing it came from
//   the gate REFUSES to generate while anything required is unverified
//   an operator accepts elements and types the two missing measurements
//   the gate opens
//   pressing Generate produces geometry
//   the Three.js shell renders it, with the counts it actually built
//
// IT PROVES NOTHING ABOUT EXTRACTION ACCURACY. The document below is a
// HARNESS FIXTURE — a rectangle a human typed, not a drawing a model read. No
// assertion here says the model is any good at reading plans, because nothing
// in this deployment has a real plan to read. That question is open and is
// reported as REAL_FLOOR_PLAN_REQUIRED_FOR_ACCEPTANCE.
//
// What it does prove is that the day a real drawing arrives, every link
// between the reading and the rendered apartment already works.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PORT = 4188;
const BASE = `http://127.0.0.1:${PORT}`;
const DESKTOP = { width: 1600, height: 1000 };
const PHONE = { width: 390, height: 844 };

function findChrome() {
  if (process.env.PLAYWRIGHT_CHROME && existsSync(process.env.PLAYWRIGHT_CHROME)) {
    return process.env.PLAYWRIGHT_CHROME;
  }
  return [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe` : null,
    '/usr/bin/google-chrome', '/usr/bin/chromium-browser',
  ].filter(Boolean).find((p) => existsSync(p)) ?? null;
}

function resolvePlaywright() {
  return createRequire(import.meta.url)('playwright-core');
}

function haveDeps() {
  try { resolvePlaywright(); } catch { return 'playwright-core is not installed'; }
  if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) return 'dist/ is missing';
  if (!findChrome()) return 'Google Chrome not found';
  return null;
}
const skipReason = haveDeps();

function fakeSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    sub: 'u1', role: 'authenticated', exp, email: 'studio@example.test', aud: 'authenticated',
  })}.stub`;
  return {
    access_token: jwt, refresh_token: 'stub', token_type: 'bearer',
    expires_in: 3600, expires_at: exp,
    user: {
      id: 'u1', aud: 'authenticated', role: 'authenticated',
      email: 'studio@example.test', app_metadata: {}, user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };
}

/**
 * A HARNESS FIXTURE, NOT A FLOOR PLAN.
 *
 * Two rooms in an 8x6 metre rectangle with a dividing wall, one door and one
 * window, at a scale a person typed. It stands in for what an extraction would
 * produce so the SCREENS can be driven; it says nothing about what a model
 * would actually return from a drawing, and no assertion below treats it as if
 * it did. Everything arrives UNVERIFIED, exactly as a real reading would.
 */
function fixtureDocument() {
  const wall = (id, x1, y1, x2, y2, kind = 'EXTERIOR', confidence = 0.95) => ({
    id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, kind,
    thicknessPx: kind === 'EXTERIOR' ? 30 : 10,
    confidence, evidence: 'hatched double line', state: 'UNVERIFIED',
  });
  return {
    sourceAssetId: 'asset-fixture',
    imageWidth: 800,
    imageHeight: 600,
    // The two facts a drawing most often omits arrive NULL, which is the
    // whole point: the gate must refuse until a person supplies them.
    detectedScale: null,
    scaleConfidence: 0,
    scaleEvidence: null,
    ceilingHeight: null,
    ceilingHeightSource: null,
    walls: [
      wall('w-n', 0, 0, 800, 0),
      wall('w-e', 800, 0, 800, 600),
      wall('w-s', 800, 600, 0, 600),
      wall('w-w', 0, 600, 0, 0),
      wall('w-mid', 400, 0, 400, 600, 'INTERIOR', 0.92),
    ],
    doors: [{
      id: 'd-1', wallId: 'w-mid', position: 0.5, widthPx: 90,
      sillHeightM: 0, heightM: 2.1, confidence: 0.78,
      evidence: 'quarter-circle swing', state: 'UNVERIFIED',
    }],
    windows: [{
      id: 'win-1', wallId: 'w-n', position: 0.25, widthPx: 120,
      sillHeightM: 0.9, heightM: 1.4, confidence: 0.71,
      evidence: 'three parallel lines', state: 'UNVERIFIED',
    }],
    rooms: [{
      id: 'r-1', kind: 'LIVING', label: 'Living',
      polygon: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 600 }, { x: 0, y: 600 }],
      statedAreaM2: 24, confidence: 0.97, evidence: 'label "Living 24.0"', state: 'UNVERIFIED',
    }, {
      id: 'r-2', kind: 'BEDROOM', label: 'Bedroom',
      polygon: [{ x: 400, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 600 }, { x: 400, y: 600 }],
      statedAreaM2: 24, confidence: 0.97, evidence: 'label "Bedroom 24.0"', state: 'UNVERIFIED',
    }],
    balconies: [],
    unknownElements: [{ id: 'u-1', note: 'A hatched rectangle by the entrance', confidence: 0.4 }],
    warnings: [{ code: 'NO_SCALE' }, { code: 'NO_CEILING_HEIGHT' }],
    extractionConfidence: 0,
  };
}

const verdicts = [];
const record = (name, ok, why) => {
  verdicts.push({ name, ok, why: why ?? null });
  return ok;
};

const opts = { timeout: 600000 };

test('a reading becomes a building only after a person says so', opts, async (t) => {
  if (skipReason) assert.fail(`floor-plan pipeline gate could not run: ${skipReason}`);

  const { chromium } = resolvePlaywright();
  const PLAN_ID = '00000000-0000-4000-8000-00000000fp01';

  /* The store this run writes into. dt_floorplans keeps three columns apart —
     the reading, the corrections, the verified document — and the handler
     below replays them exactly as the service does, so the screen is driven
     against the same shape production has. */
  const store = {
    id: PLAN_ID,
    workspace_id: '00000000-0000-4000-8000-000000000001',
    project_id: null,
    unit_type_id: null,
    asset_id: '00000000-0000-4000-8000-0000000000a1',
    status: 'NEEDS_REVIEW',
    extraction: fixtureDocument(),
    corrections: {},
    verified: null,
    extraction_confidence: 0,
    extraction_error: null,
    model: 'harness-fixture',
    created_by: 'u1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const server = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' },
  );
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); server.kill(); });

  for (let i = 0; i < 80; i += 1) {
    try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }

  const thrown = [];
  const json = (body, status = 200, extra = {}) => ({
    status,
    contentType: 'application/json',
    headers: {
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'content-range',
      ...extra,
    },
    body: JSON.stringify(body),
  });

  async function wire(page) {
    page.on('pageerror', (e) => thrown.push(String(e).slice(0, 300)));
    page.on('console', (m) => {
      const txt = m.text();
      const noise = /favicon|Failed to load resource|realtime\/v1\/websocket|ERR_NAME_NOT_RESOLVED|WebSocket/i.test(txt);
      if (m.type() === 'error' && !noise) thrown.push(`console: ${txt.slice(0, 200)}`);
    });

    await page.route('**', async (route) => {
      const req = route.request();
      const url = req.url();
      if (url.startsWith(BASE)) return route.continue();

      if (req.method() === 'OPTIONS') {
        return route.fulfill({
          status: 204,
          headers: {
            'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
            'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range',
          },
        });
      }

      // The drawing itself. An 8x6 off-white PNG: the overlay's job is to
      // draw ON an image, and its correctness does not depend on what the
      // image shows.
      if (url.includes('/storage/v1/object/public/')) {
        return route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAEUlEQVR4nGP48O4FVsQwkBIABL+FIRNEZwAAAAAASUVORK5CYII=',
            'base64',
          ),
        });
      }

      if (url.includes('/auth/v1/user')) return route.fulfill(json(fakeSession().user));
      if (url.includes('/auth/v1/token')) return route.fulfill(json(fakeSession()));

      const rpc = url.match(/\/rest\/v1\/rpc\/([a-z0-9_]+)/i);
      if (rpc) {
        // The one grant this screen needs. Everything else refuses, which is
        // also what production does for a developer who is not on the team.
        if (rpc[1] === 'dev_is_studio') return route.fulfill(json(true));
        return route.fulfill(json(null));
      }

      const rest = url.match(/\/rest\/v1\/([a-z0-9_]+)/i);
      /* FP_TRACE=1 prints what the page actually asked for. A request that
         silently falls through to an empty answer is how a broken fixture
         hides as a broken product. */
      if (process.env.FP_TRACE && rest) console.log('REST', rest[1], req.method());
      if (!rest) return route.fulfill(json({}));
      const table = rest[1];
      const wantsOne = (req.headers().accept || '').includes('vnd.pgrst.object');

      if (table === 'dt_floorplans') {
        if (req.method() === 'PATCH') {
          Object.assign(store, JSON.parse(req.postData() || '{}'));
          store.updated_at = new Date().toISOString();
          return route.fulfill(wantsOne ? json(store) : json([store]));
        }
        return route.fulfill(wantsOne ? json(store) : json([store]));
      }
      if (table === 'dt_assets') {
        const asset = {
          id: store.asset_id, storage_provider: 'SUPABASE',
          storage_key: 'fixture/plan.png', version: 1, content_hash: null,
        };
        return route.fulfill(wantsOne ? json(asset) : json([asset]));
      }
      if (table === 'users') {
        const user = { id: 'u1', auth_id: 'u1', email: 'studio@example.test', is_admin: false };
        return route.fulfill(wantsOne ? json(user) : json([user]));
      }
      return route.fulfill(wantsOne ? json({}, 406) : json([]));
    });
  }

  const ctx = await browser.newContext({ viewport: DESKTOP });
  await ctx.addInitScript(([k, s]) => {
    window.localStorage.setItem(k, JSON.stringify(s));
    window.localStorage.setItem('homatch_lang', 'en');
  }, ['sb-stubproj-auth-token', fakeSession()]);
  const page = await ctx.newPage();
  await wire(page);

  const text = () => page.evaluate(() => document.body.innerText);

  // ── 1. THE OVERLAY ───────────────────────────────────────────────────────
  await page.goto(`${BASE}/studio/plan/${PLAN_ID}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  const drawn = await page.evaluate(() => {
    const svg = document.querySelector('main svg[role="img"]');
    if (!svg) return null;
    return {
      lines: svg.querySelectorAll('line').length,
      polygons: svg.querySelectorAll('polygon').length,
      labels: [...svg.querySelectorAll('text')].map((n) => n.textContent.trim()),
      hasImage: Boolean(document.querySelector('main img')),
      imgSrc: document.querySelector('main img')?.getAttribute('src') ?? null,
      fallback: document.body.innerText.includes('could not be loaded'),
    };
  });
  record('OVERLAY_DRAWS_ON_THE_DRAWING',
    Boolean(drawn) && drawn.hasImage && drawn.lines >= 7 && drawn.polygons === 2,
    drawn
      ? `${drawn.lines} lines, ${drawn.polygons} polygons, img=${drawn.hasImage} fallback=${drawn.fallback} src=${String(drawn.imgSrc).slice(0, 70)}`
      : 'no overlay was rendered');
  record('OVERLAY_LABELS_ROOMS',
    Boolean(drawn) && drawn.labels.includes('Living') && drawn.labels.includes('Bedroom'),
    drawn ? `labels: ${drawn.labels.join(', ')}` : 'none');

  // Categories can be turned off, which is how an operator isolates one layer.
  const beforeToggle = drawn?.lines ?? 0;
  await page.locator('button', { hasText: /^Walls$/ }).first().click();
  await page.waitForTimeout(600);
  const afterToggle = await page.evaluate(
    () => document.querySelectorAll('main svg[role="img"] line').length);
  record('OVERLAY_CATEGORIES_TOGGLE', afterToggle < beforeToggle,
    `walls off: ${beforeToggle} lines -> ${afterToggle}`);
  await page.locator('button', { hasText: /^Walls$/ }).first().click();
  await page.waitForTimeout(400);

  // ── 2. THE GATE REFUSES ──────────────────────────────────────────────────
  const blockedText = await text();
  record('GATE_BLOCKS_UNVERIFIED', /Review required/i.test(blockedText),
    'the gate refuses while required categories are unverified');
  record('GATE_NAMES_WHAT_BLOCKS',
    /Scale/i.test(blockedText) && /Ceiling height/i.test(blockedText),
    'and names the categories that are blocking it');

  const generateVisible = await page.locator('button', { hasText: /Generate the shell/i }).count();
  record('GATE_HIDES_GENERATE', generateVisible === 0,
    generateVisible === 0
      ? 'there is no way to generate while the gate is shut'
      : 'the generate control was reachable before verification');

  // ── 3. A PERSON VERIFIES ─────────────────────────────────────────────────
  // The two measurements the drawing did not print, typed by an operator.
  await page.fill('#fp-scale', '0.01');
  await page.locator('#fp-scale').press('Tab');
  await page.locator('button', { hasText: /^Confirm$/ }).first().click();
  await page.waitForTimeout(1200);
  await page.fill('#fp-ceiling', '2.7');
  await page.locator('button', { hasText: /^Confirm$/ }).nth(1).click();
  await page.waitForTimeout(1200);

  record('OPERATOR_SUPPLIES_MEASUREMENTS',
    store.verified?.detectedScale === 0.01 && store.verified?.ceilingHeight === 2.7,
    `scale ${store.verified?.detectedScale}, ceiling ${store.verified?.ceilingHeight}`);
  record('MEASUREMENT_SOURCE_RECORDED',
    store.verified?.ceilingHeightSource === 'OPERATOR',
    'a typed height is recorded as the operator\u2019s, never as the drawing\u2019s');

  // Then every wall and room, accepted one at a time from the drawing.
  const accept = async (kind, id) => {
    await page.evaluate(([k, elementId]) => {
      const svg = document.querySelector('main svg[role="img"]');
      if (!svg) return;
      const nodes = k === 'room' ? svg.querySelectorAll('polygon') : svg.querySelectorAll('line');
      // The overlay renders in document order, so the nth element of a kind is
      // found by walking the same list the component built.
      const index = Number(elementId);
      const node = nodes[index];
      if (node) node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, [kind, id]);
    await page.waitForTimeout(500);
    const button = page.locator('button', { hasText: /^Confirm$/ }).last();
    if (await button.count()) { await button.click(); await page.waitForTimeout(900); }
  };

  // Five walls are the first five lines; two rooms are the two polygons.
  for (let i = 0; i < 5; i += 1) await accept('wall', i);
  for (let i = 0; i < 2; i += 1) await accept('room', i);

  const verifiedWalls = (store.verified?.walls ?? []).filter(
    (w) => w.state === 'VERIFIED' || w.state === 'CORRECTED').length;
  const verifiedRooms = (store.verified?.rooms ?? []).filter(
    (r) => r.state === 'VERIFIED' || r.state === 'CORRECTED').length;
  record('OPERATOR_VERIFIES_ELEMENTS', verifiedWalls === 5 && verifiedRooms === 2,
    `${verifiedWalls}/5 walls and ${verifiedRooms}/2 rooms confirmed from the drawing`);

  record('CORRECTIONS_KEPT_APART',
    Array.isArray(store.corrections?.history)
    && store.corrections.history.length >= 7
    && store.extraction.walls[0].state === 'UNVERIFIED',
    `${store.corrections?.history?.length ?? 0} corrections recorded, and the original reading `
    + 'is untouched — so what the model said and what we changed stay answerable');

  // ── 4. THE GATE OPENS ────────────────────────────────────────────────────
  await page.waitForTimeout(800);
  const openText = await text();
  record('GATE_OPENS_WHEN_VERIFIED', /Ready to generate/i.test(openText),
    'every required category confirmed');

  // ── 5. GEOMETRY, AND THE SHELL THAT RENDERS IT ───────────────────────────
  const generate = page.locator('button', { hasText: /Generate the shell/i }).first();
  record('GENERATE_AVAILABLE', await generate.count() > 0, 'the gate exposes the action');
  if (await generate.count()) {
    await generate.click();
    await page.waitForTimeout(6000);
  }

  const shell = await page.evaluate(() => {
    const canvas = document.querySelector('main canvas');
    const badge = [...document.querySelectorAll('main p')]
      .map((p) => p.textContent.trim())
      .find((t) => /walls .*rooms .*doors .*windows/i.test(t)) ?? null;
    return {
      hasCanvas: Boolean(canvas),
      width: canvas?.width ?? 0,
      height: canvas?.height ?? 0,
      badge,
      body: document.body.innerText,
    };
  });

  record('THREEJS_SHELL_RENDERS',
    shell.hasCanvas && shell.width > 200 && shell.height > 200,
    shell.hasCanvas ? `canvas ${shell.width}x${shell.height}` : 'no canvas was created');

  record('SHELL_REPORTS_WHAT_IT_BUILT',
    Boolean(shell.badge) && /5 walls/.test(shell.badge) && /2 rooms/.test(shell.badge),
    shell.badge ?? 'the shell did not say what it built');

  /* THE VISUAL COMPARISON THAT MATTERS: the generated floor area against the
     area the plan states. 800x600 px at 0.01 m/px is 8x6 = 48 m², and the two
     rooms are labelled 24 m² each. A mismatch here is the scale being applied
     wrongly, which is the single most consequential arithmetic in the whole
     pipeline. */
  record('GENERATED_AREA_MATCHES_PLAN', /48 m²/.test(shell.body),
    /48 m²/.test(shell.body)
      ? '48 m² generated against 24 + 24 stated on the plan'
      : 'the generated area does not match the areas the plan states');

  record('UNVERIFIED_ELEMENTS_ABSENT',
    /2 elements were not verified/i.test(shell.body),
    'the door and the window were never confirmed, so they are absent — and '
    + 'the shell says so rather than closing the gap quietly');

  // ── 6. THE SAME SCREEN ON A PHONE ────────────────────────────────────────
  await ctx.close();
  const phoneCtx = await browser.newContext({
    viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  await phoneCtx.addInitScript(([k, s]) => {
    window.localStorage.setItem(k, JSON.stringify(s));
    window.localStorage.setItem('homatch_lang', 'en');
  }, ['sb-stubproj-auth-token', fakeSession()]);
  const phone = await phoneCtx.newPage();
  await wire(phone);
  await phone.goto(`${BASE}/studio/plan/${PLAN_ID}`, { waitUntil: 'domcontentloaded' });
  await phone.waitForTimeout(3500);

  const phoneMetrics = await phone.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    inner: window.innerWidth,
    gate: /Ready to generate|Review required/i.test(document.body.innerText),
  }));
  record('PIPELINE_SCREEN_ON_PHONE',
    phoneMetrics.scrollW <= phoneMetrics.inner + 1 && phoneMetrics.gate,
    `scrollWidth ${phoneMetrics.scrollW} vs ${phoneMetrics.inner}, gate visible`);
  await phoneCtx.close();

  record('NO_CRITICAL_RUNTIME_ERRORS', thrown.length === 0,
    thrown.length ? thrown.slice(0, 3).join(' | ') : 'none');

  const failed = verdicts.filter((v) => !v.ok);
  console.log(`\n${verdicts.map((v) => `${v.ok ? 'PASS' : 'FAIL'}  ${v.name}${v.why ? ` — ${v.why}` : ''}`).join('\n')}`);
  console.log(`${verdicts.length - failed.length}/${verdicts.length} verdicts passed`);
  console.log('\nNOTE: this proves the CHAIN, not extraction accuracy. The document it '
    + 'drives is a harness fixture a person typed, not a drawing a model read.');
  assert.equal(failed.length, 0,
    `pipeline failed:\n${failed.map((f) => `  ${f.name}: ${f.why}`).join('\n')}`);
});
