// HOMATCH DESIGN STUDIO — the catalogue importer (every provider, one pipeline).
//
// The pipeline is src/lib/designStudio/catalogPipeline.ts (tested with fakes);
// this file wires it to real IO. It runs where it is explicitly started —
// the "Design Studio catalogue import" workflow (workflow_dispatch only) — and
// the bytes go provider → this runner → R2, never through Supabase and never
// through anybody's computer. R2 and Blendkit are reached through short-lived
// URLs that design-studio-model/catalog signs: neither credential is here.
//
//   discover --provider polyhaven|blendkit          list, classify, license, assess, name (never queues)
//   enqueue --provider P --ids a,b,c                queue named assets (the canary)
//   enqueue --provider P --all --owner-approved     queue every DISCOVERED asset (owner approval only)
//   run [--budget-min 300] [--concurrency 3]        work the queue until empty or out of time
//   report                                          counts and bytes from the database
//
// The workflow log is public: nothing here prints a URL, a key or a token.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { discover, scrub, work } from '../../src/lib/designStudio/catalogPipeline.ts';
import { glbRuntimeFacts, parseIds, RUNTIME_POLICY } from '../../src/lib/designStudio/catalogSource.ts';
import { polyhaven } from '../../src/lib/designStudio/catalogProviders/polyhaven.ts';
import { assess as assessBlendkit, blendkit } from '../../src/lib/designStudio/catalogProviders/blendkit.ts';

const exec = promisify(execFile);
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://ptxajsjhobhvsfhmutjn.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const RUN_ID = `gha-${process.env.GITHUB_RUN_ID ?? 'local'}-${process.pid}`;
const UA = 'HOMATCH-catalog-importer/1.0 (+https://homatch.live)';
const ADAPTERS = { polyhaven, blendkit };
const ASSESS = { blendkit: assessBlendkit };

const args = process.argv.slice(2);
const mode = args[0];
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const log = (...parts) => console.log(new Date().toISOString(), ...parts.map((p) => scrub(p)));

// ── Supabase (PostgREST, service role) ──────────────────────────────────

async function rest(pathAndQuery, { method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`db ${method} ${pathAndQuery.split('?')[0]}: ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function route(body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/design-studio-model/catalog`, {
    method: 'POST', headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`catalog route ${body.op}: ${res.status} ${j.error ?? ''}`);
  return j;
}

async function signR2(items) {
  const out = new Map();
  for (let i = 0; i < items.length; i += 200) {
    const j = await route({ op: 'sign', items: items.slice(i, i + 200) });
    for (const s of j.signed) out.set(`${s.method} ${s.key}`, s.url);
  }
  return out;
}

async function fetchJson(url) {
  for (let a = 1; ; a += 1) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) return res.json();
    if (a >= 4) throw new Error(`provider ${new URL(url).pathname}: ${res.status}`);
    await new Promise((r) => setTimeout(r, 1500 * a));
  }
}

// ── Tools ───────────────────────────────────────────────────────────────

const TOOLS = { toktx: false, gltfTransform: false, validator: null };
async function detectTools() {
  for (const [name, cmd] of [['toktx', 'toktx'], ['gltfTransform', 'gltf-transform']]) {
    try { await exec(cmd, ['--version'], { timeout: 20000 }); TOOLS[name] = true; } catch { TOOLS[name] = false; }
  }
  try { TOOLS.validator = createRequire(path.join(process.env.CATALOG_TOOLS_DIR ?? process.cwd(), 'noop.js'))('gltf-validator'); } catch { TOOLS.validator = null; }
  log(`tools: ${JSON.stringify({ toktx: TOOLS.toktx, gltfTransform: TOOLS.gltfTransform, validator: !!TOOLS.validator })}`);
}

const KTX2_MAGIC = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb]);

function gltfJson(file) {
  const b = fs.readFileSync(file);
  if (b.subarray(0, 4).toString('latin1') !== 'glTF') return JSON.parse(b.toString('utf8'));
  const len = b.readUInt32LE(12);
  if (b.subarray(16, 20).toString('latin1') !== 'JSON') throw new Error('GLB without a JSON chunk');
  return JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
}

async function validateGltf(file) {
  if (!TOOLS.validator) return null;
  const base = path.dirname(file);
  const report = await TOOLS.validator.validateBytes(new Uint8Array(fs.readFileSync(file)), {
    uri: path.basename(file), maxIssues: 100,
    externalResourceFunction: (uri) => Promise.resolve(new Uint8Array(fs.readFileSync(path.join(base, decodeURIComponent(uri))))),
  });
  return { errors: report?.issues?.numErrors ?? 0, warnings: report?.issues?.numWarnings ?? 0 };
}

/**
 * Optimised runtime variants, deterministic in their settings; quality first.
 * Texture maps → KTX2 UASTC (level 2, light RDO, zstd, mipmaps; colour sRGB,
 * data linear). Models → GLB with KTX2 textures and meshopt geometry (no
 * simplification), plus a simplified LOD1 for heavy models. HDRIs stay
 * Radiance .hdr (the runtime format). A variant exists only if it validates.
 */
async function optimize(kind, plan, dir, sourceAssetId) {
  const files = [];
  if (kind === 'ENVIRONMENT') return { state: 'NOT_APPLICABLE', note: 'Radiance .hdr is the runtime format (RGBELoader + PMREM)', files };
  if (!TOOLS.toktx) return { state: 'SKIPPED', note: 'toktx unavailable', files };
  const opt = path.join(dir, 'optimized');
  fs.mkdirSync(opt, { recursive: true });
  if (kind === 'MATERIAL') {
    for (const f of plan.files.filter((x) => ['BASE_COLOR', 'NORMAL', 'ORM'].includes(x.role))) {
      const rel = f.relPath.replace(/\.(jpe?g|png)$/i, '.ktx2');
      const dst = path.join(opt, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      await exec('toktx', ['--t2', '--encode', 'uastc', '--uastc_quality', '2', '--uastc_rdo_l', '0.5', '--zcmp', '18', '--genmipmap',
        '--assign_oetf', f.role === 'BASE_COLOR' ? 'srgb' : 'linear', dst, path.join(dir, 'source', f.relPath)], { timeout: 300000 });
      if (!fs.readFileSync(dst).subarray(0, 8).equals(KTX2_MAGIC)) throw new Error(`not KTX2: ${rel}`);
      files.push({ role: f.role, resolution: f.resolution, relPath: rel, file: dst, contentType: 'image/ktx2' });
    }
    return { state: 'DONE', files };
  }
  if (!TOOLS.gltfTransform) return { state: 'SKIPPED', note: 'gltf-transform unavailable', files };
  const model = plan.files.find((f) => f.role === 'GLB') ?? plan.files.find((f) => f.role === 'GLTF' && f.resolution === '1k');
  const src = path.join(dir, 'source', model.relPath);
  const gt = (args, timeout = 900000) => exec('gltf-transform', args, { timeout, maxBuffer: 16 * 1024 * 1024 });
  /**
   * One runtime level: textures capped (sharp resize), duplicates and unused
   * data removed, normal maps UASTC (detail matters), every other texture
   * ETC1S at the highest quality (colour, ORM, emission), geometry meshopt.
   */
  const level = async (input, out, edge, simplify) => {
    const t = (n) => path.join(opt, `${path.basename(out)}.${n}.glb`);
    let cur = input;
    if (simplify) { await gt(['simplify', cur, t('s'), '--ratio', '0.35', '--error', '0.0015']); cur = t('s'); }
    await gt(['resize', cur, t('r'), '--width', String(edge), '--height', String(edge)]); cur = t('r');
    await gt(['dedup', cur, t('d')]); cur = t('d');
    await gt(['prune', cur, t('p')]); cur = t('p');
    await gt(['uastc', cur, t('n'), '--slots', 'normalTexture', '--level', '2', '--rdo', '--rdo-lambda', '0.5', '--zstd', '18']); cur = t('n');
    await gt(['etc1s', cur, t('c'), '--quality', '255']); cur = t('c');
    await gt(['meshopt', cur, out]);
    for (const n of ['s', 'r', 'd', 'p', 'n', 'c']) fs.rmSync(t(n), { force: true });
    const v = await validateGltf(out);
    if (v && v.errors > 0) throw new Error(`runtime GLB fails the Khronos validator (${v.errors} errors)`);
    return runtimeFacts(out);
  };
  const tris = (() => { try { const j = gltfJson(src); return (j.meshes ?? []).flatMap((m) => m.primitives ?? []).reduce((s, p) => s + Math.floor(((j.accessors?.[p.indices ?? p.attributes?.POSITION]?.count) ?? 0) / 3), 0); } catch { return 0; } })();
  const main = path.join(opt, `${sourceAssetId}.glb`);
  const lod1 = path.join(opt, `${sourceAssetId}.lod1.glb`);
  const mainFacts = await level(src, main, RUNTIME_POLICY.maxTextureEdge, false);
  files.push({ role: 'GLB', resolution: null, relPath: `${sourceAssetId}.glb`, file: main, contentType: 'model/gltf-binary' });
  // The lighter level every asset gets for mobile and distance: 1K textures, and simplified geometry when it is heavy.
  const lodFacts = await level(src, lod1, RUNTIME_POLICY.lod1TextureEdge, tris > RUNTIME_POLICY.simplifyAboveTriangles);
  files.push({ role: 'GLB', resolution: null, relPath: `${sourceAssetId}.lod1.glb`, file: lod1, contentType: 'model/gltf-binary' });
  return { state: 'DONE', files, runtime: { main: { ...mainFacts, triangles: tris }, lod1: lodFacts } };
}

/** What a runtime GLB actually carries (catalogSource.glbRuntimeFacts, read from the file's bytes). */
const runtimeFacts = (file) => glbRuntimeFacts(new Uint8Array(fs.readFileSync(file)), path.basename(file));

// ── IO for the pipeline ─────────────────────────────────────────────────

const digestBuf = (b) => ({ bytes: b.length, md5: crypto.createHash('md5').update(b).digest('hex'), sha256: crypto.createHash('sha256').update(b).digest('hex') });

const io = {
  runId: RUN_ID,
  adapters: ADAPTERS,
  fetchJson,
  async resolveDownload(provider, url, homatchAssetId) {
    if (provider !== 'blendkit' || !/^https:\/\/www\.blendkit\.com\/api\/v1\/downloads\//.test(url)) return url;
    const j = await route({ op: 'provider-sign', provider: 'blendkit', homatchAssetId, downloads: [url] });
    const r = j.results?.[0];
    if (!r?.ok) throw new Error(`provider refused the download (${r?.status ?? '?'}${r?.reason ? `: ${r.reason}` : ''})`);
    return r.url;
  },
  async download(url, dest) {
    for (let a = 1; ; a += 1) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': UA } });
        if (!res.ok) throw new Error(`download ${res.status}`);
        const b = Buffer.from(await res.arrayBuffer());
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, b);
        return digestBuf(b);
      } catch (e) {
        if (a >= 3) throw e;
        await new Promise((r) => setTimeout(r, 2000 * a));
      }
    }
  },
  readHead: (file, n) => new Uint8Array(fs.readFileSync(file).subarray(0, n)),
  readText: (file) => fs.readFileSync(file, 'utf8'),
  writeText(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return digestBuf(Buffer.from(text)); },
  digest: (file) => digestBuf(fs.readFileSync(file)),
  tempDir: () => fs.mkdtempSync(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'dscat-')),
  removeDir: (dir) => fs.rmSync(dir, { recursive: true, force: true }),
  join: (...p) => path.join(...p),
  validateGltf,
  gltfJson,
  optimize,
  async existing(objects) {
    const heads = await signR2(objects.map((o) => ({ key: o.key, method: 'HEAD' })));
    const out = new Set();
    for (const o of objects) {
      const res = await fetch(heads.get(`HEAD ${o.key}`), { method: 'HEAD' });
      const etag = (res.headers.get('etag') ?? '').replace(/^W\//, '').replace(/"/g, '');
      if (res.ok && etag === o.md5 && Number(res.headers.get('content-length')) === o.bytes) out.add(o.key);
    }
    return out;
  },
  async put(objects) {
    const puts = await signR2(objects.map((o) => ({ key: o.key, method: 'PUT' })));
    for (const o of objects) {
      for (let a = 1; ; a += 1) {
        const res = await fetch(puts.get(`PUT ${o.key}`), { method: 'PUT', headers: { 'content-type': o.contentType, 'content-length': String(o.bytes) }, body: fs.readFileSync(o.file) });
        const etag = (res.headers.get('etag') ?? '').replace(/"/g, '');
        await res.arrayBuffer().catch(() => undefined);
        if (res.ok && etag === o.md5) break;
        if (a >= 3) throw new Error(`upload not confirmed (${res.status}) for ${o.relPath}`);
        await new Promise((r) => setTimeout(r, 2000 * a));
      }
    }
  },
  db: {
    claim: (owner, limit) => rest('rpc/ds_catalog_claim', { method: 'POST', body: { p_owner: owner, p_limit: limit, p_lease_seconds: 3600 } }),
    patchImport: (hma, patch) => rest(`ds_catalog_imports?homatch_asset_id=eq.${hma}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' }),
    event: (hma, stage, ev, extra = {}) => rest('ds_catalog_import_events', {
      method: 'POST', prefer: 'return=minimal',
      body: { homatch_asset_id: hma, run_id: RUN_ID, stage, event: ev, attempt: extra.attempt ?? null, error: extra.error ? scrub(extra.error) : null, detail: extra.detail ?? {} },
    }),
    upsert: (table, rows, onConflict) => rest(`${table}?on_conflict=${onConflict}`, { method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=minimal' }),
    names: () => rest('ds_catalog_imports?select=homatch_asset_id,source_provider,kind,display_name'),
    existingStates: async (provider) => new Map((await rest(`ds_catalog_imports?select=homatch_asset_id,state&source_provider=eq.${provider}`)).map((r) => [r.homatch_asset_id, r.state])),
  },
  now: () => new Date().toISOString(),
};

// ── Modes ───────────────────────────────────────────────────────────────

async function enqueue() {
  const provider = flag('provider', '');
  if (!ADAPTERS[provider]) throw new Error('enqueue needs --provider');
  const ids = flag('ids', '');
  if (ids) {
    const { ids: list, invalid } = parseIds(ids, ADAPTERS[provider].idPattern);
    if (invalid.length) throw new Error(`malformed ${provider} ids: ${invalid.join(', ')}`);
    const queued = await rest(`ds_catalog_imports?source_provider=eq.${provider}&source_asset_id=in.(${list.map((x) => `"${x}"`).join(',')})&state=in.(DISCOVERED,FAILED)&select=source_asset_id`, {
      method: 'PATCH', prefer: 'return=representation', body: { state: 'QUEUED', attempts: 0, last_error: null, last_error_stage: null, updated_at: io.now() },
    });
    const got = new Set((queued ?? []).map((r) => r.source_asset_id));
    log(`enqueue ${provider} (named): requested ${list.length}, queued ${got.size}, not queueable ${list.length - got.size}`);
    for (const id of list.filter((x) => !got.has(x))) log(`  not queued ${id}: not DISCOVERED/FAILED (missing, EXCLUDED, or already in the pipeline)`);
  } else if (args.includes('--all')) {
    // The whole selection only on the owner's explicit approval ("APPROVE FULL IMPORT").
    if (!args.includes('--owner-approved')) throw new Error('queuing everything needs --owner-approved');
    await rest(`ds_catalog_imports?source_provider=eq.${provider}&state=eq.DISCOVERED`, { method: 'PATCH', prefer: 'return=minimal', body: { state: 'QUEUED', updated_at: io.now() } });
    log(`enqueue ${provider}: every DISCOVERED asset`);
  } else throw new Error('enqueue needs --ids or --all --owner-approved');
}

/**
 * Publish NAMED assets to the editor: the catalogue row of each named asset
 * whose import is READY becomes active. Never a whole provider, never a row
 * that is not READY (READY already means: licensed for runtime delivery,
 * validated, optimised within budget, stored and indexed). Each activation is
 * audited as an import event.
 */
async function activate() {
  const provider = flag('provider', '');
  if (!ADAPTERS[provider]) throw new Error('activate needs --provider');
  const named = flag('ids', '');
  if (!named) throw new Error('activate needs --ids (named assets only)');
  const { ids, invalid } = parseIds(named, ADAPTERS[provider].idPattern);
  if (invalid.length) throw new Error(`malformed ${provider} ids: ${invalid.join(', ')}`);
  const rows = await rest(`ds_catalog_imports?source_provider=eq.${provider}&source_asset_id=in.(${ids.map((x) => `"${x}"`).join(',')})&select=homatch_asset_id,source_asset_id,kind,state`);
  const byId = new Map((rows ?? []).map((r) => [r.source_asset_id, r]));
  const TABLE = { MODEL: 'ds_catalog_assets', MATERIAL: 'ds_catalog_materials', ENVIRONMENT: 'ds_catalog_environments' };
  let activated = 0;
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) { log(`  not activated ${id}: not in the catalogue`); continue; }
    if (r.state !== 'READY') { log(`  not activated ${id}: import is ${r.state}, not READY`); continue; }
    const done = await rest(`${TABLE[r.kind]}?homatch_asset_id=eq.${r.homatch_asset_id}&quality_state=eq.READY&select=homatch_asset_id`, {
      method: 'PATCH', prefer: 'return=representation', body: { active: true, updated_at: io.now() },
    });
    if (!done?.length) { log(`  not activated ${id}: no READY catalogue row`); continue; }
    await io.db.event(r.homatch_asset_id, 'ACTIVE', 'STAGE', { detail: { activated: true } });
    activated += 1;
  }
  log(`activate ${provider} (named): requested ${ids.length}, activated ${activated}, refused ${ids.length - activated}`);
}

async function report() {
  const rows = await rest('ds_catalog_imports?select=source_provider,kind,state,license_class,quality_tier,source_bytes,optimized_bytes,stored_bytes,files_uploaded,files_skipped,planned_bytes');
  const by = {};
  for (const r of rows) {
    const k = `${r.source_provider}:${r.kind}:${r.state}`;
    by[k] ??= { assets: 0, sourceBytes: 0, optimizedBytes: 0, storedBytes: 0, filesUploaded: 0, filesSkipped: 0, plannedBytes: 0 };
    const b = by[k];
    b.assets += 1; b.sourceBytes += Number(r.source_bytes); b.optimizedBytes += Number(r.optimized_bytes); b.storedBytes += Number(r.stored_bytes);
    b.filesUploaded += r.files_uploaded; b.filesSkipped += r.files_skipped; b.plannedBytes += Number(r.planned_bytes ?? 0);
  }
  console.log(JSON.stringify(by, null, 1));
}

if (!SERVICE_KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY is required'); process.exit(2); }
if (mode === 'discover') {
  const provider = flag('provider', '');
  if (!ADAPTERS[provider]) { console.error('discover needs --provider polyhaven|blendkit'); process.exit(2); }
  const named = flag('ids', '');
  if (named) {
    // Bounded: only the named assets are looked up and recorded — never the provider's catalogue.
    const { ids, invalid } = parseIds(named, ADAPTERS[provider].idPattern);
    if (invalid.length) { console.error(`malformed ${provider} ids (nothing was looked up): ${invalid.join(', ')}`); process.exit(2); }
    const r = await discover(io, provider, ASSESS[provider], ids);
    log(`discover ${provider} (named): requested ${r.requested}, discovered ${r.found}, excluded ${r.excluded}, new ${r.newRows}, missing ${r.missing.length}`);
    for (const m of r.missing) log(`  missing ${m.id}: ${m.reason}`);
    if (r.missing.length) process.exit(3);
  } else if (args.includes('--all')) {
    log(`discover ${provider} (whole provider): ${JSON.stringify(await discover(io, provider, ASSESS[provider]))}`);
  } else { console.error('discover needs --ids a,b,c (named assets) or --all (the whole provider)'); process.exit(2); }
} else if (mode === 'enqueue') await enqueue();
else if (mode === 'run') {
  await detectTools();
  log(`run: ${JSON.stringify(await work(io, { budgetMs: Number(flag('budget-min', '300')) * 60000, concurrency: Math.max(1, Math.min(6, Number(flag('concurrency', '3')))) }))}`);
} else if (mode === 'activate') await activate();
else if (mode === 'report') await report();
else { console.error('usage: discover | enqueue | run | report'); process.exit(2); }
