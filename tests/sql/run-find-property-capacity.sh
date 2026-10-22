#!/usr/bin/env bash
# Find Property capacity proof (20261116090000) on a THROWAWAY local Postgres 16 — never production.
# Builds the marketplace schema exactly as run-marketplace.sh does, applies the capacity migration
# twice, runs the scenarios, then races identical and same-user starts across parallel sessions.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
dir="${PGFIX_DIR:-/var/tmp/hm-pg}"; port="${PGFIX_PORT:-54329}"; bin="${PGBIN:-/usr/lib/postgresql/16/bin}"
if ! psql -h "$dir" -p "$port" -U postgres -tAc 'select 1' >/dev/null 2>&1; then
  rm -rf "$dir"; mkdir -p "$dir"; chown postgres "$dir" 2>/dev/null || true
  su postgres -c "$bin/initdb -D $dir/data -A trust >/dev/null && $bin/pg_ctl -D $dir/data -o '-p $port -k $dir' -l $dir/log start >/dev/null"
  sleep 2
fi
P="env PGOPTIONS=-cclient_min_messages=warning psql -h $dir -p $port -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists fpcap" -c "create database fpcap"
$P -d fpcap -f "$here/phase2_fixture.sql"
$P -d fpcap -1 -f "$root/supabase/migrations/20261009100000_phase2_universal_discovery.sql" 2>/dev/null
$P -d fpcap -f "$here/phase2_fixture_admin.sql"
$P -d fpcap -f "$here/marketplace_fixture.sql"
$P -d fpcap -1 -f "$root/supabase/migrations/20261010100000_marketplace_search_foundation.sql"
$P -d fpcap -f "$here/find_property_capacity_fixture.sql"
M="$root/supabase/migrations/20261116090000_find_property_capacity.sql"
$P -d fpcap -1 -f "$M"
$P -d fpcap -1 -f "$M"
echo "  PASS  migration applies twice"
env PGOPTIONS=-cclient_min_messages=notice psql -h "$dir" -p "$port" -U postgres -d fpcap -v ON_ERROR_STOP=1 -q -o /dev/null \
  -f "$here/find_property_capacity.sql" 2>&1 | sed -e 's/^psql:[^:]*:[0-9]*: NOTICE:  /  /' -e 's/^NOTICE:  /  /'
test "${PIPESTATUS[0]}" = 0

# Parallel sessions: 30 different customers start the SAME request at once → exactly one live run.
$P -d fpcap -f - <<'SQL'
delete from public.rate_limit_events; delete from public.discovery_marketplace_worker_runs; delete from public.discovery_marketplace_searches;
insert into public.users (id, created_at) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, now() - interval '30 days' from generate_series(1, 40) g on conflict (id) do nothing;
insert into public.discovery_marketplace_searches (id, user_id, search_plan_id, idempotency_key, status, brief, request, deadline_at)
select ('10000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
       (select id from public.discovery_search_plans limit 1), 'race-' || lpad(g::text, 8, '0'), 'DISPATCHING', '{}', '{}', now() + interval '20 minutes'
  from generate_series(1, 40) g;
SQL
out="$(mktemp)"
for g in $(seq 1 30); do
  id=$(printf '%012d' "$g")
  $P -d fpcap -tAc "select r->>'mode' from jsonb_array_elements((public.marketplace_dispatch_search('10000000-0000-4000-8000-$id','00000000-0000-4000-8000-$id','10.0.0.$g','[{\"worker_id\":\"cap-worker\",\"request\":{},\"request_key\":\"race-key\",\"deadline_at\":\"$(date -u -d '+10 min' +%FT%TZ)\"}]'::jsonb))->'runs') r" &
done > "$out"
wait
live=$(grep -c '^LIVE$' "$out" || true); shared=$(grep -c '^SHARED$' "$out" || true)
leaders=$($P -d fpcap -tAc "select count(*) from public.discovery_marketplace_worker_runs where request_key='race-key' and shared_run_id is null")
if [ "$live" != 1 ] || [ "$shared" != 29 ] || [ "$leaders" != 1 ]; then echo "  FAIL  race identical: live=$live shared=$shared leaders=$leaders"; exit 1; fi
echo "  PASS  30 parallel identical starts → 1 live portal run, 29 shared"

# Parallel sessions: one customer starts 12 DIFFERENT requests at once → exactly 3 live (NORMAL tier).
: > "$out"
$P -d fpcap -c "insert into public.discovery_marketplace_searches (id, user_id, search_plan_id, idempotency_key, status, brief, request, deadline_at) select ('20000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, '00000000-0000-4000-8000-000000000031', (select id from public.discovery_search_plans limit 1), 'same-user-' || g, 'DISPATCHING', '{}', '{}', now() + interval '20 minutes' from generate_series(1, 12) g"
for g in $(seq 1 12); do
  sid=$(printf '%012d' "$g")
  $P -d fpcap -tAc "select r->>'mode' from jsonb_array_elements((public.marketplace_dispatch_search('20000000-0000-4000-8000-$sid','00000000-0000-4000-8000-000000000031',null,'[{\"worker_id\":\"cap-worker\",\"request\":{},\"request_key\":\"user-key-$g\",\"deadline_at\":\"$(date -u -d '+10 min' +%FT%TZ)\"}]'::jsonb))->'runs') r" &
done > "$out"
wait
live=$(grep -c '^LIVE$' "$out" || true); limited=$(grep -c '^LIVE_REFRESH_LIMIT$' "$out" || true)
events=$($P -d fpcap -tAc "select count(*) from public.rate_limit_events where user_id='00000000-0000-4000-8000-000000000031'")
if [ "$live" != 3 ] || [ "$limited" != 9 ] || [ "$events" != 3 ]; then echo "  FAIL  race same user: live=$live limited=$limited events=$events"; exit 1; fi
echo "  PASS  12 parallel different starts by one customer → 3 live, 9 answered from the pool, 3 counted"
echo 'find property capacity proof: PASS'
