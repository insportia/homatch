-- REVIEW DRAFT, NOT A MIGRATION. Not applied to any database.
-- Generate the append-only migration with the installed Supabase CLI after
-- isolated checkout, migration-history reconciliation and local DB integration tests.
-- HOMATCH ownership uses public.users.id / get_user_id(), NOT auth.uid().

create schema if not exists publisher_private;
revoke all on schema publisher_private from public, anon, authenticated;
grant usage on schema publisher_private to service_role;

create table public.publisher_portals (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{1,40}$'),
  domain text not null unique,
  name text not null,
  registration_url text,
  adapter_version text not null,
  verification text not null check (verification in ('DISCOVERED','ADAPTER_IMPLEMENTED','MOCK_TESTED','AUTH_TESTED','LIVE_CREATE_VERIFIED','LIVE_EDIT_VERIFIED','LIVE_DELETE_VERIFIED','PRODUCTION_READY','ASSISTED_ONLY','BLOCKED')),
  permission text not null default 'pending' check (permission in ('pending','verified','restricted')),
  operations jsonb not null default '{}',
  metadata jsonb not null default '{}',
  enabled boolean not null default false,
  maintenance boolean not null default true,
  max_concurrency integer not null default 1 check (max_concurrency between 1 and 8),
  min_interval_seconds integer not null default 60 check (min_interval_seconds >= 10),
  next_start_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.publisher_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  portal_id text not null references public.publisher_portals(id),
  status text not null default 'disconnected' check (status in ('disconnected','connecting','connected','expired','action_required')),
  last_connected_at timestamptz,
  revoked_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  unique (id,user_id,portal_id),
  unique (user_id,portal_id)
);
create table publisher_private.sessions (
  account_id uuid primary key references public.publisher_accounts(id) on delete cascade,
  envelope jsonb not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create table public.publisher_versions (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  version integer not null check (version > 0),
  -- Contains private contact/address data. SELECT only by owning HOMATCH user.
  normalized jsonb not null,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique(property_id,version),
  unique(id,user_id,property_id)
);
create table public.publisher_selections (
  property_id uuid primary key references public.properties(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  portal_ids text[] not null default '{}',
  updated_at timestamptz not null default now()
);
create table public.publisher_publications (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  portal_id text not null references public.publisher_portals(id),
  account_id uuid not null,
  foreign key (account_id,user_id,portal_id) references public.publisher_accounts(id,user_id,portal_id),
  external_id text,
  external_url text,
  external_version text,
  applied_version integer,
  status text not null default 'draft' check (status in ('draft','awaiting_moderation','published','inactive','removed','action_required','failed')),
  current_price numeric,
  current_currency text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(property_id,portal_id),
  unique(portal_id,account_id,external_id),
  unique(id,user_id,property_id,portal_id,account_id)
);
create table public.publisher_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  portal_id text not null references public.publisher_portals(id),
  account_id uuid not null,
  version_id uuid not null,
  publication_id uuid not null,
  foreign key (account_id,user_id,portal_id) references public.publisher_accounts(id,user_id,portal_id),
  foreign key (version_id,user_id,property_id) references public.publisher_versions(id,user_id,property_id),
  foreign key (publication_id,user_id,property_id,portal_id,account_id) references public.publisher_publications(id,user_id,property_id,portal_id,account_id),
  operation text not null check (operation in ('publish','update','remove','status')),
  idempotency_key text not null unique check (idempotency_key ~ '^[a-f0-9]{64}$'),
  confirmation_id uuid not null,
  -- Caller cannot write jobs directly. Authenticated edge endpoint must compare
  -- exact selected/confirmed portal sets, validate ownership and normalized version.
  state text not null default 'queued' check (state in ('queued','running','retry','succeeded','failed','action_required','dead_letter','cancelled')),
  phase text not null default 'preparing' check (phase in ('preparing','validating','connecting','uploading','submitting','reconciling','awaiting_moderation','published','action_required','failed')),
  priority integer not null default 0 check (priority between 0 and 100),
  attempts integer not null default 0,
  max_attempts integer not null default 3 check (max_attempts between 1 and 5),
  available_at timestamptz not null default now(),
  lease_token uuid,
  leased_until timestamptz,
  worker_id text,
  submission_started boolean not null default false,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (state <> 'running' or (lease_token is not null and leased_until is not null))
);
create unique index publisher_one_active_mutation on public.publisher_jobs(publication_id)
  where state in ('queued','running','retry','action_required') and operation <> 'status';
create index publisher_claim_queue on public.publisher_jobs(portal_id,priority desc,available_at,created_at)
  where state in ('queued','retry');
create index publisher_expired_leases on public.publisher_jobs(leased_until) where state='running';
create table public.publisher_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.publisher_jobs(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  attempt integer not null,
  lease_token uuid not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  outcome text,
  error_code text,
  unique(job_id,attempt)
);
create table public.publisher_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  portal_id text not null,
  account_id uuid not null,
  connection_attempt_id uuid not null,
  foreign key (account_id,user_id,portal_id) references public.publisher_accounts(id,user_id,portal_id),
  worker_id text not null,
  state text not null check (state in ('pending','consumed','expired','cancelled')),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 5),
  created_at timestamptz not null default now()
  -- Deliberately no OTP, credential, cookie or browser-state columns.
);
create table public.publisher_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  job_id uuid references public.publisher_jobs(id) on delete cascade,
  portal_id text references public.publisher_portals(id),
  event text not null,
  error_code text,
  created_at timestamptz not null default now()
  -- No free-form payload/error text; portal exceptions frequently contain PII.
);
create table publisher_private.controls (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false
);
insert into publisher_private.controls(singleton,enabled) values(true,false);
create table publisher_private.worker_health (
  worker_id text primary key,
  adapter_versions jsonb not null,
  active_contexts integer not null,
  rss_bytes bigint not null,
  heartbeat_at timestamptz not null default now()
);

-- Defense in depth: sessions/control/health cannot be read through the public API.
alter table publisher_private.sessions enable row level security;
alter table publisher_private.controls enable row level security;
alter table publisher_private.worker_health enable row level security;
grant all on all tables in schema publisher_private to service_role;

-- All mutation goes through authenticated server authorization or fenced worker RPC.
-- Users cannot forge connected accounts, publication success, capabilities or jobs.
do $$
declare n text;
begin
  foreach n in array array['publisher_accounts','publisher_versions','publisher_selections','publisher_publications','publisher_jobs','publisher_attempts','publisher_challenges','publisher_events'] loop
    execute format('alter table public.%I enable row level security',n);
    execute format('revoke all on public.%I from public,anon,authenticated',n);
    execute format('grant select on public.%I to authenticated',n);
    execute format('grant all on public.%I to service_role',n);
    execute format('create policy owner_read on public.%I for select to authenticated using (user_id = (select public.get_user_id()))',n);
  end loop;
end $$;
alter table public.publisher_portals enable row level security;
revoke all on public.publisher_portals from public,anon,authenticated;
grant select on public.publisher_portals to authenticated;
grant all on public.publisher_portals to service_role;
create policy portal_catalog_read on public.publisher_portals for select to authenticated using (true);
grant usage,select on sequence public.publisher_events_id_seq to service_role;

-- Ownership is checked even for service-role writes, not merely RLS reads.
create function publisher_private.check_property_owner() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if not exists(select 1 from public.properties p where p.id=new.property_id and p.user_id=new.user_id and not p.is_deleted) then
    raise exception 'PROPERTY_NOT_OWNED';
  end if;
  return new;
end $$;
create trigger publisher_versions_owner before insert or update on public.publisher_versions
  for each row execute function publisher_private.check_property_owner();
create trigger publisher_selections_owner before insert or update on public.publisher_selections
  for each row execute function publisher_private.check_property_owner();
create trigger publisher_publications_owner before insert or update on public.publisher_publications
  for each row execute function publisher_private.check_property_owner();
create trigger publisher_jobs_owner before insert or update on public.publisher_jobs
  for each row execute function publisher_private.check_property_owner();

create function public.publisher_claim(p_worker text,p_lease_seconds integer default 120)
returns setof public.publisher_jobs language plpgsql security invoker set search_path='' as $$
declare portal public.publisher_portals; claimed public.publisher_jobs;
begin
  if p_worker is null or length(p_worker)>120 or p_lease_seconds not between 30 and 300 then raise exception 'INVALID_WORKER_LEASE'; end if;
  if not exists(select 1 from publisher_private.controls where enabled) then return; end if;
  -- Portal-row lock serializes distributed concurrency/throttle accounting,
  -- including lease recovery. No advisory hash collisions or process-local limits.
  for portal in select * from public.publisher_portals where enabled and not maintenance and permission='verified' order by next_start_at for update skip locked loop
    update public.publisher_jobs set
      state=case when submission_started then 'action_required' when attempts>=max_attempts then 'dead_letter' else 'retry' end,
      phase=case when submission_started then 'action_required' else 'preparing' end,
      error_code=case when submission_started then 'RECONCILIATION_REQUIRED' else 'LEASE_EXPIRED' end,
      lease_token=null,leased_until=null,worker_id=null,updated_at=now(),
      available_at=now()+interval '30 seconds'
    where portal_id=portal.id and state='running' and leased_until<=now();
    if portal.next_start_at>now() then continue; end if;
    if (select count(*) from public.publisher_jobs where portal_id=portal.id and state='running' and leased_until>now())>=portal.max_concurrency then continue; end if;
    select j.* into claimed from public.publisher_jobs j
      join public.publisher_accounts a on a.id=j.account_id and a.user_id=j.user_id and a.portal_id=j.portal_id
      where j.portal_id=portal.id and j.state in ('queued','retry') and j.available_at<=now() and j.attempts<j.max_attempts
      and a.status='connected' and a.revoked_at is null
      and coalesce((portal.operations->>j.operation)::boolean,false)
      and not exists(select 1 from public.publisher_jobs active where active.account_id=j.account_id and active.state='running' and active.leased_until>now())
      order by j.priority desc,j.available_at,j.created_at limit 1 for update of j skip locked;
    if not found then continue; end if;
    update public.publisher_jobs set state='running',attempts=attempts+1,worker_id=p_worker,
      lease_token=gen_random_uuid(),leased_until=now()+make_interval(secs=>p_lease_seconds),updated_at=now()
      where id=claimed.id returning * into claimed;
    update public.publisher_portals set next_start_at=now()+make_interval(secs=>portal.min_interval_seconds) where id=portal.id;
    insert into public.publisher_attempts(job_id,user_id,attempt,lease_token) values(claimed.id,claimed.user_id,claimed.attempts,claimed.lease_token);
    return next claimed; return;
  end loop;
end $$;

create function public.publisher_heartbeat(p_job uuid,p_token uuid,p_lease_seconds integer default 120)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if p_lease_seconds not between 30 and 300 then raise exception 'INVALID_LEASE'; end if;
  update public.publisher_jobs set leased_until=now()+make_interval(secs=>p_lease_seconds),updated_at=now()
  where id=p_job and lease_token=p_token and state='running' and leased_until>now();
  return found;
end $$;

create function public.publisher_event(p_job uuid,p_token uuid,p_phase text,p_submission_started boolean default false)
returns boolean language plpgsql security invoker set search_path='' as $$
declare j public.publisher_jobs;
begin
  update public.publisher_jobs set phase=p_phase,submission_started=submission_started or p_submission_started,updated_at=now()
  where id=p_job and lease_token=p_token and state='running' and leased_until>now() returning * into j;
  if not found then return false; end if;
  insert into public.publisher_events(user_id,job_id,portal_id,event) values(j.user_id,j.id,j.portal_id,p_phase);
  return true;
end $$;

-- Explicit grants: no SECURITY DEFINER public function or default PUBLIC execute.
revoke all on function public.publisher_claim(text,integer) from public,anon,authenticated;
revoke all on function public.publisher_heartbeat(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.publisher_event(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.publisher_claim(text,integer) to service_role;
grant execute on function public.publisher_heartbeat(uuid,uuid,integer) to service_role;
grant execute on function public.publisher_event(uuid,uuid,text,boolean) to service_role;

-- Remaining release gates: enqueue/finish/cancel/revoke/admin RPCs, immutable version
-- enforcement, attempt closure on lease expiry, private session RPC, challenge routing,
-- retention, realtime grants, two-user RLS and concurrent transaction integration tests.
-- Do not deploy this draft or enable a portal until those gates pass.
