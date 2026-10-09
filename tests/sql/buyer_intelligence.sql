-- Behavioural checks for 20261024100000_market_segmentation.sql and
-- 20261024110000_buyer_intelligence.sql. Run: tests/sql/run-buyer-intelligence.sh
\set ON_ERROR_STOP 1

/* ── data ─────────────────────────────────────────────────────────────── */
insert into public.users (id, email, full_name) values
  ('00000000-0000-4000-8000-0000000000a1', 'admin@example.test', 'Admin'),
  ('00000000-0000-4000-8000-0000000000a2', 'owner@example.test', 'Owner'),
  ('00000000-0000-4000-8000-0000000000b1', 'b1@example.test', 'Plan Buyer'),
  ('00000000-0000-4000-8000-0000000000b2', 'b2@example.test', 'Market Tenant'),
  ('00000000-0000-4000-8000-0000000000b3', 'b3@example.test', 'Old Chat Buyer'),
  ('00000000-0000-4000-8000-0000000000b4', 'b4@example.test', 'Viewer');

-- Ten Vake sale listings, 1000..1900 USD/m² (100 m²), plus an older duplicate
-- observation of L0, and two GEL listings with no FX rate.
insert into public.discovery_marketplace_listings (source_key, source_listing_id, exact_url, raw, observed_at)
select 'myhome-ge', 'L' || i, 'https://myhome.ge/pr/L' || i,
       jsonb_build_object('transactionType', 'BUY', 'propertyType', 'APARTMENT', 'currency', 'USD',
                          'price', (1000 + i * 100) * 100, 'areaSqm', 100, 'city', 'თბილისი', 'district', 'ვაკე',
                          'address', 'ჭავჭავაძის გამზ. ' || i),
       now() - interval '1 hour'
  from generate_series(0, 9) i;
insert into public.discovery_marketplace_listings (source_key, source_listing_id, exact_url, raw, observed_at)
values ('myhome-ge', 'L0', 'https://myhome.ge/pr/L0',
        '{"transactionType":"BUY","propertyType":"APARTMENT","currency":"USD","price":1,"areaSqm":100,"city":"თბილისი","district":"ვაკე"}',
        now() - interval '5 days'),
       ('ss-ge', 'G1', null, '{"transactionType":"BUY","propertyType":"APARTMENT","currency":"GEL","price":400000,"areaSqm":100,"city":"თბილისი","district":"ვაკე"}', now()),
       ('ss-ge', 'G2', null, '{"transactionType":"BUY","propertyType":"APARTMENT","currency":"GEL","price":500000,"areaSqm":100,"city":"თბილისი","district":"ვაკე"}', now());

insert into public.properties (id, user_id, title, transaction_type, property_type, homatch_id, contact_phone_e164) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000a2', 'Vake premium', 'SALE', 'APARTMENT', 482915, '+995555000001'),
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000a2', 'Vake economy', 'SALE', 'PENTHOUSE', 482916, '+995555000002'),
  ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000a2', 'Gldani rent', 'RENT', 'APARTMENT', 482917, null);
insert into public.property_facts (property_id, city, district, address, total_price, currency, area, bedrooms, canonical_url) values
  ('00000000-0000-4000-8000-0000000000f1', 'Tbilisi', 'Vake', 'Chavchavadze Ave 40', 170000, 'USD', 100, 2, null),
  -- F2 IS listing L0 (same URL): the listing must not be counted a second time.
  ('00000000-0000-4000-8000-0000000000f2', 'თბილისი', 'Ваке', 'Paliashvili st 5', 110000, 'USD', 100, 3, 'https://myhome.ge/pr/L0'),
  ('00000000-0000-4000-8000-0000000000f3', 'Tbilisi', 'Gldani', 'Khizanishvili 1', 800, 'USD', 60, 2, null);

-- B1: confirmed Find Property plan, active.
insert into public.intent_profiles (id, intent_type, country, city, district, transaction_type, property_types,
  bedrooms_min, area_min, area_max, budget_min, budget_max, currency, intent_confidence, classifier_version, original_text)
values ('00000000-0000-4000-8000-00000000c001', 'BUY', 'GE', 'Tbilisi', 'Vake', 'SALE', array['APARTMENT'],
  2, 80, 110, 120000, 160000, 'USD', 1, 'search-plan-1.0.0', null);
insert into public.active_search_subscriptions (user_id, intent_id, side, is_active)
values ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000c001', 'SUPPLY', true);
-- B3: requirement stated in a conversation, long inactive, no budget.
insert into public.intent_profiles (id, intent_type, city, district, transaction_type, property_types,
  intent_confidence, classifier_version, original_text, created_at)
values ('00000000-0000-4000-8000-00000000c003', 'BUY', 'Batumi', null, 'SALE', array['APARTMENT'],
  0.6, 'native-intent-1.0.0', 'PRIVATE CHAT WORDS', now() - interval '400 days');
insert into public.active_search_subscriptions (user_id, intent_id, side, is_active, created_at)
values ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-00000000c003', 'SUPPLY', false, now() - interval '400 days');
-- An EXTERNAL demand (a stranger's post): intent profile, no subscription. Never a HOMATCH user.
insert into public.raw_signals (id) values ('00000000-0000-4000-8000-00000000e001');
insert into public.intent_profiles (signal_id, intent_type, city, transaction_type, budget_max, currency, original_text)
values ('00000000-0000-4000-8000-00000000e001', 'BUY', 'Tbilisi', 'SALE', 90000, 'USD', 'STRANGER TEXT');
-- B2: marketplace rent search, recent.
insert into public.discovery_marketplace_searches (user_id, status, brief, request) values
  ('00000000-0000-4000-8000-0000000000b2', 'COMPLETE',
   '{"originalText":"SECRET BRIEF WORDS","price":{"status":"STATED"},"readiness":{"state":"READY"}}',
   '{"transactionType":"RENT","propertyType":"APARTMENT","city":"Tbilisi","country":"GE","districts":["საბურთალო"],"priceMinUsd":600,"priceMaxUsd":900,"areaMinSqm":50,"areaMaxSqm":70,"rooms":{"min":2,"max":null},"bedrooms":{"min":1,"max":null}}');
-- B4: asked to view F1. F1's price is NOT their budget.
insert into public.intent_signals (actor_user_id, source_surface, source_at, side, polarity, attribution, explicit, confidence, property_id, act)
values ('00000000-0000-4000-8000-0000000000b4', 'VIEWING_REQUEST', now() - interval '2 days', 'PROPERTY_INTEREST', 'POSITIVE', 'SELF', true, 1,
        '00000000-0000-4000-8000-0000000000f1', 'TRANSACTION_INTENT');
-- An internal match for B1.
insert into public.supply_matches (compatibility, match_score, property_id, supply_user_id, demand_user_id, source_kind)
values ('COMPATIBLE', 0.82, '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000a2',
        '00000000-0000-4000-8000-0000000000b1', 'INTERNAL_HOMATCH');
insert into public.find_buyers_leads (property_id) values ('00000000-0000-4000-8000-0000000000f1'), ('00000000-0000-4000-8000-0000000000f1');

/* ── market segmentation ──────────────────────────────────────────────── */
do $$
declare v jsonb; t text; n int; r record; v_rule uuid; v_draft jsonb;
begin
  -- keys
  if public.market_place_key('Ваке') <> 'vake' or public.market_place_key(' თბილისი ') <> 'tbilisi' then raise exception 'place key'; end if;
  if public.market_street_key('კრწანისის ქ. 16') <> 'კრწანისის' then raise exception 'street ka: %', public.market_street_key('კრწანისის ქ. 16'); end if;
  if public.market_street_key('ул. Пекина 5') <> 'пекина' then raise exception 'street ru'; end if;
  if public.market_street_key('Chavchavadze Ave. 12a') <> 'chavchavadze' then raise exception 'street en'; end if;
  if public.market_segment_confidence(24, 0.75, 'DISTRICT', 8) <> 0.34 or public.market_segment_confidence(24, 0.5, 'CITY', 8) <> 0.49
     or public.market_segment_confidence(8, 0.2, 'STREET', 8) <> 0.333 then raise exception 'confidence parity'; end if;

  -- comparables: L0 is F2 (deduplicated), latest observation per listing, GEL has no rate
  select count(*) into n from public.market_comparables(10) where comp_key like 'listing:myhome-ge:L0';
  if n <> 0 then raise exception 'L0 should be deduplicated against F2'; end if;
  select count(*) into n from public.market_comparables(10) where source = 'ss-ge' and ppsqm_usd is null and ppsqm_local is not null;
  if n <> 2 then raise exception 'GEL without a rate must be excluded, got %', n; end if;

  -- non-admin refused
  begin perform public.admin_market_segment_preview('{}'); raise exception 'non-admin preview answered';
  exception when others then if sqlerrm not like 'FORBIDDEN%' then raise; end if; end;

  perform set_config('app.admin', 'on', true);
  perform set_config('app.uid', '00000000-0000-4000-8000-0000000000a1', true);
  select id into v_rule from public.market_segment_rules where status = 'ACTIVE';
  v := public.admin_market_segment_preview((select params from public.market_segment_rules where id = v_rule));
  if (v->>'changed_count')::int <> 3 then raise exception 'preview changed_count %', v; end if;
  if (select count(*) from public.property_market_segments) <> 0 then raise exception 'preview wrote rows'; end if;
  if (v->'after'->>'PREMIUM')::int <> 1 or (v->'after'->>'ECONOMY')::int <> 1 or (v->'after'->>'UNKNOWN')::int <> 1 then
    raise exception 'preview after counts %', v->'after'; end if;

  -- guards
  begin perform public.admin_market_segment_apply(v_rule, 99, v->>'confirmation_token'); raise exception 'apply with wrong count ran';
  exception when others then if sqlerrm not like 'CONFIRMATION_MISMATCH%' then raise; end if; end;
  begin perform public.admin_market_segment_apply(v_rule, 3, 'not-the-token'); raise exception 'apply with wrong token ran';
  exception when others then if sqlerrm not like 'CONFIRMATION_MISMATCH%' then raise; end if; end;
  if (select count(*) from public.property_market_segments) <> 0 then raise exception 'a refused apply wrote rows'; end if;

  v := public.admin_market_segment_apply(v_rule, 3, v->>'confirmation_token');
  if (v->>'rows_written')::int <> 3 then raise exception 'apply rows %', v; end if;
  select * into r from public.property_market_segments where property_id = '00000000-0000-4000-8000-0000000000f1';
  if r.segment <> 'PREMIUM' or r.level <> 'DISTRICT' or r.sample_size <> 10 or (r.basis->'thresholds'->>'premiumMin')::numeric <> 1630
     or r.basis->>'priceKind' <> 'ASKING' then raise exception 'F1 %', to_jsonb(r); end if;
  select * into r from public.property_market_segments where property_id = '00000000-0000-4000-8000-0000000000f2';
  if r.segment <> 'ECONOMY' or (r.basis->'thresholds'->>'economyMax')::numeric <> 1370 then raise exception 'F2 %', to_jsonb(r); end if;
  select * into r from public.property_market_segments where property_id = '00000000-0000-4000-8000-0000000000f3';
  if r.segment <> 'UNKNOWN' or r.basis->>'reason' <> 'INSUFFICIENT_COMPARABLES' or r.confidence <> 0 then raise exception 'F3 %', to_jsonb(r); end if;
  if not exists (select 1 from public.market_segment_rule_audit where action = 'APPLIED' and changed_count = 3) then raise exception 'no audit'; end if;

  -- a stricter draft: preview, then apply; the old rule retires
  v_draft := public.admin_market_segment_save_draft('{"minComparables":20}', 'stricter');
  v := public.admin_market_segment_preview(v_draft->'params');
  if (v->>'changed_count')::int <> 2 then raise exception 'strict preview %', v; end if;
  v := public.admin_market_segment_apply((v_draft->>'id')::uuid, 2, v->>'confirmation_token');
  if (select status from public.market_segment_rules where id = v_rule) <> 'RETIRED' then raise exception 'old rule not retired'; end if;
  if (select count(*) from public.market_segment_rules where status = 'ACTIVE') <> 1 then raise exception 'not exactly one active rule'; end if;
  if (select count(*) from public.property_market_segments where segment = 'UNKNOWN') <> 3 then raise exception 'strict apply not stored'; end if;
  if not exists (select 1 from public.market_segment_rule_audit where action = 'RETIRED' and rule_id = v_rule) then raise exception 'no retire audit'; end if;

  -- back to the default numbers for the rest of the checks
  v_draft := public.admin_market_segment_save_draft('{}', 'default again');
  v := public.admin_market_segment_preview(v_draft->'params');
  perform public.admin_market_segment_apply((v_draft->>'id')::uuid, (v->>'changed_count')::int, v->>'confirmation_token');

  -- areas: Vake sufficient, Gldani rent thin, GEL rows reported
  v := public.admin_market_segment_areas(null);
  if not exists (select 1 from jsonb_array_elements(v->'areas') a where a->>'district' = 'vake' and a->>'transaction' = 'SALE'
                   and (a->>'sufficient')::boolean and (a->>'no_fx_rate')::int = 2 and (a->>'sample_size')::int = 11) then
    raise exception 'vake area %', v; end if;
  if not exists (select 1 from jsonb_array_elements(v->'areas') a where a->>'district' = 'gldani' and not (a->>'sufficient')::boolean) then
    raise exception 'gldani should be insufficient'; end if;

  -- list: multi-select, any-script places, paging, no contact phone
  v := public.admin_property_segments_list('{"segments":["PREMIUM"]}', 'computed_desc', 1, 25);
  if (v->>'total')::int <> 1 or v->'rows'->0->>'homatch_id' <> '482915' then raise exception 'segment filter %', v; end if;
  v := public.admin_property_segments_list('{"district":"ვაკე","city":"тбилиси"}', 'price_desc', 1, 1);
  if (v->>'total')::int <> 2 or jsonb_array_length(v->'rows') <> 1 or v->'rows'->0->>'homatch_id' <> '482915' then raise exception 'place filter %', v; end if;
  v := public.admin_property_segments_list('{"property_types":["APARTMENT"],"transaction":"SALE"}', 'homatch_id', 1, 25);
  if (v->>'total')::int <> 2 then raise exception 'type family filter %', v; end if;
  if v::text like '%+99555%' or v::text like '%contact_phone%' then raise exception 'contact phone exposed'; end if;

  -- owner may refresh their own; a stranger may not
  perform set_config('app.admin', '', true);
  perform set_config('app.uid', '00000000-0000-4000-8000-0000000000a2', true);
  perform public.compute_property_market_segment('00000000-0000-4000-8000-0000000000f1');
  perform set_config('app.uid', '00000000-0000-4000-8000-0000000000b1', true);
  begin perform public.compute_property_market_segment('00000000-0000-4000-8000-0000000000f1'); raise exception 'stranger computed';
  exception when others then if sqlerrm not like 'FORBIDDEN%' then raise; end if; end;
  begin perform public.admin_property_segments_list('{}', null, 1, 10); raise exception 'non-admin list answered';
  exception when others then if sqlerrm not like 'FORBIDDEN%' then raise; end if; end;
  raise notice 'MARKET SEGMENTATION CHECKS: PASS';
end $$;

/* ── buyer intelligence ───────────────────────────────────────────────── */
do $$
declare v jsonb; s jsonb;
begin
  begin perform public.admin_buyer_intelligence_list('{}', null, 1, 10); raise exception 'non-admin list answered';
  exception when others then if sqlerrm not like 'FORBIDDEN%' then raise; end if; end;
  begin perform public.admin_buyer_intelligence_stats('{}'); raise exception 'non-admin stats answered';
  exception when others then if sqlerrm not like 'FORBIDDEN%' then raise; end if; end;
  perform set_config('app.admin', 'on', true);

  v := public.admin_buyer_intelligence_list('{}', 'latest_desc', 1, 25);
  if (v->>'total')::int <> 4 then raise exception 'people %', v; end if;   -- the external demand is not a person here
  if v::text like '%PRIVATE CHAT WORDS%' or v::text like '%SECRET BRIEF WORDS%' or v::text like '%STRANGER TEXT%' then
    raise exception 'text leaked into the list'; end if;

  select r into s from jsonb_array_elements(v->'rows') r where r->>'user_id' = '00000000-0000-4000-8000-0000000000b1';
  if s->>'intent_level' <> 'ACTIVE_SEARCH' or not (s->'sources' ? 'FIND_PROPERTY_PLAN') or not (s->>'budget_confirmed')::boolean
     or (s->>'internal_matches')::int <> 1 or s->'segments' <> '["ECONOMY","MIDDLE","PREMIUM"]'::jsonb then raise exception 'B1 %', s; end if;
  select r into s from jsonb_array_elements(v->'rows') r where r->>'user_id' = '00000000-0000-4000-8000-0000000000b2';
  if s->>'role' <> 'TENANT' or s->>'intent_level' <> 'ACTIVE_SEARCH' or (s->>'budget_max_usd')::numeric <> 900 then raise exception 'B2 %', s; end if;
  select r into s from jsonb_array_elements(v->'rows') r where r->>'user_id' = '00000000-0000-4000-8000-0000000000b3';
  if s->>'intent_level' <> 'SAVED_REQUIREMENTS' or not (s->>'stale')::boolean or (s->>'budget_confirmed')::boolean then raise exception 'B3 %', s; end if;
  select r into s from jsonb_array_elements(v->'rows') r where r->>'user_id' = '00000000-0000-4000-8000-0000000000b4';
  if s->>'intent_level' <> 'EXPLICIT_INTENT' or s->>'budget_max_usd' is not null or (s->>'budget_confirmed')::boolean then
    raise exception 'B4: a viewed property price became a budget %', s; end if;

  -- filters
  if (public.admin_buyer_intelligence_list('{"district":"ვაკე"}', null, 1, 25)->>'total')::int <> 2 then raise exception 'district filter'; end if;
  if (public.admin_buyer_intelligence_list('{"city":"тбилиси","role":"TENANT"}', null, 1, 25)->>'total')::int <> 1 then raise exception 'role filter'; end if;
  if (public.admin_buyer_intelligence_list('{"status":"STALE"}', null, 1, 25)->>'total')::int <> 1 then raise exception 'stale filter'; end if;
  if (public.admin_buyer_intelligence_list('{"match_strength":"STRONG"}', null, 1, 25)->>'total')::int <> 1 then raise exception 'match filter'; end if;
  if (public.admin_buyer_intelligence_list('{"sources":["VIEWING_REQUEST"]}', null, 1, 25)->>'total')::int <> 1 then raise exception 'source filter'; end if;
  if (public.admin_buyer_intelligence_list('{"segments":["PREMIUM"],"budget":"CONFIRMED"}', null, 1, 25)->>'total')::int <> 1 then raise exception 'segment filter'; end if;
  if (public.admin_buyer_intelligence_list('{"origin":"EXTERNAL"}', null, 1, 25)->>'total')::int <> 0 then raise exception 'origin filter'; end if;
  if (public.admin_buyer_intelligence_list('{"min_price":150000}', null, 1, 25)->>'total')::int <> 1 then raise exception 'budget overlap filter'; end if;
  v := public.admin_buyer_intelligence_list('{}', 'level_desc', 2, 3);
  if (v->>'total')::int <> 4 or jsonb_array_length(v->'rows') <> 1 then raise exception 'paging %', v; end if;

  -- stats
  v := public.admin_buyer_intelligence_stats('{}');
  if (v->>'people')::int <> 4 or (v->>'tenants')::int <> 1 or (v->>'stale')::int <> 1 or (v->>'eligible_tenants')::int <> 1
     or (v->'internal_matches'->>'total')::int <> 1 or (v->'external_leads'->>'available')::boolean
     or v->'external_leads'->>'reason' <> 'MATCH_CATEGORY_NOT_DEPLOYED' then raise exception 'stats %', v; end if;
  alter table public.find_buyers_leads add column match_category text;
  update public.find_buyers_leads set match_category = 'STRONG';
  v := public.admin_buyer_intelligence_stats('{"city":"Tbilisi"}');
  if not (v->'external_leads'->>'available')::boolean or (v->'external_leads'->>'qualified')::int <> 2 then raise exception 'external %', v; end if;

  -- inspect drawer: evidence without text
  v := public.admin_buyer_intelligence_detail('00000000-0000-4000-8000-0000000000b3');
  if jsonb_array_length(v->'evidence') <> 1 or v::text like '%PRIVATE CHAT WORDS%' or v->'evidence'->0->>'source' <> 'STATED_IN_CONVERSATION' then
    raise exception 'detail %', v; end if;
  raise notice 'BUYER INTELLIGENCE CHECKS: PASS';
end $$;
