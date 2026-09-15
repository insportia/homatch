// HOMATCH FOR DEVELOPERS — projects, buildings, units, and the ways a unit
// becomes visible to somebody outside the company.

import { run, runList, rpc, supabase } from './client';
import type {
  DevProject, DevBuilding, DevUnit, UnitStatus, DevWalkthrough, DevShareLink,
  DevShareEventRow, ImportResult, DevPaymentPlan, HotspotPolygon,
} from './types';
import { WORKFLOW_ONLY_STATUSES } from './types';

const PROJECT_COLUMNS = '*';

export async function listProjects(workspaceId: string): Promise<DevProject[]> {
  return runList<DevProject>(
    'listProjects',
    supabase.from('dev_projects').select(PROJECT_COLUMNS)
      .eq('workspace_id', workspaceId).order('created_at', { ascending: false }),
    workspaceId,
  );
}

export async function getProject(projectId: string): Promise<DevProject> {
  return run<DevProject>(
    'getProject',
    supabase.from('dev_projects').select(PROJECT_COLUMNS).eq('id', projectId).single(),
    projectId,
  );
}

/** A slug is derived once, on create, and is what a public URL is built from. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'project';
}

export async function createProject(
  workspaceId: string,
  input: Partial<DevProject> & { name: string },
): Promise<DevProject> {
  return run<DevProject>(
    'createProject',
    supabase.from('dev_projects').insert({
      ...input,
      workspace_id: workspaceId,
      slug: input.slug ?? slugify(input.name),
    }).select().single(),
    workspaceId,
  );
}

export async function updateProject(
  projectId: string, patch: Partial<DevProject>,
): Promise<DevProject> {
  return run<DevProject>(
    'updateProject',
    supabase.from('dev_projects').update(patch).eq('id', projectId).select().single(),
    projectId,
  );
}

/**
 * Publication is its own verb, never a side effect of saving a form (§102).
 * The timestamp is set here rather than by a trigger so that un-publishing and
 * re-publishing records the second date, which is what somebody asking "when
 * did this go live" actually wants.
 */
export async function setProjectPublished(
  projectId: string, published: boolean,
): Promise<DevProject> {
  return updateProject(projectId, {
    is_published: published,
    published_at: published ? new Date().toISOString() : null,
  });
}

export async function listBuildings(projectId: string): Promise<DevBuilding[]> {
  return runList<DevBuilding>(
    'listBuildings',
    supabase.from('dev_buildings').select('*').eq('project_id', projectId)
      .order('sort_order').order('name'),
    projectId,
  );
}

export async function createBuilding(
  workspaceId: string, projectId: string, input: Partial<DevBuilding> & { name: string },
): Promise<DevBuilding> {
  return run<DevBuilding>(
    'createBuilding',
    supabase.from('dev_buildings')
      .insert({ ...input, workspace_id: workspaceId, project_id: projectId })
      .select().single(),
    projectId,
  );
}

export async function updateBuilding(
  buildingId: string, patch: Partial<DevBuilding>,
): Promise<DevBuilding> {
  return run<DevBuilding>(
    'updateBuilding',
    supabase.from('dev_buildings').update(patch).eq('id', buildingId).select().single(),
    buildingId,
  );
}

export interface UnitQuery {
  projectId?: string;
  buildingId?: string;
  status?: UnitStatus[];
  search?: string;
  minPrice?: number;
  maxPrice?: number;
  bedrooms?: number[];
  /** Page size. The inventory table asks for one page; the visual building asks for all. */
  limit?: number;
  offset?: number;
  orderBy?: 'unit_number' | 'price' | 'area_total' | 'floor_level' | 'status';
  ascending?: boolean;
}

export interface UnitPage {
  rows: DevUnit[];
  total: number;
}

/**
 * Filtering happens in Postgres, not in the browser. A developer with four
 * thousand apartments must not be sent four thousand rows so the page can
 * hide most of them.
 */
export async function listUnits(workspaceId: string, q: UnitQuery = {}): Promise<UnitPage> {
  let query = supabase
    .from('dev_units')
    .select('*', { count: 'exact' })
    .eq('workspace_id', workspaceId);

  if (q.projectId) query = query.eq('project_id', q.projectId);
  if (q.buildingId) query = query.eq('building_id', q.buildingId);
  if (q.status && q.status.length > 0) query = query.in('status', q.status);
  if (q.bedrooms && q.bedrooms.length > 0) query = query.in('bedrooms', q.bedrooms);
  if (typeof q.minPrice === 'number') query = query.gte('price', q.minPrice);
  if (typeof q.maxPrice === 'number') query = query.lte('price', q.maxPrice);
  if (q.search && q.search.trim()) {
    const term = q.search.trim().replace(/[%,()]/g, '');
    query = query.or(`unit_number.ilike.%${term}%,unit_type.ilike.%${term}%,view_text.ilike.%${term}%`);
  }

  query = query
    .order(q.orderBy ?? 'unit_number', { ascending: q.ascending ?? true })
    .range(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? 50) - 1);

  const { data, error, count } = await query;
  if (error) {
    const { toDevError } = await import('./client');
    throw toDevError(error, { op: 'listUnits', subjectId: workspaceId });
  }
  return { rows: (data ?? []) as DevUnit[], total: count ?? 0 };
}

export async function getUnit(unitId: string): Promise<DevUnit> {
  return run<DevUnit>(
    'getUnit',
    supabase.from('dev_units').select('*').eq('id', unitId).single(),
    unitId,
  );
}

export async function createUnit(
  workspaceId: string, projectId: string, input: Partial<DevUnit> & { unit_number: string },
): Promise<DevUnit> {
  return run<DevUnit>(
    'createUnit',
    supabase.from('dev_units')
      .insert({ ...input, workspace_id: workspaceId, project_id: projectId })
      .select().single(),
    projectId,
  );
}

/**
 * The three statuses that mean money are refused by a database trigger, not
 * by this function. Checking here as well is not belt and braces for its own
 * sake: it turns a raised exception the customer cannot act on into a clear
 * refusal before the round trip, and the trigger is still what makes it true.
 */
export async function updateUnit(unitId: string, patch: Partial<DevUnit>): Promise<DevUnit> {
  if (patch.status && WORKFLOW_ONLY_STATUSES.includes(patch.status)) {
    const { DevError } = await import('./client');
    throw new DevError('dev_err_status_workflow_only', `status ${patch.status} is workflow-only`, null);
  }
  return run<DevUnit>(
    'updateUnit',
    supabase.from('dev_units').update(patch).eq('id', unitId).select().single(),
    unitId,
  );
}

export async function setUnitsPublished(unitIds: string[], published: boolean): Promise<void> {
  if (unitIds.length === 0) return;
  await run(
    'setUnitsPublished',
    supabase.from('dev_units')
      .update({ is_published: published, published_at: published ? new Date().toISOString() : null })
      .in('id', unitIds).select('id'),
  );
}

export async function setUnitHotspot(unitId: string, hotspot: HotspotPolygon | null): Promise<DevUnit> {
  return updateUnit(unitId, { hotspot });
}

export interface UnitEvent {
  id: string; unit_id: string; kind: string; from_value: string | null;
  to_value: string | null; note: string | null; meta: Record<string, unknown>;
  actor_id: string | null; created_at: string;
}

/** A unit's own visible history, written by the database. §132 and §133. */
export async function listUnitEvents(unitId: string): Promise<UnitEvent[]> {
  return runList<UnitEvent>(
    'listUnitEvents',
    supabase.from('dev_unit_events').select('*')
      .eq('unit_id', unitId).order('created_at', { ascending: false }).limit(200),
    unitId,
  );
}

/** One transaction for the whole sheet. Never deletes; reports what it did. */
export async function importUnits(
  projectId: string, rows: Record<string, string>[], mode: 'INSERT' | 'UPSERT',
): Promise<ImportResult> {
  return rpc<ImportResult>('dev_import_units', {
    p_project_id: projectId, p_rows: rows, p_mode: mode,
  }, projectId);
}

// ── Payment plans ──────────────────────────────────────────────────────────

export async function listPaymentPlans(workspaceId: string): Promise<DevPaymentPlan[]> {
  return runList<DevPaymentPlan>(
    'listPaymentPlans',
    supabase.from('dev_payment_plans').select('*')
      .eq('workspace_id', workspaceId).order('created_at'),
    workspaceId,
  );
}

export async function createPaymentPlan(
  workspaceId: string, input: Partial<DevPaymentPlan> & { name: string },
): Promise<DevPaymentPlan> {
  return run<DevPaymentPlan>(
    'createPaymentPlan',
    supabase.from('dev_payment_plans')
      .insert({ ...input, workspace_id: workspaceId }).select().single(),
    workspaceId,
  );
}

// ── Walkthroughs ───────────────────────────────────────────────────────────

/**
 * Where an embedded tour may come from.
 *
 * An iframe src is the one field on a unit that a customer types and a
 * stranger's browser then executes. The allowlist is checked here before the
 * row is written and again before the viewer renders it, because a row that
 * predates a change to this list must not become live by redeploying.
 */
export const WALKTHROUGH_EMBED_HOSTS = [
  'my.matterport.com',
  'matterport.com',
  'kuula.co',
  'momento360.com',
  'player.vimeo.com',
  'www.youtube.com',
  'youtube.com',
  'youtu.be',
  'cloudpano.com',
  'app.cloudpano.com',
];

export function isAllowedEmbedUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return WALKTHROUGH_EMBED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

export async function listWalkthroughs(unitId: string): Promise<DevWalkthrough[]> {
  return runList<DevWalkthrough>(
    'listWalkthroughs',
    supabase.from('dev_walkthroughs').select('*')
      .eq('unit_id', unitId).order('updated_at', { ascending: false }),
    unitId,
  );
}

export async function saveWalkthrough(
  workspaceId: string,
  input: Partial<DevWalkthrough> & { unit_id?: string | null; project_id?: string | null },
): Promise<DevWalkthrough> {
  if (input.provider === 'EMBED' || input.provider === 'VIDEO') {
    if (!isAllowedEmbedUrl(input.embed_url)) {
      const { DevError } = await import('./client');
      throw new DevError('dev_err_embed_not_allowed', 'embed host not on the allowlist', null);
    }
  }
  if (input.id) {
    return run<DevWalkthrough>(
      'saveWalkthrough.update',
      supabase.from('dev_walkthroughs').update(input).eq('id', input.id).select().single(),
      input.id,
    );
  }
  return run<DevWalkthrough>(
    'saveWalkthrough.insert',
    supabase.from('dev_walkthroughs')
      .insert({ ...input, workspace_id: workspaceId }).select().single(),
    workspaceId,
  );
}

export async function deleteWalkthrough(id: string): Promise<void> {
  await run('deleteWalkthrough', supabase.from('dev_walkthroughs').delete().eq('id', id).select('id'), id);
}

// ── Share links ────────────────────────────────────────────────────────────

export async function createShareLink(input: {
  targetType: 'UNIT' | 'PROJECT' | 'OFFER' | 'BUYER_ROOM';
  targetId: string;
  leadId?: string | null;
  expiresAt?: string | null;
  label?: string | null;
}): Promise<{ id: string; token: string }> {
  return rpc<{ id: string; token: string }>('dev_create_share_link', {
    p_target_type: input.targetType,
    p_target_id: input.targetId,
    p_lead_id: input.leadId ?? null,
    p_expires_at: input.expiresAt ?? null,
    p_label: input.label ?? null,
  }, input.targetId);
}

export function shareUrl(token: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/s/${token}`;
}

export async function listShareLinks(
  targetType: DevShareLink['target_type'], targetId: string,
): Promise<DevShareLink[]> {
  return runList<DevShareLink>(
    'listShareLinks',
    supabase.from('dev_share_links').select('*')
      .eq('target_type', targetType).eq('target_id', targetId)
      .order('created_at', { ascending: false }),
    targetId,
  );
}

/** Revoking keeps the row, so the activity it already gathered stays readable. */
export async function revokeShareLink(id: string): Promise<void> {
  await run(
    'revokeShareLink',
    supabase.from('dev_share_links')
      .update({ revoked_at: new Date().toISOString() }).eq('id', id).select('id'),
    id,
  );
}

export async function listShareEvents(shareLinkId: string): Promise<DevShareEventRow[]> {
  return runList<DevShareEventRow>(
    'listShareEvents',
    supabase.from('dev_share_events').select('*')
      .eq('share_link_id', shareLinkId).order('created_at', { ascending: false }).limit(200),
    shareLinkId,
  );
}
