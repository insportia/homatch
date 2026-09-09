-- Homatch Verify — make handoff expiry actually persist
--
-- THE DEFECT, found by a production runtime test after 20260910110000 was
-- applied.
--
-- redeem_human_verification_handoff() contained:
--
--     if h.expires_at <= now() then
--       update ... set status = 'EXPIRED' ... where id = h.id;
--       raise exception 'handoff has expired' ...;
--     end if;
--
-- The RAISE aborts the surrounding (sub)transaction, which rolls back the
-- UPDATE that was made one line earlier. So the row stayed PENDING forever.
--
-- Redemption itself was never at risk — the expiry check fires and the nonce
-- is correctly refused, which the runtime test confirmed. The damage is to the
-- customer:
--
--   hvh_one_live_per_source_uidx counts PENDING/OPENED as "live", so an
--   expired-but-still-PENDING row keeps occupying the only live slot for that
--   (job, source). The next mint returns that dead handoff with nonce = null —
--   a link the customer cannot complete — instead of issuing a fresh one.
--
-- That is precisely the "never leave the customer stuck in an impossible
-- human-verification state" rule, so it is fixed rather than documented.
--
-- THE FIX, in two parts:
--
--   1. redeem no longer attempts an update it cannot keep. The dead UPDATE is
--      removed; the raise stays, because a redemption after expiry must fail
--      loudly. Leaving unreachable-effect code in place would just mislead the
--      next reader into believing the status is recorded here.
--
--   2. mint expires stale rows for that (job, source) BEFORE looking for a
--      live handoff. mint returns normally, so this update commits. The slot
--      is freed, the EXPIRED transition is recorded with an audit entry, and
--      the customer gets a working handoff instead of a dead one.
--
-- No table, column, policy, grant or index changes. Function bodies only.
-- 20260910110000 is already applied in production and is deliberately NOT
-- rewritten.

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

  v_ttl := least(greatest(coalesce(p_ttl_minutes, 20), 1), 60);

  if not exists (
    select 1 from public.research_jobs j
    where j.id = p_job_id and j.user_id = v_uid
  ) then
    raise exception 'research job not found for this user'
      using errcode = 'insufficient_privilege';
  end if;

  /*
   * Retire anything already past its expiry for THIS (job, source) before
   * deciding whether a live handoff exists.
   *
   * This is where the EXPIRED transition actually becomes durable: mint
   * returns normally, so this update commits, unlike the one redeem used to
   * attempt immediately before raising. Scoped to the caller's own job, so it
   * can never touch another user's rows even though this runs SECURITY
   * DEFINER.
   */
  update public.human_verification_handoffs
     set status = 'EXPIRED',
         audit  = audit || jsonb_build_object('at', now(), 'event', 'EXPIRED_ON_MINT')
   where research_job_id = p_job_id
     and source_key = p_source_key
     and status in ('PENDING','OPENED')
     and expires_at <= now();

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

  v_nonce := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash  := encode(extensions.digest(v_nonce, 'sha256'), 'hex');

  insert into public.human_verification_handoffs (
    user_id, research_job_id, source_key, worker_job_id,
    nonce_sha256, status, handoff_kind, target_url, expires_at, audit
  ) values (
    v_uid, p_job_id, p_source_key,
    nullif(btrim(coalesce(p_worker_job_id, '')), ''),
    v_hash,
    'PENDING',
    coalesce(nullif(btrim(coalesce(p_handoff_kind, '')), ''), 'VERIFY_ON_SOURCE'),
    nullif(btrim(coalesce(p_target_url, '')), ''),
    now() + make_interval(mins => v_ttl),
    jsonb_build_array(jsonb_build_object('at', now(), 'event', 'MINTED'))
  )
  returning * into v_new;

  return jsonb_build_object(
    'handoffId', v_new.id,
    'status',    v_new.status,
    'expiresAt', v_new.expires_at,
    'targetUrl', v_new.target_url,
    'nonce',     v_nonce,
    'already',   false
  );
end;
$$;

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
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  if p_nonce is null or length(p_nonce) < 32 then
    raise exception 'invalid handoff nonce' using errcode = 'invalid_parameter_value';
  end if;

  v_hash := encode(extensions.digest(p_nonce, 'sha256'), 'hex');

  select * into h
  from public.human_verification_handoffs
  where nonce_sha256 = v_hash
  for update;

  if not found then
    raise exception 'handoff not found' using errcode = 'no_data_found';
  end if;

  if h.user_id <> auth.uid() then
    raise exception 'handoff does not belong to caller' using errcode = 'insufficient_privilege';
  end if;

  if h.status = 'COMPLETED' then
    return jsonb_build_object(
      'handoffId', h.id, 'researchJobId', h.research_job_id,
      'sourceKey', h.source_key, 'status', h.status, 'already', true
    );
  end if;

  if h.status in ('CANCELLED','EXPIRED','UNSUPPORTED') then
    raise exception 'handoff is no longer redeemable' using errcode = 'invalid_parameter_value';
  end if;

  /*
   * Refuse loudly, and do NOT try to record the transition here.
   *
   * The previous version issued `update ... set status = 'EXPIRED'` on this
   * line and then raised. The raise aborts the subtransaction and rolls that
   * update straight back, so the row stayed PENDING and the write was pure
   * illusion. Retiring an expired handoff now happens in mint (which returns
   * normally, so its update commits) and in expire_stale_handoffs().
   */
  if h.expires_at <= now() then
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

-- Grants are unchanged from 20260910110000, restated so this file is complete
-- on its own and a replay cannot silently widen access.
revoke all on function public.mint_human_verification_handoff(uuid, text, text, text, text, integer)
  from public, anon;
grant execute on function public.mint_human_verification_handoff(uuid, text, text, text, text, integer)
  to authenticated;
revoke all on function public.redeem_human_verification_handoff(text, jsonb) from public, anon;
grant execute on function public.redeem_human_verification_handoff(text, jsonb) to authenticated;
