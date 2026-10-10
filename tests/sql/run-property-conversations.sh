#!/usr/bin/env bash
# Apply the Property Conversations migration TWICE on top of the HOMATCH Leads fixture
# + migration (so the real CRM triggers on messages run), then the behavioural checks.
# Needs Postgres 16 binaries.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
dir="${PGFIX_DIR:-/var/tmp/hm-pg}"; port="${PGFIX_PORT:-54329}"; bin="${PGBIN:-/usr/lib/postgresql/16/bin}"
if ! psql -h "$dir" -p "$port" -U postgres -tAc 'select 1' >/dev/null 2>&1; then
  rm -rf "$dir"; mkdir -p "$dir"; chown postgres "$dir" 2>/dev/null || true
  su postgres -c "$bin/initdb -D $dir/data -A trust >/dev/null && $bin/pg_ctl -D $dir/data -o '-p $port -k $dir' -l $dir/log start >/dev/null"
  sleep 2
fi
P="psql -h $dir -p $port -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists hmconv" -c "create database hmconv"
$P -d hmconv -f "$here/homatch_leads_fixture.sql"
$P -d hmconv -f "$here/property_conversations_fixture.sql"
$P -d hmconv -1 -f "$root/supabase/migrations/20261027090000_homatch_leads_marketplace.sql"
M="$root/supabase/migrations/20261027100000_property_conversations.sql"
$P -d hmconv -1 -f "$M"
$P -d hmconv -1 -f "$M"
$P -d hmconv -f "$here/property_conversations.sql"
echo "property_conversations: all checks passed"
