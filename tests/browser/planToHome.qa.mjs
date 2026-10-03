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
//   E  PHOTOS (the unified OpenAI-first flow): three photos → look over, remove,
//      add → analysis (left mid-way and resumed) → one detail → Style (more
//      options, surprise me) → Quality → Generate (reload mid-way, Snake while
//      it is made, READY above the game) → the Result: before / after, edit,
//      another room, another option. One reading, one specification per
//      design, one picture per design; no reconstruction, no factory.
//                                                              390/ka, 1440/en
//   F  PHOTOS that fail: a retryable failure offers "try again" (nothing is
//      uploaded again); unusable photos ask for another file.  390/en, 390/he
// No page errors, no horizontal overflow, no duplicate paid work.
// QA_ONLY=A|B|C|D|E|F runs one of them while iterating.

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
    // As the real render-edit (renders.ts): an edited picture keeps its parent's object map and legend.
    if (parent.legend) Object.assign(row, { legend: parent.legend, map_key: parent.map_key });
    store.db.ds_renders.push(row);
    return json({ render: row });
  });
}

/*
 * OpenAI-first generation, as the browser sees it: design-spec answers a specification job; render-generate
 * makes ONE row per idempotency key (no factory job); render-generate-step moves it QUEUED → RENDERING (the one
 * image call) → FINISHING (the picture) → READY (the picture with its AI edit map: "ai:sofa:1", "ai:floor:1"
 * painted in the fixture id picture's own colours). The picture is the fixture photograph.
 */
function wireGeneration(page, store) {
  store.gen = { specCalls: 0, specRuns: 0, specBodies: [], generateCalls: 0, stepCalls: 0, imageCalls: 0, specJobs: new Map() };
  const now = () => new Date().toISOString();
  const json = (route, b, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
  const legendFor = (versionId) => {
    const v = store.db.ds_versions.find((x) => x.id === versionId);
    const src = store.db.ds_spatial_sources.find((x) => x.id === v?.source_id);
    const living = src?.canonical?.scene?.floors?.find((f) => f.kind === 'LIVING');
    return { width: 1600, height: 1143, entries: [
      { color: '#0a0b0c', kind: 'OBJECT', id: 'ai:sofa:1', roomId: living?.id ?? null, coverage: 0.017, box: [0.33, 0.48, 0.47, 0.6] },
      { color: '#0d0e0f', kind: 'FLOOR', id: 'ai:floor:1', roomId: living?.id ?? null, coverage: 0.07, box: [0.25, 0.4, 0.55, 0.7] },
    ] };
  };
  return page.route(/\/functions\/v1\/design-studio-reconstruct\/(design-spec|render-generate|render-generate-step)$/, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    const kind = route.request().url().split('/').pop();
    if (kind === 'design-spec') {
      // As generate.ts: the same key is the same job; it is written in the background (answered at once,
      // RUNNING), then DONE; with `then` (the confirmed quote) the server itself makes the design version
      // and the render — the page only follows.
      store.gen.specCalls += 1; store.gen.specBodies.push(body);
      let job = store.gen.specJobs.get(body.idempotencyKey);
      if (!job) {
        store.gen.specRuns += 1;
        job = { id: randomUUID(), user_id: 'hm1', project_id: body.projectId, kind: 'AI_DESIGN', status: 'RUNNING', input: { ...body }, output: null, ready: Date.now() + 1200 };
        store.db.ds_jobs.push(job); store.gen.specJobs.set(body.idempotencyKey, job);
        return json(route, { state: 'RUNNING', jobId: job.id }, 202);
      }
      if (job.status === 'RUNNING' && Date.now() < job.ready) return json(route, { state: 'RUNNING', jobId: job.id }, 202);
      const dna = {
        version: 'ds-dna-1', preferences: job.input.preferences, palette: ['#f2f0eb', '#c8a27a', '#2b2d30', '#9fae94'],
        finishes: { floor: { materialId: null, color: '#c8a27a' }, wetFloor: { materialId: null, color: '#d8d2c8' }, outdoorFloor: { materialId: null, color: '#d8d2c8' }, walls: { materialId: null, color: '#f2f0eb' }, accentWall: null, ceiling: { color: '#f5f2ed' }, cabinetry: { color: '#c8a27a', materialId: null }, metal: '#2b2d30' },
        lighting: { timeOfDay: 'DAY', temperature: 'WARM', interior: 0.7 }, look: ['clean modern lines'], sourceJobId: job.id,
      };
      if (job.status === 'RUNNING') {
        const source = store.db.ds_spatial_sources.find((x) => x.id === store.db.ds_versions.find((v) => v.id === job.input.versionId)?.source_id);
        const keys = source?.kind === 'PHOTO_SET' ? (source.provenance.referenceIds ?? []).map((id) => store.db.ds_floorplans.find((f) => f.id === id)?.object_key) : [];
        const u = source?.canonical?.understanding;
        const room = u?.rooms?.find((r) => r.id === (job.input.mode === 'ROOM' ? job.input.roomId : u.heroRoomId)) ?? u?.rooms?.[0];
        const sourceKey = source?.kind === 'PHOTO_SET' ? keys[room?.primaryPhoto ?? 0] : store.db.ds_floorplans.find((f) => f.id === source?.floorplan_id)?.object_key;
        Object.assign(job, { status: 'SUCCEEDED', output: { kind: 'DESIGN_SPEC', mode: job.input.mode, look: job.input.look, dna, sourceKey, room: job.input.roomId ? { id: job.input.roomId } : null, chain: {} } });
      }
      const chain = job.output.chain;
      if (job.input.then && !chain.versionId) {
        const base = store.db.ds_versions.find((v) => v.id === job.input.versionId);
        if (job.input.mode === 'ROOM') chain.versionId = base.id;
        else {
          const v = { id: randomUUID(), project_id: base.project_id, user_id: 'hm1', source_id: base.source_id, parent_id: base.id, name: job.input.then.versionName, origin: 'AI', job_id: job.id,
            state: base.state ?? {}, style_tags: [], change_summary: [{ kind: 'AI_DESIGN_SPEC', generator: 'OPENAI_FIRST', jobId: job.id, mode: job.input.mode }], design_dna: dna, revision: 0,
            archived_at: null, thumbnail_key: null, created_at: now(), updated_at: now() };
          store.db.ds_versions.push(v);
          store.db.ds_projects.find((p) => p.id === base.project_id).head_version_id = v.id;
          chain.versionId = v.id;
        }
      }
      if (job.input.then && !chain.renderId) {
        const roomId = job.input.mode === 'ROOM' ? job.input.roomId : null;
        const row = {
          id: randomUUID(), project_id: job.project_id, user_id: 'hm1', version_id: chain.versionId, kind: roomId ? 'ROOM' : 'MASTER', parent_id: job.input.parentRenderId ?? null,
          view: { id: roomId ? `room-${roomId}` : 'master', kind: roomId ? 'ROOM' : 'MASTER', purpose: roomId ? 'MAIN' : 'DOLLHOUSE', roomId, generator: 'OPENAI', mode: job.input.mode },
          status: 'QUEUED', factory_job_id: null, base_key: null, map_key: null, final_key: null, legend: null,
          finish: { generator: 'OPENAI_FIRST', mode: job.input.mode, specJobId: job.id, sourceKey: job.output.sourceKey, roomId, look: job.input.look, provider: 'OPENAI', model: null, check: null }, edit: null,
          billing: { credits: 6, reservationId: null, state: 'NOT_CHARGED' }, error: null, idempotency_key: `chain-${job.id}`, created_at: now(), updated_at: now(),
        };
        store.db.ds_renders.push(row);
        chain.renderId = row.id;
      }
      return json(route, { state: 'DONE', jobId: job.id, mode: job.input.mode, dna, summary: { style: 'Clean modern lines', quality: 'Premium natural materials', palette: [], conflicts: 0 }, ...(job.input.then ? { chain } : {}) });
    }
    if (kind === 'render-generate') {
      store.gen.generateCalls += 1;
      let row = store.db.ds_renders.find((r) => r.idempotency_key === body.idempotencyKey);
      if (!row) {
        row = {
          id: randomUUID(), project_id: body.projectId, user_id: 'hm1', version_id: body.versionId, kind: 'MASTER', parent_id: null,
          view: { id: 'master', kind: 'MASTER', purpose: 'DOLLHOUSE', roomId: null, generator: 'OPENAI', mode: body.mode },
          status: 'QUEUED', factory_job_id: null, base_key: null, map_key: null, final_key: null, legend: null,
          finish: { generator: 'OPENAI_FIRST', mode: body.mode, specJobId: body.specJobId, provider: 'OPENAI', model: null, check: null }, edit: null,
          billing: { credits: 6, reservationId: null, state: 'NOT_CHARGED' }, error: null, idempotency_key: body.idempotencyKey, created_at: now(), updated_at: now(),
        };
        store.db.ds_renders.push(row);
      }
      return json(route, { render: row });
    }
    store.gen.stepCalls += 1;
    const rows = store.db.ds_renders.filter((r) => (body.renderIds ?? []).includes(r.id));
    for (const r of rows) {
      if (r.factory_job_id || r.finish?.generator !== 'OPENAI_FIRST') continue;
      // A scenario may make each step take real time (a picture takes minutes in production).
      if (store.gen.minStepMs && Date.now() - (r.stepAt ?? 0) < store.gen.minStepMs) continue;
      r.stepAt = Date.now();
      if (r.status === 'QUEUED') { r.status = 'RENDERING'; store.gen.imageCalls += 1; }
      else if (r.status === 'RENDERING') Object.assign(r, { status: 'FINISHING', final_key: 'users/hm1/qa/master.jpg' });
      else if (r.status === 'FINISHING') Object.assign(r, { status: 'READY', map_key: 'users/hm1/qa/master-ids.png', legend: legendFor(r.version_id), finish: { ...r.finish, model: 'gpt-image-2', editMap: { state: 'READY', entries: 2 } } });
      r.updated_at = now();
    }
    return json(route, { renders: rows });
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
  await wireGeneration(page, store);
  // The reading: the recorded model output through HOMATCH's real fusion.
  await page.route(/\/functions\/v1\/design-studio-reconstruct\/floorplan$/, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    const plan = store.db.ds_floorplans.find((f) => f.id === body.floorplanId);
    if (!plan || !store.objects.has(plan.object_key)) return route.fulfill({ status: 404, body: '{}' });
    const reply = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
    // As floorplan.ts: a reading in progress or done is answered, never started again.
    if (plan.status === 'INTERPRETED') return reply({ state: 'INTERPRETED' });
    if (plan.status === 'INTERPRETING') return reply({ state: 'RUNNING' }, 202);
    store.readCalls += 1;
    plan.status = 'INTERPRETING';
    setTimeout(async () => { Object.assign(plan, { status: 'INTERPRETED', interpretation: await goldenInterpretation(plan.object_key, reading) }); }, 1200);
    return reply({ state: 'RUNNING' }, 202);
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
    await page.getByTestId('ds-start-floorplan').click();
    await page.getByTestId('plan-to-home').waitFor({ timeout: 20000 });
    await page.getByTestId('simple-upload').waitFor({ timeout: 10000 });
    await page.waitForTimeout(300);
    await shot('upload');
    await noOverflow(tag, 'upload');
    check(`${tag}: the upload screen has no stepper`, (await page.locator('[aria-label] ol li[aria-current]').count()) === 0);
    const t0 = Date.now();
    await page.getByTestId('plan-file').setInputFiles(GOLDEN_JPG);
    await page.getByTestId('plan-ready').waitFor({ timeout: 10000 });
    await shot('plan-ready');
    await page.getByTestId('plan-upload-continue').click();
    await page.getByTestId('plan-reading').waitFor({ timeout: 15000 });
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

/** Generate from the Quality screen (or the detailed chooser), with a double tap and a reload mid-generation. */
async function generateAndResume(s, tag, generateId) {
  const { page, store } = s;
  await page.getByTestId(generateId).waitFor({ timeout: 10000 });
  for (let i = 0; i < 40 && !(await page.getByTestId(generateId).isEnabled()); i += 1) await page.waitForTimeout(150);
  await page.getByTestId(generateId).dblclick();
  await page.getByTestId('plan-generating').waitFor({ timeout: 15000 });
  for (let i = 0; i < 60 && !store.db.ds_renders.some((r) => r.status === 'RENDERING'); i += 1) await page.waitForTimeout(250);
  await s.shot('generating');
  await s.noOverflow(tag, 'generating');
  const shown = await page.getByTestId('generation-stages').locator('li[data-stage]').count();
  check(`${tag}: three customer stages, no percentage (${shown})`, shown === 3 && !/%/.test(await page.getByTestId('generation-stages').innerText()));
  const rowsBefore = store.db.ds_renders.length;
  await page.reload();
  await page.getByTestId('plan-generating').waitFor({ timeout: 20000 });
  check(`${tag}: a reload during generation resumes it`, true);
  await page.waitForURL(/\/home$/, { timeout: 120000 });
  const masters = store.db.ds_renders.filter((r) => r.view?.id === 'master');
  check(`${tag}: one Design Specification across the double tap and the reload (${store.gen.specRuns} run, ${store.gen.specCalls} asks)`, store.gen.specRuns === 1, String(store.gen.specRuns));
  check(`${tag}: ONE OpenAI picture across the double tap and the reload (${store.gen.imageCalls})`, store.gen.imageCalls === 1 && masters.length === 1 && rowsBefore === 1, `${rowsBefore} → ${masters.length}`);
  check(`${tag}: no factory, no Blender, no render-start, no legacy design intent (${store.factoryStarts}/${store.factoryPolls}/${store.renderCalls.start}/${store.aiRequests.length})`,
    store.factoryStarts === 0 && store.factoryPolls === 0 && store.renderCalls.start === 0 && store.aiRequests.length === 0);
  check(`${tag}: the master is OpenAI's own picture, without a factory job`, masters[0]?.factory_job_id === null && masters[0]?.finish?.generator === 'OPENAI_FIRST' && masters[0]?.status === 'READY');
  check(`${tag}: the AI design version stands on its specification job`, store.db.ds_versions.some((v) => v.origin === 'AI' && v.job_id === [...store.gen.specJobs.values()][0]?.id && (v.change_summary ?? []).some((c) => c.kind === 'AI_DESIGN_SPEC' && c.generator === 'OPENAI_FIRST')));
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
  check(`${tag}: four looks first (${cards})`, cards === 4, String(cards));
  await page.getByTestId('look-more').click();
  const all = await page.locator('[data-testid^="look-style-"]').count();
  check(`${tag}: "see more options" shows all six (${all})`, all === 6, String(all));
  check(`${tag}: Next waits for a style`, !(await page.getByTestId('look-next').isEnabled()));
  const small = await page.locator('[data-testid^="look-style-"], [data-testid="look-next"], [data-testid="look-more"], [data-testid="look-surprise"]').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 48).length);
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
  const specBody = store.gen.specBodies[0] ?? {};
  check(`${tag}: OpenAI's specification is asked with the customer's look and quality as direction (${JSON.stringify(specBody.look)})`,
    specBody.mode === 'MASTER' && specBody.look?.style === 'LUXURY' && specBody.look?.quality === 'PREMIUM' && /Premium: top-tier natural materials/.test(specBody.preferences?.brief ?? ''));
  check(`${tag}: flow recorded DONE with timings`, f?.step === 'DONE' && typeof f?.timings?.analysisMs === 'number');

  // ── The result: the unified Result of an OpenAI-first design; the edit pipeline exactly as before ──
  await page.getByTestId('design-home').waitFor({ timeout: 20000 });
  await page.getByTestId('render-viewer').waitFor({ timeout: 60000 });
  await page.waitForTimeout(800);
  await s.shot('home');
  await s.noOverflow(tag, 'the result');
  check(`${tag}: an OpenAI-first plan opens on the unified Result`, (await page.getByTestId('design-home').getAttribute('data-source')) === 'FLOOR_PLAN');
  check(`${tag}: no walkthrough offered until it is proven`, (await page.getByTestId('home-walk').count()) === 0 && (await page.getByTestId('home-walk-start').count()) === 0);
  check(`${tag}: the advanced editor is reachable`, await page.getByTestId('home-advanced').isVisible());
  const viewer = await page.getByTestId('home-render').boundingBox();
  check(`${tag}: the picture dominates (${Math.round(viewer.width)} of ${width})`, viewer.width >= width * (width < 600 ? 0.88 : 0.6), String(viewer.width));
  for (const id of ['home-variant', 'home-style', 'home-quality', 'home-compare', 'home-edit']) check(`${tag}: ${id} is offered`, await page.getByTestId(id).isVisible());
  // Before / after: the customer's plan against the design.
  await page.getByTestId('home-compare').click();
  await page.getByTestId('compare').waitFor({ timeout: 10000 });
  await s.shot('compare');
  await s.noOverflow(tag, 'before / after');
  await page.getByTestId('home-compare').click();
  // Edit: tap a piece in the picture.
  await page.getByTestId('home-edit').click();
  await page.getByTestId('edit-hint').waitFor({ timeout: 10000 });
  await page.waitForTimeout(1500); // the id map loads after the picture
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
  const edited = store.db.ds_renders.find((r) => r.kind === 'EDIT');
  check(`${tag}: the edit targets what OpenAI saw (${edited?.edit?.targetId} ${edited?.edit?.color} = ${colour})`,
    edited?.edit?.type === 'APPEARANCE' && edited.edit.targetId === 'ai:sofa:1' && edited.edit.targetKind === 'OBJECT' && !!colour && edited.edit.color === colour.toLowerCase() && edited.edit.label === 'sofa');
  check(`${tag}: the edit is a new version of the design, recorded`, (head()?.change_summary ?? []).some((c) => c.kind === 'RENDER_EDIT' && c.edit?.targetId === 'ai:sofa:1'));
  // Rooms: OpenAI pictures of this design's rooms (ROOM mode), never Blender views of an empty plan.
  check(`${tag}: the plan's other rooms are offered (${await page.getByTestId('room-card').count()})`, (await page.getByTestId('room-card').count()) > 0);
  check(`${tag}: still no factory pass, no render-start (${store.factoryStarts}/${store.renderCalls.start})`, store.factoryStarts === 0 && store.renderCalls.start === 0);

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

  await page.getByTestId('look-more').click();
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

/* ── Photos: the server's photo understanding (photos.ts), as the browser sees it ── */

/** What OpenAI's one reading of the photos says: two rooms (photos 0 and 2 are the same living room), one detail to ask. */
function photoUnderstanding(count) {
  const two = count >= 2;
  return {
    kind: 'PHOTO_UNDERSTANDING', version: 'photo-read-1', usable: true, unusable: null, propertyKind: 'APARTMENT', summary: 'qa', currentStyle: 'dated', light: 'BRIGHT',
    rooms: [
      { id: 'r1', kind: 'LIVING', label: 'Living room', photos: count >= 3 ? [0, 2] : [0], primaryPhoto: 0, fixed: ['two windows'], openings: [], condition: 'FURNISHED', confidence: 0.9 },
      ...(two ? [{ id: 'r2', kind: 'BEDROOM', label: 'Second room', photos: [1], primaryPhoto: 1, fixed: [], openings: [], condition: 'SHELL', confidence: 0.6 }] : []),
    ],
    photos: Array.from({ length: count }, (_, i) => ({ index: i, roomId: i === 1 && two ? 'r2' : 'r1', usable: true, unusable: null, view: '' })),
    questions: two ? [{ id: 'q1', kind: 'ROOM_PURPOSE', question: 'Is the second room a bedroom or a study?', options: [{ id: 'BEDROOM', label: 'Bedroom' }, { id: 'OFFICE', label: 'Study' }], suggested: 'BEDROOM', roomId: 'r2', photos: [1] }] : [],
    heroRoomId: 'r1',
  };
}

function wirePhotos(page, store) {
  store.photoAsks = 0;
  store.photoReads = 0;
  const now = () => new Date().toISOString();
  return page.route(/\/functions\/v1\/design-studio-reconstruct\/photos$/, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    const reply = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
    const recon = store.db.ds_reconstructions.find((r) => r.id === body.reconstructionId);
    if (!recon) return reply({ error: 'NOT_FOUND' }, 404);
    store.photoAsks += 1;
    // As photos.ts: understood → READ; in progress → RUNNING; a stored failure → as stored unless the customer retried.
    if ((recon.status === 'READ' || recon.status === 'BUILT') && recon.analysis?.kind === 'PHOTO_UNDERSTANDING') return reply({ state: 'READ', sourceId: recon.built_source_id, versionId: recon.built_version_id });
    if (recon.status === 'READING') return reply({ state: 'RUNNING' }, 202);
    if (recon.status === 'FAILED') {
      const [category, code] = String(recon.error).split(':');
      if (category === 'TERMINAL' || !body.retry) return reply({ state: 'FAILED', reason: code, retryable: category !== 'TERMINAL' });
    }
    store.photoReads += 1;
    Object.assign(recon, { status: 'READING', error: null, updated_at: now() });
    const attempt = store.photoReads;
    setTimeout(() => {
      if (store.photoFail && attempt === 1) {
        const error = { TERMINAL: 'TERMINAL:UNSUPPORTED_PHOTOS', FLOOR_PLAN: 'TERMINAL:IS_FLOOR_PLAN' }[store.photoFail] ?? 'RETRYABLE:READING_FAILED';
        Object.assign(recon, { status: 'FAILED', error, updated_at: now() });
        return;
      }
      const u = photoUnderstanding(recon.reference_ids.length);
      const source = {
        id: randomUUID(), project_id: recon.project_id, user_id: 'hm1', kind: 'PHOTO_SET', status: 'READY', geometry_state: 'ESTIMATED', editability: 'GENERATED',
        dev_unit_id: null, upstream: null, floorplan_id: recon.reference_ids[0], model_object_key: null, model_sha256: null, model_bytes: null, model_mime: null,
        canonical: { kind: 'PHOTO_SET', understanding: u }, calibration: null, generator_version: 'photo-read-1',
        provenance: { origin: 'CUSTOMER_PHOTOS', reconstructionId: recon.id, referenceIds: recon.reference_ids, generator: 'OPENAI_FIRST' }, failure: null, supersedes_id: null, created_at: now(),
      };
      store.db.ds_spatial_sources.push(source);
      const original = { id: randomUUID(), project_id: recon.project_id, user_id: 'hm1', source_id: source.id, parent_id: null, name: 'Original', origin: 'ORIGINAL', state: {}, state_schema: 1, revision: 0,
        style_tags: [], change_summary: [{ kind: 'PHOTOS_UNDERSTOOD' }], thumbnail_key: null, archived_at: null, design_dna: null, created_at: now(), updated_at: now() };
      store.db.ds_versions.push(original);
      Object.assign(store.db.ds_projects.find((p) => p.id === recon.project_id), { active_source_id: source.id, head_version_id: original.id });
      Object.assign(recon, { status: 'READ', analysis: u, model: 'qa', built_source_id: source.id, built_version_id: original.id, updated_at: now() });
    }, 1500);
    return reply({ state: 'RUNNING' }, 202);
  });
}

const photoFiles = (n) => {
  const body = readFileSync(path.join(FIXTURE, 'qa-master.jpg'));
  return Array.from({ length: n }, (_, i) => ({ name: `room-${i + 1}.jpg`, mimeType: 'image/jpeg', buffer: body }));
};

/* ── E: PHOTOS → the design, server-owned; Snake while it is made ── */
async function photoPath(browser, { width, height, lang, touch }) {
  const tag = `${width}-${lang} photos`;
  const s = await open(browser, { width, height, lang, touch, reading: 'v1' });
  const { page, store } = s;
  await wirePhotos(page, store);
  store.gen.minStepMs = 3500;
  const legacy = [];
  page.on('request', (r) => { if (/\/functions\/v1\/design-studio-reconstruct\/?$|\/(factory|factory-status|render-start|qa)$/.test(r.url().split('?')[0])) legacy.push(r.url()); });
  const shot = (name) => page.screenshot({ path: path.join(OUT, `ph-${name}-${width}-${lang}.png`) });
  const text = async () => page.locator('body').innerText();

  await page.goto(`${BASE}/design-studio`);
  await page.getByTestId('ds-landing').waitFor({ timeout: 20000 });
  await page.waitForTimeout(400);
  await shot('landing');
  await s.noOverflow(tag, 'the landing');
  const a = await page.getByTestId('ds-start-photos').boundingBox();
  const b = await page.getByTestId('ds-start-floorplan').boundingBox();
  // Side by side (and the same height) on a large screen; one above the other, the same width, on a phone.
  check(`${tag}: Photos and Floor plan are equal ways in (${Math.round(a.width)}x${Math.round(a.height)} / ${Math.round(b.width)}x${Math.round(b.height)})`, Math.abs(a.width - b.width) <= 2 && (width < 640 || Math.abs(a.height - b.height) <= 2));
  if (lang === 'ka') {
    const t = await text();
    for (const copy of ['ნახე შენი სივრცე ახალი დიზაინით', 'ფოტოების ატვირთვა', 'გეგმის ატვირთვა', 'ატვირთე არსებული სივრცის ფოტოები და ნახე როგორ შეიძლება შეიცვალოს მისი დიზაინი.']) check(`${tag}: landing copy "${copy}"`, t.includes(copy));
    check(`${tag}: no "reconstruction" framing on the landing`, !t.includes('სახლის აღდგენა სურათებიდან'));
  }
  await page.getByTestId('ds-start-photos').click();
  await page.getByTestId('photo-upload').waitFor({ timeout: 20000 });
  await page.waitForTimeout(300);
  await shot('upload');
  await s.noOverflow(tag, 'photo upload');
  if (lang === 'ka') {
    const t = await text();
    for (const copy of ['ატვირთე სივრცის ფოტოები', 'ფოტოების არჩევა', 'მაქსიმუმ 6 ფოტო · JPG, PNG ან WebP']) check(`${tag}: upload copy "${copy}"`, t.includes(copy));
  }
  await page.getByTestId('photo-file-first').setInputFiles(photoFiles(3));
  await page.getByTestId('photo-ready').waitFor({ timeout: 10000 });
  check(`${tag}: three photos to look over`, (await page.getByTestId('photo-grid').locator('img').count()) === 3);
  await page.getByTestId('photo-remove').last().click();
  check(`${tag}: a photo can be removed`, (await page.getByTestId('photo-grid').locator('img').count()) === 2);
  await page.getByTestId('photo-file').setInputFiles(photoFiles(1));
  check(`${tag}: and added again`, (await page.getByTestId('photo-grid').locator('img').count()) === 3);
  await page.waitForTimeout(300);
  await shot('ready');
  await s.noOverflow(tag, 'photos ready');
  if (lang === 'ka') check(`${tag}: ready copy`, (await text()).includes('ფოტოები მზადაა') && (await text()).includes('გაგრძელება') && (await text()).includes('ფოტოების შეცვლა'));
  await page.getByTestId('photo-continue').click();
  await page.getByTestId('plan-reading').waitFor({ timeout: 30000 });
  await shot('analysis');
  await s.noOverflow(tag, 'analysis');
  check(`${tag}: the analysis says the page may be left`, await page.getByTestId('leave-ok').isVisible());
  if (lang === 'ka') check(`${tag}: analysis copy`, (await text()).includes('ვაკვირდებით შენს სივრცეს') && (await text()).includes('შეგიძლია სხვა გვერდზე გადახვიდე. მუშაობა გაგრძელდება.'));
  const refs = store.db.ds_floorplans.filter((f) => f.purpose === 'REFERENCE').length;
  check(`${tag}: three photos uploaded once (${refs})`, refs === 3, String(refs));

  // Leave in the middle of the analysis: the reading carries on; back on the project, it resumes — never "could not read".
  const projectId = store.db.ds_projects[0].id;
  await page.goto(`${BASE}/design-studio`);
  await page.getByTestId('ds-landing').waitFor({ timeout: 20000 });
  await page.getByTestId('project-status').first().waitFor({ timeout: 10000 }).catch(() => {});
  await shot('library');
  const status = await page.getByTestId('project-status').first().getAttribute('data-status').catch(() => null);
  check(`${tag}: the library shows the project's server-side status (${status})`, ['WORKING', 'QUESTION'].includes(String(status)), String(status));
  await page.goto(`${BASE}/design-studio/${projectId}`);
  await page.getByTestId('quick-question').waitFor({ timeout: 30000 });
  check(`${tag}: left and resumed: ONE reading (${store.photoReads}), never a failure`, store.photoReads === 1 && (await page.getByTestId('ds-retry').count()) === 0, String(store.photoReads));
  await page.waitForTimeout(300);
  await shot('question');
  await s.noOverflow(tag, 'the detail');
  if (lang === 'ka') check(`${tag}: question copy`, (await text()).includes('ერთი დეტალი დაგვრჩა') && (await text()).includes('ეს დაგვეხმარება დიზაინი შენს სივრცეს უკეთ მოვარგოთ.'));
  await page.getByTestId('question-option-OFFICE').click();
  await page.getByTestId('question-continue').click();
  await page.getByTestId('look-style').waitFor({ timeout: 10000 });
  const recon = store.db.ds_reconstructions.at(-1);
  for (let i = 0; i < 40 && !(recon.corrections?.flow?.answers ?? []).length; i += 1) await page.waitForTimeout(150);
  check(`${tag}: the answer is kept on the project`, (recon.corrections?.flow?.answers ?? []).some((x) => x.questionId === 'q1' && x.value === 'OFFICE'));
  if (lang === 'ka') check(`${tag}: style copy`, (await text()).includes('როგორი სივრცე გინდა?') && (await text()).includes('სხვა ვარიანტების ნახვა') && (await text()).includes('გამაკვირვე') && (await text()).includes('შემდეგი'));
  await page.getByTestId('look-surprise').click();
  check(`${tag}: "surprise me" chooses a look`, (await page.locator('[data-testid^="look-style-"][aria-checked="true"]').count()) === 1);
  await page.getByTestId('look-style-LUXURY').click();
  await page.waitForTimeout(300);
  await shot('style');
  await s.noOverflow(tag, 'style');
  if (lang === 'ka') check(`${tag}: approved style names`, (await text()).includes('ლუქს') && (await text()).includes('თანამედროვე'));
  await page.getByTestId('look-next').click();
  await page.getByTestId('look-quality').waitFor({ timeout: 10000 });
  await page.getByTestId('look-price').getByText(/\d/).waitFor({ timeout: 10000 }).catch(() => {});
  await page.getByTestId('look-quality-PREMIUM').click();
  await page.waitForTimeout(300);
  await shot('quality');
  await s.noOverflow(tag, 'quality');
  if (lang === 'ka') check(`${tag}: quality copy`, (await text()).includes('აირჩიე შედეგის ხარისხი') && (await text()).includes('ჩემი დიზაინის შექმნა'));

  // Generate: a double tap is one run; a reload in the middle resumes it.
  for (let i = 0; i < 40 && !(await page.getByTestId('look-generate').isEnabled()); i += 1) await page.waitForTimeout(150);
  await page.getByTestId('look-generate').dblclick();
  await page.getByTestId('plan-generating').waitFor({ timeout: 15000 });
  for (let i = 0; i < 60 && !store.db.ds_renders.length; i += 1) await page.waitForTimeout(250);
  await page.reload();
  await page.getByTestId('plan-generating').waitFor({ timeout: 20000 });
  if (lang === 'ka') check(`${tag}: generation copy`, (await text()).includes('ვქმნით შენს ახალ სივრცეს') && (await text()).includes('შენი დიზაინი იქმნება'));
  await page.getByTestId('snake-offer').waitFor({ timeout: 15000 });
  await shot('generating');
  await s.noOverflow(tag, 'generating');
  await page.getByTestId('snake-play').click();
  await page.getByTestId('snake-game').waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
  await shot('snake');
  check(`${tag}: Snake shows the work's real stage, not a game timer`, /\S/.test(await page.getByTestId('snake-job').innerText()));
  if (touch) {
    const board = await page.getByTestId('snake-board').boundingBox();
    await page.mouse.move(board.x + board.width / 2, board.y + board.height / 2);
    await page.mouse.down(); await page.mouse.move(board.x + board.width / 2, board.y + board.height / 2 - 80); await page.mouse.up();
  } else {
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('KeyA');
  }
  await page.getByTestId('snake-ready-view').waitFor({ timeout: 90000 });
  await shot('snake-ready');
  if (lang === 'ka') check(`${tag}: ready copy above the game, which goes on`, (await page.getByTestId('snake-bar').innerText()).includes('შედეგი მზადაა') && (await page.getByTestId('snake-ready-view').innerText()).includes('შედეგის ნახვა'));
  check(`${tag}: ready never navigates away from the game by itself`, !/\/home$/.test(page.url()) && (await page.getByTestId('snake-board').count()) === 1);
  await page.getByTestId('snake-ready-view').click();
  await page.waitForURL(/\/home$/, { timeout: 20000 });

  // The Result.
  await page.getByTestId('design-home').waitFor({ timeout: 20000 });
  await page.getByTestId('render-viewer').waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  await shot('result');
  await s.noOverflow(tag, 'the result');
  check(`${tag}: a photo project's Result`, (await page.getByTestId('design-home').getAttribute('data-source')) === 'PHOTO');
  if (lang === 'ka') {
    const t = await text();
    for (const copy of ['ნახე შენი სივრცე ახალი დიზაინით', 'სხვა ვარიანტი', 'სტილის შეცვლა', 'ხარისხის შეცვლა', 'სხვა ოთახის შექმნა', 'რედაქტირება', 'სხვა ოთახები', 'ამ ოთახის შექმნა']) check(`${tag}: result copy "${copy}"`, t.includes(copy));
  }
  check(`${tag}: no advanced 3D editor on a photo project`, (await page.getByTestId('home-advanced').count()) === 0);
  const masters = store.db.ds_renders.filter((r) => r.view?.id === 'master');
  check(`${tag}: ONE reading, ONE specification, ONE picture across the double tap and the reload (${store.photoReads}/${store.gen.specRuns}/${store.gen.imageCalls}/${masters.length})`,
    store.photoReads === 1 && store.gen.specRuns === 1 && store.gen.imageCalls === 1 && masters.length === 1);
  check(`${tag}: the master is drawn over the customer's own photo of the hero room`, masters[0]?.finish?.sourceKey === store.db.ds_floorplans.find((f) => f.id === recon.reference_ids[0])?.object_key);
  check(`${tag}: no reconstruction, factory or render-start request (${legacy.length})`, legacy.length === 0, legacy.join(' '));

  await page.getByTestId('home-compare').click();
  await page.getByTestId('compare').waitFor({ timeout: 10000 });
  await shot('compare');
  if (lang === 'ka') check(`${tag}: before / after labels`, (await page.getByTestId('compare').innerText()).includes('მანამდე') && (await page.getByTestId('compare').innerText()).includes('ახალი დიზაინი'));
  await page.getByTestId('home-compare').click();

  // Another room: its own photo, the same design identity; priced, confirmed, server-owned.
  check(`${tag}: the other room is offered`, (await page.getByTestId('room-card').count()) === 1);
  await page.getByTestId('room-create').click();
  await page.getByTestId('home-sheet').waitFor({ timeout: 10000 });
  await shot('room-sheet');
  await page.getByTestId('room-same-style').click();
  await page.getByTestId('confirm-price').waitFor({ timeout: 10000 });
  await page.getByTestId('confirm-run').click();
  await page.getByTestId('room-view').waitFor({ timeout: 60000 });
  const room = store.db.ds_renders.find((r) => r.view?.kind === 'ROOM');
  check(`${tag}: the room is drawn over its own photo (${room?.view?.roomId})`, room?.view?.roomId === 'r2' && room.finish?.sourceKey === store.db.ds_floorplans.find((f) => f.id === recon.reference_ids[1])?.object_key);
  // Another option of the same design.
  await page.getByTestId('home-variant').click();
  await page.getByTestId('confirm-price').waitFor({ timeout: 10000 });
  if (lang === 'ka') check(`${tag}: variant copy`, (await page.locator('[role="dialog"]').innerText()).includes('შევინარჩუნებთ შენს სივრცეს, სტილს და ხარისხს, დიზაინის დეტალებს კი თავიდან შევქმნით.'));
  await page.getByTestId('confirm-run').click();
  await page.getByTestId('home-variants').waitFor({ timeout: 60000 });
  await page.waitForTimeout(500);
  await shot('variants');
  await s.noOverflow(tag, 'the result with options');
  check(`${tag}: one specification per design: master, room, option (${store.gen.specRuns})`, store.gen.specRuns === 3, String(store.gen.specRuns));
  check(`${tag}: no page errors`, s.errors.length === 0, s.errors.join('\n        '));
  await s.ctx.close();
}

/* ── G: an ordinary black-and-white 2D floor plan (labels, dimensions) sent through PHOTOS — production 2026-10-03.
   The photo reading says "this is a floor plan"; the same file continues as the project's floor plan, is read by
   the floor-plan reading and reaches Style. It is never answered "try a clearer photo or plan". ── */
async function planThroughPhotos(browser, { width, height, lang, touch }) {
  const tag = `${width}-${lang} plan-through-photos`;
  const s = await open(browser, { width, height, lang, touch, reading: 'v1' });
  const { page, store } = s;
  store.photoFail = 'FLOOR_PLAN';
  await wirePhotos(page, store);
  await page.goto(`${BASE}/design-studio`);
  await page.getByTestId('ds-start-photos').click();
  await page.getByTestId('photo-file-first').setInputFiles(GOLDEN_JPG);
  await page.getByTestId('photo-continue').click();
  await page.getByTestId('plan-to-home').waitFor({ timeout: 40000 });
  const reached = await untilStep(page, ['STYLE', 'QUICK', 'REVIEW'], 40000);
  check(`${tag}: the plan went on to the floor-plan reading and reached ${reached}`, reached === 'STYLE', String(reached));
  check(`${tag}: never "a clearer photo or plan"`, (await page.getByTestId('ds-unsupported').count()) === 0);
  const plans = store.db.ds_floorplans.filter((f) => f.purpose === 'PLAN');
  const refs = store.db.ds_floorplans.filter((f) => f.purpose === 'REFERENCE');
  check(`${tag}: the same uploaded file became the plan (no second upload)`, plans.length === 1 && refs.length === 1 && plans[0].object_key === refs[0].object_key);
  check(`${tag}: read once as a plan (${store.readCalls}), once as photos (${store.photoReads})`, store.readCalls === 1 && store.photoReads === 1);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `ph-plan-through-photos-${width}-${lang}.png`) });
  check(`${tag}: no page errors`, s.errors.length === 0, s.errors.join('\n        '));
  await s.ctx.close();
}

/* ── F: photos that fail — retry without uploading again; unusable photos ask for another file ── */
async function photoFailures(browser, { width, height, lang, touch }) {
  for (const kind of ['RETRYABLE', 'TERMINAL']) {
    const tag = `${width}-${lang} photo-failure-${kind.toLowerCase()}`;
    const s = await open(browser, { width, height, lang, touch, reading: 'v1' });
    const { page, store } = s;
    store.photoFail = kind;
    await wirePhotos(page, store);
    await page.goto(`${BASE}/design-studio`);
    await page.getByTestId('ds-start-photos').click();
    await page.getByTestId('photo-file-first').setInputFiles(photoFiles(1));
    await page.getByTestId('photo-continue').click();
    if (kind === 'RETRYABLE') {
      await page.getByTestId('ds-retry').waitFor({ timeout: 30000 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, `ph-retry-${width}-${lang}.png`) });
      await s.noOverflow(tag, 'retry');
      check(`${tag}: a reading that failed says so truthfully (not "could not read")`, await page.getByTestId('plan-retry').isVisible() && await page.getByTestId('retry-later').isVisible());
      check(`${tag}: the recovery shows the real state: photos kept, the reading continues`, (await page.locator('[data-step="UPLOAD"][data-state="KEPT"]').count()) === 1 && (await page.locator('[data-step="ANALYSIS"][data-state="RESUME"]').count()) === 1);
      await page.getByTestId('plan-retry').click();
      await page.getByTestId('look-style').waitFor({ timeout: 30000 });
      const refs = store.db.ds_floorplans.filter((f) => f.purpose === 'REFERENCE').length;
      check(`${tag}: "try again" read again without uploading again (${store.photoReads} reads, ${refs} upload)`, store.photoReads === 2 && refs === 1);
    } else {
      await page.getByTestId('ds-unsupported').waitFor({ timeout: 30000 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, `ph-unsupported-${width}-${lang}.png`) });
      await s.noOverflow(tag, 'unsupported');
      check(`${tag}: unusable photos ask for another file, not a retry`, (await page.getByTestId('plan-retry').count()) === 0);
      await page.getByTestId('choose-another').click();
      await page.getByTestId('photo-upload').waitFor({ timeout: 10000 });
    }
    check(`${tag}: right-to-left where it should be`, lang !== 'he' || (await page.evaluate(() => document.documentElement.dir)) === 'rtl');
    check(`${tag}: no page errors`, s.errors.length === 0, s.errors.join('\n        '));
    await s.ctx.close();
  }
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
    if (!only || only === 'E') {
      await photoPath(browser, { width: 390, height: 844, lang: 'ka', touch: true });
      await photoPath(browser, { width: 1440, height: 900, lang: 'en', touch: false });
    }
    if (!only || only === 'G') {
      await planThroughPhotos(browser, { width: 390, height: 844, lang: 'ka', touch: true });
      await planThroughPhotos(browser, { width: 1440, height: 900, lang: 'en', touch: false });
    }
    if (!only || only === 'F') {
      await photoFailures(browser, { width: 390, height: 844, lang: 'en', touch: true });
      await photoFailures(browser, { width: 390, height: 844, lang: 'he', touch: true });
    }
  } finally {
    await browser.close().catch(() => {});
    server.kill();
  }
  console.log(`screenshots: ${OUT}`);
  if (failed) process.exit(1);
}

await main();
