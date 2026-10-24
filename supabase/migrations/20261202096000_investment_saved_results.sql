-- HOMI workstream · Investment Intelligence: "შედეგის შენახვა".
--
-- The investment workspace kept one draft per device. A person can now save a named result
-- (the strategy and the inputs that produced it, plus the headline figures as they were) and
-- reopen it on any device. The inputs are what the person entered or accepted; the figures are
-- recomputed from them by the same engine when reopened, so a saved row is a bookmark of a
-- calculation, never a second source of truth. Owner-only; additive and idempotent.

create table if not exists public.investment_saved_results (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 80),
  strategy    text not null check (strategy in ('RENOVATE_RESELL', 'CONSTRUCTION_RESALE', 'RENTAL_INVESTMENT', 'INVESTMENT_VALUE')),
  context     jsonb not null check (jsonb_typeof(context) = 'object'),
  -- The headline figures shown when it was saved: [{ labelKey, value, kind }].
  summary     jsonb not null default '[]'::jsonb check (jsonb_typeof(summary) = 'array'),
  currency    text,
  created_at  timestamptz not null default now()
);
create index if not exists investment_saved_results_user on public.investment_saved_results (user_id, created_at desc);

alter table public.investment_saved_results enable row level security;
revoke all on public.investment_saved_results from anon;
grant select, insert, delete on public.investment_saved_results to authenticated;

drop policy if exists investment_saved_results_own_read on public.investment_saved_results;
create policy investment_saved_results_own_read on public.investment_saved_results
  for select using (user_id = public.current_homatch_user_id());
drop policy if exists investment_saved_results_own_insert on public.investment_saved_results;
create policy investment_saved_results_own_insert on public.investment_saved_results
  for insert with check (user_id = public.current_homatch_user_id());
drop policy if exists investment_saved_results_own_delete on public.investment_saved_results;
create policy investment_saved_results_own_delete on public.investment_saved_results
  for delete using (user_id = public.current_homatch_user_id());
-- No UPDATE: a saved result is a snapshot; saving again makes a new one.
