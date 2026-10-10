// THE SELECTED RENDER AS EVIDENCE — read on the server, from HOMATCH's own private store.
//
// A reference-locked walkthrough is built from what HOMATCH already holds about the selected render
// (walkthrough/designGraph.ts): its scene map (the job made when it was generated), its legend and id image
// (ds_renders.legend / map_key), the reading's rooms (the reconstruction the project's space came from, or the
// space itself for a render drawn over the plan), and the render's own pixels, measured per region
// (walkthrough/regionAppearance.ts). Everything is read with the service role inside this function: nothing is
// signed for a browser, nothing leaves the server but the measured colours.

import { getObject } from '../_shared/objectStore.ts';
import { validateScene } from '../_shared/designStudio/sceneMap.ts';
import { decodeRgba } from './rasterRgba.ts';
import type { SpaceModel } from '../../../src/lib/designStudio/space.ts';
import type { Legend, MapElement, RegionLook } from '../../../src/lib/designStudio/walkthrough/designGraph.ts';
import { regionAppearance } from '../../../src/lib/designStudio/walkthrough/regionAppearance.ts';

// deno-lint-ignore no-explicit-any
type Row = any;

/** The id image is small (768×512); a larger object is refused rather than decoded. */
const MAX_ID_IMAGE_BYTES = 4 * 1024 * 1024;

export interface DesignEvidence {
  sceneMap: MapElement[];
  legend: Legend | null;
  sourceRooms: Array<{ id: string; kind: string }>;
  appearance: Record<string, RegionLook> | null;
  /** What was read, for the report (never a key or a URL). */
  report: { sceneMapElements: number; legendEntries: number; sourceRooms: number; pixels: 'MEASURED' | 'UNAVAILABLE' | 'NO_ID_IMAGE'; regionsMeasured: number };
}

/** The reading's rooms this project's space came from: the reconstruction behind its source, else the space itself. */
async function sourceRoomsOf(admin: Row, sourceId: string, space: SpaceModel, legendRooms: Set<string>): Promise<Array<{ id: string; kind: string }>> {
  // A render drawn over the plan names the plan's own rooms.
  if (legendRooms.size && [...legendRooms].every((id) => space.rooms.some((r) => r.id === id))) return space.rooms.map((r) => ({ id: r.id, kind: r.kind }));
  // A space inferred for the walkthrough from a photo set: that set's reconstruction is the reading.
  let id: string | null = sourceId;
  for (let hop = 0; hop < 3 && id; hop += 1) {
    const { data: s } = await admin.from('ds_spatial_sources').select('id, provenance').eq('id', id).maybeSingle();
    const recon = s?.provenance?.reconstructionId;
    if (typeof recon === 'string') {
      const { data: r } = await admin.from('ds_reconstructions').select('analysis').eq('id', recon).maybeSingle();
      const rooms = Array.isArray(r?.analysis?.rooms) ? r.analysis.rooms : [];
      const out = rooms.filter((x: Row) => typeof x?.id === 'string' && typeof x?.kind === 'string').map((x: Row) => ({ id: x.id, kind: x.kind }));
      if (out.length) return out;
    }
    id = typeof s?.provenance?.fromSourceId === 'string' ? s.provenance.fromSourceId : null;
  }
  return [];
}

export async function loadDesignEvidence(admin: Row, row: Row, space: SpaceModel, sourceId: string, renderBytes: Uint8Array | null): Promise<DesignEvidence | null> {
  if (!row.render_id) return null;
  const { data: r } = await admin.from('ds_renders').select('id, project_id, user_id, legend, map_key').eq('id', row.render_id).maybeSingle();
  if (!r || r.project_id !== row.project_id || String(r.user_id) !== String(row.user_id)) return null;
  const { data: jobs } = await admin.from('ds_jobs').select('id, output, user_id').eq('project_id', row.project_id).eq('kind', 'RENDER').eq('status', 'SUCCEEDED')
    .eq('input->>renderId', r.id).order('created_at', { ascending: false }).limit(3);
  const job = (jobs ?? []).find((j: Row) => j.output?.kind === 'SCENE_MAP' && String(j.user_id) === String(row.user_id));
  const sceneMap = (job ? validateScene(job.output) : []) as MapElement[];
  const legend: Legend | null = r.legend && Array.isArray(r.legend.entries) ? r.legend as Legend : null;
  if (!sceneMap.length && !legend) return null;
  const legendRooms = new Set<string>((legend?.entries ?? []).map((e) => e.roomId).filter((x): x is string => !!x));
  const sourceRooms = await sourceRoomsOf(admin, sourceId, space, legendRooms);

  // The render's pixels, region by region (the id image's colours are the legend's ids).
  let appearance: Record<string, RegionLook> | null = null;
  let pixels: DesignEvidence['report']['pixels'] = 'UNAVAILABLE';
  if (!legend || typeof r.map_key !== 'string') pixels = 'NO_ID_IMAGE';
  else if (renderBytes) {
    const res = await getObject(r.map_key).catch(() => null);
    const idBytes = res?.ok ? new Uint8Array(await res.arrayBuffer()) : null;
    if (!res?.ok) await res?.arrayBuffer().catch(() => null);
    if (idBytes && idBytes.length <= MAX_ID_IMAGE_BYTES) {
      const ids = decodeRgba(idBytes);
      const render = decodeRgba(renderBytes);
      if (ids.ok && render.ok) {
        appearance = regionAppearance(render.img, ids.img, legend.entries);
        pixels = 'MEASURED';
      }
    }
  }
  return {
    sceneMap, legend, sourceRooms, appearance,
    report: { sceneMapElements: sceneMap.length, legendEntries: legend?.entries.length ?? 0, sourceRooms: sourceRooms.length, pixels, regionsMeasured: appearance ? Object.keys(appearance).length : 0 },
  };
}
