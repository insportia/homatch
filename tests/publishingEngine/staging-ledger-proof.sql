-- Run only against the isolated Publishing V2 staging schema.
-- Real wallet functions/credit lots/ledger; portal publication rows below are TRANSACTIONAL FIXTURES.
-- All users, balances, remote references and billing changes are rolled back.
begin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $proof$
declare
 owner_id uuid; other_id uuid; other_auth uuid:=gen_random_uuid(); listing jsonb; failed jsonb; zero_listing jsonb;
 hold record; again record; settlement record; before_balance numeric; event_id uuid; n integer;
begin
 if not exists(select 1 from public.users where full_name='Publishing release QA') then raise exception 'ISOLATED_STAGING_QA_REQUIRED';end if;
 select id into owner_id from public.users where full_name='Publishing release QA' limit 1;
 insert into public.users(auth_id,email,full_name,preferred_language) values(other_auth,'publishing-ledger-proof-'||other_auth||'@example.invalid','Publishing transactional ledger proof','ka') returning id into other_id;
 perform public.wallet_admin_adjust(owner_id,100,'Isolated staging transactional test credits','publishing-proof:'||gen_random_uuid());
 select balance into before_balance from public.credit_accounts where user_id=owner_id;
 select * into hold from public.wallet_reserve(owner_id,'PUBLISHING_LISTING_DAY',10,'proof:reserve:'||other_auth,10,10,null,'{"test":"transactional"}');
 select * into again from public.wallet_reserve(owner_id,'PUBLISHING_LISTING_DAY',10,'proof:reserve:'||other_auth,10,10,null,'{"test":"transactional"}');
 if again.reservation_id<>hold.reservation_id or not again.was_duplicate then raise exception 'RESERVATION_IDEMPOTENCY_FAILED';end if;
 if (select balance from public.credit_accounts where user_id=owner_id)<>before_balance-10 then raise exception 'RESERVATION_DOUBLE_DEBIT';end if;
 perform public.wallet_release(hold.reservation_id,'staging_failure','{}');
 perform public.wallet_release(hold.reservation_id,'staging_failure_retry','{}');
 if (select balance from public.credit_accounts where user_id=owner_id)<>before_balance then raise exception 'RELEASE_FAILED';end if;
 select * into hold from public.wallet_reserve(owner_id,'PUBLISHING_LISTING_DAY',10,'proof:settle:'||other_auth,10,10,null,'{}');
 select * into settlement from public.wallet_settle(hold.reservation_id,10,'{"provider_operation":"staging_proof"}','SUCCESS');
 perform public.wallet_settle(hold.reservation_id,10,'{}','SUCCESS');
 if settlement.settled_credits<>10 or (select count(*) from public.credit_ledger where reference='res:'||hold.reservation_id||':cap')<>1 then raise exception 'SETTLEMENT_IDEMPOTENCY_FAILED';end if;
 if (select sum(credits_consumed) from public.credit_lots where user_id=owner_id)<>10 then raise exception 'REAL_LOT_CONSUMPTION_FAILED';end if;
 select balance into before_balance from public.credit_accounts where user_id=owner_id;
 listing:=public.publishing_engine_save_draft(owner_id,null,0,'{"title":"Transactional incomplete draft","portalTargets":["myhome","ssge"],"photos":[]}');
 if exists(select 1 from public.properties where id=(listing->>'id')::uuid) then raise exception 'INCOMPLETE_DRAFT_CREATED_DISCOVERY_PROPERTY';end if;
 listing:=public.publishing_engine_save_draft(owner_id,(listing->>'id')::uuid,1,'{"title":"Resumed incomplete draft","portalTargets":["myhome","ssge"],"photos":[]}');
 if (listing->>'version')::integer<>2 then raise exception 'DRAFT_REVISION_FAILED';end if;
 begin
  perform public.publishing_engine_save_draft(owner_id,(listing->>'id')::uuid,1,'{}');
  raise exception 'STALE_WRITE_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'VERSION_CONFLICT' then raise;end if;end;
 perform public.publishing_engine_activate(owner_id,(listing->>'id')::uuid,10,true);
 if public.publishing_engine_bill_due(100)<>0 then raise exception 'UNVERIFIED_ACTIVATION_CHARGED';end if;
 insert into public.publishing_engine_publications(listing_id,user_id,portal_id,external_id,external_url,observed_state,synced_revision,verified_at)
 values((listing->>'id')::uuid,owner_id,'myhome','TRANSACTIONAL-FIXTURE-MYHOME','https://www.myhome.ge/transactional-fixture','PUBLISHED',2,now());
 if public.publishing_engine_bill_due(100)<>0 then raise exception 'PARTIAL_DELIVERY_CHARGED';end if;
 insert into public.publishing_engine_publications(listing_id,user_id,portal_id,external_id,external_url,observed_state,synced_revision,verified_at)
 values((listing->>'id')::uuid,owner_id,'ssge','TRANSACTIONAL-FIXTURE-SSGE','https://home.ss.ge/transactional-fixture','PUBLISHED',2,now());
 if public.publishing_engine_bill_due(100)<>1 then raise exception 'COMPLETE_FIXTURE_DELIVERY_NOT_SETTLED';end if;
 if public.publishing_engine_bill_due(100)<>0 or (select count(*) from public.publishing_engine_billing_events where listing_id=(listing->>'id')::uuid)<>1 then raise exception 'PERIOD_DOUBLE_CHARGED';end if;
 if (select balance from public.credit_accounts where user_id=owner_id)<>before_balance-10 then raise exception 'MULTI_PORTAL_OVERCHARGE';end if;
 select id into event_id from public.publishing_engine_billing_events where listing_id=(listing->>'id')::uuid;
 perform public.publishing_engine_refund(owner_id,event_id,'Isolated staging refund proof',true);
 perform public.publishing_engine_refund(owner_id,event_id,'Isolated staging refund retry',true);
 if (select balance from public.credit_accounts where user_id=owner_id)<>before_balance then raise exception 'REFUND_IDEMPOTENCY_FAILED';end if;
 failed:=public.publishing_engine_save_draft(owner_id,null,0,'{"portalTargets":["ssge"]}');
 perform public.publishing_engine_activate(owner_id,(failed->>'id')::uuid,10,true);
 update public.publishing_engine_subscriptions set consented_at=now()-interval '2 hours' where listing_id=(failed->>'id')::uuid;
 perform public.publishing_engine_bill_due(100);
 if (select balance from public.credit_accounts where user_id=owner_id)<>before_balance then raise exception 'FAILED_ACTIVATION_RESERVATION_NOT_RELEASED';end if;
 zero_listing:=public.publishing_engine_save_draft(other_id,null,0,'{"portalTargets":["ssge"]}');
 insert into public.publishing_engine_publications(listing_id,user_id,portal_id,external_id,observed_state,synced_revision,verified_at) values((zero_listing->>'id')::uuid,other_id,'ssge','TRANSACTIONAL-ZERO','PUBLISHED',1,now());
 insert into public.publishing_engine_subscriptions(listing_id,user_id,status,authorized_daily_credits,period_start,paid_until,next_billing_at) values((zero_listing->>'id')::uuid,other_id,'ACTIVE',10,now()-interval '25 hours',now()-interval '1 hour',now()-interval '1 hour');
 perform public.publishing_engine_bill_due(100);
 if (select status from public.publishing_engine_subscriptions where listing_id=(zero_listing->>'id')::uuid)<>'INSUFFICIENT_BALANCE' then raise exception 'INSUFFICIENT_BALANCE_NOT_RECORDED';end if;
 if not exists(select 1 from public.notifications where user_id=other_id and type='LOW_CREDITS' and title='კრედიტი არ არის საკმარისი' and property_id is null) then raise exception 'PRODUCTION_LANGUAGE_OR_OPTIONAL_PROPERTY_NOTIFICATION_FAILED';end if;
 if exists(select 1 from public.credit_ledger where user_id=other_id) then raise exception 'EMPTY_WALLET_WAS_CHARGED';end if;
 if has_function_privilege('authenticated','public.publishing_engine_bill_due(integer)','EXECUTE') or has_function_privilege('authenticated','public.publishing_engine_claim_managed(text,text[])','EXECUTE') then raise exception 'WORKER_PERMISSION_LEAK';end if;
 perform set_config('publishing.proof.owner',owner_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',other_auth)::text,true);
end $proof$;
set local role authenticated;
do $$begin
 if exists(select 1 from public.publishing_engine_listings where user_id=current_setting('publishing.proof.owner')::uuid) or exists(select 1 from public.credit_accounts where user_id=current_setting('publishing.proof.owner')::uuid) then raise exception 'CROSS_USER_RLS_LEAK';end if;
end$$;
reset role;
select 'PASS: real wallet reserve/release/settle/refund/credit-lots, service-delivery gates, 24h idempotency, incomplete drafts, stale edits, insufficient-balance localization and RLS; all changes rolled back' result;
rollback;
