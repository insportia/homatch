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
export class DesignStudioError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

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
  if (!project) return null;

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
