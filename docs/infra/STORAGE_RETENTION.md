# Storage retention, cleanup engine and compact market knowledge

Status (2026-10-16): **record-level retention (§1–§9) is RETIRED by owner decision** — Verify results and Contracts
originals are permanent. Retention now means **object-level deletion of an explicit allowlist of disposable storage
objects** — see **§10**. §1–§9 are kept as the history of what was built and audited.

| Piece | Where |
|---|---|
| Migration (registry, expiry rule, deny-only gates, engine RPCs, knowledge tables, admin RPCs) | `supabase/migrations/20261102090000_storage_retention_lifecycle.sql` |
| Provider engine (delete → verify → report) | `supabase/functions/_shared/retention/engine.ts` |
| Tick endpoint (cron token or admin JWT) | `supabase/functions/storage-retention/index.ts` |
| R2 signed-URL gate for expired keys | `supabase/functions/storage-sign/index.ts` (one block) |
| Customer notice (history screens) | `src/components/retention/RetentionPanel.tsx`, `src/services/retention*.ts` |
| Admin → Storage panel + Dry Run | `src/components/retention/AdminRetentionPanel.tsx` |
| Strings (6 locales; Georgian policy copy verbatim from the owner) | `scripts/retention-i18n-{data,apply}.mjs` |
| Tests | `tests/sql/retention/run.sh` (local PG16), `supabase/functions/_shared/retention/__tests__/engine.test.mjs`, `src/services/__tests__/retention.test.mjs`, `tests/matrix/retentionSafety.test.mjs` |

## 1. Dependency map (audited 2026-10-15, code + read-only production)

**Verify report = one `research_jobs` row.** It is complete when `status='COMPLETE'` and `completed_at` is set
(research-agent `index.ts:4695`). The finished report is `synthesis_json` (`synthesis_state='READY'`, `synthesis_at`).
Payload columns are `result_json`, `synthesis_json`, `evidence`, `evidence_bundle`, `documents` and `progress`.
Generated columns (`address`, `entity_name`, …) derive from `result_json`.

Foreign keys pointing at the row:

| Referencing column | On delete |
|---|---|
| `verify_billing.job_id` | **RESTRICT** |
| `verify_tasks`, `human_verification_handoffs` | CASCADE |
| `deal_rooms.verify_job_id`, `transaction_cases`, `intelligence_facts`, `intelligence_relationships`, `market_snapshots`, `verify_captcha_events`, `supersedes_job_id` | SET NULL |

Because of these foreign keys, the engine **never deletes a row**. It clears payload columns only.

Read paths:

- PostgREST under RLS: `getResearchJob`, history, and active-job recovery.
- `verify-synthesis` with the user's client (RLS).
- `deal-room-ai` with the user's client (RLS), via `deal_rooms.verify_job_id`.
- **research-agent `status` and `document_file` with the service role**, plus `ownedBy`, which bypasses RLS.
- `loadEarlierRegister` reuse, which uses the service role and filters `deleted_at is null`.

There is no public share for Verify: no token table and no public route.

**Contracts document = one `deal_room_documents` row.** The same table is used by Verify's Verification Case
(`/verify/:id`); **there is no product discriminator column**. Retention applies to uploaded files and their analysis
(`storage_path is not null or analysis is not null`), in both products. Checklist rows without a file are never
registered.

- Files live in the private Supabase bucket `deal-room-documents`, keyed `<uid>/<room>/<doc>.<ext>`.
- R2 copies made by the storage migration live under `deal-room-documents/…` in `homatch-storage` and are indexed in
  `storage_objects`.
- Findings and events cascade from the document.
- There is no share link.

**Shared official documents.** `verify-documents/files/<attachedFileId>.<ext>` is content-addressed and reused across
reports. research-agent re-fetches it through the worker on a cache miss, so deleting it is self-healing.
`verify-official-visuals` and `verify-evidence` are shared caches with no reference index. They are **out of scope**:
reported in the Dry Run, never deleted.

## 2. Storage inventory (production, read-only, 2026-10-15)

| Provider | What | Count | Size |
|---|---|---|---|
| Postgres | `research_jobs` table (total relation) | 99 rows (76 COMPLETE, 21 FAILED, 2 CANCELLED) | 14.8 MB; COMPLETE payload 11.8 MB |
| Postgres | `deal_room_documents` + findings | 12 rows (6 with file or analysis) | 0.44 MB |
| Supabase Storage | `deal-room-documents` | 8 objects | 1.27 MB |
| Supabase Storage | `verify-documents` / `verify-official-visuals` / `verify-evidence` | 10 / 165 / 87 | 18.3 / 147.8 / 44.9 MB |
| R2 `homatch-storage` | `deal-room-documents` copies | 5 ACTIVE | 0.53 MB |
| R2 | `design-studio`, `users`, `voice-auditions` | 10,966 / 654 / 9 | 16.8 GB / 17.9 MB / 1.0 MB (not Verify/Contracts) |
| Railway | `homatch-official-worker` | no volume mounts; container disk is ephemeral | browser profile dirs removed on close and by the TTL sweep (`LocalBrowserRuntime.ts:411/530`) |
| Vercel | static SPA | no Blob, no KV, no `api/` | nothing to clean |

Historical observations, rechecked:

| Observation | Then | Now |
|---|---|---|
| Verify jobs | 99 | 99 |
| Older than 30 days | 80 | 80 (58 COMPLETE + 21 FAILED + 1 CANCELLED, counted by completion or creation date) |
| Contracts rows | 12 | 12 |
| Contracts rows older than 30 days | 8 | 8 by creation date. Only 2 *files with analysis* are older than 30 days from availability; the other 6 are checklist rows with no file. |
| `verify-documents` | 10 | 10 |
| `deal-room-documents` | 8 | 8 |
| `reportCache` | — | ≤4 entries, 40 min fresh, 55 min hard maximum (`src/verify/reportCache.ts:28-32`) |

## 3. The rule and the lifecycle

- **Expiry:** `retention_expiry(available_at) = available_at + 30 days`, computed on the UTC calendar. This is the
  single source; a test fails if a second one appears.
- **Verify `available_at`:** `greatest(completed_at, synthesis_at)` when synthesis is READY; otherwise
  `completed_at`, registered after synthesis settles or 1 h has passed.
- **Contracts `available_at`:** `greatest(uploaded_at, analyzed_at)`. A file that was never analysed uses
  `uploaded_at`, registered after 1 h.
- **Policy:** `expires_at` is written once and a guard trigger forbids moving it, so reads, views, downloads and
  logins never extend it.
- **Activation date:** records that became available before `storage_retention.effective_at` get **no expiry**
  (`LEGACY_PENDING`) unless the owner sets `legacy_grace_until`. In that case their expiry is
  `max(available + 30 d, grace)`.
- **Access expiry (server-side, deny-only):**
  - Restrictive SELECT policies on `research_jobs`, `deal_room_documents`, `deal_room_document_findings`, and on
    `storage.objects` for `deal-room-documents`, so no signed URL is issued for an expired file.
  - `storage-sign` refuses READ for R2 keys whose every registered reference has expired.
- **Engine:** `tick` → register → scan shared-document references → reminders → **claim** (returns nothing unless
  `purge_enabled`) → per record:
  - delete each exclusive object at its provider;
  - **confirm it is gone** (Supabase: the `storage.objects` row is gone; R2: HEAD returns 404);
  - retain objects another live reference still needs;
  - only then clear the database payload and verify it is empty → `PURGED`.

  Failures back off at 2^n minutes. After `max_attempts` the record goes to `DEAD_LETTER` for manual review.
  Claiming uses `FOR UPDATE SKIP LOCKED` plus a lease token, so it is restart- and concurrency-safe.
- **Tombstone:**
  - Verify keeps id, owner, `status`, `created_at`, `completed_at` and the billing row, plus
    `lifecycle_state='PURGED'` and `deleted_at`. Query and title are cleared.
  - The registry keeps a label such as `Verify · property`.
  - A Contracts tombstone keeps the row with no file, analysis, filename or findings. `doc_key` is freed so the same
    file can be uploaded again.
  - The duplicated `deal_rooms.verify_snapshot` is cleared with its report.

## 4. Compact knowledge layer

**`market_observations`:** one row per distinct public listing price that Verify already gathered as a comparable.

- Stored fields: district, type, rooms, floor, area, condition, listing status, price, currency, price/m², observed
  date, source category, comparable type and confidence.
- **Not stored:** user, job, address, project, URL or listing id. Dedupe uses a 16-byte truncated hash.
- `price_kind` is constrained to `ASKING`; a SOLD listing status is never presented as a sale price.
- Ambiguous values ("80-90", "about 1100", free text containing digits) are dropped, never guessed.

**`contract_insight_counts`:** monthly counters by category, finding type and severity. No document content.

Behaviour:

- Extraction is deterministic SQL with no AI call. It runs only in the asynchronous tick, once per record, inside its
  own exception handler, so it can never fail or delay Verify.
- Correction: `knowledge_withdraw_observation` (admin). A user's deletion request does not reach these rows, because
  they hold no user link.
- Measured on production comparables, read-only: 1,394 comparables in reports (1.10 MB as stored) → 1,355 usable →
  **776 distinct observations**. Locally measured row size is under 400 B per row. That gives an estimated
  ~0.2–0.3 MB including indexes, against 11.8 MB of Verify payload.

## 5. Dry Run (production, read-only, 2026-10-15T18:02Z)

This is the worst case: the 30-day rule applied retroactively to everything. **This is not what activation does.**
With `effective_at` set to the activation date and no `legacy_grace_until`, **0 records** expire on day one.

| | Would expire | Bytes | Notes |
|---|---|---|---|
| Verify reports | 58 of 76 (9 more within 7 days) | 8.14 MB DB payload + 2.1 KB deal-room snapshots | 3 linked to a deal room, 1 anonymous-session, 0 market refresh running, 0 active handoffs, 0 billing rows (billing kept either way) |
| Contracts files | 2 of 6 | 35 KB DB + 0.45 MB Supabase (2 objects) + 0.45 MB R2 (2 copies) | both are Verification-Case documents (cross-product impact); 0 missing files |
| Orphans (report only) | — | — | 2 `deal-room-documents` files with no row · 2 R2 copies whose source row is gone · 5 R2 PENDING uploads over 1 h old · 0 unreferenced `verify-documents` |

Not deleted by this system: `verify-official-visuals` and `verify-evidence` (shared caches, separate policy needed),
`verify_tasks` (1.6 MB, a pipeline cache with cross-job reuse), `intelligence_facts` (1.5 MB, Verify's own
knowledge), and FAILED/CANCELLED jobs.

## 6. Access enforcement on every route (owner-approved guard, 2026-10-15)

Expiry is enforced at the moment `expires_at` passes, **independently of cleanup**: no route relies on the purge
having run. The owner approved a minimal server-side guard in service-role routes. Every guard calls the same rule,
`retention_access_blocked` or its batch form `retention_blocked_ids`; the shared helper is
`supabase/functions/_shared/retentionGuard.ts`.

| Path | Client | Enforcement |
|---|---|---|
| PostgREST reads of `research_jobs`, `deal_room_documents`, findings (history, `getResearchJob`, active-job recovery, Contracts pages) | user | restrictive RLS policy |
| Realtime `postgres_changes` on `research_jobs` (in `supabase_realtime`) | user | the same RLS policy |
| `verify-synthesis` (report read, rebuild, translate) | user | RLS → 404; no rebuild, no charge |
| `deal-room-ai`, `verification-handoff`, analyze user path | user | RLS |
| `deal-room-documents` signed URLs (`createSignedUrl` from the browser) | user | restrictive policy on `storage.objects` |
| R2 copies via `storage-sign` | service | `retention_object_blocked` → 410 |
| research-agent `status` / `resume` / `skip` / `cancel` / `pause` / `continue` | **service** | guard right after the ownership lookup, before any job body and **before the finished-response memo** → 410 `REPORT_EXPIRED`. Only runs for COMPLETE jobs, so the polling of running jobs is unchanged. |
| research-agent `document_file` (verify-documents signed URL) | **service** | guard before signing and before any worker re-fetch → 410 |
| research-agent `recover_visuals` / `fresh_photos` / `refresh_market` (owner or internal) | **service** | guard before the handler → 410; an expired report is never regenerated |
| `homatch-ai` assistant context (last 5 report summaries) | **service** | expired reports filtered out; if the check fails, no report context is given |
| `deal-room-document-analyze` worker path | **service** | expired document → 410; an expired linked Verify report is not read into a new analysis |

Failure behaviour:

- Before the migration exists, the RPC is missing and nothing is treated as expired. The guard allows.
- Any other RPC failure fails **closed** (503) on the report routes.

Residual paths, all documented and none server-reachable by a customer:

- **Admin diagnostics:** the admin-only `verify-admin-diagnostics` still lists job status and query until purge.
- **Same-user register reuse:** `verify-synthesis` `loadEarlierRegister` can reuse `browserOfficial` from the same
  user's expired-but-not-yet-purged job inside a new paid report. This is a protected research path and was not
  changed. Once the payload is purged there is nothing to reuse; recommendation: enable purge soon after
  `effective_at`.
- **In-tab cache:** the browser `reportCache` (sessionStorage) can keep an already-delivered report for at most 55
  minutes in the same tab. No server access is involved.

Tests:

- `supabase/functions/_shared/__tests__/retentionGuard.test.mjs`: behaviour plus exact placement of every gate.
- `tests/sql/retention`: the rule and the batch form, including service-role only.
- `tests/matrix/retentionSafety.test.mjs`: protected files may differ from main **only** by the approved guard
  lines.

## 7. Legal / policy flags (not edited)

- `privacy_s6_body` says account data is kept "as long as your account is active". The Verify/Contracts 30-day deletion
  needs its own sentence, in 6 languages, before `effective_at` is set.
- The knowledge layer is covered only by "Aggregated, anonymised analytics data may be retained indefinitely". The
  owner or counsel should confirm that this covers derived listing observations and contract finding counters.
- Terms §6 (licence to use content "solely to provide the Service") should be reviewed against the contract finding
  counters.

## 8. Official document and evidence caches (read-only review, 2026-10-15)

| Bucket | Objects | Size | Referenced by a report / task | Unreferenced |
|---|---|---|---|---|
| `verify-documents` (`files/<attachedFileId>.<ext>`) | 10 | 17 MB | all 10, by attachment id | 0 |
| `verify-evidence` (`sha256/…`) | 87 | 43 MB | 87 (by COMPLETE reports and `verify_tasks`) | 0 |
| `verify-official-visuals` (`tas/<sha256>.<ext>`) | 165 | 141 MB | 156 | **9 (9.1 MB)** |

All three are content-addressed and shared across reports and users. Recommended policy, **not implemented** (it
needs no Verify pipeline change, only reference scans by the engine):

- **`verify-documents`:** already handled by the engine as SHARED references. Delete only when no non-purged report
  names the attachment. Self-healing: research-agent re-fetches through the worker on a miss.
- **`verify-official-visuals`:** mark-and-sweep with a quarantine. An object is eligible when:
  - no non-purged `research_jobs` or `verify_tasks` row contains its sha;
  - it is older than 30 days;
  - it was found unreferenced in two sweeps at least 7 days apart.

  New jobs re-upload a missing visual (`list` → absent → `upload`), so a wrong deletion costs one re-fetch, never a
  broken live report. The 9 current candidates would enter quarantine, not deletion.
- **`verify-evidence`:** tie to report lifecycle. Deletable only once every referencing report is PURGED **and** the
  referencing `verify_tasks` rows are gone. `verify_tasks` has no retention yet (1.6 MB, a cross-job reuse cache), so
  this waits for a `verify_tasks` policy decision.

## 9. (Retired 2026-10-16) Record-level activation

> Retired: `retention_admin_configure` now refuses every record-level setting and `retention_claim` returns nothing (migration `20261104090000`). The table below describes the switches that no longer exist.

Everything is controlled from one panel. Every change goes through `retention_admin_configure`, which refuses unsafe
combinations on the server and logs who changed what (`retention_events`, `CONFIG_CHANGED`).

| Switch | What it does | Server rule |
|---|---|---|
| 30-day rule for new reports | New reports get an end date 30 days after they're ready | Can't start in the past; can't be moved earlier; turning it off also turns deletion off |
| Reports made before the rule | "Kept with no end date", or an end date you pick | Only when the rule is on; at least 7 days away; can only be moved later |
| Remind customers | 7-day and 1-day notices through the normal notifications | Needs the rule |
| Delete expired data | Permanently removes expired reports and files; billing is always kept | Needs the rule; the panel shows the real preview numbers and asks first |
| Run automatically | Schedules/unschedules the 10-minute job (`homatch-storage-retention`) | Exactly one job; off removes it |
| Keep anonymous market data | Compact listing-price observations, no personal or address data | — |

The panel also has:

- **Preview what would be deleted:** read-only and uses the current settings.
- **Run now:** one tick.
- **Four numbers:** kept with no end date, expiring within 7 days, expired and waiting, deleted.
- **Needs attention:** with Retry.
- **Protected (legal hold):** add one by report or document id plus a reason, and release it.
- **Storage details:** collapsed by default.

Order the owner follows:

1. Merge the PR and apply the migration. Everything is OFF.
2. Update the privacy policy (§7).
3. Turn on the 30-day rule.
4. Optionally turn on reminders and market data.
5. Use Preview, then turn on "Delete expired data" and "Run automatically".
6. Older reports, only when ready to give notice: set an end date at least 7 days away.

Rollback:

- Turn off "Delete expired data" (stops at the next run), or turn off the rule (also stops deletion).
- End dates already given are immutable by design.
- The access policies are deny-only and can be dropped without data loss.


## 10. Object-level retention (owner decision 2026-10-16) — migration `20261104090000`

**Rule.** Only storage objects whose location is on a hard-coded allowlist can ever be deleted
(`public.retention_location_eligible`, mirrored in `engine.ts` `eligibleLocation`, parity pinned by a test).
Adding a location needs a reviewed migration; no setting, category or Admin action can widen it.

| Allowlisted location | Category | Kind | Life | Owner notice |
|---|---|---|---|---|
| `verify-documents` / `files/<attachedFileId>.(pdf\|jpg\|png)` | `verify_document_cache` | Regenerable cache | 30 days | none — nothing is lost; `research-agent` `document_file` re-fetches on a miss |
| R2 `users/<uuid>/generated-reports/<uuid>.<ext>` | `generated_report` | Temporary generated file | 30 days | 7 days and 1 day before, with the producer's download link |
| `verify-documents` / `retention-selftest/<uuid>.pdf` | `selftest_supabase` | Self-test | 2 min | yes (test notice to the admin) |
| R2 `retention-selftest/<uuid>.txt` | `selftest_r2` | Self-test | 2 min | none |

**Never deleted** (listed on the Admin screen from `retention_protected_areas()`): the Design Studio catalog
(≈16.8 GB of R2 — 99% of all stored bytes) and users' Design Studio files; Contracts originals and their R2 copies;
Verify evidence (`verify-evidence`) and report visuals (`verify-official-visuals`); Verify results and Contracts
analyses; every customer upload; accounts, properties, listings, billing, transactions and audit records.

**Lifecycle.**
1. **Registration.** Internal caches are discovered by the tick: objects created at or after the category's
   `active_since`, in its exact location. User-visible temporary files are registered by their producer at creation
   with `retention_register_artifact(category, key, owner, bytes, label, deep_link, …)`. A user-visible category
   cannot be discovered without the producer's owner and download path.
2. **Prospective only.** Enabling a category stamps `active_since` once; it never moves. Historical objects are
   never registered, so there is no retroactive cleanup.
3. **Expiry.** `expires_at = object_created_at + ttl`, immutable (guard trigger).
4. **Notices** (user-visible files, `notifications_enabled`). `notify_emit` with type `RETENTION_EXPIRING` and
   `metadata.kind = RETENTION_ARTIFACT_EXPIRING`. The app renders it in the reader's language (6 locales) with the
   exact date. Dedupe keys `retention-artifact:<id>:7d|1d` prevent duplicates. A notice that cannot be queued backs
   off and retries. A user-visible file is never claimed before at least one notice was queued.
5. **Deletion.** `retention_artifacts_claim` (SKIP LOCKED lease, bounded batch, refuses everything while
   `paused`, re-checks the allowlist) → engine re-checks the allowlist → caches only: worker re-fetch proof
   (`GET {WORKER_URL}/verify/tas-file`, must answer 200 with a pdf/jpeg/png body), else **kept** and rechecked
   tomorrow → present? → delete at the provider → confirm absent (`storage.objects` / R2 HEAD) → `VERIFIED_DELETED`
   with the proof. Failures back off `2^n` minutes, then `DEAD_LETTER` (Admin: Retry).
6. **Audit.** Every step writes `retention_events` (`artifact_id`): REGISTERED, NOTICE_QUEUED/FAILED, CLAIMED,
   OBJECT_DELETED, KEPT_NOT_REGENERABLE, DELETE_FAILED, PROTECTED_AT_CLAIM, REQUEUED, TICK,
   ARTIFACT_CONFIG_CHANGED.

**Admin → Storage → Storage retention.**
- **Status sentence:** Off / Paused / On by hand / On automatically, plus the last run.
- **Three switches:**
  - **Run automatically** — the single `homatch-storage-retention` cron, every 10 minutes; asks first.
  - **Pause all deletion** — the kill switch; one tap, and resuming asks first.
  - **Expiry notices.**
- **Per-category switches** with counts. Enabling explains that it covers only files created from now on.
- **Never deleted** list.
- **Five numbers:** tracked, expiring within 7 days, deleted, space saved, need attention.
- **Actions:** **Preview the next run** (read-only), **Run now** (shows the preview, asks first) and **Run self-test**.
- **Lists:** Due soon, Problems (Retry), Deleted, Notices (queued/read), Activity log.

**Self-test (production E2E).** `POST storage-retention {"action":"selftest"}` (admin JWT, or cron token with
`owner`) uploads one tiny PDF to Supabase Storage and one text file to R2 under `retention-selftest/`, and registers
both with a 2-minute life. The next tick queues the test notice, waits for it, deletes both objects and confirms
they are gone.

**Record-level retention retired.** `retention_claim` returns nothing. `retention_admin_configure` raises
`RETENTION_RECORD_LEVEL_RETIRED`. The record-level registry is never written by the engine. The access gates from
§3 stay: they deny nothing, because no record can be dated.
