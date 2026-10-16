#!/usr/bin/env bash
# Brokers directory while paused: the REAL broker_directory_purchase() (extracted verbatim from
# 20260930140000_broker_lifecycle.sql) behind the expansion's insert guard, on a THROWAWAY local
# Postgres 16 — never production. Proves a refused purchase or renewal charges nothing.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../../.."; base="$here/../service_controls"
dir="${PUBLISHING_PG_DIR:-/var/tmp/hm-publishing}"; port="${PUBLISHING_PG_PORT:-54333}"; bin="${PGBIN:-/usr/lib/postgresql/16/bin}"
if ! psql -h "$dir" -p "$port" -U postgres -tAc 'select 1' >/dev/null 2>&1; then
  rm -rf "$dir"; mkdir -p "$dir"; chown postgres "$dir" 2>/dev/null || true
  su postgres -c "$bin/initdb -D $dir/data -A trust >/dev/null && $bin/pg_ctl -D $dir/data -o \"-p $port -k $dir\" -l $dir/log start >/dev/null"
  sleep 2
fi
lifecycle="$root/supabase/migrations/20260930140000_broker_lifecycle.sql"
real="$(mktemp)"; trap 'rm -f "$real"' EXIT
awk '/^create table if not exists public.broker_listing_purchases/,/^\);/' "$lifecycle" > "$real"
awk '/^create or replace function public.broker_directory_purchase/,/^end \$\$;/' "$lifecycle" >> "$real"
grep -q 'insert into public.broker_listing_purchases' "$real" || { echo 'FAIL  could not extract the production function'; exit 1; }
P="env PGOPTIONS=-cclient_min_messages=warning psql -h $dir -p $port -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists hmsvcb" -c "create database hmsvcb"
$P -d hmsvcb -f "$base/fixture.sql" -f "$here/fixture.sql" -f "$real"
$P -d hmsvcb -c "grant execute on function public.broker_directory_purchase(text) to authenticated"
$P -d hmsvcb -1 -f "$root/supabase/migrations/20261109090000_service_controls.sql"
$P -d hmsvcb -1 -f "$root/supabase/migrations/20261110090000_service_controls_expand.sql"
env PGOPTIONS=-cclient_min_messages=notice psql -h "$dir" -p "$port" -U postgres -d hmsvcb -v ON_ERROR_STOP=1 -q -o /dev/null -f "$here/tests.sql" 2>&1 \
  | sed -e 's/^psql:[^:]*:[0-9]*: NOTICE:  /  /' -e 's/^NOTICE:  /  /'
test "${PIPESTATUS[0]}" = 0
echo 'brokers directory pause proof: PASS'
