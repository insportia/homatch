import { supabase } from '@/db/supabase';
import { runList } from './client';
import type { DevUnit } from './types';
import type { SceneKind, TwinSchematicFloor } from './twin';

/**
 * WHAT THE 3D OF THIS PROJECT ACTUALLY IS, TODAY.
 *
 * The Digital Twin was built as a buyer-facing experience on a public route
 * and an internal authoring tool behind dt_studio_staff. The developer who
 * PAYS for it could see neither: nothing in their own product linked to it,
 * and nothing in their own product told them whether it existed.
 *
 * This is the read that fixes that, and it needs no new SQL. dt_scenes,
 * dt_scene_versions and dt_experiences already let a workspace MEMBER select
 * their own rows while reserving every write to our 3D team — so a developer
 * can see exactly where their walkthrough stands and cannot author it, which
 * is the correct arrangement and was already the policy.
 *
 * HONESTY IS THE POINT OF THIS FILE. The product must be able to say "there
 * is no walkthrough for this apartment" plainly, rather than opening a
 * gallery and calling it one.
 */

export type TwinStage =
  /** Nobody has started. The schematic is all this project has. */
  | 'NOT_CONFIGURED'
  /** Assets are in and a scene exists, but nothing is published yet. */
  | 'IN_PROGRESS'
  /** A published scene exists, but the project is not public. */
  | 'READY'
  /** Published, and reachable by a buyer. */
  | 'PUBLISHED';

export interface TwinSceneRow {
  id: string;
  kind: SceneKind;
  name: string | null;
  status: string;
  building_id: string | null;
  unit_type_id: string | null;
  published_version_id: string | null;
  updated_at: string;
}

export interface ProjectTwinStatus {
  stage: TwinStage;
  scenes: TwinSceneRow[];
  /** Published scenes only — what a buyer could actually be shown. */
  published: TwinSceneRow[];
  /** The interior scenes, keyed by the unit type they belong to. */
  byUnitType: Map<string, TwinSceneRow>;
  experience: {
    id: string; slug: string; status: string;
    embed_enabled: boolean; published_at: string | null;
  } | null;
  /** Heavy assets this workspace holds for the project — geometry, panoramas. */
  assetCount: number;
}

export async function loadProjectTwinStatus(
  workspaceId: string, projectId: string,
): Promise<ProjectTwinStatus> {
  const [scenes, experiences, assets] = await Promise.all([
    runList<TwinSceneRow>(
      'loadProjectScenes',
      supabase.from('dt_scenes')
        .select('id, kind, name, status, building_id, unit_type_id, published_version_id, updated_at')
        .eq('workspace_id', workspaceId).eq('project_id', projectId)
        .order('kind'),
      projectId,
    ),
    runList<ProjectTwinStatus['experience'] & { project_id: string }>(
      'loadProjectExperience',
      supabase.from('dt_experiences')
        .select('id, slug, status, embed_enabled, published_at, project_id')
        .eq('workspace_id', workspaceId).eq('project_id', projectId).limit(1),
      projectId,
    ),
    runList<{ id: string }>(
      'loadProjectTwinAssets',
      supabase.from('dt_assets').select('id').eq('workspace_id', workspaceId).limit(200),
      projectId,
    ),
  ]);

  const published = scenes.filter((s) => s.published_version_id !== null && s.status === 'PUBLISHED');
  const experience = experiences[0] ?? null;

  const byUnitType = new Map<string, TwinSceneRow>();
  for (const scene of published) {
    if (scene.kind === 'UNIT_TYPE' && scene.unit_type_id) byUnitType.set(scene.unit_type_id, scene);
  }

  const stage: TwinStage = published.length === 0
    ? (scenes.length === 0 ? 'NOT_CONFIGURED' : 'IN_PROGRESS')
    : (experience && experience.status === 'PUBLISHED' ? 'PUBLISHED' : 'READY');

  return {
    stage, scenes, published, byUnitType,
    experience: experience ? {
      id: experience.id, slug: experience.slug, status: experience.status,
      embed_enabled: experience.embed_enabled, published_at: experience.published_at,
    } : null,
    assetCount: assets.length,
  };
}

/**
 * THE BUILDING, AS FLOORS, FROM INVENTORY ALONE.
 *
 * This is what makes a 3D view possible for a developer who has uploaded
 * nothing but a spreadsheet: the schematic the viewer draws is their OWN
 * building — their floors, their apartment counts, their availability — not a
 * stock model standing in for it. The canvas labels it a schematic in its own
 * corner, so nobody is told a massing diagram is a render.
 */
export function floorsFromUnits(units: DevUnit[]): TwinSchematicFloor[] {
  const byLevel = new Map<number, TwinSchematicFloor>();
  for (const unit of units) {
    if (unit.floor_level == null) continue;
    const level = Number(unit.floor_level);
    if (!Number.isFinite(level)) continue;
    const row = byLevel.get(level) ?? { level, available: 0, total: 0 };
    row.total += 1;
    if (unit.status === 'AVAILABLE') row.available += 1;
    byLevel.set(level, row);
  }
  return [...byLevel.values()].sort((a, b) => a.level - b.level);
}
