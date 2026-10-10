#!/usr/bin/env bash
# Apply the Email Studio migration TWICE on top of the HOMATCH Leads fixture + migration in a
# throwaway Postgres, then run the behavioural checks. Needs Postgres 16 binaries.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
dir="${PGFIX_DIR:-/var/tmp/hm-pg}"; port="${PGFIX_PORT:-54329}"; bin="${PGBIN:-/usr/lib/postgresql/16/bin}"
if ! psql -h "$dir" -p "$port" -U postgres -tAc 'select 1' >/dev/null 2>&1; then
  rm -rf "$dir"; mkdir -p "$dir"; chown postgres "$dir" 2>/dev/null || true
  su postgres -c "$bin/initdb -D $dir/data -A trust >/dev/null && $bin/pg_ctl -D $dir/data -o '-p $port -k $dir' -l $dir/log start >/dev/null"
  sleep 2
fi
P="psql -h $dir -p $port -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists hmstudio" -c "create database hmstudio"
$P -d hmstudio -f "$here/homatch_leads_fixture.sql"
$P -d hmstudio -1 -f "$root/supabase/migrations/20261027090000_homatch_leads_marketplace.sql"
$P -d hmstudio -f "$here/email_studio_fixture.sql"
M="$root/supabase/migrations/20261027110000_email_studio.sql"
$P -d hmstudio -1 -f "$M"
$P -d hmstudio -1 -f "$M"
$P -d hmstudio -f "$here/email_studio.sql"
echo "email_studio: all checks passed"
