#!/usr/bin/env bash
# HOMATCH database micro-benchmarks on a THROWAWAY local Postgres 16 — never
# production, no network, no providers, no money. See docs/infra/SCALABILITY_AUDIT.md.
#
#   1. TEMP SPILL   reproduces the production temp-file source: one read of
#                   pg_stat_statements at production's work_mem (2184kB) with
#                   ~4.9k entries / ~2.9 MB of text, then after a reset, then at
#                   a larger work_mem.
#   2. QUEUE CLAIM  claim→complete cycles on claim_marketplace_worker_runs (the
#                   real #72 migration) at 1/8/32 concurrent workers; checks no
#                   run is ever handed out twice and none is lost.
#   3. CRON PURGE   applies the retention migration twice to a 250k-row history
#                   spanning 42 days; checks only rows older than 7 days go, in
#                   bounded batches, and the job is scheduled exactly once.
#
# Needs Postgres 16 binaries + pgbench. Usage: tests/sql/perf/run-db-bench.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../../.."
dir="${PGBENCH_DIR:-/var/tmp/hm-perf}"; port="${PGBENCH_PORT:-54331}"; bin="${PGBIN:-/usr/lib/postgresql/16/bin}"
secs="${BENCH_SECONDS:-15}"
PROD_WORK_MEM=2184kB   # production setting read 2026-10-09

if ! psql -h "$dir" -p "$port" -U postgres -tAc 'select 1' >/dev/null 2>&1; then
  rm -rf "$dir"; mkdir -p "$dir"; chown postgres "$dir" 2>/dev/null || true
  su postgres -c "$bin/initdb -D $dir/data -A trust >/dev/null && $bin/pg_ctl -D $dir/data \
    -o \"-p $port -k $dir -c shared_preload_libraries=pg_stat_statements -c pg_stat_statements.max=5000 \
        -c pg_stat_statements.track=top -c pg_stat_statements.track_utility=on -c work_mem=$PROD_WORK_MEM \
        -c max_connections=100\" -l $dir/log start >/dev/null"
  sleep 2
fi
P="env PGOPTIONS=-cclient_min_messages=warning psql -h $dir -p $port -U postgres -v ON_ERROR_STOP=1 -q"
Q="psql -h $dir -p $port -U postgres -tA -v ON_ERROR_STOP=1"
$P -c "drop database if exists hmperf" -c "create database hmperf"
$P -d hmperf -f "$here/fixture.sql"
$P -d hmperf -c "create extension if not exists pg_stat_statements"

temp() { $Q -d hmperf -c "select pg_stat_force_next_flush(); select temp_files||' '||temp_bytes from pg_stat_database where datname='hmperf'" | tail -1; }
# One read in its own session (session exit flushes its stats), then the delta.
measure() {
  local label="$1" sql="$2" wm="$3" a b
  a=$(temp); $Q -d hmperf -c "set work_mem='$wm'" -c "$sql" >/dev/null; sleep 1; b=$(temp)
  read -r f0 b0 <<<"$a"; read -r f1 b1 <<<"$b"
  printf '  %-46s work_mem=%-7s temp_files=+%-3s temp_bytes=+%s\n' "$label" "$wm" "$((f1 - f0))" "$((b1 - b0))"
}

echo "== 1. TEMP SPILL (pg_stat_statements read)"
# ~4.9k distinct statements with production-like text length (~590 chars avg).
$P -d hmperf -c "do \$\$ begin for t in 1..50 loop execute format('create table bench_t%s (%s)', t,
  (select string_agg(format('c%s int', c), ',') from generate_series(1,100) c)); end loop; end \$\$"
pad=$(printf 'x%.0s' $(seq 1 520))
gen="$dir/stmts.sql"; : > "$gen"
for t in $(seq 1 50); do for c in $(seq 1 98); do
  echo "select /* $pad */ c$c from bench_t$t where c$c is not null limit 1;" >> "$gen"; done; done
$Q -d hmperf -f "$gen" >/dev/null
$Q -d hmperf -c "select 'entries='||count(*)||' text_mb='||round(sum(length(query))/1e6,2) from pg_stat_statements" | sed 's/^/  /'
READ="select queryid, calls, total_exec_time, query from pg_stat_statements order by total_exec_time desc limit 50"
measure "full read (with text), production work_mem" "$READ" "$PROD_WORK_MEM"
measure "read without text: pg_stat_statements(false)" "select count(*) from pg_stat_statements(false)" "$PROD_WORK_MEM"
measure "full read (with text), work_mem 8MB" "$READ" "8MB"
$Q -d hmperf -c "select pg_stat_statements_reset()" >/dev/null
measure "full read after pg_stat_statements_reset()" "$READ" "$PROD_WORK_MEM"
$P -d hmperf -c "do \$\$ begin for t in 1..50 loop execute format('drop table bench_t%s', t); end loop; end \$\$"

echo "== 2. QUEUE CLAIM (claim_marketplace_worker_runs, claim→complete)"
$P -d hmperf -1 -f "$root/supabase/migrations/20261010100000_marketplace_search_foundation.sql"
$P -d hmperf -c "update public.admin_settings set value='1000'::jsonb where key='marketplace_max_concurrent_runs';
  insert into public.discovery_marketplace_workers (worker_id, source_key, source_name, execution_mode, state, enabled, max_concurrency, max_attempts)
    select 'bench-w'||w, 'bench'||w, 'Bench '||w, 'HTTP', 'ACTIVE', true, 50, 3 from generate_series(1,4) w;
  insert into public.users (id) values ('00000000-0000-0000-0000-00000000be0c');
  -- Bench-only: a worker's claim then its completion report, as two statements.
  create function public.bench_claim_complete(p_worker text) returns integer language plpgsql as \$f\$
  declare v_ids uuid[];
  begin
    select array_agg(id) into v_ids from public.claim_marketplace_worker_runs(p_worker, 5, 120);
    update public.discovery_marketplace_worker_runs set status = 'COMPLETE', completed_at = now(), lease_expires_at = null
     where id = any(v_ids);
    return coalesce(array_length(v_ids, 1), 0);
  end \$f\$;"
for clients in 1 8 32; do
  $P -d hmperf -c "truncate public.discovery_marketplace_searches cascade;
    insert into public.discovery_marketplace_searches (user_id, idempotency_key, status, brief, request, deadline_at)
      select '00000000-0000-0000-0000-00000000be0c', 'bench-key-'||g, 'SEARCHING', '{}', '{}', now() + interval '1 hour' from generate_series(1,6000) g;
    insert into public.discovery_marketplace_worker_runs (search_id, worker_id, request, deadline_at)
      select s.id, 'bench-w'||w, '{}', now() + interval '1 hour' from public.discovery_marketplace_searches s, generate_series(1,4) w;" \
    -c "vacuum analyze public.discovery_marketplace_worker_runs"
  cat > "$dir/claim.pgb" <<'PGB'
\set w random(1, 4)
select public.bench_claim_complete('bench-w' || :w);
PGB
  out=$(pgbench -h "$dir" -p "$port" -U postgres -n -c "$clients" -j "$(( clients < 4 ? clients : 4 ))" -T "$secs" -f "$dir/claim.pgb" -r hmperf 2>&1)
  tps=$(sed -n 's/^tps = \([0-9.]*\).*/\1/p' <<<"$out" | head -1)
  lat=$(sed -n 's/^latency average = \(.*\)$/\1/p' <<<"$out")
  inv=$($Q -d hmperf -c "select 'done='||count(*) filter (where status='COMPLETE')
      ||' twice='||count(*) filter (where attempts > 1)
      ||' stranded='||count(*) filter (where status='SEARCHING')
      ||' runs_per_s='||round(count(*) filter (where status='COMPLETE') / $secs.0, 0)
    from public.discovery_marketplace_worker_runs")
  printf '  clients=%-3s tps=%-9s latency_avg=%-12s %s\n' "$clients" "$tps" "$lat" "$inv"
  case "$inv" in *" twice=0 "*) ;; *) echo "  FAIL: a run was handed out more than once"; exit 1;; esac
done

echo "== 3. CRON PURGE (20261024090000_cron_history_retention.sql)"
$P -d hmperf -c "insert into cron.job_run_details (jobid, status, command, start_time, end_time)
  select 1 + g % 15, 'succeeded', 'select net.http_post(...)', ts, ts + interval '80 ms'
    from (select g, now() - interval '42 days' + (g * interval '42 days' / 250000) ts from generate_series(1,250000) g) x;"
M="$root/supabase/migrations/20261024090000_cron_history_retention.sql"
$P -d hmperf -1 -f "$M"; $P -d hmperf -1 -f "$M"
$Q -d hmperf -c "select 'scheduled_jobs='||count(*)||' schedule='||max(schedule) from cron.job where jobname='homatch-cron-history-retention'" | sed 's/^/  /'
keep_before=$($Q -d hmperf -c "select count(*) from cron.job_run_details where start_time >= now() - interval '7 days'")
calls=0; total=0
while :; do
  t0=$(date +%s%N); n=$($Q -d hmperf -c "select public.purge_cron_history()"); t1=$(date +%s%N)
  calls=$((calls + 1)); total=$((total + n))
  [ "$calls" -le 2 ] && printf '  call %s deleted=%s in %sms\n' "$calls" "$n" "$(( (t1 - t0) / 1000000 ))"
  [ "$n" -eq 0 ] && break
done
$Q -d hmperf -c "select 'remaining='||count(*)||' older_than_7d='||count(*) filter (where start_time < now() - interval '7 days')
   ||' kept_7d='||count(*) filter (where start_time >= now() - interval '7 days') from cron.job_run_details" | sed "s/^/  calls=$calls deleted=$total /"
left=$($Q -d hmperf -c "select count(*) from cron.job_run_details where start_time < now() - interval '7 days'")
kept=$($Q -d hmperf -c "select count(*) from cron.job_run_details where start_time >= now() - interval '7 days'")
[ "$left" -eq 0 ] && [ "$kept" -eq "$keep_before" ] || { echo "  FAIL: retention kept=$kept/$keep_before older_left=$left"; exit 1; }
echo "DB BENCH: PASS"
