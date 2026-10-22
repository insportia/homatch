#!/usr/bin/env bash
# Finance V2 (20261119140000_finance_v2_engine.sql) on top of the Find Property paid social
# migrations, applied TWICE on a throwaway Postgres, then the VAT / policy / ledger checks.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
dir="${PGFIX_DIR:-/var/tmp/hm-pg}"; port="${PGFIX_PORT:-54329}"; bin="${PGBIN:-/usr/lib/postgresql/16/bin}"
if ! psql -h "$dir" -p "$port" -U postgres -tAc 'select 1' >/dev/null 2>&1; then
  rm -rf "$dir"; mkdir -p "$dir"; chown postgres "$dir" 2>/dev/null || true
  su postgres -c "$bin/initdb -D $dir/data -A trust >/dev/null && $bin/pg_ctl -D $dir/data -o '-p $port -k $dir' -l $dir/log start >/dev/null"
  sleep 2
fi
P="psql -h $dir -p $port -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists hmfinance" -c "create database hmfinance"
$P -d hmfinance -f "$here/homatch_leads_fixture.sql"
$P -d hmfinance -f "$here/find_property_social_offers_fixture.sql"
$P -d hmfinance -c "alter type public.signal_platform add value if not exists 'TIKTOK'"
$P -d hmfinance -c "create table if not exists public.supply_observations (id uuid primary key default gen_random_uuid())"
$P -d hmfinance -1 -f "$root/supabase/migrations/20261107095700_find_property_social_offers.sql"
$P -d hmfinance -1 -f "$root/supabase/migrations/20261110100000_find_property_social_listings.sql"
$P -d hmfinance -1 -f "$root/supabase/migrations/20261114090000_find_property_batched_offer_runs.sql"
$P -d hmfinance -f "$here/finance_v2_fixture.sql"
M="$root/supabase/migrations/20261119140000_finance_v2_engine.sql"
$P -d hmfinance -1 -f "$M"
$P -d hmfinance -1 -f "$M"
$P -d hmfinance -f "$here/finance_v2.sql"
# v1 campaigns behave exactly as before Finance V2: the existing paid social checks still pass.
$P -d hmfinance -f "$here/find_property_social_listings.sql"
$P -d hmfinance -f "$here/find_property_batched_offer_runs.sql"
echo "finance_v2: all checks passed"
