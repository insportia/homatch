# Storage retention, cleanup engine and compact market knowledge

Status (2026-10-15): **implemented and tested locally, NOT applied, NOT deployed, NOT activated.**
Everything destructive ships off. Nothing in production has been deleted or changed by this work.

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

## 6. Protected-path dependency — STOPPED, needs the owner

research-agent's `status` and `document_file` actions read `research_jobs` with the **service role** (`ownedBy`), so
RLS does not apply to them.

- Between `expires_at` and the purge, an owner who still knows the job id can read the payload through `status`.
  `verify-synthesis` (RLS) returns 404, so no report is rebuilt and nothing is charged.
- Anonymous-session jobs are only reachable this way.

Once a record is purged, both actions return the tombstone or 404: `ledgerFileFor(null)` → `not_in_report`.

Two ways to close the gap:

- **(a)** A 3-line guard in research-agent: `if (await rpc('retention_access_blocked', ...)) return 410`. This
  touches a protected Verify execution path, so it was not made.
- **(b)** Run the purge every few minutes after activation, so the window is minutes.

(b) needs no Verify change. (a) needs explicit approval.

## 7. Legal / policy flags (not edited)

- `privacy_s6_body` says account data is kept "as long as your account is active". The Verify/Contracts 30-day deletion
  needs its own sentence, in 6 languages, before `effective_at` is set.
- The knowledge layer is covered only by "Aggregated, anonymised analytics data may be retained indefinitely". The
  owner or counsel should confirm that this covers derived listing observations and contract finding counters.
- Terms §6 (licence to use content "solely to provide the Service") should be reviewed against the contract finding
  counters.

## 8. Activation — every step needs explicit owner approval

1. Merge the PR. CI deploys `storage-retention` and `storage-sign` (dormant) and the frontend. The panels render
   nothing until records have dates.
2. Apply the migration in release order. On apply, nothing is deleted or hidden.
3. Update the privacy policy and terms (§7).
4. Schedule the tick, for example every 10 minutes:
   `net.http_post(.../functions/v1/storage-retention, headers x-cron-token = admin_settings.storage_retention_cron_token, body {"action":"tick"})`.
   Ticks register only.
5. Set `storage_retention.effective_at = <activation time>`. New reports then get dates; old ones stay undated.
   Optionally turn on `reminders_enabled` and `knowledge_enabled`.
6. Run Admin → Storage → Dry Run, then set `purge_enabled = true` with `batch_size` 5, and verify each batch in
   `retention_events`.
7. **Historical data is a separate decision:** a user notice, then `legacy_grace_until` = notice date + grace, then
   batches.

Rollback:

- `purge_enabled=false` stops all deletion at the next claim.
- Setting `effective_at=null` stops new dates. Existing dates are immutable by design, so this needs an admin SQL
  decision.
- The policies are deny-only and can be dropped without data loss.
