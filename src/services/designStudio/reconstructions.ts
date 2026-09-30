// HOMATCH DESIGN STUDIO — pictures of a home, read into a design.
//
// The browser side of reconstruction: upload the customer's pictures (each
// its own ds_floorplans row, purpose REFERENCE, under the same storage
// rules as a floor plan), ask the server to read them, keep the customer's
// corrections, and record what was built. The reading itself — and every
// field the customer may not write — belongs to the server and the
// database guard.

import { supabase } from '@/db/supabase';
import type { Reconstruction } from '@/lib/designStudio/reconstructRead';
import type { ReconCorrections } from '@/lib/designStudio/reconstruction';
import type { DesignState } from '@/lib/designStudio/designState';
import { uploadDesignFile } from './files';
import type { FloorPlanRecord } from './floorplans';
import { DesignStudioError, setHeadVersion } from './projects';
import type { DesignVersionRecord } from '@/lib/designStudio/types';

export const REFERENCE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const MAX_REFERENCE_INPUT_BYTES = 40 * 1024 * 1024;
export const MAX_REFERENCES = 6;
/** Pictures are sent at most this long on their longest side: plenty to read a room, light to upload. */
const MAX_EDGE_PX = 2560;

export type ReconstructionStatus = 'QUEUED' | 'READING' | 'READ' | 'FAILED' | 'BUILT';

export interface ReconstructionRecord {
  id: string;
  project_id: string;
  user_id: string;
  reference_ids: string[];
  plan_source_id: string | null;
  status: ReconstructionStatus;
  analysis: Reconstruction | null;
  model: string | null;
  error: string | null;
  corrections: Partial<ReconCorrections>;
  built_source_id: string | null;
  built_version_id: string | null;
  created_at: string;
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The picture HOMATCH will read: the customer's own, re-encoded as a JPEG
 * no longer than MAX_EDGE_PX on its longest side when it is bigger than
 * that (a phone photo or a 6K render), otherwise untouched.
 */
export async function prepareReferenceImage(file: File): Promise<{ blob: Blob; mime: string; width: number; height: number; originalWidth: number; originalHeight: number }> {
  const type = (file.type || '').toLowerCase();
  if (!(REFERENCE_TYPES as readonly string[]).includes(type)) throw new DesignStudioError('DS_REFERENCE_TYPE');
  if (file.size > MAX_REFERENCE_INPUT_BYTES) throw new DesignStudioError('DS_REFERENCE_TOO_LARGE');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new DesignStudioError('DS_REFERENCE_UNREADABLE'); }
  try {
    const { width, height } = bitmap;
    if (width < 64 || height < 64) throw new DesignStudioError('DS_REFERENCE_TOO_SMALL');
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(width, height));
    if (scale === 1 && file.size <= 8 * 1024 * 1024) return { blob: file, mime: type, width, height, originalWidth: width, originalHeight: height };
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new DesignStudioError('DS_REFERENCE_UNREADABLE');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) throw new DesignStudioError('DS_REFERENCE_UNREADABLE');
    return { blob, mime: 'image/jpeg', width: w, height: h, originalWidth: width, originalHeight: height };
  } finally {
    bitmap.close();
  }
}

/**
 * Upload one picture of the home as a reference (never as a floor plan).
 * The customer's ORIGINAL is always kept, unchanged; when it is bigger than
 * the reading size a separate analysis copy is what HOMATCH reads.
 */
export async function uploadReference(input: { userId: string; projectId: string; file: File }): Promise<FloorPlanRecord> {
  const prepared = await prepareReferenceImage(input.file);
  const derived = prepared.blob !== input.file;
  const { key } = await uploadDesignFile({
    accountId: input.userId, projectId: input.projectId, category: 'design-studio-floorplans',
    file: prepared.blob, contentType: prepared.mime, originalFilename: input.file.name,
    purpose: derived ? 'DS_REFERENCE_ANALYSIS' : 'DS_REFERENCE',
  });
  // The original: its own object when a derivative was made, else the same one.
  const original = derived
    ? (await uploadDesignFile({
      accountId: input.userId, projectId: input.projectId, category: 'design-studio-floorplans',
      file: input.file, contentType: input.file.type.toLowerCase(), originalFilename: input.file.name, purpose: 'DS_REFERENCE_ORIGINAL',
    })).key
    : key;
  const analysisSha = await sha256Hex(prepared.blob);
  const { data, error } = await supabase.from('ds_floorplans').insert({
    original_key: original,
    original_mime: input.file.type.toLowerCase(),
    original_bytes: input.file.size,
    original_sha256: derived ? await sha256Hex(input.file) : analysisSha,
    original_width: prepared.originalWidth,
    original_height: prepared.originalHeight,
    project_id: input.projectId,
    user_id: input.userId,
    object_key: key,
    mime: prepared.mime,
    bytes: prepared.blob.size,
    sha256: analysisSha,
    image_width: prepared.width,
    image_height: prepared.height,
    purpose: 'REFERENCE',
  }).select('*').single();
  if (error) throw new DesignStudioError('DS_REQUEST_FAILED', error.message);
  return data as FloorPlanRecord;
}

export async function createReconstruction(input: { userId: string; projectId: string; referenceIds: string[]; planSourceId?: string | null }): Promise<ReconstructionRecord> {
  const { data, error } = await supabase.from('ds_reconstructions').insert({
    project_id: input.projectId,
    user_id: input.userId,
    reference_ids: input.referenceIds,
    plan_source_id: input.planSourceId ?? null,
  }).select('*').single();
  if (error) throw new DesignStudioError(error.message.match(/\bDS_[A-Z_]+\b/)?.[0] ?? 'DS_REQUEST_FAILED', error.message);
  return data as ReconstructionRecord;
}

/** Ask HOMATCH to read the pictures. Returns when the reading is stored (or failed, with its reason). */
export async function runReconstruction(reconstructionId: string, language = 'en'): Promise<void> {
  const { error } = await supabase.functions.invoke('design-studio-reconstruct', { body: { reconstructionId, language } });
  if (error) {
    let code = 'DS_READING_FAILED';
    try {
      const body = await (error as { context?: Response }).context?.json();
      if (typeof body?.reason === 'string') code = `DS_${body.reason}`;
      else if (typeof body?.error === 'string') code = `DS_${body.error}`;
    } catch { /* keep the generic code */ }
    throw new DesignStudioError(code);
  }
}

export async function getReconstruction(id: string): Promise<ReconstructionRecord | null> {
  const { data, error } = await supabase.from('ds_reconstructions').select('*').eq('id', id).maybeSingle();
  if (error) throw new DesignStudioError('DS_REQUEST_FAILED', error.message);
  return (data as ReconstructionRecord | null) ?? null;
}

/** The project's reconstructions, newest first (the workspace's reference pictures come from here). */
export async function listReconstructions(projectId: string): Promise<ReconstructionRecord[]> {
  const { data, error } = await supabase.from('ds_reconstructions').select('*')
    .eq('project_id', projectId).order('created_at', { ascending: false }).limit(20);
  if (error) throw new DesignStudioError('DS_REQUEST_FAILED', error.message);
  return (data ?? []) as ReconstructionRecord[];
}

export async function referencesById(ids: string[]): Promise<FloorPlanRecord[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase.from('ds_floorplans').select('*').in('id', ids);
  if (error) throw new DesignStudioError('DS_REQUEST_FAILED', error.message);
  const by = new Map(((data ?? []) as FloorPlanRecord[]).map((r) => [r.id, r]));
  return ids.map((id) => by.get(id)).filter((r): r is FloorPlanRecord => !!r);
}

export async function saveCorrections(id: string, corrections: ReconCorrections): Promise<void> {
  const { error } = await supabase.from('ds_reconstructions').update({ corrections }).eq('id', id);
  if (error) throw new DesignStudioError('DS_REQUEST_FAILED', error.message);
}

export async function markBuilt(id: string, sourceId: string, versionId: string): Promise<void> {
  const { error } = await supabase.from('ds_reconstructions')
    .update({ status: 'BUILT', built_source_id: sourceId, built_version_id: versionId }).eq('id', id);
  if (error) throw new DesignStudioError('DS_REQUEST_FAILED', error.message);
}

/** The reconstructed design as the space's first version (made the head). */
export async function createReconstructedVersion(input: {
  userId: string; projectId: string; sourceId: string; name: string; state: DesignState; styleTags: string[];
}): Promise<DesignVersionRecord> {
  const { data, error } = await supabase.from('ds_versions').insert({
    project_id: input.projectId,
    user_id: input.userId,
    source_id: input.sourceId,
    name: input.name.trim().slice(0, 80),
    origin: 'ORIGINAL',
    state: input.state,
    style_tags: input.styleTags.slice(0, 8),
    change_summary: [{ kind: 'RECONSTRUCTED', pieces: input.state.objects.length }],
  }).select('*').single();
  if (error) throw new DesignStudioError('DS_REQUEST_FAILED', error.message);
  const version = data as DesignVersionRecord;
  await setHeadVersion(input.projectId, version.id);
  return version;
}
