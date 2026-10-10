#!/usr/bin/env bash
# Apply the internal-match demo migration, then the owner-demo-lead migration TWICE, to a
# throwaway Postgres built from internal_match_demo_fixture.sql, and run the behavioural
# checks. Needs Postgres 16 binaries.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
dir="${PGFIX_DIR:-/var/tmp/hm-pg}"; port="${PGFIX_PORT:-54329}"; bin="${PGBIN:-/usr/lib/postgresql/16/bin}"
if ! psql -h "$dir" -p "$port" -U postgres -tAc 'select 1' >/dev/null 2>&1; then
  rm -rf "$dir"; mkdir -p "$dir"; chown postgres "$dir" 2>/dev/null || true
  su postgres -c "$bin/initdb -D $dir/data -A trust >/dev/null && $bin/pg_ctl -D $dir/data -o '-p $port -k $dir' -l $dir/log start >/dev/null"
  sleep 2
fi
P="psql -h $dir -p $port -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists ownerdemo" -c "create database ownerdemo"
$P -d ownerdemo -f "$here/internal_match_demo_fixture.sql"
$P -d ownerdemo -1 -f "$root/supabase/migrations/20261024120000_internal_match_demo.sql"
M="$root/supabase/migrations/20261029090000_owner_demo_lead.sql"
$P -d ownerdemo -1 -f "$M"
$P -d ownerdemo -1 -f "$M"
$P -d ownerdemo -f "$here/owner_demo_lead.sql"
echo "owner_demo_lead: all checks passed"
