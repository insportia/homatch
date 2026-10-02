# Phase 2 — Universal Discovery: gap map

audited: 2026-10-02 against main `80f09254` + read-only production
(Supabase `ptxajsjhobhvsfhmutjn`, Railway `courteous-success`).
Code reading is not production proof; production facts are marked (prod).

## Owner decisions (2026-10-02)

- Providers: DataForSEO / Apify stay RETIRED; Phase 2 uses native routes only.
- Worker: HYBRID — the DB queue + claim RPC stay canonical; edge executes cheap
  HTTP portal jobs; the official worker gets a NEW discovery module (no Verify
  file touched) that claims Telegram and browser-needed portal jobs.
- Find Property billing: PAYG like Find Buyers (reserve → settle measured
  COGS → release); no new strength multipliers until the owner sets them.
- Verify is FROZEN: no Verify file, prompt, route, billing or DB object is
  changed; shared research-core modules are additive-only.

## Guardrails that shape the plan

- **Verify is frozen.** Verify imports shared `src/research-core/` modules:
  `adapters/portal/types`, `discovery/{adapter,lexicon}`,
  `market/{codeDiscovery,codeDiscoveryTargets,comparables,discoveryPlan,
  discoveryRun,discoverySources,geoResolve,geoTier,runtime}`,
  `plan/{envelope,seed}`. These are additive-only for Phase 2. The worker's
  orchestrator/workflows/browser/evidence/documents/human-assist code is
  Verify and is not touched. `revalidate-evidence` and the `research_*`
  tables belong to the VERIFY component (`scripts/release/components.mjs`).
- **Retired providers.** DataForSEO and Apify are locked by CLAUDE.md
  (stub functions return 423, `isRetiredProvider`, claim-RPC whitelist,
  `research_providers` kill switch). Production (prod): `provider_kill_switch`
  = true; disabled list APIFY, DATAFORSEO, ZENROWS, SCRAPINGBEE, BRIGHTDATA;
  `external_discovery_enabled` = false. Phase 2 stays on native routes unless
  the owner explicitly reverses the retirement.
- **One worker.** `homatch-official-worker` (`3e7f132b…`). A pre-existing
  `homatch-official-worker-v2` service exists in the project; never used.
- **The sandbox cannot reach Georgian portals** (all connects refused), so
  every live source check runs from production runtime.

## Production reality (prod, 2026-10-02)

| Fact | Value |
|---|---|
| Only source collecting now | Telegram via the worker MTProto gateway — 541 raw_signals, latest today |
| Telegram yield | **all 541 FILTERED_OUT**: 356 SUPPLY (listing ads), 178 UNKNOWN, 1 DEMAND |
| Supply intelligence | 32 supply_observations → 1 supply_entity; last write 2026-09-25 |
| Demand | intent_signals 0 (native); raw_signals demand rows ≈ 10, all August/September |
| Campaigns | 1 matching_campaign (2026-08-28); 9 matching_jobs |
| Registry | source_registry 373 rows; active ≈ 30 (19 WEBSITE AUDITED, 7 WEBSITE LIVE_TESTED, 1 FORUM, 1 TELEGRAM) |
| Legacy queue | 6,888 discovery_query_queue rows (APIFY/DATAFORSEO, cancelled/done, history kept) |
| Switches OFF | campaign_source_discovery_enabled, supply_discovery_for_campaigns, forum_discovery_enabled, forum_schedule_enabled, community_discovery_enabled, external_discovery_enabled |
| Switches ON | telegram_discovery_enabled, discovery_background_refresh_enabled |

## Gap map

| Capability | Status | Evidence / note |
|---|---|---|
| Campaign → run (FIND BUYERS/TENANTS) | WORKING | match-campaign → run-matching-v2; PAYG `beginExecution(FIND_CLIENTS)`; idempotency key; one running job per property |
| Campaign kind / direction column | MISSING | matching_campaigns has no direction; kind is implied by product code |
| Manual-criteria demand campaign (no property) | MISSING | campaigns start only from a property |
| SearchPlan | PARTIAL | `research-core/discovery/search-plan.ts` used only by find-property-plan; Find Buyers has none |
| FIND PROPERTY plan + results | WORKING (internal) | find-property-plan → active_search_subscriptions(side) → supply-matching cron */15 → supply_matches → find-property |
| FIND PROPERTY external supply | DISABLED | supply-discovery (portal adapters via SSRF-guarded `createPortalRuntime`) only runs when `supply_discovery_for_campaigns`=true; never wired to Find Property |
| Plan-tier gating in supply-discovery | NEEDS REARCHITECTURE | FREE/VIP/PREMIUM entitlements (`supply-discovery:418-472`) violate PAYG-only |
| Source queue (claim/lease/backoff/finish) | WORKING, narrow | `claim_discovery_source_jobs` (SKIP LOCKED, lease, 30·2^n backoff, cost_unknown ≠ 0) — whitelists TELEGRAM / TELEGRAM_SOURCES / FORUM only; driven by edge `discovery-queue-worker` (cron every minute) |
| Railway worker as job runtime | MISSING | worker has no DB claiming; it is Verify FSM + Telegram gateway + speech |
| Fair queueing per campaign/provider | MISSING | claim RPC is FIFO by priority; no per-campaign/provider share |
| Pause / resume / stop | PARTIAL | customer pause = client UPDATE (job keeps running, reservation not released); admin stop is server-side |
| Campaign persistence across refresh | PARTIAL | MatchesPage loses the running job on refresh (component state) |
| Source registry | WORKING | `source_registry` + lifecycle + priority tiers + `community_targets` cursors |
| Provider registry | PARTIAL / DRIFT | three overlapping: research_providers (locked), finance_provider_registry (APIFY/DFS still active=true), provider_health |
| Per-provider spend caps on the new path | MISSING | only legacy `external_provider_budget_allows`; new path relies on campaign reservation |
| Telegram collection | PROVEN (prod) | 541 messages; cursors; redaction; token-only gateway |
| Telegram → classification | WORKING but lossy | classify-signals-v2 is demand-only; SUPPLY posts are discarded instead of becoming supply observations |
| Forum (forum.ge) demand | DISABLED | adapter WORKING in code; schedule off |
| Portals P0/P1 | PARTIAL / UNPROVEN | place.ge, home.ss.ge, home.ge adapters + fixtures in research-core; **no myhome.ge, no livo.ge adapter**; no live check since 2026-09-25 |
| MyHome | UNPROVEN | no adapter; re-audit must run from production runtime |
| Normalization | PARTIAL | supply_observations normalized; demand via intent_profiles (recreated on reclassify → unstable ids) |
| Observation vs entity (supply) | WORKING schema, UNPROVEN behaviour | supply_observations / supply_entities / supply_resolution_decisions / campaign_supply_references |
| Observation vs entity (demand) | MISSING | no canonical demand entity; no cross-source demand dedup |
| Entity resolution | PARTIAL | `entity-resolution.ts` verdicts + confidence; only in supply-discovery; O(n²) over 60 rows, no city filter |
| Freshness | PARTIAL / INCONSISTENT | 30-day demand rule forward (run-matching-v2, atomic-unlock); reverse supply-matching uses 180/365-day decay; unlock-external-contact skips it |
| Revalidation | BUILT, NOT SCHEDULED | revalidate-supply has no cron; revalidation_queue requested only by run-matching-v2 |
| Matching (hard constraints first) | WORKING ×2 | run-matching-v2 own scorer + structured gates; supply-matching `assessMatch()` — two scorers |
| Match explanation | PARTIAL | component scores stored; reverse has agreed/conflicted buckets |
| Locked preview + unlock | WORKING (matches) | preview_* server columns; atomic-unlock server-authoritative; external unlock duplicate path |
| External unlock idempotency | BUG | `ExternalContactUnlockModal` key from `Date.now()` in render |
| Pricing COGS×3 / ×10 | MISSING | not in code; current = billing_price_quote multiple + tier base × multipliers; BILLING.md marks 10× ambiguous |
| Reserve → settle → release | WORKING | wallet v2 for campaigns; Find Property runs free |
| SSRF | WORKING (edge) / MISSING (worker) | `research-core/net/*` DNS-classify + 3 re-validated redirects; no IP pinning; worker has none |
| R2 artifacts for discovery | MISSING | — |
| Admin Intelligence | PARTIAL | /admin/discovery, campaigns, sources, signals, intelligence, supply-matches, providers exist; no observation/entity/cluster view, no job inspector drill-down, no per-source cost |
| Customer live progress | WORKING (people) / COARSE (property) | MatchingJobProgress reads real job events; Find Property shows one SEARCHING state |
| Mobile / RTL | PARTIAL | controls render below the results list < xl; physical margins in matches/unlock |
| Legacy security risk | RISK | run-matching v1 and classify-signals v1 deployed no-jwt **without auth** (v1 classify can spend OpenAI) |
| Duplicates (LEGACY) | LEGACY | canonical_property_groups, intelligence_entities, ai_chat_leads, property_signal_candidates, credit_reservations, cost_events vs finance_provider_cost_events, two freshness policies, external-discovery-orchestrator, continuous-matching-worker, seed-discovery-queries, generate-search-profile |

## Shortest safe path to two vertical slices

Slice 0 — safety (DONE on branch, tests in tests/matrix/phase2Discovery.test.mjs)
- v1 run-matching / classify-signals: service-role callers only (403 otherwise).
- External unlock: one idempotency key per dialog opening.

Slice A — FIND BUYERS / TENANTS (most of the chain exists)
- SearchPlan(direction=DEMAND) compiled for every campaign (stored, inspectable).
- Server-side pause/resume/stop that halts source jobs and releases the
  unused reservation; job rediscovered on refresh.
- Fair claim (per-campaign share) in the existing claim RPC (new version,
  additive).
- Telegram + forum demand under campaign control; prove one real campaign:
  campaign → plan → queue → claim → worker MTProto → raw → classify →
  freshness → run-matching-v2 → matches → preview → unlock path.

Slice B — FIND PROPERTY (supply must start flowing)
- SearchPlan(direction=SUPPLY) from find-property-plan (already exists) →
  PORTAL source jobs in the same queue (provider whitelist extended to the
  native portal route), executed by supply-discovery's portal runtime.
- Telegram SUPPLY posts become supply observations instead of being
  discarded (structured extraction, provenance kept).
- PAYG instead of plan-tier gating; COGS recorded (unknown ≠ 0).
- Entity resolution scoped by city; supply-matching → supply_matches →
  Find Property results with real stages.
- P0 portals proven live from production: ss.ge, home.ge, place.ge; MyHome
  and livo.ge re-audited from the runtime before any adapter is written.

Later (after both slices are proven): Admin Intelligence views
(observations/entities/clusters, job inspector, per-source cost), canonical
demand entity + cross-source dedup, revalidation schedule, one scorer,
R2 artifacts, mobile/RTL polish, legacy retirement.
