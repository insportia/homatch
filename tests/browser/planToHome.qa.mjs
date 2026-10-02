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
import { createHash } from 'node:crypto';
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

async function run(browser, { width, height, lang, touch }) {
  const errors = [];
  const store = createStore({ ds_catalog_assets: qaCatalogAssets(), ds_catalog_materials: qaCatalogMaterials() });
  const ctx = await openContext(browser, { width, height, lang, touch });
  const page = await ctx.newPage();
  await wire(page, store, errors);
  await wireFactory(page, store);
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
  await page.waitForURL(/\/walkthrough$/, { timeout: 120000 });
  check(`${tag}: one design request (${store.aiRequests.length})`, store.aiRequests.length === 1, String(store.aiRequests.length));
  check(`${tag}: one factory job across the reload (${store.factoryJobs.size})`, store.factoryJobs.size === 1 && jobsBefore === 1, `${jobsBefore} → ${store.factoryJobs.size}`);
  const versions = store.db.ds_versions.map((v) => v.origin).join(',');
  check(`${tag}: versions Original → AI → factory (${versions})`, /ORIGINAL/.test(versions) && /AI/.test(versions) && /BRANCH/.test(versions), versions);
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
