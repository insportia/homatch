-- FIND PROPERTY — Deep Search: each paid campaign's own, stable results (owner, 2026-10-18).
--
-- The first real 50-credit campaign (f8833757) stored 600 Tbilisi sale offers; the UI
-- headlined "600 offers found" while its results page showed one property. A campaign's
-- offers were only ever re-ranked inside the free marketplace search, so:
--   * the headline counted posts, not properties that fit the request;
--   * "results delivered" counted the free search's deliveries (portals included);
--   * a later campaign that re-reads the same post re-attributes it (the observation is
--     upserted by source + external id), so an earlier campaign's offers were not stable.
--
-- Now every ended campaign judges its offers against the customer's exact request
-- (src/research-core/findProperty/campaignMatch.ts) and keeps the verdicts here, with a
-- snapshot of what the post said, so its results page reads the same list after a
-- refresh or months later. discovery_runs.campaign_outcome holds the counts (raw fetched,
-- offers, unique, exact, potential, alternative, rejected by reason, available).
--
-- Read only through find-property-run (owner or admin checked server-side): no client
-- policy, so RLS denies every direct read. No money column; wallet and ledger untouched.

create table if not exists public.find_property_campaign_results (
  run_id uuid not null references public.discovery_runs(id) on delete cascade,
  observation_id uuid not null,
  category text not null check (category in ('EXACT', 'POTENTIAL', 'ALTERNATIVE', 'REJECTED')),
  rank integer not null,
  score numeric not null default 0,
  checks jsonb not null default '[]'::jsonb,
  reject_reasons text[] not null default '{}',
  duplicate_ids uuid[] not null default '{}',
  snapshot jsonb not null default '{}'::jsonb,
  match_version text not null,
  created_at timestamptz not null default now(),
  primary key (run_id, observation_id)
);

create index if not exists find_property_campaign_results_rank
  on public.find_property_campaign_results (run_id, category, rank);

alter table public.find_property_campaign_results enable row level security;
revoke all on public.find_property_campaign_results from anon, authenticated;
grant select, insert, update, delete on public.find_property_campaign_results to service_role;

alter table public.discovery_runs add column if not exists campaign_outcome jsonb;

comment on table public.find_property_campaign_results is
  'Deep Search: one paid campaign''s offers judged against the customer''s exact request (EXACT / POTENTIAL / ALTERNATIVE / REJECTED), with a snapshot of the post. Service-role only; read via find-property-run.';
comment on column public.discovery_runs.campaign_outcome is
  'Deep Search counts: fetched, candidates, unique, duplicates, exact, potential, alternative, rejected, rejectedBy, available (campaignMatch.ts).';

-- The temporary 20-credit TEST campaign (owner, 2026-10-18): OFF until an admin turns it on;
-- only admins and the listed testers may start one. Same 37/63 split, reservation and settlement.
insert into public.admin_settings (key, value)
values ('find_property_test_campaign', '{"enabled": false, "credits": 20, "testers": []}'::jsonb)
on conflict (key) do nothing;
