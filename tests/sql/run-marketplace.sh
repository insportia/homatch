#!/usr/bin/env bash
# Apply the Marketplace Search foundation migration TWICE on top of the Phase 2
# fixture + migrations in a throwaway Postgres, then run the behavioural checks.
# Needs Postgres 16 binaries. Never touches a real project.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
dir="${PGFIX_DIR:-/var/tmp/hm-pg}"; port="${PGFIX_PORT:-54329}"; bin="${PGBIN:-/usr/lib/postgresql/16/bin}"
if ! psql -h "$dir" -p "$port" -U postgres -tAc 'select 1' >/dev/null 2>&1; then
  rm -rf "$dir"; mkdir -p "$dir"; chown postgres "$dir" 2>/dev/null || true
  su postgres -c "$bin/initdb -D $dir/data -A trust >/dev/null && $bin/pg_ctl -D $dir/data -o '-p $port -k $dir' -l $dir/log start >/dev/null"
  sleep 2
fi
P="psql -h $dir -p $port -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists mpfx" -c "create database mpfx"
$P -d mpfx -f "$here/phase2_fixture.sql"
$P -d mpfx -1 -f "$root/supabase/migrations/20261009100000_phase2_universal_discovery.sql" 2>/dev/null
$P -d mpfx -f "$here/phase2_fixture_admin.sql"
M="$root/supabase/migrations/20261010100000_marketplace_search_foundation.sql"
$P -d mpfx -1 -f "$M"
$P -d mpfx -1 -f "$M"
$P -d mpfx -f "$here/marketplace_search.sql"
