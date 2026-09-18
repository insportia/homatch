-- THE MANIFEST: WHAT IS IN SUPABASE STORAGE, AND WHOSE IT IS.
--
-- The migration copies bytes. Before it can, something has to say exactly
-- which objects exist and who each one belongs to, and that answer has to
-- come from the database rather than from a list somebody typed — a hand
-- written manifest is how an object gets left behind and nobody notices for
-- a year.
--
-- OWNERSHIP IS RESOLVED, NEVER GUESSED
--
-- Each bucket has a table that already knows who owns its objects, joined on
-- the path itself:
--
--   deal-room-documents   deal_room_documents.storage_path  -> user_id (auth)
--   voice-auditions       voice_audition_samples.storage_path -> created_by (auth)
--   property-photos       property_photos.storage_path -> properties.user_id
--   developer-documents   dev_documents.storage_path -> workspace_id, uploaded_by
--
-- Where no row matches, the object's own prefix is tried as an identity —
-- and only as an identity that actually exists in `users`. If neither
-- resolves, `owner_user_id` comes back NULL and the object is reported as
-- unresolved. That is an honest answer. Attributing a file to somebody
-- because their uuid looks similar is not.
--
-- The returned owner is always public.users.id — the Homatch account, the
-- thing that joins to an email address and a registration date — even where
-- the source table stores an auth uid.

create or replace function public.storage_migration_manifest()
returns table (
  bucket_id     text,
  name          text,
  byte_size     bigint,
  content_type  text,
  source_md5    text,
  source_sha256 text,
  owner_user_id uuid,
  entity_type   text,
  entity_id     uuid,
  category      text,
  owner_source  text
)
language sql
stable
security definer
set search_path to ''
as $fn$
  select
    o.bucket_id,
    o.name,
    (o.metadata->>'size')::bigint,
    o.metadata->>'mimetype',
    -- Supabase stores the etag quoted; for a single-part upload it is the
    -- md5, which is also what R2 returns, so the two are comparable without
    -- re-reading either object.
    btrim(coalesce(o.metadata->>'eTag', ''), '"'),
    res.sha256,
    res.owner_user_id,
    res.entity_type,
    res.entity_id,
    o.bucket_id,
    res.owner_source
  from storage.objects o
  cross join lateral (
    select
      case o.bucket_id
        when 'deal-room-documents' then (
          select u.id from public.deal_room_documents d
          join public.users u on u.auth_id = d.user_id
          where d.storage_path = o.name limit 1)
        when 'voice-auditions' then (
          select u.id from public.voice_audition_samples v
          join public.users u on u.auth_id = v.created_by
          where v.storage_path = o.name limit 1)
        when 'property-photos' then (
          select p.user_id from public.property_photos ph
          join public.properties p on p.id = ph.property_id
          where ph.storage_path = o.name limit 1)
        when 'developer-documents' then (
          select u.id from public.dev_documents dd
          join public.users u on u.id = dd.uploaded_by
          where dd.storage_path = o.name limit 1)
        else null
      end as row_owner,
      case o.bucket_id
        when 'deal-room-documents' then
          (select d.sha256 from public.deal_room_documents d where d.storage_path = o.name limit 1)
        else null
      end as sha256,
      case o.bucket_id
        when 'deal-room-documents' then 'deal_room'
        when 'voice-auditions'     then 'voice_audition_batch'
        when 'property-photos'     then 'property'
        when 'developer-documents' then 'dev_workspace'
        else null
      end as entity_type,
      case o.bucket_id
        when 'deal-room-documents' then
          (select d.deal_room_id from public.deal_room_documents d
            where d.storage_path = o.name limit 1)
        when 'voice-auditions' then
          (select v.batch_id from public.voice_audition_samples v
            where v.storage_path = o.name limit 1)
        when 'property-photos' then
          (select ph.property_id from public.property_photos ph
            where ph.storage_path = o.name limit 1)
        when 'developer-documents' then
          (select dd.workspace_id from public.dev_documents dd
            where dd.storage_path = o.name limit 1)
        else null
      end as entity_id,
      -- The prefix, tried only as an identity that genuinely exists.
      (select u.id from public.users u
        where split_part(o.name, '/', 1) ~
              '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          and (u.auth_id = split_part(o.name, '/', 1)::uuid
            or u.id = split_part(o.name, '/', 1)::uuid)
        limit 1) as prefix_owner
  ) r
  cross join lateral (
    select
      coalesce(r.row_owner, r.prefix_owner) as owner_user_id,
      r.entity_type, r.entity_id, r.sha256,
      case
        when r.row_owner is not null then 'DOMAIN_ROW'
        when r.prefix_owner is not null then 'KEY_PREFIX_MATCHED_ACCOUNT'
        else 'UNRESOLVED'
      end as owner_source
  ) res
  order by o.bucket_id, o.name;
$fn$;

comment on function public.storage_migration_manifest() is
  'Every object in Supabase Storage with its resolved Homatch account owner. Service role only.';

revoke all on function public.storage_migration_manifest() from public, anon, authenticated;
grant execute on function public.storage_migration_manifest() to service_role;
