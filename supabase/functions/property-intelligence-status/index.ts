/**
 * property-intelligence-status — Polling endpoint for PI job progress
 * POST /functions/v1/property-intelligence-status  { job_id: "uuid" }
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'Authentication required' }, 401);

  const sbUrl = Deno.env.get('SUPABASE_URL')!;
  const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const sb = createClient(sbUrl, sbKey);

  const jwt = auth.replace(/^Bearer\s+/i, '');
  const { data: { user }, error: authErr } = await sb.auth.getUser(jwt);
  if (authErr || !user) return json({ error: 'Invalid session' }, 401);

  const { data: profile } = await sb.from('users').select('id').eq('auth_id', user.id).maybeSingle();
  if (!profile?.id) return json({ error: 'User profile not found' }, 403);

  let jobId: string | null = null;
  if (req.method === 'POST') {
    try { const body = await req.json(); jobId = String(body?.job_id ?? '').trim() || null; } catch { /**/ }
  }
  if (!jobId) { const url = new URL(req.url); jobId = url.searchParams.get('job_id'); }
  if (!jobId) return json({ error: 'job_id required' }, 400);

  const { data: job, error } = await sb
    .from('research_jobs')
    .select('id,status,phase_detail,sources_found,sources_read,entities_found,claims_extracted,gemini_calls,report,error_message,started_at,completed_at,duration_ms,input_raw,input_type')
    .eq('id', jobId)
    .eq('user_id', profile.id)
    .maybeSingle();

  if (error || !job) return json({ error: 'Job not found or access denied' }, 404);

  return json({
    job_id: job.id, status: job.status, phase_detail: job.phase_detail,
    progress: {
      sources_found: job.sources_found ?? 0, sources_read: job.sources_read ?? 0,
      entities_found: job.entities_found ?? 0, claims_extracted: job.claims_extracted ?? 0,
      gemini_calls: job.gemini_calls ?? 0,
    },
    input_raw: job.input_raw, input_type: job.input_type,
    started_at: job.started_at, completed_at: job.completed_at, duration_ms: job.duration_ms,
    report: ['COMPLETED', 'PARTIAL'].includes(job.status) ? job.report : null,
    error_message: job.status === 'FAILED' ? job.error_message : null,
  });
});
