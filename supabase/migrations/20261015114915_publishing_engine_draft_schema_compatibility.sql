-- Publishing-only compatibility with the real production property and wallet schema.
-- Preserve existing rows and property projections. New incomplete drafts do not create discovery properties.
alter table public.publishing_engine_listings drop constraint publishing_engine_listings_id_fkey;
create or replace function public.publishing_engine_save_draft(p_owner uuid,p_id uuid,p_version integer,p_listing jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v public.publishing_engine_listings; v_id uuid; v_version integer; v_payload jsonb; r record;
begin
 if p_id is null then
  -- Publishing drafts can be incomplete; do not weaken the existing property phone gate.
  v_id:=gen_random_uuid();
  v_version:=1;
 else
  select * into v from public.publishing_engine_listings where id=p_id and user_id=p_owner for update;
  if not found then raise exception 'OWNED_RECORD_REQUIRED'; end if;
  if v.version<>p_version then raise exception 'VERSION_CONFLICT'; end if;
  if v.desired_state='ARCHIVED' then raise exception 'LISTING_ARCHIVED'; end if;
  if (v.payload-'id'-'version')=(p_listing-'id'-'version') then return v.payload||jsonb_build_object('displayId',v.display_id,'desiredState',v.desired_state);end if;
  v_id:=p_id;v_version:=v.version+1;
 end if;
 v_payload:=p_listing||jsonb_build_object('id',v_id,'version',v_version);
 insert into public.publishing_engine_listings(id,user_id,version,payload) values(v_id,p_owner,v_version,v_payload)
  on conflict(id) do update set version=excluded.version,payload=excluded.payload,updated_at=now() returning * into v;
 insert into public.publishing_engine_versions(listing_id,user_id,version,payload) values(v_id,p_owner,v_version,v_payload);
 -- Preserve projections of existing V1/property-backed listings; new V2 drafts stay publishing-only.
 if exists(select 1 from public.properties where id=v_id and user_id=p_owner) then
 update public.properties set title=coalesce(nullif(p_listing->>'title',''),'Draft'),
  property_type=(case when upper(p_listing->>'propertyType') in ('APARTMENT','HOUSE','LAND','COMMERCIAL') then upper(p_listing->>'propertyType') else 'OTHER' end)::public.property_type,
  transaction_type=(case when p_listing->>'dealType'='sale' then 'SALE' else 'RENT' end)::public.transaction_type,
  contact_phone_raw=nullif(p_listing->>'contactPhone',''),updated_at=now() where id=v_id and user_id=p_owner;
 insert into public.property_facts(property_id,country,city,address,total_price,currency,area,rooms,bedrooms,floor,total_floors,description,photo_visibility,address_visibility)
  values(v_id,'GE',nullif(p_listing->>'city',''),nullif(concat_ws(' ',nullif(p_listing->>'street',''),nullif(p_listing->>'streetNumber','')),''),
   (p_listing->>'price')::numeric,p_listing->>'currency',(p_listing->>'area')::numeric,(p_listing->>'rooms')::integer,(p_listing->>'bedrooms')::integer,(p_listing->>'floor')::integer,(p_listing->>'totalFloors')::integer,nullif(p_listing->'description'->>'ka',''),'PRIVATE','HIDDEN')
  on conflict(property_id) do update set city=excluded.city,address=excluded.address,total_price=excluded.total_price,currency=excluded.currency,area=excluded.area,rooms=excluded.rooms,bedrooms=excluded.bedrooms,floor=excluded.floor,total_floors=excluded.total_floors,description=excluded.description;

 end if;
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


create or replace function public.publishing_engine_bill_due(p_limit integer default 100)
returns integer language plpgsql security invoker set search_path=public,pg_temp as $$
declare s public.publishing_engine_subscriptions; cfg public.publishing_engine_settings; hold record; settlement record; start_at timestamptz; n integer:=0;
begin
 select * into cfg from public.publishing_engine_settings where singleton;
 if not cfg.billing_enabled or not cfg.allow_promotional_credits then return 0;end if;
 for s in select * from public.publishing_engine_subscriptions where status in ('ACTIVE','PENDING','PAUSE_AT_PERIOD_END') and (next_billing_at is null or next_billing_at<=now()) order by consented_at for update skip locked limit least(greatest(p_limit,1),1000) loop
  if s.status='PAUSE_AT_PERIOD_END' then update public.publishing_engine_subscriptions set status='PAUSED',next_billing_at=null,updated_at=now() where listing_id=s.listing_id;continue;end if;
  if s.status='ACTIVE' and s.next_billing_at+make_interval(secs=>cfg.grace_seconds)>now() then continue;end if;
  if not exists(select 1 from public.publishing_engine_publications where listing_id=s.listing_id and observed_state='PUBLISHED' and verified_at>now()-interval '48 hours') or (s.status='PENDING' and exists(select 1 from public.publishing_engine_listings l cross join lateral jsonb_array_elements_text(l.payload->'portalTargets') target where l.id=s.listing_id and not exists(select 1 from public.publishing_engine_publications p where p.listing_id=l.id and p.portal_id=target and p.observed_state='PUBLISHED' and p.synced_revision>=l.version and p.verified_at>now()-interval '48 hours'))) then
   if s.status='PENDING' and s.consented_at>now()-interval '1 hour' then continue;end if;
   if s.status='PENDING' and s.reservation_id is not null then perform public.wallet_release(s.reservation_id,'publishing_activation_not_verified','{}');end if;
   update public.publishing_engine_subscriptions set status='RECONCILIATION_REQUIRED',updated_at=now() where listing_id=s.listing_id;continue;
  end if;
  if cfg.daily_credits>s.authorized_daily_credits then
   if s.status='PENDING' and s.reservation_id is not null then perform public.wallet_release(s.reservation_id,'publishing_activation_price_changed','{}');end if;
   update public.publishing_engine_subscriptions set status='PAUSED',next_billing_at=null,updated_at=now() where listing_id=s.listing_id;continue;
  end if;
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
   if sqlerrm<>'RESERVATION_NOT_SETTLED' then
    insert into public.notifications(user_id,type,title,body,property_id,metadata)
     select s.user_id,'LOW_CREDITS',coalesce('{"en":"Insufficient credits","ka":"კრედიტი არ არის საკმარისი","ru":"Недостаточно кредитов","tr":"Yetersiz kredi","ar":"رصيد غير كافٍ","he":"קרדיטים לא מספיקים"}'::jsonb->>u.preferred_language::text,'Insufficient credits'),coalesce('{"en":"Check your credit balance and listing activation before continuing.","ka":"გაგრძელებამდე შეამოწმეთ კრედიტები და განცხადების აქტივაცია.","ru":"Проверьте баланс кредитов и активацию объявления.","tr":"Devam etmeden kredi bakiyenizi ve ilan etkinliğini kontrol edin.","ar":"افحص رصيدك وتفعيل الإعلان قبل المتابعة.","he":"בדקו את יתרת הקרדיטים ואת הפעלת המודעה לפני המשך."}'::jsonb->>u.preferred_language::text,'Check your credit balance before continuing.'),(select id from public.properties where id=s.listing_id and user_id=s.user_id),jsonb_build_object('product','publishing','listing_id',s.listing_id,'href','/property/publish') from public.users u where u.id=s.user_id;
   end if;
  end;
 end loop;return n;
end$$;


revoke all on function public.publishing_engine_save_draft(uuid,uuid,integer,jsonb),public.publishing_engine_bill_due(integer) from public,anon,authenticated;
grant execute on function public.publishing_engine_save_draft(uuid,uuid,integer,jsonb),public.publishing_engine_bill_due(integer) to service_role;
