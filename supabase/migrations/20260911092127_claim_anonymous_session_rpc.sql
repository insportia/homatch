-- Handing anonymous work to the account that just signed in.
--
-- Modelled on redeem_human_verification_handoff, which has been carrying the
-- same responsibilities in production: hashed lookup, row lock, ownership
-- check, idempotent repeat, explicit refusal for everything else.
--
-- The rules this has to hold, and why each one is here:
--
--   the caller must be signed in     there is no one to give the work TO otherwise
--   the token must be long           a short token is a guessable token
--   lookup is by HASH                the stored value must not be usable
--   FOR UPDATE                       two tabs finishing sign-in at once
--   claimed by me -> already:true    a refresh mid-claim must not look like a failure
--   claimed by someone else -> deny  a leaked token cannot steal a claimed session
--   expired -> deny                  an abandoned session is not a back door
--
-- The claim moves ownership and CLEARS anon_session_id, so the one-owner
-- CHECK still holds and a session can never be claimed twice into two
-- accounts.
--
-- NOTE: superseded later the same day by
-- 20260911092323_claim_anonymous_session_no_oracle.sql, which makes every
-- unusable token give the same answer. Kept as written so the history of the
-- function is honest.

create or replace function public.claim_anonymous_session(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s public.anonymous_sessions%rowtype;
  v_hash text;
  v_convs int := 0;
  v_jobs  int := 0;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  if p_token is null or length(p_token) < 32 then
    raise exception 'invalid session token' using errcode = 'invalid_parameter_value';
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select * into s
  from public.anonymous_sessions
  where token_sha256 = v_hash
  for update;

  if not found then
    raise exception 'session not found' using errcode = 'no_data_found';
  end if;

  if s.claimed_at is not null then
    if s.claimed_by = auth.uid() then
      return jsonb_build_object('sessionId', s.id, 'already', true, 'conversations', 0, 'researchJobs', 0);
    end if;
    raise exception 'session already claimed' using errcode = 'insufficient_privilege';
  end if;

  if s.expires_at <= now() then
    raise exception 'session has expired' using errcode = 'invalid_parameter_value';
  end if;

  update public.ai_conversations
     set user_id = auth.uid(), anon_session_id = null
   where anon_session_id = s.id;
  get diagnostics v_convs = row_count;

  update public.research_jobs
     set user_id = auth.uid(), anon_session_id = null
   where anon_session_id = s.id;
  get diagnostics v_jobs = row_count;

  update public.anonymous_sessions
     set claimed_at = now(), claimed_by = auth.uid()
   where id = s.id;

  return jsonb_build_object(
    'sessionId', s.id, 'already', false,
    'conversations', v_convs, 'researchJobs', v_jobs
  );
end;
$function$;

comment on function public.claim_anonymous_session(text) is
  'Transfers everything an anonymous session owns to the signed-in caller. Idempotent for the same caller, refused for anybody else, refused once expired.';

revoke all on function public.claim_anonymous_session(text) from public, anon;
grant execute on function public.claim_anonymous_session(text) to authenticated;
