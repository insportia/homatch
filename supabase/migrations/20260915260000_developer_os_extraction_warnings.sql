-- ============================================================================
-- HOMATCH FOR DEVELOPERS — a corrected price must not silently rewrite a
-- payment plan, and must not silently leave one that no longer adds up.
--
-- WHAT THE END-TO-END RUN FOUND
--
-- dev_apply_extraction, on accepting a new sale price, called
-- dev_refresh_schedule with the comment "the instalment plan is derived from
-- the price, so it has to follow".
--
-- It does not follow. dev_refresh_schedule recomputes each instalment's
-- STATUS — paid, partial, overdue, pending — from the payments confirmed
-- against it. It has never touched the amounts, and the name says so if you
-- read it carefully enough. So a contract corrected from 176,640 to 171,000
-- left three instalments still summing to 176,640, and nothing said a word.
--
-- WHY THE FIX IS NOT "RECOMPUTE THE AMOUNTS"
--
-- Because those instalments are what a buyer agreed to, one of them is
-- usually already paid, and re-deriving them would quietly change the dates
-- and figures on a signed payment plan. That is precisely the silent money
-- change this product refuses to make. A person has to decide how a price
-- correction is absorbed: a smaller final instalment, a refund, or a new
-- plan altogether.
--
-- So the price is applied, the statuses are refreshed, and the discrepancy is
-- REPORTED. dev_apply_extraction now returns a `warnings` array, and the
-- review screen shows it. An inconsistency somebody has been told about is a
-- decision waiting to be made; the same inconsistency unmentioned is a bug
-- that surfaces months later in an argument about a final balance.
-- ============================================================================

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
  v_warnings jsonb := '[]'::jsonb;
  v_payment uuid;
  v_txt text;
  v_num numeric;
  v_date date;
  v_schedule_total numeric;
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

        /*
         * The statuses follow — paid, partial, overdue — because those are
         * derived from confirmed payments and nothing else.
         *
         * The AMOUNTS deliberately do not. They are what the buyer agreed to,
         * one of them is usually already paid, and re-deriving them would
         * rewrite a signed payment plan without anybody deciding to. So the
         * gap is reported instead, and a person chooses how to absorb it.
         */
        perform public.dev_refresh_schedule(v_deal.id);

        select sum(amount) into v_schedule_total
          from public.dev_payment_schedule where deal_id = v_deal.id;

        if v_schedule_total is not null and v_schedule_total <> v_num then
          v_warnings := v_warnings || jsonb_build_object(
            'kind', 'SCHEDULE_TOTAL_MISMATCH',
            'sale_price', v_num,
            'schedule_total', v_schedule_total,
            'difference', v_schedule_total - v_num);
        end if;

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
                             'applied', v_applied, 'skipped', v_skipped,
                             'warnings', v_warnings), v_user);

  insert into public.dev_audit_log (
    workspace_id, actor_id, entity_type, entity_id, action, before_state, after_state)
  values (v_doc.workspace_id, v_user, 'document', p_document_id, 'EXTRACTION_APPLIED',
          jsonb_build_object('proposed', v_doc.extraction, 'overwrite', p_overwrite),
          jsonb_build_object('applied', v_applied, 'skipped', v_skipped,
                             'warnings', v_warnings));

  return jsonb_build_object(
    'applied', v_applied, 'skipped', v_skipped, 'warnings', v_warnings);
end;
$$;

select public.dev_lockdown_rpc_surface();
