-- HOMATCH Admin control centre, part 3 — an announcement's whole life.
--
-- publish_announcement(slug) already exists and is right: admin-only in SQL,
-- idempotent through the dedupe key 'announcement:<slug>'. What was missing is
-- everything around it — writing one, correcting one, taking one down — and
-- a record of who did each.
--
-- WHAT ARCHIVING MEANS
--
-- archived_at hides the announcement from customers (the read policy below
-- excludes it) and refuses a further publish. It does NOT delete notifications
-- already delivered: those rows are the customer's inbox, they carry the
-- English text they were sent with, and reaching into somebody's inbox to
-- remove a message they already read is a different product decision from
-- "stop showing this".
--
-- THE SLUG IS FROZEN ONCE PUBLISHED, because it is the dedupe key. Renaming a
-- published announcement would make the next publish tell everybody again.

alter table public.announcements add column if not exists archived_at timestamptz;

drop policy if exists announcements_select_published on public.announcements;
create policy announcements_select_published on public.announcements
  for select using (published_at is not null and published_at <= now() and archived_at is null);

/* Hygiene: the live grant list includes anon. The function refuses anon
   anyway (is_admin() is false), but a guard should not be the only door. */
revoke all on function public.publish_announcement(text) from public, anon;
grant execute on function public.publish_announcement(text) to authenticated;

-- ── helper: per-language text an operator typed ─────────────────────────
create or replace function public.homatch_locale_text(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  k text;
  v jsonb;
  out jsonb := '{}'::jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return null; end if;
  for k, v in select key, value from jsonb_each(p) loop
    continue when k not in ('en', 'ka', 'ru', 'tr', 'ar', 'he');
    continue when jsonb_typeof(v) <> 'string' or btrim(v #>> '{}') = '';
    out := out || jsonb_build_object(k, left(btrim(v #>> '{}'), 2000));
  end loop;
  return case when out = '{}'::jsonb then null else out end;
end $$;

revoke all on function public.homatch_locale_text(jsonb) from public, anon, authenticated;

-- ── list ────────────────────────────────────────────────────────────────
create or replace function public.admin_announcements_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id,
      'slug', a.slug,
      'title', a.title,
      'body', a.body,
      'deep_link', a.deep_link,
      'audience', a.audience,
      'published_at', a.published_at,
      'archived_at', a.archived_at,
      'created_at', a.created_at,
      'updated_at', a.updated_at,
      'created_by', public.homatch_user_brief(a.created_by),
      'delivered', (select count(*) from public.notifications n where n.dedupe_key = 'announcement:' || a.slug),
      'read', (select count(*) from public.notifications n where n.dedupe_key = 'announcement:' || a.slug and n.read))
      order by coalesce(a.published_at, a.created_at) desc)
      from public.announcements a), '[]'::jsonb);
end $$;

revoke all on function public.admin_announcements_list() from public, anon;
grant execute on function public.admin_announcements_list() to authenticated;

-- ── create / edit ───────────────────────────────────────────────────────
create or replace function public.admin_announcement_save(
  p_id uuid,
  p_slug text,
  p_title jsonb,
  p_body jsonb default null,
  p_deep_link text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_title jsonb := public.homatch_locale_text(p_title);
  v_body  jsonb := public.homatch_locale_text(p_body);
  v_slug  text := lower(btrim(coalesce(p_slug, '')));
  v_link  text := nullif(btrim(coalesce(p_deep_link, '')), '');
  v_me    uuid;
  a       public.announcements%rowtype;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = '42501';
  end if;

  if v_slug !~ '^[a-z0-9][a-z0-9-]{2,63}$' then
    raise exception 'INVALID_SLUG' using errcode = '22023';
  end if;
  if v_title is null or not (v_title ? 'en') then
    raise exception 'ENGLISH_TITLE_REQUIRED' using errcode = '22023';
  end if;
  if v_link is not null and v_link !~ '^/[^/]' then
    raise exception 'DEEP_LINK_MUST_BE_APP_PATH' using errcode = '22023';
  end if;

  select u.id into v_me from public.users u where u.auth_id = auth.uid();

  if p_id is null then
    insert into public.announcements (slug, title, body, deep_link, created_by)
    values (v_slug, v_title, v_body, v_link, v_me)
    returning * into a;

    insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'ANNOUNCEMENT_CREATED', 'announcement', a.id::text,
            jsonb_build_object('slug', a.slug, 'languages', (select jsonb_agg(k) from jsonb_object_keys(v_title) k)));
  else
    select * into a from public.announcements where id = p_id for update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    if a.published_at is not null and a.slug <> v_slug then
      raise exception 'SLUG_FROZEN_AFTER_PUBLISH' using errcode = '22023';
    end if;

    update public.announcements
       set slug = v_slug, title = v_title, body = v_body, deep_link = v_link
     where id = p_id
     returning * into a;

    insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'ANNOUNCEMENT_UPDATED', 'announcement', a.id::text,
            jsonb_build_object('slug', a.slug, 'published', a.published_at is not null,
                               'languages', (select jsonb_agg(k) from jsonb_object_keys(v_title) k)));
  end if;

  return to_jsonb(a);
end $$;

revoke all on function public.admin_announcement_save(uuid, text, jsonb, jsonb, text) from public, anon;
grant execute on function public.admin_announcement_save(uuid, text, jsonb, jsonb, text) to authenticated;

-- ── publish ─────────────────────────────────────────────────────────────
/*
 * The existing fan-out, with the record around it.
 *
 * Still idempotent: publish_announcement dedupes on the slug, so pressing
 * Publish twice (or publishing again after an edit) adds nobody a second
 * notification. `newly_delivered` reports what this call actually added, so
 * the operator sees "0 new" rather than a misleading "sent to everybody".
 */
create or replace function public.admin_announcement_publish(p_slug text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  a        public.announcements%rowtype;
  v_before bigint;
  v_after  bigint;
  v_users  integer;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = '42501';
  end if;

  select * into a from public.announcements where slug = p_slug;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if a.archived_at is not null then
    raise exception 'ARCHIVED' using errcode = '22023';
  end if;

  select count(*) into v_before from public.notifications where dedupe_key = 'announcement:' || a.slug;
  v_users := public.publish_announcement(a.slug);
  select count(*) into v_after from public.notifications where dedupe_key = 'announcement:' || a.slug;

  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'ANNOUNCEMENT_PUBLISHED', 'announcement', a.id::text,
          jsonb_build_object('slug', a.slug, 'first_publish', a.published_at is null,
                             'accounts', v_users, 'newly_delivered', v_after - v_before));

  return jsonb_build_object('accounts', v_users, 'newly_delivered', v_after - v_before,
                            'already_delivered', v_before);
end $$;

revoke all on function public.admin_announcement_publish(text) from public, anon;
grant execute on function public.admin_announcement_publish(text) to authenticated;

-- ── archive / restore ───────────────────────────────────────────────────
create or replace function public.admin_announcement_set_archived(p_slug text, p_archived boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  a public.announcements%rowtype;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = '42501';
  end if;

  update public.announcements
     set archived_at = case when p_archived then coalesce(archived_at, now()) else null end
   where slug = p_slug
   returning * into a;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), case when p_archived then 'ANNOUNCEMENT_ARCHIVED' else 'ANNOUNCEMENT_RESTORED' end,
          'announcement', a.id::text, jsonb_build_object('slug', a.slug));

  return to_jsonb(a);
end $$;

revoke all on function public.admin_announcement_set_archived(text, boolean) from public, anon;
grant execute on function public.admin_announcement_set_archived(text, boolean) to authenticated;
