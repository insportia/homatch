-- Behavioural checks for 20261008100000_phase2_universal_discovery.sql.
-- Run against a fixture with the migration applied; every check raises on failure.
do $$
declare
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid();
  p uuid := gen_random_uuid();
  big uuid := gen_random_uuid(); small uuid := gen_random_uuid(); ended uuid := gen_random_uuid();
  r jsonb; n int; picked text[]; i int;
begin
  insert into public.users(id) values (u1), (u2);
  insert into public.properties(id) values (p);
  insert into public.matching_jobs(id,user_id,property_id,idempotency_key,status,discovery_deadline_at) values
    (big, u1, p, 'b', 'searching_sources', now() + interval '20 minutes'),
    (small, u2, p, 's', 'searching_sources', now() + interval '20 minutes'),
    (ended, u1, p, 'e', 'completed', now());
  -- the big campaign has 6 forum jobs, the small one 1 Telegram job, an ended one has 1, a retired one exists
  for i in 1..6 loop
    insert into public.discovery_query_queue(property_id,platform,language,query,provider,matching_job_id,priority,created_at)
    values (p,'FORUM','multi','f'||i,'FORUM',big,90,now() - interval '1 hour');
  end loop;
  insert into public.discovery_query_queue(property_id,platform,language,query,provider,matching_job_id,priority)
  values (p,'TELEGRAM','multi','t','TELEGRAM',small,10),
         (p,'FORUM','multi','x','FORUM',ended,99),
         (p,'GOOGLE','en','d','DATAFORSEO',small,100),
         (p,'WEBSITE','multi','w','PORTAL',small,100);
  update public.discovery_query_queue set executor = 'WORKER' where provider = 'PORTAL';

  -- 1. fairness: one pass of 2 gives one job to EACH campaign, not two to the big one
  select array_agg(provider order by provider) into picked from public.claim_discovery_source_jobs_v2(2, 180, 4, 'EDGE', null);
  if picked is distinct from array['FORUM','TELEGRAM'] then raise exception 'fairness: got %', picked; end if;

  -- 2. provider cap: FORUM cap 1 is busy, TELEGRAM cap 1 is busy -> nothing more for EDGE
  select count(*) into n from public.claim_discovery_source_jobs_v2(5, 180, 4, 'EDGE', null);
  if n <> 0 then raise exception 'caps: claimed % while providers were at cap', n; end if;

  -- 3. ended campaign's job was cancelled, retired provider never claimed
  if (select status from public.discovery_query_queue where matching_job_id = ended) <> 'CANCELLED' then raise exception 'ended job not cancelled'; end if;
  if (select status from public.discovery_query_queue where provider = 'DATAFORSEO') <> 'PENDING' then raise exception 'retired provider was touched'; end if;

  -- 4. executor split: the WORKER sees only its PORTAL job
  select array_agg(provider) into picked from public.claim_discovery_source_jobs_v2(5, 180, 4, 'WORKER', null);
  if picked is distinct from array['PORTAL'] then raise exception 'worker claim: %', picked; end if;

  -- 5. ownership: another user cannot pause
  r := public.discovery_control('MATCHING_JOB', big, u2, 'pause');
  if (r->>'error') <> 'FORBIDDEN' then raise exception 'ownership: %', r; end if;

  -- 6. pause holds open jobs (not cancelled) and nothing of it is claimable
  r := public.discovery_control('MATCHING_JOB', big, u1, 'pause');
  if not (r->>'ok')::boolean then raise exception 'pause: %', r; end if;
  if (select status::text from public.matching_jobs where id = big) <> 'paused' then raise exception 'job not paused'; end if;
  select count(*) into n from public.discovery_query_queue where matching_job_id = big and status = 'PAUSED';
  if n <> 5 then raise exception 'held jobs: %', n; end if;
  update public.discovery_query_queue set status = 'DONE', claim_token = null where status = 'PROCESSING';
  select count(*) into n from public.claim_discovery_source_jobs_v2(5, 180, 4, 'EDGE', array['FORUM']);
  if n <> 0 then raise exception 'claimed from a paused campaign'; end if;
  if (select count(*) from public.discovery_query_queue where matching_job_id = big and status = 'CANCELLED') <> 0 then
    raise exception 'pause cancelled work'; end if;

  -- 7. resume returns them to PENDING with the remaining window, and they run again
  r := public.discovery_control('MATCHING_JOB', big, u1, 'resume');
  if not (r->>'ok')::boolean or (r->>'resumedJobs')::int <> 5 then raise exception 'resume: %', r; end if;
  select count(*) into n from public.claim_discovery_source_jobs_v2(1, 180, 4, 'EDGE', array['FORUM']);
  if n <> 1 then raise exception 'resume did not make work claimable'; end if;

  -- 8. stop closes the window now and cancels what is still open; resume after stop is refused
  r := public.discovery_control('MATCHING_JOB', big, u1, 'stop');
  if not (r->>'ok')::boolean then raise exception 'stop: %', r; end if;
  if (select discovery_deadline_at from public.matching_jobs where id = big) > now() then raise exception 'deadline not closed'; end if;
  if exists (select 1 from public.discovery_query_queue where matching_job_id = big and status in ('PENDING','RETRY_WAIT','PAUSED')) then
    raise exception 'stop left open jobs'; end if;
  r := public.discovery_control('MATCHING_JOB', big, u1, 'resume');
  if (r->>'error') <> 'NOT_PAUSED' then raise exception 'resume after stop: %', r; end if;

  -- 9. expired lease goes back to RETRY_WAIT, not left PROCESSING
  update public.discovery_query_queue set status='PROCESSING', lease_expires_at = now() - interval '1 minute', attempts = 1
   where provider = 'TELEGRAM';
  perform public.claim_discovery_source_jobs_v2(1, 180, 4, 'EDGE', array['FORUM']);
  if (select status from public.discovery_query_queue where provider = 'TELEGRAM') <> 'RETRY_WAIT' then raise exception 'lease not recovered'; end if;

  -- 10. a FIND PROPERTY run: no property, owned by the run, pause/resume work too
  declare run uuid := gen_random_uuid(); begin
    insert into public.discovery_runs(id,user_id,idempotency_key,status,deadline_at) values (run,u2,'k','SEARCHING', now() + interval '10 minutes');
    insert into public.discovery_query_queue(platform,language,query,provider,discovery_run_id,dedupe_key) values ('WEBSITE','multi','p','PORTAL',run,'run:PORTAL:home-ss-ge');
    begin
      insert into public.discovery_query_queue(platform,language,query,provider,discovery_run_id,dedupe_key) values ('WEBSITE','multi','p','PORTAL',run,'run:PORTAL:home-ss-ge');
      raise exception 'duplicate dedupe_key accepted';
    exception when unique_violation then null; end;
    r := public.discovery_control('DISCOVERY_RUN', run, u2, 'pause');
    if (select status from public.discovery_runs where id = run) <> 'PAUSED' then raise exception 'run pause: %', r; end if;
    r := public.discovery_control('DISCOVERY_RUN', run, u2, 'resume');
    if (select status from public.discovery_runs where id = run) <> 'SEARCHING' then raise exception 'run resume: %', r; end if;
    update public.discovery_runs set status = 'COMPLETED' where id = run;
    perform public.claim_discovery_source_jobs_v2(1, 180, 4, 'EDGE', null);
    if (select status from public.discovery_query_queue where discovery_run_id = run) <> 'CANCELLED' then raise exception 'ended run job not cancelled'; end if;
  end;
  raise notice 'PHASE2 QUEUE CHECKS: PASS';
end $$;

-- FIND PROPERTY: a customer plan x an external listing is a storable, deduped shape.
do $$
declare ip uuid := gen_random_uuid(); ob uuid := gen_random_uuid();
begin
  insert into public.intent_profiles values (ip);
  insert into public.supply_observations values (ob);
  insert into public.supply_matches(intent_profile_id,observation_id,source_kind,compatibility,match_score)
  values (ip,ob,'EXTERNAL_LISTING','COMPATIBLE',0.8);
  begin
    insert into public.supply_matches(intent_profile_id,observation_id,source_kind,compatibility,match_score)
    values (ip,ob,'EXTERNAL_LISTING','COMPATIBLE',0.8);
    raise exception 'duplicate plan x listing accepted';
  exception when unique_violation then null; end;
  begin
    insert into public.supply_matches(observation_id,source_kind) values (ob,'EXTERNAL_LISTING');
    raise exception 'an external listing match without a plan was accepted';
  exception when check_violation then null; end;
  if (select count(*) from public.product_plan_entitlements where product_code='FIND_PROPERTY' and included_per_period <> 0) > 0 then
    raise exception 'FIND_PROPERTY includes a free run'; end if;
  if (select (standard_retail_cents, min_viable_budget_credits, reference_landed_cogs_cents) from public.billable_products where code='FIND_PROPERTY')
     is distinct from (select (standard_retail_cents, min_viable_budget_credits, reference_landed_cogs_cents) from public.billable_products where code='FIND_CLIENTS') then
    raise exception 'FIND_PROPERTY is not priced like FIND_CLIENTS'; end if;
  raise notice 'FIND PROPERTY SHAPE + PRODUCT CHECKS: PASS';
end $$;
