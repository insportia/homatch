# Homatch Research Core

`src/research-core/` — shared research infrastructure.

## What it is, and what it is not

Homatch already has a research system, and this does not replace any part of it:

| Existing, authoritative | Owns |
|---|---|
| `research_jobs` | The evidence of record. Service-role writes only; the customer may update four label/lifecycle columns and nothing else. |
| `research-agent` | The five-stage pipeline (IDENTITY → OFFICIAL_COLLECTION → PUBLIC_RESEARCH → MARKET → SYNTHESIS) and its cron driver. |
| `official-worker` | Recorded Playwright workflows against the Georgian official registries, with the CAPTCHA pause/resume/skip lifecycle. |
| `EvidenceTypes.ts` | The evidence vocabulary: `EvidenceItem`, `SourceClass`, `VerificationState`, `ContradictionRefs`. |
| `intelligence_*` | The persistent fact graph, with provenance enforced as a DB constraint and per-fact-key freshness policy. |
| `_shared/billing.ts` | Funding, tier, ceilings, priority. `beginExecution` / `settleExecution` / `releaseExecution`. |
| `src/verify/cogs.ts` + `provider_price_book` | What things cost, effective-dated, with unpriced dimensions named rather than zeroed. |
| `research_providers`, `provider_health`, `_shared/spend_cap.ts` | Which providers may be called, and how much they may spend. |
| `research_cache` | Fetched records, with `freshness_status` and `hit_count`. |

The Research Core is the **infrastructure tier underneath** those, plus the
**bridges** that hand its output to them. It supplies what Homatch did not have:
a deterministic HTTP fetch path with an SSRF boundary, robots handling, per-source
rate limiting and circuit breaking, request coalescing, stale-while-revalidate,
work-class scheduling, document deduplication, source-independence counting,
conflict preservation, and the Investment research contracts.

## Five rules

1. **Runtime-neutral.** No `node:` imports, no `Deno.*`, no `process.*`, no `Buffer`,
   no `NodeJS.*` types, no constructor parameter properties, no enums, no
   decorators. It must type-check in the Vite build, run under `node --test`'s
   strip-only TypeScript mode, and import cleanly into a Deno Edge Function.
   Enforced by `__tests__/runtimeNeutrality.test.mjs`.
2. **No customer-facing strings.** Homatch's are localized across six locales and
   pass through `sanitizeCustomerReport` / `assertNoLeaks`. The core emits codes
   and data; `EvidenceItem.claim` is an *input* to the bridge, never composed by it.
3. **No pricing.** The core reports measured `ProviderUsage`. `bridge/cost.ts`
   converts that into the shapes `cogs.ts` and `billing.ts` already take.
4. **No direct paid-provider access.** Everything metered goes through
   `ProviderPort`, which the host implements over `_shared/providers.ts`, so
   kill switches, spend caps and health checks all remain in force.
5. **Nothing is silently resolved.** Duplicates are marked, not deleted.
   Conflicts are preserved, not averaged. An unknown cost is a named gap, never a
   zero. An unavailable answer says why.

## Layout

```
src/research-core/
  core/       vocabulary, errors, ids, sha256, clock, logger
  net/        ip classification, network policy (SSRF), robots, source policy
  fetch/      transport, fetch transport, http client, cached fetcher, mock transport
  flow/       scheduler, coalescer, refresh coordinator, rate limiter,
              circuit breaker, backoff, semaphore, token bucket, deadline
  parse/      html, json-ld, metadata, schema.org, normalized listing
  normalize/  url, domain, currency, area, dates, geo, text, numbers,
              address, hash, content-type, language, collections
  score/      document dedupe, independence, conflicts, pooling
  observe/    metrics
  profiles/   profile contracts, the Investment profiles, coverage
  bridge/     evidence, cost, budget, cache-key, freshness, provider-port
  __tests__/  *.test.mjs, picked up by `npm test`
```

---

## How to add a source

A source is an entry in a `SourceAccessPolicyRegistry`. There is deliberately no
seeded catalogue in the repository: whether a given site may be fetched is a
legal and commercial question per source, and shipping a default list would be
answering it silently.

```ts
registry.register({
  ...DEFAULT_SOURCE_POLICY,
  id: 'myhome.ge',
  domains: ['myhome.ge'],
  sourceFamily: 'myhome.ge',     // REQUIRED — see "source families" below
  kind: 'PROPERTY_PORTAL',
  robots: 'RESPECT',
  rate: { concurrency: 2, requestsPerSecond: 2, burst: 4 },
  cacheTtlMs: 6 * 3600_000,
  cacheStaleMs: 18 * 3600_000,
  visibility: 'PUBLIC',
  authority: 0.5,
  notes: 'Why we believe we may fetch this, and under what terms.',
});
```

`notes` is not decoration. Fill it in.

### Source families

`sourceFamily` is required and has no default. It is the publisher group, and
independence counting depends on it: five portals republishing one developer's
feed are five observations and **one** independent source, and nothing in a URL
reveals that relationship. A source with no configured policy falls back to the
family `'unknown'`, which makes every unconfigured source a sibling of every
other one — deliberately pessimistic, so independence is under-counted rather
than invented.

Sibling weights are passed to `computeIndependence`:

```ts
computeIndependence(deduped, {
  weights: { siblingWeight: { 'syndicate-x': 0 }, defaultSiblingWeight: 0.25 },
  subjectOf: (o) => o.structuredSourceId ?? o.id,
});
```

A family with `siblingWeight: 0` is a pure mirror network and contributes exactly
one observation of weight however many domains it publishes under.

**Always pass `subjectOf` when gathering comparables.** Three listings on one
portal are three *different* properties and must not discount each other. The
default assumes everything in a family is about the same subject, which is the
cautious direction but wrong for comparables.

---

## How to add a paid provider

You do not add one inside the core. You implement `ProviderPort` outside it.

1. Add or confirm the `research_providers` row (`provider_code`, `enabled`,
   `kill_switch`, caps). **A provider with no row is treated as not permitted.**
2. Add a case to `provider-health-check/index.ts` so its health is real rather
   than assumed.
3. Add rows to `provider_price_book` for every unit it bills. Without them the
   run is recorded as `unpriced`, which is correct but visible.
4. Implement the client in `supabase/functions/_shared/providers.ts`, using the
   existing `SearchProvider` / `SocialCollectorProvider` / `AIProvider` interfaces.
5. Implement `ProviderPort` over that client. It **must**:
   - call `checkSpendCap(provider)` and refuse with `SPEND_CAP_REACHED`;
   - honour `research_providers.enabled` / `kill_switch`;
   - refuse rather than exceed `budgetCeilingCents`;
   - return `costCents` only when the provider actually reported it. **Omitting
     it means "unknown"; zero means "free". They are not the same and must never
     be substituted for each other.**
6. Hydrate the source registry: `registry.hydrateFromProviderRows(rows)`. This
   can only ever *disable* a source — a table an admin can edit must not be able
   to widen what the code permits.

**DataForSEO and Apify are deliberately locked.** `dataforseo-search` and
`source-monitor-public` answer HTTP 423 with `paidLaunchesBlocked`, and the
seeded `research_providers` rows have APIFY at LOCKED with BRIGHTDATA and TGSTAT
disabled. Do not unlock them as a side effect of adding something else.

---

## How to add an adapter (a parser for a new site shape)

> Superseded by Part 2, which introduced a real `SourceAdapter` interface and an
> `AdapterRegistry` — see "Adding another platform" at the end of this document.
> What follows still describes the parsing half correctly, and is the right
> starting point for the body of an adapter's `extract` step.

A "source adapter" in the Part 1 sense is a function of the form:

```ts
(document: StoredDocument, options) => Observation
```

Compose it from the parse layer, as `__tests__/investmentFlow.test.mjs` does:

```ts
const doc = parseHtml(document.body);
const listing = deriveSalePricePerSqm(
  mergeListing(emptyListing(), listingFromJsonLd(extractJsonLd(doc).nodes, {
    saleBasis: 'ASKING_SALE_PRICE',   // what a price on THIS source means
    rentBasis: 'ASKING_RENT',
  })),
);
```

`saleBasis` comes from the source policy, not from the markup. schema.org cannot
tell you whether an `Offer.price` is a portal listing or a developer's own price
list — that is a fact about whose page it is. A caller that does not know passes
`UNKNOWN`, and the arithmetic downstream has to cope, which is the honest
outcome.

Always produce all three URLs (`requestedUrl`, `fetchUrl`,
`canonicalIdentityUrl`) and both timestamps (`observedAt` is what the source
says, `retrievedAt` is when we read it). Conflating either pair has caused real
bugs.

---

## How to add a research profile

A profile is a contract, not a script: what must be established, what evidence
counts, how close to the subject it must be, and the floor below which nothing
may be reported.

```ts
export const MY_PROFILE: ResearchProfile = {
  id: 'MY_PROFILE',
  productCode: 'MY_PRODUCT',      // billable_products.code, or null
  defaultWorkClass: 'INTERACTIVE_NORMAL',
  usefulWithoutAi: true,
  limits: { softDeadlineMs, hardDeadlineMs, maxDocuments, maxSources },
  objectives: [{
    id: 'my.objective',
    acceptedPriceBases: ['ASKING_SALE_PRICE'],
    preferredLevels: ['SAME_BUILDING', 'MICRO_LOCATION'],
    gate: { minIndependentSources: 2, minObservations: 3, maxEvidenceLevel: 'MICRO_LOCATION' },
    notes: 'Why this objective exists and what it is not.',
  }],
  notes: '...',
};
```

Rules the tests enforce:

- **No objective may accept both an asking basis and an achieved basis.**
  Accepting both is the same as converting between them.
- **No objective may accept `UNKNOWN`.**
- Every gate needs `minIndependentSources >= 1` — written in *independent
  sources*, not observations, because a gate written in observations is one
  syndication walks straight through.
- If the answer is not obtainable from public sources in this market, say so with
  `knownUnavailable: { reason, note }`. The objective is then reported
  UNAVAILABLE without spending anything, and the customer is told why rather than
  shown a blank. `SOURCE_DOES_NOT_PUBLISH_IT` means "stop asking";
  `NOT_ENOUGH_EVIDENCE` means "try harder".
- `productCode` names a row that a **pricing migration** must create. This work
  deliberately creates none: a `billable_products` row is a pricing decision and
  lives in SQL with the rest of billing v2.

---

## How to add an evidence type

You almost certainly should not. `EvidenceType` in
`official-worker/src/evidence/EvidenceTypes.ts` is the authoritative vocabulary
and the customer report is built from it. If a new one is genuinely needed:

1. Add it to `EvidenceTypes.ts` — that file is the source of truth.
2. Mirror it in `src/research-core/bridge/evidence.ts`.
3. `__tests__/bridge.test.mjs` reads both files and fails if they disagree. That
   is the only thing stopping the mirror drifting, so do not weaken it.

Mirroring rather than importing is deliberate: `official-worker` is a separate
Node service with its own tsconfig, and `_shared/billing.ts` is Deno code with
URL imports the Vite build cannot resolve. Importing across either boundary would
couple three deployment units.

---

## How to configure freshness

There are **two different questions** and confusing them is how a six-hour
mortgage check gets answered from a day-old page.

| Question | Where it is decided |
|---|---|
| How long may we reuse the *bytes* of this page? | `SourcePolicy.cacheTtlMs` / `cacheStaleMs`. A property of the source. The core decides this one. |
| How long does what the page *said* stay good? | `intelligence_freshness_policy`, per fact-key pattern, in the database. `src/verify/intelligence/freshness.ts` implements the judgement. **The core does not decide this and must not.** |

`judgeDocumentAge` answers the first. For the second, implement
`FactFreshnessPort` outside the core over the existing DB-driven policy. The
default, `alwaysRecheck`, says everything needs re-checking: it costs money and
never reports a stale fact as current, so forgetting to wire the real policy is a
visible omission rather than a silent one.

Ownership changes on a Tuesday. A building does not gain a floor. One TTL for
both is too slow for the mortgage and too eager for the floor count.

---

## How to configure cost

You do not, in the core. Rates live in `provider_price_book`, effective-dated,
and `src/verify/cogs.ts` prices against them.

The core reports `ProviderUsage`:

| Field | Meaning |
|---|---|
| `networkRequests` | HTTP requests issued, redirects and retries included. |
| `billableRequests` | The subset the provider actually bills for. |
| `providerUnits` | Provider-defined units where they are not requests. |
| `cacheHits` | Served from `research_cache`. |
| `coalescedRequests` | Joined an in-flight request; issued no call of their own. |

`bridge/cost.ts` converts it:

```ts
const usage = totalUsage(results, 'DATAFORSEO');
await settleExecution(sb, grant, toActualUsage(usage, { rawProviderCostCents: reported }));
await sb.from('cost_events').insert(toCostEventRow(usage, { operationType: 'RESEARCH_SEARCH', jobId }));
```

A redirect hop and a retried attempt are both network requests and neither is a
billable unit; `toActualUsage` maps `billableRequests`, not `networkRequests`, so
a slow source that redirects four times does not cost four times as much.

`avoidedProviderCalls(usage)` reports what caching and coalescing saved, **in
calls, not money** — turning it into money needs a rate, the rate is in
`provider_price_book`, and the core does not read it. Price avoided calls with
the same rates you price real ones with; that is the only way the two are
comparable.

---

## How to test a provider

- **Never make a live paid call in a test.** Use `MockTransport`, or a fake
  `ProviderPort`.
- Assert the refusals, not only the successes: kill switch, spend cap, budget
  ceiling, not-configured, unhealthy. A refusal is a normal outcome and callers
  must degrade coverage rather than fail the run.
- Assert that an unreported cost stays `null` in `cost_events`, never `0`.
- `__tests__/sourcePolicy.test.mjs` shows the pattern, including the assertion
  that hydration can only ever disable.

## How to test dedupe and independence

- Build `Observation` fixtures; the helper in
  `__tests__/evidenceCounting.test.mjs` is a good starting point.
- The cases worth writing every time:
  - a registry record and a portal listing about one flat are **not** merged;
  - one portal listing the same flat twice **is** merged;
  - the same listing id on two unrelated portals is a coincidence;
  - three comparables on one portal do **not** discount each other;
  - a duplicate is marked, still present, and does not vote.
- Always assert `observationCount` and `independentSourceCount` **separately**.
  Collapsing them into one number is the bug this whole layer exists to prevent.

---

## How to add a product consumer

Additively. Nothing currently imports the core outside its own directory, and
`__tests__/runtimeNeutrality.test.mjs` asserts that — so the first real consumer
has to update that assertion deliberately, which is the point.

The intended shape:

```ts
// 1. Funding, tier, ceilings and priority — the existing gateway.
const grant = await beginExecution(sb, { userId, productCode, idempotencyKey, jobRef });
if (!grant.ok) return refuse(grant.reason);

// 2. The plan, scaled to what was actually authorised, BEFORE the first fetch.
const budget = budgetFor(profile, grant);

// 3. Bounded parallel research through the one outbound path.
const results = await Promise.all(targets.map((t) => fetcher.fetch(t.url, { context })));

// 4. Parse, dedupe, count, detect conflicts.
const deduped = dedupeObservations(observations, { entityIdOf });
const independence = computeIndependence(deduped.observations, { subjectOf });
const conflicts = detectConflicts(claims, { supportOf });

// 5. The deterministic verdict. No model involved.
const coverage = evaluateCoverage(profile, contributions, { supportOf });

// 6. Into the existing evidence model, with the caller's localized text.
const items = deduped.observations.map((entry) => toEvidenceItem({ entry, claim: t(...), ... }));

// 7. Settle against measured usage.
await settleExecution(sb, grant, toActualUsage(totalUsage(results, provider)));
```

Do not migrate Verify or any other existing consumer onto the core as part of
adding a new one. Migration is a separate, independently justified,
regression-proven piece of work.

---

## Deliberately not built

- **No BullMQ or Redis.** Homatch has neither, and adding infrastructure nobody
  asked for is not integration. The in-process scheduler is the only backend.
  `SingleFlightLock` exists as an interface so a Postgres advisory lock can be
  dropped in later without changing a caller.
- **No browser pool.** `official-worker` owns headed Chromium. A second pool
  would fight it for memory in the same container.
- **No new Railway service.** New worker capability belongs as routes on the
  existing `official-worker` Express app.
- **No new research tables.** `research_jobs`, `research_cache` and
  `intelligence_*` already cover it. The standalone engine's `RESEARCH_SCHEMA_SQL`
  is **not** imported and must never be executed against production.
- **No PDF parsing.** `official-worker`'s `PdfDocumentReader` already does it.
- **No source catalogue.** See "How to add a source".
- **No Investment UI, and no `billable_products` rows.** Both are the next piece
  of work, not this one.

---

# Part 2 — the job-aware discovery engine

Part 1 built the infrastructure. This part makes it a **shared, job-aware
research and discovery engine**: one set of networking, caching, coalescing,
scheduling, dedupe, provenance and evidence rules, and a *different* definition
of a valid result for each job.

## The distinction everything turns on

```
"Looking to buy a 2BR in Tbilisi"        BUYER_SEARCH: yes   PROPERTY_SEARCH: no
"2BR for sale in Krtsanisi, $145,000"    BUYER_SEARCH: no    PROPERTY_SEARCH: yes
```

Getting this wrong does not degrade a result set, it **inverts** it — the buyer
search returns estate agents and the property search returns people with no
property. Both look plausible in a screenshot.

So `ResearchDirection` (`DEMAND | SUPPLY | REFERENCE | UNKNOWN`) is a **type** in
`core/types.ts`, a profile declares which direction satisfies it, and
`signals/direction.ts` decides which direction a signal carries —
deterministically, in seven languages, before any model is involved. The filter
is a comparison of two enum values.

`UNKNOWN` satisfies **no** job. An engine that resolves ambiguity in favour of
whichever job is running is an engine that always finds something.

Homatch already enforced half of this in SQL: `reject_non_demand_match()` refuses
to attach a supply listing to a property as a demand match, in six languages.
This is the same rule, generalised to both directions, stated once.

## The jobs

| Profile | Direction | Notes |
|---|---|---|
| `BUYER_SEARCH` | DEMAND / SALE | comments on, agency voice rejected, 14 days |
| `RENTER_SEARCH` | DEMAND / RENT | 7 days — rental demand decays fastest |
| `PROPERTY_SEARCH` | SUPPLY / ANY | comments off, agency voice **allowed** |
| `LAND_SEARCH` | SUPPLY / SALE | `propertyTerms: ['land']` only; window `ANY` |
| `INVESTOR_SEARCH` | DEMAND / SALE | higher confidence floor than a buyer |
| `DEVELOPER_SEARCH` | SUPPLY / SALE | BACKGROUND class; catalogue-building |

`MARKET_RESEARCH`, `VERIFY_RESEARCH` and `INVESTMENT_RESEARCH` are **not**
declared as profiles — Homatch already has all three. `JOB_ALIASES` resolves the
first to `MARKET_COMPARABLES`, the third to `INVESTMENT_DEEP_RESEARCH`, and the
second to **null**, because Verify is the research-agent five-stage pipeline, it
owns `research_jobs`, and it stays authoritative. Returning null is what stops
somebody quietly reimplementing it here.

Discovery jobs reuse the existing `FIND_CLIENTS` product code. No new
`billable_products` row is created — that is a pricing decision and lives in SQL.

## Multilingual planning

A job typed in English is researched in every language its **market** is written
in. `discovery/lexicon.ts` is a reviewable table of phrasings — semantic
variants, not translations — in `ka en ru ar tr he hi`. Hindi is discovery-only
and deliberately not a product locale; a test asserts that asymmetry.

`planQueries(subject, direction)` is the cross product of
`market languages × intent phrasings × property nouns × location terms`, ordered
so a small budget survives the cut, **interleaved by language** so a seven-query
budget still reaches seven languages, and **deterministic** — the previous
discovery function rotated on `Date.now()` and could therefore be neither cached
nor tested. Rotation survives as an explicit `rotationSeed`.

Composition uses only the **noun-free** subset of each phrase bucket: Georgian
`ბინა იყიდება` is literally "apartment is for sale" and is excellent for
*recognising* a post, but appending a land noun to it produces "apartment for
sale land". Classification keeps the full lists.

Adding a language is adding a key. A test asserts the planner names none.

## The discovery ladder

```
1. CACHE          research_cache, through the shared CachedFetcher
2. FIRST_PARTY    Homatch's own consented demand and supply
3. KNOWN_SOURCES  source_registry, best-first by productivity
4. PUBLIC_WEB     deterministic discovery of sources we do not know
5. BROWSER        the EXISTING official-worker, only where genuinely required
6. UNAVAILABLE    say so
```

**There is no paid-provider rung.** DataForSEO and Apify are treated as
non-existent — no adapter, no fallback, no config flag, no TODO. A test reads
every core source file and fails if either name appears in code. The previous
discovery function was built entirely on them, which is exactly why it has no
capability today.

Rung 6 is a real outcome. A source that cannot be reached must never be reported
as a source that contained nothing.

## The source graph

`source_registry` and `raw_signals` already existed and are **extended, not
replaced** — the migration is additive only, and `classify-signals-v2`,
`intent_profiles`, `property_signal_candidates` and the matching engine keep
reading them unchanged.

Added to `source_registry`: `access_state`, `city`, `region`, `languages[]`,
`compatible_profiles[]`, `property_terms[]`, `scan_cursor`, `chronological`,
`last_useful_at`, `useful_signal_count`, `scanned_signal_count`,
`last_failure_reason`. Added to `raw_signals`: `parent_url`, `parent_excerpt`,
`content_type`, `access_class`, `research_direction`, `direction_confidence`.

Productivity is **per (job, market, language)** — the same group is excellent for
renters and useless for land, which one `quality_score` column cannot say. The
score is a yield rate shrunk toward a realistic prior (0.15, not 0.5 — a half
would rank every unproven source above every proven good one) and decayed on
staleness.

A cursor advances **only on success**. Advancing it after a failure would
permanently skip the window the failed scan was supposed to cover.

## Facebook and Instagram

Source adapters behind the shared contract — `discover / fetch / extract /
scanIncremental` — not separate research systems. Everything platform-specific
lives in those files, so a layout change breaks one adapter and nothing else.

**The wall detection is the most important part.** Meta answers a blocked request
with HTTP 200 and a login interstitial. A scraper that does not recognise it
reports "this group contained nothing", which is false: it contains plenty and we
could not see it. `detectWall()` turns that into `LOGIN_WALL` (a session would
help) or `JOIN_REQUIRED` (a human must ask) — different answers, acted on
differently.

A comment inherits its **subject** from its parent post and **never its
direction**. The parent of almost every good buyer comment is a supply listing,
and letting its "for sale" count would flip every one of those to the wrong side.

Discovery without a search vendor comes from three places, all ours: links
harvested from content we could already read, operator seeds, and the rows
already in `community_directory` and `source_registry`. Slower to start than
buying SERPs, and it compounds.

## Authenticated access

`research_access_connections` holds the **NAME** of a platform secret — the same
`credential_ref` pattern `dev_ad_connections` already uses — plus status and
health. A CHECK constraint refuses anything cookie- or token-shaped, so an
application-code mistake is rejected by the database rather than stored forever.
`redactConnection()` drops the reference entirely before anything leaves the
server, and the service layer does not even select the column.

**Never provisioned through the product.** An operator sets the secret value in
the platform secret store, out of band. Nothing asks anybody to paste a
credential into a browser or a chat.

`research_access_requests` is the human access queue. There is no join, no bulk
join, no account rotation, no challenge or CAPTCHA path, no stealth, no proxy
rotation — and no request state meaning "joined automatically", because there is
no code that joins. `APPROVED` moves a source to `AUTHENTICATED_ACCESS`, never to
`PUBLIC`: a group behind a membership wall is not public just because we are now
inside it.

## Admin

`/admin/sources` gains three tabs beside the existing registry list — Health,
Access, Queue — using the existing shadcn primitives and the existing i18n
system, not a second admin application. `useful_rate` renders as "not scanned
yet" when it is NULL, never as 0%: a zero would state that the source produces
nothing, which is a claim about the source rather than about us.

## Adding another platform

Implement `SourceAdapter` in `adapters/`. Telegram, Reddit, TikTok, a property
portal and a forum all plug into the same engine — nothing else changes, and no
new job engine is created. Navigate by URL, structured data and stable DOM
semantics; a test rejects positional selectors. Adapters never reach the network
themselves — they are handed a fetcher that is the shared `HttpClient` behind the
SSRF policy, robots, rate limits, breakers, caching and coalescing.

## Browser execution

No new pool, no new Railway service. When deterministic HTTP genuinely cannot
reach accessible content, an adapter asks for `renderDocument`, which the host
implements over the **existing** `official-worker`. It is absent by default, and
an adapter must degrade rather than fail — a browser failure is a `PARTIAL`
result, never a poisoned one.

## Cost

Discovery consumes CPU, memory, network and browser time even when no invoice
arrives. `bridge/cost.ts` (Part 1) still converts measured `ProviderUsage` into
`cost_events` and `ActualUsage`; an unknown cost stays `null`, never a fabricated
zero. No second ledger, and no rate lives in the core.
