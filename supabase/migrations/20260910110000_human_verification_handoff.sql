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
-- RLS — the customer may READ their own handoffs (the UI needs status), but
-- may never write one. Minting and redemption both go through the edge
-- function, which validates the nonce; letting a client UPDATE status
-- directly would make the nonce pointless.
-- ---------------------------------------------------------------------------
alter table public.human_verification_handoffs enable row level security;
alter table public.human_verification_handoffs force row level security;

drop policy if exists hvh_owner_read on public.human_verification_handoffs;
create policy hvh_owner_read on public.human_verification_handoffs
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.human_verification_handoffs from anon;

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
  update public.human_verification_handoffs
     set status = 'EXPIRED',
         audit  = audit || jsonb_build_object('at', now(), 'event', 'EXPIRED_SWEEP')
   where status in ('PENDING','OPENED')
     and expires_at <= now();
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.expire_stale_handoffs() from public, anon;
