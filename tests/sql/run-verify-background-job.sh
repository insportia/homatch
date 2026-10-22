#!/usr/bin/env bash
# Verify background job terminal stage (20261120090000), on a scratch local Postgres (never production).
#   PGHOST=/tmp PGPORT=55432 PGUSER=postgres bash tests/sql/run-verify-background-job.sh
set -euo pipefail
DB=${DB:-verify_bgjob_t}
export PGOPTIONS='-c check_function_bodies=off'
P="psql -v ON_ERROR_STOP=1 -q"
cd "$(dirname "$0")/../.."
$P -d postgres -c "drop database if exists $DB" -c "create database $DB"
$P -d $DB -f tests/sql/verify_background_job_fixture.sql
$P -d $DB -f supabase/migrations/20260911211715_background_jobs.sql
$P -d $DB -f supabase/migrations/20260911213925_background_jobs_worker_guard_checks_role_not_uid.sql
$P -d $DB -f supabase/migrations/20261120090000_verify_background_job_terminal_stage.sql
$P -d $DB -f tests/sql/verify_background_job_terminal_stage.sql

# Concurrency: 20 simultaneous finishes of one live VERIFY job (two ticks, a
# retry) leave one terminal state and exactly one COMPLETE stage entry.
U=00000000-0000-4000-8000-0000000000e2
J=00000000-0000-4000-8000-0000000000f2
$P -d $DB -c "insert into auth.users (id) values ('$U');
              insert into public.background_jobs (id, user_id, product_type, subject_type, idempotency_key, current_stage, state)
              values ('$J', '$U', 'VERIFY', 'RESEARCH_JOB', 'verify:race', 'REPORT_WRITING', 'PROCESSING');"
for i in $(seq 1 20); do
  $P -d $DB -c "select public.background_job_finish('$J', 'COMPLETED', '/verify?job=race')" >/dev/null &
done
wait
OUT=$($P -d $DB -At -c "select state || '|' || current_stage || '|' || (select count(*) from jsonb_array_elements(stages) e where e->>'stage' = 'COMPLETE') from public.background_jobs where id = '$J'")
[ "$OUT" = "COMPLETED|COMPLETE|1" ] || { echo "concurrent finish: expected COMPLETED|COMPLETE|1, got $OUT"; exit 1; }
echo "verify background job terminal stage: OK"
