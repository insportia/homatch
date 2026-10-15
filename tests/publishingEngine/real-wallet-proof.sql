\set ON_ERROR_STOP on
create schema extensions;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create schema auth;
create table auth.users(id uuid primary key);
CREATE OR REPLACE FUNCTION auth.jwt()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  select 
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$function$
;
CREATE OR REPLACE FUNCTION auth.role()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$function$
;
CREATE OR REPLACE FUNCTION auth.uid()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$
;
grant usage on schema auth,public to anon,authenticated,service_role;
\ir wallet-schema.snapshot.sql
\ir ../../supabase/migrations/20261014074630_publishing_engine.sql
\ir ../../supabase/migrations/20261014140000_publishing_engine_ssge.sql
\ir ../../supabase/migrations/20261014162952_publishing_engine_v2.sql
\ir ../../supabase/migrations/20261015092646_publishing_engine_managed_accounts.sql
\ir ../../supabase/migrations/20261015114915_publishing_engine_draft_schema_compatibility.sql
insert into public.billing_plans select * from jsonb_populate_recordset(null::public.billing_plans,'[{"code":"FREE","name":"Free","config":{},"enabled":true,"badge_key":null,"created_at":"2026-09-11T19:33:06.675861+00:00","sort_order":1,"updated_at":"2026-09-11T19:33:06.675861+00:00","quality_tier":"STANDARD","priority_level":0,"ai_fair_use_key":"ai_chat_daily_limit_free","marketing_label_key":null,"monthly_price_cents":0,"membership_rollover_cap":0,"membership_credits_grant":0,"profit_share_to_customer_bps":0},{"code":"VIP","name":"VIP","config":{},"enabled":true,"badge_key":"badge_vip","created_at":"2026-09-11T19:33:06.675861+00:00","sort_order":2,"updated_at":"2026-09-11T19:33:06.675861+00:00","quality_tier":"ENHANCED","priority_level":1,"ai_fair_use_key":"ai_chat_daily_limit_vip","marketing_label_key":"plan_label_popular","monthly_price_cents":900,"membership_rollover_cap":180,"membership_credits_grant":90,"profit_share_to_customer_bps":2500},{"code":"PREMIUM","name":"Premium","config":{},"enabled":true,"badge_key":"badge_premium","created_at":"2026-09-11T19:33:06.675861+00:00","sort_order":3,"updated_at":"2026-09-11T19:33:06.675861+00:00","quality_tier":"MAXIMUM","priority_level":2,"ai_fair_use_key":"ai_chat_daily_limit_premium","marketing_label_key":"plan_label_best_value","monthly_price_cents":2900,"membership_rollover_cap":580,"membership_credits_grant":290,"profit_share_to_customer_bps":5000}]'::jsonb);
insert into public.admin_settings(key,value) values('credits_per_usd','10'::jsonb);
insert into public.admin_settings(key,value) values('billing_reservation_ttl_minutes','60'::jsonb);
insert into public.admin_settings(key,value) values('billing_payg_enabled','true'::jsonb);
insert into public.admin_settings(key,value) values('billing_pricing_version','2'::jsonb);
select set_config('request.jwt.claims','{"role":"service_role"}',false);
insert into public.users(id,auth_id,email,full_name,is_admin) values('11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111112','publishing-wallet-proof@example.invalid','Publishing release QA',true);
\ir staging-ledger-proof.sql
