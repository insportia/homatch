-- Find Property: a listing's contact number reaches a matched person only with the
-- owner's explicit consent.
--
-- WHAT WAS FOUND
--
-- reveal_native_contact gave the person looking (the demand side of a COMPATIBLE native
-- match, or of an interest/viewing relationship) the property's contact_phone_e164 with
-- no consent check. That number is REQUIRED to list a property (createProperty, and a
-- trigger behind it), so entering it was never a choice to be phoned by matched
-- strangers. Required is not public.
--
-- WHAT THIS DOES
--
--   properties.contact_phone_shareable  boolean, default false. The owner's explicit
--                                        choice, set on the listing forms.
--   reveal_native_contact               unchanged except the seeker branch: no consent
--                                        → NOT_SHARED (the same reason the owner branch
--                                        already uses), and no disclosure is recorded
--                                        because nothing was disclosed.
--
-- Private messaging is untouched: a matched person can always write. Existing listings
-- start not shared — production has recorded no seeker reveal (contact_disclosures is
-- empty), so no one loses a number they were relying on.

alter table public.properties
  add column if not exists contact_phone_shareable boolean not null default false;

comment on column public.properties.contact_phone_shareable is
  'Owner consent: matched HOMATCH members may see and call contact_phone_e164 (reveal_native_contact). Default false; the number is required to list, which is not consent to share it.';

-- The owner sets it (props_update_own decides which rows); INSERT already allows it.
grant update (contact_phone_shareable) on public.properties to authenticated;

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
  v_conversation uuid;
  v_shareable boolean;
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
    /* Required to list is not consent to be phoned: the number goes to a matched
       person only when the owner explicitly chose to share it. */
    select contact_phone_e164, contact_phone_shareable into v_phone, v_shareable
      from public.properties
     where id = v_property and is_deleted = false and archived_at is null;
    if v_phone is null then return jsonb_build_object('phone', null, 'reason', 'NO_NUMBER'); end if;
    if v_shareable is distinct from true then return jsonb_build_object('phone', null, 'reason', 'NOT_SHARED'); end if;
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

revoke all on function public.reveal_native_contact(text, uuid) from public, anon;
grant execute on function public.reveal_native_contact(text, uuid) to authenticated;
