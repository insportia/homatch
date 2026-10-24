-- Mortgage Consultant: rule freshness, the announced 2027 PTI band change,
-- and a reviewed bank-conditions table.
--
-- 1. FRESHNESS. On 2026-10-24 the National Bank of Georgia's PTI/LTV page
--    (https://nbg.gov.ge/en/page/pti-and-ltv-requirements) still reads exactly
--    as the knowledge base holds it: PTI GEL 25% / 50% and foreign currency
--    20% / 30% at the 1,500 GEL net-income boundary; LTV 90% GEL / 70% foreign
--    currency. Nothing changes but last_verified_at.
--
-- 2. THE ANNOUNCED CHANGE, AS A CANDIDATE. Press reports of the Financial
--    Stability Committee's 2026-09-30 decision (civil.ge/archives/753059,
--    georgiatoday.ge) say the 25% limit will cover borrowers below 2,000 GEL
--    from 2027-02-01 and below 2,500 GEL from 2027-09-01. The National Bank's
--    own text could not be located on 2026-10-24, so these rows are stored as
--    CANDIDATE: invisible to the public calculator (RLS and the reader both
--    take ACTIVE only) until an administrator confirms them against the
--    National Bank and activates them. Their effective dates make them apply
--    on the right day once active (src/mortgage/rules/ptiLtv.ts). Whether the
--    foreign-currency band boundary moves too is not stated in those reports,
--    so no foreign-currency row is added.
--
-- 3. BANK CONDITIONS. Product conditions per bank (rates, fees, minimum down
--    payment, income rules), each with its source, verification date,
--    effective date and review status. Seeded with NOTHING: no bank offer is
--    shown until an administrator has entered and verified it, and a row past
--    its review window is labelled stale rather than shown as current.

update public.mortgage_rules
   set last_verified_at = date '2026-10-24'
 where status = 'ACTIVE'
   and type in ('PTI_LIMIT', 'LTV_LIMIT')
   and country = 'GE';

insert into public.mortgage_rules (
  type, title, data, human_explanation, official_source_url, source_authority,
  effective_from, effective_to, last_verified_at, status, version, country, currency, eligibility_dimensions
)
select v.type::mortgage_rule_type, v.title, v.data, v.expl, v.url, v.authority,
       v.ef, v.et, date '2026-10-24', 'CANDIDATE', 1, 'GE', 'GEL', v.dims
  from (values
    ('PTI_LIMIT',
     'PTI limit, GEL loans, monthly net income below 2,000 GEL (announced, effective 2027-02-01)',
     jsonb_build_object('currencyClass', 'LOCAL', 'maxPtiPercent', 25, 'incomeTierMaxMonthlyNet', 2000),
     'mortgage_kb_explain_pti_gel_low_income',
     'https://civil.ge/archives/753059',
     'National Bank of Georgia (Financial Stability Committee decision of 2026-09-30, as reported; pending confirmation)',
     date '2027-02-01', date '2027-08-31',
     jsonb_build_object('incomeCurrencyEquivalentThreshold', 2000, 'pendingOfficialConfirmation', true)),
    ('PTI_LIMIT',
     'PTI limit, GEL loans, monthly net income below 2,500 GEL (announced, effective 2027-09-01)',
     jsonb_build_object('currencyClass', 'LOCAL', 'maxPtiPercent', 25, 'incomeTierMaxMonthlyNet', 2500),
     'mortgage_kb_explain_pti_gel_low_income',
     'https://civil.ge/archives/753059',
     'National Bank of Georgia (Financial Stability Committee decision of 2026-09-30, as reported; pending confirmation)',
     date '2027-09-01', null::date,
     jsonb_build_object('incomeCurrencyEquivalentThreshold', 2500, 'pendingOfficialConfirmation', true))
  ) as v(type, title, data, expl, url, authority, ef, et, dims)
 where not exists (
   select 1 from public.mortgage_rules r
    where r.type = 'PTI_LIMIT' and r.country = 'GE'
      and r.effective_from = v.ef
      and (r.data->>'incomeTierMaxMonthlyNet')::numeric = (v.data->>'incomeTierMaxMonthlyNet')::numeric
 );

create table if not exists public.mortgage_bank_products (
  id uuid primary key default gen_random_uuid(),
  bank_name text not null,
  product_name text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  min_term_months integer check (min_term_months is null or min_term_months > 0),
  max_term_months integer check (max_term_months is null or max_term_months > 0),
  rate_from_percent numeric(6, 3) check (rate_from_percent is null or rate_from_percent >= 0),
  rate_to_percent numeric(6, 3) check (rate_to_percent is null or rate_to_percent >= 0),
  rate_type text check (rate_type is null or rate_type in ('FIXED', 'VARIABLE', 'INDEXED')),
  effective_rate_from_percent numeric(6, 3),
  min_down_payment_percent numeric(5, 2) check (min_down_payment_percent is null or min_down_payment_percent between 0 and 100),
  fees jsonb not null default '{}'::jsonb,
  income_rules jsonb not null default '{}'::jsonb,
  collateral_rules jsonb not null default '{}'::jsonb,
  co_borrower_rules jsonb not null default '{}'::jsonb,
  guarantor_rules jsonb not null default '{}'::jsonb,
  eligibility jsonb not null default '{}'::jsonb,
  notes text,
  source_url text not null check (source_url ~ '^https://'),
  verified_at date,
  effective_from date,
  review_due_days integer not null default 45 check (review_due_days between 1 and 365),
  review_status text not null default 'DRAFT' check (review_status in ('DRAFT', 'VERIFIED', 'RETIRED')),
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (review_status <> 'VERIFIED' or verified_at is not null)
);

create index if not exists idx_mortgage_bank_products_public
  on public.mortgage_bank_products (review_status, currency);

alter table public.mortgage_bank_products enable row level security;

/* The public reads only verified, current rows; staleness is derived, never stored. */
drop policy if exists mortgage_bank_products_public_read on public.mortgage_bank_products;
create policy mortgage_bank_products_public_read on public.mortgage_bank_products
  for select using (
    (review_status = 'VERIFIED' and verified_at is not null
      and verified_at + review_due_days >= current_date
      and (effective_from is null or effective_from <= current_date))
    or public.is_admin()
  );
drop policy if exists mortgage_bank_products_admin_insert on public.mortgage_bank_products;
create policy mortgage_bank_products_admin_insert on public.mortgage_bank_products
  for insert with check (public.is_admin());
drop policy if exists mortgage_bank_products_admin_update on public.mortgage_bank_products;
create policy mortgage_bank_products_admin_update on public.mortgage_bank_products
  for update using (public.is_admin()) with check (public.is_admin());
-- No DELETE policy: a product is RETIRED, not erased.

/* Supabase's default privileges grant ALL (incl. DELETE and TRUNCATE) to anon and authenticated;
   take everything back and grant only what the policies above govern. */
revoke all on public.mortgage_bank_products from anon, authenticated;
grant select on public.mortgage_bank_products to anon, authenticated;
grant insert, update on public.mortgage_bank_products to authenticated;

/* Every admin change is attributable. */
create or replace function public.mortgage_bank_products_touch()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid;
begin
  select id into v_uid from public.users where auth_id = auth.uid();
  new.updated_at := now();
  new.updated_by := v_uid;
  if tg_op = 'INSERT' then
    new.created_by := v_uid;
    new.created_at := now();
  else
    -- Who created a product, and when, is not editable from a client.
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  -- admin_audit_log.admin_id is NOT NULL: a service-role write (no auth.uid()) is recorded
  -- under the nil uuid, as admin_set_setting does, instead of failing the write.
  values (coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid),
          'mortgage_bank_product.' || lower(tg_op), 'mortgage_bank_products', new.id::text,
          jsonb_build_object('bank', new.bank_name, 'product', new.product_name, 'review_status', new.review_status,
                             'old_review_status', case when tg_op = 'UPDATE' then old.review_status end,
                             'verified_at', new.verified_at, 'source_url', new.source_url,
                             'actor', case when auth.uid() is null then 'service_role' else 'admin' end));
  return new;
end $$;

drop trigger if exists trg_mortgage_bank_products_touch on public.mortgage_bank_products;
create trigger trg_mortgage_bank_products_touch
  before insert or update on public.mortgage_bank_products
  for each row execute function public.mortgage_bank_products_touch();

comment on table public.mortgage_bank_products is
  'Bank mortgage product conditions entered and verified by HOMATCH admins, each with source_url, verified_at and effective_from. Public sees VERIFIED rows inside their review window only. Seeded empty: no offer is shown until verified.';

-- ─────────────────────────────────────────────────────────────────────────
-- 4. ADMIN: MORTGAGE RULE STATUS CHANGES, CHECKED AND AUDITED.
--
-- Admin → Mortgage rules used to flip a CANDIDATE to ACTIVE with a direct
-- UPDATE ... WHERE status = 'CANDIDATE'. A row that had already moved matched
-- nothing and PostgREST answered success; nothing reached admin_audit_log.
-- This function checks the caller is an admin, allows only
-- CANDIDATE → ACTIVE and CANDIDATE → REJECTED, records the official source
-- the admin confirmed, stamps last_verified_at on activation, writes the
-- change to admin_audit_log and RETURNS the stored status, so the screen can
-- tell "changed" from "matched nothing". Errors are raised by name.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.mortgage_rule_admin_set_status(
  p_rule_id uuid,
  p_status text,
  p_official_source_url text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.mortgage_rules%rowtype;
  v_new public.mortgage_rules%rowtype;
  v_src text := nullif(btrim(coalesce(p_official_source_url, '')), '');
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_rule_id is null or p_status is null or p_status not in ('ACTIVE', 'REJECTED') then
    raise exception 'INVALID_ARGUMENT' using errcode = '22023';
  end if;
  if v_src is not null and v_src !~ '^https://' then
    raise exception 'INVALID_SOURCE_URL' using errcode = '22023';
  end if;

  select * into v_old from public.mortgage_rules where id = p_rule_id for update;
  if not found then
    raise exception 'RULE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_old.status <> 'CANDIDATE' then
    raise exception 'INVALID_TRANSITION: % -> %', v_old.status, p_status using errcode = '22023';
  end if;

  update public.mortgage_rules
     set status = p_status::mortgage_rule_status,
         official_source_url = case when p_status = 'ACTIVE' then coalesce(v_src, official_source_url) else official_source_url end,
         last_verified_at = case when p_status = 'ACTIVE' then current_date else last_verified_at end,
         -- An active rule is no longer "pending official confirmation".
         eligibility_dimensions = case when p_status = 'ACTIVE' and eligibility_dimensions is not null
                                       then eligibility_dimensions - 'pendingOfficialConfirmation'
                                       else eligibility_dimensions end
   where id = p_rule_id
  returning * into v_new;

  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'mortgage_rule.' || lower(p_status), 'mortgage_rules', p_rule_id::text,
          jsonb_build_object(
            'title', v_old.title,
            'type', v_old.type,
            'old_status', v_old.status,
            'new_status', v_new.status,
            'effective_from', v_old.effective_from,
            'old_source', v_old.official_source_url,
            'new_source', v_new.official_source_url,
            'note', left(p_note, 500)));

  return jsonb_build_object(
    'id', v_new.id,
    'status', v_new.status,
    'last_verified_at', v_new.last_verified_at,
    'official_source_url', v_new.official_source_url);
end $$;

comment on function public.mortgage_rule_admin_set_status(uuid, text, text, text) is
  'Admin only. CANDIDATE -> ACTIVE (with the official source confirmed) or CANDIDATE -> REJECTED; audited in admin_audit_log; returns the stored status.';

revoke all on function public.mortgage_rule_admin_set_status(uuid, text, text, text) from public, anon;
grant execute on function public.mortgage_rule_admin_set_status(uuid, text, text, text) to authenticated;
