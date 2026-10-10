#!/usr/bin/env bash
# Apply the HOMATCH Leads marketplace migration TWICE to a throwaway Postgres built from
# homatch_leads_fixture.sql, then run the behavioural checks. Needs Postgres 16 binaries.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
dir="${PGFIX_DIR:-/var/tmp/hm-pg}"; port="${PGFIX_PORT:-54329}"; bin="${PGBIN:-/usr/lib/postgresql/16/bin}"
if ! psql -h "$dir" -p "$port" -U postgres -tAc 'select 1' >/dev/null 2>&1; then
  rm -rf "$dir"; mkdir -p "$dir"; chown postgres "$dir" 2>/dev/null || true
  su postgres -c "$bin/initdb -D $dir/data -A trust >/dev/null && $bin/pg_ctl -D $dir/data -o '-p $port -k $dir' -l $dir/log start >/dev/null"
  sleep 2
fi
P="psql -h $dir -p $port -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists hmleads_${PGDB_SUFFIX:-main}" -c "create database hmleads_${PGDB_SUFFIX:-main}"
$P -d hmleads_${PGDB_SUFFIX:-main} -f "$here/homatch_leads_fixture.sql"
M="$root/supabase/migrations/20261028090000_homatch_leads_marketplace.sql"
$P -d hmleads_${PGDB_SUFFIX:-main} -1 -f "$M"
$P -d hmleads_${PGDB_SUFFIX:-main} -1 -f "$M"
$P -d hmleads_${PGDB_SUFFIX:-main} -f "$here/homatch_leads.sql"
echo "homatch_leads: all checks passed"
