-- Listing contact phone: published only when the advertiser chooses to.
--
-- THREE DIFFERENT PHONES (owner clarification on PR #335)
--
--   listing contact   properties.contact_phone_e164 — the number an owner or
--                     authorised advertiser enters for a sale/rent listing.
--                     Shown on that listing, with a Call action, ONLY once the
--                     advertiser has chosen to publish it (this migration).
--   account phone     users.phone — private. Never substituted for a listing
--                     number; shared in Matching only through the member's own
--                     separate opt-in (lead_contact_preferences, unchanged).
--   lead database     curated_leads.phone — third-party data. Not touched here.
--
-- WHAT CHANGES
--
-- reveal_native_contact used to hand a matched seeker the listing's number
-- unconditionally. It now does so only when contact_phone_public is true and
-- otherwise answers reason = 'NOT_PUBLISHED'. Every existing listing starts
-- with contact_phone_public = false: nothing was recorded as a publication
-- choice before, so nothing is treated as one. The owner-side branch (the
-- seeker's number only if they shared it in their conversation) is copied
-- verbatim from 20260928010000_native_intent_pipeline.sql.
--
-- Not touched: matching, scoring, billing, the trigger that requires a listing
-- contact, Publishing.

alter table public.properties
  add column if not exists contact_phone_public    boolean not null default false,
  add column if not exists contact_phone_public_at timestamptz;

comment on column public.properties.contact_phone_public is
  'The advertiser chose to show contact_phone_e164 on this listing to people who find it. Default false; set only through set_property_contact_publication().';
comment on column public.properties.contact_phone_public_at is
  'Server time of the latest publish choice (null while unpublished).';

-- authenticated holds table-wide INSERT on properties, so a new row could carry
-- contact_phone_public = true without a recorded choice. Every insert starts
-- unpublished; the choice is made through the function below.
create or replace function public.properties_contact_unpublished_on_insert()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  new.contact_phone_public := false;
  new.contact_phone_public_at := null;
  return new;
end;
$function$;
revoke all on function public.properties_contact_unpublished_on_insert() from public, anon, authenticated, service_role;
drop trigger if exists properties_contact_unpublished_on_insert on public.properties;
create trigger properties_contact_unpublished_on_insert
  before insert on public.properties
  for each row execute function public.properties_contact_unpublished_on_insert();

-- The owner's choice, recorded with server time. The column is not granted for
-- direct update (authenticated has no table-wide UPDATE on properties), so this
-- is the only way to change it.
create or replace function public.set_property_contact_publication(p_property_id uuid, p_public boolean)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_me uuid := public.current_homatch_user_id();
  v_done boolean;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if public.is_impersonated_session() then raise exception 'READ_ONLY_IMPERSONATION' using errcode = '42501'; end if;
  update public.properties
     set contact_phone_public = coalesce(p_public, false),
         contact_phone_public_at = case when coalesce(p_public, false) then now() else null end
   where id = p_property_id and user_id = v_me and is_deleted = false;
  v_done := found;
  if not v_done then raise exception 'not found' using errcode = '42501'; end if;
  return coalesce(p_public, false);
end;
$function$;

create or replace function public.reveal_native_contact(p_kind text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_supply uuid;
  v_demand uuid;
  v_property uuid;
  v_phone text;
  v_public boolean;
  v_conversation uuid;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;

  if p_kind = 'MATCH' then
    select supply_user_id, demand_user_id, property_id
      into v_supply, v_demand, v_property
      from public.supply_matches
     where id = p_id and source_kind = 'INTERNAL_HOMATCH' and compatibility = 'COMPATIBLE';
  elsif p_kind = 'RELATIONSHIP' then
    select supply_user_id, demand_user_id, property_id, conversation_id
      into v_supply, v_demand, v_property, v_conversation
      from public.native_property_relationships
     where id = p_id and state <> 'REJECTED';
  else
    raise exception 'unknown relationship kind' using errcode = '22023';
  end if;

  if v_supply is null or v_demand is null or v_me not in (v_supply, v_demand) then
    raise exception 'not found' using errcode = '42501';
  end if;

  if v_me = v_demand then
    /* The listing's own contact, and only once its advertiser chose to publish it.
       Never the owner's account phone. */
    select contact_phone_e164, contact_phone_public into v_phone, v_public
      from public.properties
     where id = v_property and is_deleted = false and archived_at is null;
    if v_phone is null then return jsonb_build_object('phone', null, 'reason', 'NO_NUMBER'); end if;
    if not coalesce(v_public, false) then return jsonb_build_object('phone', null, 'reason', 'NOT_PUBLISHED'); end if;
    insert into public.contact_disclosures (viewer_user_id, subject_user_id, property_id, relationship_kind, relationship_id)
    values (v_me, v_supply, v_property, p_kind, p_id);
    return jsonb_build_object('phone', v_phone, 'reason', null);
  end if;

  /* The owner asking for the other person's number: only what that person shared. */
  select s.phone into v_phone
    from public.conversation_contact_shares s
    join public.conversations c on c.id = s.conversation_id
   where s.sharer_id = v_demand
     and least(c.initiator_id, c.recipient_id) = least(v_supply, v_demand)
     and greatest(c.initiator_id, c.recipient_id) = greatest(v_supply, v_demand)
     and s.phone is not null
   order by s.created_at desc
   limit 1;
  if v_phone is null then return jsonb_build_object('phone', null, 'reason', 'NOT_SHARED'); end if;
  insert into public.contact_disclosures (viewer_user_id, subject_user_id, property_id, relationship_kind, relationship_id)
  values (v_me, v_demand, v_property, p_kind, p_id);
  return jsonb_build_object('phone', v_phone, 'reason', null);
end $$;

revoke all on function public.set_property_contact_publication(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_property_contact_publication(uuid, boolean) to authenticated, service_role;
revoke all on function public.reveal_native_contact(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.reveal_native_contact(text, uuid) to authenticated, service_role;
