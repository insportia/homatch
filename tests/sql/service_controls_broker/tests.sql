-- Brokers directory sales paused (owner decision, Option A): nothing is charged for a refused
-- purchase or renewal; nothing paid is touched; only listings already paid and current stay public.
\set ON_ERROR_STOP on
create or replace function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if; raise notice 'PASS  %', msg; end $$;
create or replace function pg_temp.as_user(sub text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(sub, ''), false); end $$;
create or replace function pg_temp.raises(stmt text, code text) returns boolean language plpgsql as $$
begin execute stmt; return false; exception when others then return sqlerrm = code; end $$;
-- Nino's money and listing, as one comparable fingerprint.
create or replace function pg_temp.nino() returns text language sql as $$
  select concat_ws('|',
    (select balance::text from public.credit_accounts where user_id = 'bbbbbbbb-0000-0000-0000-00000000000b'),
    (select count(*)::text from public.credit_ledger),
    (select string_agg(id::text || credits || period_start || period_end, ',' order by created_at) from public.broker_listing_purchases),
    (select status || paid_until from public.broker_directory_listings where display_name = 'Nino Broker'),
    (select count(*)::text from public.admin_audit_log where action = 'BROKER_LISTING_PURCHASED')) $$;
-- What an anonymous visitor sees in the public directory.
create or replace function pg_temp.public_names() returns text language plpgsql as $$
declare v text;
begin
  set local role anon;
  select string_agg(display_name, ',' order by display_name) into v from public.broker_directory_public;
  reset role;
  return coalesce(v, '');
end $$;
create table public._snap (v text);

-- 1. While ON, a renewal is charged once and extends the paid period from its current end.
select pg_temp.ok(pg_temp.public_names() = 'Giorgi Realty,Nino Broker', 'before any pause, the directory shows exactly the two paid, current listings');
select pg_temp.as_user('b0000000-0000-0000-0000-00000000000b');
set role authenticated;
select pg_temp.ok((select (public.broker_directory_purchase('renew-key-0001') ->> 'charged_credits')::numeric = 100), 'while ON, a renewal charges the listed price once');
reset role;
select pg_temp.ok((select balance = 400 from public.credit_accounts where user_id = 'bbbbbbbb-0000-0000-0000-00000000000b'), 'balance 500 → 400');
select pg_temp.ok((select count(*) = 1 from public.credit_ledger) and (select count(*) = 1 from public.broker_listing_purchases), 'one ledger entry, one purchase record');
select pg_temp.ok((select paid_until > now() + interval '34 days' from public.broker_directory_listings where display_name = 'Nino Broker'), 'the period is added after the remaining 5 days, not from today');
select pg_temp.as_user('c0000000-0000-0000-0000-00000000000c');
set role authenticated;
select pg_temp.ok(pg_temp.raises($$insert into public.broker_listing_purchases (listing_id, user_id, idempotency_key, credits, period_start, period_end)
  select id, 'cccccccc-0000-0000-0000-00000000000c', 'direct-key-000', 0, now(), now() + interval '30 days' from public.broker_directory_listings limit 1$$,
  'new row violates row-level security policy for table "broker_listing_purchases"'), 'even while ON, a free purchase row cannot be written directly (row-level security)');
reset role;

-- 2. The owner pauses Brokers directory sales (same audited write the Admin page uses).
create table public._paid_before as select display_name, status, paid_until from public.broker_directory_listings;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
set role authenticated;
select pg_temp.ok((select public.service_control_set('brokers_directory', false, false, 1, 'pause drill', 'b1') ->> 'result') = 'CHANGED', 'admin pauses Brokers directory sales');
reset role;
select pg_temp.ok((select count(*) = 3 from public._paid_before b join public.broker_directory_listings l using (display_name)
  where l.status = b.status and l.paid_until = b.paid_until), 'pausing changes no listing: same status, same paid date, nothing extended or reset');
insert into public._snap select pg_temp.nino();

-- 3. Option A: listings already paid stay public while paused; nothing else becomes public.
select pg_temp.ok(pg_temp.public_names() = 'Giorgi Realty,Nino Broker', 'paused: the public directory still shows exactly the paid, current listings');
select pg_temp.ok(position('Tamar Homes' in pg_temp.public_names()) = 0, 'paused: an expired listing is not public');

-- 4. A manual renewal of an ACTIVE listing is refused and charges nothing.
select pg_temp.as_user('b0000000-0000-0000-0000-00000000000b');
set role authenticated;
select pg_temp.ok(pg_temp.raises($$select public.broker_directory_purchase('renew-key-0002')$$, 'SERVICE_DISABLED'), 'paused: a renewal is refused with SERVICE_DISABLED');
reset role;
select pg_temp.ok(pg_temp.nino() = (select v from public._snap), 'paused renewal: balance, ledger, purchase records, listing and audit all exactly as before');

-- 5. Replaying a purchase already made answers from the record and charges nothing.
set role authenticated;
select pg_temp.ok((select (public.broker_directory_purchase('renew-key-0001') ->> 'duplicate')::boolean), 'paused: a replay of a purchase already made returns that purchase');
reset role;
select pg_temp.ok(pg_temp.nino() = (select v from public._snap), 'replay: nothing charged, nothing written');

-- 6. A listing whose paid period ends during the pause leaves the directory at its paid date.
update public.broker_directory_listings set paid_until = now() - interval '1 second' where display_name = 'Giorgi Realty';
select pg_temp.ok(pg_temp.public_names() = 'Nino Broker', 'paused: a listing past its paid date disappears from the directory at once');
select pg_temp.ok((select (public.broker_directory_expiry_sweep() ->> 'expired')::int = 1), 'the expiry sweep keeps running while paused');
select pg_temp.ok((select status = 'EXPIRED' from public.broker_directory_listings where display_name = 'Giorgi Realty'), 'its status becomes EXPIRED');
select pg_temp.ok((select count(*) = 1 from public.notifications_sent where user_id = 'cccccccc-0000-0000-0000-00000000000c'), 'its owner is told once');
select pg_temp.ok((select count(*) = 1 from public.broker_listing_purchases) and (select balance = 500 from public.credit_accounts where user_id = 'cccccccc-0000-0000-0000-00000000000c'),
  'expiry writes no purchase and charges nothing (no automatic renewal)');
select pg_temp.ok(pg_temp.nino() = (select v from public._snap), 'the sweep leaves a current paid listing untouched');

-- 7. Buying back an EXPIRED listing is refused too, with no charge.
select pg_temp.as_user('c0000000-0000-0000-0000-00000000000c');
set role authenticated;
select pg_temp.ok(pg_temp.raises($$select public.broker_directory_purchase('buyback-key-01')$$, 'SERVICE_DISABLED'), 'paused: an expired listing cannot be bought back');
reset role;
select pg_temp.ok((select balance = 500 from public.credit_accounts where user_id = 'cccccccc-0000-0000-0000-00000000000c')
  and (select count(*) = 1 from public.broker_listing_purchases), 'refused buy-back: nothing charged, nothing written');
select pg_temp.ok((select status = 'EXPIRED' from public.broker_directory_listings where display_name = 'Giorgi Realty')
  and pg_temp.public_names() = 'Nino Broker', 'it stays EXPIRED and not public');

-- 8. No bypass: with Supabase's table grants, row-level security still stops a broker writing a
-- purchase, a listing status or a paid date directly (the tables have read policies only).
select pg_temp.as_user('c0000000-0000-0000-0000-00000000000c');
set role authenticated;
select pg_temp.ok(pg_temp.raises($$insert into public.broker_listing_purchases (listing_id, user_id, idempotency_key, credits, period_start, period_end)
  select id, 'cccccccc-0000-0000-0000-00000000000c', 'direct-key-001', 0, now(), now() + interval '30 days' from public.broker_directory_listings limit 1$$,
  'SERVICE_DISABLED'), 'paused: a direct purchase row is refused (the guard runs before row-level security)');
update public.broker_directory_listings set status = 'ACTIVE', paid_until = now() + interval '30 days' where display_name = 'Giorgi Realty';
reset role;
select pg_temp.ok((select status = 'EXPIRED' and paid_until < now() from public.broker_directory_listings where display_name = 'Giorgi Realty'),
  'a direct status or paid-date change writes nothing (no update policy)');
-- Even a writer past row-level security (a definer function, the service role) meets the guard while paused.
select pg_temp.ok(pg_temp.raises($$insert into public.broker_listing_purchases (listing_id, user_id, idempotency_key, credits, period_start, period_end)
  select id, 'cccccccc-0000-0000-0000-00000000000c', 'direct-key-002', 0, now(), now() + interval '30 days' from public.broker_directory_listings limit 1$$,
  'SERVICE_DISABLED'), 'any purchase row, from any route, is refused while paused');
select pg_temp.ok((select count(*) = 1 from public.broker_listing_purchases), 'still exactly the one purchase made before the pause');

-- 9. Resumed: nothing is extended by the pause; the same request now goes through and is charged once.
select pg_temp.ok((select paid_until = (select paid_until from public._paid_before where display_name = 'Nino Broker')
  from public.broker_directory_listings where display_name = 'Nino Broker'), 'the paused time is not added back to the paid period');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
set role authenticated;
select pg_temp.ok((select public.service_control_set('brokers_directory', true, true, 2, 'resume', 'b2') ->> 'result') = 'CHANGED', 'admin resumes sales');
select pg_temp.as_user('c0000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select (public.broker_directory_purchase('buyback-key-01') ->> 'charged_credits')::numeric = 100), 'resumed: the refused key can be used again (the refusal left no record)');
reset role;
select pg_temp.ok((select balance = 400 from public.credit_accounts where user_id = 'cccccccc-0000-0000-0000-00000000000c')
  and (select count(*) = 2 from public.broker_listing_purchases), 'charged exactly once: 500 → 400, two purchase records');
select pg_temp.ok(pg_temp.public_names() = 'Giorgi Realty,Nino Broker', 'the bought-back listing is public again');
