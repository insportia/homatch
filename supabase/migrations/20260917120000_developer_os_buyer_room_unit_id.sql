-- THE BUYER ROOM COULD NOT REACH ITS OWN WALKTHROUGH.
--
-- dev_buyer_room() returns a deliberately narrow shape: the buyer's own unit,
-- their own deal, their own schedule, and nothing about anybody else. That is
-- right, and this migration does not widen it in any way that matters. It adds
-- ONE field -- the unit's id -- so the page can ask dt_unit_scene() whether a
-- walkthrough exists for the apartment the buyer has already bought.
--
-- WHY THIS EXPOSES NOTHING NEW
--
-- dt_unit_scene() applies its own three gates and is untouched here: a scene is
-- served only when the scene is published, its version is published, and the
-- project's experience is published. Knowing the id buys a caller nothing they
-- could not already do -- every dev_* table refuses anon outright -- and the id
-- they receive is the id of the apartment they are buying.
--
-- The rest of the body below is the deployed function, copied verbatim from
-- 20260915220000 so the two cannot drift.

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
        -- THE ONE NEW FIELD. Everything else in this function is verbatim.
        'unit_id', u.id,
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

-- Unchanged from the original: a buyer's own token, and nothing else.
revoke all on function public.dev_buyer_room(text) from public;
grant execute on function public.dev_buyer_room(text) to anon, authenticated;
