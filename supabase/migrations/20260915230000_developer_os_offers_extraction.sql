-- ============================================================================
-- HOMATCH FOR DEVELOPERS — offers, the extraction review gate, twin analytics.
--
-- Three things a developer does every day that had tables and no verbs.
--
-- THE EXTRACTION GATE IS THE IMPORTANT ONE
--
-- Reading a contract PDF and proposing "sale price 184,000" is useful. Writing
-- 184,000 into dev_deals.sale_price because a model said so is not — it is a
-- silent, unattributed change to the number the whole ledger is built on.
--
-- So extraction proposes into dev_documents.extraction and stops. A human
-- opens the document, sees the proposal beside the current value, and applies
-- the fields they accept. dev_apply_extraction is that act: it records who
-- applied what, it REFUSES to overwrite a value that already exists and
-- disagrees unless the caller says so explicitly, and it returns exactly what
-- it changed and what it declined. A receipt becomes a RECORDED payment and
-- never a confirmed one, because confirming money is finance's job and not a
-- side effect of reading a file.
-- ============================================================================

-- ── 1. OFFERS ──────────────────────────────────────────────────────────────

/*
 * Creating an offer is where a discount actually happens, so it is where the
 * discount permission is enforced. A SALES_AGENT may quote list price all day
 * and may not take 8% off; dev_can(...,'discount') is held by SALES_DIRECTOR,
 * ADMIN and OWNER only.
 */
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
    case when p_discount_pct is not null then p_discount_pct
         when v_disc > 0 then round(v_disc * 100 / v_base, 2) end,
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

/*
 * Moving an offer along. ACCEPTED does NOT reserve the unit — reserving is a
 * deliberate second act with its own money and its own expiry, and collapsing
 * the two would mean a buyer saying "yes, sounds good" silently takes an
 * apartment off the market.
 */
create or replace function public.dev_set_offer_status(
  p_offer_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := public.auth_user_id();
  v_offer public.dev_offers%rowtype;
begin
  select * into v_offer from public.dev_offers where id = p_offer_id for update;
  if not found then raise exception 'Offer not found.' using errcode = 'no_data_found'; end if;
  if not public.dev_can(v_offer.workspace_id, 'crm') then
    raise exception 'You do not have permission to change an offer.' using errcode = '42501';
  end if;
  if not public.dev_lead_visible(v_offer.lead_id) then
    raise exception 'That lead is not yours.' using errcode = '42501';
  end if;
  if p_status not in ('DRAFT','SENT','VIEWED','ACCEPTED','DECLINED','EXPIRED','SUPERSEDED') then
    raise exception 'Unknown offer status %.', p_status using errcode = 'check_violation';
  end if;

  update public.dev_offers
     set status = p_status,
         sent_at     = case when p_status = 'SENT' then coalesce(sent_at, now()) else sent_at end,
         viewed_at   = case when p_status = 'VIEWED' then coalesce(viewed_at, now()) else viewed_at end,
         accepted_at = case when p_status = 'ACCEPTED' then now() else accepted_at end,
         notes       = coalesce(p_note, notes)
   where id = p_offer_id;

  insert into public.dev_activities (
    workspace_id, lead_id, unit_id, kind, provenance, title, body, meta, actor_id)
  values (v_offer.workspace_id, v_offer.lead_id, v_offer.unit_id, 'OFFER', 'HOMATCH',
          'Offer ' || lower(p_status), p_note,
          jsonb_build_object('offer_id', p_offer_id, 'from', v_offer.status, 'to', p_status),
          v_user);

  insert into public.dev_audit_log (workspace_id, actor_id, entity_type, entity_id, action, before_state, after_state)
  values (v_offer.workspace_id, v_user, 'offer', p_offer_id, 'STATUS_CHANGED',
          jsonb_build_object('status', v_offer.status),
          jsonb_build_object('status', p_status));
end;
$$;

/* Offers that ran out of time. Idempotent, same shape as dev_expire_reservations. */
create or replace function public.dev_expire_offers(p_workspace uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare v_count integer := 0;
begin
  if not public.dev_is_member(p_workspace) then
    raise exception 'Not a member of this workspace.' using errcode = '42501';
  end if;
  update public.dev_offers
     set status = 'EXPIRED'
   where workspace_id = p_workspace
     and status in ('DRAFT','SENT','VIEWED')
     and valid_until is not null and valid_until < current_date;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ── 2. THE EXTRACTION REVIEW GATE ──────────────────────────────────────────

/*
 * p_fields is what the reviewer ACCEPTED, not what the extractor proposed.
 * The UI shows the proposal next to the live value and sends back only the
 * ticked rows, so an unattended process can never reach this function with a
 * full payload and quietly rewrite a contract.
 *
 * p_overwrite is the second half of that promise: without it, a field whose
 * current value disagrees with the proposal is REFUSED and reported, never
 * silently replaced.
 */
create or replace function public.dev_apply_extraction(
  p_document_id uuid,
  p_fields jsonb,
  p_overwrite boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := public.auth_user_id();
  v_doc public.dev_documents%rowtype;
  v_deal public.dev_deals%rowtype;
  v_applied jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_payment uuid;
  v_txt text;
  v_num numeric;
  v_date date;
begin
  select * into v_doc from public.dev_documents where id = p_document_id for update;
  if not found then raise exception 'Document not found.' using errcode = 'no_data_found'; end if;
  if not public.dev_can(v_doc.workspace_id, 'documents') then
    raise exception 'You do not have permission to review documents.' using errcode = '42501';
  end if;

  if v_doc.deal_id is not null then
    select * into v_deal from public.dev_deals where id = v_doc.deal_id for update;
  end if;

  -- ---- contract fields, onto the deal ------------------------------------
  if v_deal.id is not null then
    v_txt := nullif(trim(coalesce(p_fields->>'contract_number', '')), '');
    if v_txt is not null then
      if v_deal.contract_number is not null and v_deal.contract_number <> v_txt and not p_overwrite then
        v_skipped := v_skipped || jsonb_build_object(
          'field', 'contract_number', 'existing', v_deal.contract_number, 'proposed', v_txt,
          'reason', 'DIFFERS_FROM_EXISTING');
      else
        update public.dev_deals set contract_number = v_txt where id = v_deal.id;
        v_applied := v_applied || jsonb_build_object(
          'field', 'contract_number', 'from', v_deal.contract_number, 'to', v_txt);
      end if;
    end if;

    begin
      v_date := nullif(p_fields->>'contract_date', '')::date;
    exception when others then
      v_date := null;
      v_skipped := v_skipped || jsonb_build_object(
        'field', 'contract_date', 'proposed', p_fields->>'contract_date',
        'reason', 'NOT_A_DATE');
    end;
    if v_date is not null then
      if v_deal.contract_date is not null and v_deal.contract_date <> v_date and not p_overwrite then
        v_skipped := v_skipped || jsonb_build_object(
          'field', 'contract_date', 'existing', v_deal.contract_date, 'proposed', v_date,
          'reason', 'DIFFERS_FROM_EXISTING');
      else
        update public.dev_deals set contract_date = v_date where id = v_deal.id;
        v_applied := v_applied || jsonb_build_object(
          'field', 'contract_date', 'from', v_deal.contract_date, 'to', v_date);
      end if;
    end if;

    /*
     * Sale price is the number the ledger, the commission and the buyer's
     * outstanding balance all derive from. Changing it needs finance, on top
     * of the document permission that got the reviewer this far.
     */
    begin
      v_num := nullif(p_fields->>'sale_price', '')::numeric;
    exception when others then
      v_num := null;
      v_skipped := v_skipped || jsonb_build_object(
        'field', 'sale_price', 'proposed', p_fields->>'sale_price', 'reason', 'NOT_A_NUMBER');
    end;
    if v_num is not null then
      if not public.dev_can(v_doc.workspace_id, 'finance') then
        v_skipped := v_skipped || jsonb_build_object(
          'field', 'sale_price', 'existing', v_deal.sale_price, 'proposed', v_num,
          'reason', 'REQUIRES_FINANCE');
      elsif v_deal.sale_price is not null and v_deal.sale_price <> v_num and not p_overwrite then
        v_skipped := v_skipped || jsonb_build_object(
          'field', 'sale_price', 'existing', v_deal.sale_price, 'proposed', v_num,
          'reason', 'DIFFERS_FROM_EXISTING');
      else
        update public.dev_deals set sale_price = v_num where id = v_deal.id;
        -- Refreshes each instalment's STATUS from confirmed payments. It does
        -- not re-derive the amounts, and must not: see the correction in
        -- 20260915260000_developer_os_extraction_warnings.sql.
        perform public.dev_refresh_schedule(v_deal.id);
        v_applied := v_applied || jsonb_build_object(
          'field', 'sale_price', 'from', v_deal.sale_price, 'to', v_num);
      end if;
    end if;
  end if;

  -- ---- a receipt becomes a RECORDED payment, never a confirmed one -------
  if v_doc.doc_type in ('PAYMENT_RECEIPT','BANK_CONFIRMATION')
     and v_deal.id is not null
     and nullif(p_fields->>'amount', '') is not null then
    begin
      v_num := (p_fields->>'amount')::numeric;
    exception when others then
      v_num := null;
      v_skipped := v_skipped || jsonb_build_object(
        'field', 'amount', 'proposed', p_fields->>'amount', 'reason', 'NOT_A_NUMBER');
    end;

    if v_num is not null and v_num > 0 then
      if exists (select 1 from public.dev_payments where document_id = p_document_id) then
        v_skipped := v_skipped || jsonb_build_object(
          'field', 'amount', 'proposed', v_num, 'reason', 'PAYMENT_ALREADY_RECORDED');
      else
        begin
          v_date := coalesce(nullif(p_fields->>'paid_at', '')::date, current_date);
        exception when others then
          v_date := current_date;
        end;

        insert into public.dev_payments (
          workspace_id, deal_id, amount, currency, paid_at, method, reference,
          document_id, status, notes, created_by)
        values (
          v_doc.workspace_id, v_deal.id, v_num,
          coalesce(nullif(p_fields->>'currency', ''), v_deal.currency), v_date,
          coalesce(nullif(p_fields->>'method', ''), 'BANK_TRANSFER'),
          nullif(p_fields->>'reference', ''), p_document_id,
          'RECORDED',
          'Recorded from ' || v_doc.title || ' — awaiting confirmation.', v_user)
        returning id into v_payment;

        v_applied := v_applied || jsonb_build_object(
          'field', 'payment', 'to', v_num, 'payment_id', v_payment,
          'note', 'RECORDED, still needs finance confirmation');
      end if;
    end if;
  end if;

  -- ---- the document itself -----------------------------------------------
  update public.dev_documents
     set status = case when jsonb_array_length(v_applied) > 0 then 'CONFIRMED' else status end,
         confirmed_by = case when jsonb_array_length(v_applied) > 0 then v_user else confirmed_by end,
         confirmed_at = case when jsonb_array_length(v_applied) > 0 then now() else confirmed_at end
   where id = p_document_id;

  insert into public.dev_activities (
    workspace_id, lead_id, unit_id, deal_id, kind, provenance, title, body, meta, actor_id)
  values (v_doc.workspace_id, v_doc.lead_id, v_doc.unit_id, v_doc.deal_id, 'DOCUMENT', 'DOCUMENT',
          'Extraction reviewed: ' || v_doc.title,
          case when jsonb_array_length(v_applied) = 0 then 'No values were applied.' end,
          jsonb_build_object('document_id', p_document_id,
                             'applied', v_applied, 'skipped', v_skipped), v_user);

  insert into public.dev_audit_log (
    workspace_id, actor_id, entity_type, entity_id, action, before_state, after_state)
  values (v_doc.workspace_id, v_user, 'document', p_document_id, 'EXTRACTION_APPLIED',
          jsonb_build_object('proposed', v_doc.extraction, 'overwrite', p_overwrite),
          jsonb_build_object('applied', v_applied, 'skipped', v_skipped));

  return jsonb_build_object('applied', v_applied, 'skipped', v_skipped);
end;
$$;

/* Rejecting a proposal outright, so the queue empties honestly. */
create or replace function public.dev_reject_extraction(p_document_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := public.auth_user_id();
  v_ws uuid;
begin
  select workspace_id into v_ws from public.dev_documents where id = p_document_id;
  if v_ws is null then raise exception 'Document not found.' using errcode = 'no_data_found'; end if;
  if not public.dev_can(v_ws, 'documents') then
    raise exception 'You do not have permission to review documents.' using errcode = '42501';
  end if;

  update public.dev_documents
     set status = 'REJECTED', extraction_error = p_reason,
         confirmed_by = v_user, confirmed_at = now()
   where id = p_document_id;

  insert into public.dev_audit_log (workspace_id, actor_id, entity_type, entity_id, action, after_state)
  values (v_ws, v_user, 'document', p_document_id, 'EXTRACTION_REJECTED',
          jsonb_build_object('reason', p_reason));
end;
$$;

-- ── 3. TWIN ANALYTICS FOR THE DEVELOPER ────────────────────────────────────
--
-- What the developer is allowed to see about their own 3D: interest, not our
-- cost. dt_cost_rollup stays studio-only and is not touched here.

create or replace function public.dt_analytics(
  p_workspace uuid,
  p_project uuid default null,
  p_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
  v_out jsonb;
begin
  if not public.dev_is_member(p_workspace) then
    raise exception 'Not a member of this workspace.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'since', v_since,
    'totals', (select jsonb_build_object(
        'opens', count(*) filter (where kind = 'PROJECT_OPEN'),
        'unit_views', count(*) filter (where kind = 'UNIT_VIEW'),
        'floorplan_views', count(*) filter (where kind = 'FLOORPLAN_VIEW'),
        'walkthroughs', count(*) filter (where kind = 'WALKTHROUGH_START'),
        'contact_requests', count(*) filter (where kind = 'CONTACT_REQUEST'),
        'visitors', count(distinct visitor_hash))
      from public.dt_events e
       where e.workspace_id = p_workspace and e.created_at >= v_since
         and (p_project is null or e.project_id = p_project)),
    'by_origin', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('origin', coalesce(e.origin, 'PUBLIC'), 'events', count(*)) as x
          from public.dt_events e
         where e.workspace_id = p_workspace and e.created_at >= v_since
           and (p_project is null or e.project_id = p_project)
         group by e.origin) t), '[]'::jsonb),
    /* The one genuinely actionable number: which apartments people keep
       opening. A sales team can act on that this afternoon. */
    'top_units', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object(
          'unit_id', u.id, 'unit_number', u.unit_number, 'status', u.status,
          'views', count(*)) as x
          from public.dt_events e
          join public.dev_units u on u.id = e.unit_id
         where e.workspace_id = p_workspace and e.created_at >= v_since
           and e.kind in ('UNIT_VIEW','FLOORPLAN_VIEW')
           and (p_project is null or e.project_id = p_project)
         group by u.id, u.unit_number, u.status
         order by count(*) desc
         limit 10) t), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(x order by x->>'day') from (
        select jsonb_build_object(
          'day', to_char(date_trunc('day', e.created_at), 'YYYY-MM-DD'),
          'opens', count(*) filter (where e.kind = 'PROJECT_OPEN'),
          'unit_views', count(*) filter (where e.kind = 'UNIT_VIEW')) as x
          from public.dt_events e
         where e.workspace_id = p_workspace and e.created_at >= v_since
           and (p_project is null or e.project_id = p_project)
         group by date_trunc('day', e.created_at)) t), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$$;

-- ── 4. GRANTS ──────────────────────────────────────────────────────────────
-- The sweep closes the default anon grant on everything created above; none
-- of these is a public entry point.

select public.dev_lockdown_rpc_surface();
