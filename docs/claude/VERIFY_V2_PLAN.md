# Verify V2 — architecture plan (V1/V2 coexistence)

Status: **PLAN ONLY.** Nothing here is built or enabled yet. V1 stays the
production default until every gate in §7 is green.

Baseline: `docs/claude/VERIFY_V2_AUDIT.md`.

## 1. Engine selection

V2 copies the pattern that already works for `verify_execution_mode` and
`verify_tas_implementation` (RA:1907-1937).

**The setting.** `admin_settings.verify_engine`:

```json
{"active": "V1" | "V2", "shadow": false, "shadowSample": 0}
```

- If the value is missing or malformed, the engine is `V1`.
- A new migration seeds `{"active":"V1","shadow":false,"shadowSample":0}`.

**Read once, at job creation (RA:7850).**
- The engine is stamped onto the job in two places:
  - `research_jobs.result_json._engine = {version, selectedAt, settingVersion}`, the same way `_reusePlan` and `_lang` are stamped;
  - a new nullable column `research_jobs.engine_version text`, so admin and COGS queries can filter on it. The migration adds the column and does no backfill. A null value reads as `V1`.
- Every later step (`advance`, `finish`, verify-synthesis, the queue planner) reads the stamp. None of them reads the live setting.
- So **a running job cannot switch engines**, and a switch only affects jobs created after it. This is the same guarantee `verify_execution_mode` gives today.

**Writing the setting.**
- A new SECURITY DEFINER RPC, `verify_engine_set(p_value jsonb, p_expected_updated_at timestamptz, p_reason text)`:
  - checks `is_admin`;
  - does compare-and-set on `updated_at`;
  - inserts into `admin_audit_log` (actor, before, after, reason);
  - follows the `service_control_set` model.
- No other write path exists: `admin_settings` RLS is already admin-or-service.

**Admin UI.** One card on the existing Admin service-control page
(`src/pages/admin/AdminServiceControlPage.tsx`):
- a two-option radio, "V1 — Original" / "V2 — Code-First";
- a confirm dialog and a reason field;
- the last 10 audit entries.

There is no new shell or route. The Admin shell is a protected surface.

**Separate feature flags.** V2 sub-features get their own keys, so each one
can be rolled back on its own while the engine stays V2:
- `verify_v2_market`, `verify_v2_location`, `verify_v2_identity`, `verify_v2_public`;
- each is read once at job creation and stamped onto the job;
- each defaults to `V1` behaviour inside a V2 job.

## 2. Code organisation

- V1 code paths are **not edited** for V2. V2 lives in:
  - `src/verify/v2/` (deterministic assembly, shared by the frontend and the edge functions);
  - `supabase/functions/research-agent/v2/` (stage drivers);
  - `official-worker/src/verify-market/` (market adapters owned by Verify).
- The dispatch point is a single branch inside `advance()`: `job.engine === 'V2' ? advanceV2 : advanceV1`. The body of `advanceV1` is the current code, moved without edits. A matrix test pins its source hash, so any accidental V1 change fails CI.
- Both engines write the same `result_json` and `synthesis_json` contract. A contract test validates both against one schema (`src/verify/v2/contract.ts`), which is derived from the fields the frontend reads today.
- verify-synthesis (luna, the report writer) is shared and unchanged. V2 adds an input adapter and output validation (§5).
- The RA terra SYNTHESIS stage is replaced in V2 by deterministic `result_json` assembly (decision D1).

## 3. Rollback

| Level | Action | Effect | Time |
|---|---|---|---|
| Runtime (primary) | Admin selects V1 | New jobs use V1. In-flight V2 jobs finish on V2. | seconds |
| Sub-feature | Set `verify_v2_<x>` back to V1 | One lane falls back inside V2 | seconds |
| Emergency deploy | Redeploy `verify-v1-baseline` (`0f9d8673`) to edge + frontend, and Railway deployment `ea66417e…` | The whole system returns to V1 code. The new nullable columns and settings are ignored by old code. | minutes |

All V2 migrations are additive: new columns, settings and views. No V1 table is
rewritten, so rolling the code back never needs a schema rollback.

**Proving rollback.**
- A V2 → V1 → V2 switch test in staging that checks:
  - each new job's `engine_version`;
  - that the V1 job's stage history and cost rows match the V1 shape;
  - one audit row per switch.
- The same drill is repeated once in production with a cheap job, after approval.

## 4. Shadow comparison

- `shadow: true` with `shadowSample: N` runs the **deterministic V2 lanes only** next to a V1 job:
  - the V2 lanes reuse V1's official task results and marketplace rows, so there is no second paid collection;
  - a second synthesis is **not** called by default;
  - the shadow output goes to a new table, `verify_shadow_runs` (job_id, engine, lane, output jsonb, metrics jsonb, created_at). It is never written to `result_json`.
- Offline replay is the cheapest option: `scripts/verify/replay-v2.mjs <jobId…>`.
  - It reads stored V1 inputs (task results, ledgers, stored marketplace rows) and runs V2 assembly locally.
  - It writes a diff report.
  - Most comparisons need no new collection at all.
- A paid shadow set (a full V2 run including its own synthesis) is agreed in advance:
  - about 12 properties across the §14 matrix (apartments in several districts and price bands, new-build, old stock, land, development project, weak registry, captcha-heavy, with and without images, all six languages);
  - spend is capped per run.

## 5. Quality evaluation

For each property, V1 and V2 are compared on these dimensions:

| Dimension | Method | Gate |
|---|---|---|
| Official facts (cadastral, area, owners where lawful, encumbrances, documents) | Field-by-field equality on normalised values | Exact, when the source data is identical |
| Source outcomes | Same taxonomy (from the V1 source-status fix) | Exact |
| Market | Eligible comparables, median price per m², range, sample size, confidence | Median within ±7.5%, range overlap ≥ 70%, and every difference explained by an eligibility rule. Otherwise investigate by hand. |
| Location | Centre within 50 m; measured POI set overlap | ≥ 90% of POIs in the same category within 300 m |
| Report | Required sections present; every citation resolves to evidence; numbers in the text equal the deterministic numbers; no "verified" claim for a non-retrieved source | 100%, enforced by automated validators in verify-synthesis output validation |
| Narrative depth | Evidence-backed coverage checklist per section (not text similarity) | No section loses checklist items |
| Visuals | Categories and count of usable images | No loss |

A failed gate keeps V1 as the default for that lane. A lane can stay on V1
inside V2 through its sub-feature flag.

## 6. COGS comparison

- The comparison is only valid once the V1 COGS fix lands:
  - the corrected `verify_job_cogs` with per-provider columns;
  - the report-writer cost row.
- V2 jobs carry `engine_version`, and the comparison view groups by it:
  - AI (per stage, per model)
  - web search
  - 2Captcha
  - APIFY
  - and, where it can be measured, worker time.
- Baseline is **V1 ≈ $0.95 per job** (corrected), not $0.771.
- Customer charges stay a separate figure and do not change with the engine.

## 7. Screenshot testing for `/verify/:id`

No harness exists yet. This plan adds one: `tests/browser/verifyReport.qa.mjs`.

**Fixtures.**
- Frozen `synthesis_json` and `result_json` snapshots, with personal data stripped:
  - the reference job;
  - two apartment jobs;
  - one land job;
  - one job with no visuals.
- They are served by the existing harness stub (`.env.harness`, `npm run build:harness`).

**Matrix.**
- Widths 375 / 768 / 1280 / 1440.
- Locales KA / EN / RU / AR / HE / TR, with AR/HE in RTL.
- Contexts use `reducedMotion: 'reduce'`.

**Checks.**
- Per-chapter screenshots are diffed against baselines taken from the V1 render of the same fixture (pixel-diff threshold 0.1%).
- Plus DOM assertions:
  - the chapters render;
  - the gallery shows either images or the truthful empty-state text;
  - the market shows either a range or EVIDENCE_LIMITED;
  - measured distances appear only when a centre exists.

**V1/V2 parity.** The same fixture data rendered under V1 and V2 must be
pixel-identical. When the evidence differs, the differences must be limited to
the expected sections.

## 8. Release gates (all required before V2 becomes the default)

1. The V1 stabilisation fixes are deployed, and production is proven on new jobs.
2. The V2 contract test is green, and the V1 source-hash pin is unchanged.
3. Offline replay passes on at least 30 historical jobs with no unexplained regression.
4. The paid shadow set passes §5.
5. The screenshot suite is green for V1 and V2 fixtures.
6. The rollback drill passes in staging, and later in production.
7. COGS for V2 is measured with the corrected view, and coverage is not reduced.
