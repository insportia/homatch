\set ON_ERROR_STOP on
-- Interest timeline + multi-interest profiles: explicit vs observed, no seller from
-- browsing, ka/en/ru place equivalence, own-rows RLS, dedupe, tracking opt-out, erasure.
do $$
declare
  b1 uuid := '00000000-0000-0000-0000-0000000000b1';
  b2 uuid := '00000000-0000-0000-0000-0000000000b2';
  a1 uuid := '00000000-0000-0000-0000-0000000000a1';
  f1 uuid := '00000000-0000-0000-0000-0000000000f1';
  v jsonb; v_n int; v_err text; v_s uuid;
begin
  -- Backfill: listings are explicit seller interest; the older search is a renter's interest.
  assert exists (select 1 from public.property_interest_events where user_id = a1 and event_type = 'PROPERTY_LISTED' and side = 'SELL' and provenance = 'BACKFILL'), 'listing backfilled as SELL';
  assert exists (select 1 from public.customer_demand_interests where user_id = b2 and side = 'RENT' and city = 'batumi' and budget_band = 'rent_500_1000'), 'search backfilled';
  assert exists (select 1 from public.property_interest_events where provenance = 'BACKFILL' and event_type = 'DEMAND_DECLARED'), 'subscriptions backfilled';

  -- A new search in Georgian and one in Russian are the same city interest.
  insert into public.discovery_marketplace_searches (user_id, request) values
    (b1, '{"transactionType":"BUY","city":"თბილისი","districts":["კრწანისი"],"propertyType":"APARTMENT","priceMinUsd":80000,"priceMaxUsd":250000,"bedrooms":{"min":1,"max":2}}'),
    (b1, '{"transactionType":"BUY","city":"Тбилиси","districts":["Ортачала"],"propertyType":"APARTMENT","priceMinUsd":90000,"priceMaxUsd":240000}');
  select count(*) into v_n from public.customer_demand_interests where user_id = b1 and side = 'BUY' and city = 'tbilisi';
  assert v_n = 1, 'ka + ru spellings are one interest: ' || v_n;
  assert (select searches from public.customer_demand_interests where user_id = b1 and city = 'tbilisi' and side = 'BUY') = 2;
  assert (select districts from public.customer_demand_interests where user_id = b1 and city = 'tbilisi' and side = 'BUY') @> array['krtsanisi', 'ortachala'], 'districts unioned and canonical';

  -- A different interest never overwrites the first.
  insert into public.discovery_marketplace_searches (user_id, request) values
    (b1, '{"transactionType":"RENT","city":"Batumi","propertyType":"APARTMENT","priceMaxUsd":700}');
  assert (select count(*) from public.customer_demand_interests where user_id = b1) = 2, 'two interests kept side by side';

  -- A broken request is still recorded as a search and never blocks the insert.
  insert into public.discovery_marketplace_searches (user_id, request) values (b1, '{"priceMaxUsd":"lots"}');
  assert (select count(*) from public.discovery_marketplace_searches where user_id = b1) = 4, 'source write not blocked';

  -- Observed: a contact reveal on a sale listing is BUY-side observed interest.
  insert into public.contact_disclosures (viewer_user_id, subject_user_id, property_id) values (b1, a1, f1);
  assert exists (select 1 from public.property_interest_events where user_id = b1 and event_type = 'CONTACT_REVEALED' and intent_basis = 'OBSERVED' and side = 'BUY' and city = 'Tbilisi');
  -- An owner looking at their own listing is not a buyer of it.
  insert into public.viewing_requests (property_id, requester_id, owner_id) values (f1, a1, a1);
  assert not exists (select 1 from public.property_interest_events where user_id = a1 and event_type = 'VIEWING_REQUESTED'), 'own listing is not interest';

  -- Seller status can never come from behaviour.
  begin
    insert into public.property_interest_events (user_id, event_type, intent_basis, side, provenance) values (b1, 'VIEWED', 'OBSERVED', 'SELL', 'CLIENT');
    assert false, 'observed SELL accepted';
  exception when check_violation then null; end;
  begin
    insert into public.property_interest_events (user_id, event_type, intent_basis, side, provenance) values (b1, 'SEARCH', 'OBSERVED', 'BUY', 'CLIENT');
    assert false, 'a search cannot be merely observed';
  exception when check_violation then null; end;

  -- Customer RPCs as b1.
  perform set_config('app.uid', '10000000-0000-0000-0000-0000000000b1', true);
  v := public.record_my_property_interest('VIEWED', 'ext:myhome.ge/1', null, null,
    '{"city":"Tbilisi","district":"Vake","price":120000,"currency":"USD","transaction":"sale","propertyType":"APARTMENT","sourceHost":"myhome.ge","phone":"+995555"}');
  assert (v->>'recorded')::boolean, v::text;
  v := public.record_my_property_interest('VIEWED', 'ext:myhome.ge/1', null, null, '{"city":"Tbilisi"}');
  assert not (v->>'recorded')::boolean, 'a re-render within the hour is not a second view';
  v := public.record_my_property_interest('SAVED', 'ext:myhome.ge/1', null, null, '{"title":"Flat","city":"Tbilisi","url":"https://myhome.ge/1","phone":"+995555"}');
  assert (v->>'saved')::boolean;
  assert not ((select snapshot from public.saved_property_listings where user_id = b1) ? 'phone'), 'snapshot minimised';
  v := public.record_my_property_interest('SAVED', 'ext:myhome.ge/1', null, null, '{}');
  assert v->>'reason' = 'ALREADY_SAVED', 'no double save';
  v := public.record_my_property_interest('UNSAVED', 'ext:myhome.ge/1', null, null, '{}');
  assert not exists (select 1 from public.saved_property_listings where user_id = b1);
  begin
    perform public.record_my_property_interest('PAID_CAMPAIGN_STARTED', 'x', null, null, '{}');
    assert false, 'clients cannot write explicit events';
  exception when others then get stacked diagnostics v_err = message_text; assert v_err like '%EVENT_NOT_ALLOWED%', v_err; end;

  v := public.my_property_interest_history(50, null);
  assert jsonb_array_length(v->'events') >= 5, v::text;
  assert (v->'interests'->0->'strength'->>'score') is not null, 'strength explained';
  assert v->'interests'->0->'strength'->'components' ? 'stated';

  perform public.set_my_interest_tracking(false);
  v := public.record_my_property_interest('VIEWED', 'ext:ss.ge/9', null, null, '{"city":"Tbilisi"}');
  assert v->>'reason' = 'TRACKING_OFF', 'opt-out respected';

  -- Strength: explicit stated interest beats observed-only, and is explained.
  assert (select (public.demand_interest_strength(i)->>'basis') from public.customer_demand_interests i where user_id = b1 and city = 'tbilisi' and side = 'BUY' and budget_band = 'buy_200k_400k') = 'EXPLICIT';
  assert (select (public.demand_interest_strength(i)->>'basis') from public.customer_demand_interests i where user_id = b1 and city = 'tbilisi' and budget_band = 'buy_100k_200k' and explicit_events = 0 limit 1) = 'OBSERVED', 'observed-only interest stays observed';

  -- Erasure.
  v := public.delete_my_property_interest_history();
  assert (v->>'events')::int > 0;
  assert not exists (select 1 from public.property_interest_events where user_id = b1);
  assert not exists (select 1 from public.customer_demand_interests where user_id = b1);
  assert exists (select 1 from public.discovery_marketplace_searches where user_id = b1), 'the searches themselves stay';

  -- Retention is off by default.
  assert public.purge_expired_property_interest() = 0;

  -- Privileges.
  assert not has_function_privilege('authenticated', 'public.record_interest_event(jsonb)', 'execute'), 'raw writer is service only';
  assert not has_table_privilege('authenticated', 'public.property_interest_events', 'insert');
  assert (select relrowsecurity from pg_class where relname = 'property_interest_events');
end $$;

-- RLS: a customer reads only their own rows.
set role authenticated;
select set_config('app.uid', '10000000-0000-0000-0000-0000000000b2', false);
do $$ begin
  assert (select count(*) from public.property_interest_events where user_id <> '00000000-0000-0000-0000-0000000000b2') = 0, 'foreign rows visible';
  assert (select count(*) from public.property_interest_events) > 0, 'own rows visible';
end $$;
reset role;
