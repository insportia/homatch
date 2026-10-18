#!/usr/bin/env bash
# Cron history retention proof on a THROWAWAY local Postgres 16 with a stand-in cron schema — never production.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../../.."
dir="${CRONRET_PG_DIR:-/var/tmp/hm-cronret}"; port="${CRONRET_PG_PORT:-54342}"; bin="${PGBIN:-/usr/lib/postgresql/16/bin}"
if ! psql -h "$dir" -p "$port" -U postgres -tAc 'select 1' >/dev/null 2>&1; then
  rm -rf "$dir"; mkdir -p "$dir"; chown postgres "$dir" 2>/dev/null || true
  su postgres -c "$bin/initdb -D $dir/data -A trust >/dev/null && $bin/pg_ctl -D $dir/data -o \"-p $port -k $dir\" -l $dir/log start >/dev/null"
  sleep 2
fi
P="env PGOPTIONS=-cclient_min_messages=warning psql -h $dir -p $port -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists hmcron" -c "create database hmcron"
$P -d hmcron -f "$here/fixture.sql"
$P -d hmcron -1 -f "$root/supabase/migrations/20261114120000_cron_history_retention.sql"
$P -d hmcron -1 -f "$root/supabase/migrations/20261114120000_cron_history_retention.sql"; echo "  PASS  re-applies cleanly (one job, by name)"
env PGOPTIONS=-cclient_min_messages=notice psql -h "$dir" -p "$port" -U postgres -d hmcron -v ON_ERROR_STOP=1 -q -o /dev/null -f "$here/tests.sql" 2>&1 \
  | sed -e 's/^psql:[^:]*:[0-9]*: NOTICE:  /  /' -e 's/^NOTICE:  /  /'
test "${PIPESTATUS[0]}" = 0
echo 'cron history retention proof: PASS'
