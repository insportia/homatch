-- HOMATCH — Storage retention lifecycle, access expiry, cleanup engine and
-- compact market knowledge (docs/infra/STORAGE_RETENTION.md).
--
-- WHAT THIS MIGRATION DOES ON APPLY: nothing user-visible, nothing deleted.
--   * Creates the lifecycle registry (retention_records / retention_objects /
--     retention_events) — empty.
--   * Creates the compact knowledge tables — empty.
--   * Adds DENY-ONLY restrictive SELECT policies keyed on the registry. With an
--     empty registry they deny nothing; with registered records they deny only
--     rows whose server-side expires_at has passed.
--   * Seeds admin_settings.storage_retention with EVERYTHING OFF:
--       effective_at = null   -> no record ever gets an expiry date
--       purge_enabled = false -> the engine claims nothing
--       reminders_enabled = false, knowledge_enabled = false
--   * Schedules NO cron job. Activation is a separate, owner-approved step.
--
-- WHAT IT NEVER DOES: touch the Verify pipeline, its prompts, scoring,
-- synthesis, billing (verify_billing is RESTRICT and rows are never deleted —
-- only payload columns are cleared), or any non-Verify/Contracts product.
--
-- ONE EXPIRY RULE: public.retention_expiry(available_at) = available_at + 30
-- calendar days in UTC. expires_at is written once and can never move (guard
-- trigger) — reads, views, downloads and logins never extend it.

/* ------------------------------------------------------------------ *
 * 0. Settings (all off) and the reminder notification type            *
 * ------------------------------------------------------------------ */

insert into public.admin_settings (key, value, description)
values ('storage_retention', jsonb_build_object(
          'effective_at', null,
          'legacy_grace_until', null,
          'purge_enabled', false,
          'reminders_enabled', false,
          'knowledge_enabled', false,
          'batch_size', 10,
          'max_attempts', 5),
        'Verify/Contracts 30-day retention. effective_at: records available on/after it expire 30 days later (null = nothing expires). legacy_grace_until: earliest expiry for records available before effective_at (null = legacy never expires). purge_enabled gates all destructive cleanup.')
on conflict (key) do nothing;

insert into public.admin_settings (key, value, description)
values ('storage_retention_cron_token', to_jsonb(encode(extensions.gen_random_bytes(24), 'hex')),
        'Shared secret the storage-retention cron tick presents in x-cron-token.')
on conflict (key) do nothing;

alter type public.notification_type add value if not exists 'RETENTION_EXPIRING';

/* ------------------------------------------------------------------ *
 * 1. The registry                                                     *
 * ------------------------------------------------------------------ */

create table if not exists public.retention_records (
  id uuid primary key default gen_random_uuid(),
  product text not null check (product in ('VERIFY_REPORT', 'CONTRACT_DOCUMENT')),
  source_id uuid not null,
  -- auth.users id; null only for an anonymous-session Verify job.
  owner_user_id uuid,
  available_at timestamptz not null,
  -- null = not expiring under the current policy (legacy record, or policy not yet effective).
  expires_at timestamptz,
  policy text not null check (policy in ('STANDARD_30D', 'LEGACY_PENDING', 'LEGACY_GRACE')),
  legal_hold boolean not null default false,
  legal_hold_reason text,
  state text not null default 'ACTIVE'
    check (state in ('ACTIVE', 'PURGING', 'PURGED', 'FAILED', 'DEAD_LETTER')),
  -- Minimal, non-identifying tombstone label (product + mode/category). Never an address.
  label text,
  payload_bytes bigint not null default 0,
  reclaimed_bytes bigint,
  objects_scanned_at timestamptz,
  knowledge_extracted_at timestamptz,
  reminder_7d_at timestamptz,
  reminder_7d_notification uuid,
  reminder_1d_at timestamptz,
  reminder_1d_notification uuid,
  attempts integer not null default 0,
  lease_token uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  purged_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product, source_id)
);

comment on table public.retention_records is
  'Lifecycle registry: one row per retained product record (Verify report = research_jobs row, Contract document = deal_room_documents row). No secrets, no signed URLs, no content.';

create index if not exists retention_records_due_idx
  on public.retention_records (expires_at)
  where state in ('ACTIVE', 'FAILED') and expires_at is not null;
create index if not exists retention_records_owner_idx
  on public.retention_records (owner_user_id, product);
create index if not exists retention_records_legacy_idx
  on public.retention_records (available_at) where expires_at is null;

create table if not exists public.retention_objects (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.retention_records(id) on delete restrict,
  provider text not null check (provider in ('SUPABASE_STORAGE', 'R2')),
  bucket text not null,
  object_key text not null,
  object_type text not null
    check (object_type in ('CONTRACT_FILE', 'CONTRACT_FILE_COPY', 'VERIFY_OFFICIAL_DOCUMENT')),
  byte_size bigint,
  -- true for content-addressed caches the same key can serve to other records.
  shared boolean not null default false,
  storage_object_id uuid,
  -- ACTIVE: present. DELETED: provider delete confirmed. RETAINED: this
  -- record's reference is gone but another live reference still needs the
  -- object. FAILED/DEAD_LETTER: deletion retried / needs manual review.
  state text not null default 'ACTIVE'
    check (state in ('ACTIVE', 'DELETED', 'RETAINED', 'FAILED', 'DEAD_LETTER')),
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  last_error text,
  deleted_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (record_id, provider, bucket, object_key)
);

create index if not exists retention_objects_key_idx
  on public.retention_objects (provider, bucket, object_key);

create table if not exists public.retention_events (
  id bigint generated always as identity primary key,
  record_id uuid,
  object_id uuid,
  event text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists retention_events_record_idx on public.retention_events (record_id, created_at);
create index if not exists retention_events_created_idx on public.retention_events (created_at);

alter table public.retention_records enable row level security;
alter table public.retention_objects enable row level security;
alter table public.retention_events enable row level security;
revoke all on public.retention_records, public.retention_objects, public.retention_events from public, anon, authenticated;

/* expires_at is written once and never moves; available_at never moves;
   PURGED is terminal. This is what makes "no extension on read" structural. */
create or replace function public.retention_records_guard()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.available_at is distinct from old.available_at then
    raise exception 'retention: available_at is immutable' using errcode = 'check_violation';
  end if;
  if old.expires_at is not null and new.expires_at is distinct from old.expires_at then
    raise exception 'retention: expires_at is immutable once set' using errcode = 'check_violation';
  end if;
  if old.state = 'PURGED' and new.state <> 'PURGED' then
    raise exception 'retention: PURGED is terminal' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists retention_records_guard on public.retention_records;
create trigger retention_records_guard before update on public.retention_records
  for each row execute function public.retention_records_guard();

/* ------------------------------------------------------------------ *
 * 2. The one expiry rule and the policy                               *
 * ------------------------------------------------------------------ */

create or replace function public.retention_expiry(p_available_at timestamptz)
returns timestamptz
language sql
immutable
parallel safe
set search_path to ''
as $$
  -- 30 calendar days computed on the UTC calendar, whatever the session TimeZone.
  select ((p_available_at at time zone 'UTC') + interval '30 days') at time zone 'UTC'
$$;

create or replace function public.retention_config()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce((select case when jsonb_typeof(value) = 'object' then value end
                     from public.admin_settings where key = 'storage_retention'), '{}'::jsonb)
$$;

create or replace function public.retention_cfg_ts(p_cfg jsonb, p_key text)
returns timestamptz
language plpgsql
immutable
set search_path to ''
as $$
begin
  if p_cfg ->> p_key is null then return null; end if;
  return (p_cfg ->> p_key)::timestamptz;
exception when others then
  return null;   -- a malformed date never makes anything expire
end $$;

-- (expires_at, policy) for a record that became available at p_available_at.
create or replace function public.retention_policy_for(p_available_at timestamptz, p_cfg jsonb)
returns table (expires_at timestamptz, policy text)
language plpgsql
immutable
set search_path to ''
as $$
declare
  v_effective timestamptz := public.retention_cfg_ts(p_cfg, 'effective_at');
  v_grace timestamptz := public.retention_cfg_ts(p_cfg, 'legacy_grace_until');
begin
  if v_effective is not null and p_available_at >= v_effective then
    return query select public.retention_expiry(p_available_at), 'STANDARD_30D'::text;
  elsif v_effective is not null and v_grace is not null then
    return query select greatest(public.retention_expiry(p_available_at), v_grace), 'LEGACY_GRACE'::text;
  else
    return query select null::timestamptz, 'LEGACY_PENDING'::text;
  end if;
end $$;

/* ------------------------------------------------------------------ *
 * 3. Access expiry (server-side, deny-only)                           *
 * ------------------------------------------------------------------ */

create or replace function public.retention_access_blocked(p_product text, p_source_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.retention_records r
     where r.product = p_product and r.source_id = p_source_id
       and r.expires_at is not null and r.expires_at <= now())
$$;

-- An object is blocked when every registered reference to it has expired.
-- A key with no registration, or with any unexpired reference, is not blocked.
create or replace function public.retention_object_blocked(p_provider text, p_bucket text, p_key text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
           select 1 from public.retention_objects o
            where o.provider = p_provider and o.bucket = p_bucket and o.object_key = p_key)
     and not exists (
           select 1 from public.retention_objects o
             join public.retention_records r on r.id = o.record_id
            where o.provider = p_provider and o.bucket = p_bucket and o.object_key = p_key
              and (r.expires_at is null or r.expires_at > now()))
$$;

-- The same rule for a list (service-role readers such as the assistant's
-- report context): the ids among p_ids whose retention has expired.
create or replace function public.retention_blocked_ids(p_product text, p_ids uuid[])
returns uuid[]
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(array_agg(r.source_id), '{}'::uuid[])
    from public.retention_records r
   where r.product = p_product and r.source_id = any(p_ids)
     and r.expires_at is not null and r.expires_at <= now()
$$;

revoke all on function public.retention_access_blocked(text, uuid) from public, anon;
revoke all on function public.retention_blocked_ids(text, uuid[]) from public, anon, authenticated;
grant execute on function public.retention_blocked_ids(text, uuid[]) to service_role;
revoke all on function public.retention_object_blocked(text, text, text) from public, anon;
grant execute on function public.retention_access_blocked(text, uuid) to authenticated, service_role;
grant execute on function public.retention_object_blocked(text, text, text) to authenticated, service_role;

drop policy if exists research_jobs_retention_gate on public.research_jobs;
create policy research_jobs_retention_gate on public.research_jobs
  as restrictive for select to authenticated
  using (not public.retention_access_blocked('VERIFY_REPORT', id));

drop policy if exists deal_room_documents_retention_gate on public.deal_room_documents;
create policy deal_room_documents_retention_gate on public.deal_room_documents
  as restrictive for select to authenticated
  using (not public.retention_access_blocked('CONTRACT_DOCUMENT', id));

drop policy if exists deal_room_document_findings_retention_gate on public.deal_room_document_findings;
create policy deal_room_document_findings_retention_gate on public.deal_room_document_findings
  as restrictive for select to authenticated
  using (not public.retention_access_blocked('CONTRACT_DOCUMENT', document_id));

-- No signed URL for an expired Contracts file: createSignedUrl needs SELECT.
drop policy if exists deal_room_docs_retention_gate on storage.objects;
create policy deal_room_docs_retention_gate on storage.objects
  as restrictive for select to authenticated
  using (bucket_id <> 'deal-room-documents'
         or not public.retention_object_blocked('SUPABASE_STORAGE', bucket_id, name));

/* ------------------------------------------------------------------ *
 * 4. Compact knowledge layer                                          *
 * ------------------------------------------------------------------ */

-- One row per distinct public listing observation (third-party asking prices
-- that Verify already gathered as comparables). No user, no job, no address,
-- no URL, no listing id: the dedupe key is a truncated hash.
create table if not exists public.market_observations (
  id bigint generated always as identity primary key,
  dedupe_key bytea not null unique,
  country text not null default 'GE' check (country ~ '^[A-Z]{2}$'),
  district text check (char_length(district) <= 48),
  property_type text check (property_type in ('RESIDENTIAL', 'COMMERCIAL', 'LAND', 'OTHER')),
  rooms smallint check (rooms between 0 and 50),
  floor smallint check (floor between -5 and 200),
  area_m2 numeric(8, 1) check (area_m2 between 8 and 20000),
  condition text check (char_length(condition) <= 32),
  -- Always an ASKING price. Never a transaction price, whatever listing_status says.
  price_kind text not null default 'ASKING' check (price_kind = 'ASKING'),
  listing_status text check (listing_status in ('ACTIVE', 'EXPIRED', 'REMOVED', 'SOLD', 'UNKNOWN')),
  price numeric(14, 2),
  currency text not null check (currency in ('USD', 'GEL', 'EUR')),
  price_per_m2 numeric(12, 2) not null check (price_per_m2 between 50 and 50000),
  observed_on date not null,
  source_category text not null check (source_category in ('MARKETPLACE', 'WEB_LISTING')),
  comparable_type text check (comparable_type in ('SAME_PROJECT', 'MICRO_LOCATION', 'PEER_PROJECT', 'WIDER_MARKET')),
  -- NUMERIC_PARSED: price_per_m2 came as a plain number. DERIVED: price / area.
  confidence text not null check (confidence in ('NUMERIC_PARSED', 'DERIVED')),
  seen_count integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  withdrawn_reason text
);
create index if not exists market_observations_segment_idx
  on public.market_observations (district, property_type, observed_on) where withdrawn_at is null;

-- Contracts: aggregate counters only. Never a document, a clause, a party or a value.
create table if not exists public.contract_insight_counts (
  month date not null,
  category text not null,
  finding_type text not null,
  severity text not null,
  n integer not null default 0,
  primary key (month, category, finding_type, severity)
);

alter table public.market_observations enable row level security;
alter table public.contract_insight_counts enable row level security;
revoke all on public.market_observations, public.contract_insight_counts from public, anon, authenticated;

-- Strict parsers: anything ambiguous (ranges, words, separators) is NULL, never guessed.
create or replace function public.knowledge_num(p text)
returns numeric
language sql
immutable
set search_path to ''
as $$
  select case when btrim(p) ~ '^[0-9]{1,9}(\.[0-9]{1,2})?$' then btrim(p)::numeric end
$$;

create or replace function public.knowledge_area(p text)
returns numeric
language sql
immutable
set search_path to ''
as $$
  -- "85", "85.5", "85 m²", "85 მ²", "85 sq.m" -> 85; "80-90" or "85/120" -> null.
  select case when btrim(p) ~ '^[0-9]{1,5}(\.[0-9])?\s*(m2|m²|მ²|მ2|sq\.?\s*m|кв\.?\s*м)?$'
              then substring(btrim(p) from '^[0-9]{1,5}(?:\.[0-9])?')::numeric end
$$;

create or replace function public.knowledge_extract_verify(p_job_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_job record;
  c jsonb;
  v_n integer := 0;
  v_ppm numeric; v_price numeric; v_area numeric; v_cur text; v_conf text;
  v_ref text; v_district text; v_cond text; v_obs date; v_key bytea;
begin
  select id, completed_at, result_json into v_job
    from public.research_jobs where id = p_job_id and status = 'COMPLETE';
  if not found or jsonb_typeof(v_job.result_json #> '{market,comparables}') is distinct from 'array' then
    return 0;
  end if;
  for c in select value from jsonb_array_elements(v_job.result_json #> '{market,comparables}') loop
    continue when jsonb_typeof(c) <> 'object';
    v_cur := upper(btrim(c ->> 'currency'));
    continue when v_cur is null or v_cur not in ('USD', 'GEL', 'EUR');
    v_area := public.knowledge_area(c ->> 'area');
    v_price := public.knowledge_num(c ->> 'price');
    v_ppm := public.knowledge_num(c ->> 'pricePerSqm');
    v_conf := 'NUMERIC_PARSED';
    if v_ppm is null and v_price is not null and v_area is not null and v_area > 0 then
      v_ppm := round(v_price / v_area, 2);
      v_conf := 'DERIVED';
    end if;
    continue when v_ppm is null or v_ppm < 50 or v_ppm > 50000;
    if v_area is not null and (v_area < 8 or v_area > 20000) then v_area := null; end if;
    -- Dedupe identity: the listing reference, hashed, never stored.
    v_ref := lower(btrim(coalesce(nullif(c ->> 'url', ''), nullif(c ->> 'listingId', ''))));
    continue when v_ref is null;
    -- District: a short area name only; anything with digits (street numbers,
    -- building numbers, cadastral codes) is dropped, not truncated.
    v_district := nullif(btrim(c ->> 'district'), '');
    if v_district is not null and (v_district ~ '[0-9]' or char_length(v_district) > 48) then
      v_district := null;
    end if;
    v_cond := lower(nullif(btrim(c ->> 'condition'), ''));
    if v_cond is not null and (v_cond !~ '^[[:alpha:] -]{1,32}$') then v_cond := null; end if;
    v_obs := coalesce(
      case when c ->> 'listingDate' ~ '^\d{4}-\d{2}-\d{2}' then left(c ->> 'listingDate', 10)::date end,
      case when c ->> 'retrievedAt' ~ '^\d{4}-\d{2}-\d{2}' then left(c ->> 'retrievedAt', 10)::date end,
      (v_job.completed_at at time zone 'UTC')::date);
    v_key := substring(sha256(convert_to(v_ref || '|' || v_ppm::text || '|' || v_cur, 'UTF8')) from 1 for 16);
    insert into public.market_observations as m (
      dedupe_key, district, property_type, rooms, floor, area_m2, condition, listing_status,
      price, currency, price_per_m2, observed_on, source_category, comparable_type, confidence)
    values (
      v_key, v_district,
      case when c ->> 'propertyType' in ('RESIDENTIAL', 'COMMERCIAL', 'LAND', 'OTHER') then c ->> 'propertyType' end,
      case when btrim(c ->> 'rooms') ~ '^[0-9]{1,2}$' then (btrim(c ->> 'rooms'))::smallint end,
      case when btrim(c ->> 'floor') ~ '^-?[0-9]{1,3}$' and (btrim(c ->> 'floor'))::int between -5 and 200
           then (btrim(c ->> 'floor'))::smallint end,
      v_area, v_cond,
      case when c ->> 'listingStatus' in ('ACTIVE', 'EXPIRED', 'REMOVED', 'SOLD', 'UNKNOWN') then c ->> 'listingStatus' end,
      v_price, v_cur, v_ppm, v_obs,
      case when nullif(c ->> 'marketplaceSource', '') is not null then 'MARKETPLACE' else 'WEB_LISTING' end,
      case when c ->> 'comparableType' in ('SAME_PROJECT', 'MICRO_LOCATION', 'PEER_PROJECT', 'WIDER_MARKET') then c ->> 'comparableType' end,
      v_conf)
    on conflict (dedupe_key) do update
      set seen_count = m.seen_count + 1, last_seen_at = now();
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public.knowledge_extract_contract(p_document_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_n integer := 0;
begin
  insert into public.contract_insight_counts as k (month, category, finding_type, severity, n)
  select date_trunc('month', coalesce(d.analyzed_at, d.created_at) at time zone 'UTC')::date,
         coalesce(d.category, 'UNSPECIFIED'), left(f.finding_type, 48), left(f.severity, 16), count(*)
    from public.deal_room_document_findings f
    join public.deal_room_documents d on d.id = f.document_id
   where f.document_id = p_document_id
   group by 1, 2, 3, 4
  on conflict (month, category, finding_type, severity) do update set n = k.n + excluded.n;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Correction/withdrawal: an observation that is wrong or must not be kept is
-- withdrawn (excluded from every index and read) rather than silently edited.
create or replace function public.knowledge_withdraw_observation(p_id bigint, p_reason text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = 'insufficient_privilege'; end if;
  update public.market_observations set withdrawn_at = now(), withdrawn_reason = left(p_reason, 200)
   where id = p_id and withdrawn_at is null;
  return found;
end $$;

/* ------------------------------------------------------------------ *
 * 5. Registration (asynchronous, outside every critical path)         *
 * ------------------------------------------------------------------ */

create or replace function public.retention_register_due(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_cfg jsonb := public.retention_config();
  v_knowledge boolean := coalesce((v_cfg ->> 'knowledge_enabled')::boolean, false);
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
  v_verify integer := 0;
  v_contract integer := 0;
  v_policy integer := 0;
  v_knowledge_n integer := 0;
  r record;
  v_rec uuid;
begin
  -- Verify: a report is available once it is COMPLETE and its persisted
  -- synthesis is READY (or synthesis settled/FAILED, or an hour has passed).
  for r in
    select j.id, j.user_id, j.mode,
           case when j.synthesis_state = 'READY' and j.synthesis_at is not null
                then greatest(j.completed_at, j.synthesis_at) else j.completed_at end as available_at,
           coalesce(pg_column_size(j.result_json), 0) + coalesce(pg_column_size(j.synthesis_json), 0)
             + coalesce(pg_column_size(j.evidence_bundle), 0) + coalesce(pg_column_size(j.evidence), 0)
             + coalesce(pg_column_size(j.documents), 0) + coalesce(pg_column_size(j.progress), 0) as bytes
      from public.research_jobs j
     where j.status = 'COMPLETE' and j.completed_at is not null
       and (j.synthesis_state in ('READY', 'FAILED') or j.completed_at < now() - interval '1 hour')
       and not exists (select 1 from public.retention_records x
                        where x.product = 'VERIFY_REPORT' and x.source_id = j.id)
     order by j.completed_at
     limit v_limit
  loop
    insert into public.retention_records (product, source_id, owner_user_id, available_at, expires_at, policy, label, payload_bytes)
    select 'VERIFY_REPORT', r.id, r.user_id, r.available_at, p.expires_at, p.policy,
           'Verify · ' || coalesce(r.mode, 'report'), r.bytes
      from public.retention_policy_for(r.available_at, v_cfg) p
    on conflict (product, source_id) do nothing
    returning id into v_rec;
    if v_rec is not null then
      v_verify := v_verify + 1;
      insert into public.retention_events (record_id, event, detail)
      values (v_rec, 'REGISTERED', jsonb_build_object('product', 'VERIFY_REPORT'));
    end if;
  end loop;

  -- Contracts: a document is available when its file exists and its analysis
  -- has settled (DONE/FAILED/UNSUPPORTED/REQUIRES_OCR), or an hour after an
  -- upload that was never analysed. Checklist rows without a file are not
  -- retained artifacts and are not registered.
  for r in
    select d.id, d.user_id, d.storage_path, d.size_bytes, coalesce(d.category, 'document') as category,
           greatest(coalesce(d.uploaded_at, d.created_at),
                    coalesce(d.analyzed_at, coalesce(d.uploaded_at, d.created_at))) as available_at,
           coalesce(pg_column_size(d.analysis), 0) + coalesce(pg_column_size(d.extracted_text), 0)
             + coalesce((select sum(pg_column_size(f.*)) from public.deal_room_document_findings f where f.document_id = d.id), 0) as bytes
      from public.deal_room_documents d
     where (d.storage_path is not null or d.analysis is not null)
       and (d.analysis_state in ('DONE', 'FAILED', 'UNSUPPORTED', 'REQUIRES_OCR')
            or (d.analysis_state = 'NONE' and coalesce(d.uploaded_at, d.created_at) < now() - interval '1 hour'))
       and not exists (select 1 from public.retention_records x
                        where x.product = 'CONTRACT_DOCUMENT' and x.source_id = d.id)
     order by d.created_at
     limit v_limit
  loop
    v_rec := null;
    insert into public.retention_records (product, source_id, owner_user_id, available_at, expires_at, policy, label, payload_bytes, objects_scanned_at)
    select 'CONTRACT_DOCUMENT', r.id, r.user_id, r.available_at, p.expires_at, p.policy,
           'Contract · ' || lower(r.category), r.bytes, now()
      from public.retention_policy_for(r.available_at, v_cfg) p
    on conflict (product, source_id) do nothing
    returning id into v_rec;
    if v_rec is not null then
      v_contract := v_contract + 1;
      if r.storage_path is not null then
        insert into public.retention_objects (record_id, provider, bucket, object_key, object_type, byte_size, shared)
        values (v_rec, 'SUPABASE_STORAGE', 'deal-room-documents', r.storage_path, 'CONTRACT_FILE', r.size_bytes,
                (select count(*) > 1 from public.deal_room_documents o where o.storage_path = r.storage_path))
        on conflict do nothing;
        -- The R2 copy made by the storage migration (same bytes, other provider).
        insert into public.retention_objects (record_id, provider, bucket, object_key, object_type, byte_size, storage_object_id)
        select v_rec, 'R2', 'homatch-storage', so.object_key, 'CONTRACT_FILE_COPY', so.byte_size, so.id
          from public.storage_objects so
         where so.source_bucket = 'deal-room-documents' and so.source_path = r.storage_path
           and so.provider = 'R2' and so.lifecycle <> 'DELETED'
        on conflict do nothing;
      end if;
      insert into public.retention_events (record_id, event, detail)
      values (v_rec, 'REGISTERED', jsonb_build_object('product', 'CONTRACT_DOCUMENT'));
    end if;
  end loop;

  -- Policy changes reach records registered while it was off. Only null
  -- expiries are ever written: an existing date is never moved.
  with upd as (
    update public.retention_records x
       set expires_at = p.expires_at, policy = p.policy
      from public.retention_records y
     cross join lateral public.retention_policy_for(y.available_at, v_cfg) p
     where x.id = y.id and y.expires_at is null and y.state = 'ACTIVE' and p.expires_at is not null
    returning x.id
  )
  select count(*) into v_policy from upd;

  -- Knowledge: downstream, best-effort, once per record. A failure is logged
  -- and never propagates.
  if v_knowledge then
    for r in
      select x.id, x.product, x.source_id from public.retention_records x
       where x.knowledge_extracted_at is null and x.state = 'ACTIVE'
       order by x.created_at limit v_limit
    loop
      begin
        if r.product = 'VERIFY_REPORT' then
          v_knowledge_n := v_knowledge_n + public.knowledge_extract_verify(r.source_id);
        else
          v_knowledge_n := v_knowledge_n + public.knowledge_extract_contract(r.source_id);
        end if;
        update public.retention_records set knowledge_extracted_at = now() where id = r.id;
      exception when others then
        insert into public.retention_events (record_id, event, detail)
        values (r.id, 'KNOWLEDGE_FAILED', jsonb_build_object('sqlstate', sqlstate));
        update public.retention_records set knowledge_extracted_at = now() where id = r.id;
      end;
    end loop;
  end if;

  return jsonb_build_object('verify', v_verify, 'contracts', v_contract,
                            'policy_applied', v_policy, 'knowledge_rows', v_knowledge_n);
end $$;

-- Verify official documents are a shared, content-addressed cache
-- (verify-documents/files/<attachedFileId>.<ext>). The edge engine parses each
-- report's ledger with the same code research-agent uses and records the
-- references here, BEFORE the payload that names them can be purged.
create or replace function public.retention_add_object_refs(p_record_id uuid, p_objects jsonb)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_n integer := 0;
begin
  insert into public.retention_objects (record_id, provider, bucket, object_key, object_type, byte_size, shared)
  select p_record_id, 'SUPABASE_STORAGE', 'verify-documents', o ->> 'key', 'VERIFY_OFFICIAL_DOCUMENT',
         (select (so.metadata ->> 'size')::bigint from storage.objects so
           where so.bucket_id = 'verify-documents' and so.name = o ->> 'key'),
         true
    from jsonb_array_elements(coalesce(p_objects, '[]'::jsonb)) o
   where o ->> 'key' ~ '^files/[0-9]{1,12}\.(pdf|jpg|png)$'
  on conflict do nothing;
  get diagnostics v_n = row_count;
  update public.retention_records set objects_scanned_at = now() where id = p_record_id;
  return v_n;
end $$;

create or replace function public.retention_unscanned_reports(p_limit integer default 50)
returns table (record_id uuid, source_id uuid, docs jsonb)
language sql
stable
security definer
set search_path to ''
as $$
  select x.id, x.source_id, j.synthesis_json -> 'officialDocuments'
    from public.retention_records x
    join public.research_jobs j on j.id = x.source_id
   where x.product = 'VERIFY_REPORT' and x.objects_scanned_at is null and x.state = 'ACTIVE'
   order by x.created_at
   limit least(greatest(coalesce(p_limit, 50), 1), 500)
$$;

/* ------------------------------------------------------------------ *
 * 6. Reminders (existing notification infrastructure)                 *
 * ------------------------------------------------------------------ */

create or replace function public.retention_emit_reminders(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_cfg jsonb := public.retention_config();
  r record;
  v_id uuid;
  v_n7 integer := 0;
  v_n1 integer := 0;
begin
  if not coalesce((v_cfg ->> 'reminders_enabled')::boolean, false) then
    return jsonb_build_object('skipped', 'reminders_disabled');
  end if;
  for r in
    select x.* from public.retention_records x
     where x.state = 'ACTIVE' and not x.legal_hold and x.owner_user_id is not null
       and x.expires_at > now()
       and ((x.reminder_7d_at is null and x.expires_at <= now() + interval '7 days' and x.expires_at > now() + interval '1 day')
         or (x.reminder_1d_at is null and x.expires_at <= now() + interval '1 day'))
     order by x.expires_at
     limit least(greatest(coalesce(p_limit, 200), 1), 1000)
  loop
    v_id := public.notify_emit(
      r.owner_user_id, 'RETENTION_EXPIRING'::public.notification_type,
      case when r.product = 'VERIFY_REPORT'
           then 'თქვენი Verify ანგარიში მალე წაიშლება'
           else 'თქვენი ხელშეკრულების ანალიზი მალე წაიშლება' end,
      case when r.product = 'VERIFY_REPORT'
           then 'ანგარიში ხელმისაწვდომია ' || to_char(r.expires_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC-მდე. გირჩევთ, წინასწარ ჩამოტვირთოთ.'
           else 'დოკუმენტი და ანალიზი ხელმისაწვდომია ' || to_char(r.expires_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC-მდე.' end,
      'NORMAL',
      case when r.product = 'VERIFY_REPORT' then '/verify/history' else '/contracts/history' end,
      case when r.product = 'VERIFY_REPORT' then 'research_jobs' else 'deal_room_documents' end,
      r.source_id,
      'retention:' || r.id::text || ':' || case when r.expires_at <= now() + interval '1 day' then '1d' else '7d' end,
      null, interval '5 minutes', null,
      jsonb_build_object('i18n', 'retention.reminder', 'product', r.product, 'expires_at', r.expires_at));
    -- Recorded as "queued to the in-app inbox" with the notification id —
    -- never as delivered. Push/email delivery follows the user's preferences
    -- downstream (push-send), and its outcome is that system's to report.
    if r.expires_at <= now() + interval '1 day' then
      update public.retention_records set reminder_1d_at = now(), reminder_1d_notification = v_id,
             reminder_7d_at = coalesce(reminder_7d_at, now()) where id = r.id;
      v_n1 := v_n1 + 1;
    else
      update public.retention_records set reminder_7d_at = now(), reminder_7d_notification = v_id where id = r.id;
      v_n7 := v_n7 + 1;
    end if;
  end loop;
  return jsonb_build_object('queued_7d', v_n7, 'queued_1d', v_n1);
end $$;

/* ------------------------------------------------------------------ *
 * 7. Cleanup engine (claim -> objects -> payload -> verified)         *
 * ------------------------------------------------------------------ */

-- Why a record due for deletion must wait, or null when it may proceed.
create or replace function public.retention_blocker(p_record_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  x record;
begin
  select * into x from public.retention_records where id = p_record_id;
  if not found then return 'NOT_FOUND'; end if;
  if x.legal_hold then return 'LEGAL_HOLD'; end if;
  if x.expires_at is null or x.expires_at > now() then return 'NOT_EXPIRED'; end if;
  if x.product = 'VERIFY_REPORT' then
    if exists (select 1 from public.research_jobs j where j.id = x.source_id
                and j.result_json -> '_marketRefresh' ->> 'state' = 'RUNNING') then
      return 'ACTIVE_MARKET_REFRESH';
    end if;
    if exists (select 1 from public.human_verification_handoffs h
                where h.research_job_id = x.source_id and h.status = 'PENDING' and h.expires_at > now()) then
      return 'ACTIVE_HANDOFF';
    end if;
    if x.objects_scanned_at is null then return 'REFERENCES_NOT_SCANNED'; end if;
  else
    if exists (select 1 from public.deal_room_documents d where d.id = x.source_id
                and d.analysis_state not in ('NONE', 'DONE', 'FAILED', 'UNSUPPORTED', 'REQUIRES_OCR')) then
      return 'ACTIVE_ANALYSIS';
    end if;
  end if;
  return null;
end $$;

create or replace function public.retention_claim(p_limit integer default 10, p_lease_seconds integer default 600)
returns table (record_id uuid, product text, source_id uuid, lease_token uuid)
language plpgsql
security definer
set search_path to ''
as $$
#variable_conflict use_column
declare
  v_cfg jsonb := public.retention_config();
  v_limit integer := least(greatest(coalesce(p_limit, (v_cfg ->> 'batch_size')::integer, 10), 1), 50);
  v_token uuid := gen_random_uuid();
  r record;
  v_block text;
begin
  -- THE destructive gate. Off by default; nothing is claimed while it is off.
  if not coalesce((v_cfg ->> 'purge_enabled')::boolean, false) then
    return;
  end if;
  for r in
    select x.id from public.retention_records x
     where x.expires_at is not null and x.expires_at <= now() and not x.legal_hold
       and (x.state in ('ACTIVE', 'FAILED') or (x.state = 'PURGING' and x.lease_until < now()))
       and (x.next_attempt_at is null or x.next_attempt_at <= now())
     order by x.expires_at
     limit v_limit * 3
     for update skip locked
  loop
    v_block := public.retention_blocker(r.id);
    if v_block is not null then
      update public.retention_records set last_error = 'BLOCKED:' || v_block,
             next_attempt_at = now() + interval '1 hour' where id = r.id;
      continue;
    end if;
    update public.retention_records x
       set state = 'PURGING', lease_token = v_token,
           lease_until = now() + make_interval(secs => greatest(coalesce(p_lease_seconds, 600), 60)),
           attempts = x.attempts + 1, last_attempt_at = now()
     where x.id = r.id
    returning x.id, x.product, x.source_id, x.lease_token
      into record_id, product, source_id, lease_token;
    insert into public.retention_events (record_id, event) values (r.id, 'CLAIMED');
    return next;
    v_limit := v_limit - 1;
    exit when v_limit <= 0;
  end loop;
end $$;

-- What to do with each object of a claimed record. DELETE only when no other
-- live (unexpired or legally held) reference to the same key exists and, for
-- shared Verify documents, no unregistered report still names the file.
create or replace function public.retention_object_plan(p_record_id uuid, p_lease_token uuid)
returns table (object_id uuid, provider text, bucket text, object_key text, storage_object_id uuid, action text)
language plpgsql
security definer
set search_path to ''
as $$
#variable_conflict use_column
begin
  if not exists (select 1 from public.retention_records x where x.id = p_record_id
                  and x.state = 'PURGING' and x.lease_token = p_lease_token) then
    raise exception 'retention: lease lost' using errcode = 'lock_not_available';
  end if;
  return query
  select o.id, o.provider, o.bucket, o.object_key, o.storage_object_id,
         case
           when o.state in ('DELETED', 'RETAINED') then 'DONE'
           when o.state = 'DEAD_LETTER' then 'MANUAL'
           when exists (
             select 1 from public.retention_objects o2
               join public.retention_records r2 on r2.id = o2.record_id
              where o2.provider = o.provider and o2.bucket = o.bucket and o2.object_key = o.object_key
                and o2.record_id <> o.record_id and r2.state <> 'PURGED'
                and (r2.legal_hold or r2.expires_at is null or r2.expires_at > now())) then 'RETAIN'
           -- Any other report that still names the file and whose own
           -- reference is not already registered as expired keeps it. A false
           -- positive of the text match can only ever RETAIN, never delete.
           when o.object_type = 'VERIFY_OFFICIAL_DOCUMENT' and exists (
             select 1 from public.research_jobs j
              where j.lifecycle_state <> 'PURGED'
                and j.id <> (select r0.source_id from public.retention_records r0 where r0.id = p_record_id)
                and (j.synthesis_json -> 'officialDocuments')::text like
                    '%' || substring(o.object_key from '^files/([0-9]+)\.') || '%'
                and not exists (
                      select 1 from public.retention_records r3
                       where r3.product = 'VERIFY_REPORT' and r3.source_id = j.id
                         and r3.objects_scanned_at is not null and not r3.legal_hold
                         and r3.expires_at is not null and r3.expires_at <= now())) then 'RETAIN'
           when o.object_type = 'CONTRACT_FILE' and exists (
             select 1 from public.deal_room_documents d
              where d.storage_path = o.object_key
                and not exists (select 1 from public.retention_records r4
                                 where r4.product = 'CONTRACT_DOCUMENT' and r4.source_id = d.id)) then 'RETAIN'
           else 'DELETE'
         end
    from public.retention_objects o
   where o.record_id = p_record_id;
end $$;

-- Supabase Storage existence, authoritative for that provider.
create or replace function public.retention_storage_object_exists(p_bucket text, p_key text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (select 1 from storage.objects where bucket_id = p_bucket and name = p_key)
$$;

create or replace function public.retention_object_outcome(
  p_record_id uuid, p_lease_token uuid, p_object_id uuid, p_outcome text, p_error text default null)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  o record;
  v_max integer := coalesce((public.retention_config() ->> 'max_attempts')::integer, 5);
begin
  if not exists (select 1 from public.retention_records x where x.id = p_record_id
                  and x.state = 'PURGING' and x.lease_token = p_lease_token) then
    raise exception 'retention: lease lost' using errcode = 'lock_not_available';
  end if;
  select * into o from public.retention_objects where id = p_object_id and record_id = p_record_id for update;
  if not found then raise exception 'retention: object not in record'; end if;

  if p_outcome = 'VERIFIED_DELETED' then
    -- Every reference to the same key now points at a deleted object.
    update public.retention_objects
       set state = 'DELETED', deleted_at = coalesce(deleted_at, now()), verified_at = now(),
           last_error = null, updated_at = now()
     where provider = o.provider and bucket = o.bucket and object_key = o.object_key;
    if o.provider = 'R2' and o.storage_object_id is not null then
      update public.storage_objects set lifecycle = 'DELETED', deleted_at = coalesce(deleted_at, now()), updated_at = now()
       where id = o.storage_object_id;
    end if;
    insert into public.retention_events (record_id, object_id, event, detail)
    values (p_record_id, o.id, 'OBJECT_DELETED',
            jsonb_build_object('provider', o.provider, 'bucket', o.bucket, 'bytes', o.byte_size));
  elsif p_outcome = 'RETAINED' then
    update public.retention_objects set state = 'RETAINED', updated_at = now() where id = o.id;
    insert into public.retention_events (record_id, object_id, event) values (p_record_id, o.id, 'OBJECT_RETAINED_SHARED');
  elsif p_outcome = 'FAILED' then
    update public.retention_objects
       set attempts = attempts + 1, last_attempt_at = now(), last_error = left(p_error, 300),
           state = case when attempts + 1 >= v_max then 'DEAD_LETTER' else 'FAILED' end,
           next_attempt_at = now() + make_interval(mins => least(power(2, attempts + 1)::integer, 1440)),
           updated_at = now()
     where id = o.id;
    insert into public.retention_events (record_id, object_id, event, detail)
    values (p_record_id, o.id, 'OBJECT_DELETE_FAILED', jsonb_build_object('error', left(p_error, 300)));
  else
    raise exception 'retention: unknown outcome %', p_outcome;
  end if;
end $$;

-- Clear the database payload, keep the tombstone, verify it is gone.
create or replace function public.retention_purge_payload(p_record_id uuid, p_lease_token uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  x record;
  v_before bigint := 0;
  v_after bigint := 0;
  v_snap bigint := 0;
begin
  select * into x from public.retention_records where id = p_record_id for update;
  if not found or x.state <> 'PURGING' or x.lease_token is distinct from p_lease_token then
    raise exception 'retention: lease lost' using errcode = 'lock_not_available';
  end if;
  -- The registry must already hold every external key as deleted or
  -- retained-for-another-reference before the last pointer to it goes.
  if exists (select 1 from public.retention_objects o
              where o.record_id = p_record_id and o.state not in ('DELETED', 'RETAINED')) then
    raise exception 'retention: objects outstanding' using errcode = 'object_not_in_prerequisite_state';
  end if;

  if x.product = 'VERIFY_REPORT' then
    select coalesce(pg_column_size(result_json), 0) + coalesce(pg_column_size(synthesis_json), 0)
           + coalesce(pg_column_size(evidence_bundle), 0) + coalesce(pg_column_size(evidence), 0)
           + coalesce(pg_column_size(documents), 0) + coalesce(pg_column_size(progress), 0)
      into v_before from public.research_jobs where id = x.source_id;
    -- Duplicated report facts copied into a Deal Room / Verification case.
    select coalesce(sum(pg_column_size(verify_snapshot)), 0) into v_snap
      from public.deal_rooms where verify_job_id = x.source_id and verify_snapshot is not null;
    update public.deal_rooms set verify_snapshot = null
     where verify_job_id = x.source_id and verify_snapshot is not null;
    -- status/completed_at/user_id/created_at stay (billing, ledger, history);
    -- lifecycle_state PURGED is terminal and sets deleted_at (existing trigger).
    update public.research_jobs
       set result_json = null, synthesis_json = null, evidence = '[]'::jsonb, evidence_bundle = '[]'::jsonb,
           documents = '[]'::jsonb, progress = '{}'::jsonb, captcha = null, verification_url = null,
           verification_instructions = null, target_url = null, error = null, response_id = null,
           title = null, query = '', lifecycle_state = 'PURGED', purged_at = now(),
           deleted_at = coalesce(deleted_at, now())
     where id = x.source_id;
    select coalesce(pg_column_size(result_json), 0) + coalesce(pg_column_size(synthesis_json), 0)
      into v_after from public.research_jobs where id = x.source_id;
    if v_after <> 0 then raise exception 'retention: payload still present'; end if;
  else
    select coalesce(pg_column_size(analysis), 0) + coalesce(pg_column_size(extracted_text), 0)
      into v_before from public.deal_room_documents where id = x.source_id;
    select v_before + coalesce(sum(pg_column_size(f.*)), 0) into v_before
      from public.deal_room_document_findings f where f.document_id = x.source_id;
    delete from public.deal_room_document_findings where document_id = x.source_id;
    update public.deal_room_document_events set detail = '{}'::jsonb
     where document_id = x.source_id and detail <> '{}'::jsonb;
    -- doc_key is freed so the same file can be uploaded again into the room.
    update public.deal_room_documents
       set analysis = null, extracted_text = null, extracted_pages = null, headline_summary = null,
           analysis_error = null, analysis_sha256 = null, original_filename = null, display_name = null,
           notes = null, evidence_ref = null, storage_path = null, sha256 = null,
           label = 'document', doc_key = 'expired:' || id::text
     where id = x.source_id;
    select coalesce(pg_column_size(analysis), 0) + coalesce(pg_column_size(extracted_text), 0)
      into v_after from public.deal_room_documents where id = x.source_id;
    if v_after <> 0 or exists (select 1 from public.deal_room_document_findings where document_id = x.source_id) then
      raise exception 'retention: payload still present';
    end if;
  end if;

  update public.retention_records
     set state = 'PURGED', purged_at = now(), verified_at = now(), lease_token = null, lease_until = null,
         last_error = null, reclaimed_bytes = v_before + v_snap
           + coalesce((select sum(o.byte_size) from public.retention_objects o
                        where o.record_id = p_record_id and o.state = 'DELETED'), 0)
   where id = p_record_id;
  insert into public.retention_events (record_id, event, detail)
  values (p_record_id, 'PURGED', jsonb_build_object('db_bytes', v_before, 'snapshot_bytes', v_snap));
  return jsonb_build_object('db_bytes', v_before, 'snapshot_bytes', v_snap);
end $$;

create or replace function public.retention_record_failed(p_record_id uuid, p_lease_token uuid, p_error text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_max integer := coalesce((public.retention_config() ->> 'max_attempts')::integer, 5);
begin
  update public.retention_records
     set state = case when attempts >= v_max then 'DEAD_LETTER' else 'FAILED' end,
         last_error = left(p_error, 300), lease_token = null, lease_until = null,
         next_attempt_at = now() + make_interval(mins => least(power(2, attempts)::integer, 1440))
   where id = p_record_id and state = 'PURGING' and lease_token = p_lease_token;
  insert into public.retention_events (record_id, event, detail)
  values (p_record_id, 'PURGE_FAILED', jsonb_build_object('error', left(p_error, 300)));
end $$;

/* ------------------------------------------------------------------ *
 * 8. Customer view: expiry dates and tombstones (own records only)    *
 * ------------------------------------------------------------------ */

create or replace function public.retention_my_records(p_product text, p_source_ids uuid[] default null)
returns table (source_id uuid, product text, available_at timestamptz, expires_at timestamptz,
               state text, expired boolean, label text)
language sql
stable
security definer
set search_path to ''
as $$
  select x.source_id, x.product, x.available_at, x.expires_at,
         case when x.state = 'PURGED' then 'PURGED'
              when x.expires_at is not null and x.expires_at <= now() then 'EXPIRED'
              else 'ACTIVE' end,
         x.expires_at is not null and x.expires_at <= now(),
         x.label
    from public.retention_records x
   where x.owner_user_id = auth.uid() and auth.uid() is not null
     and x.product = p_product
     and (p_source_ids is null or x.source_id = any(p_source_ids))
     and (p_source_ids is not null or x.expires_at is not null)
   order by x.available_at desc
   limit 500
$$;
revoke all on function public.retention_my_records(text, uuid[]) from public, anon;
grant execute on function public.retention_my_records(text, uuid[]) to authenticated;

/* ------------------------------------------------------------------ *
 * 9. Admin: observability, holds, requeue, dry run                    *
 * ------------------------------------------------------------------ */

create or replace function public.retention_admin_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = 'insufficient_privilege'; end if;
  select jsonb_build_object(
    'measured_at', now(),
    'config', public.retention_config(),
    'supabase_storage', (select coalesce(jsonb_object_agg(bucket_id, jsonb_build_object('objects', n, 'bytes', b)), '{}'::jsonb)
                           from (select bucket_id, count(*) n, coalesce(sum((metadata ->> 'size')::bigint), 0) b
                                   from storage.objects group by bucket_id) s),
    'r2', (select coalesce(jsonb_object_agg(namespace || ':' || lifecycle, jsonb_build_object('objects', n, 'bytes', b)), '{}'::jsonb)
             from (select namespace, lifecycle, count(*) n, coalesce(sum(byte_size), 0) b
                     from public.storage_objects where provider = 'R2' group by 1, 2) s),
    'postgres', jsonb_build_object(
      'research_jobs_bytes', pg_total_relation_size('public.research_jobs'),
      'deal_room_documents_bytes', pg_total_relation_size('public.deal_room_documents'),
      'deal_room_document_findings_bytes', pg_total_relation_size('public.deal_room_document_findings'),
      'registry_bytes', pg_total_relation_size('public.retention_records') + pg_total_relation_size('public.retention_objects')
                        + pg_total_relation_size('public.retention_events')),
    'knowledge', jsonb_build_object(
      'market_observations', (select count(*) from public.market_observations where withdrawn_at is null),
      'market_observations_bytes', pg_total_relation_size('public.market_observations'),
      'contract_insight_rows', (select count(*) from public.contract_insight_counts),
      'contract_insight_bytes', pg_total_relation_size('public.contract_insight_counts')),
    'records', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
                  from (select product || ':' || state || case when legal_hold then ':HOLD' else '' end k, count(*) n
                          from public.retention_records group by 1) s),
    'legacy_not_expiring', (select count(*) from public.retention_records where expires_at is null),
    'expiring_7d', (select count(*) from public.retention_records
                     where state = 'ACTIVE' and expires_at > now() and expires_at <= now() + interval '7 days'),
    'expired_awaiting_cleanup', (select count(*) from public.retention_records
                                  where state in ('ACTIVE', 'FAILED', 'PURGING') and expires_at <= now()),
    'estimated_recoverable_bytes', (select coalesce(sum(x.payload_bytes), 0)
                                        + coalesce((select sum(o.byte_size) from public.retention_objects o
                                                      join public.retention_records y on y.id = o.record_id
                                                     where y.expires_at <= now() and y.state <> 'PURGED'
                                                       and o.state in ('ACTIVE', 'FAILED')), 0)
                                      from public.retention_records x where x.expires_at <= now() and x.state <> 'PURGED'),
    'reclaimed_bytes_measured', (select coalesce(sum(reclaimed_bytes), 0) from public.retention_records where state = 'PURGED'),
    'objects', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
                  from (select provider || ':' || state k, count(*) n from public.retention_objects group by 1) s),
    'blocked', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
                  from (select last_error k, count(*) n from public.retention_records
                         where last_error like 'BLOCKED:%' and state <> 'PURGED' group by 1) s),
    'trend_30d', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'purged', n, 'bytes', b) order by d), '[]'::jsonb)
                    from (select (purged_at at time zone 'UTC')::date d, count(*) n, coalesce(sum(reclaimed_bytes), 0) b
                            from public.retention_records where purged_at > now() - interval '30 days' group by 1) s)
  ) into v;
  return v;
end $$;

create or replace function public.retention_admin_set_hold(p_record_id uuid, p_hold boolean, p_reason text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = 'insufficient_privilege'; end if;
  if p_hold and coalesce(btrim(p_reason), '') = '' then raise exception 'a legal hold needs a reason'; end if;
  update public.retention_records set legal_hold = p_hold, legal_hold_reason = case when p_hold then left(p_reason, 200) end
   where id = p_record_id and state <> 'PURGED';
  if not found then return false; end if;
  insert into public.retention_events (record_id, event, detail)
  values (p_record_id, case when p_hold then 'HOLD_SET' else 'HOLD_RELEASED' end,
          jsonb_build_object('reason', left(p_reason, 200), 'by', auth.uid()));
  return true;
end $$;

-- Dead-letter -> retryable, after a human looked at it.
create or replace function public.retention_admin_requeue(p_record_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = 'insufficient_privilege'; end if;
  update public.retention_objects set state = 'FAILED', attempts = 0, next_attempt_at = null
   where record_id = p_record_id and state = 'DEAD_LETTER';
  update public.retention_records set state = 'FAILED', attempts = 0, next_attempt_at = null
   where id = p_record_id and state in ('DEAD_LETTER', 'FAILED');
  if not found then return false; end if;
  insert into public.retention_events (record_id, event, detail)
  values (p_record_id, 'REQUEUED', jsonb_build_object('by', auth.uid()));
  return true;
end $$;

-- DRY RUN: read-only. Computed from the SOURCE tables, so it answers before
-- anything is registered. p_assume_effective_at null = "as if the 30-day
-- rule had always applied" (the worst case for historical data).
create or replace function public.retention_admin_dry_run(
  p_as_of timestamptz default now(), p_assume_effective_at timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v jsonb;
begin
  -- SECURITY DEFINER makes current_user the owner, so the caller is judged by
  -- the API role: an admin JWT, the service role, or a direct database session
  -- (session_user is 'authenticator' for every API call).
  if not (public.is_admin()
          or session_user <> 'authenticator'
          or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role') then
    raise exception 'forbidden' using errcode = 'insufficient_privilege';
  end if;
  with
  vj as (
    select j.id, j.user_id, j.anon_session_id,
           case when j.synthesis_state = 'READY' and j.synthesis_at is not null
                then greatest(j.completed_at, j.synthesis_at) else j.completed_at end av,
           coalesce(pg_column_size(j.result_json), 0) + coalesce(pg_column_size(j.synthesis_json), 0)
             + coalesce(pg_column_size(j.evidence_bundle), 0) + coalesce(pg_column_size(j.evidence), 0)
             + coalesce(pg_column_size(j.documents), 0) + coalesce(pg_column_size(j.progress), 0) bytes,
           j.result_json -> '_marketRefresh' ->> 'state' = 'RUNNING' market_running,
           exists (select 1 from public.deal_rooms d where d.verify_job_id = j.id) linked_room,
           (select coalesce(sum(pg_column_size(d.verify_snapshot)), 0) from public.deal_rooms d where d.verify_job_id = j.id) snap_bytes,
           exists (select 1 from public.verify_billing b where b.job_id = j.id) billed,
           exists (select 1 from public.retention_records r where r.product = 'VERIFY_REPORT' and r.source_id = j.id and r.legal_hold) held
      from public.research_jobs j
     where j.status = 'COMPLETE' and j.completed_at is not null and j.lifecycle_state <> 'PURGED'),
  vx as (
    select vj.*, case when p_assume_effective_at is null or vj.av >= p_assume_effective_at
                      then public.retention_expiry(vj.av) end exp
      from vj),
  cd as (
    select d.id, d.user_id, d.storage_path, coalesce(d.size_bytes, 0) size_bytes,
           greatest(coalesce(d.uploaded_at, d.created_at), coalesce(d.analyzed_at, coalesce(d.uploaded_at, d.created_at))) av,
           coalesce(pg_column_size(d.analysis), 0) + coalesce(pg_column_size(d.extracted_text), 0) bytes,
           r.verify_job_id is not null verify_case,
           d.archived_at is not null archived,
           exists (select 1 from public.retention_records x where x.product = 'CONTRACT_DOCUMENT' and x.source_id = d.id and x.legal_hold) held,
           (select count(*) from public.storage_objects so where so.source_bucket = 'deal-room-documents'
              and so.source_path = d.storage_path and so.provider = 'R2' and so.lifecycle <> 'DELETED') r2_copies,
           (select coalesce(sum(so.byte_size), 0) from public.storage_objects so where so.source_bucket = 'deal-room-documents'
              and so.source_path = d.storage_path and so.provider = 'R2' and so.lifecycle <> 'DELETED') r2_bytes,
           exists (select 1 from storage.objects o where o.bucket_id = 'deal-room-documents' and o.name = d.storage_path) file_present
      from public.deal_room_documents d
      join public.deal_rooms r on r.id = d.deal_room_id
     where (d.storage_path is not null or d.analysis is not null)
       and d.analysis_state in ('DONE', 'FAILED', 'UNSUPPORTED', 'REQUIRES_OCR', 'NONE')
       and d.doc_key not like 'expired:%'),
  cx as (
    select cd.*, case when p_assume_effective_at is null or cd.av >= p_assume_effective_at
                      then public.retention_expiry(cd.av) end exp
      from cd)
  select jsonb_build_object(
    'mode', 'DRY_RUN_READ_ONLY',
    'as_of', p_as_of,
    'assumed_effective_at', p_assume_effective_at,
    'verify', (select jsonb_build_object(
        'completed_reports', count(*),
        'would_expire', count(*) filter (where exp <= p_as_of),
        'protected_legal_hold', count(*) filter (where exp <= p_as_of and held),
        'blocked_market_refresh', count(*) filter (where exp <= p_as_of and market_running),
        'anonymous_session_reports', count(*) filter (where exp <= p_as_of and anon_session_id is not null),
        'linked_deal_rooms', count(*) filter (where exp <= p_as_of and linked_room),
        'billing_rows_kept', count(*) filter (where exp <= p_as_of and billed),
        'db_payload_bytes', coalesce(sum(bytes) filter (where exp <= p_as_of and not held), 0),
        'deal_room_snapshot_bytes', coalesce(sum(snap_bytes) filter (where exp <= p_as_of and not held), 0),
        'ids', coalesce(jsonb_agg(id order by exp) filter (where exp <= p_as_of), '[]'::jsonb)) from vx),
    'contracts', (select jsonb_build_object(
        'documents', count(*),
        'would_expire', count(*) filter (where exp <= p_as_of),
        'protected_legal_hold', count(*) filter (where exp <= p_as_of and held),
        'verification_case_documents', count(*) filter (where exp <= p_as_of and verify_case),
        'archived_documents', count(*) filter (where exp <= p_as_of and archived),
        'db_payload_bytes', coalesce(sum(bytes) filter (where exp <= p_as_of and not held), 0),
        'supabase_objects', count(*) filter (where exp <= p_as_of and not held and file_present),
        'supabase_bytes', coalesce(sum(size_bytes) filter (where exp <= p_as_of and not held and file_present), 0),
        'missing_files', count(*) filter (where storage_path is not null and not file_present),
        'r2_objects', coalesce(sum(r2_copies) filter (where exp <= p_as_of and not held), 0),
        'r2_bytes', coalesce(sum(r2_bytes) filter (where exp <= p_as_of and not held), 0),
        'ids', coalesce(jsonb_agg(id order by exp) filter (where exp <= p_as_of), '[]'::jsonb)) from cx),
    'orphans', jsonb_build_object(
        'deal_room_files_without_row', (select count(*) from storage.objects o where o.bucket_id = 'deal-room-documents'
                                          and not exists (select 1 from public.deal_room_documents d where d.storage_path = o.name)),
        'r2_deal_room_copies_without_source', (select count(*) from public.storage_objects so
                                                 where so.namespace = 'deal-room-documents' and so.lifecycle <> 'DELETED'
                                                   and not exists (select 1 from public.deal_room_documents d where d.storage_path = so.source_path)),
        'r2_pending_over_1h', (select count(*) from public.storage_objects where lifecycle = 'PENDING' and created_at < p_as_of - interval '1 hour'),
        'verify_documents_unreferenced', (select count(*) from storage.objects o where o.bucket_id = 'verify-documents'
                                            and not exists (select 1 from public.research_jobs j
                                                             where (j.synthesis_json -> 'officialDocuments')::text
                                                                   like '%' || substring(o.name from '^files/([0-9]+)\.') || '%'))),
    'out_of_scope_shared_caches', jsonb_build_object(
        'verify_official_visuals', (select jsonb_build_object('objects', count(*), 'bytes', coalesce(sum((metadata ->> 'size')::bigint), 0))
                                      from storage.objects where bucket_id = 'verify-official-visuals'),
        'verify_evidence', (select jsonb_build_object('objects', count(*), 'bytes', coalesce(sum((metadata ->> 'size')::bigint), 0))
                              from storage.objects where bucket_id = 'verify-evidence')),
    'railway', 'Ephemeral container disk only; profile dirs removed on browser close and by the TTL sweep (official-worker/src/browser/LocalBrowserRuntime.ts). No persistent customer files.',
    'vercel', 'Static frontend; no Blob/KV/persistent customer artifacts. Nothing to clean.'
  ) into v;
  return v;
end $$;

/* ------------------------------------------------------------------ *
 * 10. Privileges                                                      *
 * ------------------------------------------------------------------ */

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.retention_config()',
    'public.retention_cfg_ts(jsonb, text)',
    'public.retention_policy_for(timestamptz, jsonb)',
    'public.knowledge_extract_verify(uuid)',
    'public.knowledge_extract_contract(uuid)',
    'public.retention_register_due(integer)',
    'public.retention_add_object_refs(uuid, jsonb)',
    'public.retention_unscanned_reports(integer)',
    'public.retention_emit_reminders(integer)',
    'public.retention_blocker(uuid)',
    'public.retention_claim(integer, integer)',
    'public.retention_object_plan(uuid, uuid)',
    'public.retention_storage_object_exists(text, text)',
    'public.retention_object_outcome(uuid, uuid, uuid, text, text)',
    'public.retention_purge_payload(uuid, uuid)',
    'public.retention_record_failed(uuid, uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.retention_admin_summary()',
    'public.retention_admin_set_hold(uuid, boolean, text)',
    'public.retention_admin_requeue(uuid)',
    'public.retention_admin_dry_run(timestamptz, timestamptz)',
    'public.knowledge_withdraw_observation(bigint, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
