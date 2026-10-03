// DESIGN STUDIO PERSISTENCE — projects, spatial sources, versions.
//
// Every read and write here runs as the signed-in customer; RLS decides
// what they may touch (see 20260930090000_design_studio_foundation.sql).
// Nothing in this module reads or writes a dt_* / dev_* table: a developer
// unit enters Design Studio only through ds_attach_developer_unit(), which
// reads the same published scene an anonymous viewer can.

import { supabase } from '@/db/supabase';
import { emptyDesignState } from '@/lib/designStudio/designState';
import type {
  DesignProjectRecord,
  DesignVersionRecord,
  SpatialSourceRecord,
} from '@/lib/designStudio/types';

/** Columns a list needs; `canonical` can be large and is fetched only when opening. */
const SOURCE_SUMMARY =
  'id, project_id, kind, status, geometry_state, editability, dev_unit_id, upstream, floorplan_id, '
  + 'model_object_key, model_sha256, model_bytes, model_mime, calibration, generator_version, provenance, '
  + 'failure, supersedes_id, created_at';

const VERSION_SUMMARY =
  'id, project_id, user_id, source_id, parent_id, name, origin, state_schema, revision, style_tags, '
  + 'change_summary, thumbnail_key, archived_at, created_at, updated_at';

/**
 * A server refusal, translated to something the interface can name.
 * The DS_* codes are raised by the migration's guards and functions.
 */
// The error every Design Studio service throws (its own module, so pure helpers can use it without the client).
import { DesignStudioError } from './errors.ts';
export { DesignStudioError };

function fail(error: { message?: string } | null | undefined): never {
  const message = error?.message ?? 'UNKNOWN';
  const code = message.match(/\bDS_[A-Z_]+\b/)?.[0] ?? 'DS_REQUEST_FAILED';
  throw new DesignStudioError(code, message);
}

/**
 * A source row as the resolver needs it when `canonical` was not selected:
 * the database guarantees a READY floor-plan source carries its geometry
 * (constraint ds_sources_payload), so a list may mark it present.
 */
function summarySource(row: Record<string, unknown>): SpatialSourceRecord {
  return {
    ...(row as unknown as SpatialSourceRecord),
    canonical: row.kind === 'FLOORPLAN_SCENE' ? { omitted: true } : null,
  };
}

export interface ProjectListItem extends DesignProjectRecord {
  sources: SpatialSourceRecord[];
  headVersion: Pick<DesignVersionRecord, 'id' | 'name' | 'updated_at'> | null;
  property: { id: string; title: string | null; homatch_id: number | null; cover_photo_url: string | null } | null;
}

export async function listProjects(userId: string, status: 'ACTIVE' | 'ARCHIVED' = 'ACTIVE'): Promise<ProjectListItem[]> {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('ds_projects')
    .select(
      `*, sources:ds_spatial_sources!ds_spatial_sources_project_id_fkey(${SOURCE_SUMMARY}),`
      + ' head:ds_versions!ds_projects_head_version_fk(id, name, updated_at),'
      + ' property:properties(id, title, homatch_id, cover_photo_url)',
    )
    .eq('user_id', userId)
    .eq('status', status)
    // A project being permanently deleted is gone from every list at once.
    .is('deleting_at', null)
    .order('updated_at', { ascending: false })
    .limit(100);
  if (error) fail(error);
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return rows.map((row) => {
    const { sources, head, property, ...project } = row as Record<string, unknown> & {
      sources?: Record<string, unknown>[]; head?: ProjectListItem['headVersion']; property?: ProjectListItem['property'];
    };
    return {
      ...(project as unknown as DesignProjectRecord),
      sources: (sources ?? []).map(summarySource),
      headVersion: head ?? null,
      property: property ?? null,
    };
  });
}

export interface ProjectBundle {
  project: DesignProjectRecord;
  sources: SpatialSourceRecord[];
  versions: DesignVersionRecord[];
}

/** One project with every source (including geometry) and every version summary. */
export async function getProject(projectId: string): Promise<ProjectBundle | null> {
  const { data: project, error } = await supabase
    .from('ds_projects').select('*').eq('id', projectId).maybeSingle();
  if (error) fail(error);
  // A project being permanently deleted no longer exists for its owner.
  if (!project || (project as DesignProjectRecord).deleting_at) return null;

  const [{ data: sources, error: sErr }, { data: versions, error: vErr }] = await Promise.all([
    supabase.from('ds_spatial_sources').select('*').eq('project_id', projectId).order('created_at'),
    supabase.from('ds_versions').select(VERSION_SUMMARY).eq('project_id', projectId).order('created_at'),
  ]);
  if (sErr) fail(sErr);
  if (vErr) fail(vErr);

  return {
    project: project as DesignProjectRecord,
    sources: (sources ?? []) as SpatialSourceRecord[],
    versions: ((versions ?? []) as unknown as DesignVersionRecord[]).map((v) => ({ ...v, state: {} })),
  };
}

export async function createProject(input: {
  userId: string;
  name: string;
  propertyId?: string | null;
  devUnitId?: string | null;
}): Promise<DesignProjectRecord> {
  const { data, error } = await supabase
    .from('ds_projects')
    .insert({
      user_id: input.userId,
      name: input.name.trim().slice(0, 120),
      property_id: input.propertyId ?? null,
      dev_unit_id: input.devUnitId ?? null,
    })
    .select('*')
    .single();
  if (error) fail(error);
  return data as DesignProjectRecord;
}

export async function renameProject(projectId: string, name: string): Promise<void> {
  const { error } = await supabase.from('ds_projects').update({ name: name.trim().slice(0, 120) }).eq('id', projectId);
  if (error) fail(error);
}

export async function setProjectStatus(projectId: string, status: 'ACTIVE' | 'ARCHIVED'): Promise<void> {
  const { error } = await supabase.from('ds_projects').update({ status }).eq('id', projectId);
  if (error) fail(error);
}

/**
 * Permanently delete a project: the server revokes its shares, removes every
 * upload from storage and every row, and refuses unless the caller owns it
 * and `confirmName` is its name. A dropped attempt is finished by asking again.
 */
export async function deleteProjectPermanently(projectId: string, confirmName: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await supabase.functions.invoke('design-studio-reconstruct/project-delete', { body: { projectId, confirmName } });
    if (!error && (data as { state?: string } | null)?.state === 'DELETED') return;
    let code = 'DS_DELETE_FAILED';
    let retry = false;
    try {
      const body = await (error as { context?: Response } | null)?.context?.json();
      if (typeof body?.error === 'string') code = `DS_DELETE_${body.error}`;
      retry = body?.retry === true;
    } catch { /* keep the generic code */ }
    if (!retry) throw new DesignStudioError(code);
  }
  throw new DesignStudioError('DS_DELETE_STORAGE_NOT_EMPTY');
}

/**
 * Finish any deletion the owner started that did not complete (the project is
 * already hidden and unshared, so they have no row to retry from). Quiet by
 * design: whatever still fails is picked up on the next visit.
 */
export async function resumePendingDeletions(userId: string): Promise<void> {
  if (!userId) return;
  const { data } = await supabase.from('ds_projects').select('id')
    .eq('user_id', userId).not('deleting_at', 'is', null).limit(20);
  for (const row of (data ?? []) as Array<{ id: string }>) {
    try { await deleteProjectPermanently(row.id, ''); } catch { /* next visit */ }
  }
}

/** Choose which ready source this project designs on. */
export async function setActiveSource(projectId: string, sourceId: string): Promise<void> {
  const { error } = await supabase.from('ds_projects').update({ active_source_id: sourceId }).eq('id', projectId);
  if (error) fail(error);
}

export async function getSource(sourceId: string): Promise<SpatialSourceRecord | null> {
  const { data, error } = await supabase
    .from('ds_spatial_sources').select(SOURCE_SUMMARY).eq('id', sourceId).maybeSingle();
  if (error) fail(error);
  return data ? summarySource(data as unknown as Record<string, unknown>) : null;
}

/** One source with its canonical payload (a model's analysis, a plan's geometry). */
export async function getSourceFull(sourceId: string): Promise<SpatialSourceRecord | null> {
  const { data, error } = await supabase.from('ds_spatial_sources').select('*').eq('id', sourceId).maybeSingle();
  if (error) fail(error);
  return (data as SpatialSourceRecord | null) ?? null;
}

/**
 * Pin a published developer apartment as this project's space. Returns the
 * source id; idempotent for the same published version.
 */
export async function attachDeveloperUnit(projectId: string, unitId: string): Promise<string> {
  const { data, error } = await supabase.rpc('ds_attach_developer_unit', {
    p_project_id: projectId, p_unit_id: unitId,
  });
  if (error) fail(error);
  return data as string;
}

/**
 * The first version of a design on a source: named "Original", empty design
 * state, and made the project's head. Never overwrites an existing version.
 */
export async function createOriginalVersion(input: {
  userId: string;
  projectId: string;
  sourceId: string;
  name: string;
}): Promise<DesignVersionRecord> {
  const { data, error } = await supabase
    .from('ds_versions')
    .insert({
      project_id: input.projectId,
      user_id: input.userId,
      source_id: input.sourceId,
      name: input.name,
      origin: 'ORIGINAL',
      state: emptyDesignState(),
    })
    .select('*')
    .single();
  if (error) fail(error);
  const version = data as DesignVersionRecord;
  const { error: headErr } = await supabase
    .from('ds_projects').update({ head_version_id: version.id }).eq('id', input.projectId);
  if (headErr) fail(headErr);
  return version;
}

export interface LauncherProperty {
  id: string;
  title: string | null;
  homatch_id: number | null;
  cover_photo_url: string | null;
  city: string | null;
  district: string | null;
  area: number | null;
  rooms: number | null;
}

/** The customer's own active properties, for "Choose from My Properties". */
export async function listLauncherProperties(userId: string): Promise<LauncherProperty[]> {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('properties')
    .select('id, title, homatch_id, cover_photo_url, facts:property_facts(city, district, area, rooms)')
    .eq('user_id', userId)
    .eq('is_deleted', false)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) fail(error);
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return rows.map((row) => {
    const factsRaw = row.facts as Record<string, unknown> | Record<string, unknown>[] | null;
    const facts = (Array.isArray(factsRaw) ? factsRaw[0] : factsRaw) ?? {};
    return {
      id: row.id as string,
      title: (row.title as string | null) ?? null,
      homatch_id: (row.homatch_id as number | null) ?? null,
      cover_photo_url: (row.cover_photo_url as string | null) ?? null,
      city: (facts.city as string | null) ?? null,
      district: (facts.district as string | null) ?? null,
      area: (facts.area as number | null) ?? null,
      rooms: (facts.rooms as number | null) ?? null,
    };
  });
}

/** One version with its full design state. */
export async function getVersion(versionId: string): Promise<DesignVersionRecord | null> {
  const { data, error } = await supabase.from('ds_versions').select('*').eq('id', versionId).maybeSingle();
  if (error) fail(error);
  return (data as DesignVersionRecord | null) ?? null;
}

/**
 * What each developer unit publishes TODAY, read through the same public
 * dt_unit_scene() any viewer uses: the pin, or null when nothing is
 * published. Feeds the resolver's staleness check; a unit whose read fails
 * is left out (unchecked), never guessed.
 */
export async function developerCurrentPins(unitIds: string[]): Promise<Record<string, { scene_id: string; version: string } | null>> {
  if (unitIds.length === 0) return {};
  const out: Record<string, { scene_id: string; version: string } | null> = {};
  await Promise.all([...new Set(unitIds)].map(async (id) => {
    // Called directly (not through loadUnitScene) so a failed READ stays
    // 'unchecked' instead of being mistaken for 'no longer published'.
    const { data, error } = await supabase.rpc('dt_unit_scene', { p_unit_id: id });
    if (error) return;
    const scene = data as { id?: string; version?: number | string; error?: string } | null;
    out[id] = scene && !scene.error && scene.id ? { scene_id: scene.id, version: String(scene.version) } : null;
  }));
  return out;
}

export type SaveResult =
  | { ok: true; revision: number }
  | { ok: false; reason: 'CONFLICT' | 'OFFLINE' | 'FAILED'; serverRevision?: number };

/**
 * Save a version's design state IF nobody else saved it since `expectedRevision`.
 * The database advances the revision itself; a stale save matches no row and
 * is reported as a conflict rather than silently overwriting newer work.
 */
export async function saveVersionState(
  versionId: string, state: Record<string, unknown>, expectedRevision: number, changeSummary?: unknown[],
): Promise<SaveResult> {
  try {
    const patch: Record<string, unknown> = { state };
    if (changeSummary) patch.change_summary = changeSummary;
    const { data, error } = await supabase
      .from('ds_versions').update(patch).eq('id', versionId).eq('revision', expectedRevision)
      .select('revision');
    if (error) return { ok: false, reason: 'FAILED' };
    const rows = (data ?? []) as Array<{ revision: number }>;
    if (rows.length === 1) return { ok: true, revision: rows[0].revision };
    const { data: current } = await supabase.from('ds_versions').select('revision').eq('id', versionId).maybeSingle();
    return { ok: false, reason: 'CONFLICT', serverRevision: (current as { revision?: number } | null)?.revision };
  } catch {
    // fetch() throws on a network failure; the database answered nothing.
    return { ok: false, reason: 'OFFLINE' };
  }
}

/** Append the operations that produced a revision — the audit trail, never rewritten. */
export async function appendVersionEvents(
  events: Array<{ versionId: string; userId: string; revision: number; origin: 'USER' | 'AI' | 'SYSTEM'; ops: unknown[]; jobId?: string | null }>,
): Promise<void> {
  if (events.length === 0) return;
  const { error } = await supabase.from('ds_version_events').insert(events.map((e) => ({
    version_id: e.versionId, user_id: e.userId, revision: e.revision, origin: e.origin, ops: e.ops,
    // An AI change names the AI job that proposed it (the database checks it).
    ...(e.origin === 'AI' && e.jobId ? { job_id: e.jobId } : {}),
  })));
  if (error) throw new Error(error.message);
}

// ── Versions ───────────────────────────────────────────────────────────

/**
 * A new version: a copy of a design state (never of geometry) with its
 * lineage. Used for "duplicate", "new direction from here" and AI-created
 * alternatives. The source version is left exactly as it was.
 */
export async function createVersion(input: {
  userId: string;
  projectId: string;
  sourceId: string;
  parentId: string | null;
  name: string;
  origin: 'USER' | 'AI' | 'DUPLICATE' | 'BRANCH' | 'RESTORE';
  state: Record<string, unknown>;
  styleTags?: string[];
  changeSummary?: unknown[];
  makeHead?: boolean;
  /** AI versions: the SUCCEEDED AI job whose proposal this is. */
  jobId?: string | null;
}): Promise<DesignVersionRecord> {
  const { data, error } = await supabase
    .from('ds_versions')
    .insert({
      project_id: input.projectId,
      user_id: input.userId,
      source_id: input.sourceId,
      parent_id: input.parentId,
      name: input.name.trim().slice(0, 80),
      origin: input.origin,
      state: input.state,
      style_tags: input.styleTags ?? [],
      change_summary: input.changeSummary ?? [],
      ...(input.origin === 'AI' && input.jobId ? { job_id: input.jobId } : {}),
    })
    .select('*')
    .single();
  if (error) fail(error);
  const version = data as DesignVersionRecord;
  if (input.makeHead !== false) await setHeadVersion(input.projectId, version.id);
  return version;
}

export async function setHeadVersion(projectId: string, versionId: string): Promise<void> {
  const { error } = await supabase.from('ds_projects').update({ head_version_id: versionId }).eq('id', projectId);
  if (error) fail(error);
}

export async function renameVersion(versionId: string, name: string): Promise<void> {
  const { error } = await supabase.from('ds_versions').update({ name: name.trim().slice(0, 80) }).eq('id', versionId);
  if (error) fail(error);
}

/** Archive hides a version from the working list; it is never deleted here. */
export async function setVersionArchived(versionId: string, archived: boolean): Promise<void> {
  const { error } = await supabase
    .from('ds_versions').update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', versionId);
  if (error) fail(error);
}

export interface VersionEvent {
  id: string;
  revision: number;
  origin: 'USER' | 'AI' | 'SYSTEM';
  ops: Array<{ type: string }>;
  created_at: string;
}

/** The recorded operations of a version, newest first. */
export async function listVersionEvents(versionId: string, limit = 100): Promise<VersionEvent[]> {
  const { data, error } = await supabase
    .from('ds_version_events').select('id, revision, origin, ops, created_at')
    .eq('version_id', versionId).order('created_at', { ascending: false }).limit(limit);
  if (error) fail(error);
  return (data ?? []) as VersionEvent[];
}

// ── Saved views ────────────────────────────────────────────────────────

export interface SavedView {
  id: string;
  project_id: string;
  name: string;
  camera: { position: [number, number, number]; target: [number, number, number]; fov: number };
  room_id: string | null;
  sort: number;
  created_at: string;
}

export async function listSavedViews(projectId: string): Promise<SavedView[]> {
  const { data, error } = await supabase
    .from('ds_saved_views').select('id, project_id, name, camera, room_id, sort, created_at')
    .eq('project_id', projectId).order('sort').order('created_at');
  if (error) fail(error);
  return (data ?? []) as SavedView[];
}

export async function createSavedView(input: {
  userId: string; projectId: string; name: string; camera: SavedView['camera']; roomId: string | null; sort: number;
}): Promise<SavedView> {
  const { data, error } = await supabase
    .from('ds_saved_views')
    .insert({
      user_id: input.userId, project_id: input.projectId, name: input.name.trim().slice(0, 60),
      camera: input.camera, room_id: input.roomId, sort: input.sort,
    })
    .select('id, project_id, name, camera, room_id, sort, created_at')
    .single();
  if (error) fail(error);
  return data as SavedView;
}

export async function deleteSavedView(viewId: string): Promise<void> {
  const { error } = await supabase.from('ds_saved_views').delete().eq('id', viewId);
  if (error) fail(error);
}
