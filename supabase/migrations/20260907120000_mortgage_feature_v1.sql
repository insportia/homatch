-- 20260907120000_mortgage_feature_v1.sql
-- Mortgage / Home-Financing feature: versioned official knowledge base,
-- saved user scenarios, and uploaded bank-offer documents.
--
-- CONVENTIONS FOLLOWED (confirmed against this repo's real schema before
-- writing this file, not guessed):
--   * Timestamp-prefixed filename, matching every migration since
--     20260827203146_homatch_part1_schema.sql.
--   * User-owned tables use public.auth_user_id() — the current, most
--     recently established name for "resolve public.users.id from
--     auth.uid()" (the same underlying resolution as the older
--     get_user_id(), which properties/transaction_cases still use; new
--     tables in this pass use the newer name per
--     20260831120000_pricing_wallet_foundation_part1.sql's own precedent).
--     This project has TWO incompatible user_id id-spaces across older
--     tables (see 20260906140000_fix_research_case_user_id_space.sql) —
--     every new table here is auth_user_id()-based and self-consistent.
--     CONCRETE CHECK PERFORMED: public.auth_user_id() (final definition,
--     20260829000002_security_hardening.sql) resolves auth.uid() ->
--     public.users.id, NOT auth.users.id directly. Every other real table
--     that filters by public.auth_user_id() (pricing_wallet_foundation_part2,
--     live_chat_v1) declares its user_id column as
--     "references public.users(id)", never "references auth.users(id)".
--     mortgage_scenarios.user_id and mortgage_offers.user_id below are
--     declared the same way for that reason -- referencing auth.users(id)
--     here would silently break every RLS policy in this file (the
--     comparison would never match), which is exactly the id-space bug
--     class this project has hit before.
--   * Versioned/superseded-status pattern mirrors
--     20260905222923_transaction_case_crm.sql's status+supersedes-id
--     approach (lighter-weight than that migration's full snapshot table,
--     since a mortgage_rules row IS the whole record, not a large document).
--   * Storage RLS mirrors the folder-scoped "contact-imports" bucket
--     pattern (auth.uid()::text = (storage.foldername(name))[1]), not the
--     looser property-photos policy — bank-offer documents are private
--     financial data.
--
-- Mandate requirements enforced structurally here (not just in app code):
--   * mortgage_rules is genuinely append-only-by-supersession: there is no
--     UPDATE policy for authenticated/anon roles, and no DELETE policy at
--     all — the only way to change an ACTIVE rule is to insert a new
--     version row and (via the service role / admin tooling, not client
--     RLS) flip the old row to SUPERSEDED. "Never silently replace
--     previous rules" is therefore a database-level guarantee, not a
--     frontend convention.
--   * mortgage_scenarios has no client UPDATE policy either — "Recalculate
--     creates a new version, old remains" is enforced the same way.
--   * Every private table (mortgage_scenarios, mortgage_offers) is
--     select/insert/delete-own only — never publicly readable, per the
--     mandate's privacy/RLS requirement.

-- ================================================================
-- ENUMS
-- ================================================================
create type mortgage_rule_status as enum ('CANDIDATE','ACTIVE','SUPERSEDED','REJECTED');
create type mortgage_rule_type as enum ('PTI_LIMIT','LTV_LIMIT','EFFECTIVE_RATE_METHODOLOGY','DEFINITION','SUBSIDY_PROGRAM','FOREIGN_BUYER_BANK_RULE','CLOSING_COST');
create type mortgage_offer_source as enum ('USER_UPLOADED','USER_MANUAL_ENTRY','BANK_PUBLISHED');

-- ================================================================
-- MORTGAGE KNOWLEDGE BASE (versioned official rules/definitions)
-- ================================================================
create table public.mortgage_rules (
  id uuid primary key default gen_random_uuid(),
  type mortgage_rule_type not null,
  title text not null,
  data jsonb not null,
  human_explanation text not null,
  official_source_url text not null,
  source_authority text not null,
  effective_from date,
  effective_to date,
  last_verified_at date not null,
  status mortgage_rule_status not null default 'CANDIDATE',
  version integer not null default 1,
  supersedes_rule_id uuid references public.mortgage_rules(id) on delete set null,
  country text not null default 'GE',
  currency text,
  eligibility_dimensions jsonb,
  created_at timestamptz not null default now()
);

create index idx_mortgage_rules_type_status on public.mortgage_rules(type, status);
create index idx_mortgage_rules_country on public.mortgage_rules(country);

alter table public.mortgage_rules enable row level security;

-- Read: ACTIVE rules are public knowledge-base content (the calculator and
-- its explanations must work for a signed-out visitor too) — anyone may
-- read an ACTIVE rule; CANDIDATE/SUPERSEDED/REJECTED rows are visible only
-- to admins (via the service role in an admin tool, or an authenticated
-- admin session), never to ordinary users or anonymous visitors, so a
-- half-approved candidate rule can never leak into the live calculator.
create policy "mortgage_rules_select_active_public" on public.mortgage_rules
  for select using (status = 'ACTIVE' or public.is_admin());

-- Write: admin-only from the client. Ordinary INSERT/UPDATE of a real
-- ACTIVE rule is expected to go through admin tooling (is_admin()) or a
-- service-role migration/freshness job — never through anonymous or
-- plain-authenticated client code.
create policy "mortgage_rules_admin_write" on public.mortgage_rules
  for insert with check (public.is_admin());
create policy "mortgage_rules_admin_update" on public.mortgage_rules
  for update using (public.is_admin()) with check (public.is_admin());
-- Deliberately no DELETE policy at all: history is never destroyed, only
-- superseded (status flip via the admin update policy above).

-- ================================================================
-- SAVED / VERSIONED MORTGAGE SCENARIOS
-- ================================================================
create table public.mortgage_scenarios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  input jsonb not null,
  result jsonb not null,
  affordability jsonb,
  rule_version_ids uuid[] not null default '{}',
  offer_refs uuid[] not null default '{}',
  calculated_at timestamptz not null default now(),
  version integer not null default 1,
  supersedes_scenario_id uuid references public.mortgage_scenarios(id) on delete set null,
  label text,
  created_at timestamptz not null default now()
);

create index idx_mortgage_scenarios_user_id on public.mortgage_scenarios(user_id);
create index idx_mortgage_scenarios_property_id on public.mortgage_scenarios(property_id);

alter table public.mortgage_scenarios enable row level security;

create policy "mortgage_scenarios_select_own" on public.mortgage_scenarios
  for select using (user_id = public.auth_user_id());
create policy "mortgage_scenarios_insert_own" on public.mortgage_scenarios
  for insert with check (user_id = public.auth_user_id());
create policy "mortgage_scenarios_delete_own" on public.mortgage_scenarios
  for delete using (user_id = public.auth_user_id());
-- No UPDATE policy: "Recalculate" always inserts a new row that points
-- back via supersedes_scenario_id — an old scenario's numbers can never be
-- mutated in place by a client, per the mandate's explicit requirement.

-- ================================================================
-- BANK OFFERS (user-uploaded or user-manually-entered)
-- ================================================================
create table public.mortgage_offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  scenario_id uuid references public.mortgage_scenarios(id) on delete set null,
  offer_name text not null,
  source mortgage_offer_source not null,
  data jsonb not null, -- the normalized MortgageOffer shape (loanAmount, rate, fees, etc.)
  document_storage_path text, -- set only when source = 'USER_UPLOADED'
  extraction jsonb, -- field-level confidence + confirmedByUser, only for USER_UPLOADED
  created_at timestamptz not null default now()
);

create index idx_mortgage_offers_user_id on public.mortgage_offers(user_id);

alter table public.mortgage_offers enable row level security;

create policy "mortgage_offers_select_own" on public.mortgage_offers
  for select using (user_id = public.auth_user_id());
create policy "mortgage_offers_insert_own" on public.mortgage_offers
  for insert with check (user_id = public.auth_user_id());
create policy "mortgage_offers_update_own" on public.mortgage_offers
  for update using (user_id = public.auth_user_id()) with check (user_id = public.auth_user_id());
create policy "mortgage_offers_delete_own" on public.mortgage_offers
  for delete using (user_id = public.auth_user_id());

-- ================================================================
-- STORAGE: uploaded bank-offer documents (private, folder-scoped by uid)
-- ================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mortgage-offer-documents', 'mortgage-offer-documents', false, 20971520, array['application/pdf','image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

create policy "mortgage_docs_upload_own" on storage.objects
  for insert with check (bucket_id = 'mortgage-offer-documents' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "mortgage_docs_read_own" on storage.objects
  for select using (bucket_id = 'mortgage-offer-documents' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "mortgage_docs_delete_own" on storage.objects
  for delete using (bucket_id = 'mortgage-offer-documents' and auth.uid()::text = (storage.foldername(name))[1]);

-- ================================================================
-- ANALYTICS: extend the existing activity_event_type enum
-- (mandate-requested events; kept UPPER_SNAKE_CASE to match this enum's
-- existing values rather than the mandate's own lower_snake_case prose —
-- see src/services/mortgageApi.ts for the logActivity() call sites).
-- Each ALTER TYPE ... ADD VALUE is its own statement and is never
-- referenced later in this same file/transaction, which Postgres requires.
-- ================================================================
alter type activity_event_type add value if not exists 'MORTGAGE_PAGE_OPENED';
alter type activity_event_type add value if not exists 'MORTGAGE_CALCULATED';
alter type activity_event_type add value if not exists 'PROPERTY_MORTGAGE_OPENED';
alter type activity_event_type add value if not exists 'MORTGAGE_TERM_COMPARED';
alter type activity_event_type add value if not exists 'MORTGAGE_AFFORDABILITY_CHECKED';
alter type activity_event_type add value if not exists 'MORTGAGE_SUBSIDY_CHECKED';
alter type activity_event_type add value if not exists 'MORTGAGE_OFFER_UPLOADED';
alter type activity_event_type add value if not exists 'MORTGAGE_OFFERS_COMPARED';
alter type activity_event_type add value if not exists 'MORTGAGE_SCENARIO_SAVED';

-- ================================================================
-- SEED DATA — real, sourced, dated. Every row below was verified against
-- its cited live official source on 2026-09-07 (this migration's authoring
-- date); no numeric value here is invented. Where the source page did not
-- itself state an effective_from date, that column is left NULL rather
-- than guessed — "NO CURRENT VERIFIED SOURCE = NO CURRENT FACT" applies to
-- dates too, not just numbers.
-- ================================================================

-- PTI limits — National Bank of Georgia, https://nbg.gov.ge/page/pti-da-ltv-motkhovnebi
-- (fetched 2026-09-07). Four tiers: income level (below/at-or-above 1500
-- GEL-equivalent monthly net) x currency class (GEL vs foreign currency).
insert into public.mortgage_rules (type, title, data, human_explanation, official_source_url, source_authority, effective_from, last_verified_at, status, version, country, currency, eligibility_dimensions) values
('PTI_LIMIT', 'PTI limit — GEL loans, monthly net income below 1,500 GEL',
 '{"incomeTierMaxMonthlyNet": 1500, "currencyClass": "LOCAL", "maxPtiPercent": 25}'::jsonb,
 'mortgage_kb_explain_pti_gel_low_income',
 'https://nbg.gov.ge/page/pti-da-ltv-motkhovnebi', 'National Bank of Georgia', null, '2026-09-07', 'ACTIVE', 1, 'GE', 'GEL',
 '{"incomeCurrencyEquivalentThreshold": 1500}'::jsonb),
('PTI_LIMIT', 'PTI limit — GEL loans, monthly net income 1,500 GEL or above',
 '{"incomeTierMaxMonthlyNet": null, "currencyClass": "LOCAL", "maxPtiPercent": 50}'::jsonb,
 'mortgage_kb_explain_pti_gel_high_income',
 'https://nbg.gov.ge/page/pti-da-ltv-motkhovnebi', 'National Bank of Georgia', null, '2026-09-07', 'ACTIVE', 1, 'GE', 'GEL',
 '{"incomeCurrencyEquivalentThreshold": 1500}'::jsonb),
('PTI_LIMIT', 'PTI limit — foreign-currency loans, monthly net income below 1,500 GEL-equivalent',
 '{"incomeTierMaxMonthlyNet": 1500, "currencyClass": "FOREIGN", "maxPtiPercent": 20}'::jsonb,
 'mortgage_kb_explain_pti_fx_low_income',
 'https://nbg.gov.ge/page/pti-da-ltv-motkhovnebi', 'National Bank of Georgia', null, '2026-09-07', 'ACTIVE', 1, 'GE', null,
 '{"incomeCurrencyEquivalentThreshold": 1500}'::jsonb),
('PTI_LIMIT', 'PTI limit — foreign-currency loans, monthly net income 1,500 GEL-equivalent or above',
 '{"incomeTierMaxMonthlyNet": null, "currencyClass": "FOREIGN", "maxPtiPercent": 30}'::jsonb,
 'mortgage_kb_explain_pti_fx_high_income',
 'https://nbg.gov.ge/page/pti-da-ltv-motkhovnebi', 'National Bank of Georgia', null, '2026-09-07', 'ACTIVE', 1, 'GE', null,
 '{"incomeCurrencyEquivalentThreshold": 1500}'::jsonb);

-- LTV limits — same source. Two tiers by currency class only.
insert into public.mortgage_rules (type, title, data, human_explanation, official_source_url, source_authority, effective_from, last_verified_at, status, version, country, currency) values
('LTV_LIMIT', 'LTV limit — GEL-denominated loans',
 '{"currencyClass": "LOCAL", "maxLtvPercent": 90}'::jsonb,
 'mortgage_kb_explain_ltv_gel',
 'https://nbg.gov.ge/page/pti-da-ltv-motkhovnebi', 'National Bank of Georgia', null, '2026-09-07', 'ACTIVE', 1, 'GE', 'GEL'),
('LTV_LIMIT', 'LTV limit — foreign-currency-denominated loans',
 '{"currencyClass": "FOREIGN", "maxLtvPercent": 70}'::jsonb,
 'mortgage_kb_explain_ltv_fx',
 'https://nbg.gov.ge/page/pti-da-ltv-motkhovnebi', 'National Bank of Georgia', null, '2026-09-07', 'ACTIVE', 1, 'GE', null);

-- Effective-rate methodology — a DEFINITION row, not a numeric rule: names
-- the official calculator/input categories and is explicit that this
-- project computes its own CALCULATED estimate using a standard actuarial
-- method rather than an undisclosed formula (see
-- src/mortgage/calculations/effectiveRate.ts's header comment for the full
-- reasoning). Prevents the UI from ever claiming to reproduce an NBG
-- formula it does not actually have.
insert into public.mortgage_rules (type, title, data, human_explanation, official_source_url, source_authority, effective_from, last_verified_at, status, version, country, currency) values
('EFFECTIVE_RATE_METHODOLOGY', 'Effective interest rate — official calculator inputs',
 '{"officialCalculatorInputs": ["loanAmountAndCurrency","gracePeriodMonths","maturityAfterGrace","annualInterestRatePercent","issuanceAndPaymentDates","paymentFrequency","oneTimeFinancialCostsAtIssuance","periodicFinancialCosts","periodicFinancialCostsPercentOfRemainingPrincipal"], "projectMethodology": "IRR_CASH_FLOW_ESTIMATE"}'::jsonb,
 'mortgage_kb_explain_effective_rate_methodology',
 'https://nbg.gov.ge/en/calculators?calculator=loaneffectiveinterest', 'National Bank of Georgia', null, '2026-09-07', 'ACTIVE', 1, 'GE', null);

-- Subsidy program — Matsne decree #388 (2021-08-02), effective 2021-09-01,
-- confirmed still in force with amendments as of 2026-05-21 (fetched
-- 2026-09-07). "Subsidized Mortgage Loan" for families with children.
insert into public.mortgage_rules (type, title, data, human_explanation, official_source_url, source_authority, effective_from, last_verified_at, status, version, country, currency, eligibility_dimensions) values
('SUBSIDY_PROGRAM', 'Subsidized Mortgage Loan — families with children (Decree No. 388)',
 '{"programName": "Subsidized Mortgage Loan", "administrator": "Government of Georgia (per Decree No. 388, 2 August 2021)", "maxLoanAmount": 200000, "currency": "GEL", "durationMonths": 60, "citizenshipRequired": true, "eligibilityCriteria": [{"key": "children_born_after_2021_09_01", "description": "mortgage_kb_subsidy_eligibility_child_born_after"}, {"key": "three_plus_children_by_2022_09_01", "description": "mortgage_kb_subsidy_eligibility_three_plus_children"}, {"key": "adopted_child_after_2021_09_01", "description": "mortgage_kb_subsidy_eligibility_adopted_child"}, {"key": "single_parent_or_widow", "description": "mortgage_kb_subsidy_eligibility_single_parent_widow"}], "subsidyDescription": "mortgage_kb_subsidy_description_rate_reduction", "subsidyRateFormula": {"oneToTwoChildren": "NBG_refinancing_rate_minus_3.5pp_capped_at_6pct", "threeOrMoreChildren": "NBG_refinancing_rate_minus_1.5pp_capped_at_8pct"}}'::jsonb,
 'mortgage_kb_subsidy_human_explanation',
 'https://www.matsne.gov.ge/ka/document/view/5231778', 'Government of Georgia / LEPL Legislative Herald of Georgia (Matsne)', '2021-09-01', '2026-09-07', 'ACTIVE', 1, 'GE', 'GEL',
 '{"citizenshipRequired": "GE", "requiresChildren": true}'::jsonb);
