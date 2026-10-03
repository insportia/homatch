// Design Studio — WHERE EACH PROJECT IS, for the project library.
//
// Read from the server's own rows (never from a page that may be closed):
//   WORKING   a reading, a design or a picture is under way
//   QUESTION  the photos were understood and one detail is waiting for the customer
//   READY     a design picture exists
//   FAILED    the latest work did not finish (and nothing is ready)
// A project with none of these shows no status.

import { supabase } from '@/db/supabase';
import type { PhotoFlowRecord } from '@/lib/designStudio/photoProject';
import { RECENT_MS, statusOf, type ProjectStatus } from '@/lib/designStudio/projectStatus';

export type { ProjectStatus };

export async function projectStatuses(projectIds: string[]): Promise<Map<string, ProjectStatus>> {
  const out = new Map<string, ProjectStatus>();
  if (!projectIds.length) return out;
  const ids = projectIds.slice(0, 100);
  const since = new Date(Date.now() - RECENT_MS).toISOString();
  const [renders, readings, photos, designs] = await Promise.all([
    supabase.from('ds_renders').select('project_id, status').in('project_id', ids).order('created_at', { ascending: false }).limit(500),
    supabase.from('ds_floorplans').select('project_id, status').in('project_id', ids).eq('purpose', 'PLAN').limit(300),
    supabase.from('ds_reconstructions').select('project_id, status, analysis, corrections, plan_source_id').in('project_id', ids).is('plan_source_id', null).limit(200),
    supabase.from('ds_jobs').select('project_id, status, created_at').in('project_id', ids).eq('kind', 'AI_DESIGN').eq('status', 'RUNNING').gte('created_at', since).limit(100),
  ]);
  const by = <T extends { project_id: string }>(rows: T[] | null | undefined) => {
    const m = new Map<string, T[]>();
    for (const r of rows ?? []) m.set(r.project_id, [...(m.get(r.project_id) ?? []), r]);
    return m;
  };
  const r = by(renders.data as Array<{ project_id: string; status: string }> | null);
  const f = by(readings.data as Array<{ project_id: string; status: string }> | null);
  const p = by(photos.data as Array<{ project_id: string; status: string; analysis: unknown; corrections: { flow?: PhotoFlowRecord } | null }> | null);
  const d = by(designs.data as Array<{ project_id: string; status: string; created_at: string }> | null);
  for (const id of ids) {
    const s = statusOf({ renders: r.get(id) ?? [], readings: f.get(id) ?? [], photos: p.get(id) ?? [], designs: d.get(id) ?? [] });
    if (s) out.set(id, s);
  }
  return out;
}
