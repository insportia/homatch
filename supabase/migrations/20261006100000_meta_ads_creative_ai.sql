-- META ADS — HOMATCH AI CREATIVE INTELLIGENCE (explicit, cached, billed).
--
-- 1. meta_creative_ai_jobs — every AI operation on a Meta Ads creative, one
--    row each: an ANALYSIS (cached by the asset + campaign fingerprint, so
--    reopening the panel never asks the model again), a GENERATION (2–3 new
--    images from one concept) or a REFINE (one new image from a generated
--    one). The row carries the stage the job is really in, the outcome, the
--    billing reservation and what was charged, and the lineage
--    (source path → analysis → job → generated paths). The original upload
--    is never written to. Written by meta-ads-api (service role) only; the
--    owner reads their own rows. One row per (owner, idempotency key): a
--    retried or double-clicked request can never start — or charge — twice.
--
-- 2. meta_funnel_events check — see below.
--
-- Pricing, the provider price book and the kill switch are in
-- 20261006100100_meta_ads_creative_ai_pricing.sql.
--
-- Additive only (2 widens a check; no row changes meaning).

create table if not exists public.meta_creative_ai_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  campaign_id uuid references public.meta_campaigns(id) on delete cascade,
  creative_id uuid references public.meta_creatives(id) on delete set null,
  kind text not null check (kind in ('ANALYSIS', 'GENERATION', 'REFINE')),
  -- ANALYSIS: the asset + campaign context it read (cache key).
  fingerprint text,
  -- One logical request = one row, whatever the retries (unique per owner).
  idempotency_key text not null,
  status text not null default 'RUNNING' check (status in ('RUNNING', 'DONE', 'FAILED')),
  stage text not null default 'QUEUED',
  -- The source image path, concept, instruction, variation count, parent job.
  input jsonb not null default '{}'::jsonb,
  -- ANALYSIS: the analysis; GENERATION/REFINE: the generated assets.
  result jsonb,
  reservation_id uuid,
  quoted_credits numeric(12,2),
  charged_credits numeric(12,2),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_creative_ai_jobs_idem unique (user_id, idempotency_key),
  constraint meta_creative_ai_jobs_input_size check (pg_column_size(input) <= 16384),
  constraint meta_creative_ai_jobs_result_size check (result is null or pg_column_size(result) <= 65536)
);

create index if not exists meta_creative_ai_jobs_fp on public.meta_creative_ai_jobs (user_id, kind, fingerprint) where status = 'DONE';
create index if not exists meta_creative_ai_jobs_creative on public.meta_creative_ai_jobs (creative_id, created_at desc);

alter table public.meta_creative_ai_jobs enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'meta_creative_ai_jobs' and policyname = 'meta_creative_ai_jobs_own') then
    create policy meta_creative_ai_jobs_own on public.meta_creative_ai_jobs for select to authenticated
      using (user_id = public.auth_user_id() or public.is_admin());
  end if;
end $$;

revoke all on public.meta_creative_ai_jobs from anon;
grant select on public.meta_creative_ai_jobs to authenticated;

-- 2. meta_funnel_events — the rate limiters of forms_recheck, brief_interpret
--    and delivery_estimate count their own rows, but those events were never
--    allowed by the check, so every insert was rejected and the limits never
--    counted. Allow them, plus the creative-AI operations.
alter table public.meta_funnel_events drop constraint if exists meta_funnel_events_event_check;
alter table public.meta_funnel_events add constraint meta_funnel_events_event_check
  check (event in ('meta_ads_started','meta_ads_draft_created','meta_ads_auth_required','meta_ads_authenticated',
                   'meta_connected','preflight_completed','checkout_started','launch_requested','published',
                   'budget_edited','duration_edited','campaign_ended','recommendation_applied','lead_form_created',
                   'summary_generated','forms_recheck','brief_interpret','delivery_estimate')
         or event like 'ai_copy\_%'
         or event like 'creative_ai\_%');
