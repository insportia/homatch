# Find Property — Marketplace Search foundation

Status: **built, not activated**. Migration prepared and locally tested, **not
applied**. No marketplace worker exists. `marketplace_search_enabled` is seeded
OFF; while it is off (or the service is unreachable) `/find-property` renders the
existing Find Property unchanged.

```
User → Search Builder → OpenAI Search Intelligence (call 1, strict schema)
     → Search Readiness Gate (same function client + server; server authoritative)
     → canonical SearchPlan (discovery_search_plans, plan_kind = MARKETPLACE)
     → N marketplace workers (registry; none yet)  ← marketplace-worker-ingest
     → raw candidates (discovery_marketplace_listings, raw kept verbatim)
     → validation → normalisation → hard filters → property entity resolution
     → seller intelligence → price intelligence → freshness → ranking
     → budget upgrades (≤ +10%) → groups → OpenAI Results Intelligence (call 2)
     → discovery_marketplace_properties (public view + admin-only internals)
     → results / property intelligence / compare / Investment / Mortgage
```

## Code map

| Layer | Where |
|---|---|
| Vocabularies | `src/research-core/marketplace/taxonomy.ts` (property_type enum, AI TALK shell states, condition_type) |
| Brief (OpenAI call 1 schema, STATED / PROPOSED / CONFIRMED, number traceability) | `marketplace/brief.ts` |
| Readiness gate, rules by property class | `marketplace/readiness.ts` |
| Worker contract, registry predicates, payload validation | `marketplace/worker-contract.ts` |
| Normalisation, current-listing validation, freshness | `marketplace/normalize.ts` |
| Property entity resolution (on `discovery/entity-resolution.ts`) | `marketplace/property-entity.ts` |
| Seller, price, ranking, upgrades, comparison, lifecycle, telemetry, handoffs | `marketplace/*.ts` |
| Pipeline (pure) | `marketplace/pipeline.ts` |
| OpenAI call 2 contract and acceptance | `marketplace/results-intelligence.ts` |
| Server helpers (processAndStore, OpenAI, cost) | `supabase/functions/_shared/marketplaceSearch.ts` |
| Customer API (JWT) | `supabase/functions/marketplace-search` |
| Worker API (own token, no JWT) | `supabase/functions/marketplace-worker-ingest` |
| Schema | `supabase/migrations/20261010100000_marketplace_search_foundation.sql`; local proof `tests/sql/run-marketplace.sh` |
| UI | `src/components/findProperty/*`, gate in `src/pages/FindPropertyPage.tsx` |
| Admin | `AdminMarketplacePanel` inside Discovery Intelligence; RPC `admin_marketplace_search_intelligence` |
| Fixtures (tests only) | `src/research-core/__tests__/fixtures/marketplaceFixtures.mjs` |

## Audit: existing → decision

| Existing | Decision |
|---|---|
| `discovery/search-plan.ts` SearchPlan + normalisePlan | **REUSE** — the brief maps onto it (`toSearchPlanDraft`) so native matching keeps one vocabulary |
| `discovery/entity-resolution.ts` `resolve()` | **REUSE** — pairwise verdicts; price never a contradiction |
| `discovery/cross-source-dedupe.ts` | **RETAINED** for Phase 2 billing; not used here (its 10% price veto would split the multi-price flat this product exists to show) |
| `discovery/source-link.ts`, `public-contacts.ts`, `listing-age-policy.ts`, `normalize/place.ts`, `normalize/currency.ts`, `match/structured-gates.ts` (fx_rates) | **REUSE** |
| `discovery_search_plans` | **EXTEND** — `plan_kind` |
| `discovery_runs` / `discovery_run_events` / queue / driver | **RETAINED, NOT REUSED** — billed, driver-advanced; a free search sharing it would be one status from settlement |
| `supply_entities` / `supply_observations` | **EXTEND (by reference)** — nullable `entity_id` / `observation_id` links for later promotion |
| `find-property`, `find-property-plan`, `find-property-run`, OutsideSearchPanel | **RETAINED** — the legacy experience while the switch is off; the paid run is the natural Deep Search backend later |
| Legacy Find Property UI (`LegacyFindPropertyPage`) | **DISCONNECT when activated; SAFE TO REMOVE LATER** once Marketplace Search is live |
| Investment (`?propertyId=` only) | **EXTEND** — accepts a Find Property handoff via router state (stated facts, PROPERTY origin) |
| Mortgage (`location.state.context`) | **REUSE** as is |
| Snake game | **Did not exist anywhere in the repository or its history**; a small isolated `SnakeGame.tsx` was added (owner decision flagged) |
| `_shared/fx.ts` | **NOT USED** — imports a Verify module; operator `fx_rates` only |

## Adding a marketplace worker (MyHomeAgent, SSAgent, PlaceAgent, …)

Nothing in Find Property changes. For e.g. `myhome-agent`:

1. **Implement** a worker (browser/HTTP/API — the core does not care) that:
   - `POST marketplace-worker-ingest {action:'claim'}` with headers
     `x-homatch-worker: myhome-agent`, `Authorization: Bearer <its token>` →
     receives `[{ runId, deadlineAt, request: MarketplaceSearchRequest }]`;
   - translates the request into the site's own filters (collect up to
     `collectPriceMaxUsd`, never widen anything else);
   - `POST {action:'report', runId, result: MarketplaceWorkerResult}` one or
     more times (`RESULTS_RECEIVED` batches, then a terminal status), listings
     as `ExternalListingCandidate` with `source = 'myhome-ge'`.
2. **Declare capabilities**: one `discovery_marketplace_workers` row
   (`worker_id`, `source_key`, markets, types, transactions, filters,
   `execution_mode`, `timeout_ms`, `max_results`, `token_hash = sha256(token)`),
   state `REGISTERED`.
3. **Prove** it: `TESTING` → live proof against real pages (exact URLs,
   normalised fields) → `PROVEN`.
4. **Enable**: `ACTIVE` + `enabled = true` (the table refuses `enabled` unless
   `ACTIVE`; the claim RPC gives nothing to anything else).

SSAgent (`ss-ge`) and PlaceAgent (`place-ge`, currently HTTP 403 → likely
`BROWSER`) follow exactly the same four steps.

## Activation checklist (owner approval required for each)

1. Apply the migration in release order (not applied by this PR).
2. Deploy `marketplace-search` and `marketplace-worker-ingest` (both in deploy.yml lists).
3. Register, prove and enable at least one worker.
4. `marketplace_search_enabled = true`; `provider_kill_switch` must be off for dispatch.
5. Production proof: one search end to end, cost_events rows for both OpenAI calls.

Deep Search stays unavailable in the UI until its own backend and billing exist.
