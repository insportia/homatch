# Verify V1 stabilisation — coordinated release plan

PR: insportia/homatch#285 (draft). **Nothing below runs without the owner's
explicit approval.**

Rollback targets, re-read 2026-10-23 after merging main into this branch:
- edge: `refs/deployed/edge` = `0f9d8673`;
- frontend: `refs/deployed/frontend` = `dc0e87f1`;
- Railway: deployment `981808a8-5975-4f44-8c17-0bba9f75609a`, built from `8ad47a73`.

Re-read all three immediately before release.

## What ships

| Runtime | Change | How it deploys |
|---|---|---|
| Postgres | `20261120090000_verify_background_job_terminal_stage.sql`: `create or replace background_job_finish`, same signature, same grants (service_role only) | `deploy.yml` workflow_dispatch with `run_migrations`, after merge |
| Postgres | `20261120090100_verify_cogs_attribution.sql`: replaces 3 views (existing columns kept in order, new ones appended) and `verify_cogs_job` (EXECUTE no longer granted to anon) | same dispatch, same run |
| Edge | `jobs-worker`, `research-agent`, `verify-synthesis` | `deploy.yml` on merge to main, scoped from `refs/deployed/edge` |
| Railway | `homatch-official-worker`, the canonical service only | Railway Git auto-deploy on main (watch path `official-worker/`) |
| Vercel | frontend (gallery empty state, location notes, admin COGS breakdown, job progress) | Vercel Git deploy on main |

The release engine plans the tier as **COMPONENT_FULL**, because the COGS
migration changes access control. It also lists a `tests` "function", because
of the test file under `supabase/functions/tests/`. That file is not a
deployable function; confirm the engine skips it.

### Order and compatibility

Merging deploys edge, Railway and Vercel together. Migrations follow in a
separate dispatch. Every pairing was checked to tolerate the other side at
its old version:

| Pairing | Why it is safe |
|---|---|
| New edge code + old SQL | jobs-worker calls the existing `background_job_progress` and `background_job_finish`. The `VERIFY_REPORT` cost row needs no schema change. The old views simply keep their old figures until the migration runs. |
| New SQL + old edge code | `background_job_finish` keeps its signature, and only VERIFY rows gain a terminal stage. The views keep every existing column and position. |
| New worker + old edge code (or the reverse) | New result fields are additive (`sourceOutcome`, `frameUrls`, `sourceTiles`, `rsVerification.shape`), and the readers treat them as optional. The Verify market request carries its own `pageCap`; an old research-agent simply gets no city-wide fallback. |
| In-flight jobs at deploy time | No report-logic version bump (`REPORT_LOGIC_VERSION` stays 8), so stored reports are not rebuilt and no new AI spend happens on read. A job already in progress finishes on the new edge code; its stored `result_json` shape is read by the same tolerant readers. |
| Customer billing | `verify_job_cost` prices `costUsage` (unchanged) and non-OPENAI `cost_events` only. The new `VERIFY_REPORT` row is OPENAI, so it is not counted. The pricing formula is unchanged. |

## Steps (each needs a go)

1. **Mark ready and merge** after `PR Checks` (COMPONENT_FULL) is green. Edge,
   Railway and Vercel deploy.
2. **Proof**, as owed by the release engine:
   - PROVEN_EXACT for `jobs-worker`, `research-agent` and `verify-synthesis`;
   - Vercel READY at the merge commit, aliased to www.homatch.live, and the
     served entry asset belongs to that commit;
   - Railway deployment SUCCESS for the merge commit, `/health` OK, and logs
     clean for 10 minutes.
3. **Migrations**: `deploy.yml` workflow_dispatch with `run_migrations=true`.
   Then prove both files are in the ledger, and check grants with read-only
   SQL:
   - `background_job_finish`: service_role only;
   - `verify_cogs_job`: authenticated and service_role, not anon;
   - the 3 views: service_role only.
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
| Vercel | Promote the previous production deployment (currently `dc0e87f1`) | about 1 min |
| Railway | Roll back to deployment `981808a8-5975-4f44-8c17-0bba9f75609a` (current at 2026-10-23) | about 2 min |
| Edge | Revert the merge commit on main. `deploy.yml` redeploys the 3 functions from the reverted tree, and `refs/deployed/edge` advances only after proof. | about 10 min |
| Postgres | Usually not needed: old code works with the new SQL. If needed, a forward migration restores the previous `background_job_finish` body (from `20260911211715`) and the previous 3 view and function definitions (from `20261026100000` / `20260911203629`). This is append-only, with no data loss, and no historical rows were ever changed. | about 5 min |

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
