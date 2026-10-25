-- MORTGAGE: official exchange rates for multi-currency entry.
--
-- The mortgage calculator accepts an amount in any currency and turns it
-- into the loan currency (lari by default) with the National Bank of
-- Georgia's official rate. One row per currency: GEL per ONE unit (the NBG's
-- per-10 / per-100 quotes are divided before they land here) and the date
-- the NBG published it.
--
-- Written only by the mortgage-fx-rates Edge Function with the service role
-- (no insert/update/delete policy exists, so no browser can write). Read by
-- anyone: these are public figures.
--
-- Deliberately separate from public.fx_rates, which is operator-entered and
-- feeds billing (Verify budgets, finance). An NBG refresh must never move a
-- price anybody is charged.

create table if not exists public.mortgage_fx_rates (
  currency     text primary key check (currency ~ '^[A-Z]{3}$' and currency <> 'GEL'),
  gel_per_unit numeric(18, 8) not null check (gel_per_unit > 0),
  rate_date    date not null,
  source       text not null default 'National Bank of Georgia',
  fetched_at   timestamptz not null default now()
);

comment on table public.mortgage_fx_rates is
  'NBG official rates (GEL per 1 unit) for mortgage multi-currency entry. Written by the mortgage-fx-rates Edge Function only. Not used for billing.';

alter table public.mortgage_fx_rates enable row level security;

drop policy if exists mortgage_fx_rates_public_read on public.mortgage_fx_rates;
create policy mortgage_fx_rates_public_read on public.mortgage_fx_rates
  for select to anon, authenticated using (true);

grant select on public.mortgage_fx_rates to anon, authenticated;
revoke insert, update, delete on public.mortgage_fx_rates from anon, authenticated;
