-- Homatch — where a platform announcement comes from.
--
-- Separate from the migration that adds the ANNOUNCEMENT enum value, because
-- Postgres will not let a transaction use an enum value the same transaction
-- added. Two migrations, two transactions, and the fan-out below can name it.
--
-- WHAT THIS IS NOT
--
-- Not a CMS. There is no scheduling engine, no draft workflow, no audience
-- builder, no template language. An announcement is a title, a body, a
-- destination and a moment it became visible — and the one product decision
-- that matters is that it is ADMIN-AUTHORED and CANNOT BE PUBLISHED BY A
-- CUSTOMER, which is a row-level policy rather than a screen that hides a
-- button.
--
-- WHY THE TEXT IS JSONB
--
-- Transactional notifications carry a stable `type` and a `metadata.kind`, and
-- the interface renders them from translation keys — so the same row reads
-- correctly to a Georgian and an Arabic customer, and a notification written
-- in 2026 still renders in whatever language somebody picks in 2027.
--
-- An announcement cannot work that way: its text is written by a person, at
-- publish time, and there is no key for "we added mortgage pre-approval". So
-- the row carries the text itself, once per language — `{"en": "...",
-- "ka": "..."}` — and the interface picks the reader's language with English
-- as the fallback. Storing one string would freeze every future reader into
-- whichever language the operator happened to be using.
--
-- WHY THE DESTINATION IS A PATH
--
-- `deep_link` is checked to be an app path and never an absolute URL. A
-- notification is something the platform told you; following it to a host
-- somebody typed into an admin form is an open redirect out of exactly the
-- place a reader has the most reason to trust.

create table if not exists public.announcements (
  id           uuid primary key default gen_random_uuid(),
  /*
   * The stable name of the ANNOUNCEMENT, not of the row. It is the dedupe key
   * for the fan-out, so publishing twice — an operator double-click, a retried
   * job — tells each customer once.
   */
  slug         text not null unique
                 check (slug ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
  /* { "en": "...", "ka": "...", ... }. English is required; the rest are
     whatever the operator wrote. */
  title        jsonb not null
                 check (jsonb_typeof(title) = 'object' and title ? 'en'),
  body         jsonb
                 check (body is null or jsonb_typeof(body) = 'object'),
  /* An app path. Never an absolute URL — see the note above. */
  deep_link    text
                 check (deep_link is null or deep_link ~ '^/[^/]'),
  /*
   * Who it is for. ALL is every Homatch account. The column exists so the
   * fan-out has something to read; more audiences belong here only when there
   * is a real product reason and a real way to resolve them.
   */
  audience     text not null default 'ALL'
                 check (audience in ('ALL')),
  published_at timestamptz,
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.announcements is
  'Admin-authored platform news. One row per announcement; the text is stored per language because it is written by a person rather than keyed like a transactional notification.';

create index if not exists announcements_published_at_idx
  on public.announcements (published_at desc nulls last);

alter table public.announcements enable row level security;

/*
 * A CUSTOMER MAY READ A PUBLISHED ANNOUNCEMENT AND NOTHING ELSE.
 *
 * Reading matters because a notification deep-links to the announcement, and a
 * destination that 404s for the person who was told about it is a dead route.
 * An unpublished draft is not readable by anybody but an admin.
 */
drop policy if exists announcements_select_published on public.announcements;
create policy announcements_select_published on public.announcements
  for select using (published_at is not null and published_at <= now());

drop policy if exists announcements_admin_all on public.announcements;
create policy announcements_admin_all on public.announcements
  for all using (is_admin()) with check (is_admin());

drop trigger if exists trg_announcements_updated_at on public.announcements;
create trigger trg_announcements_updated_at
  before update on public.announcements
  for each row execute function public.update_updated_at();

-- ── the fan-out ──────────────────────────────────────────────────────────
--
-- One notification per account, through the canonical emitter, so an
-- announcement goes through the same dedupe, the same preferences and the same
-- push path as everything else. `dedupe_key` is the announcement's slug: a
-- second publish of the same announcement — a retry, a double-click, an
-- operator re-publishing after an edit — adds nobody a second row.
--
-- The stored title and body are the ENGLISH ones. Everything that renders a
-- notification reads `metadata` first, and metadata carries the announcement
-- id so the interface can fetch the row and show the reader's own language;
-- the stored text is the write-time fallback the rest of the system already
-- uses for push payloads and for clients that have not been updated.
create or replace function public.publish_announcement(p_slug text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  a       public.announcements%rowtype;
  u       record;
  sent    integer := 0;
begin
  if not is_admin() then
    raise exception 'only an administrator may publish an announcement'
      using errcode = '42501';
  end if;

  select * into a from public.announcements where slug = p_slug;
  if not found then
    raise exception 'no announcement named %', p_slug using errcode = 'HM003';
  end if;

  /* Publishing is what makes it visible AND what tells people. Doing one
     without the other is how an announcement exists that nobody hears, or a
     notification points at a draft nobody may read. */
  if a.published_at is null then
    update public.announcements set published_at = now() where id = a.id
      returning * into a;
  end if;

  for u in select id from public.users loop
    perform public.notify_emit(
      u.id,
      'ANNOUNCEMENT'::public.notification_type,
      coalesce(a.title ->> 'en', p_slug),
      a.body ->> 'en',
      'LOW',
      coalesce(a.deep_link, '/notifications'),
      'announcement',
      a.id,
      /* The announcement, not the delivery. Idempotent across retries. */
      'announcement:' || a.slug,
      /* Explicitly typed: a bare null leaves the interval and the template
         parameters ambiguous if a second overload ever appears. */
      null::text, null::interval, null::text,
      jsonb_build_object('kind', 'ANNOUNCEMENT', 'announcement_id', a.id, 'slug', a.slug)
    );
    sent := sent + 1;
  end loop;

  return sent;
end $$;

comment on function public.publish_announcement(text) is
  'Publishes an announcement and tells every account once. Idempotent: the dedupe key is the slug, so a retry or a second publish adds nobody a second notification.';

revoke all on function public.publish_announcement(text) from public;
grant execute on function public.publish_announcement(text) to authenticated;
