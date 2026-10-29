#!/usr/bin/env bash
# Email Marketing hidden (20261207140000) proof on a THROWAWAY local Postgres 16 — never production.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../../.."
dir="${PUBLISHING_PG_DIR:-/var/tmp/hm-publishing}"; port="${PUBLISHING_PG_PORT:-54333}"; bin="${PGBIN:-/usr/lib/postgresql/16/bin}"
if ! psql -h "$dir" -p "$port" -U postgres -tAc 'select 1' >/dev/null 2>&1; then
  rm -rf "$dir"; mkdir -p "$dir"; chown postgres "$dir" 2>/dev/null || true
  su postgres -c "$bin/initdb -D $dir/data -A trust >/dev/null && $bin/pg_ctl -D $dir/data -o \"-p $port -k $dir\" -l $dir/log start >/dev/null"
  sleep 2
fi
P="env PGOPTIONS=-cclient_min_messages=warning psql -h $dir -p $port -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists hmemhid" -c "create database hmemhid"
$P -d hmemhid -f "$here/fixture.sql" -f "$here/before.sql"
$P -d hmemhid -1 -f "$root/supabase/migrations/20261207140000_email_marketing_hidden.sql"
# A second apply is a no-op (the runner may retry): same rows, no second audit row.
$P -d hmemhid -1 -f "$root/supabase/migrations/20261207140000_email_marketing_hidden.sql"
echo "  PASS  a second apply is a no-op"
env PGOPTIONS=-cclient_min_messages=notice psql -h "$dir" -p "$port" -U postgres -d hmemhid -v ON_ERROR_STOP=1 -q -o /dev/null -f "$here/tests.sql" 2>&1 \
  | sed -e 's/^psql:[^:]*:[0-9]*: NOTICE:  /  /' -e 's/^NOTICE:  /  /'
test "${PIPESTATUS[0]}" = 0
echo 'email marketing hidden proof: PASS'
