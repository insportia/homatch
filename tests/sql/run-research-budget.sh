#!/usr/bin/env bash
# Apply the Find Buyers research-budget migration TWICE on a throwaway Postgres
# (homatch_leads_fixture.sql + find_buyers_research_budget_fixture.sql), then run the checks.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
dir="${PGFIX_DIR:-/var/tmp/hm-pg}"; port="${PGFIX_PORT:-54329}"; bin="${PGBIN:-/usr/lib/postgresql/16/bin}"
if ! psql -h "$dir" -p "$port" -U postgres -tAc 'select 1' >/dev/null 2>&1; then
  rm -rf "$dir"; mkdir -p "$dir"; chown postgres "$dir" 2>/dev/null || true
  su postgres -c "$bin/initdb -D $dir/data -A trust >/dev/null && $bin/pg_ctl -D $dir/data -o '-p $port -k $dir' -l $dir/log start >/dev/null"
  sleep 2
fi
P="psql -h $dir -p $port -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists hmbudget" -c "create database hmbudget"
$P -d hmbudget -f "$here/homatch_leads_fixture.sql"
$P -d hmbudget -f "$here/find_buyers_research_budget_fixture.sql"
M="$root/supabase/migrations/20261027120000_find_buyers_research_budget.sql"
$P -d hmbudget -1 -f "$M"
$P -d hmbudget -1 -f "$M"
$P -d hmbudget -f "$here/find_buyers_research_budget.sql"
echo "find_buyers_research_budget: all checks passed"
