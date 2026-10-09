#!/usr/bin/env bash
# Apply the internal-match demo migration TWICE to a throwaway Postgres built from
# internal_match_demo_fixture.sql, then run the behavioural checks. Needs Postgres 16 binaries.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
dir="${PGFIX_DIR:-/var/tmp/hm-pg}"; port="${PGFIX_PORT:-54329}"; bin="${PGBIN:-/usr/lib/postgresql/16/bin}"
if ! psql -h "$dir" -p "$port" -U postgres -tAc 'select 1' >/dev/null 2>&1; then
  rm -rf "$dir"; mkdir -p "$dir"; chown postgres "$dir" 2>/dev/null || true
  su postgres -c "$bin/initdb -D $dir/data -A trust >/dev/null && $bin/pg_ctl -D $dir/data -o '-p $port -k $dir' -l $dir/log start >/dev/null"
  sleep 2
fi
P="psql -h $dir -p $port -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists imdemo" -c "create database imdemo"
$P -d imdemo -f "$here/internal_match_demo_fixture.sql"
M="$root/supabase/migrations/20261024120000_internal_match_demo.sql"
$P -d imdemo -1 -f "$M"
$P -d imdemo -1 -f "$M"
$P -d imdemo -f "$here/internal_match_demo.sql"
echo "internal_match_demo: all checks passed"
