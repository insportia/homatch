-- ============================================================================
-- VERIFY — translating the CONTENT of a report (owner P0, 2026-10-12).
--
-- A Verify report's content is Georgian (model prose, deterministic copy and
-- sentences the browser computes). When the customer reads in EN/RU/TR/AR/HE
-- the browser asks verify-synthesis (action `translate`) for each Georgian
-- text it renders. Translation is keyed on the TEXT, not on the report: the
-- same sentence is translated once per language and reused by every report,
-- past and future.
--
--   verify_text_translations        the cache: (sha256 of the NFC-trimmed
--                                   Georgian text, target language) → text.
--                                   Written and read ONLY by the service role
--                                   inside verify-synthesis, after the caller
--                                   was shown to be allowed to read the job.
--   verify_text_translation_usage   model characters per job, language and
--                                   hour — the rate limit. Cache hits are free
--                                   and never counted.
--   verify_translation_quota_take() atomically records a model call against
--                                   the hour's allowance, or refuses it.
--
-- The model's cost is a cost_events row (provider OPENAI, operation_type
-- REPORT_TRANSLATION_VERIFY, job_id = the job) priced from provider_price_book
-- with an explicit pricing_state — never a silent zero.
--
-- No client access: RLS on, no policies, everything revoked from anon and
-- authenticated. Append-only migration; nothing existing changes.
-- ============================================================================

create table if not exists public.verify_text_translations (
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  lang text not null check (lang in ('en', 'ru', 'tr', 'ar', 'he')),
  source text not null check (char_length(source) between 1 and 4000),
  translated text not null check (char_length(translated) between 1 and 16000),
  model text not null,
  created_at timestamptz not null default now(),
  primary key (source_hash, lang)
);

comment on table public.verify_text_translations is
  'Verify report content translations, keyed on the Georgian TEXT (sha256 of NFC-trimmed source) and target language; reused by every report. Service role only (verify-synthesis translate).';

alter table public.verify_text_translations enable row level security;
revoke all on public.verify_text_translations from public, anon, authenticated;
grant select, insert on public.verify_text_translations to service_role;

create table if not exists public.verify_text_translation_usage (
  job_id uuid not null,
  lang text not null check (lang in ('en', 'ru', 'tr', 'ar', 'he')),
  window_start timestamptz not null,
  calls integer not null default 0 check (calls >= 0),
  chars integer not null default 0 check (chars >= 0),
  primary key (job_id, lang, window_start)
);

comment on table public.verify_text_translation_usage is
  'Rate limit for verify-synthesis translate: model calls and characters sent to the model per job, language and hour. Cache hits are not counted. Service role only.';

alter table public.verify_text_translation_usage enable row level security;
revoke all on public.verify_text_translation_usage from public, anon, authenticated;
grant select, insert, update on public.verify_text_translation_usage to service_role;

/*
 * Takes p_chars from this hour's allowance for (job, lang) as one call.
 * Returns true when it fit (and was recorded), false when it would exceed
 * p_max_chars or p_max_calls — then nothing is recorded.
 */
create or replace function public.verify_translation_quota_take(
  p_job_id uuid,
  p_lang text,
  p_chars integer,
  p_max_chars integer,
  p_max_calls integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz := date_trunc('hour', now());
  v_row public.verify_text_translation_usage%rowtype;
begin
  if p_job_id is null or p_lang is null or coalesce(p_chars, -1) < 0 then
    return false;
  end if;
  insert into public.verify_text_translation_usage (job_id, lang, window_start)
  values (p_job_id, p_lang, v_window)
  on conflict (job_id, lang, window_start) do nothing;

  select * into v_row
    from public.verify_text_translation_usage
   where job_id = p_job_id and lang = p_lang and window_start = v_window
   for update;

  if v_row.calls + 1 > p_max_calls or v_row.chars + p_chars > p_max_chars then
    return false;
  end if;

  update public.verify_text_translation_usage
     set calls = calls + 1, chars = chars + p_chars
   where job_id = p_job_id and lang = p_lang and window_start = v_window;
  return true;
end;
$$;

revoke all on function public.verify_translation_quota_take(uuid, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.verify_translation_quota_take(uuid, text, integer, integer, integer) to service_role;
