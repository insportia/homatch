-- Expected claim orders for one definition of claim_marketplace_worker_runs.
-- psql variable :variant is 'old' (20261010100000) or 'new' (20261115110000).
\set ON_ERROR_STOP 1

create or replace function pg_temp.reset(p_concurrency int default 1) returns void language sql as $$
  truncate public.discovery_marketplace_worker_runs, public.discovery_marketplace_searches;
  update public.discovery_marketplace_workers set max_concurrency = p_concurrency;
$$;
-- queue one run for user N, p_age_s seconds old; the run is labelled for the assertions
create or replace function pg_temp.q(p_user int, p_label text, p_age_s int, p_search_status text default 'SEARCHING') returns void language sql as $$
  with s as (insert into public.discovery_marketplace_searches (user_id, status, created_at)
             values (('00000000-0000-0000-0000-' || lpad(p_user::text, 12, '0'))::uuid, p_search_status, now() - make_interval(secs => p_age_s)) returning id)
  insert into public.discovery_marketplace_worker_runs (search_id, worker_id, created_at, label)
  select id, 'homege-agent', now() - make_interval(secs => p_age_s), p_label from s;
$$;
-- claim one at a time; p_finish: the portal completes each run before the next claim
create or replace function pg_temp.claim_order(p_finish boolean default true, p_max int default 50) returns text language plpgsql as $$
declare v text := ''; r record; n int := 0; begin
  loop
    n := n + 1; exit when n > p_max;
    select label into r from public.claim_marketplace_worker_runs('homege-agent', 1, 120) limit 1;
    exit when not found;
    v := v || r.label || ' ';
    if p_finish then update public.discovery_marketplace_worker_runs set status = 'COMPLETE' where label = r.label; end if;
  end loop;
  return trim(v);
end $$;
create or replace function pg_temp.expect(p_name text, p_got text, p_want text) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then raise exception 'FAIL  %: got [%] want [%]', p_name, p_got, p_want; end if;
  raise notice 'PASS  %', p_name;
end $$;

-- 1. One requester: FIFO under both definitions.
select pg_temp.reset();
select pg_temp.q(1, 'a1', 50), pg_temp.q(1, 'a2', 40), pg_temp.q(1, 'a3', 30);
select pg_temp.expect(:'variant' || ': one requester is FIFO', pg_temp.claim_order(), 'a1 a2 a3');

-- 2. A burst from one requester, then two others.
select pg_temp.reset();
select pg_temp.q(1, 'u1a', 100), pg_temp.q(1, 'u1b', 99), pg_temp.q(1, 'u1c', 98), pg_temp.q(1, 'u1d', 97), pg_temp.q(2, 'u2a', 50), pg_temp.q(3, 'u3a', 10);
select pg_temp.expect(:'variant' || ': burst', pg_temp.claim_order(),
  case :'variant' when 'old' then 'u1a u1b u1c u1d u2a u3a' else 'u1a u2a u3a u1b u1c u1d' end);

-- 3. Two slots: a requester already holding one waits behind one holding none.
select pg_temp.reset(2);
select pg_temp.q(1, 'u1a', 100), pg_temp.q(1, 'u1b', 90), pg_temp.q(2, 'u2a', 10);
select pg_temp.expect(:'variant' || ': first slot', pg_temp.claim_order(false, 1), 'u1a');
select pg_temp.expect(:'variant' || ': second slot', pg_temp.claim_order(false, 1),
  case :'variant' when 'old' then 'u1b' else 'u2a' end);
select pg_temp.expect(:'variant' || ': per-worker max_concurrency still holds', pg_temp.claim_order(false, 1), '');

-- 4. Runs that can no longer be claimed (cancelled search) do not cost their requester a turn.
select pg_temp.reset();
select pg_temp.q(1, 'u1x', 200, 'CANCELLED'), pg_temp.q(1, 'u1y', 100), pg_temp.q(2, 'u2y', 50);
select pg_temp.expect(:'variant' || ': dead rows skipped and do not count', pg_temp.claim_order(), 'u1y u2y');

-- 5. Nothing is refused: every claimable queued run is handed out exactly once.
select pg_temp.reset();
select pg_temp.q((g % 7) + 1, 'r' || g, 1000 - g) from generate_series(1, 60) g;
select pg_temp.expect(:'variant' || ': all 60 claimed once', (select count(distinct x)::text || '/' || count(*)::text from unnest(string_to_array(pg_temp.claim_order(true, 100), ' ')) x), '60/60');

-- 6. The global cap (admin_settings.marketplace_max_concurrent_runs) still holds.
select pg_temp.reset(5);
insert into public.admin_settings values ('marketplace_max_concurrent_runs', '2') on conflict (key) do update set value = excluded.value;
select pg_temp.q(1, 'g1', 30), pg_temp.q(2, 'g2', 20), pg_temp.q(3, 'g3', 10);
select pg_temp.expect(:'variant' || ': global cap 2', pg_temp.claim_order(false, 5), case :'variant' when 'old' then 'g1 g2' else 'g1 g2' end);
delete from public.admin_settings where key = 'marketplace_max_concurrent_runs';
