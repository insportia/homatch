#!/bin/bash
# CLEAN-REBUILD REPLAY: every repository migration, in order, into an empty
# local PostgreSQL database, each in its own transaction.
#
#   PGHOST=/path/to/socket PGPORT=55432 scripts/claude/replay-migrations.sh [dbname]
#
# Ordering rule: filename order, except the eight legacy 000xx_ files, which run
# at their chronological place (immediately before 20260829130000) -- filename
# order would run them before the schema they alter exists.
#
# Gaps where production objects were created by hand and declared by a later
# migration are filled by supabase/replay/before/<version>.sql, run just
# before that migration. Applied migrations are never edited.
#
# STATUS (2026-09-30): the replay reaches 20260829180000 and stops there. That
# migration renames columns of outreach tables that were built in production
# by hand in August and were never declared by any migration; reconstructing
# them would mean inventing their shape. Recorded in docs/claude/KNOWN_RISKS.md.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
M="$ROOT/supabase/migrations"
DB="${1:-homatch_replay}"
PSQL="psql -X -q -U ${PGUSER:-postgres}"
$PSQL -d postgres -c "drop database if exists $DB" >/dev/null 2>&1
$PSQL -d postgres -c "create database $DB" >/dev/null || { echo "cannot create $DB"; exit 2; }
$PSQL -d "$DB" -v ON_ERROR_STOP=1 -f "$ROOT/supabase/replay/platform-bootstrap.sql" >/dev/null 2>&1 || { echo BOOTSTRAP_FAILED; exit 2; }
order() {
  for f in $(ls "$M"/*.sql | grep -v "/000[0-9][0-9]_"); do
    [[ "$(basename "$f")" == 20260829130000_* ]] && ls "$M"/000[0-9][0-9]_*.sql
    echo "$f"
  done
}
n=0
for f in $(order); do
  n=$((n+1)); v="$(basename "$f" | cut -d_ -f1)"
  pre="$ROOT/supabase/replay/before/$v.sql"
  if [ -f "$pre" ]; then
    out=$($PSQL -d "$DB" -v ON_ERROR_STOP=1 --single-transaction -f "$pre" 2>&1 >/dev/null) \
      || { echo "FAIL fragment before $v"; echo "$out" | grep ERROR | head -3; exit 1; }
  fi
  out=$($PSQL -d "$DB" -v ON_ERROR_STOP=1 --single-transaction -f "$f" 2>&1 >/dev/null) \
    || { echo "STOPPED at #$n $(basename "$f")"; echo "$out" | grep -E "ERROR" | head -3; exit 1; }
done
echo "PASS: all $n migrations replayed"
