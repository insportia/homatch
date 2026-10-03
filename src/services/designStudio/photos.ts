// Design Studio — THE CUSTOMER'S PHOTOS: upload, understanding, resume.
//
//   uploadPhotos        each photo stored once (a reading copy when it is
//                       large; the original kept); nothing is measured or
//                       reconstructed — the photo itself is designed over
//   startPhotoProject   the photos grouped into one reconstruction row: the
//                       project's single understanding, and the page's flow
//   understandPhotos    design-studio-reconstruct/photos, watched: the server
//                       owns the reading (durable.ts), so leaving the page
//                       never stops it and asking again never pays twice
//   photoProjectOf      the project's photo work, for a page opened later
//
// Retry never uploads again: the photos are already the server's.

import { supabase } from '@/db/supabase';
import { isPhotoUnderstanding, type PhotoFlowRecord, type PhotoUnderstanding } from '@/lib/designStudio/photoProject';
import { DesignStudioError } from './projects';
import { storedFailure, watchOperation } from './durable';
import type { FloorPlanRecord } from './floorplans';
import {
  createReconstruction, getReconstruction, listReconstructions, MAX_REFERENCES, referencesById, uploadReference, type ReconstructionRecord,
} from './reconstructions';

export const MAX_PHOTOS = MAX_REFERENCES;

export async function uploadPhotos(input: {
  userId: string; projectId: string; files: File[]; onEach?: (done: number, total: number) => void;
}): Promise<FloorPlanRecord[]> {
  const files = input.files.slice(0, MAX_PHOTOS);
  const out: FloorPlanRecord[] = [];
  for (const [i, file] of files.entries()) {
    out.push(await uploadReference({ userId: input.userId, projectId: input.projectId, file, measure: false }));
    input.onEach?.(i + 1, files.length);
  }
  return out;
}

export async function startPhotoProject(input: { userId: string; projectId: string; referenceIds: string[] }): Promise<ReconstructionRecord> {
  const recon = await createReconstruction({ userId: input.userId, projectId: input.projectId, referenceIds: input.referenceIds });
  return savePhotoFlow(recon, { kind: 'PHOTOS', step: 'READING', answers: [], startedAt: new Date().toISOString() });
}

/** The understanding of this project's photos, watched until the server has it (and the project's photo source). */
export async function understandPhotos(reconstructionId: string, opts: {
  language: string; originalName: string; retry?: boolean; signal?: { cancelled: boolean };
}): Promise<ReconstructionRecord> {
  let retry = !!opts.retry;
  await watchOperation({
    signal: opts.signal,
    kick: async () => {
      const body = { reconstructionId, language: opts.language, originalName: opts.originalName, retry };
      retry = false; // one explicit retry per tap; later asks only watch
      return supabase.functions.invoke('design-studio-reconstruct/photos', { body });
    },
    poll: async () => {
      const r = await getReconstruction(reconstructionId);
      if (!r) return { state: 'FAILED', code: 'NOT_FOUND', retryable: false };
      if (isPhotoUnderstanding(r.analysis) && r.built_source_id && r.built_version_id && (r.status === 'READ' || r.status === 'BUILT')) return { state: 'DONE' };
      if (r.status === 'FAILED') return { state: 'FAILED', ...storedFailure(r.error) };
      return null;
    },
  });
  const done = await getReconstruction(reconstructionId);
  if (!done) throw new DesignStudioError('DS_NOT_FOUND');
  return done;
}

export const flowOf = (r: ReconstructionRecord | null): PhotoFlowRecord | null => {
  const f = (r?.corrections as { flow?: PhotoFlowRecord } | undefined)?.flow;
  return f && f.kind === 'PHOTOS' ? f : null;
};

export const understandingOf = (r: ReconstructionRecord | null): PhotoUnderstanding | null =>
  (isPhotoUnderstanding(r?.analysis) ? (r!.analysis as unknown as PhotoUnderstanding) : null);

/** Merge into the page's flow record (the customer's own field on the row). */
export async function savePhotoFlow(recon: ReconstructionRecord, patch: Partial<PhotoFlowRecord>): Promise<ReconstructionRecord> {
  const fresh = (await getReconstruction(recon.id)) ?? recon;
  const flow: PhotoFlowRecord = { kind: 'PHOTOS', step: 'READING', answers: [], ...(flowOf(fresh) ?? {}), ...patch };
  const corrections = { ...(fresh.corrections ?? {}), flow };
  const { error } = await supabase.from('ds_reconstructions').update({ corrections } as never).eq('id', recon.id);
  if (error) throw new DesignStudioError('DS_REQUEST_FAILED', error.message);
  return { ...fresh, corrections } as ReconstructionRecord;
}

/** This project's photo work (newest), or null when the project is not a photo project. */
export async function photoProjectOf(projectId: string): Promise<ReconstructionRecord | null> {
  const all = await listReconstructions(projectId);
  return all.find((r) => !r.plan_source_id && (flowOf(r) || isPhotoUnderstanding(r.analysis))) ?? null;
}

export async function photosOf(recon: ReconstructionRecord): Promise<FloorPlanRecord[]> {
  return referencesById(recon.reference_ids);
}

/**
 * A floor plan sent through Photos (the reading answered IS_FLOOR_PLAN): the same uploaded file becomes the
 * project's floor plan, read by the floor-plan reading — the customer uploads nothing again.
 */
export async function planFromPhotos(recon: ReconstructionRecord): Promise<FloorPlanRecord> {
  const [ref] = await referencesById(recon.reference_ids.slice(0, 1));
  if (!ref) throw new DesignStudioError('DS_FILE_MISSING');
  const { data, error } = await supabase.from('ds_floorplans').insert({
    project_id: recon.project_id, user_id: recon.user_id, object_key: ref.object_key, mime: ref.mime, bytes: ref.bytes,
    sha256: (ref as unknown as { sha256?: string | null }).sha256 ?? null, image_width: ref.image_width, image_height: ref.image_height,
  }).select('*').single();
  if (error) throw new DesignStudioError('DS_REQUEST_FAILED', error.message);
  return data as FloorPlanRecord;
}
