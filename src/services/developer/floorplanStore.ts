import { supabase } from '@/db/supabase';
import { run, runList, rpc } from './client';
import type {
  FloorPlanDocument, FloorPlanRecord, VerificationState,
} from './floorplan';

/**
 * READING AND CORRECTING A FLOOR PLAN, WITH THE AUDIT BUILT INTO THE SHAPE.
 *
 * Three columns, never collapsed:
 *
 *   extraction    what the model said. This module never writes it after the
 *                 edge function has, and nothing here can.
 *   corrections   every change a person made, keyed by element id, with the
 *                 old value beside the new one.
 *   verified      the document the geometry generator consumes, rebuilt from
 *                 the extraction plus the corrections each time one is made.
 *
 * So "did the model put that wall there, or did we?" is answerable by reading
 * two columns, for ever, rather than by hoping somebody wrote a log.
 *
 * Every write below goes through dt_floorplans_write, which requires
 * dev_is_studio(). A developer can read their own plan and cannot verify it.
 */

export async function listFloorPlans(workspaceId: string): Promise<FloorPlanRecord[]> {
  return runList<FloorPlanRecord>(
    'listFloorPlans',
    supabase.from('dt_floorplans').select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false }),
    workspaceId,
  );
}

export async function getFloorPlan(id: string): Promise<FloorPlanRecord | null> {
  const rows = await runList<FloorPlanRecord>(
    'getFloorPlan',
    supabase.from('dt_floorplans').select('*').eq('id', id).limit(1),
    id,
  );
  return rows[0] ?? null;
}

export async function createFloorPlan(input: {
  workspaceId: string;
  assetId: string;
  projectId?: string | null;
  unitTypeId?: string | null;
}): Promise<FloorPlanRecord> {
  return run<FloorPlanRecord>(
    'createFloorPlan',
    supabase.from('dt_floorplans').insert({
      workspace_id: input.workspaceId,
      asset_id: input.assetId,
      project_id: input.projectId ?? null,
      unit_type_id: input.unitTypeId ?? null,
      status: 'EXTRACTING',
    }).select().single(),
    input.workspaceId,
  );
}

// ── Corrections ────────────────────────────────────────────────────────────

export type ElementKind = 'wall' | 'door' | 'window' | 'room' | 'balcony';

export interface Correction {
  /** When a person made it, so the record reads as a history. */
  at: string;
  kind: ElementKind | 'scale' | 'ceiling';
  elementId: string | null;
  /** What it was before — the half that makes this auditable. */
  before: unknown;
  after: unknown;
}

const COLLECTION: Record<ElementKind, keyof FloorPlanDocument> = {
  wall: 'walls',
  door: 'doors',
  window: 'windows',
  room: 'rooms',
  balcony: 'balconies',
};

/**
 * Rebuild the verified document from the extraction plus every correction.
 *
 * REPLAYED RATHER THAN PATCHED IN PLACE: the verified document is a pure
 * function of (extraction, corrections), so a correction can be removed later
 * and the result is exactly what it would have been without it. A document
 * edited in place has no such property and drifts from its own history.
 */
export function replay(
  extraction: FloorPlanDocument,
  corrections: Correction[],
): FloorPlanDocument {
  const doc: FloorPlanDocument = JSON.parse(JSON.stringify(extraction));

  for (const correction of corrections) {
    if (correction.kind === 'scale') {
      const after = correction.after as { detectedScale: number | null } | null;
      doc.detectedScale = after?.detectedScale ?? null;
      // A person accepting or typing a scale is the only thing that makes it
      // certain; the model's own reading never reaches 1.
      doc.scaleConfidence = doc.detectedScale == null ? 0 : 1;
      continue;
    }
    if (correction.kind === 'ceiling') {
      const after = correction.after as { ceilingHeight: number | null } | null;
      doc.ceilingHeight = after?.ceilingHeight ?? null;
      doc.ceilingHeightSource = doc.ceilingHeight == null ? null : 'OPERATOR';
      continue;
    }

    const key = COLLECTION[correction.kind];
    const list = doc[key] as unknown as Array<{ id: string }>;
    if (!Array.isArray(list)) continue;
    const index = list.findIndex((el) => el.id === correction.elementId);
    if (index < 0) continue;
    if (correction.after === null) {
      // A rejected element is kept, marked REJECTED, so the record still shows
      // that the model proposed it and a person threw it out.
      list[index] = { ...list[index], state: 'REJECTED' } as never;
    } else {
      list[index] = { ...list[index], ...(correction.after as object) } as never;
    }
  }

  return doc;
}

function historyOf(record: FloorPlanRecord): Correction[] {
  const raw = (record.corrections ?? {}) as { history?: unknown };
  return Array.isArray(raw.history) ? (raw.history as Correction[]) : [];
}

/**
 * Record one correction and rewrite the verified document from scratch.
 *
 * The status follows the document rather than the person's intent: a plan is
 * VERIFIED only when nothing required is still unverified, which is the gate's
 * judgement and not this function's.
 */
export async function applyCorrection(
  record: FloorPlanRecord,
  correction: Omit<Correction, 'at'>,
  stillNeedsReview: (doc: FloorPlanDocument) => boolean,
): Promise<FloorPlanRecord> {
  if (!record.extraction) throw new Error('This plan has not been read yet.');

  const history = [...historyOf(record), { ...correction, at: new Date().toISOString() }];
  const verified = replay(record.extraction, history);

  return run<FloorPlanRecord>(
    'applyCorrection',
    supabase.from('dt_floorplans').update({
      corrections: { history },
      verified,
      status: stillNeedsReview(verified) ? 'NEEDS_REVIEW' : 'VERIFIED',
    }).eq('id', record.id).select().single(),
    record.workspace_id,
  );
}

/** Accept an element exactly as the model read it. Still a correction. */
export function acceptElement(kind: ElementKind, elementId: string, before: unknown): Omit<Correction, 'at'> {
  return { kind, elementId, before, after: { state: 'VERIFIED' as VerificationState } };
}

/** Throw an element out. It is kept and marked, never deleted. */
export function rejectElement(kind: ElementKind, elementId: string, before: unknown): Omit<Correction, 'at'> {
  return { kind, elementId, before, after: null };
}

export async function markGenerated(record: FloorPlanRecord): Promise<void> {
  await run<FloorPlanRecord>(
    'markGenerated',
    supabase.from('dt_floorplans').update({ status: 'GENERATED' })
      .eq('id', record.id).select().single(),
    record.workspace_id,
  );
}

/**
 * Ask the reader to look at a drawing. Authoring time only.
 *
 * NOTHING IN THE VIEWER CALLS THIS. A buyer opening an apartment renders
 * published geometry and makes no model call, however many times they rotate
 * it — which is the difference between a per-view bill and a one-off one.
 */
export async function requestExtraction(input: {
  floorplanId: string;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
}): Promise<{ state: string; extractionConfidence?: number }> {
  const { data, error } = await supabase.functions.invoke('developer-floorplan-extract', {
    body: input,
  });
  if (error) throw error;
  return data as { state: string; extractionConfidence?: number };
}

/** What the pipeline has cost this workspace, by category. */
export async function pipelineCosts(workspaceId: string): Promise<Array<{
  category: string; cost_cents: number; created_at: string; model: string | null;
}>> {
  return runList(
    'pipelineCosts',
    supabase.from('dt_pipeline_costs')
      .select('category, cost_cents, created_at, model')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(200),
    workspaceId,
  );
}

export { rpc };
