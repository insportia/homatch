# Verify V1 stabilisation — coordinated release plan

PR: insportia/homatch#285 (draft). **Nothing below runs without the owner's
explicit approval.**

Rollback targets, re-read 2026-10-23 after merging main (`28ab1db1`) into this branch:
- edge: `refs/deployed/edge` = `8ad47a73`;
- frontend: `refs/deployed/frontend` = `8ad47a73`;
- Railway: deployment `981808a8-5975-4f44-8c17-0bba9f75609a`, built from `8ad47a73`;
- database: the definitions the two migrations replace, captured from
  production in `VERIFY_V1_ROLLBACK_SQL.sql`.

Re-read all of them immediately before release.

## What ships

| Runtime | Change | How it deploys |
|---|---|---|
| Postgres | `20261120090000_verify_background_job_terminal_stage.sql`: `create or replace background_job_finish`, same signature, same grants (service_role only) | applied **before merge**, exact file content (see order below) |
| Postgres | `20261120090100_verify_cogs_attribution.sql`: replaces 3 views (existing columns kept in order, new ones appended) and `verify_cogs_job` (EXECUTE no longer granted to anon) | applied right after the first, same session |
| Edge | `jobs-worker`, `research-agent`, `verify-synthesis` | `deploy.yml` on merge to main, scoped from `refs/deployed/edge` |
| Railway | `homatch-official-worker`, the canonical service only | Railway Git auto-deploy on main (watch path `official-worker/`) |
| Vercel | frontend (gallery empty state, location notes, admin COGS breakdown, job progress) | Vercel Git deploy on main |

CI plans this PR as **REPO_FULL** (it now carries a workflow change). The
release engine also lists a `tests` "function", because of the test file under
`supabase/functions/tests/`. That file is not a deployable function; confirm
the deploy skips it.

### Order and compatibility

**Migrations go first.** `main` now runs a fail-closed migration gate
(`scripts/release/migration-gate.mjs`, Finance V2.1): the edge deploy on merge
is refused unless every repository migration is already in the production
ledger. From `20261119140000` on, the applied SQL must also equal the committed
file exactly. So the order is:

1. Apply `20261120090000`, then `20261120090100`, with their exact file
   content, via the reviewed apply path. Production code at that moment is
   `8ad47a73`, which is the "new SQL + old code" pairing below.
2. Merge. Edge (the gate now passes), Railway and Vercel deploy.

Every pairing was checked to tolerate the other side at its old version:

| Pairing | Why it is safe |
|---|---|
| New edge code + old SQL | jobs-worker calls the existing `background_job_progress` and `background_job_finish`. The `VERIFY_REPORT` cost row needs no schema change. The old views simply keep their old figures until the migration runs. |
| New SQL + old edge code | `background_job_finish` keeps its signature, and only VERIFY rows gain a terminal stage. The views keep every existing column and position. |
| New worker + old edge code (or the reverse) | New result fields are additive (`sourceOutcome`, `frameUrls`, `sourceTiles`, `rsVerification.shape`), and the readers treat them as optional. The Verify market request carries its own `pageCap`; an old research-agent simply gets no city-wide fallback. |
| In-flight jobs at deploy time | No report-logic version bump (`REPORT_LOGIC_VERSION` stays 8), so stored reports are not rebuilt and no new AI spend happens on read. A job already in progress finishes on the new edge code; its stored `result_json` shape is read by the same tolerant readers. |
| Customer billing | `verify_job_cost` prices `costUsage` (unchanged) and non-OPENAI `cost_events` only. The new `VERIFY_REPORT` row is OPENAI, so it is not counted. The pricing formula is unchanged. |

## Steps (each needs a go)

1. **Migrations** (before merge), in version order with exact file content.
   Then prove both are in the ledger, and check grants with read-only SQL:
   - `background_job_finish`: service_role only;
   - `verify_cogs_job`: authenticated and service_role, not anon;
   - the 3 views: service_role only.

   Spot-check one running and one finished Verify job: the background job
   still advances, and the admin COGS page still loads.
2. **Mark ready and merge** after `PR Checks` (REPO_FULL) is green. Edge,
   Railway and Vercel deploy.
3. **Proof**, as owed by the release engine:
   - the migration gate passed in the deploy run;
   - PROVEN_EXACT for `jobs-worker`, `research-agent` and `verify-synthesis`;
   - Vercel READY at the merge commit, aliased to www.homatch.live, and the
     served entry asset belongs to that commit;
   - Railway deployment SUCCESS for the merge commit, `/health` OK, and logs
     clean for 10 minutes.
4. **Live verification**: paid, roughly $1–2 in total, and only with approval
   (see below).
5. **Watch for 24 h**, using read-only SQL and Railway logs:
   - the `verify_tasks` outcome mix;
   - the `rstax_captcha` outcomes;
   - the Nominatim status in the `verify_neighborhood` logs;
   - `background_jobs` rows that are COMPLETED but not COMPLETE (0 expected
     from new jobs on);
   - Find Property marketplace runs (MyHome cooldowns, SS.ge BLOCKED).

## Post-deploy live verification (paid, approval needed)

| # | Job | Pass when |
|---|---|---|
| L1 | Verify `01.14.07.001.044` (the reference) | **Job state:** the background job goes PROCESSING → REPORT_WRITING → COMPLETED / COMPLETE, and only after `synthesis_state='READY'`. **RS.ge:** tasks for 405537441 and 405456359 end SUCCEEDED with `taxpayerData` (name, legal form, status, VAT), and their 2Captcha events read ACCEPTED. **MyGov:** RETRIEVED, or PARTIAL with its documents kept and `officialVerificationComplete=false`. **Visuals:** usable stitched pictures with `PDF_TILES_STITCHED` provenance. **Location:** centre is GEOCODED_ADDRESS, HOUSE precision, with `DRAWING_SET_ASIDE` and the drawing kept as a flagged candidate. **Market:** INSUFFICIENT_DATA, with no apartment comparables. **Costs:** `verify_job_cogs` shows ai / web search / captcha / apify / total. **Customer charge:** `verify_billing` settles on the unchanged formula. |
| L2 | Verify `01.18.06.019.055.03.01.601` (Krtsanisi apartment) | **Market:** the worker log shows at most 2 pages per portal and a კრწანისი district search, and the report has a RANGE built from same-district, ±35% size listings. **Location:** distances are measured from a validated centre. |
| L3 | Find Property search on MyHome / SS.ge (existing user flow, test account) | It completes as before. Its worker request carries the Find Property defaults (no Verify `pageCap`). |

If any L-check fails, roll back the affected runtime (below), then diagnose.

## Rollback

| Runtime | Action | Time |
|---|---|---|
| Vercel | Promote the previous production deployment (currently `8ad47a73`) | about 1 min |
| Railway | Roll back to deployment `981808a8-5975-4f44-8c17-0bba9f75609a` (current at 2026-10-23) | about 2 min |
| Edge | Revert the merge commit on main. `deploy.yml` redeploys the 3 functions from the reverted tree, and `refs/deployed/edge` advances only after proof. The two migrations stay in the ledger, so the gate still passes. | about 10 min |
| Postgres | Usually not needed: old code works with the new SQL. If needed, a NEW forward migration built from `VERIFY_V1_ROLLBACK_SQL.sql` (the current production definitions of the 3 views, `verify_cogs_job` and `background_job_finish`, with their grants). Append-only, no data loss; no historical rows were changed. | about 5 min |

Data written during the window stays valid under V1:
- terminal stages on new VERIFY `background_jobs` rows;
- `VERIFY_REPORT` cost rows;
- new task-result fields;
- `areaRejected`, `locality` and `centerIssue` fields.

Old readers ignore all of these.

## Not covered before release (stated, not hidden)

- **SQL tests:** run on PGlite (real Postgres in WebAssembly, one connection).
  Twenty repeated finishes are proven idempotent. True lock contention is not
  proven here; the row lock comes from the existing `for update` in the
  function.
- **COGS migration:** validated read-only against production (the view
  bodies run as plain SELECTs, and column order was checked). It was not
  executed as DDL anywhere.
- **No live run of any runtime.** Everything is unit, fixture, replay and
  read-only production checks. L1–L3 are the live proof.
