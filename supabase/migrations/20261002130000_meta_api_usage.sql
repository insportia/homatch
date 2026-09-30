-- META MARKETING API CAPACITY: the latest usage Meta reported, per
-- business-use-case bucket and type (X-Business-Use-Case-Usage), plus the ad
-- account (X-Ad-Account-Usage) and app (X-App-Usage) figures. Percentages,
-- regain minutes and the access tier only — never a token or credential.
-- Written by meta-ads-api (service role); read by admins and by the
-- schedulers, which slow down before Meta throttles.
create table if not exists public.meta_api_usage (
  bucket text not null,
  type text not null,
  call_count numeric not null default 0,
  total_cputime numeric not null default 0,
  total_time numeric not null default 0,
  regain_minutes numeric not null default 0,
  tier text,
  observed_at timestamptz not null default now(),
  primary key (bucket, type)
);
alter table public.meta_api_usage enable row level security;
drop policy if exists meta_api_usage_admin_read on public.meta_api_usage;
create policy meta_api_usage_admin_read on public.meta_api_usage for select to authenticated using (public.is_admin());
revoke all on public.meta_api_usage from anon;
revoke insert, update, delete, truncate on public.meta_api_usage from authenticated;
grant select on public.meta_api_usage to authenticated;  -- rows: admins only (RLS)
