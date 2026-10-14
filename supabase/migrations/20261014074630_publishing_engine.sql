-- Additive, isolated publishing storage. Existing properties remain untouched.
create table public.publishing_engine_listings (
  id uuid primary key references public.properties(id),
  user_id uuid not null references public.users(id),
  version integer not null check (version > 0),
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index publishing_engine_listings_owner on public.publishing_engine_listings(user_id,created_at desc);
create table public.publishing_engine_versions (
  listing_id uuid not null references public.publishing_engine_listings(id),
  user_id uuid not null references public.users(id),
  version integer not null,
  payload jsonb not null,
  primary key(listing_id,version)
);
create table public.publishing_engine_jobs (
  id uuid primary key,
  listing_id uuid not null references public.publishing_engine_listings(id),
  user_id uuid not null references public.users(id),
  portal_id text not null check (portal_id='myhome'),
  revision integer not null default 0,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique(listing_id,portal_id)
);
create index publishing_engine_jobs_owner on public.publishing_engine_jobs(user_id,created_at desc);
alter table public.publishing_engine_listings enable row level security;
alter table public.publishing_engine_versions enable row level security;
alter table public.publishing_engine_jobs enable row level security;
create policy publishing_engine_listings_read on public.publishing_engine_listings for select to authenticated using (user_id=public.get_user_id());
create policy publishing_engine_versions_read on public.publishing_engine_versions for select to authenticated using (user_id=public.get_user_id());
create policy publishing_engine_jobs_read on public.publishing_engine_jobs for select to authenticated using (user_id=public.get_user_id());
revoke all on public.publishing_engine_listings,public.publishing_engine_versions,public.publishing_engine_jobs from anon,authenticated;
grant select on public.publishing_engine_listings,public.publishing_engine_versions,public.publishing_engine_jobs to authenticated;
grant all on public.publishing_engine_listings,public.publishing_engine_versions,public.publishing_engine_jobs to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('publishing-engine-photos','publishing-engine-photos',false,8000000,array['image/jpeg','image/png','image/webp']);
-- No public storage policy; the authenticated edge function owns all access.

create function public.publishing_engine_save(p_owner uuid,p_id uuid,p_version integer,p_listing jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_id uuid; v_version integer; v_payload jsonb; v_old public.publishing_engine_listings;
begin
  if p_id is null then
    insert into public.properties(user_id,source_type,title,property_type,transaction_type,matching_status,contact_phone_e164,contact_phone_raw,contact_phone_country)
    values(p_owner,'PRIVATE_LISTING',p_listing->'description'->>'ka',
      (case p_listing->>'propertyType' when 'hotel' then 'OTHER' else upper(p_listing->>'propertyType') end)::public.property_type,
      (case p_listing->>'dealType' when 'sale' then 'SALE' else 'RENT' end)::public.transaction_type,
      'DRAFT',p_listing->>'contactPhone',p_listing->>'contactPhone',p_listing->>'contactPhoneCountry') returning id into v_id;
    v_version:=1;
  else
    select * into v_old from public.publishing_engine_listings where id=p_id and user_id=p_owner for update;
    if not found then raise exception 'OWNED_RECORD_REQUIRED'; end if;
    if v_old.version<>p_version then raise exception 'VERSION_CONFLICT'; end if;
    if exists(select 1 from public.publishing_engine_jobs where listing_id=p_id) then raise exception 'EXISTING_JOB_REQUIRES_RECONCILIATION'; end if;
    v_id:=p_id; v_version:=v_old.version+1;
    -- Only properties created through this engine can enter this branch.
    update public.properties set contact_phone_e164=p_listing->>'contactPhone',contact_phone_raw=p_listing->>'contactPhone',updated_at=now() where id=v_id and user_id=p_owner;
  end if;
  v_payload:=p_listing||jsonb_build_object('id',v_id,'version',v_version,'createdAt',coalesce(v_old.created_at,now()));
  insert into public.publishing_engine_listings(id,user_id,version,payload) values(v_id,p_owner,v_version,v_payload)
    on conflict(id) do update set version=excluded.version,payload=excluded.payload;
  insert into public.publishing_engine_versions(listing_id,user_id,version,payload) values(v_id,p_owner,v_version,v_payload);
  insert into public.property_facts(property_id,country,city,address,total_price,currency,area,rooms,bedrooms,floor,total_floors,description,photo_visibility,address_visibility)
  values(v_id,'GE',p_listing->>'city',concat_ws(' ',p_listing->>'street',p_listing->>'streetNumber'),(p_listing->>'price')::numeric,p_listing->>'currency',
    (p_listing->>'area')::numeric,(p_listing->>'rooms')::integer,(p_listing->>'bedrooms')::integer,(p_listing->>'floor')::integer,(p_listing->>'totalFloors')::integer,p_listing->'description'->>'ka','PRIVATE','CITY_ONLY')
  on conflict(property_id) do update set city=excluded.city,address=excluded.address,total_price=excluded.total_price,currency=excluded.currency,area=excluded.area,rooms=excluded.rooms,bedrooms=excluded.bedrooms,floor=excluded.floor,total_floors=excluded.total_floors,description=excluded.description;
  return v_payload;
end $$;
revoke all on function public.publishing_engine_save(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.publishing_engine_save(uuid,uuid,integer,jsonb) to service_role;

create function public.publishing_engine_start_job(p_owner uuid,p_listing uuid,p_version integer)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_listing public.publishing_engine_listings; v_job public.publishing_engine_jobs; v_id uuid:=gen_random_uuid(); v_payload jsonb;
begin
  select * into v_listing from public.publishing_engine_listings where id=p_listing and user_id=p_owner for update;
  if not found then raise exception 'OWNED_RECORD_REQUIRED'; end if;
  if v_listing.version<>p_version then raise exception 'VERSION_CONFLICT'; end if;
  select * into v_job from public.publishing_engine_jobs where listing_id=p_listing and portal_id='myhome';
  if found then
    if (v_job.payload->>'version')::integer<>p_version then raise exception 'EXISTING_JOB_REQUIRES_RECONCILIATION'; end if;
    return v_job.payload;
  end if;
  v_payload:=jsonb_build_object('id',v_id,'listingId',p_listing,'portalId','myhome','version',p_version,'state','CONNECT_BROWSER','revision',0,'createdAt',now(),'events','[]'::jsonb);
  insert into public.publishing_engine_jobs(id,listing_id,user_id,portal_id,payload) values(v_id,p_listing,p_owner,'myhome',v_payload);
  return v_payload;
end $$;
revoke all on function public.publishing_engine_start_job(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.publishing_engine_start_job(uuid,uuid,integer) to service_role;

