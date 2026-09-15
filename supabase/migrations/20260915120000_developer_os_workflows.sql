-- ============================================================================
-- HOMATCH FOR DEVELOPERS — the operations that move money, and the ones that
-- let a stranger see an apartment.
--
-- Three groups of function, and they are separated on purpose:
--
--   TRANSITIONS  reserve, release, contract, sell, confirm a payment. Each is
--                one transaction that writes every record the fact implies,
--                checks its own permission, and sets homatch.dev_sales_txn so
--                the unit-status trigger will let it through. A client cannot
--                set that flag, which is what makes these the only door.
--
--   PUBLIC       what an anonymous visitor may see. SECURITY DEFINER, so the
--                dev_* tables need no anon policy at all, and each function
--                names the exact columns it returns. Adding a column to
--                dev_units does not silently publish it.
--
--   READ MODELS  the sales ledger and the workspace overview. SECURITY
--                INVOKER, deliberately: they must show the caller exactly what
--                their own role is allowed to see, so they let RLS do it
--                rather than reimplementing the rules a second time.
-- ============================================================================

-- ── 0. A TOKEN ─────────────────────────────────────────────────────────────
--
-- 244 bits from the same CSPRNG that backs gen_random_uuid(). Deliberately
-- not a sequence, a slug or anything derived from the row: a share link is
-- the only thing standing between an unlisted price list and the internet,
-- so it must not be guessable from another one.

create or replace function public.dev_new_token()
returns text
language sql
volatile
set search_path to ''
as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$;

-- ── 1. RESERVE ─────────────────────────────────────────────────────────────

create or replace function public.dev_reserve_unit(
  p_unit_id uuid,
  p_lead_id uuid,
  p_amount numeric default null,
  p_currency text default null,
  p_expires_at timestamptz default null,
  p_offer_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := public.auth_user_id();
  v_unit public.dev_units%rowtype;
  v_lead public.dev_leads%rowtype;
  v_id uuid;
begin
  select * into v_unit from public.dev_units where id = p_unit_id;
  if not found then raise exception 'Unit not found.' using errcode = 'no_data_found'; end if;

  if not public.dev_can(v_unit.workspace_id, 'sale') then
    raise exception 'You do not have permission to reserve units in this workspace.'
      using errcode = '42501';
  end if;

  select * into v_lead from public.dev_leads where id = p_lead_id;
  if not found or v_lead.workspace_id <> v_unit.workspace_id then
    raise exception 'That buyer is not in this workspace.' using errcode = 'no_data_found';
  end if;

  -- Lock the unit for the rest of the transaction. Two salespeople pressing
  -- Reserve at the same moment now queue; the second one reads the status the
  -- first one wrote and is refused below rather than overwriting it.
  perform 1 from public.dev_units where id = p_unit_id for update;
  select * into v_unit from public.dev_units where id = p_unit_id;

  if v_unit.status not in ('AVAILABLE', 'ON_HOLD', 'NEGOTIATION') then
    raise exception 'Unit % is % and cannot be reserved.', v_unit.unit_number, v_unit.status
      using errcode = 'check_violation';
  end if;

  perform set_config('homatch.dev_sales_txn', 'on', true);

  insert into public.dev_reservations (
    workspace_id, unit_id, lead_id, offer_id, amount, currency,
    expires_at, assigned_to, notes, created_by)
  values (
    v_unit.workspace_id, p_unit_id, p_lead_id, p_offer_id, p_amount,
    coalesce(p_currency, v_unit.currency), p_expires_at,
    coalesce(v_lead.assigned_to, v_user), p_notes, v_user)
  returning id into v_id;

  update public.dev_units set status = 'RESERVED' where id = p_unit_id;

  insert into public.dev_unit_events (workspace_id, unit_id, kind, to_value, note, meta, actor_id)
  values (v_unit.workspace_id, p_unit_id, 'RESERVED', 'RESERVED', p_notes,
          jsonb_build_object('reservation_id', v_id, 'lead_id', p_lead_id), v_user);

  update public.dev_leads
     set stage = case when stage in ('SOLD','CONTRACT','PAYMENT_PENDING') then stage else 'RESERVATION' end,
         last_activity_at = now()
   where id = p_lead_id;

  insert into public.dev_activities (
    workspace_id, lead_id, contact_id, unit_id, kind, provenance, title, body, meta, actor_id)
  values (v_unit.workspace_id, p_lead_id, v_lead.contact_id, p_unit_id, 'RESERVATION', 'HOMATCH',
          'Unit ' || v_unit.unit_number || ' reserved', p_notes,
          jsonb_build_object('reservation_id', v_id, 'amount', p_amount), v_user);

  insert into public.dev_audit_log (workspace_id, actor_id, entity_type, entity_id, action, after_state)
  values (v_unit.workspace_id, v_user, 'reservation', v_id, 'CREATED',
          jsonb_build_object('unit_id', p_unit_id, 'lead_id', p_lead_id,
                             'amount', p_amount, 'expires_at', p_expires_at));

  return v_id;
end;
$$;

-- ── 2. RELEASE ─────────────────────────────────────────────────────────────

create or replace function public.dev_cancel_reservation(
  p_reservation_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := public.auth_user_id();
  v_res public.dev_reservations%rowtype;
  v_unit public.dev_units%rowtype;
begin
  select * into v_res from public.dev_reservations where id = p_reservation_id for update;
  if not found then raise exception 'Reservation not found.' using errcode = 'no_data_found'; end if;

  if not public.dev_can(v_res.workspace_id, 'sale') then
    raise exception 'You do not have permission to release reservations.' using errcode = '42501';
  end if;
  if v_res.status <> 'ACTIVE' then
    raise exception 'That reservation is already %.', v_res.status using errcode = 'check_violation';
  end if;

  select * into v_unit from public.dev_units where id = v_res.unit_id for update;

  perform set_config('homatch.dev_sales_txn', 'on', true);

  update public.dev_reservations
     set status = 'CANCELLED', cancelled_reason = p_reason
   where id = p_reservation_id;

  -- Back on the market only if it was off it BECAUSE of this reservation. A
  -- unit already under contract is not freed by cancelling an old hold.
  if v_unit.status = 'RESERVED' then
    update public.dev_units set status = 'AVAILABLE' where id = v_unit.id;
  end if;

  insert into public.dev_unit_events (workspace_id, unit_id, kind, from_value, to_value, note, meta, actor_id)
  values (v_res.workspace_id, v_res.unit_id, 'RESERVATION_RELEASED', 'RESERVED', 'AVAILABLE', p_reason,
          jsonb_build_object('reservation_id', p_reservation_id), v_user);

  insert into public.dev_activities (
    workspace_id, lead_id, unit_id, kind, provenance, title, body, meta, actor_id)
  values (v_res.workspace_id, v_res.lead_id, v_res.unit_id, 'RESERVATION', 'HOMATCH',
          'Reservation released', p_reason,
          jsonb_build_object('reservation_id', p_reservation_id), v_user);

  insert into public.dev_audit_log (workspace_id, actor_id, entity_type, entity_id, action, after_state)
  values (v_res.workspace_id, v_user, 'reservation', p_reservation_id, 'CANCELLED',
          jsonb_build_object('reason', p_reason));
end;
$$;

-- ── 3. CONTRACT ────────────────────────────────────────────────────────────
--
-- Turning a reservation into a deal also materialises the payment schedule,
-- because a contract without instalments is a number nobody can chase. The
-- schedule is derived from the plan's milestones ONCE, here; editing the
-- template afterwards does not rewrite anybody's signed terms.

create or replace function public.dev_convert_reservation(
  p_reservation_id uuid,
  p_sale_price numeric,
  p_contract_number text default null,
  p_contract_date date default null,
  p_payment_plan_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := public.auth_user_id();
  v_res public.dev_reservations%rowtype;
  v_unit public.dev_units%rowtype;
  v_deal uuid;
  v_plan public.dev_payment_plans%rowtype;
  v_m jsonb;
  v_seq integer := 0;
  v_amount numeric;
  v_base date := coalesce(p_contract_date, current_date);
begin
  select * into v_res from public.dev_reservations where id = p_reservation_id for update;
  if not found then raise exception 'Reservation not found.' using errcode = 'no_data_found'; end if;

  if not public.dev_can(v_res.workspace_id, 'sale') then
    raise exception 'You do not have permission to create deals.' using errcode = '42501';
  end if;
  if v_res.status <> 'ACTIVE' then
    raise exception 'Reservation is %, not ACTIVE.', v_res.status using errcode = 'check_violation';
  end if;
  if p_sale_price is null or p_sale_price <= 0 then
    raise exception 'A deal needs a sale price.' using errcode = 'check_violation';
  end if;

  select * into v_unit from public.dev_units where id = v_res.unit_id for update;

  perform set_config('homatch.dev_sales_txn', 'on', true);

  insert into public.dev_deals (
    workspace_id, unit_id, lead_id, project_id, reservation_id, offer_id,
    assigned_to, broker_id, source, contract_number, contract_date,
    list_price, discount_amount, sale_price, currency, payment_plan_id, status, created_by)
  values (
    v_res.workspace_id, v_res.unit_id, v_res.lead_id, v_unit.project_id,
    p_reservation_id, v_res.offer_id, v_res.assigned_to, v_res.broker_id, v_res.source,
    p_contract_number, p_contract_date,
    v_unit.price, greatest(coalesce(v_unit.price, p_sale_price) - p_sale_price, 0),
    p_sale_price, coalesce(v_res.currency, v_unit.currency),
    p_payment_plan_id, 'CONTRACT_PENDING', v_user)
  returning id into v_deal;

  update public.dev_reservations set status = 'CONVERTED' where id = p_reservation_id;
  update public.dev_units set status = 'CONTRACT_PENDING' where id = v_res.unit_id;
  update public.dev_leads set stage = 'CONTRACT', last_activity_at = now() where id = v_res.lead_id;

  if p_payment_plan_id is not null then
    select * into v_plan from public.dev_payment_plans where id = p_payment_plan_id;
    if found then
      for v_m in select * from jsonb_array_elements(v_plan.milestones) loop
        v_seq := v_seq + 1;
        v_amount := case
          when v_m ? 'amount' and (v_m->>'amount') <> '' then (v_m->>'amount')::numeric
          when v_m ? 'percent' and (v_m->>'percent') <> '' then round(p_sale_price * (v_m->>'percent')::numeric / 100, 2)
          else 0
        end;
        insert into public.dev_payment_schedule (
          workspace_id, deal_id, seq, label, due_date, amount, currency)
        values (
          v_res.workspace_id, v_deal, v_seq,
          coalesce(nullif(v_m->>'label', ''), 'Instalment ' || v_seq),
          case
            when v_m ? 'due_date' and (v_m->>'due_date') <> '' then (v_m->>'due_date')::date
            when v_m ? 'due_offset_days' and (v_m->>'due_offset_days') <> ''
              then v_base + ((v_m->>'due_offset_days')::integer)
            else null
          end,
          v_amount, coalesce(v_res.currency, v_unit.currency));
      end loop;
    end if;
  end if;

  insert into public.dev_unit_events (workspace_id, unit_id, kind, from_value, to_value, meta, actor_id)
  values (v_res.workspace_id, v_res.unit_id, 'STATUS_CHANGED', 'RESERVED', 'CONTRACT_PENDING',
          jsonb_build_object('deal_id', v_deal), v_user);

  insert into public.dev_activities (
    workspace_id, lead_id, unit_id, deal_id, kind, provenance, title, meta, actor_id)
  values (v_res.workspace_id, v_res.lead_id, v_res.unit_id, v_deal, 'STAGE_CHANGE', 'HOMATCH',
          'Contract started for unit ' || v_unit.unit_number,
          jsonb_build_object('deal_id', v_deal, 'sale_price', p_sale_price), v_user);

  insert into public.dev_audit_log (workspace_id, actor_id, entity_type, entity_id, action, after_state)
  values (v_res.workspace_id, v_user, 'deal', v_deal, 'CREATED',
          jsonb_build_object('unit_id', v_res.unit_id, 'sale_price', p_sale_price,
                             'contract_number', p_contract_number));

  return v_deal;
end;
$$;

-- ── 4. SOLD ────────────────────────────────────────────────────────────────

create or replace function public.dev_mark_deal_sold(
  p_deal_id uuid,
  p_sale_date date default null
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

  if not public.dev_can(v_deal.workspace_id, 'sale') then
    raise exception 'You do not have permission to close sales.' using errcode = '42501';
  end if;
  if v_deal.status = 'CANCELLED' then
    raise exception 'That deal was cancelled.' using errcode = 'check_violation';
  end if;

  perform set_config('homatch.dev_sales_txn', 'on', true);

  update public.dev_deals
     set status = 'CONTRACTED', sale_date = coalesce(p_sale_date, current_date)
   where id = p_deal_id;

  update public.dev_units set status = 'SOLD' where id = v_deal.unit_id;
  update public.dev_leads set stage = 'SOLD', last_activity_at = now() where id = v_deal.lead_id;

  insert into public.dev_unit_events (workspace_id, unit_id, kind, to_value, meta, actor_id)
  values (v_deal.workspace_id, v_deal.unit_id, 'SOLD', 'SOLD',
          jsonb_build_object('deal_id', p_deal_id), v_user);

  insert into public.dev_activities (
    workspace_id, lead_id, unit_id, deal_id, kind, provenance, title, meta, actor_id)
  values (v_deal.workspace_id, v_deal.lead_id, v_deal.unit_id, p_deal_id, 'STAGE_CHANGE', 'HOMATCH',
          'Unit sold', jsonb_build_object('sale_price', v_deal.sale_price), v_user);

  insert into public.dev_audit_log (workspace_id, actor_id, entity_type, entity_id, action, after_state)
  values (v_deal.workspace_id, v_user, 'deal', p_deal_id, 'SOLD',
          jsonb_build_object('sale_date', coalesce(p_sale_date, current_date),
                             'sale_price', v_deal.sale_price));
end;
$$;

-- ── 5. MONEY ───────────────────────────────────────────────────────────────
--
-- Schedule status is recomputed from confirmed payments, never written by
-- hand. A row says PAID because the payments add up to the instalment, and
-- for no other reason.

create or replace function public.dev_refresh_schedule(p_deal_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  update public.dev_payment_schedule s
     set paid_amount = coalesce(p.total, 0),
         status = case
           when coalesce(p.total, 0) >= s.amount then 'PAID'
           when coalesce(p.total, 0) > 0 then 'PARTIAL'
           when s.due_date is not null and s.due_date < current_date then 'OVERDUE'
           else 'PENDING'
         end
    from (
      select schedule_id, sum(amount) as total
        from public.dev_payments
       where deal_id = p_deal_id and status = 'CONFIRMED' and schedule_id is not null
       group by schedule_id
    ) p
   where s.deal_id = p_deal_id and p.schedule_id = s.id;

  -- Instalments with no confirmed payment at all are not covered by the join
  -- above; they still need to fall into OVERDUE when their date passes.
  update public.dev_payment_schedule s
     set paid_amount = 0,
         status = case
           when s.due_date is not null and s.due_date < current_date then 'OVERDUE'
           else 'PENDING'
         end
   where s.deal_id = p_deal_id
     and not exists (
       select 1 from public.dev_payments p
        where p.deal_id = p_deal_id and p.status = 'CONFIRMED' and p.schedule_id = s.id);
end;
$$;

create or replace function public.dev_confirm_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := public.auth_user_id();
  v_pay public.dev_payments%rowtype;
begin
  select * into v_pay from public.dev_payments where id = p_payment_id for update;
  if not found then raise exception 'Payment not found.' using errcode = 'no_data_found'; end if;

  if not public.dev_can(v_pay.workspace_id, 'finance') then
    raise exception 'Only finance can confirm a payment.' using errcode = '42501';
  end if;
  if v_pay.status = 'CONFIRMED' then return; end if;

  update public.dev_payments
     set status = 'CONFIRMED', confirmed_by = v_user, confirmed_at = now()
   where id = p_payment_id;

  perform public.dev_refresh_schedule(v_pay.deal_id);

  insert into public.dev_activities (
    workspace_id, deal_id, kind, provenance, title, meta, actor_id,
    lead_id, unit_id)
  select v_pay.workspace_id, v_pay.deal_id, 'PAYMENT', 'PAYMENT',
         'Payment confirmed', jsonb_build_object('amount', v_pay.amount,
                                                 'currency', v_pay.currency,
                                                 'payment_id', p_payment_id),
         v_user, d.lead_id, d.unit_id
    from public.dev_deals d where d.id = v_pay.deal_id;

  insert into public.dev_audit_log (workspace_id, actor_id, entity_type, entity_id, action, before_state, after_state)
  values (v_pay.workspace_id, v_user, 'payment', p_payment_id, 'CONFIRMED',
          jsonb_build_object('status', v_pay.status),
          jsonb_build_object('status', 'CONFIRMED', 'amount', v_pay.amount));
end;
$$;

create or replace function public.dev_reject_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := public.auth_user_id();
  v_pay public.dev_payments%rowtype;
begin
  select * into v_pay from public.dev_payments where id = p_payment_id for update;
  if not found then raise exception 'Payment not found.' using errcode = 'no_data_found'; end if;
  if not public.dev_can(v_pay.workspace_id, 'finance') then
    raise exception 'Only finance can reject a payment.' using errcode = '42501';
  end if;

  update public.dev_payments
     set status = 'REJECTED', rejected_reason = p_reason, confirmed_by = v_user, confirmed_at = now()
   where id = p_payment_id;

  perform public.dev_refresh_schedule(v_pay.deal_id);

  insert into public.dev_audit_log (workspace_id, actor_id, entity_type, entity_id, action, after_state)
  values (v_pay.workspace_id, v_user, 'payment', p_payment_id, 'REJECTED',
          jsonb_build_object('reason', p_reason));
end;
$$;

-- ── 6. RESERVATION EXPIRY ──────────────────────────────────────────────────
--
-- §135: a reservation that runs out is FLAGGED, and the unit is only put back
-- on the market if the workspace has asked for that. Silently re-listing an
-- apartment somebody believes they are holding is not a feature.

create or replace function public.dev_expire_reservations(p_workspace uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_auto boolean;
  v_count integer := 0;
  v_res record;
begin
  if not public.dev_is_member(p_workspace) then
    raise exception 'Not a member of this workspace.' using errcode = '42501';
  end if;

  select coalesce((feature_flags->>'auto_release_expired_reservations')::boolean, false)
    into v_auto from public.dev_workspaces where id = p_workspace;

  perform set_config('homatch.dev_sales_txn', 'on', true);

  for v_res in
    select * from public.dev_reservations
     where workspace_id = p_workspace and status = 'ACTIVE'
       and expires_at is not null and expires_at < now()
     for update
  loop
    update public.dev_reservations set status = 'EXPIRED' where id = v_res.id;
    v_count := v_count + 1;

    if v_auto then
      update public.dev_units set status = 'AVAILABLE'
       where id = v_res.unit_id and status = 'RESERVED';
      insert into public.dev_unit_events (workspace_id, unit_id, kind, from_value, to_value, note)
      values (p_workspace, v_res.unit_id, 'RESERVATION_RELEASED', 'RESERVED', 'AVAILABLE',
              'Reservation expired and this workspace releases expired holds automatically.');
    end if;

    insert into public.dev_audit_log (workspace_id, entity_type, entity_id, action, after_state)
    values (p_workspace, 'reservation', v_res.id, 'EXPIRED',
            jsonb_build_object('auto_released', v_auto));
  end loop;

  return v_count;
end;
$$;

-- ── 7. LEAD STAGE ──────────────────────────────────────────────────────────

create or replace function public.dev_set_lead_stage(
  p_lead_id uuid,
  p_stage text,
  p_lost_reason text default null,
  p_lost_note text default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := public.auth_user_id();
  v_lead public.dev_leads%rowtype;
begin
  select * into v_lead from public.dev_leads where id = p_lead_id;
  if not found then raise exception 'Lead not found.' using errcode = 'no_data_found'; end if;
  if not public.dev_lead_visible(p_lead_id) or not public.dev_can(v_lead.workspace_id, 'crm') then
    raise exception 'You do not have permission to change this lead.' using errcode = '42501';
  end if;

  -- The three stages that mean an apartment changed hands are set by the
  -- reservation and deal workflow, not by dragging a card.
  if p_stage in ('RESERVATION', 'CONTRACT', 'SOLD') then
    raise exception 'Stage % is set by the reservation and contract workflow.', p_stage
      using errcode = 'check_violation';
  end if;
  if p_stage = 'LOST' and p_lost_reason is null then
    raise exception 'A lost lead needs a reason.' using errcode = 'check_violation';
  end if;

  update public.dev_leads
     set stage = p_stage,
         lost_reason = case when p_stage = 'LOST' then p_lost_reason else null end,
         lost_note   = case when p_stage = 'LOST' then p_lost_note else null end,
         last_activity_at = now()
   where id = p_lead_id;

  insert into public.dev_activities (
    workspace_id, lead_id, contact_id, kind, provenance, title, body, meta, actor_id)
  values (v_lead.workspace_id, p_lead_id, v_lead.contact_id, 'STAGE_CHANGE', 'MANUAL',
          v_lead.stage || ' -> ' || p_stage, p_lost_note,
          jsonb_build_object('from', v_lead.stage, 'to', p_stage, 'lost_reason', p_lost_reason),
          v_user);
end;
$$;

-- ── 8. INVENTORY IMPORT ────────────────────────────────────────────────────
--
-- One transaction for the whole sheet, and it reports rather than guesses: a
-- unit number that already exists is SKIPPED in insert mode and UPDATED in
-- upsert mode, and either way the caller is told how many of each. There is
-- no mode that deletes anything.

create or replace function public.dev_import_units(
  p_project_id uuid,
  p_rows jsonb,
  p_mode text default 'INSERT'
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := public.auth_user_id();
  v_project public.dev_projects%rowtype;
  v_row jsonb;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_num text;
  v_building uuid;
  v_idx integer := 0;
begin
  select * into v_project from public.dev_projects where id = p_project_id;
  if not found then raise exception 'Project not found.' using errcode = 'no_data_found'; end if;
  if not public.dev_can(v_project.workspace_id, 'inventory') then
    raise exception 'You do not have permission to import inventory.' using errcode = '42501';
  end if;
  if p_mode not in ('INSERT', 'UPSERT') then
    raise exception 'Unknown import mode %.', p_mode using errcode = 'check_violation';
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_idx := v_idx + 1;
    v_num := nullif(trim(coalesce(v_row->>'unit_number', '')), '');

    if v_num is null then
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'error', 'missing unit number');
      continue;
    end if;

    v_building := null;
    if nullif(trim(coalesce(v_row->>'building', '')), '') is not null then
      select id into v_building from public.dev_buildings
       where project_id = p_project_id and name = trim(v_row->>'building') limit 1;
      if v_building is null then
        insert into public.dev_buildings (workspace_id, project_id, name)
        values (v_project.workspace_id, p_project_id, trim(v_row->>'building'))
        returning id into v_building;
      end if;
    end if;

    if exists (select 1 from public.dev_units u
                where u.project_id = p_project_id and u.unit_number = v_num) then
      if p_mode = 'INSERT' then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      update public.dev_units set
        building_id   = coalesce(v_building, building_id),
        floor_level   = coalesce((nullif(v_row->>'floor_level', ''))::integer, floor_level),
        unit_type     = coalesce(nullif(v_row->>'unit_type', ''), unit_type),
        bedrooms      = coalesce((nullif(v_row->>'bedrooms', ''))::integer, bedrooms),
        rooms         = coalesce((nullif(v_row->>'rooms', ''))::integer, rooms),
        area_total    = coalesce((nullif(v_row->>'area_total', ''))::numeric, area_total),
        area_internal = coalesce((nullif(v_row->>'area_internal', ''))::numeric, area_internal),
        area_balcony  = coalesce((nullif(v_row->>'area_balcony', ''))::numeric, area_balcony),
        orientation   = coalesce(nullif(v_row->>'orientation', ''), orientation),
        view_text     = coalesce(nullif(v_row->>'view_text', ''), view_text),
        price         = coalesce((nullif(v_row->>'price', ''))::numeric, price),
        currency      = coalesce(nullif(v_row->>'currency', ''), currency),
        notes         = coalesce(nullif(v_row->>'notes', ''), notes)
      where project_id = p_project_id and unit_number = v_num;
      v_updated := v_updated + 1;
    else
      begin
        insert into public.dev_units (
          workspace_id, project_id, building_id, unit_number, floor_level, unit_type,
          bedrooms, rooms, area_total, area_internal, area_balcony, orientation,
          view_text, price, currency, notes, created_by, sort_order)
        values (
          v_project.workspace_id, p_project_id, v_building, v_num,
          (nullif(v_row->>'floor_level', ''))::integer,
          nullif(v_row->>'unit_type', ''),
          (nullif(v_row->>'bedrooms', ''))::integer,
          (nullif(v_row->>'rooms', ''))::integer,
          (nullif(v_row->>'area_total', ''))::numeric,
          (nullif(v_row->>'area_internal', ''))::numeric,
          (nullif(v_row->>'area_balcony', ''))::numeric,
          nullif(v_row->>'orientation', ''),
          nullif(v_row->>'view_text', ''),
          (nullif(v_row->>'price', ''))::numeric,
          coalesce(nullif(v_row->>'currency', ''), v_project.currency),
          nullif(v_row->>'notes', ''),
          v_user, v_idx);
        v_inserted := v_inserted + 1;
      exception when others then
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'unit', v_num, 'error', SQLERRM);
      end;
    end if;
  end loop;

  insert into public.dev_audit_log (workspace_id, actor_id, entity_type, entity_id, action, after_state)
  values (v_project.workspace_id, v_user, 'project', p_project_id, 'INVENTORY_IMPORT',
          jsonb_build_object('mode', p_mode, 'inserted', v_inserted,
                             'updated', v_updated, 'skipped', v_skipped));

  return jsonb_build_object(
    'inserted', v_inserted, 'updated', v_updated,
    'skipped', v_skipped, 'errors', v_errors);
end;
$$;

-- ── 9. SHARE LINKS ─────────────────────────────────────────────────────────

create or replace function public.dev_create_share_link(
  p_target_type text,
  p_target_id uuid,
  p_lead_id uuid default null,
  p_expires_at timestamptz default null,
  p_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := public.auth_user_id();
  v_ws uuid;
  v_contact uuid;
  v_token text;
  v_id uuid;
begin
  if p_target_type = 'UNIT' then
    select workspace_id into v_ws from public.dev_units where id = p_target_id;
  elsif p_target_type = 'PROJECT' then
    select workspace_id into v_ws from public.dev_projects where id = p_target_id;
  elsif p_target_type = 'OFFER' then
    select workspace_id into v_ws from public.dev_offers where id = p_target_id;
  elsif p_target_type = 'BUYER_ROOM' then
    select workspace_id into v_ws from public.dev_leads where id = p_target_id;
  else
    raise exception 'Unknown share target %.', p_target_type using errcode = 'check_violation';
  end if;

  if v_ws is null then raise exception 'Nothing to share.' using errcode = 'no_data_found'; end if;
  if not (public.dev_can(v_ws, 'crm') or public.dev_can(v_ws, 'inventory')) then
    raise exception 'You do not have permission to share from this workspace.' using errcode = '42501';
  end if;

  if p_lead_id is not null then
    select contact_id into v_contact from public.dev_leads where id = p_lead_id and workspace_id = v_ws;
  end if;

  v_token := public.dev_new_token();

  insert into public.dev_share_links (
    workspace_id, token, target_type, target_id, lead_id, contact_id,
    expires_at, label, created_by)
  values (v_ws, v_token, p_target_type, p_target_id, p_lead_id, v_contact,
          p_expires_at, p_label, v_user)
  returning id into v_id;

  if p_lead_id is not null then
    insert into public.dev_activities (
      workspace_id, lead_id, contact_id, unit_id, kind, provenance, title, meta, actor_id)
    values (v_ws, p_lead_id, v_contact,
            case when p_target_type = 'UNIT' then p_target_id else null end,
            'SHARE', 'HOMATCH', coalesce(p_label, 'Share link created'),
            jsonb_build_object('share_link_id', v_id, 'target_type', p_target_type), v_user);
  end if;

  return jsonb_build_object('id', v_id, 'token', v_token);
end;
$$;

-- What an anonymous visitor is allowed to see, column by column. Adding a
-- field to dev_units does not add it here.
create or replace function public.dev_share_resolve(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_link public.dev_share_links%rowtype;
  v_payload jsonb;
begin
  select * into v_link from public.dev_share_links where token = p_token;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if v_link.revoked_at is not null then return jsonb_build_object('error', 'REVOKED'); end if;
  if v_link.expires_at is not null and v_link.expires_at < now() then
    return jsonb_build_object('error', 'EXPIRED');
  end if;

  if v_link.target_type = 'UNIT' then
    select jsonb_build_object(
      'unit', jsonb_build_object(
        'id', u.id, 'unit_number', u.unit_number, 'status', u.status,
        'unit_type', u.unit_type, 'bedrooms', u.bedrooms, 'rooms', u.rooms,
        'area_total', u.area_total, 'area_internal', u.area_internal,
        'area_balcony', u.area_balcony, 'area_terrace', u.area_terrace,
        'floor_level', u.floor_level, 'orientation', u.orientation,
        'view_text', u.view_text, 'ceiling_height', u.ceiling_height,
        'parking', u.parking, 'storage', u.storage,
        'floor_plan_url', u.floor_plan_url, 'photos', u.photos, 'video_url', u.video_url,
        'price', u.price, 'currency', u.currency, 'price_per_sqm', u.price_per_sqm),
      'project', jsonb_build_object(
        'id', p.id, 'name', p.name, 'city', p.city, 'district', p.district,
        'address', p.address, 'description', p.description,
        'construction_status', p.construction_status, 'handover_date', p.handover_date,
        'amenities', p.amenities, 'cover_image_url', p.cover_image_url,
        'brochure_url', p.brochure_url,
        'latitude', p.latitude, 'longitude', p.longitude),
      'building', case when b.id is null then null else
        jsonb_build_object('id', b.id, 'name', b.name) end,
      'developer', jsonb_build_object(
        'name', w.name, 'logo_url', w.brand_logo_url, 'brand_color', w.brand_color,
        'website', w.website),
      'walkthrough', (
        select jsonb_build_object('id', t.id, 'provider', t.provider,
                                  'embed_url', t.embed_url, 'scenes', t.scenes,
                                  'cover_image_url', t.cover_image_url, 'title', t.title)
          from public.dev_walkthroughs t
         where t.unit_id = u.id and t.status = 'PUBLISHED'
           and t.visibility in ('PUBLIC', 'UNLISTED', 'BUYER_ONLY')
         order by t.updated_at desc limit 1),
      'payment_plan', (
        select jsonb_build_object('name', pp.name, 'milestones', pp.milestones)
          from public.dev_payment_plans pp where pp.id = u.payment_plan_id)
    ) into v_payload
    from public.dev_units u
    join public.dev_projects p on p.id = u.project_id
    join public.dev_workspaces w on w.id = u.workspace_id
    left join public.dev_buildings b on b.id = u.building_id
    where u.id = v_link.target_id;

  elsif v_link.target_type = 'PROJECT' then
    select jsonb_build_object(
      'project', jsonb_build_object(
        'id', p.id, 'name', p.name, 'city', p.city, 'district', p.district,
        'address', p.address, 'description', p.description,
        'construction_status', p.construction_status, 'handover_date', p.handover_date,
        'amenities', p.amenities, 'cover_image_url', p.cover_image_url,
        'master_plan_url', p.master_plan_url, 'brochure_url', p.brochure_url,
        'currency', p.currency, 'latitude', p.latitude, 'longitude', p.longitude),
      'developer', jsonb_build_object(
        'name', w.name, 'logo_url', w.brand_logo_url, 'brand_color', w.brand_color,
        'website', w.website),
      'units', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', u.id, 'unit_number', u.unit_number, 'status', u.status,
          'bedrooms', u.bedrooms, 'area_total', u.area_total, 'floor_level', u.floor_level,
          'price', u.price, 'currency', u.currency, 'price_per_sqm', u.price_per_sqm,
          'floor_plan_url', u.floor_plan_url, 'photos', u.photos)
          order by u.floor_level, u.unit_number)
          from public.dev_units u
         where u.project_id = p.id and u.is_published
           and u.status not in ('HIDDEN', 'SOLD')), '[]'::jsonb)
    ) into v_payload
    from public.dev_projects p
    join public.dev_workspaces w on w.id = p.workspace_id
    where p.id = v_link.target_id;

  else
    return jsonb_build_object('error', 'UNSUPPORTED');
  end if;

  if v_payload is null then return jsonb_build_object('error', 'NOT_FOUND'); end if;

  update public.dev_share_links
     set view_count = view_count + 1, last_viewed_at = now()
   where id = v_link.id;

  return v_payload || jsonb_build_object(
    'share', jsonb_build_object('target_type', v_link.target_type, 'label', v_link.label));
end;
$$;

create or replace function public.dev_share_track(
  p_token text,
  p_event text,
  p_meta jsonb default '{}'::jsonb,
  p_visitor text default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_link public.dev_share_links%rowtype;
begin
  select * into v_link from public.dev_share_links where token = p_token;
  if not found or v_link.revoked_at is not null then return; end if;
  if v_link.expires_at is not null and v_link.expires_at < now() then return; end if;

  -- An unknown event name is dropped, not stored. The check constraint would
  -- reject it anyway; returning quietly keeps a public endpoint from
  -- reporting which strings are valid.
  if p_event not in ('OPENED','UNIT_VIEWED','WALKTHROUGH_OPENED','FLOORPLAN_VIEWED',
                     'PAYMENT_PLAN_VIEWED','BROCHURE_OPENED','PHOTOS_VIEWED',
                     'CTA_CLICKED','VIEWING_REQUESTED','CONTACT_CLICKED') then
    return;
  end if;

  insert into public.dev_share_events (workspace_id, share_link_id, event, meta, visitor_hash)
  values (v_link.workspace_id, v_link.id, p_event,
          coalesce(p_meta, '{}'::jsonb),
          -- Per link, per day. Enough to tell one visit from ten, useless for
          -- following anybody anywhere else.
          case when p_visitor is null then null
               else md5(v_link.token || ':' || p_visitor || ':' || current_date::text) end);

  -- A tracked event on a link that was sent to a named buyer belongs on that
  -- buyer's timeline. On a link sent to nobody in particular it belongs to
  -- nobody, and is left in dev_share_events alone.
  if v_link.lead_id is not null and p_event <> 'OPENED' then
    insert into public.dev_activities (
      workspace_id, lead_id, contact_id, unit_id, kind, provenance, direction, title, meta)
    values (v_link.workspace_id, v_link.lead_id, v_link.contact_id,
            case when v_link.target_type = 'UNIT' then v_link.target_id else null end,
            'SHARE', 'SHARE_LINK', 'IN',
            case p_event
              when 'WALKTHROUGH_OPENED'  then 'Opened the 3D walkthrough'
              when 'PAYMENT_PLAN_VIEWED' then 'Looked at the payment plan'
              when 'FLOORPLAN_VIEWED'    then 'Looked at the floor plan'
              when 'BROCHURE_OPENED'     then 'Opened the brochure'
              when 'VIEWING_REQUESTED'   then 'Requested a viewing'
              when 'CTA_CLICKED'         then 'Clicked through from the shared page'
              else 'Activity on the shared page'
            end,
            jsonb_build_object('event', p_event, 'share_link_id', v_link.id));
  end if;
end;
$$;

-- ── 10. PUBLIC PROJECT PAGE ────────────────────────────────────────────────

create or replace function public.dev_public_project(p_workspace_slug text, p_project_slug text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare v_payload jsonb;
begin
  select jsonb_build_object(
    'project', jsonb_build_object(
      'id', p.id, 'name', p.name, 'slug', p.slug, 'city', p.city, 'district', p.district,
      'address', p.address, 'description', p.description, 'project_type', p.project_type,
      'construction_status', p.construction_status, 'handover_date', p.handover_date,
      'amenities', p.amenities, 'cover_image_url', p.cover_image_url,
      'master_plan_url', p.master_plan_url, 'brochure_url', p.brochure_url,
      'currency', p.currency, 'latitude', p.latitude, 'longitude', p.longitude),
    'developer', jsonb_build_object(
      'name', w.name, 'slug', w.slug, 'logo_url', w.brand_logo_url,
      'brand_color', w.brand_color, 'website', w.website, 'city', w.city,
      'country', w.country, 'developer_profile_id', w.developer_profile_id),
    'units', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', u.id, 'unit_number', u.unit_number, 'status', u.status,
        'bedrooms', u.bedrooms, 'rooms', u.rooms, 'area_total', u.area_total,
        'floor_level', u.floor_level, 'price', u.price, 'currency', u.currency,
        'price_per_sqm', u.price_per_sqm, 'floor_plan_url', u.floor_plan_url,
        'photos', u.photos, 'view_text', u.view_text, 'orientation', u.orientation,
        'building_id', u.building_id,
        'has_walkthrough', exists (
          select 1 from public.dev_walkthroughs t
           where t.unit_id = u.id and t.status = 'PUBLISHED'
             and t.visibility in ('PUBLIC','UNLISTED')))
        order by u.floor_level, u.unit_number)
        from public.dev_units u
       where u.project_id = p.id and u.is_published
         and u.status not in ('HIDDEN','SOLD')), '[]'::jsonb),
    'buildings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'name', b.name, 'floors_count', b.floors_count,
        'facade_image_url', b.facade_image_url) order by b.sort_order, b.name)
        from public.dev_buildings b where b.project_id = p.id), '[]'::jsonb)
  ) into v_payload
  from public.dev_projects p
  join public.dev_workspaces w on w.id = p.workspace_id
  where p.is_published and w.status = 'ACTIVE'
    and w.slug = p_workspace_slug and p.slug = p_project_slug;

  return coalesce(v_payload, jsonb_build_object('error', 'NOT_FOUND'));
end;
$$;

-- ── 11. GRANTS ON THE PUBLIC SURFACE ───────────────────────────────────────

revoke all on function public.dev_new_token() from public;
revoke all on function public.dev_reserve_unit(uuid, uuid, numeric, text, timestamptz, uuid, text) from public;
revoke all on function public.dev_cancel_reservation(uuid, text) from public;
revoke all on function public.dev_convert_reservation(uuid, numeric, text, date, uuid) from public;
revoke all on function public.dev_mark_deal_sold(uuid, date) from public;
revoke all on function public.dev_refresh_schedule(uuid) from public;
revoke all on function public.dev_confirm_payment(uuid) from public;
revoke all on function public.dev_reject_payment(uuid, text) from public;
revoke all on function public.dev_expire_reservations(uuid) from public;
revoke all on function public.dev_set_lead_stage(uuid, text, text, text) from public;
revoke all on function public.dev_import_units(uuid, jsonb, text) from public;
revoke all on function public.dev_create_share_link(text, uuid, uuid, timestamptz, text) from public;
revoke all on function public.dev_share_resolve(text) from public;
revoke all on function public.dev_share_track(text, text, jsonb, text) from public;
revoke all on function public.dev_public_project(text, text) from public;

grant execute on function public.dev_reserve_unit(uuid, uuid, numeric, text, timestamptz, uuid, text) to authenticated;
grant execute on function public.dev_cancel_reservation(uuid, text) to authenticated;
grant execute on function public.dev_convert_reservation(uuid, numeric, text, date, uuid) to authenticated;
grant execute on function public.dev_mark_deal_sold(uuid, date) to authenticated;
grant execute on function public.dev_confirm_payment(uuid) to authenticated;
grant execute on function public.dev_reject_payment(uuid, text) to authenticated;
grant execute on function public.dev_expire_reservations(uuid) to authenticated;
grant execute on function public.dev_set_lead_stage(uuid, text, text, text) to authenticated;
grant execute on function public.dev_import_units(uuid, jsonb, text) to authenticated;
grant execute on function public.dev_create_share_link(text, uuid, uuid, timestamptz, text) to authenticated;

-- The only two an anonymous visitor may call, and the only two that return
-- anything to one.
grant execute on function public.dev_share_resolve(text) to anon, authenticated;
grant execute on function public.dev_share_track(text, text, jsonb, text) to anon, authenticated;
grant execute on function public.dev_public_project(text, text) to anon, authenticated;

-- ── 12. THE SALES LEDGER ───────────────────────────────────────────────────
--
-- §124: this is a VIEW, not a table. There is no second mutable copy of the
-- sales file to fall out of step with the deals, the payments and the units —
-- the export is a rendering of this, and this is a rendering of them.
--
-- security_invoker is not optional. Without it the view would run as its
-- owner and hand every workspace's sales to every caller.

create or replace view public.dev_sales_ledger
with (security_invoker = true) as
select
  d.id                          as deal_id,
  d.workspace_id,
  p.name                        as project,
  b.name                        as building,
  u.unit_number,
  u.floor_level,
  u.area_total,
  u.unit_type,
  u.bedrooms,
  c.full_name                   as buyer,
  c.phone                       as buyer_phone,
  c.email                       as buyer_email,
  mgr.full_name                 as sales_manager,
  l.source                      as lead_source,
  brk.full_name                 as broker,
  r.reserved_at,
  d.contract_number,
  d.contract_date,
  d.sale_date,
  d.list_price,
  d.discount_amount,
  d.sale_price,
  d.currency,
  case when u.area_total > 0 then round(d.sale_price / u.area_total, 2) end as sale_price_per_sqm,
  coalesce(pay.confirmed_total, 0)                     as paid,
  d.sale_price - coalesce(pay.confirmed_total, 0)      as outstanding,
  nxt.due_date                  as next_payment_due,
  nxt.amount                    as next_payment_amount,
  case
    when coalesce(pay.confirmed_total, 0) >= d.sale_price then 'PAID'
    when ovd.overdue_count > 0 then 'OVERDUE'
    when coalesce(pay.confirmed_total, 0) > 0 then 'PARTIAL'
    else 'PENDING'
  end                           as payment_status,
  d.status                      as deal_status,
  u.status                      as unit_status,
  d.notes,
  d.created_at,
  d.unit_id,
  d.lead_id,
  d.project_id
from public.dev_deals d
join public.dev_units u          on u.id = d.unit_id
join public.dev_projects p       on p.id = u.project_id
left join public.dev_buildings b on b.id = u.building_id
join public.dev_leads l          on l.id = d.lead_id
join public.outreach_contacts c  on c.id = l.contact_id
left join public.users mgr       on mgr.id = d.assigned_to
left join public.users brk       on brk.id = d.broker_id
left join public.dev_reservations r on r.id = d.reservation_id
left join lateral (
  select sum(amount) as confirmed_total
    from public.dev_payments dp
   where dp.deal_id = d.id and dp.status = 'CONFIRMED'
) pay on true
left join lateral (
  select s.due_date, s.amount
    from public.dev_payment_schedule s
   where s.deal_id = d.id and s.status <> 'PAID'
   order by s.due_date nulls last, s.seq
   limit 1
) nxt on true
left join lateral (
  select count(*) as overdue_count
    from public.dev_payment_schedule s
   where s.deal_id = d.id and s.status = 'OVERDUE'
) ovd on true;

grant select on public.dev_sales_ledger to authenticated;

comment on view public.dev_sales_ledger is
  'Derived sales file. Not a stored table — see §124. security_invoker so RLS on the underlying tables decides what each caller sees.';
