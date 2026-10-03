#!/usr/bin/env bash
# Apply the property owner lifecycle migration TWICE to a throwaway Postgres
# built from property_lifecycle_fixture.sql (with one legacy property created
# before it), then run the behavioural checks. Needs Postgres 16 binaries.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
dir="${PGFIX_DIR:-/var/tmp/hm-pg}"; port="${PGFIX_PORT:-54329}"; bin="${PGBIN:-/usr/lib/postgresql/16/bin}"
if ! psql -h "$dir" -p "$port" -U postgres -tAc 'select 1' >/dev/null 2>&1; then
  rm -rf "$dir"; mkdir -p "$dir"; chown postgres "$dir" 2>/dev/null || true
  su postgres -c "$bin/initdb -D $dir/data -A trust >/dev/null && $bin/pg_ctl -D $dir/data -o '-p $port -k $dir' -l $dir/log start >/dev/null"
  sleep 2
fi
P="psql -h $dir -p $port -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists plfx" -c "create database plfx"
$P -d plfx -f "$here/property_lifecycle_fixture.sql"
# A property that existed before the migration (the production shape today).
$P -d plfx -c "insert into public.users (id, auth_id) values ('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-0000000000c3');
  insert into public.properties (id, user_id, source_type, title, matching_status, created_at)
    values ('00000000-0000-0000-0000-00000000c0de', '00000000-0000-0000-0000-0000000000c3', 'URL_IMPORT', 'legacy', 'PAUSED', now() - interval '36 days');
  insert into public.property_facts (property_id, source_url) values ('00000000-0000-0000-0000-00000000c0de', 'https://www.myhome.ge/ka/legacy/');"
M="$root/supabase/migrations/20261011100000_property_owner_lifecycle.sql"
$P -d plfx -1 -f "$M"
$P -d plfx -1 -f "$M"
$P -d plfx -f "$here/property_lifecycle.sql"
