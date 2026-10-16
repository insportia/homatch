-- Brokers directory paused: nothing is charged for a refused purchase or renewal; nothing paid is touched.
\set ON_ERROR_STOP on
create or replace function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if; raise notice 'PASS  %', msg; end $$;
create or replace function pg_temp.as_user(sub text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(sub, ''), false); end $$;
create or replace function pg_temp.raises(stmt text, code text) returns boolean language plpgsql as $$
begin execute stmt; return false; exception when others then return sqlerrm = code; end $$;
create table public._snap (k text primary key, v text);
create or replace function pg_temp.snap() returns void language sql as $$
  delete from public._snap;
  insert into public._snap values
    ('balance', (select balance::text from public.credit_accounts)),
    ('ledger', (select count(*)::text from public.credit_ledger)),
    ('purchases', (select string_agg(id::text || credits || period_start || period_end, ',' order by created_at) from public.broker_listing_purchases)),
    ('listing', (select status || paid_until from public.broker_directory_listings)),
    ('bought_audit', (select count(*)::text from public.admin_audit_log where action = 'BROKER_LISTING_PURCHASED')) $$;
create or replace function pg_temp.unchanged() returns boolean language sql as $$
  select not exists (select 1 from public._snap s where s.v is distinct from case s.k
    when 'balance' then (select balance::text from public.credit_accounts)
    when 'ledger' then (select count(*)::text from public.credit_ledger)
    when 'purchases' then (select string_agg(id::text || credits || period_start || period_end, ',' order by created_at) from public.broker_listing_purchases)
    when 'listing' then (select status || paid_until from public.broker_directory_listings)
    when 'bought_audit' then (select count(*)::text from public.admin_audit_log where action = 'BROKER_LISTING_PURCHASED') end) $$;

-- 1. While ON, a renewal is charged once and extends the paid period from its current end.
select pg_temp.as_user('b0000000-0000-0000-0000-00000000000b');
set role authenticated;
select pg_temp.ok((select (public.broker_directory_purchase('renew-key-0001') ->> 'charged_credits')::numeric = 100), 'while ON, a renewal charges the listed price once');
reset role;
select pg_temp.ok((select balance = 400 from public.credit_accounts), 'balance 500 → 400');
select pg_temp.ok((select count(*) = 1 from public.credit_ledger) and (select count(*) = 1 from public.broker_listing_purchases), 'one ledger entry, one purchase record');
select pg_temp.ok((select paid_until > now() + interval '34 days' from public.broker_directory_listings), 'the period is added after the remaining 5 days, not from today');

-- 2. The owner pauses the directory (same audited write the Admin page uses).
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
set role authenticated;
select pg_temp.ok((select public.service_control_set('brokers_directory', false, false, 1, 'pause drill', 'b1') ->> 'result') = 'CHANGED', 'admin pauses the Brokers directory');
reset role;
select pg_temp.snap();

-- 3. A manual renewal of an ACTIVE listing is refused and charges nothing.
select pg_temp.as_user('b0000000-0000-0000-0000-00000000000b');
set role authenticated;
select pg_temp.ok(pg_temp.raises($$select public.broker_directory_purchase('renew-key-0002')$$, 'SERVICE_DISABLED'), 'paused: a renewal is refused with SERVICE_DISABLED');
reset role;
select pg_temp.ok(pg_temp.unchanged(), 'paused renewal: balance, ledger, purchase records, listing and audit all exactly as before');

-- 4. Replaying a purchase already made answers from the record and charges nothing.
set role authenticated;
select pg_temp.ok((select (public.broker_directory_purchase('renew-key-0001') ->> 'duplicate')::boolean), 'paused: a replay of a purchase already made returns that purchase');
reset role;
select pg_temp.ok(pg_temp.unchanged(), 'replay: nothing charged, nothing written');

-- 5. An EXPIRED listing (the sweep keeps running while paused) cannot be bought back either, and is not charged.
update public.broker_directory_listings set status = 'EXPIRED', paid_until = now() - interval '1 day';
select pg_temp.snap();
set role authenticated;
select pg_temp.ok(pg_temp.raises($$select public.broker_directory_purchase('renew-key-0003')$$, 'SERVICE_DISABLED'), 'paused: an expired listing is refused too');
reset role;
select pg_temp.ok(pg_temp.unchanged(), 'expired + paused: nothing charged, the listing stays EXPIRED');
select pg_temp.ok((select count(*) = 1 from public.broker_listing_purchases) and (select count(*) = 1 from public.credit_ledger where type = 'BROKER_DIRECTORY_LISTING'), 'the earlier paid purchase and its ledger entry are preserved');

-- 6. Resumed: the same request now goes through and is charged once.
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
set role authenticated;
select pg_temp.ok((select public.service_control_set('brokers_directory', true, true, 2, 'resume', 'b2') ->> 'result') = 'CHANGED', 'admin resumes the directory');
select pg_temp.as_user('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select (public.broker_directory_purchase('renew-key-0003') ->> 'charged_credits')::numeric = 100), 'resumed: the refused key can be used again (the refusal left no record)');
reset role;
select pg_temp.ok((select balance = 300 from public.credit_accounts) and (select count(*) = 2 from public.broker_listing_purchases), 'charged exactly once: 400 → 300, two purchase records');
select pg_temp.ok((select status = 'ACTIVE' from public.broker_directory_listings), 'the listing is ACTIVE again');
