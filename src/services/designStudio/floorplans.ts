// A CUSTOMER'S FLOOR PLAN, FROM FILE TO SPACE.
//
//   file (PNG / JPEG / WebP, or page 1 of a PDF rendered here)
//     → R2 (design-studio-floorplans, presigned, owner-only)
//     → ds_floorplans row (key + metadata only)
//     → design-studio-reconstruct/floorplan (edge): bytes checked, AI reading
//       stored as a PROPOSAL
//     → the customer keeps / removes elements and corrects room kinds
//     → Design Studio scale: estimated, calibrated or verified
//     → HOMATCH's deterministic generator builds the geometry
//     → ds_create_floorplan_source(): a new, immutable spatial source
//
// Nothing here claims more than the evidence: without a scale signal or a
// customer anchor there is no geometry, only a question.

import { supabase } from '@/db/supabase';
import type { FloorPlanDocument } from '@/services/developer/floorplan';
import type { Anchor, DimensionString, ReviewDecisions } from '@/lib/designStudio/scale';
import type { CanonicalSpace, GeometryState } from '@/lib/designStudio/types';
import type { PlanUnderstanding } from '@/lib/designStudio/planToHome';
import { uploadDesignFile } from './files';
import { DesignStudioError } from './projects';
import { storedFailure, watchOperation } from './durable';

export const PLAN_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'] as const;
export const MAX_PLAN_BYTES = 25 * 1024 * 1024;

export interface FloorPlanRecord {
  id: string;
  project_id: string;
  user_id: string;
  object_key: string;
  mime: string;
  bytes: number;
  image_width: number | null;
  image_height: number | null;
  status: 'UPLOADED' | 'INTERPRETING' | 'INTERPRETED' | 'FAILED';
  /** A drawn plan, or a picture of the home read by the reconstruction. */
  purpose?: 'PLAN' | 'REFERENCE';
  interpretation: {
    doc: FloorPlanDocument;
    dimensionStrings: DimensionString[];
    readVersion: string;
    /** ds-read-2: exactly what the model said, before fusion with the drawing's pixels (same element ids). */
    rawDoc?: FloorPlanDocument;
    /** ds-read-2: printed-size checks, topology issues, the questions worth asking, room adjacency. */
    understanding?: PlanUnderstanding | null;
    timings?: { modelMs?: number; fuseMs?: number; rasterMs?: number; raster?: string };
    /** Set when the reading was reused from an earlier upload of the same picture. */
    cachedFrom?: string;
  } | null;
  interpretation_error: string | null;
  corrections: Array<{ at: string; decisions: ReviewDecisions; anchors: Anchor[]; ceilingM: number | null }>;
  /** A reference picture's measured frame (pictureFrame.ts), when it is an isometric cut-away. */
  picture_geometry?: unknown;
  created_at: string;
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function imageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { reject(new DesignStudioError('DS_PLAN_UNREADABLE')); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

/**
 * Page 1 of a PDF, rendered in the browser to a PNG. pdf.js is loaded only
 * here (its own chunk), with script evaluation disabled: a PDF is drawn, never
 * run. Only the rendered page is uploaded.
 */
async function renderPdfFirstPage(file: Blob): Promise<Blob> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  try {
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    // Long side ~3000 px: enough for a drawing's text, well inside the 25 MB limit.
    const scale = Math.min(4, 3000 / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new DesignStudioError('DS_PLAN_UNREADABLE');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new DesignStudioError('DS_PLAN_UNREADABLE');
    return png;
  } finally {
    await pdf.destroy();
  }
}

/** Turn what the customer chose into the image HOMATCH will read, or refuse it with a reason. */
export async function preparePlanImage(file: File): Promise<{ blob: Blob; mime: string; width: number; height: number; fromPdf: boolean }> {
  const type = (file.type || '').toLowerCase();
  if (!(PLAN_TYPES as readonly string[]).includes(type)) throw new DesignStudioError('DS_PLAN_TYPE');
  if (file.size > MAX_PLAN_BYTES) throw new DesignStudioError('DS_PLAN_TOO_LARGE');
  const blob = type === 'application/pdf' ? await renderPdfFirstPage(file) : file;
  if (blob.size > MAX_PLAN_BYTES) throw new DesignStudioError('DS_PLAN_TOO_LARGE');
  const mime = type === 'application/pdf' ? 'image/png' : type;
  const { width, height } = await imageDimensions(blob);
  if (width < 64 || height < 64) throw new DesignStudioError('DS_PLAN_TOO_SMALL');
  return { blob, mime, width, height, fromPdf: type === 'application/pdf' };
}

export async function uploadFloorPlan(input: { userId: string; projectId: string; file: File }): Promise<FloorPlanRecord> {
  const prepared = await preparePlanImage(input.file);
  const { key } = await uploadDesignFile({
    accountId: input.userId, projectId: input.projectId, category: 'design-studio-floorplans',
    file: prepared.blob, contentType: prepared.mime, originalFilename: input.file.name, purpose: 'DS_FLOORPLAN',
  });
  const { data, error } = await supabase.from('ds_floorplans').insert({
    project_id: input.projectId,
    user_id: input.userId,
    object_key: key,
    mime: prepared.mime,
    bytes: prepared.blob.size,
    sha256: await sha256Hex(prepared.blob),
    image_width: prepared.width,
    image_height: prepared.height,
  }).select('*').single();
  if (error) throw new DesignStudioError('DS_REQUEST_FAILED', error.message);
  return data as FloorPlanRecord;
}

/**
 * Ask HOMATCH to read the drawing and watch until it is read (or failed).
 * The server owns the reading: leaving the page never stops it, and calling
 * this again for the same plan never starts a second one.
 */
export async function interpretFloorPlan(floorplanId: string, opts: { retry?: boolean; signal?: { cancelled: boolean } } = {}): Promise<void> {
  let retry = !!opts.retry;
  await watchOperation({
    signal: opts.signal,
    kick: () => {
      const body = { floorplanId, retry };
      retry = false; // one explicit retry per tap; later asks only watch
      return supabase.functions.invoke('design-studio-reconstruct/floorplan', { body });
    },
    poll: async () => {
      const plan = await getFloorPlan(floorplanId);
      if (!plan) return { state: 'FAILED', code: 'FILE_MISSING', retryable: false };
      if (plan.status === 'INTERPRETED' && plan.interpretation) return { state: 'DONE' };
      if (plan.status === 'FAILED') return { state: 'FAILED', ...storedFailure(plan.interpretation_error) };
      return null;
    },
  });
}

export async function latestFloorPlan(projectId: string): Promise<FloorPlanRecord | null> {
  // A drawn plan only: pictures of the home (REFERENCE) are read by the reconstruction, not here.
  const { data, error } = await supabase.from('ds_floorplans').select('*')
    .eq('project_id', projectId).eq('purpose', 'PLAN').order('created_at', { ascending: false }).limit(1);
  if (error) throw new DesignStudioError('DS_REQUEST_FAILED', error.message);
  return ((data ?? [])[0] as FloorPlanRecord | undefined) ?? null;
}

export async function getFloorPlan(id: string): Promise<FloorPlanRecord | null> {
  const { data, error } = await supabase.from('ds_floorplans').select('*').eq('id', id).maybeSingle();
  if (error) throw new DesignStudioError('DS_REQUEST_FAILED', error.message);
  return (data as FloorPlanRecord | null) ?? null;
}

/** The customer's review and measurements, appended — the history of how the scale was set. */
export async function recordReview(plan: FloorPlanRecord, entry: { decisions: ReviewDecisions; anchors: Anchor[]; ceilingM: number | null }): Promise<void> {
  const corrections = [...(plan.corrections ?? []), { at: new Date().toISOString(), ...entry }].slice(-50);
  const { error } = await supabase.from('ds_floorplans').update({ corrections }).eq('id', plan.id);
  if (error) throw new DesignStudioError('DS_REQUEST_FAILED', error.message);
}

/** Record the built geometry as a new spatial source (the database checks the truth claim). */
export async function createFloorPlanSource(input: {
  floorplanId: string; canonical: CanonicalSpace; geometryState: GeometryState; anchors: Anchor[];
}): Promise<string> {
  const { data, error } = await supabase.rpc('ds_create_floorplan_source', {
    p_floorplan_id: input.floorplanId,
    p_canonical: input.canonical,
    p_geometry_state: input.geometryState,
    p_calibration: { anchors: input.anchors, metresPerPx: input.canonical.metresPerPx, uncertainty: input.canonical.scaleUncertainty },
    p_generator_version: input.canonical.generatorVersion,
  });
  if (error) {
    const code = error.message.match(/\bDS_[A-Z_]+\b/)?.[0] ?? 'DS_REQUEST_FAILED';
    throw new DesignStudioError(code, error.message);
  }
  return data as string;
}
