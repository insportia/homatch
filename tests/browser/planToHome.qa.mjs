// HOMATCH DESIGN STUDIO — "FLOOR PLAN → HOME" BROWSER QA, IN REAL CHROME.
//
// The golden floor plan (tests/fixtures/design-studio/golden-floorplan.jpg) is
// uploaded through the customer's own path against the in-memory Supabase fake
// of designStudio.qa.mjs. The edge reading is stood in for by the recorded
// production model reading run through HOMATCH's REAL deterministic fusion
// (supabase/functions/_shared/designStudio/planRead), so the review shows
// exactly what production would show for that reading. The factory is a fake
// that queues, runs and completes, keyed by the spec like the real one, so the
// reload-during-generation path is exercised for real.
//
//   VITE_FEATURE_DESIGN_STUDIO=on npm run build:harness
//   QA_OUT=<dir> node tests/browser/planToHome.qa.mjs
//
// The simple first run, three ways:
//   A  v1 reading (nothing to ask): upload → Style → Quality → Generate → the
//      home; reload on every step; double tap; architecture and reading reused;
//      the result is the picture; the object edit as before; rooms, plan and
//      the advanced editor each lead back to the home.         1440/en, 390/ka
//   B  v2 reading (one weak printed size): exactly one quick question; the
//      detailed review and "Customise details" reachable and resumable.
//                                                              390/en, 1440/ru
//   C  right to left: the simple screens mirror, never overflow. 390/ar, 1440/he
//   D  architecture-critical questions in the band the first rule skipped (a
//      disputed door, a weakly inferred wall): asked one at a time, resumed on
//      the next after a reload, never repeated, then Style and Generate.
//                                                              390/ka, 1440/en
// No page errors, no horizontal overflow, no duplicate paid work.
// QA_ONLY=A|B|C|D runs one of them while iterating.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import zlib from 'node:zlib';
import {
  BASE, OUT, check as report, chromium, createStore, findChrome, openContext, overflowX, qaCatalogAssets, qaCatalogMaterials, startServer, wire,
} from './designStudio.qa.mjs';

let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed += 1; report(name, ok, detail); };

const ROOT = path.resolve(import.meta.dirname, '../..');
const FIXTURE = path.join(ROOT, 'tests/fixtures/design-studio');
const GOLDEN_JPG = path.join(FIXTURE, 'golden-floorplan.jpg');

/** The golden plan's grey copy (the reader's own test fixture). */
function loadPgm(file) {
  const buf = zlib.gunzipSync(readFileSync(file));
  const m = buf.subarray(0, 64).toString('latin1').match(/^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/);
  const width = Number(m[1]); const height = Number(m[2]);
  return { width, height, data: new Uint8Array(buf.buffer, buf.byteOffset + m[0].length, width * height) };
}

/**
 * The golden reading, v1 or v2. 'v1-critical' is v1 with two questions of the reader's own shape added, both in
 * the confidence band the first quick rule skipped: a door whose type the ink disputes (0.6) and a wall HOMATCH
 * inferred on weak ink (0.55) — the architecture-critical case the simple flow must ask.
 */
async function goldenInterpretation(key, reading = 'v1') {
  const base = reading === 'v1-critical' ? 'v1' : reading;
  const recorded = JSON.parse(readFileSync(path.join(FIXTURE, `golden-floorplan.read-${base}.json`), 'utf8'));
  const doc = { ...(recorded.rawDoc ?? recorded.doc), sourceAssetId: key };
  const { understand } = await import('../../supabase/functions/_shared/designStudio/planRead/understand.ts');
  const gray = loadPgm(path.join(FIXTURE, 'golden-floorplan.pgm.gz'));
  const out = understand({ doc, dimensionStrings: recorded.dimensionStrings, gray });
  if (reading === 'v1-critical') {
    const door = out.doc.doors[0];
    const wall = out.doc.walls.find((w) => w.kind !== 'EXTERIOR') ?? out.doc.walls[0];
    out.understanding.questions = [
      { id: `OPENING_TYPE:${door.id}`, kind: 'OPENING_TYPE', elementId: door.id, options: ['DOOR', 'WINDOW', 'OPENING', 'WALL'], suggested: 'DOOR', confidence: 0.6 },
      { id: `IS_WALL:${wall.id}`, kind: 'IS_WALL', elementId: wall.id, suggested: true, confidence: 0.55 },
      ...out.understanding.questions,
    ];
  }
  return {
    doc: out.doc, rawDoc: out.rawDoc, dimensionStrings: out.dimensionStrings, understanding: out.understanding,
    fusion: out.fusion, readVersion: 'ds-read-2', timings: { modelMs: 0, fuseMs: Math.round(out.timings.fuseMs) },
  };
}

function wireFactory(page, store) {
  store.factoryJobs = new Map();
  store.factoryPolls = 0;
  store.factoryStarts = 0;
  const png = readFileSync(GOLDEN_JPG);
  return page.route(/\/functions\/v1\/design-studio-reconstruct\/(factory|factory-status)$/, async (route) => {
    const req = route.request();
    const body = JSON.parse(req.postData() || '{}');
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
    if (req.url().endsWith('/factory')) {
      store.factoryStarts += 1;
      // The same spec at the same pass is the same job (the server's idempotency key).
      const key = createHash('sha256').update(JSON.stringify(body.spec)).digest('hex') + `|${body.pass}`;
      let job = [...store.factoryJobs.values()].find((j) => j.key === key);
      if (!job) { job = { id: `job-${store.factoryJobs.size + 1}`, key, polls: 0 }; store.factoryJobs.set(job.id, job); }
      return json({ jobId: job.id, state: 'QUEUED' });
    }
    store.factoryPolls += 1;
    const job = store.factoryJobs.get(body.jobId);
    if (!job) return json({ error: 'NOT_FOUND' }, 404);
    job.polls += 1;
    const stages = ['ARCHITECTURE', 'FURNISHING', 'MATERIALS', 'LIGHTING', 'RENDERING', 'OPTIMIZING'];
    if (job.polls <= stages.length) return json({ state: 'RUNNING', stage: stages[job.polls - 1] });
    const renderKey = 'users/hm1/design-studio-factory/qa/render.jpg';
    store.objects.set(renderKey, { body: png, type: 'image/jpeg' });
    return json({
      state: 'COMPLETED', stage: null,
      outputs: { render: { assetId: 'asset-render', key: renderKey, sha256: null, bytes: png.length }, scene: {}, pieces: {} },
      cost: [{ usd: 0.012, basis: 'ESTIMATED', detail: 'qa' }], result: { persistedBytes: png.length },
    });
  });
}

/* The render service, as the browser sees it: quotes, one factory pass per start (the fake factory
   above), status that finishes after a poll, and appearance edits. Pictures are the factory's own
   sample dollhouse render with an id map whose two regions are mapped to the design's sofa and the
   living-room floor (the real map comes from Blender's id pass). */
function wireRenders(page, store) {
  const master = readFileSync(path.join(FIXTURE, 'qa-master.jpg'));
  const ids = readFileSync(path.join(FIXTURE, 'qa-master-ids.png'));
  store.objects.set('users/hm1/qa/master.jpg', { body: master, type: 'image/jpeg' });
  store.objects.set('users/hm1/qa/master-ids.png', { body: ids, type: 'image/png' });
  store.renderCalls = { quote: 0, start: 0, edit: 0, status: 0 };
  const now = () => new Date().toISOString();
  const legendFor = (versionId) => {
    const v = store.db.ds_versions.find((x) => x.id === versionId);
    const src = store.db.ds_spatial_sources.find((x) => x.id === v?.source_id);
    const living = src?.canonical?.scene?.floors?.find((f) => f.kind === 'LIVING');
    const sofa = (v?.state?.objects ?? []).find((o) => /sofa/.test(o.assetId)) ?? (v?.state?.objects ?? [])[0];
    const entries = [];
    if (sofa) entries.push({ color: '#0a0b0c', kind: 'OBJECT', id: sofa.instanceId, roomId: sofa.roomId, coverage: 0.017, box: [0.33, 0.48, 0.47, 0.6] });
    if (living) entries.push({ color: '#0d0e0f', kind: 'FLOOR', id: `floor:${living.id}`, roomId: living.id, coverage: 0.07, box: [0.25, 0.4, 0.55, 0.7] });
    return { width: 1600, height: 1143, entries };
  };
  const ready = (r) => Object.assign(r, { status: 'READY', base_key: 'users/hm1/qa/master.jpg', final_key: 'users/hm1/qa/master.jpg', map_key: 'users/hm1/qa/master-ids.png', legend: legendFor(r.version_id), finish: { provider: 'OPENAI', model: 'qa', check: { accepted: true, edgeAgreement: 0.9, maskAgreement: 0.9, reason: null }, ms: 1, usd: 0 }, updated_at: now() });
  return page.route(/\/functions\/v1\/design-studio-reconstruct\/render-(quote|start|status|edit)$/, async (route) => {
    const req = route.request();
    const body = JSON.parse(req.postData() || '{}');
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
    const kind = req.url().split('render-').pop();
    store.renderCalls[kind] += 1;
    if (kind === 'quote') {
      const per = { DS_MASTER_RENDER: 6, DS_ROOM_RENDER: 5, DS_RENDER_EDIT: 4 }[body.product];
      const views = typeof body.views === 'number' ? body.views : 1;
      return json({ token: `q.${body.versionId}.${body.product}.${views}`, product: body.product, views, credits: per * views, expiresAt: new Date(Date.now() + 600000).toISOString(), charged: false });
    }
    if (kind === 'start') {
      const existing = store.db.ds_renders.filter((r) => r.idempotency_key === body.idempotencyKey);
      if (existing.length) return json({ renders: existing });
      // One factory pass for every view (the same spec is the same job).
      const key = createHash('sha256').update(JSON.stringify(body.spec)).digest('hex') + '|1';
      let job = [...store.factoryJobs.values()].find((j) => j.key === key);
      if (!job) { job = { id: `job-${store.factoryJobs.size + 1}`, key, polls: 0 }; store.factoryJobs.set(job.id, job); }
      const rows = body.views.map((v) => ({
        id: randomUUID(), project_id: body.projectId, user_id: 'hm1', version_id: body.versionId, kind: v.kind, parent_id: null, view: v,
        status: 'QUEUED', factory_job_id: job.id, base_key: null, map_key: null, final_key: null, legend: null, finish: null, edit: null,
        billing: { credits: null, reservationId: null, state: 'NOT_CHARGED' }, error: null, idempotency_key: body.idempotencyKey, created_at: now(), updated_at: now(),
      }));
      store.db.ds_renders.push(...rows);
      return json({ renders: rows });
    }
    if (kind === 'status') {
      const rows = store.db.ds_renders.filter((r) => body.renderIds.includes(r.id));
      for (const r of rows) {
        if (r.status === 'READY') continue;
        r.polls = (r.polls ?? 0) + 1;
        r.status = r.polls < 2 ? 'RENDERING' : r.polls < 3 ? 'FINISHING' : 'READY';
        if (r.status === 'READY') ready(r);
      }
      return json({ renders: rows });
    }
    // edit
    const parent = store.db.ds_renders.find((r) => r.id === body.renderId);
    if (!parent) return json({ error: 'NOT_FOUND' }, 404);
    const existing = store.db.ds_renders.find((r) => r.idempotency_key === body.idempotencyKey);
    if (existing) return json({ render: existing });
    const row = ready({ id: randomUUID(), project_id: parent.project_id, user_id: 'hm1', version_id: body.newVersionId, kind: 'EDIT', parent_id: parent.id, view: parent.view, edit: body.edit, idempotency_key: body.idempotencyKey, billing: { credits: null, reservationId: null, state: 'NOT_CHARGED' }, error: null, created_at: now() });
    store.db.ds_renders.push(row);
    return json({ render: row });
  });
}

/** Everything one browser context needs: the fakes, the reading (v1 or v2), and counters. */
async function open(browser, { width, height, lang, touch, reading }) {
  const errors = [];
  const store = createStore({ ds_catalog_assets: qaCatalogAssets(), ds_catalog_materials: qaCatalogMaterials(), ds_renders: [] });
  store.readCalls = 0;
  const ctx = await openContext(browser, { width, height, lang, touch });
  const page = await ctx.newPage();
  await wire(page, store, errors);
  await wireFactory(page, store);
  await wireRenders(page, store);
  // The reading: the recorded model output through HOMATCH's real fusion.
  await page.route(/\/functions\/v1\/design-studio-reconstruct\/floorplan$/, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    const plan = store.db.ds_floorplans.find((f) => f.id === body.floorplanId);
    if (!plan || !store.objects.has(plan.object_key)) return route.fulfill({ status: 404, body: '{}' });
    store.readCalls += 1;
    await new Promise((r) => setTimeout(r, 1200));
    Object.assign(plan, { status: 'INTERPRETED', interpretation: await goldenInterpretation(plan.object_key, reading) });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ state: 'INTERPRETED' }) });
  });
  // The AI designer answers in the room ids the plan produced.
  await page.route(/\/functions\/v1\/design-studio-reconstruct\/design$/, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    store.aiRequests.push(body.brief);
    const version = store.db.ds_versions.find((v) => v.id === body.versionId);
    const source = store.db.ds_spatial_sources.find((s) => s.id === version?.source_id);
    const floors = source?.canonical?.scene?.floors ?? [];
    const pick = (kind) => floors.find((f) => f.kind === kind)?.id;
    const rooms = [
      pick('LIVING') && { roomId: pick('LIVING'), wallColor: '#efe6d8', wallMaterial: null, floorMaterial: 'dev/floor-natural-oak', clearFurniture: false, furniture: ['dev/sofa-3', 'dev/coffee-table', 'dev/rug-large', 'dev/floor-lamp'] },
      pick('BEDROOM') && { roomId: pick('BEDROOM'), wallColor: null, wallMaterial: 'dev/paint-warm-white', floorMaterial: 'dev/floor-natural-oak', clearFurniture: false, furniture: ['dev/bed-double', 'dev/wardrobe-2'] },
    ].filter(Boolean);
    const plan = { version: 'ds-ai-1', dropped: {}, alternatives: [{ title: 'Warm modern', rationale: 'QA', styleCode: 'japandi', palette: ['#efe6d8', '#a77b52'], lighting: { timeOfDay: 'DAY', temperature: 'WARM', interiorIntensity: 0.7 }, rooms }] };
    const job = { id: `ai-${store.aiRequests.length}`, user_id: 'hm1', kind: 'AI_DESIGN', status: 'SUCCEEDED', output: { plan } };
    store.db.ds_jobs.push(job);
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ state: 'READY', jobId: job.id, plan, billing: 'NOT_CHARGED' }) });
  });
  const flow = () => store.db.ds_floorplans[0]?.corrections?.at(-1)?.flow ?? null;
  const step = () => page.getByTestId('plan-to-home').getAttribute('data-step').catch(() => null);
  const shot = (name) => page.screenshot({ path: path.join(OUT, `p2h-${name}-${width}-${lang}.png`) });
  const noOverflow = async (tag, where) => { const o = await overflowX(page); check(`${tag}: no horizontal overflow on ${where}`, o <= 1, String(o)); };
  /** Wait for the step a save has reached, then reload: the page must land on the same step. */
  const reloadAt = async (tag, expected, ready) => {
    for (let i = 0; i < 40; i += 1) { await page.waitForTimeout(150); if (await persisted(expected)) break; }
    await page.reload();
    await page.getByTestId(ready).waitFor({ timeout: 20000 });
    check(`${tag}: a reload on ${expected} resumes there (${await step()})`, (await step()) === expected, String(await step()));
  };
  const persisted = async (expected) => {
    const f = flow();
    if (expected === 'QUICK') return f?.step === 'REVIEW';
    if (expected === 'STYLE' || expected === 'QUALITY' || expected === 'CUSTOM') return f?.step === 'DESIGN' && f?.lookStep === expected;
    return true;
  };
  const start = async (tag) => {
    await page.goto(`${BASE}/design-studio`);
    await page.getByTestId('ds-launcher').waitFor({ timeout: 20000 }).catch(() => {});
    const usePlan = page.locator('button').filter({ hasText: /plan|გეგმ|план|plan|مخطط|תוכנית/i }).last();
    await usePlan.click();
    await page.getByTestId('plan-to-home').waitFor({ timeout: 20000 });
    await page.getByTestId('simple-upload').waitFor({ timeout: 10000 });
    await page.waitForTimeout(300);
    await shot('upload');
    await noOverflow(tag, 'upload');
    check(`${tag}: the upload screen has no stepper`, (await page.locator('[aria-label] ol li[aria-current]').count()) === 0);
    const t0 = Date.now();
    await page.getByTestId('plan-file').setInputFiles(GOLDEN_JPG);
    await page.getByTestId('plan-reading').waitFor({ timeout: 10000 });
    await shot('reading');
    return t0;
  };
  return { ctx, page, store, errors, flow, step, shot, noOverflow, reloadAt, start };
}

/** Wait until the page has moved past what is on screen now, to one of these steps. */
async function untilStep(page, steps, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const s = await page.getByTestId('plan-to-home').getAttribute('data-step').catch(() => null);
    if (steps.includes(s)) return s;
    await page.waitForTimeout(150);
  }
  return null;
}

/** Generate from the Quality screen (or the detailed chooser), with a double tap and a reload mid-factory. */
async function generateAndResume(s, tag, generateId) {
  const { page, store } = s;
  await page.getByTestId(generateId).waitFor({ timeout: 10000 });
  for (let i = 0; i < 40 && !(await page.getByTestId(generateId).isEnabled()); i += 1) await page.waitForTimeout(150);
  await page.getByTestId(generateId).dblclick();
  await page.getByTestId('plan-generating').waitFor({ timeout: 15000 });
  for (let i = 0; i < 60 && store.factoryPolls < 2; i += 1) await page.waitForTimeout(500);
  await s.shot('generating');
  await s.noOverflow(tag, 'generating');
  const shown = await page.getByTestId('generation-stages').locator('li[data-stage]').count();
  check(`${tag}: four customer stages, no percentage (${shown})`, shown === 4 && !/%/.test(await page.getByTestId('generation-stages').innerText()));
  const jobsBefore = store.factoryJobs.size;
  await page.reload();
  await page.getByTestId('plan-generating').waitFor({ timeout: 20000 });
  check(`${tag}: a reload during generation resumes it`, true);
  await page.waitForURL(/\/home$/, { timeout: 120000 });
  check(`${tag}: one design request (${store.aiRequests.length})`, store.aiRequests.length === 1, String(store.aiRequests.length));
  check(`${tag}: one factory job across the double tap and the reload (${store.factoryJobs.size})`, store.factoryJobs.size === 1 && jobsBefore === 1, `${jobsBefore} → ${store.factoryJobs.size}`);
  check(`${tag}: the master design was started once (${store.db.ds_renders.filter((r) => r.view?.id === 'master').length})`, store.db.ds_renders.filter((r) => r.view?.id === 'master').length === 1);
}

/* ── A: the golden plan (v1) — nothing to ask: upload → Style → Quality → Generate → the home ── */
async function zeroQuestionPath(browser, { width, height, lang, touch }) {
  const tag = `${width}-${lang} zero-question`;
  const s = await open(browser, { width, height, lang, touch, reading: 'v1' });
  const { page, store } = s;
  const t0 = await s.start(tag);
  const reached = await untilStep(page, ['STYLE', 'QUICK', 'REVIEW'], 40000);
  check(`${tag}: straight from the reading to Style, nothing asked (${reached}, ${Date.now() - t0} ms)`, reached === 'STYLE', String(reached));
  check(`${tag}: the detailed review never appeared`, (await page.getByTestId('plan-review').count()) === 0);
  check(`${tag}: flow recorded the review as AUTO`, s.flow()?.review === 'AUTO', String(s.flow()?.review));
  await page.getByTestId('look-style').waitFor({ timeout: 10000 });
  await page.waitForTimeout(300);
  await s.shot('style');
  await s.noOverflow(tag, 'style');
  const cards = await page.locator('[data-testid^="look-style-"]').count();
  check(`${tag}: six style cards (${cards})`, cards === 6, String(cards));
  check(`${tag}: Next waits for a style`, !(await page.getByTestId('look-next').isEnabled()));
  const small = await page.locator('[data-testid^="look-style-"], [data-testid="look-next"]').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 48).length);
  check(`${tag}: style targets are at least 48 px`, small === 0, String(small));
  const sources = store.db.ds_spatial_sources.length;
  await s.reloadAt(tag, 'STYLE', 'look-style');
  check(`${tag}: the architecture is reused across the reload (${sources} → ${store.db.ds_spatial_sources.length})`, sources === 1 && store.db.ds_spatial_sources.length === 1);
  check(`${tag}: the reading is cached, never read again (${store.readCalls})`, store.readCalls === 1, String(store.readCalls));

  await page.getByTestId('look-style-LUXURY').click();
  await page.getByTestId('look-next').click();
  await page.getByTestId('look-quality').waitFor({ timeout: 10000 });
  await page.getByTestId('look-price').getByText(/\d/).waitFor({ timeout: 10000 }).catch(() => {});
  await s.shot('quality');
  await s.noOverflow(tag, 'quality');
  check(`${tag}: three quality cards`, (await page.locator('[data-testid^="look-quality-"]').count()) === 3);
  check(`${tag}: High quality is the default`, (await page.getByTestId('look-quality-HIGH_QUALITY').getAttribute('aria-checked')) === 'true');
  check(`${tag}: the price is on the Generate screen`, /6/.test(await page.getByTestId('look-price').innerText()), await page.getByTestId('look-price').innerText());
  await page.getByTestId('look-quality-PREMIUM').click();
  await s.reloadAt(tag, 'QUALITY', 'look-quality');
  check(`${tag}: the chosen quality survives the reload`, (await page.getByTestId('look-quality-PREMIUM').getAttribute('aria-checked')) === 'true');
  await page.getByTestId('simple-back').click();
  await page.getByTestId('look-style').waitFor({ timeout: 10000 });
  check(`${tag}: Back keeps the chosen style`, (await page.getByTestId('look-style-LUXURY').getAttribute('aria-checked')) === 'true');
  await page.getByTestId('look-next').click();
  await page.getByTestId('look-quality').waitFor({ timeout: 10000 });

  await generateAndResume(s, tag, 'look-generate');
  const f = s.flow();
  check(`${tag}: Luxury × Premium is what was generated (${f?.look?.style}/${f?.look?.quality}, ${f?.preferences?.style}/${f?.preferences?.furnishing}/${f?.preferences?.floor})`,
    f?.look?.style === 'LUXURY' && f?.look?.quality === 'PREMIUM' && f?.preferences?.style === 'luxury' && f?.preferences?.furnishing === 'STAGED' && f?.preferences?.floor === 'MARBLE');
  const brief = JSON.stringify(store.aiRequests[0] ?? null);
  check(`${tag}: the AI designer was briefed with the quality`, /Premium: top-tier natural materials/.test(brief), brief.slice(0, 200));
  check(`${tag}: flow recorded DONE with timings`, f?.step === 'DONE' && typeof f?.timings?.analysisMs === 'number');

  // ── The result: the picture first; the edit pipeline exactly as before ──
  await page.getByTestId('design-home').waitFor({ timeout: 20000 });
  await page.getByTestId('render-viewer').waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500); // the id map loads after the picture
  await s.shot('home');
  await s.noOverflow(tag, 'the result');
  check(`${tag}: the result opens on the picture (no tabs)`, (await page.locator('[data-testid^="home-tab-"]').count()) === 0 && (await page.getByTestId('design-home').getAttribute('data-view')) === 'HOME');
  check(`${tag}: no walkthrough offered until it is proven`, (await page.getByTestId('home-walk').count()) === 0 && (await page.getByTestId('home-walk-start').count()) === 0);
  check(`${tag}: the advanced editor is reachable`, await page.getByTestId('home-advanced').isVisible());
  const viewer = await page.getByTestId('home-render').boundingBox();
  check(`${tag}: the picture dominates (${Math.round(viewer.width)} of ${width})`, viewer.width >= width * (width < 600 ? 0.88 : 0.6), String(viewer.width));
  const img = page.getByTestId('render-viewer').locator('img').first();
  const box = await img.boundingBox();
  await page.mouse.click(box.x + box.width * 0.40, box.y + box.height * 0.54);
  await page.getByTestId('edit-panel').waitFor({ timeout: 10000 });
  await s.shot('edit');
  const swatch = page.getByTestId('edit-panel').locator('button[aria-label]').filter({ hasNot: page.locator('svg') }).first();
  const colour = (await swatch.getAttribute('aria-label') ?? '').match(/#[0-9a-f]{6}/i)?.[0] ?? null;
  await swatch.click();
  await page.getByTestId('confirm-price').waitFor({ timeout: 10000 });
  await page.getByTestId('confirm-run').dblclick();
  for (let i = 0; i < 40 && !store.db.ds_renders.some((r) => r.kind === 'EDIT'); i += 1) await page.waitForTimeout(250);
  check(`${tag}: one appearance edit rendered, double tap or not (${store.db.ds_renders.filter((r) => r.kind === 'EDIT').length})`, store.db.ds_renders.filter((r) => r.kind === 'EDIT').length === 1);
  const head = () => store.db.ds_versions.find((v) => v.id === store.db.ds_projects[0].head_version_id);
  const sofaColour = () => (head()?.state?.objects ?? []).find((o) => /sofa/.test(o.assetId))?.colorOverride ?? null;
  check(`${tag}: the edit is the design's own (sofa ${sofaColour()} = ${colour})`, !!colour && sofaColour()?.toLowerCase() === colour.toLowerCase(), `${sofaColour()} vs ${colour}`);

  // ── Edit a room: priced first, appearing when ready, and back to the home ──
  await page.getByTestId('home-rooms').click();
  await page.getByTestId('room-pick').first().waitFor({ timeout: 10000 });
  const living = page.getByTestId('room-pick').filter({ hasText: /Living|მისაღები/ }).first();
  await living.getByRole('radio', { name: '1' }).click();
  await page.getByTestId('rooms-quote').click();
  await page.getByTestId('rooms-offer').waitFor({ timeout: 10000 });
  await page.getByTestId('rooms-confirm').click();
  await page.getByTestId('room-shot').first().waitFor({ timeout: 30000 });
  for (let i = 0; i < 40 && (await page.locator('[data-testid="room-shot"][data-status="READY"]').count()) === 0; i += 1) await page.waitForTimeout(500);
  await s.shot('rooms');
  await s.noOverflow(tag, 'rooms');
  check(`${tag}: a room view arrives`, (await page.locator('[data-testid="room-shot"][data-status="READY"]').count()) >= 1);
  await page.getByTestId('home-back').click();
  await page.getByTestId('home-render').waitFor({ timeout: 10000 });
  await page.getByTestId('home-plan').click();
  await page.getByTestId('home-back').waitFor({ timeout: 10000 });
  await s.shot('plan');
  await s.noOverflow(tag, 'your plan');
  await page.getByTestId('home-back').click();
  await page.getByTestId('home-render').waitFor({ timeout: 10000 });
  check(`${tag}: rooms and plan always lead back to the home`, true);

  // ── Navigation: the project opens on its home; the editor only on purpose, with a way back ──
  const id = store.db.ds_projects[0].id;
  await page.goto(`${BASE}/design-studio/${id}`);
  await page.waitForURL(/\/home$/, { timeout: 20000 });
  await page.getByTestId('design-home').waitFor({ timeout: 20000 });
  check(`${tag}: a generated project opens on its home, not the editor`, true);
  await page.getByTestId('home-advanced').click();
  await page.waitForURL(/editor=1/, { timeout: 20000 });
  await page.getByTestId('workspace-back').waitFor({ timeout: 30000 });
  check(`${tag}: the advanced editor opens on purpose`, !/\/home$/.test(page.url()));
  check(`${tag}: the editor's back arrow returns to the home`, /\/home$/.test(await page.getByTestId('workspace-back').getAttribute('href') ?? ''));
  await page.getByTestId('workspace-back').click();
  await page.waitForURL(/\/home$/, { timeout: 20000 });
  check(`${tag}: no page errors`, s.errors.length === 0, s.errors.join('\n        '));
  await s.ctx.close();
}

/* ── B: the v2 reading — exactly one quick question; detailed review and Customise details reachable ── */
async function oneQuestionPath(browser, { width, height, lang, touch }) {
  const tag = `${width}-${lang} one-question`;
  const s = await open(browser, { width, height, lang, touch, reading: 'v2' });
  const { page, store } = s;
  await s.start(tag);
  const reached = await untilStep(page, ['QUICK', 'STYLE', 'REVIEW'], 40000);
  check(`${tag}: one quick question stops the customer (${reached})`, reached === 'QUICK', String(reached));
  await page.getByTestId('quick-question').waitFor({ timeout: 10000 });
  await page.waitForTimeout(300);
  await s.shot('question');
  await s.noOverflow(tag, 'the quick question');
  check(`${tag}: one question on screen`, (await page.getByTestId('question-choices').count()) === 1);
  const small = await page.getByTestId('question-choices').locator('button').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 48).length);
  check(`${tag}: answer targets are at least 48 px`, small === 0, String(small));
  await s.reloadAt(tag, 'QUICK', 'quick-question');
  check(`${tag}: the reading is cached across the reload (${store.readCalls})`, store.readCalls === 1, String(store.readCalls));
  check(`${tag}: the detailed review is offered beside the question`, await page.getByTestId('review-detail').isVisible());
  // One tap answers it (the printed size, as printed), and the path goes on by itself.
  await page.getByTestId('question-choices').locator('button').first().click();
  const after = await untilStep(page, ['STYLE', 'QUICK', 'REVIEW'], 30000);
  check(`${tag}: after the one answer, straight on to Style (${after})`, after === 'STYLE', String(after));
  check(`${tag}: the answer is kept (${(s.flow()?.answers ?? []).map((a) => a.questionId).join(',')})`, (s.flow()?.answers ?? []).some((a) => a.questionId === 'DIMENSION:R9'));
  // The detailed review is still a link away, and continues to Style.
  await page.getByTestId('look-style').waitFor({ timeout: 10000 });
  const sources = store.db.ds_spatial_sources.length;
  await page.getByTestId('review-detail').click();
  await page.getByTestId('plan-review').waitFor({ timeout: 10000 });
  await s.shot('review-detail');
  check(`${tag}: the detailed review is reachable`, true);
  await page.reload();
  await page.getByTestId('plan-review').waitFor({ timeout: 20000 });
  check(`${tag}: a reload in the detailed review stays there`, (await s.step()) === 'REVIEW');
  await page.getByTestId('plan-continue').click();
  await page.getByTestId('look-style').waitFor({ timeout: 20000 });
  check(`${tag}: the detailed review continues to Style`, true);
  check(`${tag}: the same review never builds the architecture twice (${sources} → ${store.db.ds_spatial_sources.length})`, sources === 1 && store.db.ds_spatial_sources.length === 1);

  await page.getByTestId('look-style-WARM_COZY').click();
  await page.getByTestId('look-next').click();
  await page.getByTestId('look-quality-SMART_BUDGET').click();
  await page.getByTestId('look-customize').click();
  await page.getByTestId('design-chooser').waitFor({ timeout: 10000 });
  await s.shot('customize');
  await s.noOverflow(tag, 'customise details');
  check(`${tag}: Customise details starts from Warm & Cozy × Smart budget`, (await page.getByTestId('style-scandinavian').getAttribute('aria-pressed').catch(() => null)) === 'true' || (await page.getByTestId('style-scandinavian').getAttribute('aria-checked').catch(() => null)) === 'true');
  check(`${tag}: furnishing follows the quality (essential)`, ['true'].includes(String(await page.getByTestId('furnishing-essential').getAttribute('aria-pressed').catch(() => null))) || ['true'].includes(String(await page.getByTestId('furnishing-essential').getAttribute('aria-checked').catch(() => null))));
  await s.reloadAt(tag, 'CUSTOM', 'design-chooser');
  await page.getByTestId('furnishing-full').click();
  await page.getByTestId('design-brief').fill('A reading corner by the window.');
  await page.waitForTimeout(900);
  await generateAndResume(s, tag, 'design-generate');
  const f = s.flow();
  check(`${tag}: the customised details are what was generated (${f?.preferences?.style}/${f?.preferences?.furnishing})`, f?.preferences?.style === 'scandinavian' && f?.preferences?.furnishing === 'FULL' && /reading corner/.test(f?.preferences?.brief ?? ''));
  check(`${tag}: the answer was kept (${(f?.answers ?? []).map((a) => a.questionId).join(',')})`, (f?.answers ?? []).some((a) => a.questionId === 'DIMENSION:R9'));
  await page.getByTestId('design-home').waitFor({ timeout: 20000 });
  check(`${tag}: no page errors`, s.errors.length === 0, s.errors.join('\n        '));
  await s.ctx.close();
}

/* ── D: architecture-critical questions the first rule skipped — asked one at a time, resumed, never repeated ── */
async function criticalQuestions(browser, { width, height, lang, touch }) {
  const tag = `${width}-${lang} critical`;
  const s = await open(browser, { width, height, lang, touch, reading: 'v1-critical' });
  const { page, store } = s;
  await s.start(tag);
  const reached = await untilStep(page, ['QUICK', 'STYLE', 'REVIEW'], 40000);
  check(`${tag}: an uncertain door stops the customer (${reached})`, reached === 'QUICK', String(reached));
  await page.getByTestId('quick-question').waitFor({ timeout: 10000 });
  await page.waitForTimeout(300);
  const ids = (store.db.ds_floorplans[0]?.interpretation?.understanding?.questions ?? []).map((q) => q.id);
  const [doorQ, wallQ] = ids;
  check(`${tag}: one question on screen, 1 of 2`, (await page.getByTestId('question-choices').count()) === 1 && JSON.stringify((await page.getByTestId('quick-question').locator('p').first().innerText()).match(/[0-9]+/g)) === '["1","2"]');
  await s.shot('critical-question');
  await s.noOverflow(tag, 'the critical question');
  const small = await page.getByTestId('question-choices').locator('button').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 48).length);
  check(`${tag}: answer targets are at least 48 px`, small === 0, String(small));
  const raw = await page.locator('body').innerText();
  check(`${tag}: no internal ids or raw keys on screen`, !/OPENING_TYPE|IS_WALL|OVERALL_|\bsf_[a-z_]+|p2h_q_|\{\{/.test(raw));
  // Answer the door with its suggestion; the save lands; a reload shows the wall, not the door again.
  await page.getByTestId('question-choices').locator('button').first().click();
  for (let i = 0; i < 40 && !(s.flow()?.answers ?? []).some((a) => a.questionId === doorQ); i += 1) await page.waitForTimeout(150);
  check(`${tag}: the door answer is saved (${(s.flow()?.answers ?? []).map((a) => a.questionId).join(',')})`, (s.flow()?.answers ?? []).some((a) => a.questionId === doorQ));
  check(`${tag}: still asking — the wall is next (${await s.step()})`, (await s.step()) === 'QUICK');
  await page.reload();
  await page.getByTestId('quick-question').waitFor({ timeout: 20000 });
  check(`${tag}: after a reload, the next question (2 of 2), not the answered one`, JSON.stringify((await page.getByTestId('quick-question').locator('p').first().innerText()).match(/[0-9]+/g)) === '["2","2"]');
  await s.shot('critical-question-2');
  await page.getByTestId('question-choices').locator('button').first().click();
  const after = await untilStep(page, ['STYLE', 'QUICK', 'REVIEW'], 30000);
  check(`${tag}: the last critical answer goes on to Style (${after})`, after === 'STYLE', String(after));
  const answers = (s.flow()?.answers ?? []).map((a) => a.questionId);
  check(`${tag}: both answers kept, once each (${answers.join(',')})`, answers.filter((x) => x === doorQ).length === 1 && answers.filter((x) => x === wallQ).length === 1);
  await s.reloadAt(tag, 'STYLE', 'look-style');
  check(`${tag}: no question comes back after a reload on Style`, (await page.getByTestId('quick-question').count()) === 0);
  check(`${tag}: the reading is cached (${store.readCalls})`, store.readCalls === 1, String(store.readCalls));
  // Generate exactly as before.
  await page.getByTestId('look-style-MODERN').click();
  await page.getByTestId('look-next').click();
  await page.getByTestId('look-quality').waitFor({ timeout: 10000 });
  await generateAndResume(s, tag, 'look-generate');
  await page.getByTestId('design-home').waitFor({ timeout: 20000 });
  const done = s.flow();
  check(`${tag}: the generated home carries the answers (door ${done?.answers?.find((a) => a.questionId === doorQ)?.value})`, done?.step === 'DONE' && done?.answers?.find((a) => a.questionId === doorQ)?.value === 'DOOR' && done?.answers?.find((a) => a.questionId === wallQ)?.value === true);
  check(`${tag}: no page errors`, s.errors.length === 0, s.errors.join('\n        '));
  await s.ctx.close();
}

/* ── C: right-to-left — the simple screens mirror and never overflow ── */
async function rtl(browser, { width, height, lang, touch }) {
  const tag = `${width}-${lang} rtl`;
  const s = await open(browser, { width, height, lang, touch, reading: 'v2' });
  const { page } = s;
  await s.start(tag);
  check(`${tag}: the page is right-to-left`, (await page.evaluate(() => document.documentElement.dir)) === 'rtl');
  await page.getByTestId('quick-question').waitFor({ timeout: 40000 });
  await page.waitForTimeout(300);
  await s.shot('question');
  await s.noOverflow(tag, 'the quick question');
  await page.getByTestId('question-choices').locator('button').first().click();
  await page.getByTestId('look-style').waitFor({ timeout: 30000 });
  await page.waitForTimeout(300);
  await s.shot('style');
  await s.noOverflow(tag, 'style');
  const first = await page.getByTestId('look-style-MODERN').boundingBox();
  const second = await page.getByTestId('look-style-MINIMAL').boundingBox();
  check(`${tag}: the cards read right to left`, first.x > second.x, `${first.x} vs ${second.x}`);
  await page.getByTestId('look-style-CLASSIC').click();
  await page.getByTestId('look-next').click();
  await page.getByTestId('look-quality').waitFor({ timeout: 10000 });
  await page.waitForTimeout(300);
  await s.shot('quality');
  await s.noOverflow(tag, 'quality');
  const raw = await page.locator('body').innerText();
  check(`${tag}: no raw keys or braces on screen`, !/\bsf_[a-z_]+|\{\{|\}\}/.test(raw));
  check(`${tag}: no page errors`, s.errors.length === 0, s.errors.join('\n        '));
  await s.ctx.close();
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  const only = process.env.QA_ONLY;
  try {
    if (!only || only === 'A') {
      await zeroQuestionPath(browser, { width: 1440, height: 900, lang: 'en', touch: false });
      await zeroQuestionPath(browser, { width: 390, height: 844, lang: 'ka', touch: true });
    }
    if (!only || only === 'B') {
      await oneQuestionPath(browser, { width: 390, height: 844, lang: 'en', touch: true });
      await oneQuestionPath(browser, { width: 1440, height: 900, lang: 'ru', touch: false });
    }
    if (!only || only === 'D') {
      await criticalQuestions(browser, { width: 390, height: 844, lang: 'ka', touch: true });
      await criticalQuestions(browser, { width: 1440, height: 900, lang: 'en', touch: false });
    }
    if (!only || only === 'C') {
      await rtl(browser, { width: 390, height: 844, lang: 'ar', touch: true });
      await rtl(browser, { width: 1440, height: 900, lang: 'he', touch: false });
    }
  } finally {
    await browser.close().catch(() => {});
    server.kill();
  }
  console.log(`screenshots: ${OUT}`);
  if (failed) process.exit(1);
}

await main();
