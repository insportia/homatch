-- Additive managed HTTP execution; requires publishing_engine_v2. Never stores secret values.
create table public.publishing_engine_managed_accounts (
 id uuid primary key default gen_random_uuid(),portal_id text not null unique check(portal_id in ('myhome','ssge')),
 enabled boolean not null default false,
 status text not null default 'BLOCKED' check(status in ('AUTHENTICATED','SERVER_ACCESS_VERIFIED','PUBLISH_CAPABLE','MANAGEMENT_CAPABLE','BLOCKED','EXPIRED','REAUTH_REQUIRED')),
 remote_account_id text,secret_reference text,verified_operations jsonb not null default '{}' check(jsonb_typeof(verified_operations)='object'),
 authorization_evidence text,authorized_at timestamptz,authorization_expires_at timestamptz,
 last_operation_at timestamptz,last_error_code text,account_listing_limit integer check(account_listing_limit>=0),
 min_interval_seconds integer not null default 10 check(min_interval_seconds between 10 and 3600),updated_at timestamptz not null default now()
);
insert into public.publishing_engine_managed_accounts(portal_id,last_error_code) values('myhome','PORTAL_API_APPROVAL_REQUIRED'),('ssge','PORTAL_API_APPROVAL_REQUIRED');
alter table public.publishing_engine_managed_accounts enable row level security;
revoke all on public.publishing_engine_managed_accounts from public,anon,authenticated;
grant select on public.publishing_engine_managed_accounts to authenticated;
create policy publishing_managed_admin_read on public.publishing_engine_managed_accounts for select to authenticated using(public.is_admin());
grant all on public.publishing_engine_managed_accounts to service_role;
alter table public.publishing_engine_operations add column managed_account_id uuid references public.publishing_engine_managed_accounts(id);
alter table public.publishing_engine_publications add column managed_account_id uuid references public.publishing_engine_managed_accounts(id);
create unique index publishing_managed_remote_identity on public.publishing_engine_publications(managed_account_id,external_id) where managed_account_id is not null and external_id is not null;

create function public.publishing_engine_authorize_managed(p_portal text,p_account text,p_expires timestamptz,p_evidence text,p_capabilities jsonb)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.publishing_engine_managed_accounts;
begin
 select * into a from public.publishing_engine_managed_accounts where portal_id=p_portal for update;
 if not found or coalesce(p_account,'')='' or length(p_account)>200 or p_expires is null or p_expires<=now() or coalesce(p_evidence,'')='' or jsonb_typeof(p_capabilities) is distinct from 'object' then raise exception 'AUTH_REQUIRED';end if;
 if a.remote_account_id is not null and a.remote_account_id<>p_account and exists(select 1 from public.publishing_engine_publications where managed_account_id=a.id and observed_state<>'DELETED') then raise exception 'ACCOUNT_REASSIGNMENT_DENIED';end if;
 -- Authorizing never enables a provider. Admin release gates remain independent.
 update public.publishing_engine_managed_accounts set remote_account_id=p_account,status='SERVER_ACCESS_VERIFIED',authorized_at=now(),authorization_expires_at=least(p_expires,now()+interval '1 hour'),authorization_evidence=left(p_evidence,500),verified_operations=p_capabilities,last_error_code=null,updated_at=now() where id=a.id;
end$$;

create function public.publishing_engine_claim_managed(p_portal text,p_verified_kinds text[])
returns setof public.publishing_engine_operations language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.publishing_engine_managed_accounts;op public.publishing_engine_operations;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('publishing-managed:'||p_portal,0)) then return;end if;
 select * into a from public.publishing_engine_managed_accounts where portal_id=p_portal for update;
 if not found or not a.enabled or a.status not in ('SERVER_ACCESS_VERIFIED','PUBLISH_CAPABLE','MANAGEMENT_CAPABLE') or a.authorization_expires_at is null or a.authorization_expires_at<=now() or coalesce(a.authorization_evidence,'')='' then return;end if;
 update public.publishing_engine_operations set status='RECONCILIATION_REQUIRED',error_code='LEASE_EXPIRED',updated_at=now() where managed_account_id=a.id and status='RUNNING' and lease_until<now();
 if exists(select 1 from public.publishing_engine_operations where managed_account_id=a.id and (status='RUNNING' or updated_at>now()-make_interval(secs=>a.min_interval_seconds) and status='SUCCEEDED')) then return;end if;
 select o.* into op from public.publishing_engine_operations o join public.publishing_engine_listings l on l.id=o.listing_id
 where o.portal_id=p_portal and o.status in ('QUEUED','AUTH_REQUIRED') and o.available_at<=now() and o.attempts<o.max_attempts
 and o.kind=any(p_verified_kinds) and a.verified_operations->o.kind->>'verified'='true' and coalesce(a.verified_operations->o.kind->>'evidence','')<>''
 and (o.kind not in ('PUBLISH','DELETE','REFRESH') or o.confirmed_at is not null)
 and (o.kind<>'REFRESH' or a.verified_operations->o.kind->>'paidPromotion'='false' and a.verified_operations->o.kind->>'meaning' in ('FREE_RENEWAL','FREE_DATE_BUMP','FREE_VISIBILITY_REFRESH'))
 and coalesce(a.verified_operations->o.kind->>'paidPromotion','false')='false'
 and (o.kind<>'PUBLISH' or o.external_id is null and not exists(select 1 from public.publishing_engine_publications p where p.listing_id=o.listing_id and p.portal_id=o.portal_id and p.external_id is not null and p.observed_state<>'DELETED'))
 and (o.kind<>'PUBLISH' or a.account_listing_limit is null or (select count(*) from public.publishing_engine_publications where managed_account_id=a.id and observed_state<>'DELETED')<a.account_listing_limit)
 and (o.kind in ('CREATE','PUBLISH') or exists(select 1 from public.publishing_engine_publications p where p.listing_id=o.listing_id and p.user_id=o.user_id and p.portal_id=o.portal_id and p.managed_account_id=a.id and p.external_id=o.external_id))
 and (o.kind in ('CHECK_STATUS','RECONCILE') or not exists(select 1 from public.publishing_engine_operations old where old.listing_id=o.listing_id and old.portal_id=o.portal_id and old.created_at<o.created_at and old.status in ('RUNNING','RECONCILIATION_REQUIRED')))
 and (o.kind not in ('EDIT','UPDATE_PHOTOS','PUBLISH') or o.desired_revision=l.version)
 and (o.kind in ('CHECK_STATUS','RECONCILE','PAUSE','HIDE','DELETE','CREATE') or exists(select 1 from public.publishing_engine_subscriptions s where s.listing_id=o.listing_id and s.status in ('ACTIVE','PENDING','PAUSE_AT_PERIOD_END')))
 order by o.created_at for update of o skip locked limit 1;
 if not found then return;end if;
 update public.publishing_engine_operations set managed_account_id=a.id,status='RUNNING',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now() where id=op.id returning * into op;
 insert into public.publishing_engine_attempts(operation_id,user_id,attempt,lease_token) values(op.id,op.user_id,op.attempts,op.lease_token);
 return next op;
end$$;

create function public.publishing_engine_checkpoint_managed(p_operation uuid,p_lease uuid,p_external text,p_url text)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare op public.publishing_engine_operations;
begin
 select * into op from public.publishing_engine_operations where id=p_operation for update;
 if not found or op.managed_account_id is null or op.status<>'RUNNING' or op.lease_token is distinct from p_lease or op.lease_until<now() then raise exception 'LEASE_CONFLICT';end if;
 if coalesce(p_external,'')='' or length(p_external)>200 or (op.external_id is not null and op.external_id<>p_external) then raise exception 'RESULT_MISMATCH';end if;
 if p_url is null or not (p_url ~ '^https://(www\.)?myhome\.ge/[^[:space:]]*$' and op.portal_id='myhome' or p_url ~ '^https://(home\.|www\.)?ss\.ge/[^[:space:]]*$' and op.portal_id='ssge') then raise exception 'RESULT_MISMATCH';end if;
 if exists(select 1 from public.publishing_engine_publications where listing_id=op.listing_id and portal_id=op.portal_id and (external_id is not null and external_id<>p_external or managed_account_id is not null and managed_account_id<>op.managed_account_id)) then raise exception 'RESULT_MISMATCH';end if;
 insert into public.publishing_engine_publications(listing_id,user_id,portal_id,managed_account_id,external_id,external_url,observed_state)
 values(op.listing_id,op.user_id,op.portal_id,op.managed_account_id,p_external,p_url,'UNKNOWN')
 on conflict(listing_id,portal_id) do update set managed_account_id=excluded.managed_account_id,external_id=excluded.external_id,external_url=excluded.external_url,updated_at=now();
 update public.publishing_engine_operations set external_id=p_external where id=op.id;
 -- Submission acceptance does not advance synchronization, verification or wallet settlement.
end$$;

create function public.publishing_engine_finish_managed(p_operation uuid,p_lease uuid,p_verified boolean,p_result jsonb,p_error text default null)
returns public.publishing_engine_operations language plpgsql security invoker set search_path=public,pg_temp as $$
declare op public.publishing_engine_operations;state text;
begin
 select * into op from public.publishing_engine_operations where id=p_operation for update;
 if not found or op.managed_account_id is null then raise exception 'OWNED_RECORD_REQUIRED';end if;
 if op.status='SUCCEEDED' and op.lease_token=p_lease then return op;end if;
 if p_verified then
  state:=p_result->>'remoteState';
  if op.kind in ('PUBLISH','EDIT','UPDATE_PHOTOS') or op.kind='RECONCILE' and state<>'DELETED' then
   if p_result->>'readbackHash' is distinct from op.payload_hash then raise exception 'RESULT_MISMATCH';end if;
  end if;
  if op.kind in ('PUBLISH','RESUME','REFRESH') and state is distinct from 'PUBLISHED' or op.kind='PAUSE' and state is distinct from 'PAUSED' or op.kind='HIDE' and state is distinct from 'HIDDEN' or op.kind='DELETE' and state is distinct from 'DELETED' then raise exception 'RESULT_MISMATCH';end if;
  perform public.publishing_engine_checkpoint_managed(op.id,p_lease,p_result->>'externalId',p_result->>'externalUrl');
 end if;
 select * into op from public.publishing_engine_finish(op.user_id,op.id,p_lease,p_verified,p_result,p_error);
 update public.publishing_engine_managed_accounts set last_operation_at=case when p_verified then now() else last_operation_at end,last_error_code=case when p_verified then null else left(p_error,80) end,updated_at=now() where id=op.managed_account_id;
 return op;
end$$;
revoke all on function public.publishing_engine_authorize_managed(text,text,timestamptz,text,jsonb),public.publishing_engine_claim_managed(text,text[]),public.publishing_engine_checkpoint_managed(uuid,uuid,text,text),public.publishing_engine_finish_managed(uuid,uuid,boolean,jsonb,text) from public,anon,authenticated;
grant execute on function public.publishing_engine_authorize_managed(text,text,timestamptz,text,jsonb),public.publishing_engine_claim_managed(text,text[]),public.publishing_engine_checkpoint_managed(uuid,uuid,text,text),public.publishing_engine_finish_managed(uuid,uuid,boolean,jsonb,text) to service_role;

create function public.publishing_engine_disable_managed(p_actor uuid,p_portal text)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.users where id=p_actor and is_admin) then raise exception 'ADMIN_REQUIRED';end if;
 update public.publishing_engine_managed_accounts set enabled=false,updated_at=now() where portal_id=p_portal;
 if not found then raise exception 'PORTAL_NOT_IMPLEMENTED';end if;
 insert into public.publishing_engine_audit(user_id,actor_id,event,detail) values(p_actor,p_actor,'MANAGED_PORTAL_DISABLED',jsonb_build_object('portalId',p_portal));
 return true;
end$$;
revoke all on function public.publishing_engine_disable_managed(uuid,text) from public,anon,authenticated;
grant execute on function public.publishing_engine_disable_managed(uuid,text) to service_role;

create function public.publishing_engine_schedule_managed(p_limit integer default 100)
returns integer language plpgsql security invoker set search_path=public,pg_temp as $$
declare inserted integer;
begin
 if p_limit is null or p_limit<1 or p_limit>1000 then raise exception 'INVALID_LIMIT';end if;
 update public.publishing_engine_operations set status='RECONCILIATION_REQUIRED',error_code='LEASE_EXPIRED',updated_at=now() where managed_account_id is not null and status='RUNNING' and lease_until<now();
 insert into public.publishing_engine_operations(listing_id,user_id,portal_id,managed_account_id,external_id,kind,desired_revision,payload,payload_hash,idempotency_key)
 select l.id,l.user_id,p.portal_id,a.id,p.external_id,'RECONCILE',l.version,l.payload,encode(sha256(convert_to(l.payload::text,'UTF8')),'hex'),
 l.id||':'||p.portal_id||':managed-reconcile:'||l.version||':'||floor(extract(epoch from now())/21600)::bigint
 from public.publishing_engine_publications p join public.publishing_engine_listings l on l.id=p.listing_id join public.publishing_engine_managed_accounts a on a.id=p.managed_account_id
 where a.enabled and a.verified_operations->'RECONCILE'->>'verified'='true' and coalesce(a.verified_operations->'RECONCILE'->>'evidence','')<>''
 and p.external_id is not null and p.observed_state<>'DELETED' and (p.verified_at is null or p.verified_at<now()-interval '6 hours' or p.synced_revision<l.version)
 and not exists(select 1 from public.publishing_engine_operations old where old.listing_id=l.id and old.portal_id=p.portal_id and old.kind='RECONCILE' and old.status in ('QUEUED','RUNNING','AUTH_REQUIRED'))
 order by p.verified_at nulls first limit p_limit on conflict do nothing;
 get diagnostics inserted=row_count;return inserted;
end$$;
revoke all on function public.publishing_engine_schedule_managed(integer) from public,anon,authenticated;
grant execute on function public.publishing_engine_schedule_managed(integer) to service_role;
