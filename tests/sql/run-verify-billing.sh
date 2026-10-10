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
$P -d $DB -f tests/sql/verify_durable_execution.sql
$P -d $DB -f tests/sql/verify_credit_budget.sql
$P -d $DB -f tests/sql/verify_billing_audit_regressions.sql

# Concurrency: 30 simultaneous starts of one job (double clicks, retries, two tabs)
# hold the budget once; 30 simultaneous closes settle once; another product's
# reservations on the same wallet in parallel never drive it negative.
U=00000000-0000-4000-8000-0000000000c1
$P -d $DB -c "insert into public.credit_accounts (user_id, balance) values ('$U', 60);
              insert into public.credit_lots (user_id, kind, credits_granted, source_type) values ('$U','PURCHASED',60,'TOPUP');
              insert into public.research_jobs (id, user_id) values ('00000000-0000-4000-8000-00000000c0b1', '$U');"
for i in $(seq 1 30); do
  $P -d $DB -c "select public.verify_billing_open('00000000-0000-4000-8000-00000000c0b1', '$U', 'verify:c0b1:click$i')" >/dev/null &
done
for i in $(seq 1 6); do
  $P -d $DB -c "select public.wallet_reserve('$U', 'VERIFY', 5, 'other-product-$i')" >/dev/null 2>&1 &
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
  select count(*) into v_res from public.usage_reservations where user_id = '$U' and product_code = 'VERIFY' and job_ref = '00000000-0000-4000-8000-00000000c0b1';
  select count(*) into v_caps from public.credit_ledger where user_id = '$U' and type = 'SERVICE_CAPTURE';
  select balance, reserved into v_bal, v_reserved from public.credit_accounts where user_id = '$U';
  select charged_total_credits into v_charged from public.verify_billing where job_id = '00000000-0000-4000-8000-00000000c0b1';
  select coalesce(sum(reserved_credits), 0) into v_other from public.usage_reservations where user_id = '$U' and idempotency_key like 'other-product-%' and status = 'RESERVED';
  if v_sessions <> 1 or v_res <> 1 then raise exception 'concurrency: % sessions, % reservations', v_sessions, v_res; end if;
  if v_caps <> 1 then raise exception 'concurrency: % captures', v_caps; end if;
  if v_bal < 0 or v_reserved < 0 then raise exception 'concurrency: negative wallet'; end if;
  if v_bal + v_reserved <> 60 - v_charged then raise exception 'concurrency: drift bal % reserved % charged %', v_bal, v_reserved, v_charged; end if;
  if v_reserved <> v_other then raise exception 'concurrency: reserved % vs other holds %', v_reserved, v_other; end if;
  raise notice 'verify_credit_budget concurrency: 1 session, 1 capture, wallet consistent (charged %, other holds %)', v_charged, v_other;
end \$\$;
SQL
