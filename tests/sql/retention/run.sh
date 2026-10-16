#!/usr/bin/env bash
# Retention lifecycle tests on a THROWAWAY local Postgres 16 — never
# production, no network, no providers. Applies the real migration (twice, to
# prove it re-runs) on stand-in fixtures, then runs tests.sql.
# Usage: tests/sql/retention/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../../.."
dir="${RETENTION_PG_DIR:-/var/tmp/hm-retention}"; port="${RETENTION_PG_PORT:-54332}"; bin="${PGBIN:-/usr/lib/postgresql/16/bin}"
M="$root/supabase/migrations/20261102090000_storage_retention_lifecycle.sql"
M2="$root/supabase/migrations/20261105090000_storage_retention_artifacts.sql"

if ! psql -h "$dir" -p "$port" -U postgres -tAc 'select 1' >/dev/null 2>&1; then
  rm -rf "$dir"; mkdir -p "$dir"; chown postgres "$dir" 2>/dev/null || true
  su postgres -c "$bin/initdb -D $dir/data -A trust >/dev/null && $bin/pg_ctl -D $dir/data -o \"-p $port -k $dir\" -l $dir/log start >/dev/null"
  sleep 2
fi
P="env PGOPTIONS=-cclient_min_messages=warning psql -h $dir -p $port -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists hmret" -c "create database hmret"
$P -d hmret -f "$here/fixture.sql"
$P -d hmret -1 -f "$M"
$P -d hmret -1 -f "$M"
env PGOPTIONS=-cclient_min_messages=notice psql -h "$dir" -p "$port" -U postgres -d hmret -v ON_ERROR_STOP=1 -q -o /dev/null -f "$here/tests.sql" 2>&1 \
  | sed -e 's/^psql:[^:]*:[0-9]*: NOTICE:  /  /' -e 's/^NOTICE:  /  /'

# ── Real concurrency: four sessions claim at once, each holding its
#    transaction open; no record may be handed to two workers.
Q="psql -h $dir -p $port -U postgres -d hmret -tA -v ON_ERROR_STOP=1 -q"
$Q -c "update public.admin_settings set value = value || '{\"purge_enabled\": true, \"effective_at\": \"2000-01-01T00:00:00Z\"}'::jsonb where key = 'storage_retention';
  insert into public.deal_rooms (id, user_id) values ('29999999-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000000a');
  insert into public.deal_room_documents (deal_room_id, user_id, doc_key, label, analysis, analysis_state, analyzed_at, uploaded_at)
    select '29999999-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000000a', 'upload:c' || g, 'x', '{}', 'DONE',
           now() - interval '40 days', now() - interval '40 days' from generate_series(1, 24) g;
  select public.retention_register_due(100);" >/dev/null
out="$dir/claims"; rm -f "$out".*
for w in 1 2 3 4; do
  ( $Q -c "begin; select string_agg(record_id::text, E'\n') from public.retention_claim(10); select pg_sleep(1); commit;" > "$out.$w" ) &
done
wait
total=$(cat "$out".* | grep -c . || true); distinct=$(cat "$out".* | grep . | sort -u | wc -l)
echo "  concurrency: 4 workers claimed $total records, $distinct distinct"
[ "$total" -eq "$distinct" ] && [ "$total" -ge 24 ] || { echo "  FAIL: duplicate or missing claims"; exit 1; }
echo "RETENTION CONCURRENCY: PASS"

# ── Object-level retention (20261105090000), applied twice on top. ──
$P -d hmret -1 -f "$M2"
$P -d hmret -1 -f "$M2"
env PGOPTIONS=-cclient_min_messages=notice psql -h "$dir" -p "$port" -U postgres -d hmret -v ON_ERROR_STOP=1 -q -o /dev/null -f "$here/artifacts.sql" 2>&1 \
  | sed -e 's/^psql:[^:]*:[0-9]*: NOTICE:  /  /' -e 's/^NOTICE:  /  /'
echo "RETENTION ARTIFACTS SQL: PASS"

# Four sessions claim artifacts at once; none may be handed to two workers.
$Q -c "insert into public.retention_artifacts (category, provider, bucket, object_key, byte_size, object_created_at, expires_at)
  select 'verify_document_cache', 'SUPABASE_STORAGE', 'verify-documents', 'files/77' || g || '.pdf', 1, now() - interval '31 days', now() - interval '1 day'
    from generate_series(1, 24) g;" >/dev/null
rm -f "$out".*
for w in 1 2 3 4; do
  ( $Q -c "begin; select string_agg(artifact_id::text, E'\\n') from public.retention_artifacts_claim(10); select pg_sleep(1); commit;" > "$out.$w" ) &
done
wait
total=$(cat "$out".* | grep -c . || true); distinct=$(cat "$out".* | grep . | sort -u | wc -l)
echo "  artifact concurrency: 4 workers claimed $total artifacts, $distinct distinct"
[ "$total" -eq "$distinct" ] && [ "$total" -ge 24 ] || { echo "  FAIL: duplicate or missing artifact claims"; exit 1; }

# An API caller (session_user authenticator) who is not an admin is refused.
$Q -c "alter role authenticator login; grant authenticated to authenticator;" >/dev/null
r=$(psql -h "$dir" -p "$port" -U authenticator -d hmret -tA -q -c "set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-00000000000a'; select public.retention_artifacts_status();" 2>&1 || true)
echo "$r" | grep -q "forbidden" || { echo "  FAIL: a non-admin API caller reached the admin status: $r"; exit 1; }
r=$(psql -h "$dir" -p "$port" -U authenticator -d hmret -tA -q -c "set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-00000000000a'; select public.retention_category_set('verify_document_cache', true);" 2>&1 || true)
echo "$r" | grep -q "forbidden" || { echo "  FAIL: a non-admin API caller changed a category: $r"; exit 1; }
r=$(psql -h "$dir" -p "$port" -U authenticator -d hmret -tA -q -c "set role authenticated; set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-00000000000c'; select (public.retention_artifacts_status() ? 'categories');" 2>&1 || true)
[ "$r" = "t" ] || { echo "  FAIL: an admin API caller could not read the status: $r"; exit 1; }
echo "  ok  API callers: non-admin refused, admin served"
echo "RETENTION ARTIFACTS CONCURRENCY: PASS"
