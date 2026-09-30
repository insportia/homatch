// HOMATCH DESIGN STUDIO — permanently delete a project.
//
// POST …/design-studio-reconstruct/project-delete { projectId, confirmName }
//      (the caller's JWT; they must own the project)
//
// 1. ds_project_delete_begin runs AS THE CALLER: only the owner can begin,
//    and anyone else (admins included) reads it as not found. It hides the
//    project, freezes it and revokes every public share at once.
// 2. Every object under the project's storage prefixes is deleted from R2 —
//    listed from the bucket itself, so an upload that never got a row is
//    removed too — and every storage_objects row for the project is marked
//    DELETED (kept as the audit of what was removed).
// 3. ds_project_delete_finish (service role) refuses while anything ACTIVE or
//    PENDING remains, writes an anonymous tombstone and deletes the project;
//    all Design Studio rows cascade from it. Billing and usage rows are never
//    touched.
//
// Every step is idempotent, so an interrupted delete is finished by asking
// again. The typed name is checked here too, not only in the browser.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { serviceClient } from '../_shared/billing.ts';
import { refuseIfImpersonating } from '../_shared/impersonation.ts';
import { deleteObject, listObjects } from '../_shared/objectStore.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Every storage category a Design Studio project owns. */
export const PROJECT_CATEGORIES = ['design-studio-floorplans', 'design-studio-models', 'design-studio-thumbnails'] as const;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** The R2 prefixes a project's uploads live under. */
export function projectPrefixes(userId: string, projectId: string): string[] {
  return PROJECT_CATEGORIES.map((category) => `users/${userId}/${category}/${projectId}/`);
}

export async function handleProjectDelete(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: 'UNAUTHENTICATED' }, 401);

  const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: auth } = await caller.auth.getUser();
  if (!auth?.user) return json({ error: 'UNAUTHENTICATED' }, 401);

  const admin = serviceClient();
  // Deleting is irreversible: an impersonated session may never drive it.
  const refused = await refuseIfImpersonating(admin, authHeader, CORS);
  if (refused) return refused;

  let body: { projectId?: string; confirmName?: string };
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  if (typeof body.projectId !== 'string' || !UUID.test(body.projectId)) return json({ error: 'BAD_REQUEST' }, 400);

  // The confirmation is checked against the name the owner can see. A project
  // already being deleted (a retry) skips it: it has no visible name left.
  const { data: visible } = await caller.from('ds_projects')
    .select('id, name, deleting_at').eq('id', body.projectId).maybeSingle();
  if (visible && !visible.deleting_at
      && (typeof body.confirmName !== 'string' || body.confirmName.trim() !== String(visible.name).trim())) {
    return json({ error: 'CONFIRMATION_MISMATCH' }, 400);
  }

  // ── 1. Begin, as the caller: ownership is the database's decision ──
  const { data: begun, error: beginError } = await caller.rpc('ds_project_delete_begin', { p_project_id: body.projectId });
  if (beginError || !begun) {
    return /DS_NOT_FOUND/.test(beginError?.message ?? '') ? json({ error: 'NOT_FOUND' }, 404) : json({ error: 'DELETE_FAILED' }, 500);
  }
  const userId = String((begun as { userId: string }).userId);
  const projectId = body.projectId;

  // ── 2. Storage: the bucket is asked, not only the index ─────────────
  let removed = 0;
  try {
    for (const prefix of projectPrefixes(userId, projectId)) {
      for (const entry of await listObjects(prefix)) {
        await deleteObject(entry.key);
        removed += 1;
      }
      if ((await listObjects(prefix)).length) return json({ error: 'STORAGE_NOT_EMPTY', retry: true }, 503);
      await admin.from('storage_objects').update({ lifecycle: 'DELETED', deleted_at: new Date().toISOString() })
        .like('object_key', `${prefix}%`).in('lifecycle', ['PENDING', 'ACTIVE', 'ORPHANED']);
    }
    await admin.from('storage_objects').update({ lifecycle: 'DELETED', deleted_at: new Date().toISOString() })
      .eq('entity_type', 'ds_project').eq('entity_id', projectId).in('lifecycle', ['PENDING', 'ACTIVE', 'ORPHANED']);
  } catch {
    // Nothing is lost: the project stays hidden and unshared, and asking again resumes here.
    return json({ error: 'STORAGE_UNAVAILABLE', retry: true }, 503);
  }

  // ── 3. Finish, as the service: refuses unless storage is empty ──────
  const { data: finished, error: finishError } = await admin.rpc('ds_project_delete_finish', { p_project_id: projectId });
  if (finishError) {
    // Still-uploading storage or a job still at work: both clear on their own; ask again.
    if (/DS_STORAGE_NOT_EMPTY/.test(finishError.message)) return json({ error: 'STORAGE_NOT_EMPTY', retry: true }, 503);
    if (/DS_JOBS_ACTIVE/.test(finishError.message)) return json({ error: 'JOBS_ACTIVE', retry: true }, 503);
    return json({ error: 'DELETE_FAILED' }, 500);
  }

  return json({
    state: 'DELETED',
    sharesRevoked: (begun as { sharesRevoked?: number }).sharesRevoked ?? 0,
    objectsRemoved: removed,
    counts: (finished as { counts?: unknown } | null)?.counts ?? null,
  });
}
