-- FIND BUYERS: the campaign report and admin intelligence (20261024130000).
-- Every number comes from the campaign's rows; a legacy campaign (no
-- qualification columns written) reports its leads as UNCATEGORISED, never
-- as qualified; the owner never sees provider money; notes are computed.
\set ON_ERROR_STOP on
insert into public.users (id) values ('00000000-0000-0000-0000-0000000007a1'), ('00000000-0000-0000-0000-0000000007a2') on conflict do nothing;
insert into public.properties (id, user_id) values ('00000000-0000-0000-0000-0000000007b1', '00000000-0000-0000-0000-0000000007a1');
insert into public.matching_jobs (id, user_id, property_id, idempotency_key, status) values
  ('00000000-0000-0000-0000-0000000007c1', '00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-0000000007b1', 'report-q', 'completed'),
  ('00000000-0000-0000-0000-0000000007c2', '00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-0000000007b1', 'report-legacy', 'completed');

/* A qualified SALE campaign: $1.00 provider budget, 100 credits. */
insert into public.find_buyers_campaigns (matching_job_id, property_id, user_id, transaction, credits_committed, credits_per_usd, customer_value_micros,
  provider_budget_micros, languages, dna, query_plan, stats, created_at, finalized_at, stop_reason, strategy, metrics)
values ('00000000-0000-0000-0000-0000000007c1', '00000000-0000-0000-0000-0000000007b1', '00000000-0000-0000-0000-0000000007a1', 'SALE', 100, 10, 10000000, 1000000,
  array['ka','ru','en'],
  '{"city":"Tbilisi","district":"Krtsanisi","price":213840,"currency":"USD","rooms":3,"bedrooms":2,"areaSqm":97.2,"propertyType":"APARTMENT","counterpart":"BUYER","transaction":"SALE",
    "tolerances":{"price":{"min":171072,"max":256608},"bedrooms":{"min":1,"max":3},"area":{"min":78,"max":117}}}',
  '{"phases":{"phase1DeadlineAt":"2026-10-09T05:38:28Z","planned":{"phase1":3,"phase2SourceDependent":2,"phase2IndependentSearch":2}}}',
  '{"languagesSearched":["ka","ru","en"],"staleSkipped":11,"duplicatesRemoved":3,"signalsAnalyzed":99}',
  now() - interval '40 minutes', now() - interval '10 minutes', 'FINALIZE',
  '{"personas":["RELOCATING_FAMILY","INVESTOR"],"budgetBand":{"min":180000,"max":240000,"currency":"USD"},"places":["Krtsanisi","Old Tbilisi"]}',
  '{"firstVisibleAt":"2026-10-09T05:33:30Z"}');

insert into public.find_buyers_actor_runs (idempotency_key, matching_job_id, actor_key, actor_id, source, operation, language, requested_limit, status,
  reserved_micros, actual_micros, items_fetched, qualified_leads, reason, started_at) values
  ('rep-1', '00000000-0000-0000-0000-0000000007c1', 'FB_GROUP_POSTS', 'memo23~x', 'FACEBOOK', 'FB_GROUP_POSTS', 'ru', 20, 'SUCCEEDED', 60000, 50000, 40, 2,
   '{"targetUrl":"https://www.facebook.com/groups/real.tbilisi/","query":null}', now() - interval '30 minutes'),
  ('rep-2', '00000000-0000-0000-0000-0000000007c1', 'FB_GROUP_SEARCH', 'memo23~y', 'FACEBOOK', 'FB_GROUP_SEARCH', 'en', 10, 'SUCCEEDED', 30000, 20000, 12, 0,
   '{"query":"Tbilisi apartments"}', now() - interval '38 minutes'),
  ('rep-3', '00000000-0000-0000-0000-0000000007c1', 'BLUESKY', 'memo23~z', 'BLUESKY', 'BLUESKY_SEARCH', 'en', 10, 'FAILED', 30000, 10000, 0, 0,
   '{"query":"looking to buy apartment in Tbilisi"}', now() - interval '35 minutes'),
  ('rep-4', '00000000-0000-0000-0000-0000000007c1', 'TELEGRAM_CHANNEL', 'memo23~t', 'TELEGRAM', 'TELEGRAM_CHANNEL', 'multi', 20, 'SUCCEEDED', 20000, 8000, 13, 0,
   '{"targetUrl":"https://t.me/arenda_tbilisi"}', now() - interval '25 minutes'),
  ('rep-5', '00000000-0000-0000-0000-0000000007c1', 'TIKTOK', 'memo23~k', 'TIKTOK', 'TIKTOK_SEARCH', 'tr', 20, 'RELEASED', 35000, 0, 0, 0, '{}', null);
insert into public.find_buyers_cost_ledger (idempotency_key, matching_job_id, kind, provider, operation, estimated_micros, actual_micros, cost_state) values
  ('rep-ai-1', '00000000-0000-0000-0000-0000000007c1', 'AI', 'OPENAI', 'CLASSIFY', 12000, null, 'ESTIMATED');

insert into public.discovery_query_queue (property_id, platform, language, query, status, result_count, provider, matching_job_id, cancel_reason, metadata, finished_at) values
  ('00000000-0000-0000-0000-0000000007b1', 'FACEBOOK', 'ka', 'r1', 'CANCELLED', 0, 'APIFY_MEMO23', '00000000-0000-0000-0000-0000000007c1', 'PHASE1_BUDGET', '{"stage":"FB_GROUP_SEARCH","lastWait":"ACTOR_BUSY"}', now() - interval '36 minutes'),
  ('00000000-0000-0000-0000-0000000007b1', 'FACEBOOK', 'en', 'r2', 'DONE', 12, 'APIFY_MEMO23', '00000000-0000-0000-0000-0000000007c1', null, '{"stage":"FB_GROUP_SEARCH"}', now() - interval '37 minutes'),
  ('00000000-0000-0000-0000-0000000007b1', 'FACEBOOK', 'ru', 'r3', 'DONE', 40, 'APIFY_MEMO23', '00000000-0000-0000-0000-0000000007c1', null, '{"stage":"FB_GROUP_POSTS","targetUrl":"https://www.facebook.com/groups/real.tbilisi/"}', now() - interval '20 minutes'),
  ('00000000-0000-0000-0000-0000000007b1', 'FACEBOOK', 'en', 'r4', 'CANCELLED', 0, 'APIFY_MEMO23', '00000000-0000-0000-0000-0000000007c1', 'CAMPAIGN_DEADLINE', '{"stage":"FB_GROUP_POSTS","targetUrl":"https://www.facebook.com/groups/expats.tbilisi/"}', now() - interval '11 minutes'),
  ('00000000-0000-0000-0000-0000000007b1', 'OTHER', 'en', 'r5', 'FAILED', 0, 'APIFY_MEMO23', '00000000-0000-0000-0000-0000000007c1', null, '{"stage":"BLUESKY_SEARCH"}', now() - interval '34 minutes'),
  ('00000000-0000-0000-0000-0000000007b1', 'TELEGRAM', 'multi', 'r6', 'DONE', 0, 'TELEGRAM', '00000000-0000-0000-0000-0000000007c1', null, '{"lastWait":"PHASE1_DISCOVERY","last_outcome":{"newMessages":5,"targetsConsidered":3}}', now() - interval '30 minutes'),
  ('00000000-0000-0000-0000-0000000007b1', 'TELEGRAM', 'ka,ru,en', 'r7', 'DONE', 9, 'TELEGRAM_SOURCES', '00000000-0000-0000-0000-0000000007c1', null,
   '{"city":"Tbilisi","last_outcome":{"communitiesFound":9,"activated":2,"languagesSearched":["ka","ru","en","ar"]}}', now() - interval '38 minutes');

/* Assessed signals: 2 buyers, 4 renters, 6 sale offers, 3 job posts. */
insert into public.find_buyers_assessments (matching_job_id, signal_id, content_kind, intent_class, comments_decision, language, role, match_category, rejection_reasons)
select '00000000-0000-0000-0000-0000000007c1', gen_random_uuid(), 'POST', ic, cd, 'ru', role, cat, rr
  from (values ('BUYER_HIGH', null, 'BUY_SEEKER', 'STRONG', '{}'::text[]), ('BUYER_HIGH', null, 'BUY_SEEKER', 'POTENTIAL', '{}'),
               ('BUYER_HIGH', 'SKIP_NO_COMMENTS', 'RENT_SEEKER', 'REJECTED', '{WRONG_TRANSACTION}'), ('BUYER_HIGH', 'SKIP_NO_COMMENTS', 'RENT_SEEKER', 'REJECTED', '{WRONG_TRANSACTION}'),
               ('BUYER_MEDIUM', 'SKIP_NO_COMMENTS', 'RENT_SEEKER', 'REJECTED', '{WRONG_TRANSACTION}'), ('BUYER_MEDIUM', 'SKIP_NO_COMMENTS', 'RENT_SEEKER', 'REJECTED', '{WRONG_TRANSACTION}'),
               ('SELLER', 'SKIP_NO_COMMENTS', 'SALE_OFFER', 'REJECTED', '{SALE_ADVERTISEMENT}'), ('SELLER', 'SKIP_NO_COMMENTS', 'SALE_OFFER', 'REJECTED', '{SALE_ADVERTISEMENT}'),
               ('SELLER', 'SKIP_NO_COMMENTS', 'SALE_OFFER', 'REJECTED', '{SALE_ADVERTISEMENT}'), ('SELLER', 'SKIP_LOW_SIMILARITY', 'SALE_OFFER', 'REJECTED', '{SALE_ADVERTISEMENT}'),
               ('SELLER', 'SKIP_LOW_SIMILARITY', 'SALE_OFFER', 'REJECTED', '{SALE_ADVERTISEMENT}'), ('AGENT', null, 'SALE_OFFER', 'REJECTED', '{SALE_ADVERTISEMENT}'),
               ('BUYER_HIGH', null, 'JOB', 'REJECTED', '{JOB_SEARCH}'), ('BUYER_HIGH', null, 'JOB', 'REJECTED', '{JOB_SEARCH}'), ('UNCERTAIN', null, 'JOB', 'REJECTED', '{JOB_SEARCH}')
       ) v(ic, cd, role, cat, rr);

insert into public.find_buyers_persons (id, network, person_key) values
  ('00000000-0000-0000-0000-0000000007e1', 'FACEBOOK', 'rep-p1'), ('00000000-0000-0000-0000-0000000007e2', 'FACEBOOK', 'rep-p2'),
  ('00000000-0000-0000-0000-0000000007e3', 'FACEBOOK', 'rep-p3'), ('00000000-0000-0000-0000-0000000007e4', 'FACEBOOK', 'rep-p4'),
  ('00000000-0000-0000-0000-0000000007e5', 'FACEBOOK', 'rep-p5'), ('00000000-0000-0000-0000-0000000007e6', 'FACEBOOK', 'rep-p6');
insert into public.find_buyers_leads (matching_job_id, property_id, user_id, person_id, counterpart, source, intent_class, overall_score, strength, signal_at, created_at,
  evidence, role, match_category, rejection_reasons, budget_fit, location_fit, requalified_at) values
  ('00000000-0000-0000-0000-0000000007c1', '00000000-0000-0000-0000-0000000007b1', '00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-0000000007e1', 'BUYER', 'FACEBOOK', 'BUYER_HIGH', 90, 'STRONG',
   now() - interval '2 days', now() - interval '25 minutes', '[{"url":"https://www.facebook.com/groups/real.tbilisi/permalink/1/"}]', 'BUY_SEEKER', 'STRONG', '{}', 'UNKNOWN', 'NEARBY', now()),
  ('00000000-0000-0000-0000-0000000007c1', '00000000-0000-0000-0000-0000000007b1', '00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-0000000007e2', 'BUYER', 'FACEBOOK', 'BUYER_HIGH', 70, 'GOOD',
   now() - interval '3 days', now() - interval '24 minutes', '[{"url":"https://m.facebook.com/groups/real.tbilisi/posts/2/"}]', 'BUY_SEEKER', 'POTENTIAL', '{}', 'UNKNOWN', 'COMPATIBLE', now()),
  ('00000000-0000-0000-0000-0000000007c1', '00000000-0000-0000-0000-0000000007b1', '00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-0000000007e3', 'BUYER', 'TELEGRAM', 'BUYER_MEDIUM', 55, 'POSSIBLE',
   now() - interval '4 days', now() - interval '20 minutes', '[{"url":"https://t.me/arenda_tbilisi/77"}]', 'UNCLEAR', 'WEAK', '{}', 'UNKNOWN', 'UNKNOWN', now()),
  ('00000000-0000-0000-0000-0000000007c1', '00000000-0000-0000-0000-0000000007b1', '00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-0000000007e4', 'BUYER', 'FACEBOOK', 'BUYER_HIGH', 80, 'GOOD',
   now() - interval '2 days', now() - interval '26 minutes', '[{"url":"https://www.facebook.com/groups/jobingeorgia/permalink/3/"}]', 'JOB', 'REJECTED', '{JOB_SEARCH}', 'UNKNOWN', 'UNKNOWN', now()),
  ('00000000-0000-0000-0000-0000000007c1', '00000000-0000-0000-0000-0000000007b1', '00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-0000000007e5', 'BUYER', 'FACEBOOK', 'BUYER_HIGH', 80, 'GOOD',
   now() - interval '2 days', now() - interval '26 minutes', '[{"url":"https://www.facebook.com/groups/rent.tbilisi/permalink/4/"}]', 'RENT_SEEKER', 'REJECTED', '{WRONG_TRANSACTION}', 'UNKNOWN', 'COMPATIBLE', now());

/* A legacy campaign: leads without any qualification columns written. */
insert into public.find_buyers_campaigns (matching_job_id, property_id, user_id, transaction, credits_committed, credits_per_usd, customer_value_micros, provider_budget_micros, stats, finalized_at)
values ('00000000-0000-0000-0000-0000000007c2', '00000000-0000-0000-0000-0000000007b1', '00000000-0000-0000-0000-0000000007a1', 'SALE', 100, 10, 10000000, 2800000,
        '{"signalsAnalyzed":412,"staleSkipped":103,"duplicatesRemoved":7}', now());
insert into public.find_buyers_assessments (matching_job_id, signal_id, content_kind, intent_class, comments_decision, language)
select '00000000-0000-0000-0000-0000000007c2', gen_random_uuid(), 'POST', ic, 'SKIP_NO_COMMENTS', 'ka'
  from (select case when g <= 6 then 'SELLER' else 'BUYER_HIGH' end ic from generate_series(1, 10) g) v;
insert into public.find_buyers_leads (matching_job_id, property_id, user_id, person_id, counterpart, source, intent_class, overall_score, strength, signal_at)
values ('00000000-0000-0000-0000-0000000007c2', '00000000-0000-0000-0000-0000000007b1', '00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-0000000007e6', 'BUYER', 'FACEBOOK', 'BUYER_HIGH', 92, 'STRONG', now() - interval '1 day');

do $$
declare r jsonb; lg jsonb; n jsonb; codes text[]; adm jsonb;
begin
  /* Authorization: owner yes, stranger and unknown job FORBIDDEN, anon no grant. */
  perform set_config('app.uid', '00000000-0000-0000-0000-0000000007a2', true);
  begin perform public.find_buyers_campaign_report('00000000-0000-0000-0000-0000000007c1'); assert false, 'a stranger must be refused';
  exception when others then assert sqlerrm = 'FORBIDDEN', sqlerrm; end;
  perform set_config('app.uid', '00000000-0000-0000-0000-0000000007a1', true);
  begin perform public.find_buyers_campaign_report('00000000-0000-0000-0000-00000000ffff'); assert false, 'an unknown job must be refused';
  exception when others then assert sqlerrm = 'FORBIDDEN', sqlerrm; end;
  assert not has_function_privilege('anon', 'public.find_buyers_campaign_report(uuid)', 'execute'), 'anon cannot read a report';
  assert has_function_privilege('authenticated', 'public.find_buyers_campaign_report(uuid)', 'execute');

  r := public.find_buyers_campaign_report('00000000-0000-0000-0000-0000000007c1');
  assert r -> 'economics' = 'null'::jsonb, 'the owner never sees provider money: ' || (r -> 'economics')::text;
  assert r::text !~ 'Micros', 'no micros key in the owner report';
  assert (r ->> 'live')::boolean = false and (r ->> 'legacy')::boolean = false, r::text;
  /* property + strategy-based profile */
  assert r #>> '{property,district}' = 'Krtsanisi' and (r #>> '{property,bedrooms}')::int = 2 and r #>> '{property,counterpart}' = 'BUYER', (r -> 'property')::text;
  assert r #>> '{buyerProfile,basis}' = 'STRATEGY' and jsonb_array_length(r #> '{buyerProfile,personas}') = 2
     and (r #>> '{buyerProfile,budgetBand,min}')::int = 180000, (r -> 'buyerProfile')::text;
  /* coverage */
  assert r #> '{coverage,languages}' = '["ar","en","ka","ru"]'::jsonb, 'languages = stats ∪ runs ∪ Telegram discovery: ' || (r #> '{coverage,languages}')::text;
  assert (r #>> '{coverage,telegramCommunitiesDiscovered}')::int = 9 and (r #>> '{coverage,groupsFound}')::int = 12
     and (r #>> '{coverage,communitiesDiscovered}')::int = 21, (r -> 'coverage')::text;
  assert (r #>> '{coverage,communitiesRead}')::int = 2, 'one FB group + one TG channel read: ' || (r -> 'coverage')::text;
  assert (r #>> '{coverage,postsRetrieved}')::int = 40 + 13 + 5, 'group posts + paid TG + free TG messages (search results are groups, not posts)';
  assert (r #>> '{coverage,signalsAnalysed}')::int = 15 and (r #>> '{coverage,commentsExamined}')::int = 0, (r -> 'coverage')::text;
  assert (r #>> '{coverage,staleSkipped}')::int = 11 and (r #>> '{coverage,duplicatesRemoved}')::int = 3;
  select x into n from jsonb_array_elements(r #> '{coverage,platforms}') x where x ->> 'platform' = 'BLUESKY';
  assert n ->> 'state' = 'FAILED', n::text;
  assert not exists (select 1 from jsonb_array_elements(r #> '{coverage,platforms}') x where x ->> 'platform' = 'TIKTOK'), 'a released run never ran';
  select x into n from jsonb_array_elements(r #> '{coverage,platforms}') x where x ->> 'platform' = 'FACEBOOK';
  assert n ->> 'state' = 'READ' and (n ->> 'items')::int = 52 and (n ->> 'qualified')::int = 2, n::text;
  /* budget: (50000+20000+10000+8000) actors + 12000 AI = 100000 of 1000000 → 10% */
  assert (r #>> '{budget,usedPct}')::int = 10 and (r #>> '{budget,creditsCommitted}')::int = 100 and (r #>> '{budget,exhausted}')::boolean = false, (r -> 'budget')::text;
  /* results: current, non-rejected categories; rejected kept and explained */
  assert (r #>> '{results,strong}')::int = 1 and (r #>> '{results,potential}')::int = 1 and (r #>> '{results,weak}')::int = 1
     and (r #>> '{results,uncategorised}')::int = 0 and (r #>> '{results,rejected}')::int = 2 and (r #>> '{results,visible}')::int = 3, (r -> 'results')::text;
  assert (r #>> '{results,rejectionReasons,JOB_SEARCH}')::int = 1 and (r #>> '{results,rejectionReasons,WRONG_TRANSACTION}')::int = 1, (r -> 'results')::text;
  assert (r #>> '{results,signalRoles,RENT_SEEKER}')::int = 4 and (r #>> '{results,signalRoles,SALE_OFFER}')::int = 6 and (r #>> '{results,signalRoles,JOB}')::int = 3;
  assert (r #>> '{results,budgetFit,UNKNOWN}')::int = 3 and r #>> '{results,budgetFit,COMPATIBLE}' is null, 'UNKNOWN is never COMPATIBLE';
  /* timing */
  assert r #>> '{timing,firstVisibleAt}' = '2026-10-09T05:33:30Z' and r #>> '{timing,firstQualifiedAt}' is not null
     and (r #>> '{timing,durationSeconds}')::int between 1790 and 1810, (r -> 'timing')::text;
  /* best sources: the group with qualified leads first, with its budget share */
  assert r #>> '{bestSources,0,community}' = 'facebook.com/groups/real.tbilisi' and (r #>> '{bestSources,0,qualified}')::int = 2
     and (r #>> '{bestSources,0,postsRead}')::int = 40 and (r #>> '{bestSources,0,budgetSharePct}')::numeric = 50.0, (r -> 'bestSources')::text;
  /* planned vs executed */
  assert (r #>> '{coveragePlan,queue,total}')::int = 7 and (r #>> '{coveragePlan,queue,cancelled}')::int = 2
     and (r #>> '{coveragePlan,cancelledBy,PHASE1_BUDGET}')::int = 1 and (r #>> '{coveragePlan,planned,phase1}')::int = 3, (r -> 'coveragePlan')::text;
  /* notes, computed */
  select array_agg(x ->> 'code' order by ord) into codes from jsonb_array_elements(r -> 'notes') with ordinality t(x, ord);
  assert codes = array['NO_LOCATION_AND_PRICE_MATCH', 'RENTAL_DEMAND_DOMINANT', 'SUPPLY_DOMINANT', 'JOB_GROUP_NOISE', 'SOURCES_FAILED', 'BUDGET_LIMITED',
                       'TIME_LIMITED', 'COMMENTS_NOT_EXAMINED', 'TELEGRAM_COVERAGE', 'NO_BUDGET_STATED', 'EXPANSION_OPTIONS'], codes::text;
  select x into n from jsonb_array_elements(r -> 'notes') x where x ->> 'code' = 'NO_LOCATION_AND_PRICE_MATCH';
  assert (n #>> '{params,genuineBuyers}')::int = 2, n::text;
  select x into n from jsonb_array_elements(r -> 'notes') x where x ->> 'code' = 'RENTAL_DEMAND_DOMINANT';
  assert (n #>> '{params,share}')::int = 67 and (n #>> '{params,otherSeekers}')::int = 4, n::text;
  select x into n from jsonb_array_elements(r -> 'notes') x where x ->> 'code' = 'SUPPLY_DOMINANT';
  assert (n #>> '{params,share}')::int = 40 and n #>> '{params,basis}' = 'ROLE', n::text;
  select x into n from jsonb_array_elements(r -> 'notes') x where x ->> 'code' = 'TELEGRAM_COVERAGE';
  assert (n #>> '{params,free}')::int = 5 and (n #>> '{params,paid}')::int = 13 and (n #>> '{params,paidChannels}')::int = 1 and (n #>> '{params,discovered}')::int = 9, n::text;
  select x into n from jsonb_array_elements(r -> 'notes') x where x ->> 'code' = 'EXPANSION_OPTIONS';
  assert n #> '{params,languages}' = '["ka"]'::jsonb and (n #>> '{params,groupsUnread}')::int = 1 and n #> '{params,sources}' = '["BLUESKY"]'::jsonb
     and (n #>> '{params,telegramUnread}')::int = 7, n::text;
  select array_agg(x ->> 'code') into codes from jsonb_array_elements(r -> 'limitations') x;
  assert codes @> array['SOURCES_FAILED', 'DISCOVERY_BUDGET_CAP', 'TIME_LIMIT', 'BUDGET_UNKNOWN', 'COMMENTS_NOT_EXAMINED'] and not codes @> array['LEGACY_UNCATEGORISED'], codes::text;

  /* A legacy campaign: a coherent report, its leads UNCATEGORISED, never qualified. */
  lg := public.find_buyers_campaign_report('00000000-0000-0000-0000-0000000007c2');
  assert (lg ->> 'legacy')::boolean and (lg #>> '{results,strong}')::int = 0 and (lg #>> '{results,potential}')::int = 0
     and (lg #>> '{results,uncategorised}')::int = 1 and (lg #>> '{results,visible}')::int = 1, (lg -> 'results')::text;
  assert lg #>> '{buyerProfile,basis}' = 'PROPERTY' and (lg #>> '{coverage,signalsAnalysed}')::int = 10 and (lg #>> '{budget,usedPct}')::int = 0, lg::text;
  select array_agg(x ->> 'code' order by ord) into codes from jsonb_array_elements(lg -> 'notes') with ordinality t(x, ord);
  assert codes = array['LEGACY_UNCATEGORISED', 'SUPPLY_DOMINANT', 'COMMENTS_NOT_EXAMINED'], 'legacy notes: ' || codes::text;
  select x into n from jsonb_array_elements(lg -> 'notes') x where x ->> 'code' = 'SUPPLY_DOMINANT';
  assert n #>> '{params,basis}' = 'INTENT' and (n #>> '{params,share}')::int = 60, n::text;

  /* Admin: economics on the report, and the intelligence view. */
  perform set_config('app.uid', '', true);
  begin perform public.admin_find_buyers_intelligence(7); assert false, 'a non-admin must be refused';
  exception when others then assert sqlerrm = 'FORBIDDEN', sqlerrm; end;
  perform set_config('app.admin', 'on', true);
  r := public.find_buyers_campaign_report('00000000-0000-0000-0000-0000000007c1');
  assert (r #>> '{economics,usedMicros}')::bigint = 100000 and (r #>> '{economics,aiMicros}')::bigint = 12000, (r -> 'economics')::text;
  adm := public.admin_find_buyers_intelligence(7);
  assert (adm ->> 'campaigns')::int >= 2, adm::text;
  select x into n from jsonb_array_elements(adm -> 'actors') x where x ->> 'actorKey' = 'FB_GROUP_POSTS';
  assert (n ->> 'costMicros')::bigint = 50000 and (n ->> 'qualified')::int = 2 and (n ->> 'costPerQualifiedMicros')::bigint = 25000, n::text;
  assert not exists (select 1 from jsonb_array_elements(adm -> 'actors') x where x ->> 'actorKey' = 'TIKTOK'), 'released runs are not counted';
  select x into n from jsonb_array_elements(adm -> 'queries') x where x ->> 'query' = 'Tbilisi apartments';
  assert (n ->> 'items')::int = 12 and (n ->> 'costMicros')::bigint = 20000, n::text;
  assert (adm #>> '{falsePositives,requalified}')::int = 5 and (adm #>> '{falsePositives,rejectedAfterRequalification}')::int = 2
     and (adm #>> '{falsePositives,rate}')::numeric = 0.4, (adm -> 'falsePositives')::text;
  assert (adm #>> '{rejectionReasons,JOB_SEARCH}')::int = 1 and (adm #>> '{signalRejectionReasons,SALE_ADVERTISEMENT}')::int = 6, adm::text;
  select x into n from jsonb_array_elements(adm -> 'sourceQuality') x where x ->> 'community' = 'facebook.com/groups/real.tbilisi';
  assert (n ->> 'qualified')::int = 2 and (n ->> 'costMicros')::bigint = 50000 and (n ->> 'qualifiedPerDollar')::numeric = 40, n::text;
  select x into n from jsonb_array_elements(adm -> 'sourceQuality') x where x ->> 'community' = 'facebook.com/groups/jobingeorgia';
  assert (n ->> 'rejected')::int = 1 and (n ->> 'costMicros')::bigint = 0, 'a group seen only through leads still reports: ' || n::text;
  assert (adm #>> '{telegram,freeMessages}')::int >= 5 and (adm #>> '{telegram,paidItems}')::int >= 13, (adm -> 'telegram')::text;
  assert (adm #>> '{bottlenecks,waits,ACTOR_BUSY}')::int >= 1 and (adm #>> '{bottlenecks,cancelled,CAMPAIGN_DEADLINE}')::int >= 1, (adm -> 'bottlenecks')::text;
  assert (adm #>> '{comments,decisions,SKIP_NO_COMMENTS}')::int >= 8, (adm -> 'comments')::text;
  select x into n from jsonb_array_elements(adm -> 'timing') x where x ->> 'jobId' = '00000000-0000-0000-0000-0000000007c1';
  assert n ->> 'phase1EndedAt' is not null and n ->> 'firstExtractionAt' is not null and (n ->> 'phase1Seconds')::int between 100 and 300, n::text;
  perform set_config('app.admin', '', true);
  assert not has_function_privilege('anon', 'public.admin_find_buyers_intelligence(integer)', 'execute'), 'anon cannot call it';
end $$;

select 'FIND BUYERS CAMPAIGN REPORT CHECKS PASS';
