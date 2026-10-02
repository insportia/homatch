#!/usr/bin/env bash
# Apply the Phase 2 migration TWICE to a throwaway Postgres built from
# phase2_fixture.sql, then run the behavioural checks. Needs Postgres 16 binaries.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
dir="${PGFIX_DIR:-/var/tmp/hm-pg}"; port="${PGFIX_PORT:-54329}"; bin="${PGBIN:-/usr/lib/postgresql/16/bin}"
if ! psql -h "$dir" -p "$port" -U postgres -tAc 'select 1' >/dev/null 2>&1; then
  rm -rf "$dir"; mkdir -p "$dir"; chown postgres "$dir" 2>/dev/null || true
  su postgres -c "$bin/initdb -D $dir/data -A trust >/dev/null && $bin/pg_ctl -D $dir/data -o '-p $port -k $dir' -l $dir/log start >/dev/null"
  sleep 2
fi
P="psql -h $dir -p $port -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists p2fx" -c "create database p2fx"
$P -d p2fx -f "$here/phase2_fixture.sql"
M="$root/supabase/migrations/20261008100000_phase2_universal_discovery.sql"
$P -d p2fx -1 -f "$M" 2>/dev/null
$P -d p2fx -1 -f "$M" 2>/dev/null
$P -d p2fx -f "$here/phase2_discovery_queue.sql"
$P -d p2fx -f "$here/phase2_fixture_admin.sql"
M2="$root/supabase/migrations/20261008100100_phase2_admin_intelligence.sql"
$P -d p2fx -1 -f "$M2"
$P -d p2fx -1 -f "$M2"
$P -d p2fx -f "$here/phase2_admin_intelligence.sql"
