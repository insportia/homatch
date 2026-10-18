\set ON_ERROR_STOP 1
create or replace function pg_temp.expect(p_name text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin if not p_ok then raise exception 'FAIL  % %', p_name, p_detail; end if; raise notice 'PASS  %', p_name; end $$;

select pg_temp.expect('scheduled exactly once, hourly', (select count(*) = 1 and min(schedule) = '41 * * * *' from cron.job where jobname = 'homatch-cron-history-retention'));
select pg_temp.expect('no other job touched', (select count(*) = 3 from cron.job));

-- snapshot of the recent runs (a minute of margin from the 7-day boundary)
create temp table recent as select runid from cron.job_run_details where start_time >= now() - interval '7 days' + interval '1 minute';
select pg_temp.expect('fixture has recent runs to protect', (select count(*) > 5000 from recent));

-- one call deletes at most a batch, oldest first
select public.purge_cron_history(interval '7 days', 5000) as n \gset
select pg_temp.expect('first call: one batch of 5000 oldest, minus the unfinished run in it', :n = 4999, :'n');
select pg_temp.expect('it took the oldest rows (the unfinished one stays)', (select min(runid) = 5000 and count(*) filter (where runid < 5000) = 0 from cron.job_run_details));

-- keep calling until the backlog is gone
do $$ declare k int; begin loop select public.purge_cron_history(interval '7 days', 5000) into k; exit when k = 0; end loop; end $$;
select pg_temp.expect('nothing older than 7 days remains except the unfinished run',
  (select count(*) = 1 from cron.job_run_details where start_time < now() - interval '7 days'));
select pg_temp.expect('the unfinished run is never deleted', exists (select 1 from cron.job_run_details where runid = 5000 and status = 'running'));
select pg_temp.expect('every run of the last 7 days is kept', not exists (select 1 from recent r where not exists (select 1 from cron.job_run_details d where d.runid = r.runid)));

-- p_keep is floored at 1 day: a mistaken tiny window cannot wipe today's history
select public.purge_cron_history(interval '1 minute', 50000) as n2 \gset
select pg_temp.expect('keep window is floored at 1 day', (select count(*) > 0 from cron.job_run_details where start_time > now() - interval '1 day'));

select pg_temp.expect('service role only', not has_function_privilege('anon', 'public.purge_cron_history(interval, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.purge_cron_history(interval, integer)', 'execute')
  and has_function_privilege('service_role', 'public.purge_cron_history(interval, integer)', 'execute'));
select pg_temp.expect('fixture really spans 30 days', (select max(start_time) > now() - interval '1 hour' from cron.job_run_details));
