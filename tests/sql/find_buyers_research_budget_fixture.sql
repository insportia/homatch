-- Extra objects for 20261028120000_find_buyers_research_budget.sql, on top of
-- homatch_leads_fixture.sql (users, wallet, admin_settings).
create table public.find_buyers_campaigns (
  matching_job_id uuid primary key, campaign_id uuid, property_id uuid, user_id uuid, credits_committed integer,
  customer_value_micros bigint, provider_budget_micros bigint, finalized_at timestamptz
);
insert into public.billable_products (code, name, billing_mode, standard_retail_cents, enabled, pricing_active, min_viable_budget_credits)
values ('FIND_CLIENTS', 'Find Clients', 'VARIABLE', 250, true, true, 50);
insert into public.admin_settings (key, value) values
  ('search_budget_presets_find_clients', '[50, 100, 200, 500]'), ('search_budget_recommended_find_clients', '50'),
  ('find_buyers_provider_share_bps', '5000');
update public.credit_accounts set balance = 1000 where user_id = '00000000-0000-0000-0000-0000000000a1';
insert into public.find_buyers_campaigns values
  ('00000000-0000-0000-0000-00000000e001', gen_random_uuid(), '00000000-0000-0000-0000-0000000000f1',
   '00000000-0000-0000-0000-0000000000a1', 100, 10000000, 5000000, null);
