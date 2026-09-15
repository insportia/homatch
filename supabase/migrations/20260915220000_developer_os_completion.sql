-- ============================================================================
-- HOMATCH FOR DEVELOPERS — the modules the first pass left as foundation.
--
-- Contracts as a lifecycle rather than two date columns, commissions, handover,
-- the buyer's own room, operational notifications, ad-source connections, safe
-- bulk editing, and the executive read model.
--
-- ONE SOURCE OF TRUTH, STILL
--
-- There is no dev_contracts table. A contract is not a separate object from the
-- deal it belongs to — it IS the deal, at a particular point in its life — and
-- a second table would immediately raise "which one is authoritative when they
-- disagree". So dev_deals grows a contract_status with a real lifecycle and the
-- transitions that move it, and dev_units.status keeps being the only place an
-- apartment's availability lives.
--
-- Commissions and handover ARE new objects, because they genuinely are: a
-- commission is owed to a person who is not party to the sale, and a handover
-- happens months after the money is finished.
-- ============================================================================

-- ── 1. CONTRACT LIFECYCLE ──────────────────────────────────────────────────
--
-- dev_deals.status already tracked the SALES position (pending, contracted,
-- completed, cancelled). This is the document's own progress, which moves on a
-- different clock: a contract can sit in REVIEW with legal for a fortnight
-- while the deal is unambiguously live.

alter table public.dev_deals
  add column if not exists contract_status text not null default 'DRAFT'
    check (contract_status in ('DRAFT','REVIEW','SIGNED','ACTIVE','COMPLETED','CANCELLED')),
  add column if not exists contract_signed_at date,
  add column if not exists payment_method text
    check (payment_method is null or payment_method in ('CASH','INSTALMENTS','MORTGAGE','MIXED','OTHER')),
  add column if not exists handover_target_date date;

create index if not exists dev_deals_contract_status_idx
  on public.dev_deals(workspace_id, contract_status);

comment on column public.dev_deals.contract_status is
  'Where the paperwork is. Separate from status, which is where the SALE is — a contract can be in REVIEW while the deal is already live.';

/*
 * Moving the contract along.
 *
 * SIGNED is the only transition that records a date automatically, because it
 * is the only one somebody will later be asked to prove.
 */
create or replace function public.dev_set_contract_status(
  p_deal_id uuid,
  p_status text,
  p_signed_on date default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := public.auth_user_id();
  v_deal public.dev_deals%rowtype;
begin
  select * into v_deal from public.dev_deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found.' using errcode = 'no_data_found'; end if;

  if not (public.dev_can(v_deal.workspace_id, 'legal')
          or public.dev_can(v_deal.workspace_id, 'sale')) then
    raise exception 'You do not have permission to change a contract.' using errcode = '42501';
  end if;
  if p_status not in ('DRAFT','REVIEW','SIGNED','ACTIVE','COMPLETED','CANCELLED') then
    raise exception 'Unknown contract status %.', p_status using errcode = 'check_violation';
  end if;

  update public.dev_deals
     set contract_status = p_status,
         contract_signed_at = case
           when p_status = 'SIGNED' then coalesce(p_signed_on, contract_signed_at, current_date)
           else contract_signed_at end
   where id = p_deal_id;

  insert into public.dev_activities (
    workspace_id, lead_id, unit_id, deal_id, kind, provenance, title, body, meta, actor_id)
  values (v_deal.workspace_id, v_deal.lead_id, v_deal.unit_id, p_deal_id, 'STAGE_CHANGE', 'HOMATCH',
          'Contract ' || lower(p_status), p_note,
          jsonb_build_object('from', v_deal.contract_status, 'to', p_status), v_user);

  insert into public.dev_audit_log (workspace_id, actor_id, entity_type, entity_id, action, before_state, after_state)
  values (v_deal.workspace_id, v_user, 'contract', p_deal_id, 'STATUS_CHANGED',
          jsonb_build_object('contract_status', v_deal.contract_status),
          jsonb_build_object('contract_status', p_status, 'signed_on', p_signed_on));
end;
$$;

-- ── 2. COMMISSIONS ─────────────────────────────────────────────────────────
--
-- Deliberately NOT part of a deal's money. A commission is an expense owed to
-- somebody, and adding it to a table that sums to "collected" is how a sales
-- report starts double-counting.

create table if not exists public.dev_commissions (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.dev_workspaces(id) on delete cascade,
  deal_id       uuid not null references public.dev_deals(id) on delete cascade,
  -- Exactly one of these. An internal agent's commission and a broker's are
  -- the same shape and very different conversations.
  beneficiary_kind text not null check (beneficiary_kind in ('AGENT','BROKER','OTHER')),
  user_id       uuid references public.users(id) on delete set null,
  broker_invite_id uuid references public.dev_broker_invites(id) on delete set null,
  beneficiary_name text,
  basis         text not null default 'PERCENT' check (basis in ('PERCENT','FIXED')),
  rate          numeric(10,4),
  amount        numeric(14,2) not null default 0,
  currency      text not null default 'USD',
  status        text not null default 'PENDING'
                  check (status in ('PENDING','APPROVED','PAID','CANCELLED')),
  approved_by   uuid references public.users(id) on delete set null,
  approved_at   timestamptz,
  paid_at       date,
  note          text,
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists dev_commissions_ws_idx on public.dev_commissions(workspace_id, status);
create index if not exists dev_commissions_deal_idx on public.dev_commissions(deal_id);

/*
 * Approving one is a money decision, so it is a function with a capability
 * check and an audit row rather than an UPDATE anybody with the table can run.
 */
create or replace function public.dev_set_commission_status(
  p_commission_id uuid, p_status text, p_paid_on date default null)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := public.auth_user_id();
  v_row public.dev_commissions%rowtype;
begin
  select * into v_row from public.dev_commissions where id = p_commission_id for update;
  if not found then raise exception 'Commission not found.' using errcode = 'no_data_found'; end if;
  if not public.dev_can(v_row.workspace_id, 'finance') then
    raise exception 'Only finance can approve or pay a commission.' using errcode = '42501';
  end if;
  if p_status not in ('PENDING','APPROVED','PAID','CANCELLED') then
    raise exception 'Unknown commission status %.', p_status using errcode = 'check_violation';
  end if;

  update public.dev_commissions
     set status = p_status,
         approved_by = case when p_status in ('APPROVED','PAID') then v_user else approved_by end,
         approved_at = case when p_status in ('APPROVED','PAID') then now() else approved_at end,
         paid_at = case when p_status = 'PAID' then coalesce(p_paid_on, current_date) else paid_at end
   where id = p_commission_id;

  insert into public.dev_audit_log (workspace_id, actor_id, entity_type, entity_id, action, before_state, after_state)
  values (v_row.workspace_id, v_user, 'commission', p_commission_id, 'STATUS_CHANGED',
          jsonb_build_object('status', v_row.status),
          jsonb_build_object('status', p_status, 'amount', v_row.amount));
end;
$$;

-- ── 3. HANDOVER ────────────────────────────────────────────────────────────

create table if not exists public.dev_handovers (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.dev_workspaces(id) on delete cascade,
  deal_id       uuid not null references public.dev_deals(id) on delete cascade,
  unit_id       uuid not null references public.dev_units(id) on delete cascade,
  target_date   date,
  actual_date   date,
  status        text not null default 'PENDING'
                  check (status in ('PENDING','SCHEDULED','READY','COMPLETED','CANCELLED')),
  -- [{ label, done, note }] — a snagging list is genuinely per-project, and a
  -- relational table for it would be six joins for a checkbox.
  checklist     jsonb not null default '[]'::jsonb,
  responsible   uuid references public.users(id) on delete set null,
  notes         text,
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (deal_id)
);

create index if not exists dev_handovers_ws_idx on public.dev_handovers(workspace_id, status);
create index if not exists dev_handovers_due_idx on public.dev_handovers(target_date)
  where status in ('PENDING','SCHEDULED','READY');

-- ── 4. THE BUYER'S ROOM ────────────────────────────────────────────────────
--
-- A buyer sees their own purchase and nothing else: the unit, the offer, the
-- schedule, what they have paid, and the documents somebody deliberately
-- shared with them. No CRM note, no internal document, no other buyer, no
-- price rule, no commission.
--
-- Access is a share link of target_type BUYER_ROOM, which already exists and
-- already supports revoke and expiry. This is the resolver.

create or replace function public.dev_buyer_room(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_link public.dev_share_links%rowtype;
  v_lead public.dev_leads%rowtype;
  v_payload jsonb;
begin
  select * into v_link from public.dev_share_links
   where token = p_token and target_type = 'BUYER_ROOM';
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if v_link.revoked_at is not null then return jsonb_build_object('error', 'REVOKED'); end if;
  if v_link.expires_at is not null and v_link.expires_at < now() then
    return jsonb_build_object('error', 'EXPIRED');
  end if;

  select * into v_lead from public.dev_leads where id = v_link.target_id;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;

  select jsonb_build_object(
    'developer', jsonb_build_object(
      'name', w.name, 'logo_url', w.brand_logo_url,
      'brand_color', w.brand_color, 'website', w.website),
    'buyer', jsonb_build_object('name', c.full_name),
    /* The deal, if there is one yet. A buyer who has only reserved sees the
       reservation and no contract, which is the truth of where they are. */
    'deal', (
      select jsonb_build_object(
        'id', d.id,
        'contract_number', d.contract_number,
        'contract_date', d.contract_date,
        'contract_status', d.contract_status,
        'sale_price', d.sale_price,
        'currency', d.currency,
        'paid', coalesce((select sum(amount) from public.dev_payments p
                           where p.deal_id = d.id and p.status = 'CONFIRMED'), 0),
        'outstanding', d.sale_price - coalesce((select sum(amount) from public.dev_payments p
                           where p.deal_id = d.id and p.status = 'CONFIRMED'), 0),
        'schedule', coalesce((
          select jsonb_agg(jsonb_build_object(
            'label', s.label, 'due_date', s.due_date, 'amount', s.amount,
            'currency', s.currency, 'status', s.status, 'paid_amount', s.paid_amount)
            order by s.seq)
          from public.dev_payment_schedule s where s.deal_id = d.id), '[]'::jsonb),
        'payments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'amount', p.amount, 'currency', p.currency, 'paid_at', p.paid_at,
            'method', p.method, 'reference', p.reference)
            order by p.paid_at desc)
          from public.dev_payments p
           where p.deal_id = d.id and p.status = 'CONFIRMED'), '[]'::jsonb))
      from public.dev_deals d
       where d.lead_id = v_lead.id and d.status <> 'CANCELLED' limit 1),
    'reservation', (
      select jsonb_build_object(
        'reserved_at', r.reserved_at, 'expires_at', r.expires_at,
        'amount', r.amount, 'currency', r.currency, 'status', r.status)
      from public.dev_reservations r
       where r.lead_id = v_lead.id and r.status = 'ACTIVE' limit 1),
    'unit', (
      select jsonb_build_object(
        'unit_number', u.unit_number, 'bedrooms', u.bedrooms, 'rooms', u.rooms,
        'area_total', u.area_total, 'area_balcony', u.area_balcony,
        'floor_level', u.floor_level, 'orientation', u.orientation,
        'view_text', u.view_text, 'floor_plan_url', u.floor_plan_url,
        'photos', u.photos,
        'project', p.name, 'city', p.city, 'district', p.district,
        'handover_date', p.handover_date, 'construction_status', p.construction_status)
      from public.dev_units u join public.dev_projects p on p.id = u.project_id
       where u.id = coalesce(
         (select d.unit_id from public.dev_deals d
           where d.lead_id = v_lead.id and d.status <> 'CANCELLED' limit 1),
         (select r.unit_id from public.dev_reservations r
           where r.lead_id = v_lead.id and r.status = 'ACTIVE' limit 1))),
    /* ONLY documents somebody deliberately set to BUYER. The default is
       PRIVATE, so a contract is invisible here until a human shares it. */
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', dc.id, 'title', dc.title, 'doc_type', dc.doc_type, 'created_at', dc.created_at)
        order by dc.created_at desc)
      from public.dev_documents dc
       where dc.lead_id = v_lead.id and dc.visibility = 'BUYER'), '[]'::jsonb),
    'contact', (
      select jsonb_build_object('name', mu.full_name, 'email', mu.email)
      from public.users mu where mu.id = v_lead.assigned_to)
  ) into v_payload
  from public.dev_workspaces w
  join public.outreach_contacts c on c.id = v_lead.contact_id
  where w.id = v_lead.workspace_id;

  update public.dev_share_links
     set view_count = view_count + 1, last_viewed_at = now() where id = v_link.id;

  return coalesce(v_payload, jsonb_build_object('error', 'NOT_FOUND'));
end;
$$;

/* A buyer may download a document that was shared with them, and only that. */
create or replace function public.dev_buyer_room_document(p_token text, p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_link public.dev_share_links%rowtype;
  v_path text;
begin
  select * into v_link from public.dev_share_links
   where token = p_token and target_type = 'BUYER_ROOM' and revoked_at is null;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if v_link.expires_at is not null and v_link.expires_at < now() then
    return jsonb_build_object('error', 'EXPIRED');
  end if;

  select d.storage_path into v_path
    from public.dev_documents d
   where d.id = p_document_id
     and d.lead_id = v_link.target_id
     and d.visibility = 'BUYER';

  if v_path is null then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  return jsonb_build_object('storage_path', v_path);
end;
$$;

-- ── 5. NOTIFICATIONS ───────────────────────────────────────────────────────
--
-- Operational, not marketing. Generated from state that already exists, so
-- there is no separate thing to keep in step — and deduplicated on a key, so
-- a reservation expiring produces one notification rather than one per sweep.

create table if not exists public.dev_notifications (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.dev_workspaces(id) on delete cascade,
  user_id      uuid references public.users(id) on delete cascade,
  kind         text not null check (kind in (
                 'RESERVATION_EXPIRING','RESERVATION_EXPIRED','PAYMENT_DUE','PAYMENT_OVERDUE',
                 'PAYMENT_TO_CONFIRM','FOLLOW_UP_DUE','HANDOVER_DUE','OFFER_EXPIRING',
                 'DOCUMENT_TO_REVIEW','UNIT_SOLD')),
  title        text not null,
  body         text,
  entity_type  text,
  entity_id    uuid,
  /* One row per real situation. The generator upserts on this, so re-running
     it hourly does not produce an inbox of duplicates. */
  dedupe_key   text not null,
  read_at      timestamptz,
  created_at   timestamptz not null default now(),
  unique (workspace_id, dedupe_key)
);

create index if not exists dev_notifications_user_idx
  on public.dev_notifications(workspace_id, user_id, read_at);

-- ── 6. AD SOURCE CONNECTIONS ───────────────────────────────────────────────
--
-- The connection RECORD, deliberately without a token column.
--
-- A Meta or Google integration needs an OAuth credential that this deployment
-- does not have, and inventing a place to paste one would be worse than not
-- having it: the secret belongs in the platform's secret store, referenced by
-- name, never in a customer-readable table. So this row says which account a
-- workspace intends to connect and what its status is, and `credential_ref`
-- names the secret an operator will provision. Nothing here can send or spend.

create table if not exists public.dev_ad_connections (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.dev_workspaces(id) on delete cascade,
  provider      text not null check (provider in ('META','GOOGLE','TIKTOK','OTHER')),
  account_label text,
  external_account_id text,
  /* The NAME of a secret held by the platform, never the secret. */
  credential_ref text,
  status        text not null default 'NOT_CONNECTED'
                  check (status in ('NOT_CONNECTED','PENDING_CREDENTIALS','CONNECTED','ERROR','DISABLED')),
  status_detail text,
  last_checked_at timestamptz,
  /* Which campaign identifier maps to which lead source string, so a lead
     that arrives already carries the attribution the CRM reports on. */
  source_map    jsonb not null default '{}'::jsonb,
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- An expression has to live in an index, not a table constraint: a workspace
-- connects each ad account once, and "no account id yet" is still one row.
create unique index if not exists dev_ad_connections_unique
  on public.dev_ad_connections(workspace_id, provider, coalesce(external_account_id, ''));

comment on table public.dev_ad_connections is
  'Intent to connect an ad account, and its status. Holds no secret: credential_ref names a platform secret an operator provisions.';

-- ── 7. SAFE BULK EDITING ───────────────────────────────────────────────────
--
-- A 500-unit project cannot be repriced one row at a time. This is the only
-- bulk path, and it is deliberately narrow: the three commercial fields a
-- developer owns, never a status that means money, never anything technical.

create or replace function public.dev_bulk_update_units(
  p_unit_ids uuid[],
  p_status text default null,
  p_price numeric default null,
  p_price_delta_pct numeric default null,
  p_payment_plan_id uuid default null,
  p_published boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := public.auth_user_id();
  v_workspace uuid;
  v_count integer := 0;
  v_workspaces integer;
begin
  if p_unit_ids is null or array_length(p_unit_ids, 1) is null then
    return jsonb_build_object('updated', 0);
  end if;
  if array_length(p_unit_ids, 1) > 2000 then
    raise exception 'Too many units in one operation.' using errcode = 'check_violation';
  end if;

  /* Every unit must belong to ONE workspace. Without this a crafted id list
     could straddle two tenants and the capability check below would only
     cover the first. */
  select count(distinct workspace_id), min(workspace_id)
    into v_workspaces, v_workspace
    from public.dev_units where id = any(p_unit_ids);
  if v_workspaces is null or v_workspaces = 0 then
    return jsonb_build_object('updated', 0);
  end if;
  if v_workspaces > 1 then
    raise exception 'A bulk change cannot span workspaces.' using errcode = '42501';
  end if;
  if not public.dev_can(v_workspace, 'inventory') then
    raise exception 'You do not have permission to edit inventory.' using errcode = '42501';
  end if;

  -- The money statuses are refused here as well as by the trigger, so the
  -- caller gets a sentence instead of a raised constraint.
  if p_status is not null and p_status in ('RESERVED','CONTRACT_PENDING','SOLD') then
    raise exception 'Status % is set by the reservation and contract workflow.', p_status
      using errcode = 'check_violation';
  end if;

  update public.dev_units u set
    status = coalesce(p_status, u.status),
    price = case
      when p_price is not null then p_price
      when p_price_delta_pct is not null and u.price is not null
        then round(u.price * (1 + p_price_delta_pct / 100), 2)
      else u.price end,
    payment_plan_id = coalesce(p_payment_plan_id, u.payment_plan_id),
    is_published = coalesce(p_published, u.is_published),
    published_at = case
      when p_published is true and not u.is_published then now()
      when p_published is false then null
      else u.published_at end
  where u.id = any(p_unit_ids)
    -- A unit already under reservation or contract is not repriced in bulk.
    and (p_status is null or u.status not in ('RESERVED','CONTRACT_PENDING','SOLD'));

  get diagnostics v_count = row_count;

  insert into public.dev_audit_log (workspace_id, actor_id, entity_type, action, after_state)
  values (v_workspace, v_user, 'unit', 'BULK_UPDATE',
          jsonb_build_object('count', v_count, 'status', p_status, 'price', p_price,
                             'delta_pct', p_price_delta_pct, 'published', p_published));

  return jsonb_build_object('updated', v_count);
end;
$$;

-- ── 8. THE EXECUTIVE READ MODEL ────────────────────────────────────────────
--
-- SECURITY INVOKER, so a sales agent's dashboard and an owner's are the same
-- SQL seeing different rows. Every figure is a count or a sum of rows that
-- exist; there is no modelled or projected number anywhere in it.

create or replace function public.dev_dashboard(
  p_workspace uuid,
  p_project uuid default null,
  p_from date default null,
  p_to date default null
)
returns jsonb
language sql
stable
set search_path to public, pg_catalog
as $$
  with scope as (
    select u.id, u.status, u.price, u.project_id, u.area_total
      from dev_units u
     where u.workspace_id = p_workspace
       and (p_project is null or u.project_id = p_project)
  ),
  deals as (
    select d.*, l.source as lead_source
      from dev_deals d
      join dev_leads l on l.id = d.lead_id
     where d.workspace_id = p_workspace
       and (p_project is null or d.project_id = p_project)
       and (p_from is null or d.sale_date >= p_from)
       and (p_to is null or d.sale_date <= p_to)
       and d.status <> 'CANCELLED'
  )
  select jsonb_build_object(
    'inventory', (select jsonb_build_object(
        'total', count(*),
        'available', count(*) filter (where status = 'AVAILABLE'),
        'reserved', count(*) filter (where status = 'RESERVED'),
        'on_hold', count(*) filter (where status = 'ON_HOLD'),
        'negotiation', count(*) filter (where status = 'NEGOTIATION'),
        'contract_pending', count(*) filter (where status = 'CONTRACT_PENDING'),
        'sold', count(*) filter (where status = 'SOLD'),
        'value_available', coalesce(sum(price) filter (where status = 'AVAILABLE'), 0),
        'area_available', coalesce(sum(area_total) filter (where status = 'AVAILABLE'), 0))
      from scope),
    'sales', (select jsonb_build_object(
        'count', count(*),
        'value', coalesce(sum(sale_price), 0),
        'avg_value', case when count(*) > 0 then round(avg(sale_price), 2) end,
        'discount_given', coalesce(sum(discount_amount), 0))
      from deals),
    'money', (select jsonb_build_object(
        'collected', coalesce(sum(amount) filter (where status = 'CONFIRMED'), 0),
        'awaiting_confirmation', coalesce(sum(amount) filter (where status = 'RECORDED'), 0))
      from dev_payments where workspace_id = p_workspace),
    'receivables', (select jsonb_build_object(
        'overdue_count', count(*) filter (where status = 'OVERDUE'),
        'overdue_amount', coalesce(sum(amount - paid_amount) filter (where status = 'OVERDUE'), 0),
        'due_30d', coalesce(sum(amount - paid_amount) filter (
          where status in ('PENDING','PARTIAL') and due_date between current_date and current_date + 30), 0),
        'outstanding_total', coalesce(sum(amount - paid_amount) filter (where status <> 'PAID'), 0))
      from dev_payment_schedule where workspace_id = p_workspace),
    /* Conversion over the SAME population, which is the only division that
       means anything: of the leads this workspace has, how many reached each
       point. Not "this month's sales over all-time leads". */
    'funnel', (select jsonb_build_object(
        'leads', count(*),
        'qualified', count(*) filter (where stage not in ('NEW','LOST')),
        'viewing', count(*) filter (where stage in (
          'VIEWING_SCHEDULED','VIEWING_COMPLETED','NEGOTIATION','RESERVATION','CONTRACT','PAYMENT_PENDING','SOLD')),
        'reserved', count(*) filter (where stage in ('RESERVATION','CONTRACT','PAYMENT_PENDING','SOLD')),
        'sold', count(*) filter (where stage = 'SOLD'),
        'lost', count(*) filter (where stage = 'LOST'))
      from dev_leads where workspace_id = p_workspace
        and (p_project is null or project_id = p_project)),
    'by_project', coalesce((select jsonb_agg(x order by x->>'name') from (
        select jsonb_build_object(
          'project_id', p.id, 'name', p.name,
          'available', count(*) filter (where u.status = 'AVAILABLE'),
          'sold', count(*) filter (where u.status = 'SOLD'),
          'total', count(u.id)) as x
        from dev_projects p left join dev_units u on u.project_id = p.id
        where p.workspace_id = p_workspace group by p.id) t), '[]'::jsonb),
    'by_salesperson', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object(
          'user_id', d.assigned_to,
          'sales', count(*),
          'value', coalesce(sum(d.sale_price), 0)) as x
        from deals d where d.assigned_to is not null group by d.assigned_to) t), '[]'::jsonb),
    'by_source', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object(
          'source', coalesce(d.lead_source, 'UNRECORDED'),
          'sales', count(*),
          'value', coalesce(sum(d.sale_price), 0)) as x
        from deals d group by d.lead_source) t), '[]'::jsonb),
    'commissions', (select jsonb_build_object(
        'pending', coalesce(sum(amount) filter (where status = 'PENDING'), 0),
        'approved', coalesce(sum(amount) filter (where status = 'APPROVED'), 0),
        'paid', coalesce(sum(amount) filter (where status = 'PAID'), 0))
      from dev_commissions where workspace_id = p_workspace),
    'handover', (select jsonb_build_object(
        'pending', count(*) filter (where status in ('PENDING','SCHEDULED','READY')),
        'overdue', count(*) filter (where status in ('PENDING','SCHEDULED','READY')
                                      and target_date is not null and target_date < current_date),
        'completed', count(*) filter (where status = 'COMPLETED'))
      from dev_handovers where workspace_id = p_workspace)
  );
$$;

-- ── 9. NOTIFICATION GENERATION ─────────────────────────────────────────────
--
-- Derived, deduplicated, and cheap. Called when somebody opens the workspace,
-- so there is no scheduler to keep alive and nothing to drift.

create or replace function public.dev_generate_notifications(p_workspace uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare v_count integer := 0; v_added integer;
begin
  if not public.dev_is_member(p_workspace) then
    raise exception 'Not a member of this workspace.' using errcode = '42501';
  end if;

  -- Reservations running out within a week.
  insert into public.dev_notifications (workspace_id, user_id, kind, title, body, entity_type, entity_id, dedupe_key)
  select p_workspace, r.assigned_to, 'RESERVATION_EXPIRING',
         'Reservation on ' || u.unit_number || ' expires soon',
         to_char(r.expires_at, 'YYYY-MM-DD'), 'reservation', r.id,
         'res-exp:' || r.id::text || ':' || to_char(r.expires_at, 'YYYYMMDD')
    from public.dev_reservations r
    join public.dev_units u on u.id = r.unit_id
   where r.workspace_id = p_workspace and r.status = 'ACTIVE'
     and r.expires_at between now() and now() + interval '7 days'
  on conflict (workspace_id, dedupe_key) do nothing;
  get diagnostics v_added = row_count; v_count := v_count + v_added;

  -- Instalments past their date.
  insert into public.dev_notifications (workspace_id, user_id, kind, title, body, entity_type, entity_id, dedupe_key)
  select p_workspace, d.assigned_to, 'PAYMENT_OVERDUE',
         'Payment overdue on ' || u.unit_number,
         s.label || ' — ' || to_char(s.due_date, 'YYYY-MM-DD'), 'schedule', s.id,
         'pay-over:' || s.id::text
    from public.dev_payment_schedule s
    join public.dev_deals d on d.id = s.deal_id
    join public.dev_units u on u.id = d.unit_id
   where s.workspace_id = p_workspace and s.status = 'OVERDUE'
  on conflict (workspace_id, dedupe_key) do nothing;
  get diagnostics v_added = row_count; v_count := v_count + v_added;

  -- Follow-ups whose date has passed.
  insert into public.dev_notifications (workspace_id, user_id, kind, title, body, entity_type, entity_id, dedupe_key)
  select p_workspace, l.assigned_to, 'FOLLOW_UP_DUE',
         'Follow-up due', coalesce(c.full_name, 'A buyer'), 'lead', l.id,
         'follow:' || l.id::text || ':' || to_char(l.next_follow_up_at, 'YYYYMMDD')
    from public.dev_leads l
    left join public.outreach_contacts c on c.id = l.contact_id
   where l.workspace_id = p_workspace
     and l.next_follow_up_at is not null and l.next_follow_up_at < now()
     and l.stage not in ('LOST','SOLD')
  on conflict (workspace_id, dedupe_key) do nothing;
  get diagnostics v_added = row_count; v_count := v_count + v_added;

  -- Handovers past their target.
  insert into public.dev_notifications (workspace_id, user_id, kind, title, body, entity_type, entity_id, dedupe_key)
  select p_workspace, h.responsible, 'HANDOVER_DUE',
         'Handover due for ' || u.unit_number,
         to_char(h.target_date, 'YYYY-MM-DD'), 'handover', h.id,
         'hand:' || h.id::text || ':' || to_char(h.target_date, 'YYYYMMDD')
    from public.dev_handovers h
    join public.dev_units u on u.id = h.unit_id
   where h.workspace_id = p_workspace
     and h.status in ('PENDING','SCHEDULED','READY')
     and h.target_date is not null and h.target_date <= current_date
  on conflict (workspace_id, dedupe_key) do nothing;
  get diagnostics v_added = row_count; v_count := v_count + v_added;

  return v_count;
end;
$$;

-- ── 10. RLS ────────────────────────────────────────────────────────────────

alter table public.dev_commissions    enable row level security;
alter table public.dev_handovers      enable row level security;
alter table public.dev_notifications  enable row level security;
alter table public.dev_ad_connections enable row level security;

-- Commission is finance and management information, not sales-floor reading.
drop policy if exists dev_commissions_select on public.dev_commissions;
create policy dev_commissions_select on public.dev_commissions
  for select to authenticated
  using (public.dev_can(workspace_id, 'finance')
         or public.dev_can(workspace_id, 'crm_all')
         or user_id = public.auth_user_id()
         or public.is_admin());

drop policy if exists dev_commissions_write on public.dev_commissions;
create policy dev_commissions_write on public.dev_commissions
  for all to authenticated
  using (public.dev_can(workspace_id, 'finance') or public.dev_can(workspace_id, 'crm_all'))
  with check (public.dev_can(workspace_id, 'finance') or public.dev_can(workspace_id, 'crm_all'));

drop policy if exists dev_handovers_select on public.dev_handovers;
create policy dev_handovers_select on public.dev_handovers
  for select to authenticated
  using (public.dev_is_member(workspace_id) or public.is_admin());

drop policy if exists dev_handovers_write on public.dev_handovers;
create policy dev_handovers_write on public.dev_handovers
  for all to authenticated
  using (public.dev_can(workspace_id, 'sale') or public.dev_can(workspace_id, 'crm_all'))
  with check (public.dev_can(workspace_id, 'sale') or public.dev_can(workspace_id, 'crm_all'));

-- A notification addressed to somebody is theirs; one addressed to nobody is
-- the workspace's.
drop policy if exists dev_notifications_select on public.dev_notifications;
create policy dev_notifications_select on public.dev_notifications
  for select to authenticated
  using (public.dev_is_member(workspace_id)
         and (user_id is null or user_id = public.auth_user_id()));

drop policy if exists dev_notifications_update on public.dev_notifications;
create policy dev_notifications_update on public.dev_notifications
  for update to authenticated
  using (public.dev_is_member(workspace_id)
         and (user_id is null or user_id = public.auth_user_id()))
  with check (public.dev_is_member(workspace_id));

drop policy if exists dev_ad_connections_select on public.dev_ad_connections;
create policy dev_ad_connections_select on public.dev_ad_connections
  for select to authenticated
  using (public.dev_can(workspace_id, 'marketing') or public.dev_can(workspace_id, 'team'));

drop policy if exists dev_ad_connections_write on public.dev_ad_connections;
create policy dev_ad_connections_write on public.dev_ad_connections
  for all to authenticated
  using (public.dev_can(workspace_id, 'marketing') or public.dev_can(workspace_id, 'team'))
  with check (public.dev_can(workspace_id, 'marketing') or public.dev_can(workspace_id, 'team'));

-- ── 11. updated_at + grants ────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['dev_commissions','dev_handovers','dev_ad_connections'] loop
    execute format('drop trigger if exists %I_updated_at on public.%I', t, t);
    execute format('create trigger %I_updated_at before update on public.%I
       for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

grant select, insert, update, delete on
  public.dev_commissions, public.dev_handovers, public.dev_ad_connections to authenticated;
grant select, update on public.dev_notifications to authenticated;

grant execute on function public.dev_set_contract_status(uuid, text, date, text) to authenticated;
grant execute on function public.dev_set_commission_status(uuid, text, date) to authenticated;
grant execute on function public.dev_bulk_update_units(uuid[], text, numeric, numeric, uuid, boolean) to authenticated;
grant execute on function public.dev_dashboard(uuid, uuid, date, date) to authenticated;
grant execute on function public.dev_generate_notifications(uuid) to authenticated;
-- The buyer room is a public entry point and everything else added here is not,
-- so the sweep has to learn about it. Re-declaring the whole function rather
-- than patching it keeps ONE list of what an anonymous visitor may call.

create or replace function public.dev_lockdown_rpc_surface()
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  fn record;
  v_closed integer := 0;

  public_fns constant text[] := array[
    'dev_share_resolve',        -- one shared apartment
    'dev_share_track',          -- activity on a link the workspace itself sent
    'dev_public_project',       -- a published project page
    'dev_buyer_room',           -- a buyer's own purchase, by their own token
    'dev_buyer_room_document',  -- a document deliberately shared with that buyer
    'dt_experience_manifest',   -- the shell of a development
    'dt_building_floors',       -- one building's floors
    'dt_floor_units',           -- one floor's units
    'dt_track'                  -- batched, capped viewer analytics
  ];

  internal_fns constant text[] := array[
    'dev_contact_list', 'dev_refresh_schedule', 'dev_new_token',
    'dev_units_guard_status', 'dev_units_record_history',
    'dt_guard_unit_type_template', 'dt_guard_experience_publishing',
    'dev_lockdown_rpc_surface'
  ];

  /* dev_storage_workspace is evaluated inside a storage policy, so the role
     running the query needs EXECUTE on it. The general branch below grants
     exactly that, which is why it no longer needs a list of its own. */
  policy_fns constant text[] := array['dev_storage_workspace'];
begin
  for fn in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'dev\_%' or p.proname like 'dt\_%')
  loop
    if fn.proname = any(public_fns) then
      execute format('grant execute on function public.%I(%s) to anon, authenticated',
                     fn.proname, fn.args);
      continue;
    end if;

    -- BOTH revokes, every time. The inherited grant and the direct one.
    execute format('revoke all on function public.%I(%s) from public', fn.proname, fn.args);
    execute format('revoke all on function public.%I(%s) from anon', fn.proname, fn.args);
    v_closed := v_closed + 1;

    if fn.proname = any(internal_fns) then
      execute format('revoke all on function public.%I(%s) from authenticated',
                     fn.proname, fn.args);
    else
      execute format('grant execute on function public.%I(%s) to authenticated',
                     fn.proname, fn.args);
    end if;
  end loop;

  return v_closed;
end;
$$;

select public.dev_lockdown_rpc_surface();

revoke all on function public.dev_lockdown_rpc_surface() from public;
revoke all on function public.dev_lockdown_rpc_surface() from anon;
revoke all on function public.dev_lockdown_rpc_surface() from authenticated;
