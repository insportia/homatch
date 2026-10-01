// HOMATCH DESIGN STUDIO — physical deletion of catalogue files (admin only).
//
//   POST …/design-studio-model/catalog-purge   Authorization: Bearer <admin session>
//     { ids: [homatchAssetId…], confirmCount }
//
// Availability is not storage. This is the ONLY place catalogue files are
// physically deleted, and only for assets that an admin has already queued
// for deletion (lifecycle PENDING_DELETE). Immediately before deleting, the
// dependencies are counted again with the service role: an asset any saved
// design version or public share references is refused and left untouched,
// with its counts. A purge is bounded (200 assets), confirmed (confirmCount
// must equal the selection), not available to an impersonated session, and
// audited (DELETED / DELETE_BLOCKED with the acting admin).
//
// For a deleted asset: every R2 object it owns (all variants and delivery
// classes) is deleted, its storage ledger rows become DELETED, its catalogue
// row stays (inactive) for history, and its lifecycle becomes DELETED.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { serviceClient } from '../_shared/billing.ts';
import { refuseIfImpersonating } from '../_shared/impersonation.ts';
import { deleteObject } from '../_shared/objectStore.ts';
import { purgePlan } from './catalogPolicy.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

export const MAX_PURGE = 200;

export async function handleCatalogPurge(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: 'UNAUTHENTICATED' }, 401);

  // The caller's own session decides who they are; the admin flag comes from the database.
  const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: auth } = await caller.auth.getUser();
  if (!auth?.user) return json({ error: 'UNAUTHENTICATED' }, 401);
  const { data: isAdmin } = await caller.rpc('is_admin');
  if (isAdmin !== true) return json({ error: 'NOT_ADMIN' }, 403);

  const admin = serviceClient();
  const refused = await refuseIfImpersonating(admin, authHeader, CORS);
  if (refused) return refused;

  let body: { ids?: unknown; confirmCount?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'INVALID_BODY' }, 400); }
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter((x): x is string => typeof x === 'string' && /^hma_[0-9a-z]{26}$/.test(x)))] : [];
  if (!ids.length) return json({ error: 'NOTHING_SELECTED' }, 400);
  if (ids.length > MAX_PURGE) return json({ error: 'TOO_MANY', max: MAX_PURGE }, 400);
  if (body.confirmCount !== ids.length) return json({ error: 'CONFIRM_MISMATCH', selected: ids.length }, 400);

  const { data: actorRow } = await admin.from('users').select('id').eq('auth_id', auth.user.id).maybeSingle();
  const actor = (actorRow as { id?: string } | null)?.id ?? null;

  const { data: imports, error: impErr } = await admin.from('ds_catalog_imports')
    .select('homatch_asset_id, kind, lifecycle, import_batch_id').in('homatch_asset_id', ids);
  if (impErr) return json({ error: 'UNAVAILABLE' }, 503);
  // Counted again now, with the service role — never trusted from the browser.
  const { data: deps, error: depErr } = await admin.rpc('ds_catalog_dependencies', { p_ids: ids });
  if (depErr) return json({ error: 'UNAVAILABLE' }, 503);

  const plan = purgePlan(ids, (imports ?? []) as Array<{ homatch_asset_id: string; lifecycle: string }>,
    (deps ?? []) as Array<{ homatch_asset_id: string; versions: number; published: number }>);

  let objects = 0; let bytes = 0; const deleted: string[] = []; const failed: Array<{ homatch_asset_id: string; reason: string }> = [];
  for (const hma of plan.deletable) {
    const { data: files } = await admin.from('ds_catalog_files').select('object_key, bytes').eq('homatch_asset_id', hma);
    let ok = true;
    for (const f of (files ?? []) as Array<{ object_key: string; bytes: number }>) {
      try { await deleteObject(f.object_key); objects += 1; bytes += Number(f.bytes ?? 0); } catch { ok = false; }
    }
    if (!ok) { failed.push({ homatch_asset_id: hma, reason: 'object store unavailable; nothing marked deleted' }); continue; }
    const keys = ((files ?? []) as Array<{ object_key: string }>).map((f) => f.object_key);
    if (keys.length) await admin.from('storage_objects').update({ lifecycle: 'DELETED', deleted_at: new Date().toISOString() }).in('object_key', keys);
    await admin.from('ds_catalog_imports').update({ lifecycle: 'DELETED', lifecycle_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('homatch_asset_id', hma);
    deleted.push(hma);
  }

  const batchOf = new Map(((imports ?? []) as Array<{ homatch_asset_id: string; import_batch_id: string | null }>).map((r) => [r.homatch_asset_id, r.import_batch_id]));
  const batches = (list: string[]) => [...new Set(list.map((x) => batchOf.get(x)).filter((x): x is string => Boolean(x)))];
  if (deleted.length) {
    await admin.from('ds_catalog_admin_events').insert({ actor_user_id: actor, actor_kind: 'ADMIN', action: 'DELETED', asset_count: deleted.length,
      homatch_asset_ids: deleted, import_batch_ids: batches(deleted), detail: { objects, bytes, failed } });
  }
  const blocked = [...plan.blocked, ...failed];
  if (blocked.length) {
    await admin.from('ds_catalog_admin_events').insert({ actor_user_id: actor, actor_kind: 'ADMIN', action: 'DELETE_BLOCKED', asset_count: blocked.length,
      homatch_asset_ids: blocked.map((b) => b.homatch_asset_id), import_batch_ids: batches(blocked.map((b) => b.homatch_asset_id)), detail: { blocked } });
  }
  return json({ deleted: deleted.length, objects, bytes, blocked });
}
