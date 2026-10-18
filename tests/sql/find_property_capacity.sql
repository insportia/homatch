-- FIND PROPERTY CAPACITY (20261116090000): sharing, reuse, the live-search quota, busy admission,
-- fair claim and hand-over. Each block raises on failure and prints PASS.
\set ON_ERROR_STOP 1

insert into public.discovery_marketplace_workers (worker_id, source_key, source_name, execution_mode, state, enabled,
  supported_markets, supported_property_types, supported_transaction_types, token_hash, max_concurrency, max_attempts)
values ('cap-worker', 'cap-source', 'Cap', 'BROWSER', 'ACTIVE', true, '{GE}', '{APARTMENT}', '{BUY}', repeat('c', 64), 1, 3)
on conflict (worker_id) do nothing;
insert into public.users (id) values ('00000000-0000-4000-9000-ffffffffffff') on conflict do nothing;
insert into public.discovery_search_plans (direction, user_id, market, plan) values ('SUPPLY', '00000000-0000-4000-9000-ffffffffffff', 'GE', '{}');

create or replace function pg_temp.reset() returns void language sql as $$
  delete from public.rate_limit_events;
  delete from public.discovery_marketplace_worker_runs;
  delete from public.discovery_marketplace_searches;
  update public.discovery_marketplace_workers set max_concurrency = 1 where worker_id = 'cap-worker';
$$;
-- a customer: p_age days old, optionally with a confirmed email
create or replace function pg_temp.customer(p_n int, p_age interval, p_confirmed boolean default false) returns uuid language plpgsql as $$
declare v uuid := ('00000000-0000-4000-9000-' || lpad(p_n::text, 12, '0'))::uuid; a uuid := ('00000000-0000-4000-a000-' || lpad(p_n::text, 12, '0'))::uuid;
begin
  insert into public.users (id, auth_id, created_at) values (v, a, now() - p_age)
  on conflict (id) do update set created_at = excluded.created_at, auth_id = excluded.auth_id;
  insert into auth.users (id, email_confirmed_at) values (a, case when p_confirmed then now() end)
  on conflict (id) do update set email_confirmed_at = excluded.email_confirmed_at;
  return v;
end $$;
-- start one search for a customer on cap-worker with a request key; returns the decision
create or replace function pg_temp.start(p_user uuid, p_key text, p_ip text default null, p_deadline interval default interval '10 minutes')
returns jsonb language plpgsql as $$
declare s uuid;
begin
  insert into public.discovery_marketplace_searches (user_id, search_plan_id, idempotency_key, status, brief, request, deadline_at)
  values (p_user, (select id from public.discovery_search_plans limit 1), 'k-' || replace(gen_random_uuid()::text, '-', ''), 'DISPATCHING', '{}', '{}', now() + interval '20 minutes')
  returning id into s;
  return public.marketplace_dispatch_search(s, p_user, p_ip,
    jsonb_build_array(jsonb_build_object('worker_id', 'cap-worker', 'request', jsonb_build_object('k', p_key),
                                         'request_key', p_key, 'deadline_at', now() + p_deadline)));
end $$;
create or replace function pg_temp.mode(d jsonb) returns text language sql as $$ select d->'runs'->0->>'mode' $$;
create or replace function pg_temp.expect(p_name text, p_got text, p_want text) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then raise exception 'FAIL  %: got [%] want [%]', p_name, p_got, p_want; end if;
  raise notice 'PASS  %', p_name;
end $$;
create or replace function pg_temp.events(p_user uuid) returns text language sql as $$
  select count(*)::text from public.rate_limit_events where user_id = p_user and operation = 'marketplace_search_live' $$;
create or replace function pg_temp.complete_live(p_user uuid) returns void language sql as $$
  update public.discovery_marketplace_worker_runs r set status = 'COMPLETE', returned_count = 4, started_at = now() - interval '60 seconds', completed_at = now()
    from public.discovery_marketplace_searches s where s.id = r.search_id and s.user_id = p_user and r.status = 'QUEUED' and r.shared_run_id is null $$;

-- 1. LIVE, then SHARED for an identical request from someone else; only the live one counts.
select pg_temp.reset();
select pg_temp.expect('first request goes live', pg_temp.mode(pg_temp.start(pg_temp.customer(1, '30 days'), 'A')), 'LIVE');
select pg_temp.expect('identical request from another customer is shared', pg_temp.mode(pg_temp.start(pg_temp.customer(2, '30 days'), 'A')), 'SHARED');
select pg_temp.expect('live search counted once', pg_temp.events(pg_temp.customer(1, '30 days')), '1');
select pg_temp.expect('shared search not counted', pg_temp.events(pg_temp.customer(2, '30 days')), '0');
select pg_temp.expect('one portal run for the request', (select count(*)::text from public.discovery_marketplace_worker_runs where request_key = 'A' and shared_run_id is null), '1');
select pg_temp.expect('claim hands out the leader only',
  (select count(*)::text || ':' || bool_and(shared_run_id is null)::text from public.claim_marketplace_worker_runs('cap-worker', 5, 120)), '1:true');
select pg_temp.expect('nothing else claimable', (select count(*)::text from public.claim_marketplace_worker_runs('cap-worker', 5, 120)), '0');

-- 2. REUSED: an identical request finished < 30 min ago is answered from it.
update public.discovery_marketplace_worker_runs set status = 'COMPLETE', returned_count = 7, completed_at = now() where request_key = 'A' and shared_run_id is null;
select pg_temp.expect('recent identical results are reused', pg_temp.mode(pg_temp.start(pg_temp.customer(3, '30 days'), 'A')), 'REUSED');
update public.discovery_marketplace_worker_runs set completed_at = now() - interval '31 minutes' where request_key = 'A' and status = 'COMPLETE';
select pg_temp.expect('older than 30 minutes is refreshed live', pg_temp.mode(pg_temp.start(pg_temp.customer(3, '30 days'), 'A')), 'LIVE');

-- 3. NORMAL quota: 3 at once, then the pool answers (nothing refused, nothing counted).
select pg_temp.reset();
select pg_temp.start(pg_temp.customer(10, '30 days'), 'n' || g) from generate_series(1, 3) g;
select pg_temp.expect('4th simultaneous live search is answered from the pool', pg_temp.mode(pg_temp.start(pg_temp.customer(10, '30 days'), 'n4')), 'LIVE_REFRESH_LIMIT');
select pg_temp.expect('the reason and tier are reported',
  (select d->'limit'->>'reason' || ':' || (d->>'tier') || ':' || (d->'limit'->>'maxActive') from (select pg_temp.start(pg_temp.customer(10, '30 days'), 'n5') d) x), 'CONCURRENT:NORMAL:3');
select pg_temp.expect('pool answers are not counted', pg_temp.events(pg_temp.customer(10, '30 days')), '3');
select pg_temp.expect('a deferred run is closed and never claimed',
  (select string_agg(distinct status, ',') from public.discovery_marketplace_worker_runs where request_key in ('n4', 'n5')), 'TIMED_OUT');
select pg_temp.expect('an identical request is still shared while over the limit', pg_temp.mode(pg_temp.start(pg_temp.customer(10, '30 days'), 'n1')), 'SHARED');

-- 4. Hourly 20 and daily 100, rolling, with the time it frees up.
select pg_temp.reset();
insert into public.rate_limit_events (user_id, operation, created_at)
select pg_temp.customer(11, '30 days'), 'marketplace_search_live', now() - make_interval(mins => 50 - g) from generate_series(1, 20) g;
select pg_temp.expect('21st live search in an hour waits', (select d->'limit'->>'reason' from (select pg_temp.start(pg_temp.customer(11, '30 days'), 'h') d) x), 'HOURLY');
select pg_temp.expect('retry when the oldest of the 20 leaves the hour',
  (select abs(extract(epoch from ((d->'limit'->>'retryAt')::timestamptz - (now() + interval '11 minutes')))) < 5 from (select pg_temp.start(pg_temp.customer(11, '30 days'), 'h2') d) x)::text, 'true');
update public.rate_limit_events set created_at = created_at - interval '2 hours' where user_id = pg_temp.customer(11, '30 days');
select pg_temp.expect('rolling hour frees up', pg_temp.mode(pg_temp.start(pg_temp.customer(11, '30 days'), 'h3')), 'LIVE');
select pg_temp.reset();
insert into public.rate_limit_events (user_id, operation, created_at)
select pg_temp.customer(12, '30 days'), 'marketplace_search_live', now() - make_interval(hours => 2 + g / 10) from generate_series(1, 100) g;
select pg_temp.expect('101st live search in a day waits', (select d->'limit'->>'reason' from (select pg_temp.start(pg_temp.customer(12, '30 days'), 'd') d) x), 'DAILY');

-- 5. SUSPICIOUS tier and its false-positive guards.
select pg_temp.reset();
select pg_temp.expect('a new unconfirmed account is suspicious', (select (d->>'tier') from (select pg_temp.start(pg_temp.customer(20, '2 hours'), 's1') d) x), 'SUSPICIOUS');
select pg_temp.expect('suspicious: 1 at once', (select d->'limit'->>'reason' || ':' || (d->'limit'->>'maxActive') from (select pg_temp.start(pg_temp.customer(20, '2 hours'), 's2') d) x), 'CONCURRENT:1');
select pg_temp.expect('a new account with a confirmed email is normal', (select (d->>'tier') from (select pg_temp.start(pg_temp.customer(21, '2 hours', true), 's3') d) x), 'NORMAL');
select pg_temp.reset();
insert into public.rate_limit_events (user_id, ip_address, operation)
select pg_temp.customer(30 + g % 5, '30 days'), '203.0.113.9', 'marketplace_search_live' from generate_series(1, 60) g;
select pg_temp.expect('busy IP: an established account is untouched', (select d->>'tier' || ':' || (d->>'ipSignal') from (select pg_temp.start(pg_temp.customer(40, '30 days'), 'i1', '203.0.113.9') d) x), 'NORMAL:true');
select pg_temp.expect('busy IP: a confirmed account is untouched', (select d->>'tier' from (select pg_temp.start(pg_temp.customer(41, '3 days', true), 'i2', '203.0.113.9') d) x), 'NORMAL');
select pg_temp.expect('busy IP: a 3-day unconfirmed account gets the suspicious tier', (select d->>'tier' from (select pg_temp.start(pg_temp.customer(42, '3 days'), 'i3', '203.0.113.9') d) x), 'SUSPICIOUS');
select pg_temp.expect('the same account elsewhere is normal', (select d->>'tier' from (select pg_temp.start(pg_temp.customer(42, '3 days'), 'i4', '198.51.100.7') d) x), 'NORMAL');
delete from public.rate_limit_events where ip_address = '203.0.113.9';
insert into public.rate_limit_events (user_id, ip_address, operation)
select pg_temp.customer(30 + g % 5, '30 days'), '203.0.113.9', 'marketplace_search_live' from generate_series(1, 59) g;
select pg_temp.expect('59 from one IP is not a signal', (select d->>'tier' || ':' || (d->>'ipSignal') from (select pg_temp.start(pg_temp.customer(43, '3 days'), 'i5', '203.0.113.9') d) x), 'NORMAL:false');
select pg_temp.expect('the IP is recorded with the live search', (select count(*)::text from public.rate_limit_events where ip_address = '198.51.100.7'), '1');

-- 6. SOURCE_BUSY: a run that cannot finish before its deadline answers from the pool at once.
select pg_temp.reset();
insert into public.discovery_marketplace_searches (id, user_id, search_plan_id, idempotency_key, status, brief, request, deadline_at)
values ('30000000-0000-4000-8000-000000000001', pg_temp.customer(50, '30 days'), (select id from public.discovery_search_plans limit 1), 'hist-0001', 'COMPLETE', '{}', '{}', now());
insert into public.discovery_marketplace_worker_runs (search_id, worker_id, request, deadline_at, status, started_at, completed_at, request_key)
select '30000000-0000-4000-8000-000000000001', 'cap-worker', '{}', now(), 'COMPLETE', now() - interval '146 seconds' - make_interval(mins => g), now() - make_interval(mins => g), null
  from generate_series(1, 1) g;
select pg_temp.expect('mean run time from real runs', (select round(public.marketplace_expected_run_seconds('cap-worker'))::text), '146');
select pg_temp.start(pg_temp.customer(60 + g, '30 days'), 'q' || g, null, interval '15 minutes') from generate_series(1, 3) g;
select pg_temp.expect('3 waiting at 146 s each on 1 slot: a 10-minute run still fits', pg_temp.mode(pg_temp.start(pg_temp.customer(70, '30 days'), 'fit')), 'LIVE');
select pg_temp.start(pg_temp.customer(80 + g, '30 days'), 'b' || g, null, interval '15 minutes') from generate_series(1, 6) g;
select pg_temp.expect('10 waiting: a 10-minute run cannot finish, so the pool answers now', pg_temp.mode(pg_temp.start(pg_temp.customer(90, '30 days'), 'late')), 'SOURCE_BUSY');
select pg_temp.expect('busy runs are not counted', pg_temp.events(pg_temp.customer(90, '30 days')), '0');
select pg_temp.expect('busy answer says when to retry', (select (d->'runs'->0->>'retryAt') is not null from (select pg_temp.start(pg_temp.customer(91, '30 days'), 'late2') d) x)::text, 'true');

-- 7. Fair claim (as #253) and runs that cannot finish are not started.
select pg_temp.reset();
-- one customer's burst of 3 different searches, then two other customers, each arriving later
select pg_temp.start(pg_temp.customer(case when g <= 3 then 101 else 100 + g end, '30 days'), 'f' || g, null, interval '30 minutes') from generate_series(1, 5) g;
update public.discovery_marketplace_worker_runs set created_at = now() - make_interval(secs => 100 - substr(request_key, 2)::int) where request_key like 'f%';
create or replace function pg_temp.claim_order() returns text language plpgsql as $$
declare v text := ''; r record; begin
  loop
    select request_key into r from public.claim_marketplace_worker_runs('cap-worker', 1, 120) limit 1;
    exit when not found;
    v := v || r.request_key || ' ';
    update public.discovery_marketplace_worker_runs set status = 'COMPLETE', completed_at = now(), returned_count = 1 where request_key = r.request_key and shared_run_id is null;
  end loop;
  return trim(v);
end $$;
select pg_temp.expect('a burst does not queue everyone behind it', pg_temp.claim_order(), 'f1 f4 f5 f2 f3');
select pg_temp.reset();
select pg_temp.start(pg_temp.customer(110, '30 days'), 'tight', null, interval '10 minutes');
update public.discovery_marketplace_worker_runs set deadline_at = now() + interval '30 seconds' where request_key = 'tight';
select pg_temp.expect('a run with < half the mean run time left is not started', (select count(*)::text from public.claim_marketplace_worker_runs('cap-worker', 5, 120)), '0');
update public.discovery_marketplace_worker_runs set deadline_at = now() + interval '5 minutes' where request_key = 'tight';
select pg_temp.expect('with time left it is', (select count(*)::text from public.claim_marketplace_worker_runs('cap-worker', 5, 120)), '1');

-- 8. A cancelled leader hands over; a leader whose search ended never blocks.
select pg_temp.reset();
select pg_temp.start(pg_temp.customer(120, '30 days'), 'H'), pg_temp.start(pg_temp.customer(121, '30 days'), 'H'), pg_temp.start(pg_temp.customer(122, '30 days'), 'H');
update public.discovery_marketplace_searches s set status = 'CANCELLED' from public.discovery_marketplace_worker_runs r where r.search_id = s.id and r.request_key = 'H' and r.shared_run_id is null;
update public.discovery_marketplace_worker_runs set status = 'FAILED', completed_at = now() where request_key = 'H' and shared_run_id is null;
select pg_temp.expect('one hand-over', (select public.marketplace_hand_over_shared_runs(s.id)::text from public.discovery_marketplace_searches s where s.status = 'CANCELLED'), '1');
select pg_temp.expect('the oldest follower now leads and the other follows it',
  (select count(*) filter (where shared_run_id is null and status = 'QUEUED')::text || ':' || count(*) filter (where shared_run_id is not null)::text
     from public.discovery_marketplace_worker_runs where request_key = 'H' and status = 'QUEUED'), '1:1');
select pg_temp.expect('the new leader is claimable', (select count(*)::text from public.claim_marketplace_worker_runs('cap-worker', 5, 120)), '1');
select pg_temp.reset();
select pg_temp.start(pg_temp.customer(130, '30 days'), 'E');
update public.discovery_marketplace_searches s set status = 'FAILED' from public.discovery_marketplace_worker_runs r where r.search_id = s.id and r.request_key = 'E';
select pg_temp.expect('a leader of an ended search is closed and a new run goes live', pg_temp.mode(pg_temp.start(pg_temp.customer(131, '30 days'), 'E')), 'LIVE');
select pg_temp.expect('its close is recorded', (select errors->-1->>'code' from public.discovery_marketplace_worker_runs where request_key = 'E' and status = 'TIMED_OUT'), 'SEARCH_ENDED');

-- 9. Only the owner's own search can be dispatched.
select pg_temp.reset();
select pg_temp.start(pg_temp.customer(140, '30 days'), 'own');
do $$ begin
  perform public.marketplace_dispatch_search((select id from public.discovery_marketplace_searches limit 1),
    ('00000000-0000-4000-9000-' || lpad('141', 12, '0'))::uuid, null, '[]');
  raise exception 'FAIL  dispatched into another customer''s search';
exception when raise_exception then
  if sqlerrm <> 'SEARCH_NOT_OWNED' then raise; end if;
  raise notice 'PASS  another customer''s search is refused';
end $$;

-- 10. Every run a dispatch creates owes its instant pool answer.
select pg_temp.reset();
select pg_temp.start(pg_temp.customer(150, '30 days'), 'P');
select pg_temp.expect('new runs are pool_pending', (select bool_and(pool_pending)::text from public.discovery_marketplace_worker_runs where request_key = 'P'), 'true');
