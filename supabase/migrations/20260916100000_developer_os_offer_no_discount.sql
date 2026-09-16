-- ============================================================================
-- HOMATCH FOR DEVELOPERS — an offer at list price must be possible.
--
-- WHAT WAS BROKEN
--
-- dev_create_offer computed discount_pct with a CASE that has no ELSE:
--
--   case when p_discount_pct is not null then p_discount_pct
--        when v_disc > 0 then round(v_disc * 100 / v_base, 2) end
--
-- With no discount asked for, both arms are false and the expression is NULL.
-- dev_offers.discount_pct is NOT NULL DEFAULT 0, and an explicitly supplied
-- NULL does not fall back to a column default — so the insert failed with
-- 23502 and the offer was never created.
--
-- That is the single most common action in the product: a salesperson quoting
-- the advertised price. Every discounted offer worked, which is exactly why it
-- survived both the unit tests and the first end-to-end run — those passed a
-- discount because a discount was the interesting case.
--
-- THE FIX
--
-- coalesce to 0. An offer at list price has a nought per cent discount; that
-- is true, it is what the column means, and it keeps discount_pct and
-- discount_amount agreeing with each other (the latter was already 0).
--
-- Nothing else about the function changes: the price is still read from the
-- unit inside the transaction, and the discount permission is still checked
-- before a non-zero discount is allowed.
-- ============================================================================

create or replace function public.dev_create_offer(
  p_lead_id uuid,
  p_unit_id uuid,
  p_discount_pct numeric default null,
  p_discount_amount numeric default null,
  p_deposit_amount numeric default null,
  p_payment_plan_id uuid default null,
  p_valid_until date default null,
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
  v_base numeric(14,2);
  v_disc numeric(14,2);
  v_final numeric(14,2);
  v_offer uuid;
begin
  select * into v_unit from public.dev_units where id = p_unit_id;
  if not found then raise exception 'Unit not found.' using errcode = 'no_data_found'; end if;
  select * into v_lead from public.dev_leads where id = p_lead_id;
  if not found then raise exception 'Lead not found.' using errcode = 'no_data_found'; end if;

  if v_lead.workspace_id <> v_unit.workspace_id then
    raise exception 'That lead and that unit belong to different workspaces.' using errcode = '42501';
  end if;
  if not public.dev_can(v_unit.workspace_id, 'crm') then
    raise exception 'You do not have permission to make an offer.' using errcode = '42501';
  end if;
  if not public.dev_lead_visible(p_lead_id) then
    raise exception 'That lead is not yours.' using errcode = '42501';
  end if;
  if v_unit.status in ('SOLD','CONTRACT_PENDING') then
    raise exception 'Unit % is no longer available to offer.', v_unit.unit_number
      using errcode = 'check_violation';
  end if;

  v_base := v_unit.price;
  if v_base is null then
    raise exception 'Unit % has no price, so an offer cannot be priced.', v_unit.unit_number
      using errcode = 'check_violation';
  end if;

  v_disc := coalesce(p_discount_amount,
                     case when p_discount_pct is not null
                          then round(v_base * p_discount_pct / 100, 2) else 0 end);
  if v_disc < 0 then
    raise exception 'A discount cannot be negative.' using errcode = 'check_violation';
  end if;
  if v_disc > v_base then
    raise exception 'A discount cannot exceed the price.' using errcode = 'check_violation';
  end if;
  if v_disc > 0 and not public.dev_can(v_unit.workspace_id, 'discount') then
    raise exception 'You do not have permission to offer a discount.' using errcode = '42501';
  end if;

  v_final := v_base - v_disc;

  -- A lead gets one live offer per unit. Making a new one supersedes the old,
  -- so the history stays readable instead of becoming three competing prices.
  update public.dev_offers
     set status = 'SUPERSEDED'
   where lead_id = p_lead_id and unit_id = p_unit_id
     and status in ('DRAFT','SENT','VIEWED');

  insert into public.dev_offers (
    workspace_id, lead_id, unit_id, base_price, discount_pct, discount_amount,
    final_price, currency, deposit_amount, payment_plan_id, valid_until,
    status, notes, created_by)
  values (
    v_unit.workspace_id, p_lead_id, p_unit_id, v_base,
    -- THE FIX. No discount is nought per cent, not "unknown": the column is
    -- NOT NULL, and an explicit NULL does not fall back to its default.
    coalesce(
      case when p_discount_pct is not null then p_discount_pct
           when v_disc > 0 then round(v_disc * 100 / v_base, 2) end,
      0),
    v_disc, v_final, v_unit.currency, p_deposit_amount,
    coalesce(p_payment_plan_id, v_unit.payment_plan_id),
    coalesce(p_valid_until, current_date + 14),
    'DRAFT', p_notes, v_user)
  returning id into v_offer;

  insert into public.dev_activities (
    workspace_id, lead_id, unit_id, kind, provenance, title, body, meta, actor_id)
  values (v_unit.workspace_id, p_lead_id, p_unit_id, 'OFFER', 'HOMATCH',
          'Offer prepared for ' || v_unit.unit_number, p_notes,
          jsonb_build_object('offer_id', v_offer, 'final_price', v_final,
                             'discount', v_disc), v_user);

  return v_offer;
end;
$$;

select public.dev_lockdown_rpc_surface();
