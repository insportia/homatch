// HOMATCH DESIGN STUDIO — the catalogue import pipeline, provider-agnostic.
//
//   Provider adapter → Discovery → Classification → Licence validation →
//   Canonical identity → Queue → Download → Validate → Optimise → Upload →
//   Index → READY
//
// Every side effect goes through `io` (database, object store, provider
// fetches, local files, optimisation tools), so the whole state machine is
// tested with in-memory fakes and run for real by scripts/design-studio/
// catalog-import.mjs. Nothing here knows a provider: adapters do.
//
// Guarantees:
// - Resumable: work is claimed with a lease; an interrupted asset is taken
//   again when its lease expires, and every object already stored intact
//   (same md5 and size) is skipped, never re-uploaded.
// - Idempotent: identity is deterministic, objects live under their version,
//   rows are upserted by identity — a second run changes nothing.
// - Bounded: attempts per asset are capped; the last error and its stage are
//   kept, with an audit event for every claim, retry, failure and completion.
// - One asset never stops the rest.
// - Licensed: UNKNOWN or stopped licences end EXCLUDED with the reason; an
//   object is filed under the delivery class its licence allows.

import {
  type AssetKind, type AssetPlan, type License, type PlannedFile, type ProviderAdapter,
  colorFamily, deliveryFor, inspectGltf, licenseRefusal, looksLike, materialPbr, MATERIAL_FAMILY, modelPlacement, normalizeName,
  objectKey, rowUuid, uniqueNames, versionId, homatchAssetId,
} from './catalogSource.ts';

export interface ImportRow {
  homatch_asset_id: string;
  source_provider: string;
  source_asset_id: string;
  kind: AssetKind;
  canonical_category: string;
  canonical_subcategory: string;
  display_name: string;
  source_asset: any;
  policy: string;
  state: string;
  attempts: number;
  max_attempts: number;
  license_class: string;
  quality_tier?: string | null;
  quality_score?: number | null;
  web_suitability?: number | null;
  detail: Record<string, unknown>;
}

export interface StoredObject {
  key: string; variant: 'SOURCE' | 'OPTIMIZED'; role: PlannedFile['role']; resolution: PlannedFile['resolution']; relPath: string;
  contentType: string; delivery: PlannedFile['delivery']; sourceUrl: string | null; bytes: number; md5: string; sha256: string; file: string;
}

export interface OptimizedFile { role: PlannedFile['role']; resolution: PlannedFile['resolution']; relPath: string; file: string; contentType: string }

export interface PipelineIO {
  runId: string;
  adapters: Record<string, ProviderAdapter<any>>;
  fetchJson(url: string): Promise<any>;
  /** A provider download URL that needs the provider's credential → a fetchable URL (signed by Supabase). Identity otherwise. */
  resolveDownload(provider: string, url: string): Promise<string>;
  /** Download to a local file, returning exact size and digests. */
  download(url: string, dest: string): Promise<{ bytes: number; md5: string; sha256: string }>;
  readHead(file: string, n: number): Uint8Array;
  readText(file: string): string;
  writeText(file: string, text: string): { bytes: number; md5: string; sha256: string };
  digest(file: string): { bytes: number; md5: string; sha256: string };
  tempDir(): string;
  removeDir(dir: string): void;
  join(...parts: string[]): string;
  /** Khronos validation of a glTF/GLB file: error count (null when the validator is unavailable). */
  validateGltf(file: string): Promise<{ errors: number; warnings: number } | null>;
  /** Parse a GLB's JSON chunk (or a .gltf's text). */
  gltfJson(file: string): any;
  optimize(kind: AssetKind, plan: AssetPlan, dir: string, sourceAssetId: string): Promise<{ state: string; note?: string; files: OptimizedFile[] }>;
  /** R2: which of these keys already hold these exact bytes. */
  existing(objects: StoredObject[]): Promise<Set<string>>;
  put(objects: StoredObject[]): Promise<void>;
  db: {
    claim(owner: string, limit: number): Promise<ImportRow[]>;
    patchImport(hma: string, patch: Record<string, unknown>): Promise<void>;
    event(hma: string, stage: string, event: string, extra?: { attempt?: number; error?: string; detail?: unknown }): Promise<void>;
    upsert(table: string, rows: Record<string, unknown>[], onConflict: string): Promise<void>;
    names(): Promise<Array<{ homatch_asset_id: string; source_provider: string; kind: AssetKind; display_name: string }>>;
    existingStates(provider: string): Promise<Map<string, string>>;
  };
  now(): string;
}

/** Errors can carry a URL (a signed one is a capability): keep the host only. */
export const scrub = (msg: unknown) => String(msg ?? '').replace(/https?:\/\/([^/\s?]+)[^\s]*/g, 'https://$1/…').slice(0, 600);

// ── Discovery ───────────────────────────────────────────────────────────

/**
 * List a provider, classify, check the licence, assess, name — and record
 * what was found. Discovery never queues anything: DISCOVERED rows wait for
 * an explicit enqueue; refused ones are EXCLUDED with their reason. Names are
 * unique across the WHOLE catalogue (names other providers hold are reserved).
 */
export async function discover(io: PipelineIO, provider: string, assess?: (asset: any) => { tier: string; score: number; webSuitability: number; reasons: string[] }) {
  const adapter = io.adapters[provider];
  if (!adapter) throw new Error(`no adapter for ${provider}`);
  const found = await adapter.discover((u) => io.fetchJson(u));
  const rows = [];
  for (const f of found) {
    const hma = await homatchAssetId(adapter.provider, f.kind, f.sourceAssetId);
    const license = adapter.license(f.asset);
    const q = assess ? assess(f.asset) : null;
    const plan = adapter.plan(f.kind, f.sourceAssetId, f.asset, {}, f.canonical);
    const refusal = licenseRefusal(license) ?? (q?.tier === 'REJECT' ? `quality: ${q.reasons.join('; ')}` : null) ?? (plan.refusal && !/^no \d+k/.test(plan.refusal) ? plan.refusal : null);
    rows.push({ hma, f, license, q, refusal });
  }
  const others = (await io.db.names()).filter((n) => n.source_provider !== provider).map((n) => ({ kind: n.kind, name: n.display_name }));
  const names = uniqueNames(rows.map((r) => ({ assetId: r.hma, kind: r.f.kind, displayName: r.f.naming.displayName, qualifiers: r.f.naming.qualifiers })), others);
  const states = await io.db.existingStates(provider);
  const payload = rows.map((r) => ({
    homatch_asset_id: r.hma, source_provider: adapter.provider, source_asset_id: r.f.sourceAssetId, kind: r.f.kind,
    canonical_category: r.f.canonical.canonicalCategory, canonical_subcategory: r.f.canonical.canonicalSubcategory, display_name: names.get(r.hma),
    source_asset: r.f.asset, policy: adapter.policy, license_class: r.license.licenseClass, license: r.license,
    quality_tier: r.q?.tier ?? null, quality_score: r.q?.score ?? null, web_suitability: r.q?.webSuitability ?? null,
    // A row already in the pipeline keeps its state; a new one is DISCOVERED or EXCLUDED — never QUEUED.
    ...(states.has(r.hma) ? {} : { state: r.refusal ? 'EXCLUDED' : 'DISCOVERED' }),
    ...(r.refusal ? { detail: { excluded: r.refusal } } : {}),
    updated_at: io.now(),
  }));
  for (let i = 0; i < payload.length; i += 200) await io.db.upsert('ds_catalog_imports', payload.slice(i, i + 200), 'homatch_asset_id');
  return { found: rows.length, excluded: rows.filter((r) => r.refusal).length, newRows: rows.filter((r) => !states.has(r.hma)).length };
}

// ── One asset through the pipeline ──────────────────────────────────────

export type Outcome = 'READY' | 'RETRY' | 'FAILED' | 'EXCLUDED';

export async function processAsset(io: PipelineIO, row: ImportRow): Promise<Outcome> {
  const hma = row.homatch_asset_id;
  const adapter = io.adapters[row.source_provider];
  const dir = io.tempDir();
  let stage = 'DOWNLOADING';
  const setState = async (state: string, extra: Record<string, unknown> = {}) => {
    stage = state;
    await io.db.patchImport(hma, { state, updated_at: io.now(), ...extra });
  };
  const exclude = async (reason: string) => {
    await setState('EXCLUDED', { detail: { ...row.detail, excluded: reason }, lease_owner: null, lease_until: null, finished_at: io.now() });
    await io.db.event(hma, stage, 'EXCLUDED', { error: reason });
    return 'EXCLUDED' as const;
  };
  try {
    if (!adapter) throw new Error(`no adapter for provider ${row.source_provider}`);
    await io.db.event(hma, stage, 'CLAIMED', { attempt: row.attempts });
    const c = { canonicalCategory: row.canonical_category, canonicalSubcategory: row.canonical_subcategory };
    const cur = await adapter.current(row.source_asset_id, row.kind, (u) => io.fetchJson(u));

    // ── LICENCE VALIDATION: per asset, against the provider's CURRENT listing.
    const license: License = adapter.license(cur.asset);
    const refused = licenseRefusal(license);
    if (refused) return await exclude(refused);

    const plan = adapter.plan(row.kind, row.source_asset_id, cur.asset, cur.files, c);
    if (plan.refusal) return await exclude(plan.refusal);
    const version = await versionId(hma, cur.filesHash, adapter.policy);
    await setState('DOWNLOADING', {
      version_id: version, source_files_hash: cur.filesHash, planned_files: plan.files.length, planned_bytes: plan.bytes,
      license_class: license.licenseClass, license,
    });

    // ── DOWNLOADING: exact size (and md5 where the provider gives one) must match.
    const got = new Map<string, { bytes: number; md5: string; sha256: string }>();
    for (const f of plan.files.filter((x) => x.sourceUrl)) {
      const url = await io.resolveDownload(adapter.provider, f.sourceUrl as string);
      const d = await io.download(url, io.join(dir, 'source', f.relPath));
      if (f.bytes && d.bytes !== f.bytes) throw new Error(`size ${d.bytes} ≠ provider ${f.bytes} for ${f.relPath}`);
      if (f.md5 && d.md5 !== f.md5) throw new Error(`md5 mismatch for ${f.relPath}`);
      got.set(f.relPath, d);
    }

    // ── VALIDATING: every file is what its role says; a model is whole, sized, self-contained and passes Khronos.
    await setState('VALIDATING');
    for (const f of plan.files.filter((x) => x.sourceUrl)) {
      if (!looksLike(f.role, io.readHead(io.join(dir, 'source', f.relPath), 16))) throw new Error(`${f.role} is not what it claims: ${f.relPath}`);
    }
    let facts: ReturnType<typeof inspectGltf> | null = null;
    if (row.kind === 'MODEL') {
      const model = plan.files.find((f) => f.role === 'GLB' || (f.role === 'GLTF' && f.resolution === '1k'));
      if (!model) throw new Error('no model file in the plan');
      const file = io.join(dir, 'source', model.relPath);
      facts = inspectGltf(io.gltfJson(file));
      const embedded = model.role === 'GLB';
      if (facts.problems.length) throw new Error(`model: ${facts.problems.join('; ')}`);
      const missing = embedded ? facts.uris : facts.uris.filter((u) => !got.has(u));
      if (missing.length) throw new Error(`model references files that are not there: ${missing.slice(0, 5).join(', ')}`);
      if (!facts.sizeM || facts.sizeM.some((d) => !Number.isFinite(d)) || Math.max(...facts.sizeM) > 20 || facts.sizeM[1] > 10) throw new Error(`implausible size ${JSON.stringify(facts.sizeM)} m`);
      const v = await io.validateGltf(file);
      if (v && v.errors > 0) throw new Error(`model fails the Khronos validator (${v.errors} errors)`);
    }
    if (row.kind === 'MATERIAL') {
      for (const r of plan.resolutions) if (!plan.files.some((f) => f.role === 'BASE_COLOR' && f.resolution === r)) throw new Error(`no base colour at ${r}`);
    }

    // ── OPTIMIZING: validated variants beside the source, never instead of it.
    await setState('OPTIMIZING');
    let optimization: { state: string; note?: string; files: OptimizedFile[] };
    try { optimization = await io.optimize(row.kind, plan, dir, row.source_asset_id); } catch (e) { optimization = { state: 'FAILED', note: scrub((e as Error).message), files: [] }; }

    // ── UPLOADING: under the delivery class the licence allows; identical objects are skipped.
    await setState('UPLOADING');
    const metaFile = io.join(dir, 'source', 'source.json');
    const metadata = {
      homatchAssetId: hma, versionId: version, policy: adapter.policy, sourceProvider: adapter.provider, kind: row.kind, sourceAssetId: row.source_asset_id,
      sourceCategoryId: cur.categoryId, sourceCategoryPath: cur.categoryPath, sourceFilesHash: cur.filesHash, sourcePage: adapter.sourcePage(row.source_asset_id),
      license, name: row.display_name,
      files: plan.files.filter((f) => f.sourceUrl).map((f) => ({ relPath: f.relPath, role: f.role, resolution: f.resolution, bytes: got.get(f.relPath)?.bytes, md5: got.get(f.relPath)?.md5, sha256: got.get(f.relPath)?.sha256 })),
    };
    got.set('source.json', io.writeText(metaFile, `${JSON.stringify(metadata, null, 1)}\n`));
    const objects: StoredObject[] = [];
    for (const f of plan.files) {
      const d = got.get(f.relPath);
      if (!d) continue;
      objects.push({ key: objectKey(plan.kind, hma, version, f), variant: 'SOURCE', role: f.role, resolution: f.resolution, relPath: f.relPath, contentType: f.contentType, delivery: f.delivery, sourceUrl: f.sourceUrl?.split('?')[0] ?? null, file: io.join(dir, 'source', f.relPath), ...d });
    }
    const runtimeDelivery = deliveryFor(license, 'RUNTIME');
    for (const o of optimization.files) {
      const f = { role: o.role, relPath: o.relPath, delivery: runtimeDelivery };
      objects.push({ key: objectKey(plan.kind, hma, version, f, 'OPTIMIZED'), variant: 'OPTIMIZED', role: o.role, resolution: o.resolution, relPath: `optimized/${o.relPath}`, contentType: o.contentType, delivery: runtimeDelivery, sourceUrl: null, file: o.file, ...io.digest(o.file) });
    }
    const already = await io.existing(objects);
    const toPut = objects.filter((o) => !already.has(o.key));
    if (toPut.length) await io.put(toPut);
    if (already.size) await io.db.event(hma, 'UPLOADING', 'SKIPPED_IDENTICAL', { detail: { skipped: already.size } });

    // ── INDEXING: storage ledger, file registry, catalogue row.
    await setState('INDEXING');
    const entityId = await rowUuid(hma);
    await io.db.upsert('storage_objects', objects.map((o) => ({
      provider: 'R2', namespace: 'design-studio', category: `catalog-${o.delivery}`, object_key: o.key, owner_user_id: null, entity_type: 'ds_catalog', entity_id: entityId,
      purpose: `DS_CATALOG_${o.variant}`, original_filename: o.relPath.split('/').pop(), content_type: o.contentType, byte_size: o.bytes,
      checksum_md5: o.md5, checksum_sha256: o.sha256, visibility: o.delivery === 'public' ? 'PUBLIC' : o.delivery === 'licensed' ? 'AUTHENTICATED' : 'PRIVATE',
      lifecycle: 'ACTIVE', verified_at: io.now(), updated_at: io.now(),
    })), 'object_key');
    await io.db.upsert('ds_catalog_files', objects.map((o) => ({
      object_key: o.key, homatch_asset_id: hma, version_id: version, variant: o.variant, role: o.role, resolution: o.resolution, rel_path: o.relPath,
      delivery: o.delivery, bytes: o.bytes, md5: o.md5, sha256: o.sha256, content_type: o.contentType, source_url: o.sourceUrl,
    })), 'object_key');
    await indexCatalogRow(io, adapter, row, cur.asset, cur.filesHash, license, version, plan, objects, facts, optimization);

    const sourceBytes = objects.filter((o) => o.variant === 'SOURCE').reduce((s, o) => s + o.bytes, 0);
    const optimizedBytes = objects.filter((o) => o.variant === 'OPTIMIZED').reduce((s, o) => s + o.bytes, 0);
    await setState('READY', {
      source_bytes: sourceBytes, optimized_bytes: optimizedBytes, stored_bytes: toPut.reduce((s, o) => s + o.bytes, 0), files_uploaded: toPut.length,
      files_skipped: already.size, lease_owner: null, lease_until: null, finished_at: io.now(), last_error: null, last_error_stage: null,
      detail: { ...row.detail, optimization: { state: optimization.state, note: optimization.note ?? null } },
    });
    await io.db.event(hma, 'READY', 'READY', { detail: { objects: objects.length, uploaded: toPut.length, skipped: already.size, sourceBytes, optimizedBytes, optimization: optimization.state } });
    return 'READY';
  } catch (e) {
    const message = scrub((e as Error)?.message ?? e);
    const final = row.attempts >= row.max_attempts;
    await io.db.patchImport(hma, {
      state: final ? 'FAILED' : 'QUEUED', last_error: message, last_error_stage: stage, lease_owner: null, lease_until: null, updated_at: io.now(),
      ...(final ? { finished_at: io.now() } : {}),
    }).catch(() => undefined);
    await io.db.event(hma, stage, final ? 'FAILED' : 'RETRY', { attempt: row.attempts, error: message }).catch(() => undefined);
    return final ? 'FAILED' : 'RETRY';
  } finally {
    io.removeDir(dir);
  }
}

const MODEL_FAMILY = (sub: string, category: string) => {
  const m: Record<string, string> = {
    SOFA: 'SOFA', SECTIONAL_SOFA: 'SOFA', ARMCHAIR: 'ARMCHAIR', BED: 'BED', HEADBOARD: 'BED', WARDROBE: 'WARDROBE', RUG: 'RUG', CURTAIN: 'TEXTILE', BLIND: 'TEXTILE',
    PILLOW: 'TEXTILE', THROW: 'TEXTILE', TOILET: 'BATHROOM', BIDET: 'BATHROOM', VANITY: 'BATHROOM', BATHTUB: 'BATHROOM', SHOWER: 'BATHROOM',
  };
  if (m[sub]) return m[sub];
  if (/CHAIR|STOOL|BENCH|OTTOMAN/.test(sub)) return 'CHAIR';
  if (/TABLE|DESK/.test(sub)) return 'TABLE';
  const fam = category.split('.').pop();
  return ({ STORAGE: 'STORAGE', KITCHEN: 'KITCHEN', APPLIANCE: 'KITCHEN', BATHROOM: 'BATHROOM', LIGHTING: 'LIGHTING', OUTDOOR: 'OUTDOOR', ARCHITECTURAL: 'OUTDOOR', SOFT_FURNISHING: 'TEXTILE', FURNITURE: 'STORAGE' } as Record<string, string>)[fam ?? ''] ?? 'DECOR';
};

async function indexCatalogRow(io: PipelineIO, adapter: ProviderAdapter<any>, row: ImportRow, asset: any, filesHash: string, license: License, version: string, plan: AssetPlan, objects: StoredObject[], facts: ReturnType<typeof inspectGltf> | null, optimization: { state: string; note?: string }) {
  const hma = row.homatch_asset_id;
  const c = { canonicalCategory: row.canonical_category, canonicalSubcategory: row.canonical_subcategory };
  const naming = adapter.name(row.kind, asset, c);
  const key = (pred: (o: StoredObject) => boolean) => objects.find(pred)?.key ?? null;
  const byRes = (variant: string, role: string, r: string | null) => key((o) => o.variant === variant && o.role === role && o.resolution === r);
  const families = [...new Set([...naming.colorTags, ...naming.materialTags].map(colorFamily).filter((x): x is NonNullable<ReturnType<typeof colorFamily>> => !!x))];
  const variants = {
    source: Object.fromEntries(objects.filter((o) => o.variant === 'SOURCE').map((o) => [o.relPath, { key: o.key, bytes: o.bytes, resolution: o.resolution, delivery: o.delivery }])),
    optimized: { state: optimization.state, note: optimization.note ?? null, files: Object.fromEntries(objects.filter((o) => o.variant === 'OPTIMIZED').map((o) => [o.relPath, { key: o.key, bytes: o.bytes, resolution: o.resolution, delivery: o.delivery }])) },
  };
  const identity = {
    id: await rowUuid(hma), code: hma, name: row.display_name, homatch_asset_id: hma, source_provider: adapter.provider, source_asset_id: row.source_asset_id,
    source_category_id: /^[0-9a-f-]{36}$/.test(String(asset?.category_id ?? '')) ? asset.category_id : null, source_category_path: asset?.category ?? null,
    source_files_hash: filesHash,
    canonical_category: c.canonicalCategory, canonical_subcategory: c.canonicalSubcategory, version_id: version,
    normalized_name: normalizeName(row.display_name), search_aliases: naming.aliases, quality_state: 'READY', active: false, license_class: license.licenseClass,
    color_families: families, updated_at: io.now(),
  };
  const licenseMeta = { ...license, sourcePage: adapter.sourcePage(row.source_asset_id), metadataKey: key((o) => o.role === 'METADATA') };
  const thumbnail = key((o) => o.role === 'THUMBNAIL');
  if (row.kind === 'MATERIAL') {
    const res = plan.resolutions;
    const mapsByRes = Object.fromEntries(res.map((r) => [r, { albedo: byRes('SOURCE', 'BASE_COLOR', r), normal: byRes('SOURCE', 'NORMAL', r), orm: byRes('SOURCE', 'ORM', r) }]));
    const ktx2ByRes = Object.fromEntries(res.map((r) => [r, { albedo: byRes('OPTIMIZED', 'BASE_COLOR', r), normal: byRes('OPTIMIZED', 'NORMAL', r), orm: byRes('OPTIMIZED', 'ORM', r) }]));
    await io.db.upsert('ds_catalog_materials', [{
      ...identity, category: MATERIAL_FAMILY[c.canonicalCategory] ?? 'WALL', applies_to: adapter.appliesTo?.(asset) ?? ['WALL', 'FLOOR', 'OBJECT'], style_tags: naming.styleTags,
      color_family: naming.colorTags[0] ?? null, color_tags: naming.colorTags, pbr: { ...materialPbr(adapter.physicalSizeMm?.(asset) ?? null, mapsByRes), ktx2ByRes },
      thumbnail_key: thumbnail, texture_bytes: objects.filter((o) => o.variant === 'SOURCE' && o.role !== 'THUMBNAIL' && o.role !== 'METADATA').reduce((s, o) => s + o.bytes, 0),
      provenance: 'LICENSED', is_placeholder: false, license: licenseMeta, catalog_meta: { variants, attributes: asset?.attributes ?? {} },
    }], 'id');
  } else if (row.kind === 'MODEL' && facts?.sizeM) {
    const size = facts.sizeM.map((d) => Math.max(0.001, d)) as [number, number, number];
    const place = modelPlacement(c, size);
    const glb = byRes('OPTIMIZED', 'GLB', null) ?? byRes('OPTIMIZED', 'GLB', '1k') ?? byRes('SOURCE', 'GLB', null) ?? byRes('SOURCE', 'GLTF', '1k');
    const lod = key((o) => o.variant === 'OPTIMIZED' && o.relPath.includes('.lod1.'));
    const provider = asset?.params ?? {};
    await io.db.upsert('ds_catalog_assets', [{
      ...identity, category: MODEL_FAMILY(c.canonicalSubcategory, c.canonicalCategory), subcategory: c.canonicalSubcategory, room_kinds: place.roomKinds,
      style_tags: naming.styleTags, color_tags: naming.colorTags, material_tags: naming.materialTags,
      width_m: size[0], height_m: size[1], depth_m: size[2], placement: place.placement, anchor: place.anchor, capabilities: place.capabilities,
      model_key: glb, model_bytes: objects.filter((o) => o.key === glb).reduce((s, o) => s + o.bytes, 0), triangles: facts.triangles,
      lods: [{ key: glb, triangles: facts.triangles, level: 0 }, ...(lod ? [{ key: lod, level: 1 }] : [])],
      thumbnail_key: thumbnail, provenance: 'LICENSED', is_placeholder: false, license: licenseMeta,
      quality_tier: row.quality_tier ?? null, quality_score: row.quality_score ?? null, web_suitability: row.web_suitability ?? null, color_families: families,
      catalog_meta: {
        variants, bbox: facts.bbox, sizeM: facts.sizeM, pivot: 'model origin (glTF), Y up, metres', orientation: '+Z front (glTF)',
        providerDimensionsM: [provider.dimensionX, provider.dimensionY, provider.dimensionZ].every(Number.isFinite) ? [provider.dimensionX, provider.dimensionY, provider.dimensionZ] : null,
        meshes: facts.meshes, materials: facts.materials, textures: facts.textures, animations: facts.animations,
        runtime: 'GLB (meshopt + KTX2 when optimised): MeshoptDecoder and KTX2Loader',
      },
    }], 'id');
  } else if (row.kind === 'ENVIRONMENT') {
    const cls = adapter.environmentClass?.(asset, c) ?? { lighting: 'DAY', context: 'OUTDOOR' };
    await io.db.upsert('ds_catalog_environments', [{
      ...identity, lighting_class: cls.lighting, context_class: cls.context, attributes: asset?.attributes ?? {}, thumbnail_key: thumbnail,
      texture_bytes: objects.filter((o) => o.role === 'HDRI').reduce((s, o) => s + o.bytes, 0), provenance: 'LICENSED', license: licenseMeta,
      catalog_meta: { variants, resolutions: Object.fromEntries(plan.resolutions.map((r) => [r, byRes('SOURCE', 'HDRI', r)])), mobile: '1k', desktop: '2k' },
    }], 'id');
  }
}

/** Work the queue until it is empty or the budget runs out. */
export async function work(io: PipelineIO, { budgetMs, concurrency }: { budgetMs: number; concurrency: number }) {
  const started = Date.now();
  const tally: Record<Outcome, number> = { READY: 0, RETRY: 0, FAILED: 0, EXCLUDED: 0 };
  while (Date.now() - started < budgetMs) {
    const batch = await io.db.claim(io.runId, concurrency);
    if (!batch.length) break;
    const results = await Promise.all(batch.map((row) => processAsset(io, row)));
    for (const r of results) tally[r] += 1;
  }
  return tally;
}
