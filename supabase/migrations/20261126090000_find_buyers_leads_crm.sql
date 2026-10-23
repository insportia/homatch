-- FIND BUYERS → CRM: an owner saves a discovered external lead as a CRM contact (2026-10-24).
--
-- Owner brief 2026-10-23: keep discovery separate from permission. A lead found in public social
-- posts is a PROSPECT; it never becomes marketing-eligible by being found. Saving it creates an
-- outreach contact that keeps its source (platform, post, public profile, campaign, match
-- reasoning) with consent UNKNOWN and no email address — none is collected or invented. The owner
-- may add a contact detail the person gave them (origin recorded) and record a lawful basis
-- through the existing consent control; only then can an email campaign include them.
--
-- Status ladder shown in the CRM: Discovered (saved) → Qualified (STRONG/POTENTIAL match) →
-- Contactable (an owner-entered email or phone) → Email-eligible (CONSENTED, address, no opt-out).
-- Additive only; no Find Buyers table, unlock rule, price or wallet rule changes.

alter table public.outreach_contacts
  add column if not exists source_kind text,
  add column if not exists source_lead_id uuid references public.find_buyers_leads(id) on delete set null,
  add column if not exists source_property_id uuid,
  add column if not exists source_campaign_id uuid,
  add column if not exists source_platform text,
  add column if not exists source_url text,
  add column if not exists source_profile_url text,
  add column if not exists source_match_category text,
  add column if not exists contact_detail_origin text;
alter table public.outreach_contacts drop constraint if exists outreach_contacts_source_kind_check;
alter table public.outreach_contacts add constraint outreach_contacts_source_kind_check
  check (source_kind is null or source_kind in ('IMPORT', 'MANUAL', 'FIND_BUYERS'));
alter table public.outreach_contacts drop constraint if exists outreach_contacts_contact_detail_origin_check;
alter table public.outreach_contacts add constraint outreach_contacts_contact_detail_origin_check
  check (contact_detail_origin is null or contact_detail_origin in ('OWNER_ENTERED', 'PERSON_PROVIDED', 'PUBLIC_POST'));
create unique index if not exists outreach_contacts_one_per_lead
  on public.outreach_contacts (owner_id, source_lead_id) where source_lead_id is not null;
comment on column public.outreach_contacts.source_lead_id is
  'The Find Buyers lead this contact was saved from. Discovery is not consent: such a contact starts with consent UNKNOWN and no address.';

/* Save one of the caller's own Find Buyers leads into the CRM. Idempotent per (owner, lead). */
create or replace function public.save_find_buyers_lead_to_crm(p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_auth uuid := auth.uid();
  v_user uuid := public.current_homatch_user_id();
  v_lead public.find_buyers_leads;
  v_list uuid;
  v_contact uuid;
  v_created boolean := false;
  v_title text;
  v_best jsonb;
begin
  if v_auth is null or v_user is null then raise exception 'FORBIDDEN'; end if;
  select * into v_lead from public.find_buyers_leads where id = p_lead_id and user_id = v_user;
  if not found then raise exception 'LEAD_NOT_FOUND'; end if;
  if coalesce(v_lead.match_category, '') = 'REJECTED' then raise exception 'LEAD_REJECTED'; end if;
  /* Only people looking to buy or rent: an agent or a seller is not a buyer lead. */
  if v_lead.role is not null and v_lead.role not in ('BUY_SEEKER', 'RENT_SEEKER', 'BUYER_VIA_BROKER') then
    raise exception 'NOT_A_SEEKER';
  end if;

  select c.id into v_contact from public.outreach_contacts c where c.owner_id = v_auth and c.source_lead_id = v_lead.id;
  if v_contact is null then
    select left(coalesce(nullif(p.title, ''), 'HOMATCH ' || coalesce(p.homatch_id::text, left(p.id::text, 8))), 80)
      into v_title from public.properties p where p.id = v_lead.property_id;
    v_title := 'Find Buyers · ' || coalesce(v_title, left(v_lead.property_id::text, 8));
    select l.id into v_list from public.outreach_contact_lists l where l.owner_id = v_auth and l.name = v_title order by l.created_at limit 1;
    if v_list is null then
      insert into public.outreach_contact_lists (owner_id, name, description, import_status)
      values (v_auth, v_title, 'Leads saved from Find Buyers. Discovered in public posts — no consent until you record one.', 'READY')
      returning id into v_list;
    end if;
    v_best := case when jsonb_typeof(v_lead.evidence) = 'array' then v_lead.evidence -> 0 else null end;
    insert into public.outreach_contacts
      (list_id, owner_id, full_name, email, phone, language, consent_status, consent_source, lead_type, lead_stage,
       source_kind, source_lead_id, source_property_id, source_campaign_id, source_platform, source_url, source_profile_url,
       source_match_category, notes)
    values (v_list, v_auth, nullif(btrim(coalesce(v_lead.author_name, '')), ''), null, null, v_lead.language,
       'UNKNOWN', 'find_buyers_discovery', case when v_lead.counterpart = 'TENANT' then 'TENANT' else 'BUYER' end, 'NEW',
       'FIND_BUYERS', v_lead.id, v_lead.property_id, v_lead.campaign_id, v_lead.source,
       nullif(coalesce(v_best ->> 'url', ''), ''), nullif(btrim(coalesce(v_lead.author_profile_url, '')), ''),
       v_lead.match_category, left(v_lead.explanation, 2000))
    on conflict (owner_id, source_lead_id) where source_lead_id is not null do nothing
    returning id into v_contact;
    if v_contact is null then
      select c.id into v_contact from public.outreach_contacts c where c.owner_id = v_auth and c.source_lead_id = v_lead.id;
    else
      v_created := true;
      update public.outreach_contact_lists set total_rows = coalesce(total_rows, 0) + 1, valid_rows = coalesce(valid_rows, 0) + 1, updated_at = now()
       where id = v_list;
    end if;
  end if;
  return jsonb_build_object('contactId', v_contact, 'created', v_created);
end;
$function$;
revoke all on function public.save_find_buyers_lead_to_crm(uuid) from public, anon;
grant execute on function public.save_find_buyers_lead_to_crm(uuid) to authenticated;

/* Which of the caller's leads are already in the CRM (lead id → contact id). */
create or replace function public.find_buyers_lead_crm_contacts(p_lead_ids uuid[])
returns table (lead_id uuid, contact_id uuid)
language sql
stable
security definer
set search_path to ''
as $function$
  select c.source_lead_id, c.id from public.outreach_contacts c
   where c.owner_id = auth.uid() and c.source_lead_id = any (coalesce(p_lead_ids, '{}'::uuid[]));
$function$;
revoke all on function public.find_buyers_lead_crm_contacts(uuid[]) from public, anon;
grant execute on function public.find_buyers_lead_crm_contacts(uuid[]) to authenticated;

/* The owner records a contact detail and where it came from. Consent is never touched here. */
create or replace function public.my_outreach_contact_set_contact_details(p_contact uuid, p_email text, p_phone text, p_origin text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_c public.outreach_contacts;
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if auth.uid() is null then raise exception 'FORBIDDEN'; end if;
  select * into v_c from public.outreach_contacts where id = p_contact and owner_id = auth.uid() for update;
  if not found then raise exception 'CONTACT_NOT_FOUND'; end if;
  if v_email is not null and (length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$') then raise exception 'INVALID_EMAIL'; end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9 ()\-]{6,20}$' then raise exception 'INVALID_PHONE'; end if;
  if (v_email is not null or v_phone is not null) and (p_origin is null or p_origin not in ('OWNER_ENTERED', 'PERSON_PROVIDED', 'PUBLIC_POST')) then
    raise exception 'ORIGIN_REQUIRED';
  end if;
  /* Consent belongs to an ADDRESS: a different email address starts without it. */
  update public.outreach_contacts
     set email = v_email, email_valid = v_email is not null, phone = v_phone,
         contact_detail_origin = case when v_email is null and v_phone is null then null else p_origin end,
         consent_status = case when v_email is distinct from lower(coalesce(v_c.email, '')) and v_c.consent_status = 'CONSENTED'
                               then 'UNKNOWN' else v_c.consent_status end,
         consent_lawful_basis = case when v_email is distinct from lower(coalesce(v_c.email, '')) and v_c.consent_status = 'CONSENTED'
                                     then null else v_c.consent_lawful_basis end,
         updated_at = now()
   where id = v_c.id;
  return (select jsonb_build_object('email', c.email, 'phone', c.phone, 'origin', c.contact_detail_origin, 'consentStatus', c.consent_status)
            from public.outreach_contacts c where c.id = v_c.id);
end;
$function$;
revoke all on function public.my_outreach_contact_set_contact_details(uuid, text, text, text) from public, anon;
grant execute on function public.my_outreach_contact_set_contact_details(uuid, text, text, text) to authenticated;
