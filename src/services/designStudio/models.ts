// A CUSTOMER'S OWN 3D MODEL, FROM FILE TO SPACE.
//
//   .glb / .gltf (self-contained)
//     → quick checks here, so an obvious mistake is refused before upload
//     → R2 (design-studio-models, presigned, owner-only)
//     → design-studio-model edge function: the bytes are inspected on the
//       server — structure, external resources, decoders, complexity,
//       textures, normalization, semantics, editability
//     → a new, immutable UPLOADED_MODEL spatial source
//
// The browser's checks are a courtesy; the server's are the decision.
// OBJ, FBX, SKP and the rest are refused by name: converting them needs a
// conversion service HOMATCH does not run.

import { supabase } from '@/db/supabase';
import { uploadDesignFile } from './files';
import { DesignStudioError } from './projects';

export const MAX_MODEL_BYTES = 100 * 1024 * 1024;
const OTHER_FORMATS = /\.(obj|fbx|skp|3ds|dae|blend|max|stl|ply|usdz?|ifc|rvt|dwg|dxf)$/i;

export interface ModelImportResult {
  sourceId: string;
  editability: 'FULLY_STRUCTURED' | 'PARTIALLY_STRUCTURED' | 'VISUAL_MODEL' | null;
  warnings: string[];
  reused: boolean;
}

/** What the file is, from its name and first bytes; refused with a reason when it cannot be a glTF. */
export async function prepareModelFile(file: File): Promise<{ contentType: 'model/gltf-binary' | 'model/gltf+json' }> {
  const name = file.name.toLowerCase();
  if (OTHER_FORMATS.test(name)) throw new DesignStudioError('DS_MODEL_OTHER_FORMAT');
  if (!/\.(glb|gltf)$/.test(name)) throw new DesignStudioError('DS_MODEL_NOT_GLTF');
  if (file.size > MAX_MODEL_BYTES) throw new DesignStudioError('DS_MODEL_TOO_LARGE');
  if (file.size < 20) throw new DesignStudioError('DS_MODEL_NOT_GLTF');
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const isGlb = head[0] === 0x67 && head[1] === 0x6c && head[2] === 0x54 && head[3] === 0x46; // 'glTF'
  if (name.endsWith('.glb')) {
    if (!isGlb) throw new DesignStudioError('DS_MODEL_NOT_GLTF');
    return { contentType: 'model/gltf-binary' };
  }
  const text = new TextDecoder().decode(head).replace(/^﻿/, '').trimStart();
  if (!text.startsWith('{')) throw new DesignStudioError('DS_MODEL_NOT_GLTF');
  return { contentType: 'model/gltf+json' };
}

export async function importModel(input: { userId: string; projectId: string; file: File }): Promise<ModelImportResult> {
  const { contentType } = await prepareModelFile(input.file);
  const { key } = await uploadDesignFile({
    accountId: input.userId, projectId: input.projectId, category: 'design-studio-models',
    file: input.file, contentType, originalFilename: input.file.name, purpose: 'DS_MODEL',
  });
  const { data, error } = await supabase.functions.invoke('design-studio-model', {
    body: { projectId: input.projectId, key, filename: input.file.name },
  });
  if (error) {
    let code = 'DS_MODEL_FAILED';
    try {
      const body = await (error as { context?: Response }).context?.json();
      if (typeof body?.reason === 'string') code = `DS_MODEL_${body.reason}`;
      else if (typeof body?.error === 'string') code = `DS_MODEL_${body.error}`;
    } catch { /* keep the generic code */ }
    throw new DesignStudioError(code);
  }
  const r = data as { sourceId?: string; editability?: ModelImportResult['editability']; warnings?: string[]; reused?: boolean } | null;
  if (!r?.sourceId) throw new DesignStudioError('DS_MODEL_FAILED');
  return { sourceId: r.sourceId, editability: r.editability ?? null, warnings: r.warnings ?? [], reused: !!r.reused };
}
