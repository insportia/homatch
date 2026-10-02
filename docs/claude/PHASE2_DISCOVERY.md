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

## What was built (branch ccr-76ef455d-0qvt80)

Status words: BUILT = code + tests on the branch; PROVEN = executed in
production with evidence (filled in by the release, not by this list).

| Area | What | Where |
|---|---|---|
| Safety | v1 run-matching / classify-signals service-role only; external-unlock key per dialog | `run-matching`, `classify-signals`, `ExternalContactUnlockModal.tsx` |
| DiscoveryPlan | one envelope for SUPPLY and DEMAND; tranches 0–2; closed provider set; queue rows derived only from the plan (dedupe keys); stored per run | `research-core/discovery/discovery-plan.ts`, `discovery_search_plans` |
| Queue | `claim_discovery_source_jobs_v2`: one job per run per pass, least-recently-served run first, per-provider caps (`discovery_provider_concurrency`), executor EDGE/WORKER, paused runs held | migration `20261009100000` |
| Lifecycle | `discovery_control` pause / resume / stop (owner-checked, atomic) for both run kinds; pause expires before the reservation; stuck endings rescued | migration, `driver.ts` |
| Find People | match-campaign stores the DEMAND plan, queues from it, exposes pause/resume/stop; Matches restores the open search on refresh; controls first on phones | `match-campaign`, `MatchesPage.tsx` |
| Find Property | `find-property-run` (PAYG, product FIND_PROPERTY priced like FIND_CLIENTS); PORTAL jobs via `supply-discovery` mode `portal-job`; run ending resolves entities, matches, settles only delivered listings | `find-property-run`, `discoveryRun.ts`, `driver.ts` |
| Root-cause fix | `supply_matches` shape `EXTERNAL_LISTING` (plan × external listing); before this no external listing could reach a customer's search | migration §7, `supply-matching` |
| Community supply | Telegram/forum listing posts → `supply_observations` (deterministic extractor, field origins, backfill mode); order-insensitive fingerprint; results and delivery counted per entity; resolver scoped by city | `community-listing.ts`, `communitySupply.ts`, `classify-signals-v2` |
| Worker route | `/discovery/fetch` on the official worker: token-only, every DNS answer public, pinned connection, no redirects, capped; `WorkerTransport` keeps allowlist/robots/rate limits on the edge | `official-worker/src/discovery/*`, `research-core/fetch/worker-transport.ts` |
| Live checks | `source-audit` mode `live-check`: configured portals collect 2 rows per route; candidate hosts (MyHome, livo, ss, home, place) robots-first; rows in `discovery_source_live_checks` | `source-audit` |
| Admin | `admin_discovery_intelligence()` + panel under /admin/discovery; Phase 2 switches; run live checks | migration `20261009100100`, `DiscoveryIntelligencePanel.tsx` |
| UI | Find Property "Search outside HOMATCH": budget, real stages, source groups, pause/resume/stop, refresh-safe | `OutsideSearchPanel.tsx` |

Hardening (D1–D2, after the 2026-10-02 reconciliation):

| Fix | Behaviour | Where |
|---|---|---|
| D1 ss.ge id | a run plans the ids the portal runtime executes (`ss-ge`), not the `PORTAL_SOURCES` labels (`home-ss-ge`) | `research-core/discovery/portal-selection.ts`, `find-property-run` |
| D2 billing | owner rule: 0 delivered → reservation released, charge 0; otherwise unit price (plan the run started under) × delivered properties, capped at the reservation; duplicates, INVALID/REMOVED, incompatible and already-delivered properties never billed; settled once per run; a settle that errors releases | `_shared/findPropertySettlement.ts`, `_shared/discoveryRun.ts` (shared `billing.ts` untouched) |

Provenance (P1–P3): every Find Property external result carries `attribution`
— exact post / listing permalink, channel / board / site, forum thread, author
name and profile, the post as written (public contacts kept) — resolved in two
batched reads (`raw_signals` by `field_origins.rawSignalId`, then
`source_registry`) in `find-property` (`research-core/discovery/attribution.ts`).
forum.ge stores the exact post (`findpost`) as `source_url`, the topic as
`parent_url`, the `showuser` profile as `author_public_url` (forward; re-reads
refresh old rows). Only real http(s) links are stored or opened
(`source-link.ts`, `src/lib/safeExternalUrl.ts`); no `signal:` placeholder.

Not built (named, not hidden): browser rendering on the worker
(WORKER_BROWSER route), a canonical DEMAND entity with cross-source demand
dedup, one scorer for both directions, revalidation schedule for supply,
R2 artifacts, MyHome/livo adapters (they wait for the live check),
COGS×3/×10 strength pricing (owner decision pending).

## Operating it

Switches (all OFF after the migration; admin_settings, or /admin/discovery):

| Key | Effect |
|---|---|
| `campaign_source_discovery_enabled` | Find Buyers campaigns queue Telegram/forum jobs for a gap |
| `find_property_discovery_enabled` | customers may start a paid Find Property run |
| `discovery_worker_route_enabled` + `discovery_worker_portal_adapters` | listed live portals fetch through the official worker |
| `discovery_provider_concurrency` | per-provider in-flight caps for the claim |

Enablement order for a first production proof: apply both migrations →
deploy edge + worker → admin "Run live checks" → promote only portals that
pass to `source_registry.lifecycle = LIVE_TESTED` (operator decision) →
`classify-signals-v2` `{"mode":"community-supply-backfill"}` (zero cost) →
switch on `find_property_discovery_enabled` → one owner-funded run.

Recovery (§61): plans, runs, events, live checks and every observation live
in Postgres (Supabase backups). Provider/switch configuration is
`admin_settings` (in the migration defaults + this table). The worker is
stateless apart from Railway variables (WORKER_TOKEN, TELEGRAM_*): a
redeploy of `homatch-official-worker` restores it; the Telegram session
string lives only in Railway variables and must be re-issued by the owner if
lost. No R2 artifacts are produced by Phase 2 yet.

Local proof of the migrations: `bash tests/sql/run-phase2.sh` (Postgres 16;
applies both migrations twice to a fixture copied from production columns and
runs the behavioural checks).

## Phase 2 completion (continuation after #66, base `2be7037c`)

Status words: IMPLEMENTED = code on the branch; FIXTURE_TESTED = tests on
captured (CAPTURED) or written (DOC_SHAPED / SYNTHETIC) fixtures; LIVE_TESTED =
a real production proof (a passing `discovery_source_live_checks` row or real
collected rows) — never claimed from code or fixtures. The single source of
truth is `src/research-core/discovery/source-capabilities.ts`
(`SOURCE_CAPABILITIES` + `sourceStatus()`), rendered in /admin/discovery
("Source readiness").

### Source matrix (2026-10-02, code + read-only production)

| Source | Implementation | Fixture | Live tested (prod evidence) | Retrieval | Status now | Blocker / next step |
|---|---|---|---|---|---|---|
| ss.ge / home.ss.ge | IMPLEMENTED (`ss-ge`) | CAPTURED | yes — 15 observations 2026-09-25; no live-check row yet | EDGE_HTTP | READY until 2026-10-09 (proof = 09-25 production rows) | run the live check before the window closes |
| myhome.ge | CANDIDATE (`myhome-ge`, live check only) | SYNTHETIC | no | WORKER_BROWSER | BLOCKED | 403 to non-browser clients; registry BLOCKED; needs browser route on + live check |
| livo.ge | CANDIDATE (`livo-ge`) | SYNTHETIC | no | EDGE_HTTP | BLOCKED | never surveyed; not in registry; live check reads robots-declared sitemaps |
| place.ge | IMPLEMENTED | CAPTURED | yes (4 obs, 09-25) | EDGE_HTTP | READY until 2026-10-09 | live check |
| home.ge | IMPLEMENTED | CAPTURED | yes (2 obs, 09-25) | EDGE_HTTP | READY until 2026-10-09 | live check |
| home24.ge | IMPLEMENTED | CAPTURED | yes (3 obs, 09-25) | EDGE_HTTP | READY until 2026-10-09 | live check |
| zaraya (zarayaproperties.com) | IMPLEMENTED | CAPTURED | yes (2 obs, 09-25) | EDGE_HTTP | READY until 2026-10-09 | live check |
| realting.com | IMPLEMENTED | CAPTURED | yes (3 obs, 09-25) | EDGE_HTTP | READY until 2026-10-09 | live check |
| estatemarket.ge | IMPLEMENTED | CAPTURED | yes (3 obs, 09-25) | EDGE_HTTP | READY until 2026-10-09 | live check |
| makler.ge | IMPLEMENTED | CAPTURED | no | EDGE_HTTP | BLOCKED (awaiting proof) | live check + registry row |
| Telegram | IMPLEMENTED | CAPTURED | yes — collecting today (618 raw signals; 23 forward supply obs) | TELEGRAM_MTPROTO | READY | backfill waits for approval |
| forum.ge | IMPLEMENTED | CAPTURED | yes (744 raw signals, last 09-26) | EDGE_HTTP | DISABLED (switch off) | `forum_discovery_enabled` |
| Facebook Pages | ACCESS_GATED (`meta-graph-discovery.ts`) | DOC_SHAPED | no | OFFICIAL_API | BLOCKED | needs Page Public Content Access under a discovery-only Meta app (owner decision) |
| Facebook groups | NOT_IMPLEMENTED | — | no | NONE | BLOCKED | Groups API removed 2024-04-22; login-walled; Apify retired |
| Instagram | ACCESS_GATED | DOC_SHAPED | no | OFFICIAL_API | BLOCKED | linked professional account + App Review |
| LinkedIn | NOT_IMPLEMENTED | — | no | NONE | BLOCKED | no third-party content API; login wall; ToS; LINKEDIN_SCRAPE forbidden in repo |

The older anonymous `adapters/facebook.ts` / `instagram.ts` HTML readers stay
unwired (they meet login walls and carry a text-hash id fallback); nothing
calls them.

### Architecture

```
SOURCE ADAPTERS   portal (configured / ss-ge / candidates) · Telegram · forum · Meta Graph
      ↓
NORMALIZATION     discovery/discovery-entity.ts  (SUPPLY and DEMAND, one shape; public-contacts.ts)
      ↓
DEDUPE            discovery/cross-source-dedupe.ts
      ↓
SCORING           match/unified-score.ts = assessMatch relevance × evidence quality
      ↓
MATCHING          supply-matching (Find Property) · run-matching-v2 (Find Buyers)
      ↓
PROVENANCE        discovery/attribution.ts (#66 contract) + alsoSeenAt
      ↓
BILLING           findPropertySettlement.ts (per delivered PROPERTY) · matches (per person)
```

- **Browser discovery worker** — NOT IN THIS RELEASE. `homatch-official-worker`
  also runs Verify, so any `official-worker/` change redeploys Verify's host;
  the worker side (`official-worker/src/discovery/BrowserRender.ts`,
  `POST /discovery/render`, real-Chromium tests) is prepared at commit
  `658a6a74` and ships in its own worker release when the owner approves the
  MyHome proof. Design: own Chromium per render (not Verify's browser), every
  request fulfilled by the pinned `SafeFetch` hop (public unicast only),
  images/fonts/media/websockets refused, ≤3 navigations, ≤80 subrequests,
  ≤12 MB, ≤45 s, concurrency 1, scripts stripped (JSON data kept), challenge /
  login wall reported and never worked around, honest UA. Switches (all OFF /
  absent): worker `DISCOVERY_BROWSER_ENABLED=true` + `DISCOVERY_BROWSER_HOSTS`,
  edge `admin_settings.discovery_browser_enabled`. Edge side (in this release,
  inert until then): `fetch/browser-transport.ts`.
- **Candidates** — `adapters/portal/candidates.ts`: registered only by
  `discovery/audit-runtime.ts` (`createAuditPortalRuntime`), i.e. the source-audit
  live check. `market/runtime.ts` is unchanged: Verify imports it, so Phase 2
  never edits it. Routes come from the site's robots.txt `Sitemap:` declarations; a
  listing is a URL with a 6–10 digit id; fields from schema.org/OpenGraph plus
  multilingual text patterns. A passing check is evidence to pin a captured
  configuration; it promotes nothing.
- **Dedupe** — deterministic, evidence-named. Supply: same permalink / source id /
  resolved entity / order-insensitive text fingerprint / image key; or a shared
  public contact WITH same city + transaction + area (±3%) + rooms or price
  (±2%); or coordinates ≤30 m + area + rooms. Demand: same author profile or a
  shared contact with an agreeing request (transaction + city), or near-verbatim
  re-post (3-shingle Jaccard ≥0.8). Vetoes: transaction, city, type, district,
  area >3%, rooms, price >10% (supply); rooms/bedrooms >1, disjoint budget
  (15% slack), >30 days apart (demand). Complete-linkage veto across clusters;
  a blocking key shared by >200 items is ignored (portal-wide phone). Wired:
  Find Property results (one card per property, other sources in
  `alsoSeenAt`), Find Property settlement (one charge per property, resolver
  entities never split), Find Buyers (one match per person per property,
  `duplicatePerson` counter).
- **Scoring** — `score = relevance × (0.5 + 0.5 × quality)`; relevance is
  `assessMatch` (both directions, conflicts = 0); quality of the candidate =
  recency .35, completeness .25, explicitness .20, contactability .10, source
  prior .10 (`QUALITY_FACTORS`, each with its reason). Every pair returns
  `explanation`. Find Property ranking uses it (supply-matching); Find Buyers
  keeps run-matching-v2's live 0–100 scorer for now — moving its ranking
  changes a live paid product and needs an owner decision.
- **Revalidation** — `discovery/supply-revalidation.ts` + `revalidate-supply`:
  portal listings re-read through the SAME adapter extraction and compared
  field by field (price ±3% material, area ±3%, rooms); 404/410 → REMOVED;
  unreadable page → UNKNOWN (not a verification); `content_fingerprint` never
  overwritten; `field_origins.revalidation` keeps checkedAt, availability, HTTP
  status, confidence, changed fields and price history. Community posts are not
  portal-fetched. Intended cadence RENT 3 d / SALE 7 d, ≤25 per run. **No cron.**

### Telegram backlog (read-only audit + local dry run, 2026-10-02)

Pending: 396 FILTERED_OUT SUPPLY posts with no observation (377 Telegram, 19
forum) + 23 already stored. Local dry run of the production extractor over
those rows: **306 new observations** (303 Telegram, 3 forum), 90 stay raw
(no city, or neither price nor area), 23 existing rewritten in place; every
one keeps its exact permalink, author and original text; 63 carry a public
contact. Cross-source dedupe folds the 329 listings into **75 distinct
properties** (largest cluster: one ad reposted 14 times). Cost **$0**: no
model call (the OpenAI key is not read on that path), no `cost_events`, no
reservation. Idempotent upsert on `(source_id, external_id)`; cursor-paged
(`after`) and `dryRun` capable. It cannot create customer charges: it starts no
run, and settlement counts only matches created inside a paid run's window,
one per property. **Verdict: safe to run once approved** (`{"mode":
"community-supply-backfill","batchSize":500}`; optional `"dryRun":true` first).

### R2 / evidence artifacts

Not needed for activation. The database already keeps what evidence requires:
exact permalink, original text (≤4000 chars in attribution), field origins,
revalidation history. Allowed later, only where justified: (1) a browser
render's sanitized HTML for a FAILED or DISPUTED extraction, ≤3 MB each, 30-day
retention, ≤1 GB total; (2) image perceptual hashes (stored as text keys, not
images). Never: bulk page archives, images themselves, private content.

### COGS by retrieval method (measured where possible)

| Method | COGS per item | Basis |
|---|---|---|
| Portal HTTP (edge) | ≈ $0 | Supabase edge invocations within plan |
| Worker HTTP hop | ≈ $0.00001 | Railway CPU seconds (estimate) |
| Telegram MTProto | ≈ $0 marginal | existing worker; no API fee |
| Deterministic extraction / dedupe / scoring | $0 | pure code |
| OpenAI classification (gpt-4o-mini, demand) | **$0.000124 avg, $0.00046 p95** per signal | measured: 130 intent_profiles with ai_cost_usd |
| Discovery browser render | ≈ $0.0001–0.0003 per page | estimate from Railway rates (`BROWSER_COGS_USD_PER_SECOND`), to be replaced by measured render time |
| Meta Graph API | $0 (rate-limited) | official API has no per-call fee; access not granted |

Current Find Property unit price (`billing_price_quote`, product
FIND_PROPERTY): 25 credits ($2.50) per delivered property, reference COGS 59¢.
Measured marginal COGS per delivered listing is under 1¢ for every route above.
**Recommendation (no change made):** keep per-delivered-property PAYG with
zero-delivered = zero charge; consider replacing the 59¢ reference COGS with the
measured route costs after the controlled live proofs. Pricing changes need
owner approval.
