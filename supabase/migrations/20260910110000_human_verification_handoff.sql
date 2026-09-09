-- Homatch Verify — user-side human verification handoff
--
-- WHY THIS EXISTS
-- ---------------
-- A real production run proved that Railway-local Chromium can reach a
-- TERMINAL network refusal from Google/reCAPTCHA:
--
--     "Try again later"
--     "Your computer or network may be sending automated queries"
--
-- That is a judgement about the DATACENTER IP, not about the puzzle. No
-- amount of screenshotting Railway's browser fixes it, because a screenshot
-- does not change the source IP: the customer would be shown a CAPTCHA that
-- cannot be solved from where it is being rendered. Buster and the yellow
-- assist button remain useful for ordinary solvable CAPTCHAs and are NOT
-- removed — but they cannot address a terminal refusal.
--
-- The answer is to let the verification genuinely originate from the
-- customer's own browser and network, then return only the legitimate RESULT
-- to the server.
--
-- WHAT THIS IS NOT
-- ----------------
-- Not token forging, not replay of someone else's solution, not a solving
-- farm, not IP spoofing, not tunnelling our traffic through the customer, not
-- any automated anti-bot bypass. A real person completes a real verification
-- on the real source site, in their own session. We record that it happened
-- and continue the research.
--
-- SECURITY MODEL
-- --------------
-- The nonce is NEVER stored. Only sha256(nonce) is, so a database disclosure
-- yields nothing usable — the same reason a password is not stored. The raw
-- nonce exists exactly once, in the response that mints it.
--
-- Binding is triple: (user, job, source). A handoff minted for one source of
-- one job for one user cannot be redeemed for anything else. Redemption is
-- single-use (consumed_at) and expiry is short.
--
-- NOT APPLIED. Written locally for review; deployment is a separate decision.

create table if not exists public.human_verification_handoffs (
  id uuid primary key default gen_random_uuid(),

  -- Triple binding. All three are part of redemption; none is optional.
  user_id uuid not null references auth.users(id) on delete cascade,
  research_job_id uuid not null references public.research_jobs(id) on delete cascade,
  source_key text not null,

  -- The worker-side job this belongs to, so the orchestrator can correlate a
  -- completion back to the paused execution without trusting the client.
  worker_job_id text,

  -- sha256 of the one-time nonce, hex. The nonce itself is returned once at
  -- mint time and never persisted anywhere.
  nonce_sha256 text not null,

  status text not null default 'PENDING' check (status in (
    'PENDING',        -- minted, customer has not opened it yet
    'OPENED',         -- customer opened the handoff page
    'COMPLETED',      -- customer reported a successful verification
    'CANCELLED',      -- customer explicitly gave up
    'EXPIRED',        -- window elapsed
    'UNSUPPORTED'     -- this source cannot be handed off; recorded for audit
  )),

  -- What the customer is being asked to do, resolved from the source adapter
  -- at mint time. Stored so the audit trail is readable later even if the
  -- adapter changes.
  handoff_kind text not null default 'VERIFY_ON_SOURCE'
    check (handoff_kind in ('VERIFY_ON_SOURCE','FETCH_AND_RETURN','UPLOAD_RESULT')),
  target_url text,

  -- The legitimate RESULT the customer's browser produced. Deliberately
  -- constrained to what the source itself hands a normal user (a public
  -- document reference, an extract number, a confirmation id). Server cookies
  -- are never placed here and customer cookies are never imported from here.
  result_payload jsonb not null default '{}'::jsonb,

  attempts smallint not null default 0,
  expires_at timestamptz not null,
  opened_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),

  -- Audit trail. Free-form append-only list of {at, event, note} entries.
  audit jsonb not null default '[]'::jsonb,

  -- A completed handoff must record WHEN it was consumed. Without this a
  -- replay check has nothing to test against.
  constraint hvh_completed_needs_consumed_ck
    check (status <> 'COMPLETED' or consumed_at is not null)
);

create index if not exists hvh_job_idx
  on public.human_verification_handoffs (research_job_id, source_key, status);
create index if not exists hvh_user_idx
  on public.human_verification_handoffs (user_id, created_at desc);
-- Redemption looks a handoff up by its hash; this must be unique or two
-- handoffs could collide onto one nonce.
create unique index if not exists hvh_nonce_uidx
  on public.human_verification_handoffs (nonce_sha256);

-- At most ONE live handoff per (job, source). Prevents a customer from being
-- handed two competing links for the same verification, and prevents a caller
-- from minting handoffs in a loop.
create unique index if not exists hvh_one_live_per_source_uidx
  on public.human_verification_handoffs (research_job_id, source_key)
  where status in ('PENDING','OPENED');

-- ---------------------------------------------------------------------------
-- RLS
--
-- The customer may READ their own handoffs (the UI needs status). There is
-- NO client INSERT, UPDATE or DELETE policy, deliberately and permanently:
-- every write goes through one of the SECURITY DEFINER functions below.
--
-- Why not a scoped INSERT policy? Because the client would then choose
-- `nonce_sha256`. Knowing the preimage of a hash you supplied yourself makes
-- the nonce worthless — you could immediately redeem your own handoff and
-- record a verification that never happened. Same for UPDATE: a policy broad
-- enough to allow cancelling is broad enough to set status = 'COMPLETED'.
--
-- So the security-sensitive fields — owner, job, source, nonce, status,
-- expiry — are ALL derived server-side inside the functions, and none of them
-- is accepted from the caller.
-- ---------------------------------------------------------------------------
alter table public.human_verification_handoffs enable row level security;
alter table public.human_verification_handoffs force row level security;

drop policy if exists hvh_owner_read on public.human_verification_handoffs;
create policy hvh_owner_read on public.human_verification_handoffs
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.human_verification_handoffs from anon;

-- ---------------------------------------------------------------------------
-- mint_human_verification_handoff
--
-- The ONLY way a handoff comes into existence.
--
-- Everything security-relevant is derived here, never accepted from the
-- caller: the owner is auth.uid(), the job must belong to that owner, the
-- nonce is generated with pgcrypto and only its hash is stored, the status is
-- forced to PENDING, and the expiry is computed from now(). A caller cannot
-- mint for another user, cannot mint against a job they do not own, cannot
-- choose the nonce, and cannot create a handoff that is already COMPLETED.
--
-- The caller supplies only descriptive values: which source, which worker job,
-- and where to send the customer. `p_handoff_kind` is additionally constrained
-- by the table's own CHECK, so an unknown kind is rejected by the database
-- rather than trusted.
--
-- Returns the raw nonce EXACTLY ONCE. It is never stored and cannot be
-- recovered afterwards.
-- ---------------------------------------------------------------------------
create or replace function public.mint_human_verification_handoff(
  p_job_id       uuid,
  p_source_key   text,
  p_handoff_kind text default 'VERIFY_ON_SOURCE',
  p_worker_job_id text default null,
  p_target_url   text default null,
  p_ttl_minutes  integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_nonce  text;
  v_hash   text;
  v_live   public.human_verification_handoffs%rowtype;
  v_new    public.human_verification_handoffs%rowtype;
  v_ttl    integer;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;
  if p_source_key is null or btrim(p_source_key) = '' then
    raise exception 'source_key is required' using errcode = 'invalid_parameter_value';
  end if;

  -- Bounded server-side. A caller cannot ask for a long-lived handoff, which
  -- would just be a longer replay window.
  v_ttl := least(greatest(coalesce(p_ttl_minutes, 20), 1), 60);

  -- JOB OWNERSHIP. SECURITY DEFINER has bypassed RLS, so this is the check
  -- that actually stops a caller minting against someone else's research job.
  if not exists (
    select 1 from public.research_jobs j
    where j.id = p_job_id and j.user_id = v_uid
  ) then
    raise exception 'research job not found for this user'
      using errcode = 'insufficient_privilege';
  end if;

  -- One live handoff per (job, source). Returned WITHOUT a nonce, because the
  -- nonce was never stored and genuinely cannot be re-issued; the customer
  -- must cancel and re-mint if they lost the link.
  select * into v_live
  from public.human_verification_handoffs
  where research_job_id = p_job_id
    and source_key = p_source_key
    and status in ('PENDING','OPENED')
  limit 1;

  if found then
    return jsonb_build_object(
      'handoffId', v_live.id,
      'status',    v_live.status,
      'expiresAt', v_live.expires_at,
      'targetUrl', v_live.target_url,
      'nonce',     null,
      'already',   true
    );
  end if;

  -- 32 bytes of CSPRNG output. Only the hash is persisted.
  v_nonce := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash  := encode(extensions.digest(v_nonce, 'sha256'), 'hex');

  insert into public.human_verification_handoffs (
    user_id, research_job_id, source_key, worker_job_id,
    nonce_sha256, status, handoff_kind, target_url, expires_at, audit
  ) values (
    v_uid, p_job_id, p_source_key,
    nullif(btrim(coalesce(p_worker_job_id, '')), ''),
    v_hash,
    'PENDING',                                   -- server-fixed, never caller-chosen
    coalesce(nullif(btrim(coalesce(p_handoff_kind, '')), ''), 'VERIFY_ON_SOURCE'),
    nullif(btrim(coalesce(p_target_url, '')), ''),
    now() + make_interval(mins => v_ttl),        -- server-computed
    jsonb_build_array(jsonb_build_object('at', now(), 'event', 'MINTED'))
  )
  returning * into v_new;

  return jsonb_build_object(
    'handoffId', v_new.id,
    'status',    v_new.status,
    'expiresAt', v_new.expires_at,
    'targetUrl', v_new.target_url,
    'nonce',     v_nonce,      -- returned once, never stored
    'already',   false
  );
end;
$$;

revoke all on function public.mint_human_verification_handoff(uuid, text, text, text, text, integer)
  from public, anon;
grant execute on function public.mint_human_verification_handoff(uuid, text, text, text, text, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- open_human_verification_handoff
--
-- Records that the customer actually opened the link. PENDING -> OPENED only;
-- every other state is returned unchanged, so this can never resurrect a
-- cancelled, expired or completed handoff. Idempotent.
-- ---------------------------------------------------------------------------
create or replace function public.open_human_verification_handoff(p_handoff_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  h public.human_verification_handoffs%rowtype;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  select * into h from public.human_verification_handoffs
  where id = p_handoff_id for update;
  if not found then
    raise exception 'handoff not found' using errcode = 'no_data_found';
  end if;
  if h.user_id <> v_uid then
    raise exception 'handoff does not belong to caller' using errcode = 'insufficient_privilege';
  end if;

  if h.status = 'PENDING' and h.expires_at > now() then
    update public.human_verification_handoffs
       set status    = 'OPENED',
           opened_at = now(),
           audit     = audit || jsonb_build_object('at', now(), 'event', 'OPENED')
     where id = h.id
     returning * into h;
  end if;

  return jsonb_build_object('handoffId', h.id, 'status', h.status, 'expiresAt', h.expires_at);
end;
$$;

revoke all on function public.open_human_verification_handoff(uuid) from public, anon;
grant execute on function public.open_human_verification_handoff(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- cancel_human_verification_handoff
--
-- The customer declining. Only PENDING and OPENED may become CANCELLED.
--
-- A COMPLETED handoff is NOT mutated — a completed verification is a fact and
-- must not be erasable by a later click. EXPIRED likewise stays EXPIRED.
-- Cancelling twice is idempotent success rather than an error, and a handoff
-- that does not exist or belongs to someone else RAISES: there is no silent
-- zero-row success, which is exactly the bug this replaces.
--
-- Because hvh_one_live_per_source_uidx only covers PENDING/OPENED, moving to
-- CANCELLED frees the slot and a legitimate re-mint works immediately.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_human_verification_handoff(p_handoff_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  h public.human_verification_handoffs%rowtype;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  select * into h from public.human_verification_handoffs
  where id = p_handoff_id for update;
  if not found then
    raise exception 'handoff not found' using errcode = 'no_data_found';
  end if;
  if h.user_id <> v_uid then
    raise exception 'handoff does not belong to caller' using errcode = 'insufficient_privilege';
  end if;

  if h.status = 'CANCELLED' then
    return jsonb_build_object('handoffId', h.id, 'status', h.status, 'cancelled', true, 'already', true);
  end if;

  if h.status not in ('PENDING','OPENED') then
    -- COMPLETED / EXPIRED / UNSUPPORTED are terminal and are reported back
    -- unchanged rather than silently rewritten.
    return jsonb_build_object('handoffId', h.id, 'status', h.status, 'cancelled', false, 'already', false);
  end if;

  update public.human_verification_handoffs
     set status = 'CANCELLED',
         audit  = audit || jsonb_build_object('at', now(), 'event', 'CANCELLED')
   where id = h.id
   returning * into h;

  return jsonb_build_object('handoffId', h.id, 'status', h.status, 'cancelled', true, 'already', false);
end;
$$;

revoke all on function public.cancel_human_verification_handoff(uuid) from public, anon;
grant execute on function public.cancel_human_verification_handoff(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- redeem_human_verification_handoff
--
-- The single redemption path. SECURITY DEFINER because it must update a table
-- the caller has no write policy on — but it is not a bypass: it re-derives
-- the row from the nonce hash, re-checks ownership against auth.uid(), and
-- refuses anything expired or already consumed.
--
-- IDEMPOTENT. Redeeming an already-COMPLETED handoff with the same nonce
-- returns the same success result rather than erroring, because the customer's
-- browser may legitimately retry (flaky network, double-tap, page reload).
-- Redeeming after expiry or with a wrong nonce fails.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_human_verification_handoff(
  p_nonce text,
  p_result jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.human_verification_handoffs%rowtype;
  v_hash text;
begin
  -- Returns jsonb rather than a TABLE deliberately: OUT parameters named
  -- `status`, `source_key` etc. would shadow the identically-named columns of
  -- the table this function updates, which is a class of plpgsql ambiguity bug
  -- that only shows up at runtime. A single jsonb result has no such overlap.

  -- An explicit NULL check on the caller identity, BEFORE anything else.
  -- Without it the ownership test below (`h.user_id <> auth.uid()`) evaluates
  -- to NULL for an unauthenticated caller, the IF does not fire, and the
  -- comparison silently passes. EXECUTE is revoked from anon so this is not
  -- reachable today, but a security check that depends on a grant staying
  -- correct is one grant away from being no check at all.
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  if p_nonce is null or length(p_nonce) < 32 then
    raise exception 'invalid handoff nonce' using errcode = 'invalid_parameter_value';
  end if;

  -- pgcrypto lives in the `extensions` schema on Supabase, and this function
  -- pins search_path to `public` for safety, so digest() MUST be schema-
  -- qualified or it will not resolve at runtime.
  v_hash := encode(extensions.digest(p_nonce, 'sha256'), 'hex');

  select * into h
  from public.human_verification_handoffs
  where nonce_sha256 = v_hash
  for update;

  if not found then
    raise exception 'handoff not found' using errcode = 'no_data_found';
  end if;

  -- Ownership is re-checked here rather than trusted from the caller, because
  -- SECURITY DEFINER has already bypassed RLS by this point.
  if h.user_id <> auth.uid() then
    raise exception 'handoff does not belong to caller' using errcode = 'insufficient_privilege';
  end if;

  -- Replay: a second redemption of a consumed handoff is idempotent, not an
  -- error, but it must NOT overwrite the recorded result.
  if h.status = 'COMPLETED' then
    return jsonb_build_object(
      'handoffId', h.id, 'researchJobId', h.research_job_id,
      'sourceKey', h.source_key, 'status', h.status, 'already', true
    );
  end if;

  if h.status in ('CANCELLED','EXPIRED','UNSUPPORTED') then
    raise exception 'handoff is no longer redeemable' using errcode = 'invalid_parameter_value';
  end if;

  if h.expires_at <= now() then
    update public.human_verification_handoffs
       set status = 'EXPIRED',
           audit  = audit || jsonb_build_object('at', now(), 'event', 'EXPIRED_ON_REDEEM')
     where id = h.id;
    raise exception 'handoff has expired' using errcode = 'invalid_parameter_value';
  end if;

  update public.human_verification_handoffs
     set status         = 'COMPLETED',
         result_payload = coalesce(p_result, '{}'::jsonb),
         consumed_at    = now(),
         attempts       = attempts + 1,
         audit          = audit || jsonb_build_object('at', now(), 'event', 'COMPLETED')
   where id = h.id
   returning * into h;

  return jsonb_build_object(
    'handoffId', h.id, 'researchJobId', h.research_job_id,
    'sourceKey', h.source_key, 'status', h.status, 'already', false
  );
end;
$$;

revoke all on function public.redeem_human_verification_handoff(text, jsonb) from public, anon;
grant execute on function public.redeem_human_verification_handoff(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- expire_stale_handoffs — housekeeping, safe to call repeatedly.
-- ---------------------------------------------------------------------------
create or replace function public.expire_stale_handoffs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  /*
   * DEFENCE IN DEPTH.
   *
   * This is SECURITY DEFINER, so it writes past RLS across every user's rows.
   * It is currently unreachable by ordinary users because EXECUTE is revoked
   * below — but relying only on a grant means a single future `grant execute
   * ... to authenticated` would silently hand any signed-in user the ability
   * to expire everybody's live handoffs. The check below makes that
   * impossible regardless of grants.
   *
   * auth.uid() is NULL when invoked by a scheduled job or the service role,
   * which is the intended caller; a human caller must be an admin.
   */
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;

  update public.human_verification_handoffs
     set status = 'EXPIRED',
         audit  = audit || jsonb_build_object('at', now(), 'event', 'EXPIRED_SWEEP')
   where status in ('PENDING','OPENED')
     and expires_at <= now();
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Not granted to `authenticated` at all: this is a maintenance sweep, not a
-- customer operation. `from public` also removes the implicit default grant.
revoke all on function public.expire_stale_handoffs() from public, anon, authenticated;
