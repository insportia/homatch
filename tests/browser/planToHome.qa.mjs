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
// Checks: upload → reading → review (sizes, questions, corrections) → look →
// generate → reload mid-generation resumes the SAME factory job → walkthrough
// opens → "Your plan" compare; at 1440 and 390; no page errors, no horizontal
// overflow, no duplicate work from a double tap.

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

async function goldenInterpretation(key) {
  const recorded = JSON.parse(readFileSync(path.join(FIXTURE, 'golden-floorplan.read-v1.json'), 'utf8'));
  const doc = { ...recorded.doc, sourceAssetId: key };
  const { understand } = await import('../../supabase/functions/_shared/designStudio/planRead/understand.ts');
  const gray = loadPgm(path.join(FIXTURE, 'golden-floorplan.pgm.gz'));
  const out = understand({ doc, dimensionStrings: recorded.dimensionStrings, gray });
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

async function run(browser, { width, height, lang, touch }) {
  const errors = [];
  const store = createStore({ ds_catalog_assets: qaCatalogAssets(), ds_catalog_materials: qaCatalogMaterials(), ds_renders: [] });
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
    await new Promise((r) => setTimeout(r, 1200));
    Object.assign(plan, { status: 'INTERPRETED', interpretation: await goldenInterpretation(plan.object_key) });
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

  const tag = `${width}-${lang}`;
  await page.goto(`${BASE}/design-studio`);
  await page.getByTestId('ds-launcher').waitFor({ timeout: 20000 }).catch(() => {});
  const usePlan = page.locator('button').filter({ hasText: /plan|გეგმ/i }).last();
  await usePlan.click();
  await page.getByTestId('plan-to-home').waitFor({ timeout: 20000 });
  const t0 = Date.now();
  await page.getByTestId('plan-file').setInputFiles(GOLDEN_JPG);
  await page.getByTestId('plan-reading').waitFor({ timeout: 10000 });
  await page.screenshot({ path: path.join(OUT, `p2h-reading-${tag}.png`) });
  await page.getByTestId('plan-review').waitFor({ timeout: 30000 });
  check(`${tag}: review ready (${Date.now() - t0} ms)`, true);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `p2h-review-${tag}.png`), fullPage: false });
  const overall = await page.getByTestId('plan-overall').textContent().catch(() => null);
  check(`${tag}: overall size shown`, !!overall && /m/.test(overall), String(overall));
  const rooms = await page.getByTestId('plan-room-row').count();
  check(`${tag}: rooms listed (${rooms})`, rooms >= 7, String(rooms));
  check(`${tag}: no horizontal overflow on review`, (await overflowX(page)) <= 1, String(await overflowX(page)));
  // Answer every question with its first (suggested) choice.
  for (let i = 0; i < 10; i += 1) {
    const q = page.getByTestId('plan-question').first();
    if (!(await q.count())) break;
    await q.locator('div button').first().click();
    await page.waitForTimeout(150);
  }
  const left = await page.getByTestId('plan-question').count();
  check(`${tag}: every question answerable by one tap`, left === 0, String(left));
  // A correction by tapping: the first room row, then a room type.
  await page.getByTestId('plan-room-row').first().click();
  await page.getByTestId('plan-selection').waitFor({ timeout: 5000 });
  await page.getByTestId('plan-mode-overlay').click();
  await page.screenshot({ path: path.join(OUT, `p2h-review-overlay-${tag}.png`) });
  await page.getByTestId('plan-mode-clean').click();
  await page.getByTestId('plan-continue').click();
  await page.getByTestId('design-chooser').waitFor({ timeout: 15000 });
  await page.screenshot({ path: path.join(OUT, `p2h-design-${tag}.png`) });
  check(`${tag}: no horizontal overflow on design`, (await overflowX(page)) <= 1, String(await overflowX(page)));
  await page.getByTestId('style-japandi').click();
  await page.getByTestId('furnishing-full').click();
  await page.getByTestId('design-brief').fill('Warm modern apartment, light oak floors, cream walls, minimal black accents.');
  // A double tap is one run.
  await page.getByTestId('design-generate').dblclick();
  await page.getByTestId('plan-generating').waitFor({ timeout: 15000 });
  // Reload in the middle of the factory pass: it must resume the SAME job.
  for (let i = 0; i < 60 && store.factoryPolls < 2; i += 1) await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `p2h-generating-${tag}.png`) });
  const jobsBefore = store.factoryJobs.size;
  await page.reload();
  await page.getByTestId('plan-generating').waitFor({ timeout: 20000 });
  check(`${tag}: a reload during generation resumes it`, true);
  await page.waitForURL(/\/home$/, { timeout: 120000 });
  check(`${tag}: one design request (${store.aiRequests.length})`, store.aiRequests.length === 1, String(store.aiRequests.length));
  check(`${tag}: one factory job across the reload (${store.factoryJobs.size})`, store.factoryJobs.size === 1 && jobsBefore === 1, `${jobsBefore} → ${store.factoryJobs.size}`);
  const versions = store.db.ds_versions.map((v) => v.origin).join(',');
  check(`${tag}: versions Original → AI → factory (${versions})`, /ORIGINAL/.test(versions) && /AI/.test(versions) && /BRANCH/.test(versions), versions);
  check(`${tag}: the master design was started once, with the generation (${store.renderCalls.start})`, store.renderCalls.start >= 1 && store.db.ds_renders.filter((r) => r.view?.id === 'master').length === 1);
  check(`${tag}: the design's DNA is kept with its versions`, store.db.ds_versions.filter((v) => v.design_dna?.version === 'ds-dna-1').length >= 2);

  // ── The home: the master design, touched and changed ──────────────────
  await page.getByTestId('design-home').waitFor({ timeout: 20000 });
  await page.getByTestId('render-viewer').waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500); // the id map loads after the picture
  await page.screenshot({ path: path.join(OUT, `p2h-home-${tag}.png`) });
  check(`${tag}: no horizontal overflow on the home`, (await overflowX(page)) <= 1, String(await overflowX(page)));
  const img = page.getByTestId('render-viewer').locator('img').first();
  const box = await img.boundingBox();
  await page.mouse.click(box.x + box.width * 0.40, box.y + box.height * 0.54);
  await page.getByTestId('edit-panel').waitFor({ timeout: 10000 });
  await page.screenshot({ path: path.join(OUT, `p2h-edit-${tag}.png`) });
  const swatch = page.getByTestId('edit-panel').locator('button[aria-label]').filter({ hasNot: page.locator('svg') }).first();
  const colour = (await swatch.getAttribute('aria-label') ?? '').match(/#[0-9a-f]{6}/i)?.[0] ?? null;
  await swatch.click();
  await page.getByTestId('confirm-price').waitFor({ timeout: 10000 });
  await page.screenshot({ path: path.join(OUT, `p2h-confirm-${tag}.png`) });
  await page.getByTestId('confirm-run').dblclick();
  for (let i = 0; i < 40 && !store.db.ds_renders.some((r) => r.kind === 'EDIT'); i += 1) await page.waitForTimeout(250);
  check(`${tag}: one appearance edit rendered, double tap or not (${store.db.ds_renders.filter((r) => r.kind === 'EDIT').length})`, store.db.ds_renders.filter((r) => r.kind === 'EDIT').length === 1);
  const project = store.db.ds_projects[0];
  const head = () => store.db.ds_versions.find((v) => v.id === store.db.ds_projects[0].head_version_id);
  const sofaColour = () => (head()?.state?.objects ?? []).find((o) => /sofa/.test(o.assetId))?.colorOverride ?? null;
  check(`${tag}: the edit is the design's own (sofa ${sofaColour()} = ${colour})`, !!colour && sofaColour()?.toLowerCase() === colour.toLowerCase(), `${sofaColour()} vs ${colour}`);
  void project;

  // ── Rooms: one view of the living room, priced first, appearing when ready ──
  await page.getByTestId('home-tab-rooms').click();
  await page.getByTestId('room-pick').first().waitFor({ timeout: 10000 });
  const living = page.getByTestId('room-pick').filter({ hasText: /Living|მისაღები/ }).first();
  await living.getByRole('radio', { name: '1' }).click();
  await page.getByTestId('rooms-quote').click();
  await page.getByTestId('rooms-offer').waitFor({ timeout: 10000 });
  await page.getByTestId('rooms-confirm').click();
  await page.getByTestId('room-shot').first().waitFor({ timeout: 30000 });
  for (let i = 0; i < 40 && (await page.locator('[data-testid="room-shot"][data-status="READY"]').count()) === 0; i += 1) await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `p2h-rooms-${tag}.png`) });
  check(`${tag}: a room view arrives (${await page.locator('[data-testid="room-shot"][data-status="READY"]').count()})`, (await page.locator('[data-testid="room-shot"][data-status="READY"]').count()) >= 1);

  // ── The walkthrough is built from the approved design (the edited sofa included) ──
  await page.getByTestId('home-tab-walk').click();
  await page.getByTestId('home-walk-start').click();
  await page.waitForURL(/\/walkthrough$/, { timeout: 120000 });
  check(`${tag}: the walkthrough's design keeps the edit (${sofaColour()})`, sofaColour()?.toLowerCase() === colour?.toLowerCase());
  check(`${tag}: the walkthrough design is a factory build of the edited version`, (head()?.change_summary ?? []).some((c) => c.kind === 'FACTORY_BUILD'));
  await page.locator('canvas').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, `p2h-walkthrough-${tag}.png`) });
  const compare = page.getByTestId('walk-plan-compare');
  if (await compare.count()) {
    await compare.click();
    await page.getByTestId('plan-compare').waitFor({ timeout: 10000 });
    await page.screenshot({ path: path.join(OUT, `p2h-compare-${tag}.png`) });
    check(`${tag}: "Your plan" opens in the walkthrough`, true);
  } else {
    check(`${tag}: "Your plan" button in the walkthrough`, false, 'missing');
  }
  const flow = store.db.ds_floorplans[0]?.corrections?.at(-1)?.flow;
  check(`${tag}: flow recorded DONE with timings`, flow?.step === 'DONE' && typeof flow?.timings?.analysisMs === 'number', JSON.stringify(flow?.timings ?? null));
  check(`${tag}: no page errors`, errors.length === 0, errors.join('\n        '));
  await ctx.close();
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  try {
    await run(browser, { width: 1440, height: 900, lang: 'en', touch: false });
    await run(browser, { width: 390, height: 844, lang: 'ka', touch: true });
  } finally {
    await browser.close().catch(() => {});
    server.kill();
  }
  console.log(`screenshots: ${OUT}`);
  if (failed) process.exit(1);
}

await main();
