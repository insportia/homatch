-- Local integration candidate only. Do not apply until the consolidated release is approved.
alter table public.publishing_engine_jobs drop constraint publishing_engine_jobs_portal_id_check;
alter table public.publishing_engine_jobs add constraint publishing_engine_jobs_portal_id_check check (portal_id ~ '^[a-z][a-z0-9_]{1,39}$');

-- Preserve the original MyHome RPC signature and behavior.
create function public.publishing_engine_start_portal_job(p_owner uuid,p_listing uuid,p_version integer,p_portal text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_listing public.publishing_engine_listings; v_job public.publishing_engine_jobs; v_id uuid:=gen_random_uuid(); v_payload jsonb;
begin
  if p_portal is null or p_portal !~ '^[a-z][a-z0-9_]{1,39}$' then raise exception 'PORTAL_NOT_IMPLEMENTED'; end if;
  select * into v_listing from public.publishing_engine_listings where id=p_listing and user_id=p_owner for update;
  if not found then raise exception 'OWNED_RECORD_REQUIRED'; end if;
  if v_listing.version<>p_version then raise exception 'VERSION_CONFLICT'; end if;
  if not coalesce(v_listing.payload->'portalTargets' ? p_portal,false) then raise exception 'PORTAL_NOT_SELECTED'; end if;
  select * into v_job from public.publishing_engine_jobs where listing_id=p_listing and portal_id=p_portal;
  if found then
    if (v_job.payload->>'version')::integer<>p_version then raise exception 'EXISTING_JOB_REQUIRES_RECONCILIATION'; end if;
    return v_job.payload;
  end if;
  v_payload:=jsonb_build_object('id',v_id,'listingId',p_listing,'portalId',p_portal,'version',p_version,'state','CONNECT_BROWSER','revision',0,'createdAt',now(),'events','[]'::jsonb);
  insert into public.publishing_engine_jobs(id,listing_id,user_id,portal_id,payload) values(v_id,p_listing,p_owner,p_portal,v_payload);
  return v_payload;
end $$;
revoke all on function public.publishing_engine_start_portal_job(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.publishing_engine_start_portal_job(uuid,uuid,integer,text) to service_role;
