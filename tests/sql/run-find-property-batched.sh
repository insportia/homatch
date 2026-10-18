#!/usr/bin/env bash
# The batched-runs migration on top of the paid social offer migrations, applied TWICE on a
# throwaway Postgres, then the batched reservation checks.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
dir="${PGFIX_DIR:-/var/tmp/hm-pg}"; port="${PGFIX_PORT:-54329}"; bin="${PGBIN:-/usr/lib/postgresql/16/bin}"
if ! psql -h "$dir" -p "$port" -U postgres -tAc 'select 1' >/dev/null 2>&1; then
  rm -rf "$dir"; mkdir -p "$dir"; chown postgres "$dir" 2>/dev/null || true
  su postgres -c "$bin/initdb -D $dir/data -A trust >/dev/null && $bin/pg_ctl -D $dir/data -o '-p $port -k $dir' -l $dir/log start >/dev/null"
  sleep 2
fi
P="psql -h $dir -p $port -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists hmfpbatched" -c "create database hmfpbatched"
$P -d hmfpbatched -f "$here/homatch_leads_fixture.sql"
$P -d hmfpbatched -f "$here/find_property_social_offers_fixture.sql"
# Production's enum carries TIKTOK (signal_platform); the shared fixture predates it.
$P -d hmfpbatched -c "alter type public.signal_platform add value if not exists 'TIKTOK'"
$P -d hmfpbatched -c "create table if not exists public.supply_observations (id uuid primary key default gen_random_uuid())"
$P -d hmfpbatched -1 -f "$root/supabase/migrations/20261107095700_find_property_social_offers.sql"
$P -d hmfpbatched -1 -f "$root/supabase/migrations/20261110100000_find_property_social_listings.sql"
M="$root/supabase/migrations/20261114090000_find_property_batched_offer_runs.sql"
$P -d hmfpbatched -1 -f "$M"
$P -d hmfpbatched -1 -f "$M"
$P -d hmfpbatched -f "$here/find_property_batched_offer_runs.sql"
echo "find_property_batched_offer_runs: all checks passed"
