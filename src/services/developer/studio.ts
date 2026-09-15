// HOMATCH PROJECT STUDIO — the internal side of the Digital Twin.
//
// THE BOUNDARY THIS FILE SITS ON
//
// There are two editing levels in this product and they are not the same
// screen with different buttons greyed out. A DEVELOPER maintains business
// data: price, status, availability, description, photographs. HOMATCH STUDIO
// STAFF build the 3D: geometry, scenes, templates, hotspots, cameras, and the
// decision to publish.
//
// Every function here refuses a caller who is not studio staff, in SQL, with
// 42501 — and the RLS policies under dt_scenes, dt_scene_versions, dt_assets
// and dt_templates refuse them a second time. The `isStudio` flag in the
// workspace context decides only whether the interface OFFERS any of this; it
// enforces nothing, and if the two ever disagree the database wins.
//
// WHAT THE STUDIO CAN AND CANNOT SEE. dt_studio_project returns the
// geometry-relevant shape of a development: buildings, floor levels, unit
// types, unit numbers. It returns no price, no buyer, no lead and no payment.
// A 3D artist has no business knowing what floor eleven costs, and the answer
// is not filtered out in this file — it is absent from the SELECT list in the
// database.

import { supabase, rpc, runList } from './client';
import type { TwinAsset, TwinTemplate, SceneKind, TwinStatus } from './twin';

// ── What the studio sees ───────────────────────────────────────────────────

export interface StudioProjectSummary {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  construction_status: string;
  is_published: boolean;
  workspace_id: string;
  workspace_name: string;
  workspace_slug: string;
  buildings: number;
  units: number;
  unit_types: number;
  scenes: number;
  published_scenes: number;
  experience_status: TwinStatus | null;
}

export interface StudioBuilding {
  id: string;
  name: string;
  code: string | null;
  floors_count: number | null;
  facade_image_url: string | null;
  units: number;
  levels: number[];
}

export interface StudioUnitType {
  id: string;
  code: string;
  name: string | null;
  bedrooms: number | null;
  rooms: number | null;
  area_total: number | null;
  floor_plan_url: string | null;
  template_id: string | null;
  /** How many apartments share this layout — the reuse multiplier. */
  units: number;
  scene_id: string | null;
}

export interface StudioScene {
  id: string;
  kind: SceneKind;
  name: string | null;
  status: TwinStatus;
  building_id: string | null;
  unit_type_id: string | null;
  published_version_id: string | null;
  versions: number;
  updated_at: string;
}

export interface StudioExperience {
  id: string;
  slug: string;
  status: TwinStatus;
  branding: Record<string, unknown>;
  embed_enabled: boolean;
  embed_origins: string[];
  show_homatch_attribution: boolean;
  custom_domain: string | null;
  published_at: string | null;
}

export interface StudioProject {
  project: {
    id: string; name: string; slug: string;
    city: string | null; district: string | null;
    construction_status: string; is_published: boolean;
    master_plan_url: string | null; cover_image_url: string | null;
    workspace_id: string; workspace_name: string; workspace_slug: string;
  };
  buildings: StudioBuilding[];
  unit_types: StudioUnitType[];
  scenes: StudioScene[];
  experience: StudioExperience | null;
  units: Array<{
    id: string; unit_number: string;
    building_id: string | null; floor_level: number | null; unit_type_id: string | null;
  }>;
}

export async function listStudioProjects(): Promise<StudioProjectSummary[]> {
  const data = await rpc<StudioProjectSummary[] | null>('dt_studio_projects', {});
  return data ?? [];
}

export async function getStudioProject(projectId: string): Promise<StudioProject | null> {
  return rpc<StudioProject | null>('dt_studio_project', { p_project_id: projectId }, projectId);
}

// ── Authoring ──────────────────────────────────────────────────────────────

export async function upsertScene(input: {
  projectId: string;
  kind: SceneKind;
  name: string;
  buildingId?: string | null;
  unitTypeId?: string | null;
  sceneId?: string | null;
}): Promise<string> {
  return rpc<string>('dt_studio_upsert_scene', {
    p_project_id: input.projectId,
    p_kind: input.kind,
    p_name: input.name,
    p_building_id: input.buildingId ?? null,
    p_unit_type_id: input.unitTypeId ?? null,
    p_scene_id: input.sceneId ?? null,
  }, input.projectId);
}

export interface SceneVersionInput {
  graph?: Record<string, unknown>;
  cameraPresets?: Array<{ name: string; position: number[]; target: number[] }>;
  hotspots?: Array<{ id: string; label: string; position: number[]; unit_id?: string | null }>;
  budget?: { bytes?: number; draw_calls?: number; triangles?: number };
  notes?: string | null;
}

/**
 * A NEW VERSION, NEVER AN EDIT IN PLACE.
 *
 * This is what lets a published page stay completely still while somebody
 * works on the next one, and it is the same property that makes asset URLs
 * safe to cache forever: nothing a visitor is currently looking at is ever
 * mutated.
 */
export async function saveSceneVersion(
  sceneId: string, input: SceneVersionInput,
): Promise<string> {
  return rpc<string>('dt_studio_save_version', {
    p_scene_id: sceneId,
    p_graph: input.graph ?? {},
    p_camera_presets: input.cameraPresets ?? [],
    p_hotspots: input.hotspots ?? [],
    p_budget: input.budget ?? {},
    p_notes: input.notes ?? null,
  }, sceneId);
}

export interface SceneVersion {
  id: string;
  scene_id: string;
  version: number;
  graph: Record<string, unknown>;
  camera_presets: Array<{ name: string; position: number[]; target: number[] }>;
  hotspots: Array<{ id: string; label: string; position: number[]; unit_id?: string | null }>;
  budget: { bytes?: number; draw_calls?: number; triangles?: number } | null;
  notes: string | null;
  published_at: string | null;
  created_at: string;
}

export async function listSceneVersions(sceneId: string): Promise<SceneVersion[]> {
  return runList<SceneVersion>(
    'listSceneVersions',
    supabase.from('dt_scene_versions').select('*')
      .eq('scene_id', sceneId).order('version', { ascending: false }),
    sceneId,
  );
}

export async function publishScene(sceneId: string, versionId: string): Promise<void> {
  await rpc<void>('dt_studio_publish_scene', {
    p_scene_id: sceneId, p_version_id: versionId,
  }, sceneId);
}

export async function unpublishScene(sceneId: string): Promise<void> {
  await rpc<void>('dt_studio_unpublish_scene', { p_scene_id: sceneId }, sceneId);
}

// ── Assets ─────────────────────────────────────────────────────────────────

/**
 * SHA-256 of the file, computed in the browser before anything is uploaded.
 *
 * This is the identity an asset is deduplicated on. Twenty projects using the
 * same oak floor texture store it once; the twenty-first upload of it never
 * leaves the machine, because register returns the existing row and the
 * caller skips the transfer entirely.
 */
export async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface RegisterAssetInput {
  kind: TwinAsset['kind'];
  name: string;
  storageKey: string;
  contentHash: string;
  bytes: number;
  mime: string;
  scope?: 'GLOBAL' | 'PROJECT';
  workspaceId?: string | null;
  projectId?: string | null;
  isDeliverable?: boolean;
  meta?: Record<string, unknown>;
}

export async function registerAsset(
  input: RegisterAssetInput,
): Promise<{ id: string; reused: boolean; storage_key: string }> {
  return rpc<{ id: string; reused: boolean; storage_key: string }>(
    'dt_studio_register_asset',
    {
      p_kind: input.kind,
      p_name: input.name,
      p_storage_key: input.storageKey,
      p_content_hash: input.contentHash,
      p_bytes: input.bytes,
      p_mime: input.mime,
      p_scope: input.scope ?? 'PROJECT',
      p_workspace_id: input.scope === 'GLOBAL' ? null : input.workspaceId ?? null,
      p_project_id: input.projectId ?? null,
      p_is_deliverable: input.isDeliverable ?? true,
      p_meta: input.meta ?? {},
    },
  );
}

/**
 * Upload, but only if these exact bytes are not already stored.
 *
 * The hash is computed first and registered first. A reused asset never
 * touches the network beyond one small RPC, which is the whole point of
 * content addressing: the second project to use a texture pays nothing for
 * it, and the CDN keeps one copy warm instead of twenty cold ones.
 */
export async function uploadStudioAsset(input: {
  file: File;
  kind: TwinAsset['kind'];
  scope?: 'GLOBAL' | 'PROJECT';
  workspaceId?: string | null;
  projectId?: string | null;
  isDeliverable?: boolean;
}): Promise<{ id: string; reused: boolean; storage_key: string }> {
  const hash = await hashFile(input.file);
  const extension = input.file.name.includes('.')
    ? input.file.name.slice(input.file.name.lastIndexOf('.') + 1).toLowerCase().replace(/[^a-z0-9]/g, '')
    : 'bin';

  /*
   * The hash IS the path. Two identical files land on the same key by
   * construction, and a key never changes once written — which is what makes
   * `?v=<hash>` on the URL a real immutability guarantee rather than a
   * convention somebody has to keep.
   */
  const scope = input.scope ?? 'PROJECT';
  const prefix = scope === 'GLOBAL'
    ? 'twin/global'
    : `${input.workspaceId ?? 'unassigned'}/twin`;
  const storageKey = `${prefix}/${hash}.${extension}`;

  const registered = await registerAsset({
    kind: input.kind,
    name: input.file.name,
    storageKey,
    contentHash: hash,
    bytes: input.file.size,
    mime: input.file.type || 'application/octet-stream',
    scope,
    workspaceId: input.workspaceId ?? null,
    projectId: input.projectId ?? null,
    isDeliverable: input.isDeliverable ?? true,
  });

  if (registered.reused) return registered;

  const { error } = await supabase.storage
    .from('developer-media')
    .upload(storageKey, input.file, {
      contentType: input.file.type || 'application/octet-stream',
      // Content-addressed, so the bytes at a key can never legitimately
      // differ. A year is the longest max-age worth asking for.
      cacheControl: '31536000',
      upsert: true,
    });
  if (error) throw error;

  return registered;
}

export async function attachAsset(
  assetId: string, refType: 'TEMPLATE' | 'SCENE_VERSION' | 'UNIT_TYPE' | 'PROJECT', refId: string,
): Promise<void> {
  await rpc<void>('dt_studio_attach_asset', {
    p_asset_id: assetId, p_ref_type: refType, p_ref_id: refId,
  }, assetId);
}

export async function detachAsset(
  assetId: string, refType: 'TEMPLATE' | 'SCENE_VERSION' | 'UNIT_TYPE' | 'PROJECT', refId: string,
): Promise<void> {
  await rpc<void>('dt_studio_detach_asset', {
    p_asset_id: assetId, p_ref_type: refType, p_ref_id: refId,
  }, assetId);
}

export async function listProjectAssets(
  projectId: string | null, workspaceId: string | null,
): Promise<TwinAsset[]> {
  // Global assets are the shared library every project may draw on; project
  // assets are the ones authored for this development.
  const filter = projectId
    ? `project_id.eq.${projectId},scope.eq.GLOBAL`
    : 'scope.eq.GLOBAL';
  return runList<TwinAsset>(
    'listProjectAssets',
    supabase.from('dt_assets').select('*').or(filter)
      .order('created_at', { ascending: false }).limit(300),
    workspaceId,
  );
}

export async function listSceneAssets(versionId: string): Promise<TwinAsset[]> {
  // PostgREST types an embedded relation as an array even where the foreign
  // key makes it exactly one row, so the shape is flattened here rather than
  // asserted at the call site.
  const rows = await runList<{ dt_assets: TwinAsset[] | TwinAsset | null }>(
    'listSceneAssets',
    supabase.from('dt_asset_refs').select('dt_assets(*)')
      .eq('ref_type', 'SCENE_VERSION').eq('ref_id', versionId),
    versionId,
  );
  return rows.flatMap((r) => {
    if (!r.dt_assets) return [];
    return Array.isArray(r.dt_assets) ? r.dt_assets : [r.dt_assets];
  });
}

// ── Templates (the shared libraries) ───────────────────────────────────────

export async function listTemplates(
  kind?: TwinTemplate['kind'] | null,
): Promise<TwinTemplate[]> {
  let query = supabase.from('dt_templates').select('*')
    .order('scope', { ascending: true }).order('name', { ascending: true });
  if (kind) query = query.eq('kind', kind);
  return runList<TwinTemplate>('listTemplates', query);
}

export async function setUnitTypeTemplate(
  unitTypeId: string, templateId: string | null,
): Promise<void> {
  await rpc<void>('dt_studio_set_unit_type_template', {
    p_unit_type_id: unitTypeId, p_template_id: templateId,
  }, unitTypeId);
}

// ── The published experience and its white label ───────────────────────────

export interface ExperienceInput {
  slug?: string | null;
  status?: TwinStatus | null;
  branding?: Record<string, unknown> | null;
  embedEnabled?: boolean | null;
  embedOrigins?: string[] | null;
  showAttribution?: boolean | null;
  customDomain?: string | null;
}

export async function upsertExperience(
  projectId: string, input: ExperienceInput,
): Promise<string> {
  return rpc<string>('dt_studio_upsert_experience', {
    p_project_id: projectId,
    p_slug: input.slug ?? null,
    p_status: input.status ?? null,
    p_branding: input.branding ?? null,
    p_embed_enabled: input.embedEnabled ?? null,
    p_embed_origins: input.embedOrigins ?? null,
    p_show_attribution: input.showAttribution ?? null,
    p_custom_domain: input.customDomain ?? null,
  }, projectId);
}

// ── What it costs us ───────────────────────────────────────────────────────

export interface StudioCosts {
  rollups: Array<{
    project_id: string | null;
    period_start: string;
    stored_bytes: number;
    deliverable_bytes: number;
    asset_requests: number;
    bandwidth_bytes: number;
    viewer_opens: number;
    processing_jobs: number;
    preparation_cost_usd: number | null;
  }>;
  live: {
    assets: number;
    deliverable_bytes: number;
    source_bytes: number;
    shared_assets: number;
  };
}

/**
 * Studio-only, deliberately.
 *
 * A developer must not be able to read what their project costs Homatch to
 * serve; dt_cost_rollup's select policy says dev_is_studio() and this
 * function checks it again. What a developer gets is dt_analytics — interest,
 * not our margin.
 */
export async function loadStudioCosts(projectId?: string | null): Promise<StudioCosts | null> {
  return rpc<StudioCosts | null>('dt_studio_costs', { p_project_id: projectId ?? null });
}

/** Bytes, for people who think about bandwidth bills. */
export function formatBytes(bytes: number | null | undefined, locale = 'en'): string {
  if (bytes === null || bytes === undefined || Number.isNaN(Number(bytes))) return '—';
  const value = Number(bytes);
  if (value === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / 1024 ** exponent;
  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: scaled >= 100 || exponent === 0 ? 0 : 1,
  }).format(scaled)} ${units[exponent]}`;
}
