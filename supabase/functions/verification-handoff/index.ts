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
      case 'open':
        return await handleOpen(supabase, body);
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

async function handleMint(supabase: any, _userId: string, body: any): Promise<Response> {
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

  /*
   * Minting goes through a SECURITY DEFINER RPC, never a table insert.
   *
   * The table has NO client write policy at all, deliberately: a scoped INSERT
   * policy would let the caller choose `nonce_sha256`, and knowing the
   * preimage of your own hash makes the nonce worthless. So the owner, the
   * nonce, the status and the expiry are all derived inside the database, and
   * the job-ownership check happens there too — after SECURITY DEFINER has
   * bypassed RLS, which is the only place it can still be enforced.
   *
   * This function contributes only descriptive values.
   */
  const { data, error } = await supabase.rpc('mint_human_verification_handoff', {
    p_job_id: jobId,
    p_source_key: sourceKey,
    p_handoff_kind: spec.kind,
    p_worker_job_id: body?.workerJobId ? String(body.workerJobId) : null,
    p_target_url: typeof body?.targetUrl === 'string' ? body.targetUrl : null,
  });

  if (error) {
    // The database is the authority on ownership and on the one-live-handoff
    // rule; surface a stable code rather than its message.
    console.error('mint failed', error.message?.slice(0, 200) ?? '');
    return json({ error: 'could not create handoff' }, 409);
  }

  return json({
    plan,
    handoff: {
      id: data?.handoffId ?? null,
      status: data?.status ?? null,
      expiresAt: data?.expiresAt ?? null,
      targetUrl: data?.targetUrl ?? null,
      // Present exactly once, on the mint that created the row. An
      // already-live handoff returns null here because the nonce was never
      // stored and genuinely cannot be re-issued.
      nonce: data?.nonce ?? null,
      already: data?.already === true,
      kind: spec.kind,
      requiredInputs: spec.requiredInputs,
      inputs: pickInputs(spec.requiredInputs, available),
    },
  });
}

/** Records that the customer actually opened the link. PENDING -> OPENED only. */
async function handleOpen(supabase: any, body: any): Promise<Response> {
  const handoffId = String(body?.handoffId ?? '').trim();
  if (!handoffId) return json({ error: 'handoffId is required' }, 400);

  const { data, error } = await supabase.rpc('open_human_verification_handoff', {
    p_handoff_id: handoffId,
  });
  if (error) return json({ error: 'handoff_not_found' }, 404);
  return json({ handoff: data });
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

  /*
   * Cancellation goes through a SECURITY DEFINER RPC for the same reason as
   * minting: the table has no client UPDATE policy, and a policy permissive
   * enough to allow cancelling would also permit setting status = 'COMPLETED'.
   *
   * The previous implementation issued a direct .update(), which under a
   * SELECT-only policy matched zero rows and returned SUCCESS — so declining a
   * handoff silently did nothing, the row stayed PENDING, and the
   * one-live-per-source index then blocked any re-mint. The RPC raises on a
   * missing or non-owned handoff instead of succeeding vacuously.
   */
  const { data, error } = await supabase.rpc('cancel_human_verification_handoff', {
    p_handoff_id: handoffId,
  });

  if (error) {
    console.error('cancel failed', error.message?.slice(0, 200) ?? '');
    return json({ cancelled: false, error: 'handoff_not_cancellable' }, 400);
  }

  // `cancelled: false` with a terminal status is a real answer, not a failure:
  // a COMPLETED verification is a fact and is never rewritten by a later tap.
  return json({ cancelled: data?.cancelled === true, status: data?.status ?? null });
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
    .select('id,query,result_json,captcha')
    .eq('id', jobId)
    .maybeSingle();

  if (!job) return { job: null, available: {} };

  // Only the two public identifiers a handoff may legitimately pass to the
  // customer's own browser. Typed narrowly rather than `any` so a future edit
  // cannot quietly start reading something else out of the report.
  const r = (job.result_json ?? {}) as {
    exactUnit?: { cadastralCode?: string; code?: string };
    identifiedParent?: { code?: string };
    companyProfile?: { idCode?: string };
  };
  const unit = r.exactUnit ?? {};

  // The company a source parked ON is not always the job's primary company.
  // A discovered developer triggers its own rstax/enreg/debtor lookup, and the
  // id it parked with lives in the human-verification payload:
  //
  //   captcha.step = { type:'entity', source:'rstax', idCode:'404670272', name:'...' }
  //
  // Reading only result_json.companyProfile.idCode meant that for exactly the
  // case a handoff exists to solve -- a discovered entity's registry lookup
  // being challenged -- the required input looked unavailable and the handoff
  // was refused for want of a value we were holding all along.
  const c = (job.captcha ?? {}) as { step?: { idCode?: string; type?: string } };
  const parkedIdCode = typeof c.step?.idCode === 'string' ? c.step.idCode.trim() : '';

  return {
    job,
    available: {
      cadastralCode: unit.cadastralCode ?? unit.code ?? r.identifiedParent?.code ?? job.query ?? null,
      companyIdCode: (parkedIdCode || r.companyProfile?.idCode) ?? null,
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
