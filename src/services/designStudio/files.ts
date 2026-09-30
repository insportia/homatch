// DESIGN STUDIO FILES — on the existing HOMATCH R2 path, nothing parallel.
//
// Every Design Studio file goes through src/services/storage/objectStore.ts
// (presigned single-object URLs from the storage-sign edge function) into
// account-scoped keys:
//
//   users/<users.id>/design-studio-floorplans/<ds_projects.id>/<uuid>.<ext>
//   users/<users.id>/design-studio-models/<ds_projects.id>/<uuid>.glb
//   users/<users.id>/design-studio-thumbnails/<ds_projects.id>/<uuid>.webp
//
// storage_authorize() resolves the owner from the ds_projects row (owner
// only; Admin read-only). The database keeps the KEY and metadata; bytes
// never live in Postgres, and a URL is minted only when somebody looks.

import { accountObjectKey, signedReadUrl, uploadObject } from '@/services/storage/objectStore';
import { supabase } from '@/db/supabase';

export type DesignFileCategory = 'design-studio-floorplans' | 'design-studio-models' | 'design-studio-thumbnails';

export async function uploadDesignFile(input: {
  accountId: string;
  projectId: string;
  category: DesignFileCategory;
  file: Blob;
  contentType: string;
  originalFilename?: string;
  purpose: string;
}): Promise<{ key: string; size: number | null }> {
  const key = accountObjectKey({
    accountId: input.accountId, category: input.category, entityId: input.projectId, contentType: input.contentType,
  });
  return uploadObject(key, input.file, {
    contentType: input.contentType,
    originalFilename: input.originalFilename,
    visibility: 'PRIVATE',
    purpose: input.purpose,
  });
}

/** Short-lived read URLs for many keys; a key that cannot be signed is simply absent. */
export async function signedUrls(keys: string[], expiresIn = 600): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all([...new Set(keys.filter(Boolean))].map(async (key) => {
    try {
      out.set(key, (await signedReadUrl(key, { expiresIn })).url);
    } catch {
      /* unsigned (not configured, not permitted): the caller shows no image */
    }
  }));
  return out;
}

/**
 * Store a version thumbnail: a small WebP of the current view. Best effort —
 * a thumbnail that fails to upload never affects the design itself.
 */
export async function saveVersionThumbnail(input: {
  accountId: string; projectId: string; versionId: string; image: Blob;
}): Promise<string | null> {
  try {
    const { key } = await uploadDesignFile({
      accountId: input.accountId, projectId: input.projectId, category: 'design-studio-thumbnails',
      file: input.image, contentType: input.image.type || 'image/webp', purpose: 'DS_VERSION_THUMBNAIL',
    });
    const { error } = await supabase.from('ds_versions').update({ thumbnail_key: key }).eq('id', input.versionId);
    if (error) return null;
    await supabase.from('ds_projects').update({ thumbnail_key: key }).eq('id', input.projectId);
    return key;
  } catch {
    return null;
  }
}
