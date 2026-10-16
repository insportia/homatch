#!/usr/bin/env bash
# Publishing workspace migration proof on a THROWAWAY local Postgres 16 — never
# production. Applies the two 2026-10-14 publishing migrations, then
# 20261103090000_publishing_workspace.sql, on stand-in fixtures; runs tests.sql;
# then applies 20261106090000_publishing_providers.sql and runs providers.sql;
# then applies 20261108090000_publishing_central_accounts.sql and runs central.sql.
# Usage: tests/sql/publishing/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../../.."
dir="${PUBLISHING_PG_DIR:-/var/tmp/hm-publishing}"; port="${PUBLISHING_PG_PORT:-54333}"; bin="${PGBIN:-/usr/lib/postgresql/16/bin}"
if ! psql -h "$dir" -p "$port" -U postgres -tAc 'select 1' >/dev/null 2>&1; then
  rm -rf "$dir"; mkdir -p "$dir"; chown postgres "$dir" 2>/dev/null || true
  su postgres -c "$bin/initdb -D $dir/data -A trust >/dev/null && $bin/pg_ctl -D $dir/data -o \"-p $port -k $dir\" -l $dir/log start >/dev/null"
  sleep 2
fi
P="env PGOPTIONS=-cclient_min_messages=warning psql -h $dir -p $port -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists hmpub" -c "create database hmpub"
$P -d hmpub -f "$here/fixture.sql"
for m in 20261014074630_publishing_engine 20261014140000_publishing_engine_ssge 20261103090000_publishing_workspace; do
  $P -d hmpub -1 -f "$root/supabase/migrations/$m.sql"
done
run() {
  env PGOPTIONS=-cclient_min_messages=notice psql -h "$dir" -p "$port" -U postgres -d hmpub -v ON_ERROR_STOP=1 -q -o /dev/null -f "$1" 2>&1 \
    | sed -e 's/^psql:[^:]*:[0-9]*: NOTICE:  /  /' -e 's/^NOTICE:  /  /'
  return "${PIPESTATUS[0]}"
}
run "$here/tests.sql"
$P -d hmpub -1 -f "$root/supabase/migrations/20261106090000_publishing_providers.sql"
run "$here/providers.sql"
$P -d hmpub -1 -f "$root/supabase/migrations/20261108090000_publishing_central_accounts.sql"
run "$here/central.sql"
