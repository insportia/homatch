# Verify V2 — Phase 1 audit (V1 production baseline)

Status: **AUDIT ONLY.** No pipeline code, schema, setting or deployment has
changed. Everything below was read from source at the baseline commit or from
read-only production SQL on 2026-10-22. Agent-derived claims I did not check
myself are marked *(inferred)*.

## 1. V1 baseline

| Item | Value |
|---|---|
| Baseline commit | `0f9d8673ecf6fe776b7fb4eea9be1205ee8aaf2e` (origin/main, 2026-10-19) |
| `refs/deployed/edge` | `0f9d8673…` (same) |
| `refs/deployed/frontend` | `0f9d8673…` (same) |
| Railway `homatch-official-worker` | **no `refs/deployed/*` ref.** The deployed worker SHA must be read from Railway before the V1 tag is cut |
| Immutable tag | not created yet (proposed: `verify-v1-baseline`, pushed and protected) |

## 2. How V1 actually works

Nearly the whole pipeline lives in one file:
`supabase/functions/research-agent/index.ts`, called **RA** below (7,894 lines).

### Job creation and state

1. `src/pages/VerifyPage.tsx` sends `{type:'cadastral', query, clientRequestId}`
   to RA (RA:7765-7893).
2. RA inserts a `research_jobs` row (`status CREATED`, `stage QUEUED`), opens
   billing with `verify_billing_open` (RA:7869), and starts work in
   `advanceExclusive`.
3. The **client** creates the `background_jobs` row itself, through
   `startJobBestEffort`, `VerifyPage.tsx:857` and the RPC
   `background_job_start`.
4. `supabase/functions/jobs-worker/index.ts` `mirror()` is the only writer of
   `background_jobs` for Verify.

Stages run in this order: IDENTITY, then BROWSER (official tasks), then
OFFICIAL_COLLECTION, FINANCIAL_ENTITY, PUBLIC_RESEARCH, MARKET and SYNTHESIS.
Each one is an OpenAI Responses call started by `launch()` (RA:1891), using
the `prompt()` branches at RA:1619-1831 and processed by `finish()` (RA:4245).
`status COMPLETE` is written in one place only (RA:4724).

### There are two "synthesis" steps

| Step | Where | Model | Tools | Output |
|---|---|---|---|---|
| RA `SYNTHESIS` stage | RA:1819, `finish()` RA:4353-4722 | `OPENAI_RESEARCH_MODEL` → **gpt-5.6-terra** (RA:7506) | none | `research_jobs.result_json` |
| Report synthesis | `supabase/functions/verify-synthesis/index.ts:729`, prompt `src/verify/intelligence/prompt.ts`, `finalizeReport` | **gpt-5.6-luna** (`:143-145`) | none | `research_jobs.synthesis_json`, which is what the page renders |

The spec's instruction to "preserve the Synthesis AI" applies cleanly to the
second step only. The first step is a terra call that can be replaced by code.
See decision D1.

### Official collection (QUEUE mode, `admin_settings.verify_execution_mode`)

- `src/verify/queueOfficial.ts` plans these tasks: `TAS_MAP`, `tas`, `mygov`,
  plus `enreg`, `debtor` and `rstax` for each discovered company.
- The tasks go to `verify_tasks`. The Railway worker
  (`official-worker/src/queue/*`) claims them through the `verify-queue` edge
  function. Claims use leases and fencing, and retries follow
  `verify_source_policy`.
- **No official task is ever required.** A FAILED or DEAD task only lowers the
  completeness flags: `dueDiligenceCoverage`, `officialSourcesNotVerified`
  and `requiresManualVerification`.

### Market

The market evidence is already partly deterministic:
- RA calls the worker's `/verify/market` (RA:2362-2459, `official-worker/src/index.ts:234`).
- That endpoint runs the **same** `acquireMyHome` / `acquireSsge` code that
  Find Property uses.
- `src/verify/marketplaceComparables.ts` and `src/verify/marketLane.ts`
  deduplicate the results, assign tiers and score them.
- The statistics come from `src/verify/intelligence/marketIntelligence.ts`
  (IQR trimming, medians) and `marketHierarchy.ts`.

On top of that, the terra MARKET stage still runs web search.

### Location

Location data comes from two places:
- **Structured:** Nominatim and Overpass (OSM), in `src/verify/intelligence/neighborhoodFetch.ts`,
  called by verify-synthesis.
- **AI:** the PUBLIC_RESEARCH stage writes a `nearbyPlaces` list from web
  search, with no distances (RA:610-679, 1723).

### Media

- The worker extracts TAS PDF images and uploads them to the private bucket
  `verify-official-visuals`.
- RA's `collectOfficialVisuals` writes them to `result_json.officialVisuals`.
- verify-synthesis runs a quality filter (`isUnusableVisual`) and signs the
  URLs for 1 h (`forCustomer`).
- `VisualExplorer` renders them, or a dashed `vrx_explore_empty` placeholder
  when nothing is left.
- The Verify UI has **no** map component and **no** comparable-listing images
  today.

### Third-party providers

- **2Captcha:** `official-worker/src/captcha/captchaService.ts`, used for
  MyGov and RS.ge. The policy is `admin_settings.verify_captcha_auto_solve`
  (max 12 solves per job).
- **APIFY:** used **only** for developer ads (memo23, RA:2132, through
  `_shared/findBuyers/memo23Client.ts`), as CLAUDE.md allows.

### Existing patterns a V1/V2 selector should reuse

- **`admin_settings.verify_execution_mode`:** the value is read when a job is
  created and the job keeps it (*"a job started in QUEUE mode finishes in
  QUEUE mode"*).
- **`service_controls` and `service_control_set`:** compare-and-set writes,
  an `is_admin` check, `admin_audit_log`, and the existing Admin page
  `AdminServiceControlPage.tsx`.

## 3. Findings on the reference job

The reference job is `61c1c38c…` (background job `0015e291…`), cadastral code
`01.14.07.001.044`.

### F1 — COMPLETED with `current_stage = SYNTHESIS_WAITING` is a systemic state-machine bug

The cause is in the code:
- `background_job_finish` (`20260911211715_background_jobs.sql:551-562`)
  never updates `current_stage`, so the last stage that `mirror()` copied in
  stays there.
- `jobs-worker` sets the state to COMPLETED as soon as `research_jobs.status`
  is COMPLETE. It selects `synthesis_state` but ignores it.

Evidence from the reference job:

| Event | Time |
|---|---|
| Research complete | 12:10:41 |
| Background job COMPLETED | 12:10:46 |
| Report synthesis READY | **12:12:34** |

So the job is marked complete about 2 minutes before the report exists.
**All 12 recent completed Verify jobs show the same `SYNTHESIS_WAITING/COMPLETED` pair.**

Billing is not affected: `settlementOutcome` charges only when
`synthesis_state = 'READY'`.

### F2 — RS.ge failure on the reference job

The failed task was `rstax` for company 405537441 (შპს ბიჩ ბილდინგ ბაგები):
- Error: `RS_VERIFICATION_FAILED outcome=UNPARSEABLE http=200`.
- Attempts: 1 of 3, so it was not retried.
- The 2Captcha event for it reads `NO_CHANGE`: the token was accepted, but
  the page did not produce a result grid.

RS.ge is optional by design: it never gates the stage. The report did list
it in `officialSourcesNotVerified` (`VERIFICATION_FAILED`) and
`outstanding_count = 1`, so the failure was **disclosed**.

RS.ge fails often across jobs: 5 of the last 12 completed jobs had an RS.ge
task FAILED or CANCELLED.

### F3 — A source reported SUCCEEDED while blocked

- The `mygov` **task** is `SUCCEEDED`.
- The report lists mygov as `BLOCKED: CAPTCHA_REQUIRED … BUDGET_EXHAUSTED`.
- The job used 12 mygov reCAPTCHA solves, which is the per-job cap.

The task state therefore overstates what was actually collected. Anyone
reading `verify_tasks` will be misled.

### F4 — Empty gallery: all images were discarded as unusable

- All 24 `officialVisuals` were stored in `verify-official-visuals` (count
  checked against `storage.objects`), and all 24 reached `synthesis_json`.
- **All 24 have quality verdict `STRIP`**: 5000×400, aspect ratio 13:1,
  `usable: false`.
- They were extracted as `PDF_EMBEDDED_IMAGE` from one TAS PDF
  ("მონტაჟი+ განთავსება+ კონსტრუქცია.pdf"). That PDF stores its photomontage
  as horizontal tiles, so the extractor saves slices instead of the picture.

For comparison, earlier jobs kept 20, 41 and 46 usable images.

The fix belongs in **extraction**: rasterise the page, or stitch adjacent
strips with the same `attachedFileId`. The quality filter is right to reject
the slices.

Two smaller UI problems:
- The empty placeholder does not say that images were found but were not
  presentable.
- `<img onError>` hides broken images silently.

### F5 — Property photos and coordinates are always missing

- `freshPhotos.status` is `NO_LOCATION` or `NONE_FOUND` on **every** recent
  job, with 0 photos.
- Every source is `SKIPPED_RIGHTS`.
- `location.center` is null on every recent job.
- With no coordinates, no POI distance is ever computed. The "nearby" lists
  are names taken from public and developer descriptions.

This is a long-standing gap, not a regression from this job. It is also the
biggest obstacle to the spec's §6 (real distances).

### F6 — The market comparables for this property are not comparable

The marketplace profile sent to the workers was
`{city: თბილისი, rooms: null, areaSqm: null, district: null, APARTMENT, BUY}`:
- Both portals were searched across the whole **city** (48 + 48 rows; SS.ge
  hit `PAGE_CAP_REACHED`).
- The resulting comparables are 35–56 m² flats in Mukhiani, Saburtalo and
  Sololaki.
- The subject is a co-owned 2,509 m² plot on Tskneti highway 31 (Bagebi),
  with buildings of 2,054 m² and 10,066 m².
- Every comparable has `similarity: "same city"` and `distanceM: null`.

The problem is how the subject is profiled, not how many pages are read.

### F7 — The reported COGS understates real cost by about 24%

The "verified" $0.771 is not the full cost of the job:

| Component | Recorded | Actual |
|---|---:|---:|
| RA SYNTHESIS stage (terra, 20,963 in / 4,396 out) | $0.009468 (priced at **luna** rates) | **$0.094678** |
| verify-synthesis report (luna, 53,960 in / 13,549 out) | **not recorded** | $0.027051 |
| Other AI stages | $0.621695 | $0.621695 |
| Web search (14) | $0.140000 | $0.140000 |
| APIFY memo23 developer ads | in `cost_events`, not in `verify_job_cogs` | $0.027500 |
| 2Captcha (14 solves × $0.003) | `verify_captcha_events` only | $0.042000 |
| **Total** | **$0.771163** | **≈ $0.952924** (excluding Railway compute) |

The cause is in `recordVerificationCost` (RA:~6120-6155). It prices the
`synthesis` usage key at the report model, but that key holds RA's own terra
SYNTHESIS call. The real verify-synthesis usage (`synthesis_json._usage`) is
never written to `cost_events`.

V2 cost comparisons must use the corrected figure.

## 4. Where the spec conflicts with the repo

| # | Spec says | Repo reality | Proposal |
|---|---|---|---|
| C1 | Make isolated **copies** of the MyHome and SS.ge workers | They already run in-process in the one allowed Railway worker. CLAUDE.md forbids a second service. Shared risks: one `MAX_ACTIVE=1` MyHome slot, one shared Cloudflare cooldown, and Verify calling `acquireSsge` without the runtime's `active` slot | Add Verify-owned adapter modules **inside** `official-worker/src/verify-market/`, keeping the vendored low-level transport. Give Verify its own concurrency slot and its own cooldown key. A challenge raised by a Verify request must not block Find Property, and the reverse. |
| C2 | Exactly 2 result pages per portal | MyHome already defaults to 2. SS.ge is hard-capped at 3 inside `acquireSsge`, and changing that would also change Find Property | The Verify adapter passes `pageCap: 2` and asserts it in tests. Find Property's cap stays the same. |
| C3 | Preserve the existing Synthesis AI | There are two synthesis steps (see §2) | D1 |
| C4 | Preserve APIFY in Verify | APIFY is used only for developer ads | No change needed. V2 keeps that call as it is. |
| C5 | Preserve map visuals | The Verify UI has no map component | Not a regression. A map would be new UI on a protected surface, so it is out of scope unless you ask for it. |

## 5. Decisions needed before Phase 2

- **D1 — RA SYNTHESIS stage (terra).** Replace it with deterministic
  `result_json` assembly in V2, and keep the verify-synthesis luna report
  untouched? *(Recommended.)*
- **D2 — Location without coordinates (F5).**
  - The deterministic route needs a coordinate source: the TAS_MAP centre,
    NAPR parcel geometry, or Nominatim on the registry address.
  - Until coordinates are reliable, should V2 keep the PUBLIC_RESEARCH
    `nearbyPlaces` lane as a V1 fallback? The spec says to keep V1 for any
    feature that can't reach parity. *(Recommended: yes.)*
- **D3 — Do F1, F4 and F7 now, in both engines.** These are V1 bugs that
  exist regardless of V2. Fixing them first gives a correct baseline to
  compare V2 against. Each one is small and separately releasable.
  *(Recommended: ship them before any V2 work.)*

## 6. Phased plan with gates

1. **V1 preservation.**
   - Tag `verify-v1-baseline` once the Railway SHA has been read.
   - Add the setting `admin_settings.verify_engine = {active:'V1'|'V2'}`. It
     is read when the job is created and stamped onto the job as
     `result_json._engine`, the same way `verify_execution_mode` works.
   - Writes go through a compare-and-set, audited RPC modelled on
     `service_control_set`.
   - Add the selector to the existing Admin service-control page.
   - With `V1`, the code path is byte-identical to today's.
2. **Baseline fixes** (D3): F1 state machine, F7 COGS, F4 strip stitching,
   F3 task-state honesty.
3. **V2 implementation**, behind `V2`:
   - Verify-owned market adapters (C1, C2) and subject profiling from
     registry facts (F6).
   - Deterministic identity, official and public assembly from the
     structured task results.
   - OSM POIs with real straight-line distances, once coordinates are
     resolved.
   - Deterministic `result_json` assembly (D1).
   - The unchanged verify-synthesis.
4. **Shadow QA.**
   - Run V2 on stored V1 inputs where possible, plus a small paid set agreed
     in advance.
   - Compare data, report output, visuals and cost.
   - Take Playwright screenshots of `/verify/:id` from the same
     `synthesis_json`. No such harness exists today; it has to be built.
5. **Release.** One coordinated release with V1 still the default. Then
   switch to V2 from Admin, and prove V2 → V1 in production.

V2 does not become the default while any gate is red.
