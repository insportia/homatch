-- Publishing V2 is additive. Existing creation jobs and wallet functions remain intact.
create sequence public.publishing_engine_display_seq;
create function public.publishing_engine_next_display_id() returns text language sql volatile set search_path=public,pg_temp as $$
 select 'HM-'||extract(year from now() at time zone 'UTC')::text||'-'||lpad(n::text,greatest(6,length(n::text)),'0') from (select nextval('public.publishing_engine_display_seq') n) s
$$;
alter table public.publishing_engine_listings add constraint publishing_listing_owner_unique unique(id,user_id);
alter table public.publishing_engine_listings add column display_id text unique;
alter table public.publishing_engine_listings add column desired_state text not null default 'DRAFT'
  check (desired_state in ('DRAFT','ACTIVE','PAUSED','ARCHIVED'));
alter table public.publishing_engine_listings add column updated_at timestamptz not null default now();
update public.publishing_engine_listings set display_id=public.publishing_engine_next_display_id();
alter table public.publishing_engine_listings alter column display_id set default public.publishing_engine_next_display_id();
alter table public.publishing_engine_listings alter column display_id set not null;

create table public.publishing_engine_connections (
 user_id uuid not null references public.users(id), portal_id text not null,
 status text not null default 'DISCONNECTED' check(status in ('DISCONNECTED','CONNECTED','AUTH_REQUIRED','ACTION_REQUIRED','EXPIRED')),
 account_hint text, adapter_version text, verified_at timestamptz, expires_at timestamptz,
 primary key(user_id,portal_id)
);
create table public.publishing_engine_publications (
 id uuid primary key default gen_random_uuid(), listing_id uuid not null references public.publishing_engine_listings(id),
 user_id uuid not null references public.users(id), portal_id text not null, external_id text, external_url text,
 observed_state text not null default 'UNKNOWN' check(observed_state in ('UNKNOWN','PUBLISHED','PAUSED','HIDDEN','DELETED')),
 desired_state text not null default 'PUBLISHED', synced_revision integer not null default 0,
 verified_at timestamptz, updated_at timestamptz not null default now(), unique(listing_id,portal_id), unique(user_id,portal_id,external_id)
);
create table public.publishing_engine_operations (
 id uuid primary key default gen_random_uuid(), listing_id uuid not null references public.publishing_engine_listings(id),
 user_id uuid not null references public.users(id), portal_id text not null, external_id text,
 kind text not null check(kind in ('CREATE','PUBLISH','EDIT','UPDATE_PHOTOS','HIDE','PAUSE','RESUME','REFRESH','DELETE','CHECK_STATUS','RECONCILE')),
 desired_revision integer not null, payload jsonb not null, payload_hash text not null,
 status text not null default 'QUEUED' check(status in ('QUEUED','RUNNING','SUCCEEDED','FAILED','AUTH_REQUIRED','ACTION_REQUIRED','RECONCILIATION_REQUIRED','SUPERSEDED','CANCELLED')),
 attempts integer not null default 0, max_attempts integer not null default 5,
 idempotency_key text not null unique, error_code text, available_at timestamptz not null default now(),
 lease_token uuid, lease_until timestamptz, confirmed_at timestamptz, remote_result jsonb,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz
);
create index publishing_operations_ready on public.publishing_engine_operations(user_id,portal_id,available_at) where status in ('QUEUED','AUTH_REQUIRED');
create unique index publishing_one_running on public.publishing_engine_operations(listing_id,portal_id) where status='RUNNING';
create table public.publishing_engine_attempts (
 id bigint generated always as identity primary key, operation_id uuid not null references public.publishing_engine_operations(id),
 user_id uuid not null references public.users(id), attempt integer not null, lease_token uuid not null,
 started_at timestamptz not null default now(), finished_at timestamptz, outcome text, error_code text, unique(operation_id,attempt)
);
create table public.publishing_engine_audit (
 id bigint generated always as identity primary key, user_id uuid not null references public.users(id), actor_id uuid references public.users(id),
 listing_id uuid references public.publishing_engine_listings(id), operation_id uuid, event text not null,
 detail jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.publishing_engine_settings (
 singleton boolean primary key default true check(singleton), daily_credits numeric not null default 10 check(daily_credits>0 and daily_credits<=1000),
 billing_enabled boolean not null default true, grace_seconds integer not null default 0 check(grace_seconds between 0 and 86400),
 max_attempts integer not null default 5 check(max_attempts between 1 and 10), retry_seconds integer not null default 30 check(retry_seconds between 30 and 3600),
 allow_promotional_credits boolean not null default true, updated_at timestamptz not null default now()
);
insert into public.publishing_engine_settings(singleton) values(true);
create table public.publishing_engine_subscriptions (
 listing_id uuid primary key references public.publishing_engine_listings(id), user_id uuid not null references public.users(id),
 status text not null check(status in ('PENDING','ACTIVE','PAUSE_AT_PERIOD_END','PAUSED','INSUFFICIENT_BALANCE','RECONCILIATION_REQUIRED','CANCELLED')),
 consent_id uuid not null default gen_random_uuid(), consented_at timestamptz not null default now(),
 authorized_daily_credits numeric not null check(authorized_daily_credits>0), reservation_id uuid,
 period_start timestamptz, paid_until timestamptz, next_billing_at timestamptz, updated_at timestamptz not null default now()
);
create table public.publishing_engine_billing_events (
 id uuid primary key default gen_random_uuid(), listing_id uuid not null references public.publishing_engine_listings(id),user_id uuid not null references public.users(id),
 period_start timestamptz not null, credits numeric not null check(credits>0), reservation_id uuid not null,
 ledger_reference text not null, refunded_at timestamptz, created_at timestamptz not null default now(), unique(listing_id,period_start), unique(reservation_id)
);
-- Reuse the existing wallet product registry. Do not modify other products or ledger functions.
insert into public.billable_products(code,name,billing_mode,requires_reservation,standard_retail_cents,estimate_strategy,config)
 values('PUBLISHING_LISTING_DAY','Property publishing · daily','FIXED',true,100,'FIXED','{"daily_credits":10}') on conflict(code) do nothing;

do $$declare t text;begin
 foreach t in array array['connections','publications','operations','attempts','audit','subscriptions','billing_events'] loop
  execute format('alter table public.publishing_engine_%I enable row level security',t);
  execute format('create policy owner_read on public.publishing_engine_%I for select to authenticated using (user_id=public.get_user_id() or public.is_admin())',t);
  execute format('revoke all on public.publishing_engine_%I from anon,authenticated',t);
  execute format('grant select on public.publishing_engine_%I to authenticated',t);
  execute format('grant all on public.publishing_engine_%I to service_role',t);
 end loop;
end$$;
alter table public.publishing_engine_settings enable row level security;
create policy publishing_settings_read on public.publishing_engine_settings for select to authenticated using(true);
revoke all on public.publishing_engine_settings from anon,authenticated;
grant select on public.publishing_engine_settings to authenticated;
grant all on public.publishing_engine_settings to service_role;
grant usage,select on public.publishing_engine_display_seq,public.publishing_engine_attempts_id_seq,public.publishing_engine_audit_id_seq to service_role;

alter table public.publishing_engine_publications add foreign key(listing_id,user_id) references public.publishing_engine_listings(id,user_id);
alter table public.publishing_engine_operations add foreign key(listing_id,user_id) references public.publishing_engine_listings(id,user_id);
alter table public.publishing_engine_subscriptions add foreign key(listing_id,user_id) references public.publishing_engine_listings(id,user_id);
alter table public.publishing_engine_billing_events add foreign key(listing_id,user_id) references public.publishing_engine_listings(id,user_id);
create index publishing_subscriptions_due on public.publishing_engine_subscriptions(next_billing_at) where status in ('ACTIVE','PENDING','PAUSE_AT_PERIOD_END');
-- Every V2 mutation is service-role only. The authenticated API resolves the owner, never a client owner ID.
create function public.publishing_engine_save_draft(p_owner uuid,p_id uuid,p_version integer,p_listing jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v public.publishing_engine_listings; v_id uuid; v_version integer; v_payload jsonb; r record;
begin
 if p_id is null then
  insert into public.properties(user_id,source_type,title,property_type,transaction_type,matching_status)
   values(p_owner,'PRIVATE_LISTING',coalesce(nullif(p_listing->>'title',''),'Draft'),
    (case when upper(p_listing->>'propertyType') in ('APARTMENT','HOUSE','LAND','COMMERCIAL') then upper(p_listing->>'propertyType') else 'OTHER' end)::public.property_type,
    (case when p_listing->>'dealType'='sale' then 'SALE' else 'RENT' end)::public.transaction_type,'DRAFT') returning id into v_id;
  v_version:=1;
 else
  select * into v from public.publishing_engine_listings where id=p_id and user_id=p_owner for update;
  if not found then raise exception 'OWNED_RECORD_REQUIRED'; end if;
  if v.version<>p_version then raise exception 'VERSION_CONFLICT'; end if;
  if v.desired_state='ARCHIVED' then raise exception 'LISTING_ARCHIVED'; end if;
  v_id:=p_id;v_version:=v.version+1;
 end if;
 v_payload:=p_listing||jsonb_build_object('id',v_id,'version',v_version);
 insert into public.publishing_engine_listings(id,user_id,version,payload) values(v_id,p_owner,v_version,v_payload)
  on conflict(id) do update set version=excluded.version,payload=excluded.payload,updated_at=now() returning * into v;
 insert into public.publishing_engine_versions(listing_id,user_id,version,payload) values(v_id,p_owner,v_version,v_payload);
 -- Only not-yet-started edits are coalesced. A started old edit is allowed to finish, then the newer edit follows.
 update public.publishing_engine_operations set status='SUPERSEDED',updated_at=now()
  where listing_id=v_id and kind in ('EDIT','UPDATE_PHOTOS','PUBLISH') and status in ('QUEUED','AUTH_REQUIRED','ACTION_REQUIRED','FAILED');
 for r in select * from public.publishing_engine_publications where listing_id=v_id and observed_state in ('PUBLISHED','PAUSED','HIDDEN') loop
  insert into public.publishing_engine_operations(listing_id,user_id,portal_id,external_id,kind,desired_revision,payload,payload_hash,idempotency_key,max_attempts)
   values(v_id,p_owner,r.portal_id,r.external_id,'EDIT',v_version,v_payload,encode(sha256(convert_to(v_payload::text,'UTF8')),'hex'),v_id||':'||r.portal_id||':EDIT:'||v_version,(select max_attempts from public.publishing_engine_settings where singleton)) on conflict do nothing;
 end loop;
 insert into public.publishing_engine_audit(user_id,actor_id,listing_id,event,detail) values(p_owner,p_owner,v_id,'DRAFT_SAVED',jsonb_build_object('revision',v_version));
 return v.payload||jsonb_build_object('displayId',v.display_id,'desiredState',v.desired_state);
end$$;

create function public.publishing_engine_enqueue(p_owner uuid,p_listing uuid,p_version integer,p_portals text[],p_kind text,p_confirmed boolean default false,p_request uuid default null)
returns setof public.publishing_engine_operations language plpgsql security invoker set search_path=public,pg_temp as $$
declare v public.publishing_engine_listings; dest text; remote public.publishing_engine_publications; k text;
begin
 if p_kind not in ('CREATE','PUBLISH','EDIT','UPDATE_PHOTOS','HIDE','PAUSE','RESUME','REFRESH','DELETE','CHECK_STATUS','RECONCILE') then raise exception 'UNSUPPORTED_OPERATION'; end if;
 select * into v from public.publishing_engine_listings where id=p_listing and user_id=p_owner for update;
 if not found then raise exception 'OWNED_RECORD_REQUIRED';end if;
 if v.version<>p_version then raise exception 'VERSION_CONFLICT';end if;
 if coalesce(array_length(p_portals,1),0)=0 or array_length(p_portals,1)>20 then raise exception 'PORTAL_REQUIRED';end if;
 if p_kind in ('PUBLISH','DELETE','REFRESH') and not p_confirmed then raise exception 'EXPLICIT_CONFIRMATION_REQUIRED';end if;
 foreach dest in array p_portals loop
  if not coalesce(v.payload->'portalTargets' ? dest,false) then raise exception 'PORTAL_NOT_SELECTED';end if;
  select * into remote from public.publishing_engine_publications where listing_id=v.id and portal_id=dest;
  if p_kind='PUBLISH' and remote.external_id is not null and remote.observed_state<>'DELETED' then raise exception 'RECONCILIATION_REQUIRED';end if;
  if p_kind not in ('CREATE','PUBLISH') and remote.external_id is null then raise exception 'REMOTE_LISTING_REQUIRED';end if;
  if p_kind='PUBLISH' and not exists(select 1 from public.publishing_engine_subscriptions where listing_id=v.id and status in ('PENDING','ACTIVE') and user_id=p_owner) then raise exception 'ACTIVATION_REQUIRED';end if;
  if p_kind not in ('CREATE','PUBLISH','CHECK_STATUS','RECONCILE','PAUSE','HIDE','DELETE') and exists(select 1 from public.publishing_engine_subscriptions where listing_id=v.id and status not in ('PENDING','ACTIVE','PAUSE_AT_PERIOD_END')) then raise exception 'SUBSCRIPTION_INACTIVE';end if;
  if p_kind in ('HIDE','PAUSE','RESUME','REFRESH','DELETE','CHECK_STATUS','RECONCILE') and p_request is null then raise exception 'REQUEST_ID_REQUIRED';end if;
  k:=v.id||':'||dest||':'||p_kind||':'||v.version||case when p_kind in ('HIDE','PAUSE','RESUME','REFRESH','DELETE','CHECK_STATUS','RECONCILE') then ':'||p_request else '' end;
  insert into public.publishing_engine_operations(listing_id,user_id,portal_id,external_id,kind,desired_revision,payload,payload_hash,idempotency_key,confirmed_at,max_attempts)
   values(v.id,p_owner,dest,case when p_kind='PUBLISH' then null else remote.external_id end,p_kind,v.version,v.payload,encode(sha256(convert_to(v.payload::text,'UTF8')),'hex'),k,case when p_confirmed then now() end,(select max_attempts from public.publishing_engine_settings where singleton)) on conflict do nothing;
  return query select * from public.publishing_engine_operations where idempotency_key=k;
 end loop;
 insert into public.publishing_engine_audit(user_id,actor_id,listing_id,event,detail) values(p_owner,p_owner,v.id,'OPERATIONS_QUEUED',jsonb_build_object('kind',p_kind,'portals',p_portals,'revision',p_version));
end$$;

create function public.publishing_engine_claim(p_owner uuid,p_portal text,p_verified_kinds text[])
returns setof public.publishing_engine_operations language plpgsql security invoker set search_path=public,pg_temp as $$
declare op public.publishing_engine_operations;
begin
 -- Mutations with an expired lease are never blindly retried: the remote side may have succeeded.
 update public.publishing_engine_operations set status='RECONCILIATION_REQUIRED',error_code='LEASE_EXPIRED',updated_at=now()
  where user_id=p_owner and portal_id=p_portal and status='RUNNING' and lease_until<now();
 if not exists(select 1 from public.publishing_engine_connections where user_id=p_owner and portal_id=p_portal and status='CONNECTED' and expires_at>now()) then return;end if;
 -- Serialize a portal's browser session and rate-limit it to one operation per 10 seconds.
 if not pg_try_advisory_xact_lock(hashtextextended(p_owner||':'||p_portal,0)) then return;end if;
 if exists(select 1 from public.publishing_engine_operations where user_id=p_owner and portal_id=p_portal and (status='RUNNING' or updated_at>now()-interval '10 seconds' and status='SUCCEEDED')) then return;end if;
 select o.* into op from public.publishing_engine_operations o join public.publishing_engine_listings l on l.id=o.listing_id
  where o.user_id=p_owner and o.portal_id=p_portal and o.status in ('QUEUED','AUTH_REQUIRED') and o.available_at<=now()
   and o.kind=any(p_verified_kinds) and o.attempts<o.max_attempts
   and not exists(select 1 from public.publishing_engine_operations old where old.listing_id=o.listing_id and old.portal_id=o.portal_id and old.created_at<o.created_at and old.status in ('RUNNING','RECONCILIATION_REQUIRED'))
   and (o.kind not in ('EDIT','UPDATE_PHOTOS') or o.desired_revision=l.version)
   and (o.kind in ('CHECK_STATUS','RECONCILE','PAUSE','HIDE','DELETE','CREATE') or exists(select 1 from public.publishing_engine_subscriptions s where s.listing_id=o.listing_id and s.status in ('ACTIVE','PENDING','PAUSE_AT_PERIOD_END')))
  order by o.created_at for update of o skip locked limit 1;
 if not found then return;end if;
 update public.publishing_engine_operations set status='RUNNING',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now() where id=op.id returning * into op;
 insert into public.publishing_engine_attempts(operation_id,user_id,attempt,lease_token) values(op.id,p_owner,op.attempts,op.lease_token);
 return next op;
end$$;

create function public.publishing_engine_finish(p_owner uuid,p_operation uuid,p_lease uuid,p_verified boolean,p_result jsonb,p_error text default null)
returns public.publishing_engine_operations language plpgsql security invoker set search_path=public,pg_temp as $$
declare op public.publishing_engine_operations; state text; all_paused boolean;
begin
 select * into op from public.publishing_engine_operations where id=p_operation and user_id=p_owner for update;
 if not found then raise exception 'OWNED_RECORD_REQUIRED';end if;
 if op.status='SUCCEEDED' and op.lease_token=p_lease then return op;end if;
 if op.status<>'RUNNING' or op.lease_token is distinct from p_lease or op.lease_until<now() then raise exception 'LEASE_CONFLICT';end if;
 if p_verified then
  if p_result->>'operationId' is distinct from op.id::text or (p_result->>'revision')::integer is distinct from op.desired_revision or p_result->>'payloadHash' is distinct from op.payload_hash or coalesce(p_result->>'externalId','')='' then raise exception 'RESULT_MISMATCH';end if;
  state:=p_result->>'remoteState';
  if state is null or state not in ('PUBLISHED','PAUSED','HIDDEN','DELETED') then raise exception 'RESULT_MISMATCH';end if;
  insert into public.publishing_engine_publications(listing_id,user_id,portal_id,external_id,external_url,observed_state,synced_revision,verified_at)
   values(op.listing_id,op.user_id,op.portal_id,p_result->>'externalId',p_result->>'externalUrl',state,case when op.kind in ('PUBLISH','EDIT','UPDATE_PHOTOS') then op.desired_revision else 0 end,now())
   on conflict(listing_id,portal_id) do update set external_id=excluded.external_id,external_url=excluded.external_url,observed_state=excluded.observed_state,
    synced_revision=greatest(publishing_engine_publications.synced_revision,excluded.synced_revision),verified_at=now(),updated_at=now();
  update public.publishing_engine_operations set status='SUCCEEDED',completed_at=now(),error_code=null,updated_at=now(),remote_result=jsonb_build_object('externalId',p_result->>'externalId','externalUrl',p_result->>'externalUrl','remoteState',state,'revision',op.desired_revision) where id=op.id returning * into op;
  -- A canonical edit may land while initial publication is in flight.
  insert into public.publishing_engine_operations(listing_id,user_id,portal_id,external_id,kind,desired_revision,payload,payload_hash,idempotency_key)
   select l.id,l.user_id,op.portal_id,p_result->>'externalId','EDIT',l.version,l.payload,encode(sha256(convert_to(l.payload::text,'UTF8')),'hex'),l.id||':'||op.portal_id||':EDIT:'||l.version
   from public.publishing_engine_listings l where l.id=op.listing_id and l.version>op.desired_revision and state<>'DELETED' on conflict do nothing;
  select not exists(select 1 from public.publishing_engine_publications where listing_id=op.listing_id and observed_state='PUBLISHED') into all_paused;
  if all_paused then
   update public.publishing_engine_listings set desired_state='PAUSED',updated_at=now() where id=op.listing_id and desired_state='ACTIVE';
   perform public.wallet_release(reservation_id,'publishing_activation_not_delivered','{}') from public.publishing_engine_subscriptions where listing_id=op.listing_id and status='PENDING' and reservation_id is not null;
   update public.publishing_engine_subscriptions set status=case when status='PENDING' then 'CANCELLED' else 'PAUSE_AT_PERIOD_END' end,updated_at=now() where listing_id=op.listing_id and status in ('PENDING','ACTIVE');
  else
   update public.publishing_engine_listings set desired_state='ACTIVE',updated_at=now() where id=op.listing_id and desired_state<>'ARCHIVED';
   update public.publishing_engine_subscriptions set status='ACTIVE',updated_at=now() where listing_id=op.listing_id and status='PAUSE_AT_PERIOD_END' and paid_until>now();
  end if;
 else
  update public.publishing_engine_operations set status=case when p_error='AUTH_REQUIRED' then 'AUTH_REQUIRED' when p_error in ('PORTAL_TEMPORARILY_UNAVAILABLE','RATE_LIMITED') and attempts<max_attempts then 'QUEUED' when p_error='CAPABILITY_UNVERIFIED' then 'ACTION_REQUIRED' else 'RECONCILIATION_REQUIRED' end,
   error_code=left(coalesce(p_error,'REMOTE_UNVERIFIED'),80),available_at=now()+make_interval(secs=>least(3600,(select retry_seconds from public.publishing_engine_settings where singleton)*power(2,attempts-1))::int),updated_at=now() where id=op.id returning * into op;
 end if;
 update public.publishing_engine_attempts set finished_at=now(),outcome=op.status,error_code=op.error_code where operation_id=op.id and lease_token=p_lease;
 insert into public.publishing_engine_audit(user_id,actor_id,listing_id,operation_id,event,detail) values(p_owner,p_owner,op.listing_id,op.id,'OPERATION_RESULT',jsonb_build_object('status',op.status,'revision',op.desired_revision));
 return op;
end$$;

create function public.publishing_engine_activate(p_owner uuid,p_listing uuid,p_price numeric,p_confirmed boolean)
returns public.publishing_engine_subscriptions language plpgsql security invoker set search_path=public,pg_temp as $$
declare s public.publishing_engine_subscriptions; settings public.publishing_engine_settings; v_owner uuid; hold record;
begin
 select user_id into v_owner from public.publishing_engine_listings where id=p_listing and user_id=p_owner for update;
 if not found then raise exception 'OWNED_RECORD_REQUIRED';end if;
 select * into settings from public.publishing_engine_settings where singleton;
 if not settings.billing_enabled then raise exception 'BILLING_DISABLED';end if;
 if not p_confirmed then raise exception 'PAID_ACTIVATION_CONFIRMATION_REQUIRED';end if;
 if settings.daily_credits<>p_price then raise exception 'PRICE_CHANGED';end if;
 select * into s from public.publishing_engine_subscriptions where listing_id=p_listing for update;
 if found and s.status in ('PENDING','ACTIVE') then return s;end if;
 if found and s.paid_until>now() then update public.publishing_engine_subscriptions set status='ACTIVE',updated_at=now() where listing_id=p_listing returning * into s;return s;end if;
 insert into public.publishing_engine_subscriptions(listing_id,user_id,status,authorized_daily_credits) values(p_listing,p_owner,'PENDING',settings.daily_credits)
  on conflict(listing_id) do update set status='PENDING',consent_id=gen_random_uuid(),consented_at=now(),authorized_daily_credits=settings.daily_credits,updated_at=now() returning * into s;
 select * into hold from public.wallet_reserve(p_owner,'PUBLISHING_LISTING_DAY',settings.daily_credits,'publishing:'||p_listing||':activate:'||s.consent_id,settings.daily_credits,settings.daily_credits,p_listing::text,'{"product":"publishing"}');
 update public.publishing_engine_subscriptions set reservation_id=hold.reservation_id where listing_id=p_listing returning * into s;
 update public.publishing_engine_listings set desired_state='ACTIVE',updated_at=now() where id=p_listing;
 insert into public.publishing_engine_audit(user_id,actor_id,listing_id,event,detail) values(p_owner,p_owner,p_listing,'PAID_ACTIVATION_CONSENT',jsonb_build_object('price',settings.daily_credits));
 return s;
end$$;

-- Reuse the already-installed project scheduler. No new service or extension is provisioned.
do $$begin
 if to_regnamespace('cron') is not null then
  perform cron.schedule('publishing-engine-daily-billing','*/5 * * * *',
   $cron$select set_config('request.jwt.claims','{"role":"service_role"}',true); select public.publishing_engine_bill_due(100);$cron$);
 end if;
end$$;

create function public.publishing_engine_bill_due(p_limit integer default 100)
returns integer language plpgsql security invoker set search_path=public,pg_temp as $$
declare s public.publishing_engine_subscriptions; cfg public.publishing_engine_settings; hold record; settlement record; start_at timestamptz; n integer:=0;
begin
 select * into cfg from public.publishing_engine_settings where singleton;
 if not cfg.billing_enabled or not cfg.allow_promotional_credits then return 0;end if;
 for s in select * from public.publishing_engine_subscriptions where status in ('ACTIVE','PENDING','PAUSE_AT_PERIOD_END') and (next_billing_at is null or next_billing_at<=now()) order by consented_at for update skip locked limit least(greatest(p_limit,1),1000) loop
  if s.status='PAUSE_AT_PERIOD_END' then update public.publishing_engine_subscriptions set status='PAUSED',next_billing_at=null,updated_at=now() where listing_id=s.listing_id;continue;end if;
  if s.status='ACTIVE' and s.next_billing_at+make_interval(secs=>cfg.grace_seconds)>now() then continue;end if;
  if not exists(select 1 from public.publishing_engine_publications where listing_id=s.listing_id and observed_state='PUBLISHED' and verified_at>now()-interval '48 hours') or (s.status='PENDING' and exists(select 1 from public.publishing_engine_listings l cross join lateral jsonb_array_elements_text(l.payload->'portalTargets') target where l.id=s.listing_id and not exists(select 1 from public.publishing_engine_publications p where p.listing_id=l.id and p.portal_id=target and p.observed_state='PUBLISHED' and p.verified_at>now()-interval '48 hours'))) then
   if s.status='PENDING' and s.consented_at>now()-interval '1 hour' then continue;end if;
   if s.status='PENDING' and s.reservation_id is not null then perform public.wallet_release(s.reservation_id,'publishing_activation_not_verified','{}');end if;
   update public.publishing_engine_subscriptions set status='RECONCILIATION_REQUIRED',updated_at=now() where listing_id=s.listing_id;continue;
  end if;
  if cfg.daily_credits>s.authorized_daily_credits then update public.publishing_engine_subscriptions set status='PAUSED',updated_at=now() where listing_id=s.listing_id;continue;end if;
  start_at:=case when s.status='PENDING' then now() else s.next_billing_at end;
  -- Do not back-charge periods missed during downtime. Start a new service period now.
  if start_at<now()-interval '1 hour' then start_at:=now();end if;
  if exists(select 1 from public.publishing_engine_billing_events where listing_id=s.listing_id and period_start=start_at) then continue;end if;
  begin
   if s.status='PENDING' then select s.reservation_id as reservation_id into hold;
   else select * into hold from public.wallet_reserve(s.user_id,'PUBLISHING_LISTING_DAY',cfg.daily_credits,'publishing:'||s.listing_id||':'||extract(epoch from start_at)::text,cfg.daily_credits,cfg.daily_credits,s.listing_id::text,'{"product":"publishing"}');end if;
   select * into settlement from public.wallet_settle(hold.reservation_id,cfg.daily_credits,jsonb_build_object('provider_operation','publishing_daily','metadata',jsonb_build_object('listing_id',s.listing_id)),'SUCCESS');
   if settlement.settled_credits<>cfg.daily_credits then raise exception 'RESERVATION_NOT_SETTLED';end if;
   insert into public.publishing_engine_billing_events(listing_id,user_id,period_start,credits,reservation_id,ledger_reference)
    values(s.listing_id,s.user_id,start_at,cfg.daily_credits,hold.reservation_id,'res:'||hold.reservation_id||':cap');
   update public.publishing_engine_subscriptions set status='ACTIVE',period_start=start_at,paid_until=start_at+interval '24 hours',next_billing_at=start_at+interval '24 hours',updated_at=now() where listing_id=s.listing_id;
   n:=n+1;
  exception when others then
   if sqlerrm not like 'INSUFFICIENT_CREDITS%' and sqlerrm<>'RESERVATION_NOT_SETTLED' then raise;end if;
   update public.publishing_engine_subscriptions set status=case when sqlerrm='RESERVATION_NOT_SETTLED' then 'RECONCILIATION_REQUIRED' else 'INSUFFICIENT_BALANCE' end,updated_at=now() where listing_id=s.listing_id;
   insert into public.publishing_engine_audit(user_id,listing_id,event) values(s.user_id,s.listing_id,case when sqlerrm='RESERVATION_NOT_SETTLED' then 'ACTIVATION_NOT_SETTLED' else 'INSUFFICIENT_CREDITS' end);
  end;
 end loop;return n;
end$$;

create function public.publishing_engine_archive(p_owner uuid,p_listing uuid,p_version integer,p_confirmed boolean)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v public.publishing_engine_listings;begin
 select * into v from public.publishing_engine_listings where id=p_listing and user_id=p_owner for update;
 if not found then raise exception 'OWNED_RECORD_REQUIRED';end if;
 if v.version<>p_version then raise exception 'VERSION_CONFLICT';end if;
 if not p_confirmed then raise exception 'EXPLICIT_CONFIRMATION_REQUIRED';end if;
 if exists(select 1 from public.publishing_engine_publications where listing_id=v.id and external_id is not null and observed_state<>'DELETED') or exists(select 1 from public.publishing_engine_operations where listing_id=v.id and status in ('RUNNING','RECONCILIATION_REQUIRED')) then raise exception 'REMOTE_LISTINGS_UNRESOLVED';end if;
 update public.publishing_engine_operations set status='CANCELLED',updated_at=now() where listing_id=v.id and status not in ('SUCCEEDED','SUPERSEDED','CANCELLED');
 perform public.wallet_release(reservation_id,'publishing_draft_archived','{}') from public.publishing_engine_subscriptions where listing_id=v.id and status='PENDING' and reservation_id is not null;
 update public.publishing_engine_subscriptions set status='CANCELLED',next_billing_at=null,updated_at=now() where listing_id=v.id;
 update public.publishing_engine_listings set desired_state='ARCHIVED',updated_at=now() where id=v.id;
 insert into public.publishing_engine_audit(user_id,actor_id,listing_id,event) values(p_owner,p_owner,v.id,'CANONICAL_ARCHIVED');
 return jsonb_build_object('id',v.id,'desiredState','ARCHIVED');
end$$;

create function public.publishing_engine_ai_claim(p_owner uuid,p_listing uuid) returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare correlation uuid:=gen_random_uuid();begin
 if not exists(select 1 from public.publishing_engine_listings where id=p_listing and user_id=p_owner) then raise exception 'OWNED_RECORD_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner||':publishing-ai',0));
 if (select count(*) from public.publishing_engine_audit where user_id=p_owner and event='AI_REQUESTED' and created_at>now()-interval '24 hours')>=20 then raise exception 'AI_RATE_LIMIT';end if;
 insert into public.publishing_engine_audit(user_id,actor_id,listing_id,event,detail) values(p_owner,p_owner,p_listing,'AI_REQUESTED',jsonb_build_object('correlationId',correlation));return correlation;
end$$;

create function public.publishing_engine_configure(p_actor uuid,p_settings jsonb) returns public.publishing_engine_settings language plpgsql security invoker set search_path=public,pg_temp as $$
declare v public.publishing_engine_settings;begin
 if not exists(select 1 from public.users where id=p_actor and is_admin) then raise exception 'ADMIN_REQUIRED';end if;
 if p_settings ? 'allow_promotional_credits' and (p_settings->>'allow_promotional_credits')::boolean=false then raise exception 'PROMOTIONAL_POLICY_UNSUPPORTED';end if;
 update public.publishing_engine_settings set daily_credits=coalesce((p_settings->>'daily_credits')::numeric,daily_credits),billing_enabled=coalesce((p_settings->>'billing_enabled')::boolean,billing_enabled),
  grace_seconds=coalesce((p_settings->>'grace_seconds')::integer,grace_seconds),max_attempts=coalesce((p_settings->>'max_attempts')::integer,max_attempts),retry_seconds=coalesce((p_settings->>'retry_seconds')::integer,retry_seconds),updated_at=now() where singleton returning * into v;
 insert into public.publishing_engine_audit(user_id,actor_id,event,detail) values(p_actor,p_actor,'ADMIN_PRICING_CHANGED',to_jsonb(v));return v;
end$$;

create function public.publishing_engine_refund(p_actor uuid,p_event uuid,p_reason text,p_confirmed boolean) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare e public.publishing_engine_billing_events;begin
 if not exists(select 1 from public.users where id=p_actor and is_admin) then raise exception 'ADMIN_REQUIRED';end if;
 if not p_confirmed or length(trim(coalesce(p_reason,'')))<5 then raise exception 'REFUND_CONFIRMATION_REQUIRED';end if;
 select * into e from public.publishing_engine_billing_events where id=p_event for update;
 if not found then raise exception 'BILLING_EVENT_REQUIRED';end if;
 if e.refunded_at is not null then return jsonb_build_object('refunded',true,'duplicate',true);end if;
 perform public.wallet_admin_adjust(e.user_id,e.credits,p_reason,'publishing:refund:'||e.id);
 update public.publishing_engine_billing_events set refunded_at=now() where id=e.id;
 insert into public.publishing_engine_audit(user_id,actor_id,listing_id,event,detail) values(e.user_id,p_actor,e.listing_id,'ADMIN_REFUND',jsonb_build_object('billingEvent',e.id,'credits',e.credits,'reason',left(p_reason,500)));
 return jsonb_build_object('refunded',true,'credits',e.credits);
end$$;

do $$declare f record;begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('publishing_engine_save_draft','publishing_engine_enqueue','publishing_engine_claim','publishing_engine_finish','publishing_engine_activate','publishing_engine_bill_due','publishing_engine_archive','publishing_engine_ai_claim','publishing_engine_configure','publishing_engine_refund','publishing_engine_next_display_id') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end$$;
