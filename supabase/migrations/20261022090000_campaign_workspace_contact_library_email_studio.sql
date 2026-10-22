-- CAMPAIGN WORKSPACE, CONTACT LIBRARY, EMAIL STUDIO.
--
-- 1. An external (Find Buyers / Find Tenants) search becomes addressable by
--    its run id (matching_jobs.id) so it can have its own page that survives a
--    refresh. find_buyers_job_state stays service_role-only; the owner reaches
--    one run through find_buyers_my_campaign, which checks property ownership
--    first, and their runs through find_buyers_my_campaigns (history).
-- 2. my_contact_library: every contact the caller can ALREADY read, in one
--    list, with provenance. SECURITY INVOKER, so each branch is still bounded
--    by that table's own RLS -- the function grants nothing new:
--      UNLOCKED_MATCH    match_unlocks (paid/included unlocks; links only)
--      CAMPAIGN_LEAD     find_buyers_leads with a public author profile (the
--                        owner's own results page already shows these)
--      OUTREACH_CONTACT  outreach_contacts the owner imported or added (the
--                        only kind that carries an email address)
-- 3. email_studio_documents: drafts and reusable templates of the visual
--    email editor, owner-only.
-- 4. email_studio_prepare_audience: copies the chosen, still-eligible
--    outreach contacts into a fresh list for one send. An address that is
--    unsubscribed, suppressed or do-not-contact on ANY of the owner's rows is
--    excluded, so a stale copy can never resurrect an opt-out.
-- 5. An opt-out belongs to the ADDRESS, not to one row: unsubscribing,
--    suppression and do-not-contact on any of an owner's rows for an email
--    apply to every row of that owner with the same email, now and for rows
--    added later (an import or an Email Studio copy cannot resurrect it).
-- Additive: no existing function or policy is altered; the trigger and the
-- one-time alignment only ever turn opt-out flags ON, never off.

------------------------------------------------------------------------------
-- 1. One run, and the list of runs, for their owner.
------------------------------------------------------------------------------
create or replace function public.find_buyers_my_campaign(p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_property uuid;
begin
  select j.property_id into v_property
    from public.matching_jobs j
    join public.properties p on p.id = j.property_id
   where j.id = p_job_id
     and coalesce(p.is_deleted, false) = false
     and (p.user_id = public.auth_user_id() or public.is_admin());
  if v_property is null then
    raise exception 'NOT_FOUND';
  end if;
  return jsonb_build_object(
    'propertyId', v_property,
    'readiness', public.find_buyers_readiness(),
    'campaign', public.find_buyers_job_state(p_job_id));
end;
$function$;
revoke all on function public.find_buyers_my_campaign(uuid) from public, anon;
grant execute on function public.find_buyers_my_campaign(uuid) to authenticated, service_role;

create or replace function public.find_buyers_my_campaigns(
  p_property_id uuid default null,
  p_limit integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_user uuid := public.auth_user_id();
  v_rows jsonb;
begin
  if v_user is null then
    raise exception 'FORBIDDEN';
  end if;
  select coalesce(jsonb_agg(r order by (r->>'createdAt') desc), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'jobId', j.id,
      'propertyId', j.property_id,
      'propertyTitle', p.title,
      'transaction', p.transaction_type,
      'createdAt', j.created_at,
      'completedAt', j.completed_at,
      'creditsCommitted', fc.credits_committed,
      'languages', coalesce(fc.languages, j.search_languages),
      'state', st.s->>'state',
      'active', coalesce((st.s->>'active')::boolean, false),
      'results', coalesce((st.s->>'newResults')::int, 0)
    ) as r
    from (
      select j.*
        from public.matching_jobs j
        join public.properties p on p.id = j.property_id
       where p.user_id = v_user
         and coalesce(p.is_deleted, false) = false
         and (p_property_id is null or j.property_id = p_property_id)
       order by j.created_at desc
       limit greatest(1, least(coalesce(p_limit, 30), 100))
    ) j
    join public.properties p on p.id = j.property_id
    left join public.find_buyers_campaigns fc on fc.matching_job_id = j.id
    -- offset 0 fences the planner: one job-state read per row, not one per field.
    cross join lateral (select public.find_buyers_job_state(j.id) as s offset 0) st
  ) s;
  return v_rows;
end;
$function$;
revoke all on function public.find_buyers_my_campaigns(uuid, integer) from public, anon;
grant execute on function public.find_buyers_my_campaigns(uuid, integer) to authenticated, service_role;

------------------------------------------------------------------------------
-- 2. The contact library.
------------------------------------------------------------------------------
create or replace function public.my_contact_library()
returns table (
  contact_key text,
  kind text,
  display_name text,
  email text,
  phone text,
  profile_url text,
  source_url text,
  source text,
  language text,
  property_id uuid,
  property_title text,
  campaign_job_id uuid,
  acquired_at timestamptz,
  email_sendable boolean,
  outreach_contact_id uuid
)
language sql
stable
security invoker
set search_path to ''
as $function$
  select 'unlock:' || mu.id::text, 'UNLOCKED_MATCH',
         nullif(mu.full_intent_json->>'author_name', ''),
         null::text, null::text,
         mu.full_profile_url, mu.full_source_url,
         m.preview_platform::text, m.preview_language::text,
         m.property_id, p.title, m.job_id, mu.created_at,
         false, null::uuid
    from public.match_unlocks mu
    -- left join: a contact somebody paid to open stays in their library even if
    -- the match row is no longer visible to them (e.g. the property changed hands).
    left join public.matches m on m.id = mu.match_id
    left join public.properties p on p.id = m.property_id
   where mu.user_id = public.auth_user_id()
  union all
  select * from (
    select distinct on (l.person_id)
           'lead:' || l.person_id::text, 'CAMPAIGN_LEAD',
           l.author_name, null::text, null::text,
           l.author_profile_url, null::text,
           l.source, l.language,
           l.property_id, p.title, l.matching_job_id, l.created_at,
           false, null::uuid
      from public.find_buyers_current_leads l
      left join public.properties p on p.id = l.property_id
     where l.user_id = public.auth_user_id()
       and l.author_profile_url is not null
     order by l.person_id, l.created_at desc
  ) leads
  union all
  select * from (
    select distinct on (coalesce(lower(c.email), c.id::text))
           'contact:' || c.id::text, 'OUTREACH_CONTACT',
           c.full_name, c.email, c.phone,
           null::text, null::text,
           'IMPORT', c.language,
           null::uuid, null::text, null::uuid, c.created_at,
           (c.email is not null
             and coalesce(c.email_valid, true)
             and not exists (
               select 1 from public.outreach_contacts x
                where x.owner_id = (select auth.uid())
                  and lower(x.email) = lower(c.email)
                  and (coalesce(x.unsubscribed, false) or coalesce(x.suppressed, false)
                       or coalesce(x.do_not_contact, false)))),
           c.id
      from public.outreach_contacts c
     where c.owner_id = (select auth.uid())
       and coalesce(c.is_duplicate, false) = false
     order by coalesce(lower(c.email), c.id::text), c.created_at desc
  ) imported;
$function$;
revoke all on function public.my_contact_library() from public, anon;
grant execute on function public.my_contact_library() to authenticated, service_role;

------------------------------------------------------------------------------
-- 3. Email Studio documents (drafts and templates).
------------------------------------------------------------------------------
create table if not exists public.email_studio_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  kind text not null default 'DRAFT' check (kind in ('DRAFT', 'TEMPLATE')),
  name text not null default '' check (char_length(name) <= 200),
  subject text not null default '' check (char_length(subject) <= 300),
  preheader text not null default '' check (char_length(preheader) <= 300),
  language text not null default 'en',
  property_id uuid references public.properties(id) on delete set null,
  design jsonb not null default '{}'::jsonb check (pg_column_size(design) <= 524288),
  recipients jsonb not null default '[]'::jsonb check (pg_column_size(recipients) <= 131072),
  outreach_campaign_id uuid references public.outreach_campaigns(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_email_studio_documents_owner
  on public.email_studio_documents (owner_id, kind, updated_at desc);

alter table public.email_studio_documents enable row level security;
drop policy if exists email_studio_documents_owner on public.email_studio_documents;
create policy email_studio_documents_owner on public.email_studio_documents
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
revoke all on public.email_studio_documents from public, anon;
grant select, insert, update, delete on public.email_studio_documents to authenticated;
grant all on public.email_studio_documents to service_role;

------------------------------------------------------------------------------
-- 4. One send's audience, from the owner's own eligible contacts.
------------------------------------------------------------------------------
create or replace function public.email_studio_prepare_audience(
  p_contact_ids uuid[],
  p_list_name text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path to ''
as $function$
declare
  v_owner uuid := (select auth.uid());
  v_list uuid;
  v_added integer;
  v_requested integer := coalesce(array_length(p_contact_ids, 1), 0);
begin
  if v_owner is null then
    raise exception 'FORBIDDEN';
  end if;
  if v_requested = 0 or v_requested > 500 then
    raise exception 'INVALID_AUDIENCE_SIZE';
  end if;

  /* Nobody eligible: say so, and leave no empty list behind. */
  if not exists (
    select 1 from public.outreach_contacts c
     where c.owner_id = v_owner and c.id = any (p_contact_ids) and c.email is not null and coalesce(c.email_valid, true)
       and not exists (
         select 1 from public.outreach_contacts x
          where x.owner_id = v_owner and lower(x.email) = lower(c.email)
            and (coalesce(x.unsubscribed, false) or coalesce(x.suppressed, false) or coalesce(x.do_not_contact, false)))
  ) then
    return jsonb_build_object('listId', null, 'eligible', 0, 'excluded', v_requested);
  end if;

  insert into public.outreach_contact_lists (owner_id, name, source_format, import_status, description)
  values (v_owner, left(coalesce(nullif(trim(p_list_name), ''), 'Email Studio'), 200), 'EMAIL_STUDIO', 'READY',
          'Recipients chosen in Email Studio')
  returning id into v_list;

  -- An EMAIL audience: the phone number is deliberately not copied, so this
  -- list can never become a call or WhatsApp audience that lost those opt-outs.
  insert into public.outreach_contacts (
    list_id, owner_id, email, full_name, language, consent_status, consent_source,
    is_duplicate, do_not_contact, unsubscribed, suppressed)
  select distinct on (lower(c.email))
         v_list, v_owner, c.email, c.full_name, c.language, c.consent_status,
         coalesce(c.consent_source, 'EMAIL_STUDIO_COPY'),
         false, false, false, false
    from public.outreach_contacts c
   where c.owner_id = v_owner
     and c.id = any (p_contact_ids)
     and c.email is not null
     and coalesce(c.email_valid, true)
     and not exists (
       select 1 from public.outreach_contacts x
        where x.owner_id = v_owner
          and lower(x.email) = lower(c.email)
          and (coalesce(x.unsubscribed, false) or coalesce(x.suppressed, false)
               or coalesce(x.do_not_contact, false)))
   order by lower(c.email), c.created_at desc;
  get diagnostics v_added = row_count;

  update public.outreach_contact_lists
     set total_rows = v_added, valid_rows = v_added, updated_at = now()
   where id = v_list;

  return jsonb_build_object('listId', v_list, 'eligible', v_added, 'excluded', v_requested - v_added);
end;
$function$;
revoke all on function public.email_studio_prepare_audience(uuid[], text) from public, anon;
grant execute on function public.email_studio_prepare_audience(uuid[], text) to authenticated, service_role;

------------------------------------------------------------------------------
-- 5. Opt-outs follow the address across the owner's rows.
------------------------------------------------------------------------------
create or replace function public.outreach_contacts_share_email_optout()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.email is null or new.owner_id is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    /* A new row for an address this owner was told to stop emailing starts opted out. */
    select coalesce(bool_or(coalesce(x.unsubscribed, false)), false) or coalesce(new.unsubscribed, false),
           coalesce(bool_or(coalesce(x.suppressed, false)), false) or coalesce(new.suppressed, false),
           coalesce(bool_or(coalesce(x.do_not_contact, false)), false) or coalesce(new.do_not_contact, false)
      into new.unsubscribed, new.suppressed, new.do_not_contact
      from public.outreach_contacts x
     where x.owner_id = new.owner_id and lower(x.email) = lower(new.email);
    return new;
  end if;
  /* UPDATE: a flag that just turned on spreads to the address's other rows (one level deep). */
  if pg_trigger_depth() = 1 and (
       (coalesce(new.unsubscribed, false) and not coalesce(old.unsubscribed, false))
    or (coalesce(new.suppressed, false) and not coalesce(old.suppressed, false))
    or (coalesce(new.do_not_contact, false) and not coalesce(old.do_not_contact, false))) then
    update public.outreach_contacts x
       set unsubscribed = coalesce(x.unsubscribed, false) or coalesce(new.unsubscribed, false),
           unsubscribed_at = case when coalesce(new.unsubscribed, false) and not coalesce(x.unsubscribed, false)
                                  then coalesce(new.unsubscribed_at, now()) else x.unsubscribed_at end,
           suppressed = coalesce(x.suppressed, false) or coalesce(new.suppressed, false),
           do_not_contact = coalesce(x.do_not_contact, false) or coalesce(new.do_not_contact, false),
           updated_at = now()
     where x.owner_id = new.owner_id
       and lower(x.email) = lower(new.email)
       and x.id <> new.id
       and ((coalesce(new.unsubscribed, false) and not coalesce(x.unsubscribed, false))
         or (coalesce(new.suppressed, false) and not coalesce(x.suppressed, false))
         or (coalesce(new.do_not_contact, false) and not coalesce(x.do_not_contact, false)));
  end if;
  return new;
end;
$function$;
revoke all on function public.outreach_contacts_share_email_optout() from public, anon, authenticated;

drop trigger if exists trg_outreach_contacts_optout_insert on public.outreach_contacts;
create trigger trg_outreach_contacts_optout_insert
  before insert on public.outreach_contacts
  for each row execute function public.outreach_contacts_share_email_optout();

drop trigger if exists trg_outreach_contacts_optout_update on public.outreach_contacts;
create trigger trg_outreach_contacts_optout_update
  after update of unsubscribed, suppressed, do_not_contact on public.outreach_contacts
  for each row execute function public.outreach_contacts_share_email_optout();

-- Addresses ALREADY opted out on one row are aligned once, so the rule holds for
-- existing data too. Flags are only ever turned on. The trigger fires per row
-- here and is bounded by pg_trigger_depth().
update public.outreach_contacts c
   set unsubscribed = true, unsubscribed_at = coalesce(c.unsubscribed_at, now()), updated_at = now()
 where c.email is not null and not coalesce(c.unsubscribed, false)
   and exists (select 1 from public.outreach_contacts x
                where x.owner_id = c.owner_id and lower(x.email) = lower(c.email) and coalesce(x.unsubscribed, false));
update public.outreach_contacts c
   set suppressed = true, updated_at = now()
 where c.email is not null and not coalesce(c.suppressed, false)
   and exists (select 1 from public.outreach_contacts x
                where x.owner_id = c.owner_id and lower(x.email) = lower(c.email) and coalesce(x.suppressed, false));
update public.outreach_contacts c
   set do_not_contact = true, updated_at = now()
 where c.email is not null and not coalesce(c.do_not_contact, false)
   and exists (select 1 from public.outreach_contacts x
                where x.owner_id = c.owner_id and lower(x.email) = lower(c.email) and coalesce(x.do_not_contact, false));
