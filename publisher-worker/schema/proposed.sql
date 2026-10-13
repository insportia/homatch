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
  phase text not null default 'preparing' check (phase in ('preparing','validating','connecting','uploading','submitting','reconciling','awaiting_moderation','published','removed','inactive','action_required','failed')),
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
revoke all on all tables in schema publisher_private from public,anon,authenticated;
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
  -- Lease cleanup must still work when an owner soft-deletes the source property.
  -- Execution permission separately checks current property ownership/deletion.
  if tg_table_name='publisher_jobs' and tg_op='UPDATE' then
    if row(new.user_id,new.property_id,new.portal_id,new.account_id,new.version_id,new.publication_id,new.operation,new.idempotency_key,new.confirmation_id)
      is distinct from row(old.user_id,old.property_id,old.portal_id,old.account_id,old.version_id,old.publication_id,old.operation,old.idempotency_key,old.confirmation_id) then raise exception 'IMMUTABLE_JOB_IDENTITY'; end if;
    return new;
  end if;
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
    update public.publisher_attempts attempt set ended_at=now(),outcome='lease_expired',error_code='LEASE_EXPIRED'
      from public.publisher_jobs job where job.id=attempt.job_id and job.lease_token=attempt.lease_token
      and job.portal_id=portal.id and job.state='running' and job.leased_until<=now() and attempt.ended_at is null;
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
  if p_phase='submitting' and not public.publisher_allowed(p_job,p_token,(select portal_id from public.publisher_jobs where id=p_job)) then return false; end if;
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

create function publisher_private.immutable_version() returns trigger
language plpgsql security invoker set search_path='' as $$
begin raise exception 'IMMUTABLE_PROPERTY_VERSION'; end $$;
create trigger publisher_versions_immutable before update on public.publisher_versions
  for each row execute function publisher_private.immutable_version();

create function public.publisher_allowed(p_job uuid,p_token uuid,p_portal text)
returns boolean language sql security invoker set search_path='' as $$
  select exists(select 1 from public.publisher_jobs j
    join public.publisher_portals p on p.id=j.portal_id
    join public.publisher_accounts a on a.id=j.account_id
    join publisher_private.controls c on c.singleton
    join public.properties prop on prop.id=j.property_id and prop.user_id=j.user_id
    where j.id=p_job and j.lease_token=p_token and j.portal_id=p_portal
      and j.state='running' and j.leased_until>now() and not prop.is_deleted
      and p.enabled and not p.maintenance and p.permission='verified' and c.enabled
      and a.status='connected' and a.revoked_at is null
      and coalesce((p.operations->>j.operation)::boolean,false));
$$;

create function public.publisher_context(p_job uuid,p_token uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select jsonb_build_object('jobId',j.id,'userId',j.user_id,'accountId',j.account_id,
    'listing',v.normalized,'externalId',pub.external_id,'expectedExternalVersion',pub.external_version)
  from public.publisher_jobs j
  join public.publisher_versions v on v.id=j.version_id and v.user_id=j.user_id and v.property_id=j.property_id
  join public.publisher_publications pub on pub.id=j.publication_id
  where j.id=p_job and j.lease_token=p_token and j.state='running' and j.leased_until>now();
$$;

create function public.publisher_finish(p_job uuid,p_token uuid,p_state text,p_code text default null,p_available_at timestamptz default null,p_result jsonb default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare j public.publisher_jobs; v public.publisher_versions; domain_name text;
begin
  if p_state not in ('succeeded','retry','action_required','failed','dead_letter') then raise exception 'INVALID_JOB_TRANSITION'; end if;
  if p_code is not null and p_code !~ '^[A-Z][A-Z0-9_]{1,80}$' then raise exception 'INVALID_ERROR_CODE'; end if;
  select * into j from public.publisher_jobs where id=p_job and lease_token=p_token and state='running' and leased_until>now() for update;
  if not found then return false; end if;
  if p_state='retry' and j.submission_started then raise exception 'RECONCILIATION_REQUIRED'; end if;
  if p_state='retry' and (p_available_at is null or p_available_at<=now() or p_available_at>now()+interval '20 minutes') then raise exception 'INVALID_RETRY_WINDOW'; end if;
  if p_state='succeeded' then
    select domain into domain_name from public.publisher_portals where id=j.portal_id;
    if p_result is null or length(coalesce(p_result->>'externalId','')) not between 1 and 200
      or length(coalesce(p_result->>'externalUrl',''))>2048
      or coalesce(p_result->>'externalUrl','') !~ ('^https://([a-z0-9-]+\.)*'||replace(domain_name,'.','\.')||'(/|$)')
      or coalesce(p_result->>'status','') not in ('published','awaiting_moderation','removed','inactive') then raise exception 'INVALID_PORTAL_RESULT'; end if;
    if j.operation='remove' and p_result->>'status'<>'removed' then raise exception 'INVALID_REMOVE_RESULT'; end if;
    if j.operation in ('publish','update') and p_result->>'status' not in ('published','awaiting_moderation') then raise exception 'INVALID_PUBLICATION_RESULT'; end if;
    select * into v from public.publisher_versions where id=j.version_id;
    update public.publisher_publications set external_id=p_result->>'externalId',external_url=p_result->>'externalUrl',
      external_version=p_result->>'externalVersion',status=p_result->>'status',
      applied_version=case when j.operation in ('publish','update') then v.version else applied_version end,
      current_price=case when j.operation in ('publish','update') then (v.normalized->'price'->>'amount')::numeric else current_price end,
      current_currency=case when j.operation in ('publish','update') then v.normalized->'price'->>'currency' else current_currency end,
      last_synced_at=now(),updated_at=now() where id=j.publication_id;
  end if;
  update public.publisher_jobs set state=p_state,error_code=p_code,
    phase=case when p_state='succeeded' then p_result->>'status' when p_state='action_required' then 'action_required' when p_state='retry' then 'preparing' else 'failed' end,
    available_at=coalesce(p_available_at,available_at),lease_token=null,leased_until=null,worker_id=null,updated_at=now() where id=j.id;
  update public.publisher_attempts set ended_at=now(),outcome=p_state,error_code=p_code where job_id=j.id and lease_token=p_token and ended_at is null;
  insert into public.publisher_events(user_id,job_id,portal_id,event,error_code) values(j.user_id,j.id,j.portal_id,case when p_state='succeeded' then p_result->>'status' else p_state end,p_code);
  return true;
end $$;

-- This RPC is only callable by the verified-user edge endpoint using its worker credential.
-- Exact saved selections and confirmation are validated atomically with the property lock.
create function public.publisher_enqueue(p_user uuid,p_property uuid,p_version uuid,p_portals text[],p_operation text,p_confirmation uuid)
returns setof public.publisher_jobs language plpgsql security invoker set search_path='' as $$
declare selected text[]; portal_name text; a public.publisher_accounts; pub public.publisher_publications; v public.publisher_versions; key_text text; existing public.publisher_jobs;
begin
  perform 1 from public.properties where id=p_property and user_id=p_user and not is_deleted for update;
  if not found then raise exception 'PROPERTY_NOT_OWNED'; end if;
  if p_operation not in ('publish','update','remove','status') or p_confirmation is null then raise exception 'INVALID_OPERATION'; end if;
  if cardinality(p_portals) not between 1 and 20 or exists(select 1 from unnest(p_portals) x where x is null) then raise exception 'INVALID_SELECTION'; end if;
  if cardinality(p_portals)<>(select count(distinct x) from unnest(p_portals) x) then raise exception 'DUPLICATE_SELECTION'; end if;
  select portal_ids into selected from public.publisher_selections where property_id=p_property and user_id=p_user;
  if selected is null or not (selected @> p_portals and p_portals @> selected) then raise exception 'SELECTION_NOT_CONFIRMED'; end if;
  select * into v from public.publisher_versions where id=p_version and property_id=p_property and user_id=p_user;
  if not found then raise exception 'VERSION_NOT_OWNED'; end if;
  if v.version<>(select max(version) from public.publisher_versions where property_id=p_property) then raise exception 'STALE_PROPERTY_VERSION'; end if;
  if not exists(select 1 from publisher_private.controls where enabled) then raise exception 'PUBLISHING_DISABLED'; end if;
  foreach portal_name in array p_portals loop
    key_text=encode(sha256(convert_to(concat_ws(':',p_user,p_property,portal_name,p_operation,p_version,p_confirmation),'UTF8')),'hex');
    select * into existing from public.publisher_jobs where idempotency_key=key_text;
    if found then return next existing; continue; end if;
    perform 1 from public.publisher_portals where id=portal_name and enabled and not maintenance and permission='verified' and coalesce((operations->>p_operation)::boolean,false) for share;
    if not found then raise exception 'PORTAL_NOT_ELIGIBLE'; end if;
    select * into a from public.publisher_accounts where portal_id=portal_name and user_id=p_user and status='connected' and revoked_at is null for update;
    if not found then raise exception 'ACCOUNT_NOT_CONNECTED'; end if;
    insert into public.publisher_publications(property_id,user_id,portal_id,account_id) values(p_property,p_user,portal_name,a.id)
      on conflict(property_id,portal_id) do nothing;
    select * into pub from public.publisher_publications where property_id=p_property and portal_id=portal_name for update;
    if pub.account_id<>a.id then raise exception 'ACCOUNT_MAPPING_CONFLICT'; end if;
    if p_operation='publish' and pub.external_id is not null then raise exception 'ALREADY_PUBLISHED'; end if;
    if p_operation<>'publish' and pub.external_id is null then raise exception 'EXTERNAL_MAPPING_REQUIRED'; end if;
    if p_operation in ('update','remove') and pub.external_version is null then raise exception 'EXTERNAL_VERSION_REQUIRED'; end if;
    insert into public.publisher_jobs(user_id,property_id,portal_id,account_id,version_id,publication_id,operation,idempotency_key,confirmation_id)
      values(p_user,p_property,portal_name,a.id,v.id,pub.id,p_operation,key_text,p_confirmation) returning * into existing;
    return next existing;
  end loop;
end $$;

create function public.publisher_cancel(p_user uuid,p_job uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare j public.publisher_jobs;
begin
  update public.publisher_jobs set state='cancelled',updated_at=now()
    where id=p_job and user_id=p_user and state in ('queued','retry','action_required') and not submission_started returning * into j;
  if not found then return false; end if;
  insert into public.publisher_events(user_id,job_id,portal_id,event) values(j.user_id,j.id,j.portal_id,'cancelled');
  return true;
end $$;

create function public.publisher_disconnect(p_user uuid,p_account uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  update public.publisher_accounts set status='disconnected',revoked_at=now() where id=p_account and user_id=p_user;
  if not found then return false; end if;
  delete from publisher_private.sessions where account_id=p_account;
  update public.publisher_challenges set state='cancelled' where account_id=p_account and user_id=p_user and state='pending';
  update public.publisher_jobs set state='cancelled',updated_at=now() where account_id=p_account and user_id=p_user and state in ('queued','retry') and not submission_started;
  return true;
end $$;

create function public.publisher_worker_health(p_worker text,p_adapter_versions jsonb,p_active_contexts integer,p_rss_bytes bigint)
returns void language sql security invoker set search_path='' as $$
  insert into publisher_private.worker_health(worker_id,adapter_versions,active_contexts,rss_bytes,heartbeat_at)
  values(p_worker,p_adapter_versions,p_active_contexts,p_rss_bytes,now())
  on conflict(worker_id) do update set adapter_versions=excluded.adapter_versions,active_contexts=excluded.active_contexts,rss_bytes=excluded.rss_bytes,heartbeat_at=now();
$$;

revoke all on function public.publisher_allowed(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.publisher_context(uuid,uuid) from public,anon,authenticated;
revoke all on function public.publisher_finish(uuid,uuid,text,text,timestamptz,jsonb) from public,anon,authenticated;
revoke all on function public.publisher_enqueue(uuid,uuid,uuid,text[],text,uuid) from public,anon,authenticated;
revoke all on function public.publisher_cancel(uuid,uuid) from public,anon,authenticated;
revoke all on function public.publisher_disconnect(uuid,uuid) from public,anon,authenticated;
revoke all on function public.publisher_worker_health(text,jsonb,integer,bigint) from public,anon,authenticated;
grant execute on function public.publisher_allowed(uuid,uuid,text) to service_role;
grant execute on function public.publisher_context(uuid,uuid) to service_role;
grant execute on function public.publisher_finish(uuid,uuid,text,text,timestamptz,jsonb) to service_role;
grant execute on function public.publisher_enqueue(uuid,uuid,uuid,text[],text,uuid) to service_role;
grant execute on function public.publisher_cancel(uuid,uuid) to service_role;
grant execute on function public.publisher_disconnect(uuid,uuid) to service_role;
grant execute on function public.publisher_worker_health(text,jsonb,integer,bigint) to service_role;

-- Still a review draft. Remaining gates: photo hashing/normalized snapshot writer,
-- account-auth/session persistence RPCs and challenge routing, admin/retry RPCs,
-- retention, realtime grants, two-user RLS and concurrent transaction integration tests.
-- Do not deploy this draft or enable a portal until those gates pass.

create function public.publisher_save_selection(p_user uuid,p_property uuid,p_portals text[])
returns void language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.properties where id=p_property and user_id=p_user and not is_deleted for update;
  if not found then raise exception 'PROPERTY_NOT_OWNED'; end if;
  if p_portals is null or cardinality(p_portals)>20 or exists(select 1 from unnest(p_portals) x where x is null)
    or cardinality(p_portals)<>(select count(distinct x) from unnest(p_portals) x)
    or exists(select 1 from unnest(p_portals) x where not exists(select 1 from public.publisher_portals p where p.id=x)) then raise exception 'INVALID_SELECTION'; end if;
  insert into public.publisher_selections(property_id,user_id,portal_ids) values(p_property,p_user,p_portals)
  on conflict(property_id) do update set portal_ids=excluded.portal_ids,updated_at=now();
end $$;

create function public.publisher_snapshot(p_user uuid,p_property uuid,p_normalized jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v public.publisher_versions; digest_text text;
begin
  perform 1 from public.properties where id=p_property and user_id=p_user and not is_deleted for update;
  if not found then raise exception 'PROPERTY_NOT_OWNED'; end if;
  if p_normalized->>'id' is distinct from p_property::text or p_normalized->>'ownerId' is distinct from p_user::text then raise exception 'SNAPSHOT_OWNERSHIP_MISMATCH'; end if;
  digest_text=encode(sha256(convert_to((p_normalized-'version')::text,'UTF8')),'hex');
  select * into v from public.publisher_versions where property_id=p_property order by version desc limit 1;
  if found and v.fingerprint=digest_text then return to_jsonb(v); end if;
  insert into public.publisher_versions(property_id,user_id,version,normalized,fingerprint)
    values(p_property,p_user,coalesce(v.version,0)+1,p_normalized||jsonb_build_object('version',coalesce(v.version,0)+1),digest_text) returning * into v;
  return to_jsonb(v);
end $$;

create function public.publisher_retry(p_user uuid,p_job uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare j public.publisher_jobs;
begin
  select * into j from public.publisher_jobs where id=p_job and user_id=p_user and state in ('failed','dead_letter','action_required') for update;
  if not found then return false; end if;
  -- Preserve submission_started. The engine MUST reconcile before repeating any mutation.
  if j.attempts>=5 then raise exception 'RETRY_BUDGET_EXHAUSTED'; end if;
  update public.publisher_jobs set state='retry',available_at=now(),max_attempts=least(5,greatest(max_attempts,attempts+1)),error_code=null,updated_at=now() where id=j.id;
  insert into public.publisher_events(user_id,job_id,portal_id,event) values(j.user_id,j.id,j.portal_id,'retry_requested');
  return true;
end $$;

create function public.publisher_admin(p_user uuid,p_action text,p_portal text default null,p_enabled boolean default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  if not exists(select 1 from public.users where id=p_user and is_admin and suspended_at is null) then raise exception 'ADMIN_REQUIRED'; end if;
  if p_action='kill_switch' and p_enabled is not null then
    update publisher_private.controls set enabled=p_enabled;
    insert into public.publisher_events(user_id,event) values(p_user,case when p_enabled then 'engine_enabled' else 'engine_disabled' end);
  elsif p_action='portal_switch' and p_enabled is not null then
    update public.publisher_portals set maintenance=not p_enabled,updated_at=now() where id=p_portal;
    if not found then raise exception 'UNKNOWN_PORTAL'; end if;
    insert into public.publisher_events(user_id,portal_id,event) values(p_user,p_portal,case when p_enabled then 'maintenance_disabled' else 'maintenance_enabled' end);
  elsif p_action<>'snapshot' then raise exception 'INVALID_ADMIN_ACTION';
  end if;
  return jsonb_build_object('enabled',(select enabled from publisher_private.controls),
    'portals',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'adapterVersion',adapter_version,'verification',verification,'maintenance',maintenance,'enabled',enabled,'maxConcurrency',max_concurrency)),'[]') from public.publisher_portals),
    'jobCounts',(select coalesce(jsonb_object_agg(state,n),'{}') from (select state,count(*) n from public.publisher_jobs group by state) counts),
    'workers',(select coalesce(jsonb_agg(to_jsonb(h)),'[]') from publisher_private.worker_health h),
    'accounts',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from (select portal_id,status,count(*) count from public.publisher_accounts group by portal_id,status) a),
    'errors',(select coalesce(jsonb_agg(to_jsonb(e)),'[]') from (select portal_id,error_code,count(*) count from public.publisher_jobs where error_code is not null group by portal_id,error_code) e));
end $$;
revoke all on function public.publisher_save_selection(uuid,uuid,text[]) from public,anon,authenticated;
revoke all on function public.publisher_snapshot(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.publisher_retry(uuid,uuid) from public,anon,authenticated;
revoke all on function public.publisher_admin(uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.publisher_save_selection(uuid,uuid,text[]) to service_role;
grant execute on function public.publisher_snapshot(uuid,uuid,jsonb) to service_role;
grant execute on function public.publisher_retry(uuid,uuid) to service_role;
grant execute on function public.publisher_admin(uuid,text,text,boolean) to service_role;
