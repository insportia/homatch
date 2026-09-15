-- ============================================================================
-- HOMATCH FOR DEVELOPERS — the seam between a sales team and a person.
--
-- THE PROBLEM THIS FIXES, STATED PLAINLY
--
-- public.outreach_contacts is owner-scoped: `owner_id = auth.uid()`. That is
-- right for the product it was built for — an audience I imported is mine —
-- and wrong in two directions the moment a workspace points at it.
--
--   Too closed: a sales director cannot read the buyer their own agent is
--   working, because the contact row belongs to the agent. The sales ledger
--   INNER JOINs that table, so the deal would not merely lose the buyer's
--   name, the whole row would vanish from the report.
--
--   Too open: dev_leads.contact_id is a plain foreign key. Anybody could make
--   their own workspace, insert a lead pointing at a contact uuid belonging
--   to somebody else, and read it back through any workspace-scoped view. A
--   CRM link is not an access grant, and it must not become one.
--
-- WHAT IS DONE ABOUT IT, AND WHAT IS DELIBERATELY NOT
--
-- outreach_contacts is not touched. No policy on it is widened, dropped or
-- rewritten — the existing rule still says what it always said. Instead:
--
--   * A workspace's buyers are owned by ONE account (the workspace owner), so
--     there is one place they live and deduplication actually works across a
--     team rather than per salesperson.
--   * Teammates READ them through dev_lead_contacts, a view that runs with
--     its owner's rights but filters every row through dev_lead_visible().
--     The caller's own role decides what comes back; nothing else does.
--   * Teammates WRITE them through dev_ensure_contact / dev_update_contact,
--     which check the workspace capability first.
--   * Direct INSERT into dev_leads is withdrawn entirely. There is no longer
--     a way to assert "this contact is mine to work" from the client, which
--     is what closes the hole above.
-- ============================================================================

-- ── 1. READING A BUYER ─────────────────────────────────────────────────────
--
-- No security_invoker, on purpose: this view exists precisely to reach past
-- the owner-scoped policy on outreach_contacts. What replaces that policy is
-- the WHERE clause — dev_lead_visible() is SECURITY DEFINER and evaluates the
-- CALLER, so a sales agent sees their own leads' buyers and nobody else's.
--
-- Consent columns travel with the person. A screen that offers a Call button
-- must be able to see do_not_call without going anywhere else for it.

create or replace view public.dev_lead_contacts as
select
  l.id            as lead_id,
  l.workspace_id,
  c.id            as contact_id,
  c.full_name,
  c.phone,
  c.email,
  c.language,
  c.country,
  c.city,
  c.company,
  c.consent_status,
  c.do_not_contact,
  c.do_not_call,
  c.unsubscribed,
  c.whatsapp_opted_out,
  c.suppressed,
  c.last_contacted_at
from public.dev_leads l
join public.outreach_contacts c on c.id = l.contact_id
where public.dev_lead_visible(l.id);

comment on view public.dev_lead_contacts is
  'Buyer identity for leads the caller may see. Runs with owner rights to reach past outreach_contacts'' owner-scoped RLS; dev_lead_visible() in the WHERE is what restricts it. Never granted to anon.';

revoke all on public.dev_lead_contacts from public;
grant select on public.dev_lead_contacts to authenticated;

-- ── 2. WRITING A BUYER ─────────────────────────────────────────────────────
--
-- One list per workspace, owned by the workspace owner, so that two agents
-- entering the same phone number end up on the same person.

create or replace function public.dev_contact_list(p_workspace uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_owner_auth uuid;
  v_name text;
  v_list uuid;
begin
  select u.auth_id, 'Homatch for Developers — ' || w.name
    into v_owner_auth, v_name
    from public.dev_workspaces w
    join public.users u on u.id = w.owner_id
   where w.id = p_workspace;

  if v_owner_auth is null then
    raise exception 'Workspace not found.' using errcode = 'no_data_found';
  end if;

  select id into v_list from public.outreach_contact_lists
   where owner_id = v_owner_auth and name = v_name limit 1;

  if v_list is null then
    insert into public.outreach_contact_lists (owner_id, name, source_format, description)
    values (v_owner_auth, v_name, 'CRM',
            'Buyers and enquiries belonging to a Homatch for Developers workspace.')
    returning id into v_list;
  end if;

  return v_list;
end;
$$;

-- Find-or-create. Matching is on a normalised phone first and a lowercased
-- email second, because those are the two things that actually identify
-- somebody; two different people share a name far more often than a number.
create or replace function public.dev_ensure_contact(
  p_workspace uuid,
  p_full_name text,
  p_phone text default null,
  p_email text default null,
  p_language text default null,
  p_country text default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_list uuid;
  v_owner_auth uuid;
  v_id uuid;
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
begin
  if not public.dev_can(p_workspace, 'crm') then
    raise exception 'You do not have permission to add buyers to this workspace.'
      using errcode = '42501';
  end if;
  if coalesce(trim(p_full_name), '') = '' and v_phone is null and v_email is null then
    raise exception 'A buyer needs at least a name, a phone number or an email address.'
      using errcode = 'check_violation';
  end if;

  v_list := public.dev_contact_list(p_workspace);
  select u.auth_id into v_owner_auth
    from public.dev_workspaces w join public.users u on u.id = w.owner_id
   where w.id = p_workspace;

  if v_phone is not null then
    select id into v_id from public.outreach_contacts
     where list_id = v_list
       and regexp_replace(coalesce(phone, ''), '[^0-9+]', '', 'g') = v_phone
     limit 1;
  end if;

  if v_id is null and v_email is not null then
    select id into v_id from public.outreach_contacts
     where list_id = v_list and lower(email) = v_email limit 1;
  end if;

  if v_id is not null then
    -- Fill blanks on somebody we already know; never overwrite what is there,
    -- and never touch a consent column from here.
    update public.outreach_contacts set
      full_name = coalesce(nullif(trim(full_name), ''), nullif(trim(p_full_name), '')),
      phone     = coalesce(nullif(trim(phone), ''), nullif(trim(p_phone), '')),
      email     = coalesce(nullif(trim(email), ''), v_email),
      language  = coalesce(language, p_language),
      country   = coalesce(country, p_country)
    where id = v_id;
    return v_id;
  end if;

  insert into public.outreach_contacts (
    list_id, owner_id, full_name, phone, phone_raw, email, language, country,
    consent_status, consent_source, raw_row, normalized_data, validation_status)
  values (
    v_list, v_owner_auth, nullif(trim(p_full_name), ''), nullif(trim(p_phone), ''),
    p_phone, v_email, p_language, p_country,
    -- A buyer who rang a sales office has not consented to a marketing
    -- campaign. They enter as UNKNOWN and the Communications stack decides
    -- what that permits, exactly as it does for every other contact.
    'UNKNOWN', 'DEVELOPER_CRM', '{}'::jsonb, '{}'::jsonb, 'VALID')
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.dev_update_contact(
  p_lead_id uuid,
  p_full_name text default null,
  p_phone text default null,
  p_email text default null,
  p_language text default null,
  p_country text default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare v_lead public.dev_leads%rowtype;
begin
  select * into v_lead from public.dev_leads where id = p_lead_id;
  if not found then raise exception 'Lead not found.' using errcode = 'no_data_found'; end if;
  if not public.dev_lead_visible(p_lead_id) or not public.dev_can(v_lead.workspace_id, 'crm') then
    raise exception 'You do not have permission to edit this buyer.' using errcode = '42501';
  end if;

  update public.outreach_contacts set
    full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
    phone     = coalesce(nullif(trim(p_phone), ''), phone),
    email     = coalesce(nullif(lower(trim(p_email)), ''), email),
    language  = coalesce(p_language, language),
    country   = coalesce(p_country, country)
  where id = v_lead.contact_id;
end;
$$;

-- ── 3. CREATING A LEAD ─────────────────────────────────────────────────────
--
-- The only way. Direct INSERT is withdrawn below.

create or replace function public.dev_create_lead(
  p_workspace uuid,
  p_full_name text,
  p_phone text default null,
  p_email text default null,
  p_project_id uuid default null,
  p_source text default null,
  p_assigned_to uuid default null,
  p_language text default null,
  p_country text default null,
  p_budget_min numeric default null,
  p_budget_max numeric default null,
  p_currency text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := public.auth_user_id();
  v_contact uuid;
  v_lead uuid;
  v_assignee uuid;
begin
  if not public.dev_can(p_workspace, 'crm') then
    raise exception 'You do not have permission to add leads to this workspace.'
      using errcode = '42501';
  end if;

  -- You may hand a lead to a colleague; you may not hand it to a stranger.
  if p_assigned_to is not null then
    if not exists (select 1 from public.dev_members m
                    where m.workspace_id = p_workspace and m.user_id = p_assigned_to
                      and m.status = 'ACTIVE') then
      raise exception 'That person is not on this workspace''s team.' using errcode = 'check_violation';
    end if;
    v_assignee := p_assigned_to;
  else
    v_assignee := v_user;
  end if;

  v_contact := public.dev_ensure_contact(
    p_workspace, p_full_name, p_phone, p_email, p_language, p_country);

  -- Already being worked on this project? Return the existing lead rather
  -- than creating a second card for the same person.
  select id into v_lead from public.dev_leads
   where workspace_id = p_workspace and contact_id = v_contact
     and project_id is not distinct from p_project_id
   limit 1;

  if v_lead is not null then
    return v_lead;
  end if;

  insert into public.dev_leads (
    workspace_id, contact_id, project_id, source, assigned_to,
    budget_min, budget_max, currency, notes, created_by, last_activity_at)
  values (
    p_workspace, v_contact, p_project_id, p_source, v_assignee,
    p_budget_min, p_budget_max, p_currency, p_notes, v_user, now())
  returning id into v_lead;

  insert into public.dev_activities (
    workspace_id, lead_id, contact_id, kind, provenance, title, actor_id)
  values (p_workspace, v_lead, v_contact, 'SYSTEM',
          case when p_source is null then 'MANUAL' else 'IMPORT' end,
          'Lead created', v_user);

  return v_lead;
end;
$$;

-- ── 4. WITHDRAWING THE DIRECT ROUTE ────────────────────────────────────────
--
-- Both of these were added by this same workstream an hour ago; neither has
-- ever been used by a client. Nothing outside Homatch for Developers is
-- affected.

drop policy if exists dev_leads_insert on public.dev_leads;
revoke insert on public.dev_leads from authenticated;

-- ── 5. LEAD-SCOPED WRITES ──────────────────────────────────────────────────
--
-- The write policies on the lead-scoped tables checked the workspace
-- capability but not the lead, so one agent could attach a note or an offer
-- to another agent's buyer. Same capability, now also the same visibility
-- rule the read side uses.

do $$
declare t text;
begin
  foreach t in array array['dev_lead_units','dev_activities','dev_tasks','dev_viewings','dev_offers'] loop
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format(
      'create policy %I_write on public.%I for all to authenticated
       using (public.dev_can(workspace_id, ''crm'')
              and (lead_id is null or public.dev_lead_visible(lead_id)))
       with check (public.dev_can(workspace_id, ''crm'')
              and (lead_id is null or public.dev_lead_visible(lead_id)))', t, t);
  end loop;
end $$;

-- ── 6. THE LEDGER, REBUILT ON THE SAFE JOIN ────────────────────────────────

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
  lc.full_name                  as buyer,
  lc.phone                      as buyer_phone,
  lc.email                      as buyer_email,
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
  coalesce(pay.confirmed_total, 0)                as paid,
  d.sale_price - coalesce(pay.confirmed_total, 0) as outstanding,
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
-- LEFT, not INNER. A deal is a fact about an apartment and a sum of money; it
-- must appear in the ledger even for a caller whose role does not let them
-- read the buyer's name, with the name simply absent.
left join public.dev_lead_contacts lc on lc.lead_id = l.id
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

-- ── 7. WHAT NEEDS MY ATTENTION ─────────────────────────────────────────────
--
-- SECURITY INVOKER (the default) on purpose: every count below is a plain
-- query against a table with RLS on it, so a sales agent's "my leads" and an
-- owner's "all leads" fall out of the same SQL without this function knowing
-- anything about roles. One round trip instead of a dashboard that fires
-- fourteen.

create or replace function public.dev_workspace_overview(p_workspace uuid)
returns jsonb
language sql
stable
set search_path to public, pg_catalog
as $$
  select jsonb_build_object(
    'units', (
      select jsonb_build_object(
        'total', count(*),
        'available', count(*) filter (where status = 'AVAILABLE'),
        'reserved', count(*) filter (where status = 'RESERVED'),
        'negotiation', count(*) filter (where status = 'NEGOTIATION'),
        'contract_pending', count(*) filter (where status = 'CONTRACT_PENDING'),
        'sold', count(*) filter (where status = 'SOLD'),
        'value_available', coalesce(sum(price) filter (where status = 'AVAILABLE'), 0))
      from dev_units where workspace_id = p_workspace),
    'leads', (
      select jsonb_build_object(
        'total', count(*),
        'new', count(*) filter (where stage = 'NEW'),
        'active', count(*) filter (where stage not in ('LOST','SOLD')),
        'negotiation', count(*) filter (where stage = 'NEGOTIATION'),
        'overdue_follow_ups', count(*) filter (
          where next_follow_up_at is not null and next_follow_up_at < now()
            and stage not in ('LOST','SOLD')))
      from dev_leads where workspace_id = p_workspace),
    'viewings', (
      select jsonb_build_object(
        'today', count(*) filter (where scheduled_at::date = current_date
                                    and status in ('SCHEDULED','CONFIRMED')),
        'upcoming', count(*) filter (where scheduled_at > now()
                                    and status in ('SCHEDULED','CONFIRMED')))
      from dev_viewings where workspace_id = p_workspace),
    'reservations', (
      select jsonb_build_object(
        'active', count(*) filter (where status = 'ACTIVE'),
        'expiring_soon', count(*) filter (
          where status = 'ACTIVE' and expires_at is not null
            and expires_at between now() and now() + interval '7 days'),
        'expired_unresolved', count(*) filter (
          where status = 'ACTIVE' and expires_at is not null and expires_at < now()))
      from dev_reservations where workspace_id = p_workspace),
    'sales', (
      select jsonb_build_object(
        'this_month', count(*) filter (where sale_date >= date_trunc('month', current_date)),
        'value_this_month', coalesce(sum(sale_price) filter (
          where sale_date >= date_trunc('month', current_date)), 0),
        'contracted_value', coalesce(sum(sale_price) filter (where status <> 'CANCELLED'), 0))
      from dev_deals where workspace_id = p_workspace),
    'money', (
      select jsonb_build_object(
        'collected', coalesce(sum(amount) filter (where status = 'CONFIRMED'), 0),
        'collected_this_month', coalesce(sum(amount) filter (
          where status = 'CONFIRMED' and paid_at >= date_trunc('month', current_date)), 0),
        'awaiting_confirmation', count(*) filter (where status = 'RECORDED'))
      from dev_payments where workspace_id = p_workspace),
    'schedule', (
      select jsonb_build_object(
        'overdue_count', count(*) filter (where status = 'OVERDUE'),
        'overdue_amount', coalesce(sum(amount - paid_amount) filter (where status = 'OVERDUE'), 0),
        'due_30d', coalesce(sum(amount - paid_amount) filter (
          where status in ('PENDING','PARTIAL')
            and due_date between current_date and current_date + 30), 0))
      from dev_payment_schedule where workspace_id = p_workspace),
    'tasks', (
      select jsonb_build_object(
        'open', count(*) filter (where status = 'OPEN'),
        'overdue', count(*) filter (where status = 'OPEN' and due_at < now()))
      from dev_tasks where workspace_id = p_workspace),
    'documents', (
      select jsonb_build_object(
        'needs_review', count(*) filter (where status in ('EXTRACTED','ANALYZING')))
      from dev_documents where workspace_id = p_workspace)
  );
$$;

grant execute on function public.dev_workspace_overview(uuid) to authenticated;

revoke all on function public.dev_contact_list(uuid) from public;
revoke all on function public.dev_ensure_contact(uuid, text, text, text, text, text) from public;
revoke all on function public.dev_update_contact(uuid, text, text, text, text, text) from public;
revoke all on function public.dev_create_lead(uuid, text, text, text, uuid, text, uuid, text, text, numeric, numeric, text, text) from public;

grant execute on function public.dev_ensure_contact(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.dev_update_contact(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.dev_create_lead(uuid, text, text, text, uuid, text, uuid, text, text, numeric, numeric, text, text) to authenticated;
