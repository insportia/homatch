#!/usr/bin/env bash
# Migration safety for 20261108090000 on a THROWAWAY Postgres whose publishing objects
# are byte-identical to production (function md5s checked against production
# pg_get_functiondef on 2026-10-16): apply once, refuse a second apply atomically,
# then roll back and prove every fingerprint equals the pre-migration state.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../../.."
dir="${PUBLISHING_PG_DIR:-/var/tmp/hm-publishing}"; port="${PUBLISHING_PG_PORT:-54333}"
P="env PGOPTIONS=-cclient_min_messages=warning psql -h $dir -p $port -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists hmrollback" -c "create database hmrollback"
$P -d hmrollback -f "$here/fixture.sql" >/dev/null
for m in 20261014074630_publishing_engine 20261014140000_publishing_engine_ssge 20261103090000_publishing_workspace 20261106090000_publishing_providers; do
  $P -d hmrollback -1 -f "$root/supabase/migrations/$m.sql" >/dev/null
done
FP="select string_agg(x, E'\n' order by x) from (
  select 'fn '||p.proname||' '||md5(pg_get_functiondef(p.oid)) x from pg_proc p where pronamespace='public'::regnamespace and proname like 'publishing%'
  union all select 'con '||conname||' '||md5(pg_get_constraintdef(oid)) from pg_constraint where conrelid='public.publishing_engine_jobs'::regclass
  union all select 'col '||column_name||' '||data_type from information_schema.columns where table_schema='public' and table_name='publishing_engine_jobs'
  union all select 'tbl '||relname from pg_class where relnamespace='public'::regnamespace and relname like 'publishing%' and relkind='r'
  union all select 'grant '||grantee||' '||privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='publishing_engine_jobs'
  union all select 'bucket '||id from storage.buckets where id like 'publishing%') f"
before=$($P -d hmrollback -tAc "$FP")
# Production's four publishing functions, as measured on 2026-10-16.
for want in "publishing_listing_lifecycle af30b2311fb4042132c6e6edb8187957" "publishing_listing_save 4549f7d29e0f8e954b3ce41027689ebf" "publishing_provider_update a6f275441b1ead020b8625c956ccfbec" "publishing_publication_write 8a22482729f98f7eecc7833275332d6b"; do
  grep -q "fn $want" <<<"$before" || { echo "FAIL  pre-migration state differs from production: $want"; exit 1; }
done
echo "  PASS  pre-migration functions byte-identical to production"
# One existing v1 publication, as production will have one after any v1 use.
$P -d hmrollback -c "insert into public.publishing_engine_listings(id,user_id,version,payload) values ('11111111-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a',1,'{}')" \
  -c "insert into public.publishing_engine_jobs(id,listing_id,user_id,portal_id,status,payload) values (gen_random_uuid(),'11111111-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','myhome','PUBLISHED','{}')"
before=$($P -d hmrollback -tAc "$FP")
$P -d hmrollback -1 -f "$root/supabase/migrations/20261108090000_publishing_central_accounts.sql" >/dev/null
echo "  PASS  migration applies in one transaction"
$P -d hmrollback -tAc "select status||' '||channel from public.publishing_engine_jobs" | grep -qx "PUBLISHED OWNER_HANDOFF" && echo "  PASS  an existing publication keeps its status and is an owner handoff" || { echo "FAIL  existing publication changed"; exit 1; }
after=$($P -d hmrollback -tAc "$FP")
if $P -d hmrollback -1 -f "$root/supabase/migrations/20261108090000_publishing_central_accounts.sql" >/dev/null 2>&1; then echo "FAIL  a second apply succeeded"; exit 1; fi
[ "$($P -d hmrollback -tAc "$FP")" = "$after" ] && echo "  PASS  a second apply is refused and changes nothing (atomic)"
$P -d hmrollback -f "$root/docs/publishing/rollback-20261108090000.sql" >/dev/null
[ "$($P -d hmrollback -tAc "$FP")" = "$before" ] && echo "  PASS  rollback restores every pre-migration fingerprint" || { echo "FAIL  rollback differs"; diff <(echo "$before") <($P -d hmrollback -tAc "$FP"); exit 1; }
$P -d hmrollback -tAc "select count(*) from public.publishing_engine_jobs" | grep -qx 1 && echo "  PASS  the existing publication survives the rollback" || { echo "FAIL  publication lost"; exit 1; }
echo 'publishing central accounts migration safety: PASS'
