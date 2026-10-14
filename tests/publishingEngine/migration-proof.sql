\set ON_ERROR_STOP on
begin;
do $$begin if current_setting('server_version_num')::integer/10000 <> 17 then raise exception 'PostgreSQL 17 required'; end if; end$$;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon,authenticated,service_role;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create type public.property_type as enum('APARTMENT','HOUSE','LAND','COMMERCIAL','OTHER');
create type public.transaction_type as enum('SALE','RENT');
create table public.users(id uuid primary key);
create table public.properties(id uuid primary key default gen_random_uuid(),user_id uuid references public.users,source_type text,title text,property_type public.property_type,transaction_type public.transaction_type,matching_status text,contact_phone_e164 text,contact_phone_raw text,contact_phone_country text,updated_at timestamptz);
create table public.property_facts(property_id uuid primary key references public.properties,country text,city text,address text,total_price numeric,currency text,area numeric,rooms integer,bedrooms integer,floor integer,total_floors integer,description text,photo_visibility text,address_visibility text);
create function public.get_user_id() returns uuid language sql stable as $$select nullif(current_setting('test.owner',true),'')::uuid$$;
\ir ../../supabase/migrations/20261014074630_publishing_engine.sql
insert into public.users values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
insert into public.properties(id,user_id) values('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111');
insert into public.publishing_engine_listings(id,user_id,version,payload) values('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',1,'{"portalTargets":["myhome","ssge"]}');
create temp table old_job as select public.publishing_engine_start_job('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333',1) payload;
create temp table old_rpc as select pg_get_functiondef('public.publishing_engine_start_job(uuid,uuid,integer)'::regprocedure) source;
\ir ../../supabase/migrations/20261014140000_publishing_engine_ssge.sql
\ir ../../supabase/migrations/20261014140000_publishing_engine_ssge.sql
do $$declare owner_id uuid:='11111111-1111-4111-8111-111111111111'; listing_id uuid:='33333333-3333-4333-8333-333333333333'; j jsonb; begin
 if pg_get_functiondef('public.publishing_engine_start_job(uuid,uuid,integer)'::regprocedure)<>(select source from old_rpc) then raise exception 'MyHome RPC changed'; end if;
 if public.publishing_engine_start_job(owner_id,listing_id,1)<>(select payload from old_job) or public.publishing_engine_start_portal_job(owner_id,listing_id,1,'myhome')<>(select payload from old_job) then raise exception 'MyHome job changed'; end if;
 j:=public.publishing_engine_start_portal_job(owner_id,listing_id,1,'ssge');
 if j->>'portalId'<>'ssge' or j->>'state'<>'CONNECT_BROWSER' or j<>public.publishing_engine_start_portal_job(owner_id,listing_id,1,'ssge') then raise exception 'SS.ge job repeatability failed'; end if;
 if (select count(*) from public.publishing_engine_jobs)<>2 then raise exception 'duplicate jobs'; end if;
 begin perform public.publishing_engine_start_portal_job('22222222-2222-4222-8222-222222222222',listing_id,1,'ssge'); raise exception 'tenant check bypass'; exception when raise_exception then if sqlerrm<>'OWNED_RECORD_REQUIRED' then raise; end if; end;
 begin perform public.publishing_engine_start_portal_job(owner_id,listing_id,2,'ssge'); raise exception 'version check bypass'; exception when raise_exception then if sqlerrm<>'VERSION_CONFLICT' then raise; end if; end;
 begin perform public.publishing_engine_start_portal_job(owner_id,listing_id,1,'livo'); raise exception 'portal allowlist bypass'; exception when raise_exception then if sqlerrm<>'PORTAL_NOT_IMPLEMENTED' then raise; end if; end;
 update public.publishing_engine_listings set payload='{"portalTargets":["myhome"]}' where id=listing_id;
 begin perform public.publishing_engine_start_portal_job(owner_id,listing_id,1,'ssge'); raise exception 'target check bypass'; exception when raise_exception then if sqlerrm<>'PORTAL_NOT_SELECTED' then raise; end if; end;
 begin insert into public.publishing_engine_jobs(id,listing_id,user_id,portal_id,payload) values(gen_random_uuid(),listing_id,owner_id,'livo','{}'); raise exception 'constraint bypass'; exception when check_violation then null; end;
 if has_function_privilege('anon','public.publishing_engine_start_portal_job(uuid,uuid,integer,text)','EXECUTE') or has_function_privilege('authenticated','public.publishing_engine_start_portal_job(uuid,uuid,integer,text)','EXECUTE') or not has_function_privilege('service_role','public.publishing_engine_start_portal_job(uuid,uuid,integer,text)','EXECUTE') then raise exception 'RPC grants invalid'; end if;
 if has_table_privilege('authenticated','public.publishing_engine_jobs','INSERT') or has_table_privilege('anon','public.publishing_engine_jobs','SELECT') then raise exception 'table grants invalid'; end if;
 if exists(select 1 from pg_class where oid in ('public.publishing_engine_listings'::regclass,'public.publishing_engine_versions'::regclass,'public.publishing_engine_jobs'::regclass) and not relrowsecurity) then raise exception 'RLS disabled'; end if;
end$$;
set local role authenticated;
set local test.owner='22222222-2222-4222-8222-222222222222';
do $$begin if exists(select 1 from public.publishing_engine_jobs) or exists(select 1 from public.publishing_engine_listings) then raise exception 'RLS tenant leak'; end if; end$$;
set local test.owner='11111111-1111-4111-8111-111111111111';
do $$begin if (select count(*) from public.publishing_engine_jobs)<>2 then raise exception 'owner visibility failed'; end if; end$$;
reset role;
set local role service_role;
select public.publishing_engine_start_portal_job('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333',1,'myhome')->>'portalId' as service_rpc_result;
reset role;
rollback;
\echo PostgreSQL 17 migration proof passed

