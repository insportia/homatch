# SS.ge integration and Find Property history release

## Production history root cause

Read-only production inspection on 2026-10-07 found a frontend/backend deployment mismatch. The authenticated dashboard sent `POST marketplace-search` with the 29-byte history body. Production logs recorded HTTP 400 at 17:47:52 UTC from version 6; the preceding capabilities request returned 200 with the same authenticated session. Downloaded version 6, updated at 12:01:24 UTC, contains no `history` action and ends with `{error: 'UNKNOWN_ACTION'}`, HTTP 400. The frontend calls the correct API; its service correctly keeps this response as an error rather than empty history.

All selected DB columns exist. The affected account has five owned searches: two COMPLETE, two PARTIAL_COMPLETE and one FAILED. Their stored briefs are objects. There is no missing V2 migration, absent history column or evidence of RLS rejection: the old handler never reaches a history query. The current-main owned handler already exists; it must be shipped to production, not replaced with a frontend fallback.

This release preserves the existing authenticated history handler and hardens its serialization with `sanitizeBrief`, null completion dates and nullable optional counts. Unknown counts are omitted rather than represented as zero. Authentication, internal user resolution, explicit owner filtering, deterministic bounded pagination, and real DB/network/server error states remain intact. The changed helper/function makes the backend an owed release component. Deploy the reviewed marketplace-search artifact before declaring the dashboard recovered. No history migration is required.

## SS.ge architecture

The existing official worker hosts `ssge-agent`, using the same authenticated claim/heartbeat/report endpoint and existing search lifecycle. The standalone runtime modules are packaged unchanged under `official-worker/src/marketplace/ssge/vendor`; `vendor-manifest.json` records their SHA-256 hashes. The wrapper translates the existing MarketplaceSearchRequest, resolves location IDs from live SS.ge taxonomy using existing HOMATCH place-name aliases, invokes the accepted HTTP/2 adapter and independently checks individual page identities. It reports bounded marketplace-worker-1 candidates through the existing validator and persistence pipeline. No second scraper, service, endpoint or acquisition architecture is introduced.

Existing normalization, hard filtering, canonical resolution, source listing attribution, BEST/UPGRADE budget policy, owned history and exact-search routes remain authoritative. A source safety limit/repeated page/rejected identity yields PARTIAL, not fabricated complete success. Access rejection stops acquisition. Existing run deadlines bound acquisition; one SS.ge run executes at a time with conservative pacing. Reports preserve unknown cost rather than claiming zero.

Source publication/update dates, canonical renovation/building-status mappings, unproven seller labels and contacts are not invented. Source `orderDate` is retained as metadata, never advertised as publication/update time. Unsupported source filters remain downstream evidence/filter concerns; unsupported/ambiguous source mapping fails closed. Explicit locations without a verified source-name/alias match are rejected. Positive furnished filtering is supported; a negative source filter is not invented.

## Configuration and migration

- Existing worker `SUPABASE_URL`, pointing to the same production project.
- New `SSGE_WORKER_TOKEN`: independent random token of at least 32 characters, on the existing official-worker service only. Store only its SHA-256 in `discovery_marketplace_workers.token_hash` for `ssge-agent`; never share the MyHome token or a Supabase key with this adapter.
- New `SSGE_MARKETPLACE_ENABLED=true` on that service after reviewed deployment. Missing/false disables the runtime.
- Existing `marketplace_search_enabled=true`, plus new `marketplace_ssge_enabled=true` after controlled activation. This explicit Find Property-only switch mirrors MyHome's exception and never changes the global provider switch or other providers.
- Activate the registered row with `state=ACTIVE`, `enabled=true` only for the controlled production acceptance after deployment. Do not enable a row with no configured matching token/runtime.

One additive data/config migration is required: `20261020090000_ssge_marketplace_worker.sql`. It inserts a disabled PROVEN worker row and false scoped switch; it changes no columns, RLS, RPCs or source_registry records, and preserves any existing activation/token on replay. No new paid scraping credentials, browser installation, service or dependency is required.

## Evidence and validation

`docs/ssge-acceptance-review.json` records an offline recheck of all six saved detail/page comparisons from the accepted standalone run, including exact identities, prices, areas and scenario criteria. Both bounded scenarios reproduce; full inventory traversal and production verification are expressly not claimed.

Focused SS.ge tests execute the real authenticated worker-ingest handler and real processAndStore against an in-memory DB: sale apartment and monthly rent house produce source observations, canonical property rows and owned history counts. Additional tests cover source hashes, live-taxonomy location translation, bounded budgets, repeated pages, wrong identities, blocked access, deadline/cancellation and disabled runtime. The transport and database are fixtures: these tests do not establish production LIVE VERIFIED.

Focused history tests execute the real edge handler: authentication, multiple owned rows, newest failure plus older successes, legacy/null metadata, foreign-user exclusion, true HTTP500 errors and retry recovery. Browser coverage exercises authenticated history action, UNKNOWN_ACTION failure and Retry recovery. Production build and affected regression results are recorded in the PR handoff.

Checks passed: 83 marketplace core regressions; 47 affected worker/MyHome/startup regressions; 37 focused integration/history/matrix checks after expanding retry coverage; 12 history/runtime-boundary closure checks; 2 browser history/recovery checks. Frontend typecheck, scoped lint, changed edge/index syntax, migration checks and production build passed (12.01 seconds). The final replay assertion was checked in the focused SS.ge suite.

Full worker typecheck locally encounters four pre-existing missing `telegram` module imports; worker test build and affected worker regressions pass. No unrelated dependency repair is included. CI owns repository-wide validation.

No production writes, wallet charges, merge or deployment were performed. After merge/deployment, separately accept production Search History and one controlled real SS.ge search, then inspect persisted canonical properties and source URLs before deciding LIVE VERIFIED.

## Exact changed files

### Production wiring and history

- `official-worker/src/index.ts`
- `src/components/findProperty/SearchDashboard.tsx`
- `src/services/marketplaceSearch.ts`
- `supabase/functions/_shared/marketplaceHistory.ts`
- `supabase/functions/_shared/marketplaceSearch.ts`
- `supabase/functions/marketplace-search/index.ts`
- `supabase/functions/marketplace-worker-ingest/index.ts`
- `supabase/migrations/20261020090000_ssge_marketplace_worker.sql`

### Accepted adapter package

- `official-worker/scripts/snapshot-ssge.mjs`
- `official-worker/src/marketplace/ssge/acquire.mjs`
- `official-worker/src/marketplace/ssge/mapping.mjs`
- `official-worker/src/marketplace/ssge/runtime.mjs`
- `official-worker/src/marketplace/ssge/place-aliases.mjs`
- `official-worker/src/marketplace/ssge/vendor-manifest.json`
- `official-worker/src/marketplace/ssge/vendor/adapter.mjs`
- `official-worker/src/marketplace/ssge/vendor/diagnostics.mjs`
- `official-worker/src/marketplace/ssge/vendor/discovery.mjs`
- `official-worker/src/marketplace/ssge/vendor/gateway-http2.mjs`
- `official-worker/src/marketplace/ssge/vendor/http.mjs`
- `official-worker/src/marketplace/ssge/vendor/locations.mjs`
- `official-worker/src/marketplace/ssge/vendor/normalize.mjs`
- `official-worker/src/marketplace/ssge/vendor/page-proof.mjs`
- `official-worker/src/marketplace/ssge/vendor/pagination.mjs`
- `official-worker/src/marketplace/ssge/vendor/public-client.mjs`
- `official-worker/src/marketplace/ssge/vendor/public-session.mjs`
- `official-worker/src/marketplace/ssge/vendor/search-response.mjs`
- `official-worker/src/marketplace/ssge/vendor/ssge-contract.mjs`
- `official-worker/src/marketplace/ssge/vendor/validation.mjs`

### Tests and handoff

- `official-worker/test/fixtures/ssge/accepted-scenarios.json`
- `official-worker/test/ssgeMarketplace.test.mjs`
- `tests/helpers/marketplaceEdgeHarness.mjs`
- `tests/matrix/findPropertyHistoryProduction.test.mjs`
- `tests/matrix/marketplaceSearch.test.mjs`
- `tests/mobile/findPropertyMarketplace.test.mjs`
- `docs/ssge-acceptance-review.json`
- `docs/ssge-production-integration.md`
