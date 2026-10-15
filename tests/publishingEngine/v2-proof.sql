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

\ir ../../supabase/migrations/20261014140000_publishing_engine_ssge.sql
\ir v2-wallet-fixture.sql
\ir ../../supabase/migrations/20261014162952_publishing_engine_v2.sql
\ir ../../supabase/migrations/20261015092646_publishing_engine_managed_accounts.sql
\ir ../../supabase/migrations/20261015114915_publishing_engine_draft_schema_compatibility.sql

insert into public.credit_accounts values('11111111-1111-4111-8111-111111111111',100);
insert into public.publishing_engine_publications(listing_id,user_id,portal_id,external_id,external_url,observed_state,verified_at)
 select id,user_id,'myhome','remote-1','https://myhome.ge/remote-1','PUBLISHED',now() from public.publishing_engine_listings;
insert into public.publishing_engine_publications(listing_id,user_id,portal_id,external_id,external_url,observed_state,verified_at)
 select id,user_id,'ssge','remote-2','https://home.ss.ge/remote-2','PUBLISHED',now() from public.publishing_engine_listings;
do $$declare o uuid:='11111111-1111-4111-8111-111111111111';l uuid:='33333333-3333-4333-8333-333333333333';begin
 perform public.publishing_engine_save_draft(o,l,1,'{"portalTargets":["myhome","ssge"],"price":155000}');
 if (select count(*) from public.publishing_engine_operations where status='QUEUED')<>2 then raise exception 'multi portal synchronization missing';end if;
 perform public.publishing_engine_save_draft(o,l,2,'{"portalTargets":["myhome","ssge"],"price":150000}');
 if (select count(*) from public.publishing_engine_operations where status='QUEUED' and desired_revision=3)<>2 or (select count(*) from public.publishing_engine_operations where status='SUPERSEDED')<>2 then raise exception 'revision coalescing failed';end if;
 begin perform public.publishing_engine_save_draft(o,l,2,'{}');raise exception 'stale edit allowed';exception when raise_exception then if sqlerrm<>'VERSION_CONFLICT' then raise;end if;end;
 begin perform public.publishing_engine_save_draft('22222222-2222-4222-8222-222222222222',l,3,'{}');raise exception 'foreign edit allowed';exception when raise_exception then if sqlerrm<>'OWNED_RECORD_REQUIRED' then raise;end if;end;
 if has_function_privilege('authenticated','public.publishing_engine_bill_due(integer)','EXECUTE') or has_table_privilege('authenticated','public.publishing_engine_operations','INSERT') then raise exception 'privilege leak';end if;
 if exists(select 1 from pg_class where relnamespace='public'::regnamespace and relname like 'publishing_engine_%' and relkind='r' and not relrowsecurity) then raise exception 'RLS not enabled';end if;
end$$;
set local role authenticated;
set local test.owner='22222222-2222-4222-8222-222222222222';
do $$begin if exists(select 1 from public.publishing_engine_publications) or exists(select 1 from public.publishing_engine_operations) then raise exception 'tenant isolation failed';end if;end$$;
reset role;
-- Activation reserves funds but must not capture or create a billing event.
select public.publishing_engine_activate('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333',10,true);
do $$begin if exists(select 1 from public.publishing_engine_billing_events) or (select count(*) from public.fixture_holds where status='SETTLED')<>0 then raise exception 'activation prematurely charged';end if;end$$;
update public.publishing_engine_settings set daily_credits=15;
select public.publishing_engine_activate('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333',15,true);
do $$begin if (select balance from public.credit_accounts)<>85 or (select count(*) from public.fixture_holds where status='RESERVED')<>1 then raise exception 'price reconfirmation leaked a hold';end if;end$$;
update public.publishing_engine_settings set daily_credits=10;
select public.publishing_engine_activate('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333',10,true);
select public.publishing_engine_activate('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333',10,true);
do $$begin if (select balance from public.credit_accounts)<>90 or (select count(*) from public.fixture_holds where status='RESERVED')<>1 then raise exception 'activation idempotency failed';end if;end$$;
do $$begin if public.publishing_engine_bill_due(100)<>0 then raise exception 'unsynchronized activation was charged';end if;end$$;
update public.publishing_engine_publications set synced_revision=3;
commit;
