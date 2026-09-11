-- Homatch — Site Studio: structured, versioned content for the public pages.
--
-- WHAT THE AUDIT FOUND, BEFORE ANY OF THIS WAS WRITTEN
--
--   admin_settings      a jsonb key/value store with an audited upsert RPC.
--                       Right shape for a knob, wrong shape for page content:
--                       no version history, no per-page row, no draft column.
--   sponsored_placements the closest existing content table (slot + market +
--                       language + enabled + sort_order). Structurally 80% of
--                       what a section needs, but its semantics are paid
--                       placement, so it is copied as a MODEL, not extended.
--   admin_audit_log     already exists and already records admin actions.
--                       Reused verbatim below; no second audit table.
--   is_admin()          already the project's admin predicate. Reused.
--   auth_user_id()      already maps auth.uid() to public.users.id. Reused.
--   storage             four buckets, every one PRIVATE. Website imagery has
--                       to be readable by anonymous visitors, so this adds the
--                       first public bucket rather than bending a private one.
--
-- Nothing here duplicates infrastructure that already existed.
--
-- WHAT THIS DOES
--
--   site_pages           one row per public page, holding a DRAFT document and
--                        the PUBLISHED document side by side.
--   site_page_versions   an immutable snapshot per publish. Never updated,
--                        never deleted; restoring reads one and writes a new
--                        draft, so history only ever grows.
--
-- ACCESS MODEL
--
--   anonymous / signed-in visitor
--       may SELECT only (id, slug, title, published, published_version,
--       published_at) and only for rows that have actually been published.
--       The `draft` column is not granted to them at all, so an unpublished
--       edit is unreadable even by a caller who writes their own query. RLS
--       alone could not do this: a policy filters rows, not columns.
--
--   admin
--       reads drafts and writes through the SECURITY DEFINER functions at the
--       bottom of this file. `authenticated` gets no INSERT, UPDATE or DELETE
--       on either table, so there is no path to a write that skips the admin
--       check and the audit row.
--
--   service_role
--       full access, as everywhere else in this schema.
--
-- Every function re-checks `users.is_admin` itself rather than trusting the
-- caller, and raises FORBIDDEN otherwise. A client-side role value is never
-- consulted.

-- ============================================================================
-- Tables
-- ============================================================================

create table if not exists public.site_pages (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  title             text not null default '',
  -- The document being edited. Never visible to a non-admin.
  draft             jsonb not null default '{"schema":1,"sections":[],"seo":{}}'::jsonb,
  -- The document the public site reads. NULL until the first publish, which
  -- is what makes the code-defined fallback the floor rather than a blank page.
  published         jsonb,
  published_version integer,
  published_at      timestamptz,
  published_by      uuid references public.users(id) on delete set null,
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.users(id) on delete set null,
  created_at        timestamptz not null default now()
);

comment on table public.site_pages is
  'Site Studio: one row per public page. draft is admin-only; published is world-readable.';

create table if not exists public.site_page_versions (
  id            uuid primary key default gen_random_uuid(),
  page_id       uuid not null references public.site_pages(id) on delete cascade,
  version       integer not null,
  content       jsonb not null,
  note          text,
  published_at  timestamptz not null default now(),
  published_by  uuid references public.users(id) on delete set null,
  unique (page_id, version)
);

comment on table public.site_page_versions is
  'Site Studio: immutable publish snapshots. Insert-only by design; a restore writes a new draft rather than editing or deleting a snapshot.';

create index if not exists site_page_versions_page_idx
  on public.site_page_versions (page_id, version desc);

-- ============================================================================
-- Row level security
-- ============================================================================

alter table public.site_pages enable row level security;
alter table public.site_pages force row level security;
alter table public.site_page_versions enable row level security;
alter table public.site_page_versions force row level security;

do $$
begin
  -- Published rows are readable by anyone. Combined with the column grants
  -- below, "readable" means the published document and nothing else.
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and policyname = 'site_pages_read_published') then
    create policy site_pages_read_published on public.site_pages
      for select to anon, authenticated
      using (published is not null);
  end if;

  -- An admin sees every row, including pages that have never been published.
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and policyname = 'site_pages_admin_read') then
    create policy site_pages_admin_read on public.site_pages
      for select to authenticated
      using (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and policyname = 'site_pages_service_all') then
    create policy site_pages_service_all on public.site_pages
      for all to service_role using (true) with check (true);
  end if;

  -- Version history: admins read it, nobody else needs it, and the public
  -- site never does.
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and policyname = 'site_versions_admin_read') then
    create policy site_versions_admin_read on public.site_page_versions
      for select to authenticated
      using (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and policyname = 'site_versions_service_all') then
    create policy site_versions_service_all on public.site_page_versions
      for all to service_role using (true) with check (true);
  end if;
end $$;

-- ============================================================================
-- Column privileges
--
-- RLS decides which ROWS a caller sees. Only a column grant decides which
-- COLUMNS. The draft document is withheld here, which is the actual mechanism
-- behind "draft changes remain private" — a policy could not have done it.
-- ============================================================================

revoke all on public.site_pages from anon, authenticated;
revoke all on public.site_page_versions from anon, authenticated;

grant select (id, slug, title, published, published_version, published_at)
  on public.site_pages to anon, authenticated;

-- Admins read drafts through site_get_page(), a definer function, so even the
-- admin role needs no direct grant on the draft column.
grant select on public.site_page_versions to authenticated;

grant all on public.site_pages to service_role;
grant all on public.site_page_versions to service_role;

-- ============================================================================
-- Storage: the first public bucket in this project
--
-- Website imagery is fetched by anonymous visitors from an <img> tag, so a
-- signed URL is not an option the way it is for a private document. The bucket
-- is public for READ and writable only by admins, and the MIME allowlist is
-- image-only rather than reusing the document allowlist from uploadValidation.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-assets', 'site-assets', true, 5242880,
  array['image/jpeg','image/jpg','image/png','image/webp','image/avif','image/svg+xml']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'storage' and policyname = 'site_assets_public_read') then
    create policy site_assets_public_read on storage.objects
      for select to anon, authenticated
      using (bucket_id = 'site-assets');
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname = 'storage' and policyname = 'site_assets_admin_write') then
    create policy site_assets_admin_write on storage.objects
      for insert to authenticated
      with check (bucket_id = 'site-assets' and public.is_admin());
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname = 'storage' and policyname = 'site_assets_admin_update') then
    create policy site_assets_admin_update on storage.objects
      for update to authenticated
      using (bucket_id = 'site-assets' and public.is_admin())
      with check (bucket_id = 'site-assets' and public.is_admin());
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname = 'storage' and policyname = 'site_assets_admin_delete') then
    create policy site_assets_admin_delete on storage.objects
      for delete to authenticated
      using (bucket_id = 'site-assets' and public.is_admin());
  end if;
end $$;

-- ============================================================================
-- Writes
--
-- All four are SECURITY DEFINER, all four re-read users.is_admin for the
-- calling auth.uid(), and all four write an admin_audit_log row. There is no
-- other way to change site content.
-- ============================================================================

create or replace function public.site_admin_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id from public.users u where u.auth_id = auth.uid() and u.is_admin = true;
$$;

comment on function public.site_admin_id() is
  'The public.users.id of the calling admin, or NULL. Never trusts a client-supplied role.';

-- ── Read a page, drafts included. Admin only. ───────────────────────────────
create or replace function public.site_get_page(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid;
  v_row   public.site_pages%rowtype;
begin
  v_admin := public.site_admin_id();
  if v_admin is null and auth.role() <> 'service_role' then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_row from public.site_pages where slug = p_slug;
  if not found then
    -- Not an error. A page that has never been edited simply has no row, and
    -- the editor starts from the code-defined default.
    return null;
  end if;

  -- Keys are snake_case to match the column names, and the version history
  -- rides along in the same call: the editor needs the draft, the published
  -- document and the list of snapshots together, and three round trips could
  -- interleave with somebody else's publish and show a mismatched set.
  return jsonb_build_object(
    'slug', v_row.slug,
    'title', v_row.title,
    'draft', v_row.draft,
    'published', v_row.published,
    'published_version', v_row.published_version,
    'published_at', v_row.published_at,
    'updated_at', v_row.updated_at,
    'versions', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'version', v.version,
                 'content', v.content,
                 'note', v.note,
                 'published_at', v.published_at,
                 'published_by', v.published_by
               )
               order by v.version desc
             )
        from public.site_page_versions v
       where v.page_id = v_row.id
    ), '[]'::jsonb)
  );
end $$;

-- ── Save a draft. Never touches the published document. ─────────────────────
create or replace function public.site_save_draft(
  p_slug    text,
  p_content jsonb,
  p_title   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid;
  v_id    uuid;
begin
  if p_slug is null or p_content is null then
    raise exception 'INVALID_ARGUMENT';
  end if;
  if jsonb_typeof(p_content) <> 'object' or (p_content->>'schema') is distinct from '1' then
    raise exception 'INVALID_CONTENT';
  end if;

  v_admin := public.site_admin_id();
  if v_admin is null and auth.role() <> 'service_role' then
    raise exception 'FORBIDDEN';
  end if;

  insert into public.site_pages (slug, title, draft, updated_at, updated_by)
  values (p_slug, coalesce(p_title, p_slug), p_content, now(), v_admin)
  on conflict (slug) do update
    set draft      = excluded.draft,
        title      = coalesce(p_title, public.site_pages.title),
        updated_at = now(),
        updated_by = v_admin
  returning id into v_id;

  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  values (
    coalesce(v_admin, '00000000-0000-0000-0000-000000000000'::uuid),
    'SITE_DRAFT_SAVED', 'site_pages', p_slug,
    jsonb_build_object('sections', jsonb_array_length(coalesce(p_content->'sections', '[]'::jsonb)))
  );

  return jsonb_build_object('id', v_id, 'slug', p_slug);
end $$;

-- ── Publish. One statement block, so it is all or nothing. ──────────────────
create or replace function public.site_publish(p_slug text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin   uuid;
  v_row     public.site_pages%rowtype;
  v_version integer;
begin
  v_admin := public.site_admin_id();
  if v_admin is null and auth.role() <> 'service_role' then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_row from public.site_pages where slug = p_slug for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  v_version := coalesce(v_row.published_version, 0) + 1;

  -- The snapshot is written BEFORE the page flips, so a failure here cannot
  -- leave a published document with no recoverable history behind it.
  insert into public.site_page_versions (page_id, version, content, note, published_by)
  values (v_row.id, v_version, v_row.draft, p_note, v_admin);

  update public.site_pages
     set published         = v_row.draft,
         published_version = v_version,
         published_at      = now(),
         published_by      = v_admin,
         updated_at        = now(),
         updated_by        = v_admin
   where id = v_row.id;

  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  values (
    coalesce(v_admin, '00000000-0000-0000-0000-000000000000'::uuid),
    'SITE_PUBLISHED', 'site_pages', p_slug,
    jsonb_build_object('version', v_version, 'note', p_note)
  );

  -- The bare version number: the caller names it to the admin and stores it.
  return to_jsonb(v_version);
end $$;

-- ── Restore. Writes a DRAFT, deletes nothing. ───────────────────────────────
create or replace function public.site_restore_version(p_slug text, p_version integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin   uuid;
  v_page    public.site_pages%rowtype;
  v_content jsonb;
begin
  v_admin := public.site_admin_id();
  if v_admin is null and auth.role() <> 'service_role' then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_page from public.site_pages where slug = p_slug;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  select content into v_content
    from public.site_page_versions
   where page_id = v_page.id and version = p_version;
  if v_content is null then
    raise exception 'VERSION_NOT_FOUND';
  end if;

  -- Restoring loads the old document into the DRAFT. The live site does not
  -- change until somebody publishes it, and the version being restored from
  -- stays in the history exactly as it was.
  update public.site_pages
     set draft = v_content, updated_at = now(), updated_by = v_admin
   where id = v_page.id;

  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  values (
    coalesce(v_admin, '00000000-0000-0000-0000-000000000000'::uuid),
    'SITE_VERSION_RESTORED', 'site_pages', p_slug,
    jsonb_build_object('restoredVersion', p_version, 'currentVersion', v_page.published_version)
  );

  -- The restored document itself. The editor puts this in the draft, so
  -- returning a receipt here instead would load an empty page over the
  -- admin's work.
  return v_content;
end $$;

-- ── Rollback: republish an earlier version immediately. ─────────────────────
-- §15 asks for a broken publish to be recoverable at once. Restore-then-publish
-- is two steps; this is the one-step form, and it still writes a NEW version
-- number so the history stays append-only.
create or replace function public.site_rollback(p_slug text, p_version integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin   uuid;
  v_page    public.site_pages%rowtype;
  v_content jsonb;
  v_new     integer;
begin
  v_admin := public.site_admin_id();
  if v_admin is null and auth.role() <> 'service_role' then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_page from public.site_pages where slug = p_slug for update;
  if not found then raise exception 'NOT_FOUND'; end if;

  select content into v_content
    from public.site_page_versions where page_id = v_page.id and version = p_version;
  if v_content is null then raise exception 'VERSION_NOT_FOUND'; end if;

  v_new := coalesce(v_page.published_version, 0) + 1;

  insert into public.site_page_versions (page_id, version, content, note, published_by)
  values (v_page.id, v_new, v_content,
          format('Rollback to version %s', p_version), v_admin);

  update public.site_pages
     set published = v_content, published_version = v_new, published_at = now(),
         published_by = v_admin, draft = v_content, updated_at = now(), updated_by = v_admin
   where id = v_page.id;

  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  values (
    coalesce(v_admin, '00000000-0000-0000-0000-000000000000'::uuid),
    'SITE_ROLLED_BACK', 'site_pages', p_slug,
    jsonb_build_object('toVersion', p_version, 'newVersion', v_new)
  );

  -- The new version number, as for site_publish.
  return to_jsonb(v_new);
end $$;

-- ============================================================================
-- Function privileges
-- ============================================================================

revoke all on function public.site_admin_id()                       from public, anon;
revoke all on function public.site_get_page(text)                   from public, anon;
revoke all on function public.site_save_draft(text, jsonb, text)    from public, anon;
revoke all on function public.site_publish(text, text)              from public, anon;
revoke all on function public.site_restore_version(text, integer)   from public, anon;
revoke all on function public.site_rollback(text, integer)          from public, anon;

grant execute on function public.site_get_page(text)                 to authenticated, service_role;
grant execute on function public.site_save_draft(text, jsonb, text)  to authenticated, service_role;
grant execute on function public.site_publish(text, text)            to authenticated, service_role;
grant execute on function public.site_restore_version(text, integer) to authenticated, service_role;
grant execute on function public.site_rollback(text, integer)        to authenticated, service_role;

comment on function public.site_save_draft(text, jsonb, text) is
  'Site Studio: upsert a page draft. Admin only, audited. Never touches the published document.';
comment on function public.site_publish(text, text) is
  'Site Studio: snapshot the draft as a new immutable version and make it live. Admin only, audited.';
comment on function public.site_restore_version(text, integer) is
  'Site Studio: load an old version into the draft. Deletes nothing. Admin only, audited.';
comment on function public.site_rollback(text, integer) is
  'Site Studio: republish an earlier version at once, as a new version number. Admin only, audited.';
