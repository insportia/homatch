// HOMATCH DESIGN STUDIO — AN UPLOADED 3D MODEL BECOMES A SPACE.
//
//   POST { projectId, key, filename? }   (signed-in customer, own project)
//
// The browser has already put the file in R2 through storage-sign
// (design-studio-models, presigned, owner-only). This function reads those
// bytes back — never the browser's description of them — and runs the
// Design Studio model inspector: structure, bounds, external resources,
// decoders, complexity, textures, normalization, semantic analysis and the
// editability classification. A model that passes becomes a new, immutable
// UPLOADED_MODEL spatial source. The upload itself is never rewritten.
//
// No AI, no provider cost, nothing billable: inspection is part of editing.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { serviceClient } from '../_shared/billing.ts';
import { refuseIfImpersonating } from '../_shared/impersonation.ts';
import { getObject, headObject } from '../_shared/objectStore.ts';
import { inspectModel, MODEL_INSPECT_VERSION, MODEL_LIMITS } from '../_shared/designStudio/modelInspect.ts';
import { handleCatalog } from './catalog.ts';
import { handleCatalogPurge } from './catalogPurge.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A file name for display only: no paths, no control characters, bounded. */
function displayName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
  return clean || null;
}

serve(async (req) => {
  // The catalogue importer's signing route (service role only; see catalog.ts).
  if (new URL(req.url).pathname.replace(/\/+$/, '').endsWith('/catalog')) return handleCatalog(req);
  // Physical deletion of unreferenced, queued catalogue files (admin only; see catalogPurge.ts).
  if (new URL(req.url).pathname.replace(/\/+$/, '').endsWith('/catalog-purge')) return handleCatalogPurge(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: 'UNAUTHENTICATED' }, 401);

  const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: auth } = await caller.auth.getUser();
  if (!auth?.user) return json({ error: 'UNAUTHENTICATED' }, 401);

  const admin = serviceClient();
  // This function writes with the service role, so an impersonated session may not drive it.
  const refused = await refuseIfImpersonating(admin, authHeader, CORS);
  if (refused) return refused;

  let body: { projectId?: string; key?: string; filename?: string };
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  if (typeof body.projectId !== 'string' || !UUID.test(body.projectId) || typeof body.key !== 'string') {
    return json({ error: 'BAD_REQUEST' }, 400);
  }

  // RLS decides ownership: a project that is not the caller's reads as not found.
  const { data: project } = await caller.from('ds_projects')
    .select('id, user_id, status').eq('id', body.projectId).maybeSingle();
  if (!project) return json({ error: 'NOT_FOUND' }, 404);
  if (project.status !== 'ACTIVE') return json({ error: 'PROJECT_ARCHIVED' }, 409);

  const prefix = `users/${project.user_id}/design-studio-models/${project.id}/`;
  const key = body.key;
  if (!key.startsWith(prefix) || key.includes('..') || !/\.(glb|gltf)$/i.test(key)) {
    return json({ error: 'INVALID_KEY' }, 400);
  }

  const { data: job } = await admin.from('ds_jobs').insert({
    user_id: project.user_id, project_id: project.id, kind: 'MODEL_INGEST', status: 'RUNNING',
    input: { key }, model: MODEL_INSPECT_VERSION, started_at: new Date().toISOString(),
  }).select('id').single();
  const jobId = (job as { id?: string } | null)?.id;

  const fail = async (reason: string, detail?: string) => {
    if (jobId) {
      await admin.from('ds_jobs').update({
        status: 'FAILED', error: detail ? `${reason}: ${detail}`.slice(0, 300) : reason, finished_at: new Date().toISOString(),
      }).eq('id', jobId);
    }
    return json({ state: 'FAILED', reason, detail: detail ?? null }, 422);
  };

  // ── The bytes, checked ─────────────────────────────────────────────
  const facts = await headObject(key);
  if (!facts.exists) return fail('FILE_MISSING');
  if ((facts.size ?? 0) > MODEL_LIMITS.maxBytes) return fail('TOO_LARGE');
  const res = await getObject(key);
  if (!res.ok) return fail('FILE_UNREADABLE');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MODEL_LIMITS.maxBytes) return fail('TOO_LARGE');

  const sha256 = await sha256Hex(bytes);
  // The same file for the same project is the same space: no duplicate rows.
  const { data: existing } = await admin.from('ds_spatial_sources')
    .select('id, editability').eq('project_id', project.id).eq('kind', 'UPLOADED_MODEL')
    .eq('model_sha256', sha256).eq('status', 'READY').maybeSingle();
  if (existing) {
    if (jobId) await admin.from('ds_jobs').update({ status: 'SUCCEEDED', output: { sourceId: existing.id, reused: true }, finished_at: new Date().toISOString() }).eq('id', jobId);
    return json({ state: 'READY', sourceId: existing.id, reused: true });
  }

  const result = inspectModel(bytes);
  if (!result.ok) return fail(result.reason, result.detail);
  const analysis = result.analysis;

  const { data: source, error } = await admin.from('ds_spatial_sources').insert({
    project_id: project.id,
    user_id: project.user_id,
    kind: 'UPLOADED_MODEL',
    status: 'READY',
    // glTF claims metres; HOMATCH has not measured the space, so the
    // dimensions are an estimate until the customer says otherwise.
    geometry_state: 'ESTIMATED',
    editability: analysis.editability,
    model_object_key: key,
    model_sha256: sha256,
    model_bytes: bytes.length,
    model_mime: analysis.stats.container === 'GLB' ? 'model/gltf-binary' : 'model/gltf+json',
    canonical: analysis,
    generator_version: MODEL_INSPECT_VERSION,
    provenance: { origin: 'CUSTOMER_MODEL', filename: displayName(body.filename), container: analysis.stats.container },
  }).select('id').single();
  if (error || !source) return fail('RECORD_FAILED');

  if (jobId) {
    await admin.from('ds_jobs').update({
      status: 'SUCCEEDED', finished_at: new Date().toISOString(),
      output: { sourceId: source.id, editability: analysis.editability, triangles: analysis.stats.triangles, warnings: analysis.warnings },
    }).eq('id', jobId);
  }
  return json({ state: 'READY', sourceId: source.id, editability: analysis.editability, warnings: analysis.warnings });
});
