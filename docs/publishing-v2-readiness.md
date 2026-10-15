# Publishing V2 managed HTTP readiness

PR #209 continues the existing unified engine. This branch is not production-ready and must not be merged or deployed without approval.

## Reused and replaced

Canonical listings, display IDs, revisions, ownership checks, private canonical media, durable operations, retry/backoff, wallet reservations/settlement/refunds, draft editor, AI helper, status UI and admin authorization are reused. V1 and legacy MyHome/SS.ge extension files are preserved.

V2 customer browser execution, customer session registration and customer-reported remote completion are removed. V2 uses HOMATCH-managed account metadata and a server consumer. Customer UI does not request portal credentials or extension installation. Six-language copy remains in the shared catalogue.

## Server execution

- `server/adapters.ts` defines reviewed provider bindings, credential-provider abstraction, authorization expiry, canonical validation/mapping, photos, idempotent create requirement, mutation and independent readback contracts. MyHome remains first in the registry; SS.ge is independent.
- Both actual bindings are absent and expose **zero executable operations**. No guessed HTTP write endpoints, browser cookies, passwords, scraping wrappers or challenge bypass are substituted.
- `server/http.ts` restricts HTTPS origins and fixed paths, refuses redirects, bounds timeouts and classifies uncertain writes conservatively. Raw response bodies and authentication headers are not logged.
- `server/worker.ts` consumes existing operations only after server authorization and database capability checks. It downloads media from the canonical owner's private object paths and checks size/content. It checkpoints accepted external IDs before readback. Acceptance, moderation and mismatched readback cannot become verified publication or billing.
- Mutation uncertainty requires reconciliation; it never causes blind repeated publication/deletion. Readback must match the submitted external identity and canonical revision/hash. Billing failure after successful verification cannot replay the portal write.
- `server/handler.ts` is a machine-only entry hosted by the existing publishing Edge Function. Gateway JWT verification stays enabled; a separate high-entropy worker token, no browser Origin, fixed command and bounded body are required before any service client is created. No customer can submit operation results or arbitrary commands.
- `scripts/publishing/managed-worker.mjs` runs in Node >=22.18, defaults disabled, supports diagnostics and graceful shutdown. It provisions nothing and is not wired into unrelated existing workers. The existing Edge Function is also a hostable execution path; scheduler/worker secrets must be configured securely before release.

## Additive database migration

Apply neither migration to production during this work. `20261015092646_publishing_engine_managed_accounts.sql` depends on the unapplied V2 migration.

Managed accounts hold metadata and secret references only, protected by admin SELECT RLS and service-only mutation/RPC permissions. Secret values belong in existing server secret storage. Customer API responses omit account identity and credential references.

One global account lock/rate limit serializes all tenants using a managed portal account. Provider disable, authorization expiry, verified capabilities, explicit destructive-action confirmation, subscription eligibility and canonical revisions gate claims. Legacy personal-account publications are not silently adopted.

External IDs are unique per managed account across tenants. Checkpoints do not advance content synchronization or settle funds. Leases are fenced; idempotent completion and periodic reconciliation reuse the existing operation/attempt/audit tables. Emergency disable is an audited server transaction.

## Billing

10 credits per canonical listing per 24 hours, covering all selected portals. Existing wallet functions and refund semantics remain unchanged. Drafts are free; activation requires consent; settlement requires verified service delivery. Fully paused listings stop renewal after their paid period; partial pauses remain billable. Existing unique billing periods, reservation keys and locks protect duplicate capture.

The isolated SQL proof uses a **synthetic wallet boundary**, not actual credit-lot allocation. A safe clone/staging test of the real wallet schema remains required before release. No production wallet or listing was changed.

## Portal evidence and external prerequisites

Owner-supplied actual Railway Node22.18 public GET results: MyHome homepage 403; SS.ge homepage 200 after redirect. The MyHome restriction cause remains undetermined and does not establish publishing API accessibility.

MyHome/TNET: existing repository marketplace endpoints are read-only references. No current supported publishing/auth contract or partner authorization has been provided. FlatFlow describes browser-side autofill; Apify's inspected actor is a read-only scraper; Mapiko's public cross-posting claims do not establish a supported server API. Next route: obtain current MyHome/TNET business publishing integration approval, auth/scopes, field/media schema, limits and lifecycle documentation.

SS.ge: official 2020 announcement describes publishing/editing/management APIs: https://ss.ge/ru/%D0%B1%D0%BB%D0%BE%D0%B3/ss-ge-api--186 . Current documentation, onboarding, credentials, limits, fees and operation-specific permissions are still required.

No portal operation is live verified. First publication also requires an explicitly authorized disposable property and contact-routing consent compatible with portal phone-verification rules.

## Verification and remaining release work

GitHub Actions validates the new additive migration on isolated PostgreSQL17, service-only grants/RLS, global account concurrency, duplicate external identity, submission checkpoints, fenced leases, revision ordering and existing synthetic-wallet billing concurrency. Focused mocked server tests cover readback mismatch, moderation, auth expiry, uncertain writes, billing outages, secret boundaries and tenant media. They are not live publishing evidence.

Full PR checks provide TypeScript/lint/i18n/build and application regressions. Latest results must be checked for the exact branch commit. Neither CI nor a connected account establishes live portal support.

Remaining: approved provider bindings and real per-operation verification; production-wallet staging proof; secure scheduler/worker secret configuration; authenticated media/AI and customer/admin smoke tests; advanced portfolio pagination/admin search and approved contact routing. No automatic deployment, new Railway service or unrelated-module changes.


## Isolated preview release gate — 2026-10-15

- Restored existing `homatch-migration-proof` (`icqzvgbztuuvgmwcyyav`), with no customer rows. A schema-only publishing/wallet subset was captured read-only from production; wallet functions and wallet security/credit-lot triggers are preserved. No unrelated workers, cron jobs or portal credentials were copied.
- Applied V1, SS.ge, V2, managed-account and draft-compatibility migrations only to staging. Staging gateway JWT verification remains enabled. Its entrypoint refuses a different project; only the named branch preview origin is additionally allowed there.
- Branch-specific Vercel preview variables now target staging; production variables are unchanged. A dedicated QA account authenticated through real GoTrue. `/v2/dashboard` and incomplete `/v2/save` returned HTTP 200, with a database-generated HOMATCH ID and real blocked portal states.
- Actual wallet reserve/release/settle/refund/credit-lot, partial-delivery, insufficient-balance/localization, draft revision and RLS proof passed in staging and rolled back. Portal publication rows in the financial proof are transactional fixtures, never live verification. No fixture publications or billing events remain.
- Production requires phone-bearing `properties` inserts. Compatibility migration lets Publishing canonical drafts exist independently, preserving existing property-backed projections and all existing property constraints/triggers. It also corrects `preferred_language` and nullable property links in billing notifications.
- `wallet-schema.snapshot.sql` is a test-only schema snapshot, never a production migration. `real-wallet-proof.sql` and eight-process concurrency proof run in a separate PostgreSQL17 CI database against the captured real wallet implementation.
- Frontend release may proceed with external operations disabled after its own staging/browser/CI gates pass. Real MyHome/SS publishing still requires current partner specifications, server authorization and explicit disposable-property approval.

### Coordinated production order and fallback

1. Confirm latest production ledger, expected publishing FK, wallet signatures, ownership, and backup/PITR; export function versions and existing publishing counts. Do not change historical migrations.
2. Apply only missing Publishing V2, managed-account, then draft-schema-compatibility migrations. Preserve all existing rows. Keep both provider gates disabled.
3. Deploy the backward-compatible JWT-protected Publishing function using `index.ts` (never `staging.ts`), then verify authenticated dashboard/draft/admin APIs.
4. Release the tested frontend through the existing main/Vercel pipeline. Confirm exact SHA, desktop/mobile sidebar-only navigation and API responses.
5. On frontend failure, restore the prior Vercel deployment; V1 routes/functions remain available. Keep additive schema and existing data intact. On backend failure, restore the saved function bundle; do not drop tables or reverse financial records. Use provider emergency disable and ledger adjustments for any future verified operations.
