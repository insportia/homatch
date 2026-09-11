-- Two small corrections found by attacking the function in production.
--
-- 1. An unknown token raised no_data_found, which PostgREST turned into a
--    500. A caller supplying a bad token is a client error, not a server
--    fault, and a 500 sends people looking for an outage that is not there.
--
-- 2. More importantly, "session not found" and "invalid session token" were
--    DIFFERENT answers. That is an existence oracle: it lets somebody probe
--    which tokens exist, one guess at a time. A token is either usable by the
--    caller or it is not, and the caller learns nothing else.
--
-- Everything else is unchanged.

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
  -- One answer for every unusable token, so nothing can be probed.
  c_unusable constant text := 'session cannot be claimed';
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  if p_token is null or length(p_token) < 32 then
    raise exception '%', c_unusable using errcode = 'invalid_parameter_value';
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select * into s
  from public.anonymous_sessions
  where token_sha256 = v_hash
  for update;

  if not found then
    raise exception '%', c_unusable using errcode = 'invalid_parameter_value';
  end if;

  -- Idempotent for the person who already claimed it: a browser refresh during
  -- the sign-in round trip is the ordinary case, not an error.
  if s.claimed_at is not null then
    if s.claimed_by = auth.uid() then
      return jsonb_build_object('sessionId', s.id, 'already', true, 'conversations', 0, 'researchJobs', 0);
    end if;
    -- Somebody else's claimed session is simply unusable to this caller, and
    -- is described the same way as one that never existed.
    raise exception '%', c_unusable using errcode = 'invalid_parameter_value';
  end if;

  if s.expires_at <= now() then
    raise exception '%', c_unusable using errcode = 'invalid_parameter_value';
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

revoke all on function public.claim_anonymous_session(text) from public, anon;
grant execute on function public.claim_anonymous_session(text) to authenticated;
