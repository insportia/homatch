-- ============================================================================
-- HOMATCH — App Content: the copy Site Studio cannot reach.
--
-- WHAT THIS IS FOR
--
-- Site Studio edits the marketing site, which is nine pages plus the shell.
-- Everything else a customer reads — the dashboard, Credits, the outreach
-- screens, every empty state, every confirmation, every error a person is
-- meant to act on — lives in src/i18n/translations.ts and can only be changed
-- by a deploy. That is 4,773 strings in six languages that the people who
-- know what they should say cannot touch.
--
-- This table is the override layer for exactly those strings. One row per
-- (key, locale), holding the words an admin wrote instead of the words that
-- shipped.
--
-- WHY AN ABSENT ROW IS THE HEALTHY STATE
--
-- The same argument Site Studio is built on. With no row, t() returns the
-- bundled string, reviewed in six languages, which is what the application
-- says today. With an unreachable database, the same. With a revoked grant,
-- the same. Nothing here can take copy AWAY from the product; it can only add
-- to it. That is the entire safety case, and it is why the runtime treats
-- "failed to load overrides" and "there are none" as one answer.
--
-- WHY READS ARE PUBLIC AND WRITES ARE NOT
--
-- The value of a row is a user-facing string that is already in the JavaScript
-- bundle every visitor downloads. There is nothing to protect by hiding it,
-- and a signed-out visitor reads the same marketing pages as everybody else.
-- Writing is a different act entirely: it changes what the product says to
-- every customer at once, so it goes through a SECURITY DEFINER function that
-- re-reads users.is_admin for the calling auth.uid() and writes an audit row.
-- ============================================================================

create table if not exists public.app_content (
  key         text not null,
  locale      text not null,
  value       text not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.users(id) on delete set null,
  primary key (key, locale),

  -- The six the application actually renders. A row in a seventh would be
  -- unreachable copy that nothing reads and nobody can find again.
  constraint app_content_locale_supported
    check (locale in ('en', 'ka', 'ru', 'tr', 'ar', 'he')),

  -- An override is a REPLACEMENT, never a deletion. Blank would render a
  -- heading with no words in it, and "I cleared the field" must mean "go back
  -- to what shipped" — which is what deleting the row does.
  constraint app_content_value_not_blank
    check (btrim(value) <> ''),

  -- A translation key, not a sentence. Bounded so a paste accident into the
  -- wrong field is refused rather than stored.
  constraint app_content_key_shape
    check (key ~ '^[a-z][a-z0-9_]{0,79}$')
);

comment on table public.app_content is
  'Admin overrides for bundled interface copy, one row per (key, locale). An absent row means the shipped string; nothing here can blank the product.';

alter table public.app_content enable row level security;

do $$
begin
  -- Readable by anyone, signed in or not: these strings are already in the
  -- bundle the browser downloads.
  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'app_content' and policyname = 'app_content_read') then
    create policy app_content_read on public.app_content
      for select to anon, authenticated using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'app_content' and policyname = 'app_content_service_all') then
    create policy app_content_service_all on public.app_content
      for all to service_role using (true) with check (true);
  end if;
end $$;

-- RLS decides which rows a caller sees; only a grant decides what they may
-- DO. Reading is granted. Writing is not granted at all, to anybody, so the
-- functions below are the only way in — a client cannot write a row even with
-- a crafted query, because the permission was never issued.
revoke all on public.app_content from anon, authenticated;
grant select (key, locale, value, updated_at) on public.app_content to anon, authenticated;
grant all on public.app_content to service_role;

create index if not exists app_content_locale_idx on public.app_content (locale);

-- ============================================================================
-- Writes
-- ============================================================================

-- ── Set one string, in one language. ───────────────────────────────────────
create or replace function public.app_content_set(
  p_key    text,
  p_locale text,
  p_value  text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid;
begin
  v_admin := public.site_admin_id();
  if v_admin is null and auth.role() <> 'service_role' then
    raise exception 'FORBIDDEN';
  end if;

  -- An empty value is the editor saying "put it back", which is a delete
  -- rather than a row with nothing in it. Handled here so the caller does not
  -- have to decide which of two functions an empty field means.
  if p_value is null or btrim(p_value) = '' then
    delete from public.app_content where key = p_key and locale = p_locale;

    insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
    values (
      coalesce(v_admin, '00000000-0000-0000-0000-000000000000'::uuid),
      'APP_CONTENT_CLEARED', 'app_content', p_key,
      jsonb_build_object('locale', p_locale)
    );

    return jsonb_build_object('key', p_key, 'locale', p_locale, 'cleared', true);
  end if;

  insert into public.app_content (key, locale, value, updated_by)
  values (p_key, p_locale, p_value, v_admin)
  on conflict (key, locale)
    do update set value = excluded.value,
                  updated_at = now(),
                  updated_by = excluded.updated_by;

  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  values (
    coalesce(v_admin, '00000000-0000-0000-0000-000000000000'::uuid),
    'APP_CONTENT_SET', 'app_content', p_key,
    jsonb_build_object('locale', p_locale, 'length', length(p_value))
  );

  return jsonb_build_object('key', p_key, 'locale', p_locale, 'cleared', false);
end $$;

comment on function public.app_content_set(text, text, text) is
  'Write or clear one interface string for one locale. Admin only; an empty value deletes the override so the shipped copy returns.';

-- ── Every override, for the editor. ────────────────────────────────────────
--
-- The public read above is enough for the RUNTIME, which wants values. The
-- editor also wants to know who changed what and when, which is not granted
-- to a browser, so it asks here.
create or replace function public.app_content_all()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid;
begin
  v_admin := public.site_admin_id();
  if v_admin is null and auth.role() <> 'service_role' then
    raise exception 'FORBIDDEN';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'key', c.key,
             'locale', c.locale,
             'value', c.value,
             'updated_at', c.updated_at,
             'updated_by', u.full_name
           ) order by c.key, c.locale)
      from public.app_content c
      left join public.users u on u.id = c.updated_by
  ), '[]'::jsonb);
end $$;

comment on function public.app_content_all() is
  'Every override with its authorship, for the App Content editor. Admin only.';

revoke all on function public.app_content_set(text, text, text) from public, anon;
revoke all on function public.app_content_all()                 from public, anon;
grant execute on function public.app_content_set(text, text, text) to authenticated, service_role;
grant execute on function public.app_content_all()                 to authenticated, service_role;
