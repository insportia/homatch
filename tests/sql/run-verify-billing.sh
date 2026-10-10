#!/usr/bin/env bash
# Verify durable queue + credit budget, on a scratch local Postgres (never production).
#   PGHOST=/tmp PGPORT=55432 PGUSER=postgres bash tests/sql/run-verify-billing.sh
set -euo pipefail
DB=${DB:-verify_billing_t}
P="psql -v ON_ERROR_STOP=1 -q"
cd "$(dirname "$0")/../.."
$P -d postgres -c "drop database if exists $DB" -c "create database $DB"
$P -d $DB -f tests/sql/verify_durable_execution_fixture.sql
$P -d $DB -f supabase/migrations/20261026090000_verify_durable_execution.sql
$P -d $DB -f tests/sql/verify_credit_budget_fixture.sql
$P -d $DB -f supabase/migrations/20261026100000_verify_credit_budget.sql
$P -d $DB -f supabase/migrations/20261027090000_verify_wallet_owner.sql
$P -d $DB -f tests/sql/verify_durable_execution.sql
$P -d $DB -f tests/sql/verify_credit_budget.sql
$P -d $DB -f tests/sql/verify_billing_audit_regressions.sql
$P -d $DB -f tests/sql/verify_incremental_budget.sql
$P -d $DB -f tests/sql/verify_wallet_owner.sql

# Concurrency: 30 simultaneous starts of one job (double clicks, retries, two tabs)
# hold the budget once; 30 simultaneous closes settle once; another product's
# reservations on the same wallet in parallel never drive it negative.
U=00000000-0000-4000-8000-0000000000c1
W=00000000-0000-4000-8000-0000000000d9  # public.users.id: distinct from the auth id, as in production
$P -d $DB -c "insert into public.users (id, auth_id) values ('$W', '$U');
              insert into public.credit_accounts (user_id, balance) values ('$W', 60);
              insert into public.credit_lots (user_id, kind, credits_granted, source_type) values ('$W','PURCHASED',60,'TOPUP');
              insert into public.research_jobs (id, user_id) values ('00000000-0000-4000-8000-00000000c0b1', '$U');"
for i in $(seq 1 30); do
  $P -d $DB -c "select public.verify_billing_open('00000000-0000-4000-8000-00000000c0b1', '$U', 'verify:c0b1:click$i')" >/dev/null &
done
for i in $(seq 1 6); do
  $P -d $DB -c "select public.wallet_reserve('$W', 'VERIFY', 5, 'other-product-$i')" >/dev/null 2>&1 &
done
wait
$P -d $DB -At -c "update public.research_jobs set result_json = '{\"_cost\":{\"identity\":{\"input_tokens\":200000,\"output_tokens\":20000}}}' where id = '00000000-0000-4000-8000-00000000c0b1'"
for i in $(seq 1 30); do
  $P -d $DB -c "select public.verify_billing_close('00000000-0000-4000-8000-00000000c0b1', 'COMPLETE')" >/dev/null &
done
wait
$P -d $DB -At <<SQL
do \$\$
declare v_sessions int; v_res int; v_caps int; v_bal numeric; v_reserved numeric; v_charged numeric; v_other numeric;
begin
  select count(*) into v_sessions from public.verify_billing_sessions where job_id = '00000000-0000-4000-8000-00000000c0b1';
  select count(*) into v_res from public.usage_reservations where user_id = '$W' and product_code = 'VERIFY' and job_ref = '00000000-0000-4000-8000-00000000c0b1';
  select count(*) into v_caps from public.credit_ledger where user_id = '$W' and type = 'SERVICE_CAPTURE';
  select balance, reserved into v_bal, v_reserved from public.credit_accounts where user_id = '$W';
  select charged_total_credits into v_charged from public.verify_billing where job_id = '00000000-0000-4000-8000-00000000c0b1';
  select coalesce(sum(reserved_credits), 0) into v_other from public.usage_reservations where user_id = '$W' and idempotency_key like 'other-product-%' and status = 'RESERVED';
  if v_sessions <> 1 or v_res <> 1 then raise exception 'concurrency: % sessions, % reservations', v_sessions, v_res; end if;
  if v_caps <> 1 then raise exception 'concurrency: % captures', v_caps; end if;
  if v_bal < 0 or v_reserved < 0 then raise exception 'concurrency: negative wallet'; end if;
  if v_bal + v_reserved <> 60 - v_charged then raise exception 'concurrency: drift bal % reserved % charged %', v_bal, v_reserved, v_charged; end if;
  if v_reserved <> v_other then raise exception 'concurrency: reserved % vs other holds %', v_reserved, v_other; end if;
  raise notice 'verify_credit_budget concurrency: 1 session, 1 capture, wallet consistent (charged %, other holds %)', v_charged, v_other;
end \$\$;
SQL

# Approval races: 20 simultaneous "+25" clicks from the same screen are one
# extension; stop and approve racing each other leave a consistent wallet.
U2=00000000-0000-4000-8000-0000000000c2
J2=00000000-0000-4000-8000-00000000c0b2
$P -d $DB -c "insert into public.users (id, auth_id) values ('$U2', '$U2');
              insert into public.credit_accounts (user_id, balance) values ('$U2', 200);
              insert into public.credit_lots (user_id, kind, credits_granted, source_type) values ('$U2','PURCHASED',200,'TOPUP');
              insert into public.research_jobs (id, user_id, result_json) values ('$J2', '$U2', '{\"_cost\":{\"identity\":{\"input_tokens\":200000,\"output_tokens\":15000}}}');
              select public.verify_billing_open('$J2', '$U2', 'verify:c0b2:s1');
              select public.verify_billing_close('$J2', 'STOPPED');" >/dev/null
for i in $(seq 1 20); do
  $P -d $DB -c "select public.verify_billing_open('$J2', '$U2', 'verify:c0b2:click$i', true, 1)" >/dev/null &
done
wait
for i in $(seq 1 10); do
  $P -d $DB -c "select public.verify_billing_close('$J2', 'STOPPED')" >/dev/null &
  $P -d $DB -c "select public.verify_billing_open('$J2', '$U2', 'verify:c0b2:race$i', true, 2)" >/dev/null 2>&1 &
done
wait
$P -d $DB -At <<SQL
do \$\$
declare v_auth int; v_open int; v_bal numeric; v_res numeric; v_charged numeric; v_authorized numeric;
begin
  select count(*) into v_open from public.verify_billing_sessions where job_id = '$J2' and state = 'RESERVED';
  select count(*) into v_auth from public.verify_billing_authorizations where job_id = '$J2';
  select balance, reserved into v_bal, v_res from public.credit_accounts where user_id = '$U2';
  select charged_total_credits, authorized_total_credits into v_charged, v_authorized from public.verify_billing where job_id = '$J2';
  if v_open > 1 then raise exception 'approval race: % open sessions', v_open; end if;
  if v_auth > 3 or v_authorized <> 25 * v_auth then raise exception 'approval race: % authorisations, authorised %', v_auth, v_authorized; end if;
  if v_bal < 0 or v_res < 0 or v_bal + v_res <> 200 - v_charged then raise exception 'approval race: wallet drift bal % res % charged %', v_bal, v_res, v_charged; end if;
  if v_charged > v_authorized then raise exception 'approval race: charged above authorisation'; end if;
  raise notice 'verify approval races: % authorisations (≤ 1 per screen), % open session(s), wallet consistent', v_auth, v_open;
end \$\$;
SQL
