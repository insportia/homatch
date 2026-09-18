-- OBJECT STORAGE, PART TWO: THE AUTHORITY AND THE LEDGER.
--
-- Part one proved that R2 works. This part makes Postgres the thing that
-- decides who may touch what, and the thing that knows what exists — because
-- R2 knows neither. It has one credential that can do everything and an
-- object either is or is not there.
--
-- TWO OBJECTS ARE CREATED HERE
--
--   storage_authorize()  the single authority. Given a key and a verb it
--                        answers with a word. Every signing path asks it and
--                        nothing signs without a yes.
--   storage_objects      what exists, who owns it, how big it is, what its
--                        bytes hash to, and — for anything copied out of
--                        Supabase Storage — where it came from and when it
--                        was proven identical.
--
-- WHY ONE FUNCTION RATHER THAN RULES IN TYPESCRIPT
--
-- The rules that guarded these objects were twenty-two RLS policies: they ran
-- inside the query, in the database, against live rows. Re-expressing them in
-- an edge function would mean the truth about who owns a photo lives in two
-- places that can drift, and the one that drifts silently is the one nobody
-- runs a test against. So the decision stays in SQL, next to the rows it is
-- about, and the edge function asks it a question.

-- ════════════════════════════════════════════════════════════════════════
-- 1. WHAT EXISTS
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.storage_objects (
  id                uuid primary key default gen_random_uuid(),

  -- Where the bytes are. Both values are real: an object can be recorded
  -- here while it still lives only in Supabase Storage.
  provider          text not null default 'R2'
                    check (provider in ('R2', 'SUPABASE')),
  namespace         text not null,
  object_key        text not null unique,

  -- THE AUTH UID, not public.users.id. Every ownership rule in this system
  -- compares against auth.uid(), and a ledger that stored the other id would
  -- be one join away from being wrong in a way nothing would notice.
  owner_user_id     uuid,
  entity_type       text,
  entity_id         uuid,
  purpose           text,

  -- The human name is METADATA, never part of the key: keys end up in logs,
  -- in dashboards and in URLs, and a filename can carry a person's name, a
  -- case number or an address.
  original_filename text,
  content_type      text,
  byte_size         bigint not null check (byte_size >= 0),
  checksum_sha256   text,
  -- R2 and Supabase both report md5 as the etag for a single-part upload,
  -- which makes it the one value both sides can be compared on without
  -- re-reading the object.
  checksum_md5      text,

  visibility        text not null default 'PRIVATE'
                    check (visibility in ('PRIVATE', 'AUTHENTICATED', 'PUBLIC')),
  -- PENDING: a write was authorised and signed, and nothing has confirmed
  -- the bytes arrived. A PENDING row older than an hour is an orphan and can
  -- be swept; without this state an abandoned upload is invisible.
  lifecycle         text not null default 'ACTIVE'
                    check (lifecycle in ('PENDING', 'ACTIVE', 'ORPHANED', 'DELETED')),

  -- ── Migration provenance ──────────────────────────────────────────────
  -- Null for anything born in R2. For a copy, these are the proof: where it
  -- came from, when the bytes moved, and when they were shown to be
  -- identical. `verified_at` is set only after a read-back comparison — not
  -- after a successful PUT, which proves only that a PUT succeeded.
  source_bucket     text,
  source_path       text,
  copied_at         timestamptz,
  verified_at       timestamptz,
  conflict_reason   text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

comment on table public.storage_objects is
  'Authoritative metadata for binary objects, and the migration ledger for anything copied out of Supabase Storage. Service role only.';

create unique index if not exists storage_objects_source_idx
  on public.storage_objects (source_bucket, source_path)
  where source_bucket is not null;

create index if not exists storage_objects_namespace_idx
  on public.storage_objects (namespace);
create index if not exists storage_objects_owner_idx
  on public.storage_objects (owner_user_id)
  where owner_user_id is not null;
create index if not exists storage_objects_entity_idx
  on public.storage_objects (entity_type, entity_id)
  where entity_id is not null;
-- The orphan sweep: writes that were signed and never confirmed.
create index if not exists storage_objects_pending_idx
  on public.storage_objects (created_at)
  where lifecycle = 'PENDING';

alter table public.storage_objects enable row level security;
revoke all on public.storage_objects from anon, authenticated;

-- RLS on with no policies: only the service role, which bypasses RLS, can
-- read or write this. A customer reaches it only through storage-sign, which
-- has already asked storage_authorize about the specific key.

-- ════════════════════════════════════════════════════════════════════════
-- 2. WHO MAY TOUCH IT
-- ════════════════════════════════════════════════════════════════════════

/*
 * The one authority.
 *
 * Returns exactly one of:
 *   ALLOW | UNAUTHENTICATED | NOT_OWNER | NOT_ADMIN | NO_CAPABILITY
 *   INVALID_KEY | UNAVAILABLE
 *
 * WHAT CHANGED, AND WHY IT IS THE POINT OF THIS MIGRATION
 *
 * `photos_select_own_storage` and `photos_delete_own_storage` check only
 * `auth.uid() IS NOT NULL`. Any signed-in person could read or delete
 * anybody's photo given its key. Meanwhile `property_photos.visibility` has
 * carried PUBLIC / AUTHENTICATED / PRIVATE since the table was created and
 * NOTHING HAS EVER READ IT. The product already said what it meant; the
 * enforcement never caught up. This honours the column.
 *
 * OWNERSHIP IS RESOLVED FROM ROWS, NOT FROM THE KEY
 *
 * A key is a string a caller supplies. Where a row exists that says who owns
 * an object — property_photos joined to properties, deal_room_documents,
 * dev_documents — that row decides, and the key is only how the row is
 * found. The key's own prefix is consulted in exactly one situation: a
 * BRAND NEW object, where there is no row yet, and then the prefix is checked
 * against a relationship that does exist (the property, the workspace) rather
 * than believed on its own.
 *
 * IT FAILS CLOSED. The exception handler at the bottom is not decoration:
 * a malformed uuid cast or a missing relation must deny, and the default
 * behaviour of an unhandled exception in a signing path is an error the
 * caller might be tempted to retry past.
 */
create or replace function public.storage_authorize(p_key text, p_action text)
returns text
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_me      uuid;          -- public.users.id for this caller
  v_admin   boolean := false;
  v_seg     text[];
  v_ns      text;
  v_rest    text;
  v_owner   uuid;
  v_vis     text;
  v_ws      uuid;
  v_uuid_re constant text :=
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  -- ── The key must be a key ───────────────────────────────────────────
  if p_action is null or p_action not in ('READ', 'WRITE', 'DELETE') then
    return 'INVALID_KEY';
  end if;
  if p_key is null or p_key = '' or length(p_key) > 1024 then
    return 'INVALID_KEY';
  end if;
  if left(p_key, 1) = '/' or right(p_key, 1) = '/'
     or position('\' in p_key) > 0
     or p_key ~ ('[' || chr(1) || '-' || chr(31) || chr(127) || ']') then
    return 'INVALID_KEY';
  end if;

  v_seg := string_to_array(p_key, '/');
  if coalesce(array_length(v_seg, 1), 0) < 2 then return 'INVALID_KEY'; end if;
  if exists (select 1 from unnest(v_seg) s where s = '' or s = '.' or s = '..') then
    return 'INVALID_KEY';
  end if;

  v_ns := v_seg[1];
  v_rest := array_to_string(v_seg[2:array_length(v_seg, 1)], '/');

  -- ── Who is asking ───────────────────────────────────────────────────
  if v_uid is not null then
    select u.id, u.is_admin into v_me, v_admin
    from public.users u where u.auth_id = v_uid limit 1;
    v_admin := coalesce(v_admin, false);
  end if;

  -- ── PROPERTY PHOTOS ─────────────────────────────────────────────────
  if v_ns = 'property-photos' then
    select p.user_id, ph.visibility::text
      into v_owner, v_vis
    from public.property_photos ph
    join public.properties p on p.id = ph.property_id
    where ph.storage_path = v_rest
    limit 1;

    if v_owner is not null then
      if p_action = 'READ' then
        -- The column the product has always carried, finally consulted.
        if v_vis = 'PUBLIC' then return 'ALLOW'; end if;
        if v_uid is null then return 'UNAUTHENTICATED'; end if;
        if v_vis = 'AUTHENTICATED' then return 'ALLOW'; end if;
        if v_owner = v_me or v_admin then return 'ALLOW'; end if;
        return 'NOT_OWNER';           -- PRIVATE, and not this person's
      end if;
      -- Changing or removing a photo is the owner's alone, whatever its
      -- visibility. A PUBLIC photo is public to READ, not to delete.
      if v_uid is null then return 'UNAUTHENTICATED'; end if;
      if v_owner = v_me then return 'ALLOW'; end if;
      return 'NOT_OWNER';
    end if;

    -- No row: a new upload. The key is <owner>/<property>/<object>, and the
    -- PROPERTY is asked who owns it — the key is not believed on its own.
    if v_uid is null then return 'UNAUTHENTICATED'; end if;
    if coalesce(array_length(v_seg, 1), 0) < 4 then return 'INVALID_KEY'; end if;
    if v_seg[2] !~ v_uuid_re or v_seg[3] !~ v_uuid_re then return 'INVALID_KEY'; end if;

    select p.user_id into v_owner
    from public.properties p
    where p.id = v_seg[3]::uuid and p.is_deleted = false
    limit 1;

    -- A property that does not exist and a property that is not yours answer
    -- identically: otherwise this is an oracle for which ids exist.
    if v_owner is null or v_owner is distinct from v_me then
      if v_admin and p_action = 'READ' then return 'ALLOW'; end if;
      return 'NOT_OWNER';
    end if;
    -- And the key must name its own owner, so one person cannot write into
    -- another person's prefix even for a property they do own.
    if v_seg[2] <> v_me::text then return 'NOT_OWNER'; end if;
    return 'ALLOW';
  end if;

  -- ── DEAL ROOM DOCUMENTS ─────────────────────────────────────────────
  if v_ns = 'deal-room-documents' then
    if v_uid is null then return 'UNAUTHENTICATED'; end if;

    select d.user_id into v_owner
    from public.deal_room_documents d
    where d.storage_path = v_rest limit 1;

    if v_owner is not null then
      -- deal_room_documents.user_id is the AUTH uid, confirmed against
      -- users.auth_id; it is not public.users.id.
      return case when v_owner = v_uid then 'ALLOW' else 'NOT_OWNER' end;
    end if;

    -- No row: a fresh upload, or one of the two objects CI left behind. The
    -- prefix rule is what the live policy enforces today, preserved exactly.
    return case when v_seg[2] = v_uid::text then 'ALLOW' else 'NOT_OWNER' end;
  end if;

  -- ── DEVELOPER DOCUMENTS ─────────────────────────────────────────────
  if v_ns = 'developer-documents' then
    if v_uid is null then return 'UNAUTHENTICATED'; end if;

    select d.workspace_id into v_ws
    from public.dev_documents d where d.storage_path = v_rest limit 1;

    if v_ws is null then
      if v_seg[2] !~ v_uuid_re then return 'INVALID_KEY'; end if;
      v_ws := v_seg[2]::uuid;
    end if;
    return case when public.dev_can(v_ws, 'documents') then 'ALLOW' else 'NO_CAPABILITY' end;
  end if;

  -- ── DEVELOPER MEDIA ─────────────────────────────────────────────────
  if v_ns = 'developer-media' then
    -- Read is unconditional because the bucket is public today and live
    -- marketing pages link straight at it. Privatising it is a product
    -- change with a visible consequence, not a side effect of this one.
    if p_action = 'READ' then return 'ALLOW'; end if;
    if v_uid is null then return 'UNAUTHENTICATED'; end if;
    if v_seg[2] !~ v_uuid_re then return 'INVALID_KEY'; end if;
    return case when public.dev_can(v_seg[2]::uuid, 'inventory') then 'ALLOW' else 'NO_CAPABILITY' end;
  end if;

  -- ── MORTGAGE OFFER DOCUMENTS ────────────────────────────────────────
  if v_ns = 'mortgage-offer-documents' then
    -- There is no table for these, so the prefix is the only relationship
    -- that exists — and it is sound because the prefix can only have been
    -- written by an upload that passed this same check.
    if v_uid is null then return 'UNAUTHENTICATED'; end if;
    return case when v_seg[2] = v_uid::text then 'ALLOW' else 'NOT_OWNER' end;
  end if;

  -- ── SITE ASSETS ─────────────────────────────────────────────────────
  if v_ns = 'site-assets' then
    if p_action = 'READ' then return 'ALLOW'; end if;   -- public today
    if v_uid is null then return 'UNAUTHENTICATED'; end if;
    return case when v_admin then 'ALLOW' else 'NOT_ADMIN' end;
  end if;

  -- ── VOICE AUDITIONS AND DIAGNOSTICS ─────────────────────────────────
  if v_ns in ('voice-auditions', 'diagnostics') then
    -- Recordings of real people, and the self-test area. Staff only.
    if v_uid is null then return 'UNAUTHENTICATED'; end if;
    return case when v_admin then 'ALLOW' else 'NOT_ADMIN' end;
  end if;

  -- A namespace nobody has written rules for is not "probably fine".
  return 'INVALID_KEY';

exception when others then
  -- Fail closed. A cast that threw, a relation that moved: none of those is
  -- a reason to sign something.
  return 'UNAVAILABLE';
end;
$$;

comment on function public.storage_authorize(text, text) is
  'The single authority for object storage. Returns ALLOW or a refusal word. Resolves ownership from rows, not from the key.';

revoke all on function public.storage_authorize(text, text) from public;
-- anon may ask, because two namespaces are genuinely public to read and the
-- function answers UNAUTHENTICATED for everything else.
grant execute on function public.storage_authorize(text, text) to anon, authenticated, service_role;
