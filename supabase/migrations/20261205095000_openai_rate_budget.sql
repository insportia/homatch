-- Verify at scale: one OpenAI budget shared by every edge invocation.
--
-- Hundreds of concurrent verifications each call the model from their own
-- edge invocation; nothing shared knew how many requests or tokens were
-- already in flight this minute, so a burst ran into 429s and (before this
-- release) the report degraded quietly. A caller now reserves its request and
-- estimated tokens in the current minute; over the configured RPM/TPM it is
-- told how long to wait for the next minute instead. Limits come from
-- admin_settings.openai_limits; with no limit set nothing is reserved.

create table if not exists public.openai_rate_minutes (
  bucket text not null,
  minute_start timestamptz not null,
  requests integer not null default 0,
  tokens bigint not null default 0,
  primary key (bucket, minute_start)
);
alter table public.openai_rate_minutes enable row level security;
revoke all on table public.openai_rate_minutes from public, anon, authenticated;
grant select, insert, update, delete on table public.openai_rate_minutes to service_role;

create or replace function public.openai_rate_reserve(p_bucket text, p_tokens integer, p_rpm integer, p_tpm integer)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_minute timestamptz := date_trunc('minute', now());
  v_row record;
begin
  if p_bucket is null or (coalesce(p_rpm, 0) <= 0 and coalesce(p_tpm, 0) <= 0) then return 0; end if;
  perform pg_advisory_xact_lock(hashtext('openai_rate:' || p_bucket));
  delete from public.openai_rate_minutes where bucket = p_bucket and minute_start < v_minute - interval '10 minutes';
  select requests, tokens into v_row from public.openai_rate_minutes where bucket = p_bucket and minute_start = v_minute;
  if v_row is not null and (
       (coalesce(p_rpm, 0) > 0 and v_row.requests + 1 > p_rpm)
    or (coalesce(p_tpm, 0) > 0 and v_row.tokens + greatest(p_tokens, 0) > p_tpm and v_row.tokens > 0)
  ) then
    -- Full this minute: wait for the next one.
    return greatest(1, ceil(extract(epoch from (v_minute + interval '1 minute' - now())) * 1000))::integer;
  end if;
  insert into public.openai_rate_minutes (bucket, minute_start, requests, tokens)
  values (p_bucket, v_minute, 1, greatest(p_tokens, 0))
  on conflict (bucket, minute_start) do update
    set requests = public.openai_rate_minutes.requests + 1,
        tokens = public.openai_rate_minutes.tokens + greatest(p_tokens, 0);
  return 0;
end;
$function$;

revoke all on function public.openai_rate_reserve(text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.openai_rate_reserve(text, integer, integer, integer) to service_role;
