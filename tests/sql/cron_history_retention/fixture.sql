-- Stand-in for the pg_cron objects the migration touches (pg_cron itself is not installed locally).
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create schema cron;
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create table cron.job_run_details (runid bigserial primary key, jobid bigint, status text, start_time timestamptz, end_time timestamptz, return_message text);
create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as
  $$ insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command) returning jobid $$;
create function cron.unschedule(p_name text) returns boolean language sql as
  $$ delete from cron.job where jobname = p_name returning true $$;
insert into cron.job (jobname, schedule, command) values ('homatch-verify-driver', '30 seconds', 'select 1'), ('homatch-native-intent', '* * * * *', 'select 1');
-- 30 days of history, oldest first (runid rises with time), 1,000 rows/day (one every 86.4 s)
insert into cron.job_run_details (jobid, status, start_time, end_time)
select 1 + (g % 2), 'succeeded', now() - interval '30 days' + g * interval '86.4 seconds', now() - interval '30 days' + g * interval '86.4 seconds' + interval '20 ms'
from generate_series(0, 29999) g;
-- a run that never finished, 20 days ago
update cron.job_run_details set status = 'running' where runid = 5000;
