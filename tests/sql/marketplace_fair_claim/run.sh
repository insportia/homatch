#!/usr/bin/env bash
# Fair claim proof for claim_marketplace_worker_runs on a THROWAWAY local Postgres 16 — never production.
# Runs the same scenarios against the original definition (20261010100000) and the fair one
# (20261114110000): one requester stays FIFO, caps and lease rules are unchanged, a burst no longer
# queues other requesters behind it, and nothing claimable is ever refused.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../../.."
dir="${FAIRCLAIM_PG_DIR:-/var/tmp/hm-fairclaim}"; port="${FAIRCLAIM_PG_PORT:-54341}"; bin="${PGBIN:-/usr/lib/postgresql/16/bin}"
if ! psql -h "$dir" -p "$port" -U postgres -tAc 'select 1' >/dev/null 2>&1; then
  rm -rf "$dir"; mkdir -p "$dir"; chown postgres "$dir" 2>/dev/null || true
  su postgres -c "$bin/initdb -D $dir/data -A trust >/dev/null && $bin/pg_ctl -D $dir/data -o \"-p $port -k $dir\" -l $dir/log start >/dev/null"
  sleep 2
fi
P="env PGOPTIONS=-cclient_min_messages=warning psql -h $dir -p $port -U postgres -v ON_ERROR_STOP=1 -q"
old_def="$(sed -n '/^create or replace function public.claim_marketplace_worker_runs(/,/^\$function\$;/p' "$root/supabase/migrations/20261010100000_marketplace_search_foundation.sql")"
for variant in old new; do
  $P -c "drop database if exists hmfair" -c "create database hmfair" >/dev/null 2>&1 || true
  $P -c "drop role if exists anon" -c "drop role if exists authenticated" -c "drop role if exists service_role" >/dev/null 2>&1 || true
  $P -d hmfair -f "$here/fixture.sql"
  if [ "$variant" = old ]; then printf '%s\n' "$old_def" | $P -d hmfair -1
  else $P -d hmfair -1 -f "$root/supabase/migrations/20261114110000_marketplace_fair_claim.sql"
       $P -d hmfair -1 -f "$root/supabase/migrations/20261114110000_marketplace_fair_claim.sql"; echo "  PASS  migration re-applies cleanly"; fi
  env PGOPTIONS=-cclient_min_messages=notice psql -h "$dir" -p "$port" -U postgres -d hmfair -v ON_ERROR_STOP=1 -v variant="$variant" -q -o /dev/null -f "$here/tests.sql" 2>&1 \
    | sed -e 's/^psql:[^:]*:[0-9]*: NOTICE:  /  /' -e 's/^NOTICE:  /  /'
  test "${PIPESTATUS[0]}" = 0
done
echo 'marketplace fair claim proof: PASS'
