#!/usr/bin/env bash
# Apply the Marketplace Search foundation migration TWICE on top of the Phase 2
# fixture + migrations in a throwaway Postgres, then run the behavioural checks.
# Needs Postgres 16 binaries. Never touches a real project.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
dir="${PGFIX_DIR:-/var/tmp/hm-pg}"; port="${PGFIX_PORT:-54329}"; bin="${PGBIN:-/usr/lib/postgresql/16/bin}"
if ! psql -h "$dir" -p "$port" -U postgres -tAc 'select 1' >/dev/null 2>&1; then
  rm -rf "$dir"; mkdir -p "$dir"; chown postgres "$dir" 2>/dev/null || true
  su postgres -c "$bin/initdb -D $dir/data -A trust >/dev/null && $bin/pg_ctl -D $dir/data -o '-p $port -k $dir' -l $dir/log start >/dev/null"
  sleep 2
fi
P="psql -h $dir -p $port -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists mpfx" -c "create database mpfx"
$P -d mpfx -f "$here/phase2_fixture.sql"
$P -d mpfx -1 -f "$root/supabase/migrations/20261009100000_phase2_universal_discovery.sql" 2>/dev/null
$P -d mpfx -f "$here/phase2_fixture_admin.sql"
$P -d mpfx -f "$here/marketplace_fixture.sql"
M="$root/supabase/migrations/20261010100000_marketplace_search_foundation.sql"
$P -d mpfx -1 -f "$M"
$P -d mpfx -1 -f "$M"
$P -d mpfx -f "$here/marketplace_search.sql"

rl_out="$(mktemp)"
# Rate limit under REAL concurrency: 25 parallel sessions for one user, burst limit 10.
$P -d mpfx -c "delete from public.rate_limit_events" -c "insert into public.users(id) values ('00000000-0000-4000-8000-0000000000aa') on conflict do nothing"
for i in $(seq 1 25); do
  $P -d mpfx -tAc "select (public.consume_marketplace_rate_limit('00000000-0000-4000-8000-0000000000aa','mps_understand',10,600,40,86400)->>'allowed')" &
done > "$rl_out"
wait
allowed=$(grep -c '^true$' "$rl_out"); denied=$(grep -c '^false$' "$rl_out")
rows=$($P -d mpfx -tAc "select count(*) from public.rate_limit_events where operation='mps_understand'")
if [ "$allowed" != "10" ] || [ "$denied" != "15" ] || [ "$rows" != "10" ]; then
  echo "RATE LIMIT CONCURRENCY: FAIL allowed=$allowed denied=$denied rows=$rows"; exit 1
fi
echo "RATE LIMIT CONCURRENCY: PASS (25 parallel → 10 allowed, 15 refused, 10 recorded)"
