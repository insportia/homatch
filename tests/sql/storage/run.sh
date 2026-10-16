#!/usr/bin/env bash
# R2 routing migration tests on a THROWAWAY local Postgres 16 — never
# production, no network. Applies 20261107090000 twice (it must re-run), then
# runs tests.sql.   Usage: tests/sql/storage/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../../.."
dir="${STORAGE_PG_DIR:-/var/tmp/hm-storage}"; port="${STORAGE_PG_PORT:-54334}"; bin="${PGBIN:-/usr/lib/postgresql/16/bin}"
M="$root/supabase/migrations/20261107090000_storage_r2_routing.sql"
if ! psql -h "$dir" -p "$port" -U postgres -tAc 'select 1' >/dev/null 2>&1; then
  rm -rf "$dir"; mkdir -p "$dir"; chown postgres "$dir" 2>/dev/null || true
  su postgres -c "$bin/initdb -D $dir/data -A trust >/dev/null && $bin/pg_ctl -D $dir/data -o \"-p $port -k $dir\" -l $dir/log start >/dev/null"
  sleep 2
fi
P="env PGOPTIONS=-cclient_min_messages=warning psql -h $dir -p $port -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists hmstorage" -c "create database hmstorage"
$P -d hmstorage -f "$here/fixture.sql"
$P -d hmstorage -1 -f "$M"
$P -d hmstorage -1 -f "$M"
env PGOPTIONS=-cclient_min_messages=notice psql -h "$dir" -p "$port" -U postgres -d hmstorage -v ON_ERROR_STOP=1 -q -o /dev/null -f "$here/tests.sql" 2>&1 \
  | sed -e 's/^psql:[^:]*:[0-9]*: NOTICE:  /  /' -e 's/^NOTICE:  /  /'
echo "STORAGE R2 ROUTING SQL: PASS"
