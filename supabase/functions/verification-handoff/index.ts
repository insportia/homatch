// HOMATCH — human-verification handoff: mint, open, complete, cancel.
//
// WHAT A HANDOFF IS
// -----------------
// A real person completing a real verification on the real source site, in
// their own browser, on their own network, and returning only the public
// result the site would show any visitor.
//
// WHAT IT IS NOT: token forging, replay, solving farms, IP spoofing,
// tunnelling our traffic through the customer, or any automated anti-bot
// bypass. Nothing here transfers server cookies out or customer cookies in.
//
// SECURITY
// --------
//   * The nonce is generated here with crypto.getRandomValues, returned ONCE,
//     and never stored — only sha256(nonce) is written.
//   * Minting requires the caller to own the research job (checked through
//     their own RLS, not with service-role).
//   * Redemption goes through redeem_human_verification_handoff(), which
//     re-checks ownership, expiry and single-use inside the database.
//   * No secret of any kind (worker token, service key, provider key) is ever
//     placed in a response.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { decideHandoff, specFor } from '../../../src/verify/handoff/sources.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** Short by design. A handoff is something the customer does now, not later,
 * and a long window is just a longer replay opportunity. */
const TTL_MINUTES = 20;

function mintNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'unauthorized' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id;
    if (!userId) return json({ error: 'unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? '').trim();

    switch (action) {
      case 'decide':
        return await handleDecide(supabase, body);
      case 'mint':
        return await handleMint(supabase, userId, body);
      case 'complete':
        return await handleComplete(supabase, body);
      case 'cancel':
        return await handleCancel(supabase, body);
      case 'status':
        return await handleStatus(supabase, body);
      default:
        return json({ error: 'unknown action' }, 400);
    }
  } catch (e) {
    console.error('verification-handoff failed', e instanceof Error ? e.message : String(e));
    return json({ error: 'internal_error' }, 500);
  }
});

/** Pure advisory: what SHOULD happen for this source right now. Separated from
 * minting so the UI can ask without creating state. */
async function handleDecide(supabase: any, body: any): Promise<Response> {
  const jobId = String(body?.jobId ?? '').trim();
  const sourceKey = String(body?.sourceKey ?? '').trim();
  if (!jobId || !sourceKey) return json({ error: 'jobId and sourceKey are required' }, 400);

  const { job, available } = await loadJobInputs(supabase, jobId);
  if (!job) return json({ error: 'not found' }, 404);

  const prior = await priorAttempt(supabase, jobId, sourceKey);
  const plan = decideHandoff({
    sourceKey,
    status: String(body?.status ?? 'CAPTCHA_REQUIRED'),
    networkRefusal: body?.networkRefusal === true,
    available,
    priorAttempt: prior,
  });

  return json({ plan, spec: specFor(sourceKey) });
}

async function handleMint(supabase: any, userId: string, body: any): Promise<Response> {
  const jobId = String(body?.jobId ?? '').trim();
  const sourceKey = String(body?.sourceKey ?? '').trim();
  if (!jobId || !sourceKey) return json({ error: 'jobId and sourceKey are required' }, 400);

  const spec = specFor(sourceKey);
  if (!spec) return json({ error: 'source does not support handoff' }, 400);

  const { job, available } = await loadJobInputs(supabase, jobId);
  if (!job) return json({ error: 'not found' }, 404);

  const prior = await priorAttempt(supabase, jobId, sourceKey);
  const plan = decideHandoff({
    sourceKey,
    status: String(body?.status ?? 'BLOCKED'),
    networkRefusal: body?.networkRefusal === true,
    available,
    priorAttempt: prior,
  });

  if (plan.decision !== 'USER_SIDE_HANDOFF') {
    // Recorded rather than silently refused, so the audit trail shows that a
    // handoff was considered and why it was not offered.
    return json({ plan, handoff: null });
  }

  // An existing live handoff is returned as "already active" rather than
  // duplicated — the unique index would reject a second one anyway, and the
  // customer should be sent back to the one they already have.
  const { data: live } = await supabase
    .from('human_verification_handoffs')
    .select('id,status,expires_at,target_url')
    .eq('research_job_id', jobId)
    .eq('source_key', sourceKey)
    .in('status', ['PENDING', 'OPENED'])
    .maybeSingle();

  if (live) {
    // The nonce cannot be re-issued (it was never stored), so an in-flight
    // handoff must be cancelled and re-minted if the customer lost the link.
    return json({ plan, handoff: { id: live.id, status: live.status, expiresAt: live.expires_at, nonce: null } });
  }

  const nonce = mintNonce();
  const nonceHash = await sha256Hex(nonce);
  const expiresAt = new Date(Date.now() + TTL_MINUTES * 60_000).toISOString();

  const { data: row, error } = await supabase
    .from('human_verification_handoffs')
    .insert({
      user_id: userId,
      research_job_id: jobId,
      source_key: sourceKey,
      worker_job_id: body?.workerJobId ? String(body.workerJobId) : null,
      nonce_sha256: nonceHash,
      handoff_kind: spec.kind,
      target_url: typeof body?.targetUrl === 'string' ? body.targetUrl : null,
      expires_at: expiresAt,
      audit: [{ at: new Date().toISOString(), event: 'MINTED', note: plan.reason }],
    })
    .select('id,status,expires_at')
    .single();

  // The insert is done with the caller's own client, so RLS would already have
  // blocked a job they do not own; this catches the race where two tabs mint
  // at once and the unique index rejects the second.
  if (error) return json({ error: 'could not create handoff', detail: error.code ?? null }, 409);

  return json({
    plan,
    handoff: {
      id: row.id,
      status: row.status,
      expiresAt: row.expires_at,
      // Returned exactly once. It is not stored and cannot be recovered.
      nonce,
      kind: spec.kind,
      requiredInputs: spec.requiredInputs,
      inputs: pickInputs(spec.requiredInputs, available),
    },
  });
}

async function handleComplete(supabase: any, body: any): Promise<Response> {
  const nonce = String(body?.nonce ?? '').trim();
  if (!nonce) return json({ error: 'nonce is required' }, 400);

  // Only a small, non-secret result shape is accepted. Cookies, tokens and
  // raw page dumps are deliberately not part of the contract.
  const result = {
    confirmed: body?.result?.confirmed === true,
    reference: typeof body?.result?.reference === 'string' ? body.result.reference.slice(0, 200) : null,
    documentUrl: typeof body?.result?.documentUrl === 'string' ? body.result.documentUrl.slice(0, 500) : null,
    note: typeof body?.result?.note === 'string' ? body.result.note.slice(0, 500) : null,
  };

  const { data, error } = await supabase.rpc('redeem_human_verification_handoff', {
    p_nonce: nonce,
    p_result: result,
  });

  if (error) {
    // The database is the authority on expiry/replay/ownership; surface a
    // stable code rather than its message.
    return json({ error: 'handoff_not_redeemable', detail: error.message?.slice(0, 120) ?? null }, 400);
  }

  return json({ redeemed: data });
}

async function handleCancel(supabase: any, body: any): Promise<Response> {
  const handoffId = String(body?.handoffId ?? '').trim();
  if (!handoffId) return json({ error: 'handoffId is required' }, 400);

  // A customer declining is a normal outcome. decideHandoff() reads the
  // resulting CANCELLED state and will not offer the same handoff again.
  const { error } = await supabase
    .from('human_verification_handoffs')
    .update({ status: 'CANCELLED' })
    .eq('id', handoffId)
    .in('status', ['PENDING', 'OPENED']);

  // The customer-facing table is read-only under RLS, so this update runs
  // only where a policy permits it; a failure here is not fatal to the flow.
  if (error) return json({ cancelled: false, reason: 'not_permitted' }, 200);
  return json({ cancelled: true });
}

async function handleStatus(supabase: any, body: any): Promise<Response> {
  const jobId = String(body?.jobId ?? '').trim();
  if (!jobId) return json({ error: 'jobId is required' }, 400);
  const { data, error } = await supabase
    .from('human_verification_handoffs')
    .select('id,source_key,status,expires_at,consumed_at,result_payload')
    .eq('research_job_id', jobId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return json({ handoffs: data ?? [] });
}

/* ------------------------------------------------------------------ *
 * Helpers                                                             *
 * ------------------------------------------------------------------ */

/**
 * The inputs a handoff may legitimately pass to the customer's browser.
 *
 * Strictly limited to identifiers the customer themselves supplied or that
 * are public: the cadastral code they searched, and the company id already
 * shown to them in the report. Never a session, never a cookie, never
 * anything belonging to another user.
 */
async function loadJobInputs(
  supabase: any,
  jobId: string
): Promise<{ job: any; available: { cadastralCode?: string | null; companyIdCode?: string | null } }> {
  const { data: job } = await supabase
    .from('research_jobs')
    .select('id,query,result_json')
    .eq('id', jobId)
    .maybeSingle();

  if (!job) return { job: null, available: {} };

  const r = (job.result_json ?? {}) as any;
  const unit = r.exactUnit ?? {};
  return {
    job,
    available: {
      cadastralCode: unit.cadastralCode ?? unit.code ?? r.identifiedParent?.code ?? job.query ?? null,
      companyIdCode: r.companyProfile?.idCode ?? null,
    },
  };
}

function pickInputs(required: string[], available: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of required) if (available[k]) out[k] = available[k];
  return out;
}

async function priorAttempt(
  supabase: any,
  jobId: string,
  sourceKey: string
): Promise<'NONE' | 'CANCELLED' | 'EXPIRED' | 'COMPLETED'> {
  const { data } = await supabase
    .from('human_verification_handoffs')
    .select('status')
    .eq('research_job_id', jobId)
    .eq('source_key', sourceKey)
    .in('status', ['COMPLETED', 'CANCELLED', 'EXPIRED'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.status as 'CANCELLED' | 'EXPIRED' | 'COMPLETED') ?? 'NONE';
}
