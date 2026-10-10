#!/usr/bin/env bash
# Apply the market-segmentation and buyer-intelligence migrations TWICE to a
# throwaway Postgres built from buyer_intelligence_fixture.sql, then run the
# behavioural checks. Needs Postgres 16 binaries.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
dir="${PGFIX_DIR:-/var/tmp/hm-pg-bi}"; port="${PGFIX_PORT:-54377}"; bin="${PGBIN:-/usr/lib/postgresql/16/bin}"
if ! psql -h "$dir" -p "$port" -U postgres -tAc 'select 1' >/dev/null 2>&1; then
  rm -rf "$dir"; mkdir -p "$dir"; chown postgres "$dir" 2>/dev/null || true
  su postgres -c "$bin/initdb -D $dir/data -A trust -E UTF8 --locale=C.utf8 >/dev/null && $bin/pg_ctl -D $dir/data -o '-p $port -k $dir' -l $dir/log start >/dev/null"
  sleep 2
fi
P="psql -h $dir -p $port -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists bifx" -c "create database bifx template template0 encoding 'UTF8' lc_collate 'C.utf8' lc_ctype 'C.utf8'"
$P -d bifx -f "$here/buyer_intelligence_fixture.sql"
for m in 20261024100000_market_segmentation.sql 20261024110000_buyer_intelligence.sql; do
  $P -d bifx -1 -f "$root/supabase/migrations/$m"
  $P -d bifx -1 -f "$root/supabase/migrations/$m"
done
$P -d bifx -f "$here/buyer_intelligence.sql"
