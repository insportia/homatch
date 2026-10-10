# Self-hosted MyHome Crawlee transport

## Implementation

Official Apache-2.0 package: @crawlee/playwright3.18.1, from
[apify/crawlee](https://github.com/apify/crawlee/tree/v3.18.1).
Installed by npm in the authorized GitHub CI environment, with npm-shrinkwrap.json
committed. Root frontend pnpm dependencies are unchanged. Docker uses npm ci and
the existing Playwright1.55.0 Chromium image. No repository clone, Apify Actor,
Apify Cloud account, paid scraping API, new Railway service or AI call is used.

MYHOME_PUBLIC_PAGE_TRANSPORT=crawlee selects the new reader in the canonical
MyHome runtime. Existing HTTP/browser values still behave as before. Production
settings have NOT been changed. Crawlee is not enabled in Verify and PR150 is
untouched; both products retain the same acquireMyHome/normalized contract.

Crawlee only schedules ordinary public-page navigation. The existing adapter
still resolves dictionary-backed cities/districts/urban labels, applies supported
transaction/property/price/area/room/bedroom filters, validates hydrated queries
and detail identity, normalizes facts/photos/timestamps, deduplicates identities,
advances acknowledged checkpoints and reports through marketplace-worker-ingest.
There is no second parser, ingestion pipeline or source identity scheme.

Each reader has one active browser page, at most two pending requests and a
30-requests/minute upper limit. Crawler retries, sessions, session rotation,
fingerprints and blocked-page recovery are explicitly disabled; no proxy is
configured. The existing adapter alone retries transient failures. Cross-origin
or non-listing-path navigation is rejected. Abort/shutdown closes pages and the
run-local memory queue. No crawl state is sent to Apify Cloud or stored in an
uncoordinated disk queue; Supabase remains the durable checkpoint authority.

403/401 and recognized challenge responses latch the reader immediately. The
existing engine persists access restriction; queued pages stop before navigation.
Installing a framework never clears source restrictions. Ingestion upserts and
saved search results provide existing result reuse; listing responses are not
cached and relabelled as freshly acquired.

## Concrete acceptance evidence

CI run38076769339 installed the locked packages, compiled the worker and ran three
tests using real Chromium with all network responses fulfilled from local fixtures:

- Search and detail extraction retained fixture source25610778, USD165000,
  area101m2, original photos and exact query validation. Repeated URLs loaded
  again instead of silently disappearing through Crawlee queue deduplication.
- A403 challenge made exactly one navigation, preserved sanitized diagnostics,
  closed the reader/engine circuits and survived a simulated engine restart.
- A503 response retained its status without a Crawlee retry; non-public and
  already-aborted requests made no navigation.

Local fixture benchmark on that runner:3 requests in484ms; Node RSS151683072
bytes (about145MiB). This excludes Chromium memory, source latency and real media
downloads. It is NOT a MyHome throughput benchmark or production capacity claim.

The production database was inspected READ-ONLY on2026-10-10. The explicit
MyHome ACCESS_DENIED record is still BLOCKED,0returned, dated2026-10-09
11:20:34UTC, HTTP403 / CHALLENGE_REQUIRED / server=cloudflare, at:

https://www.myhome.ge/udzravi-qoneba/iyideba-3-otaxiani-bina-vakeshi-21944160/

Registry health has an older2026-10-06 HEALTHY entry, but no accessClearedAt.
That older status is not recovery evidence. PR152's historical-error circuit
therefore prohibits another listing request. No clearance, configuration write,
live listing fetch, customer-data mutation, merge or deployment was performed.

Live result: ACCESS_RESTRICTED by preserved evidence; no fresh source HTTP status
was measured. Genuinely acquired live listings in this phase:0. No live sample,
photo-availability, new Supabase persistence or authenticated frontend rendering
is claimed. The tests' facts/images are historical fixtures, not current inventory.

## Release and external prerequisites

The first CI compile exposed a missing node:url import; it was fixed rather than
weakening typecheck. Final PR checks and dedicated real-browser checks must pass
at the release head. The browser workflow only visits locally intercepted fixtures;
it does not automatically run a source probe or mutate production.

Retain the release hold. Obtain the written transport/media grant described in
[the ready-to-send partnership request](myhome-partnership-request.md), then
deploy scoped ingress before the canonical worker. Quiesce MyHome runs before
deliberate clearance/restart. Run one bounded authorized search and check source
IDs, criteria, URLs/photos, prices, pagination, ingestion/canonicalization and
authenticated desktop/mobile rendering before declaring live integration success.

Incremental infrastructure:0 new services/subscriptions and0 per-search AI or
scraping API fees. Existing Railway CPU/RAM and bandwidth and Supabase storage
remain usage-billed. No credible monthly dollar estimate or full browser-memory
budget can be derived from blocked source access and a local fixture benchmark.
Measure those during the approved pilot; no new paid capacity is authorized here.

## Historical root-cause comparison (read-only evidence)

| Evidence | Successful run | Restricted run |
| --- | --- | --- |
| Run ID | c0ba653c-3636-4e51-948d-eede8dba1c14 | 94c06bb7-ca37-4774-9e6d-9a9a2d666c27 |
| Started UTC, 2026-10-09 | 07:59:15 | 11:20:34 |
| Count / returned | 44 / 44 persisted | 45 / 0 |
| Actions / search pages visited | 49 / 2 | 8 / 1 |
| Transport | PUBLIC_NEXT_DATA_BROWSER | PUBLIC_NEXT_DATA_BROWSER |
| Outcome | COMPLETE | BLOCKED / ACCESS_DENIED |

Both requests used Tbilisi/Vake, sale/apartment, USD120000-160000 with
collection ceiling176000, area80-110, rooms3+, bedrooms2+, new build or under
construction. The differing maxResults field (2000 versus100) is not consumed
by the adapter and is not a source query parameter. The count and first search
page succeeded in the failed run; the recorded403 is the first detail-page
request to listing21944160, not planning or the initial listing search.
That exact ID and URL also occur in the successful run's persisted listings,
observed07:59:21.416UTC. This is direct evidence of changed access outcome for
the same URL, rather than an invented or malformed detail URL.

Railway network-flow samples from both execution windows identify the SAME
active deployment7b875543-ae0d-41aa-98e1-507430400220, commit
8d7f0f954496dd13766ccb770fd37bea0ad3818e, regionams, created07:57:23UTC.
Intermediate deployments were SKIPPED. Private container addresses also match.
These records do NOT expose the public NAT egress IP, so an egress-IP change is
neither established nor excluded. There is no evidence of a code deployment
or region change between these two runs.

The implementation at that commit launches ordinary headed Chromium and a fresh
browser context per run, reusing it only within the run. It reads the navigation
HTTP status and headers directly before parsing __NEXT_DATA__. The failed
response was403 with CHALLENGE_REQUIRED and server=cloudflare. This establishes
a Cloudflare-served restriction response; retained evidence cannot identify the
specific Cloudflare rule or definitively prove whether origin policy contributed.
It is not a parser interpreting a valid200 as403. No429 is recorded. The failed
run made fewer actions than the successful one; global traffic, public egress,
full cookies/headers, cf-ray and the challenge body were not retained, so rate,
IP reputation, session expiry and policy-change explanations remain UNPROVEN.
Deployment-scoped runtime logs retain the matching claimed event at11:20:38.759Z,
but do not provide additional request-level diagnostics in that bounded window.

Crawlee improves explicit queue bounds, lifecycle ownership, cancellation and
request accounting. It is NOT evidence that a blocked source will allow access;
blocked retries, session rotation and fingerprints remain disabled.

A separate actionable defect was found: ingress truncates diagnostic query URLs
to80 characters, preventing full-URL checkpoint equality after restart. The
adapter now persists a64-character SHA-256 fingerprint of all full query URLs,
validated through the real ingress sanitizer in regression coverage. Changed
queries and truncated legacy checkpoints restart safely instead of trusting a
prefix. This fixes resume reliability, not the historical403.

No free authorized whole-market feed has been verified. Owner-supplied original
listing data/photos with explicit rights is a possible no-provider-fee fallback;
it does not recover the complete MyHome inventory. Official API/feed or approved
browser access requires MyHome/TNET permission, quotas and media rights, with
commercial terms still unknown. See the unsent partnership request; no contact,
license or free access entitlement is invented here.

## Search-result-first recovery

The retained authentic search fixture contains 58 source keys. Its listing
25610778 alone provides USD165000, USD1634/m2, 101m2, 4 rooms, 3 bedrooms,
floor4/8, address and city/district/urban IDs and labels, the original URL slug,
a487-character description, 15 original photo URLs and last_updated. Both ID
and UUID are present. Coordinates, metro and yard area are null for this record;
empty parameters do not establish absence of amenities. These observations are
historical, not a fresh response or proof that images remain reachable today.

Search data omits structured condition/parking/heating/build-year and bathroom
IDs, owner phone/ownership evidence, created_at/publication data and is_active.
They remain unknown. User display title/count/type are attribution signals, not
proof of ownership. Source last_updated is distinct from our observation time;
neither establishes current availability.

The adapter now defaults to validated search-result normalization and does not
open individual detail pages. Pagination, identity deduplication, canonical URL
validation, criteria checks and existing ingestion/canonicalization remain in
place. MYHOME_DETAIL_ENRICHMENT_ENABLED=true explicitly opts into optional detail
enrichment; it is OFF by default and no production environment was changed.
On detail failure the summary survives with SEARCH_RESULT observation level,
NOT_REQUESTED/FAILED/ACCESS_RESTRICTED/SKIPPED detail status, null detailVerifiedAt,
explicit missingFields, UNKNOWN availability and the correct freshness basis.
Successful details are marked separately. A confirmed conflicting detail is
excluded rather than concealed by falling back to stale summary facts.

A detail403 stops further detail and page navigation, persists every valid
summary already obtained from that page, and reports PARTIAL with ACCESS_DENIED.
The durable source circuit remains closed across restart. Ordinary parser
failures affect enrichment independently and do not discard search observations.
Complete search-only pagination can return COMPLETE acquisition while individual
optional facts remain unknown; COMPLETE does not imply detail verification.

Tests replay the unchanged retained search envelope through acquisition,
normalization, actual worker-report validation and existing customer property
pipeline without opening details. Additional deterministic tests cover zero
detail requests by default, full-page preservation on first-detail403, malformed
details, successful enrichment and exclusion of changed above-budget details.
No fresh source access, database write or customer browser acceptance is claimed.

This recovers useful functionality IF search access is authorized and available.
It does not authorize a new search request through the existing provider-wide
restriction circuit. Current search accessibility has NOT been freshly verified;
operator-approved source authorization/clearance is still required for live proof.


## Handoff continuation — 2026-10-10 (evidence added after PR152)

Read-only production evidence not captured above:

| UTC | Stage | Outcome (from `discovery_marketplace_worker_runs` / Railway logs) |
| --- | --- | --- |
| 2026-10-08 19:28, 19:52 | anonymous `api-statements.tnet.ge` list | FAILED, HTTP 401 (API closed to anonymous use) |
| 2026-10-08 20:10 | **search page** `/udzravi-qoneba/?cities=1&urbans=38…` | BLOCKED, HTTP 403 |
| 2026-10-08 20:23 | **search page**, same query | BLOCKED, HTTP 403 CHALLENGE_REQUIRED server=cloudflare |
| 2026-10-09 07:59 | search + detail, BROWSER | COMPLETE, 44 persisted |
| 2026-10-09 11:20 | first detail page 21944160 | BLOCKED, HTTP 403 CHALLENGE_REQUIRED server=cloudflare |
| 2026-10-10 19:07:03 | startup connectivity of deployment `8d5c3fe9` (main `a452ba8`, BROWSER) | locations/filters/list/count/detail all HTTP 200; 24 parsed; total 26079 |

Consequences:

- The restriction has been observed on search pages too, not only on detail
  pages. Search-only acquisition reduces requests per run (count + result
  pages, no per-listing page) but is not proven to avoid the restriction.
- Outcomes changed from 403 to 200 and back to 403 within the same deployment
  and region over hours. The cause (rule, rate, egress reputation, session)
  remains unobserved; nothing above establishes it.
- Main (deployed) has no durable circuit and its startup check opened one
  detail page on every worker boot. PR152's circuit, once deployed, reads
  the 2026-10-09 ACCESS_DENIED run and blocks MyHome until a deliberate
  clearance newer than that failure is recorded.

Code change in this continuation: the startup connectivity check opens a
detail page only when `MYHOME_DETAIL_ENRICHMENT_ENABLED=true`; by default it
reads dictionaries, one search page and count, and reports
`detailStatus: NOT_REQUESTED`. Regression test:
`runtime startup connectivity check reads search and count but opens no detail
page by default`.

The out-of-scope Verify edit (`src/verify/providerOutcomes.ts`) was reverted
to main.

Field evidence (retained authentic fixture, B-class): the search record's
`comment` (487 chars) is byte-identical to the detail page's `comment`, so
search-only acquisition keeps the full description for that record. Search
records lack condition/heating/parking/build-year/bathroom IDs, owner name,
phone, created_at and is_active; those stay unknown (listed in
`missingFields`), never inferred.

### Operator clearance (deliberate, owner-authorized only)

The worker has no clearance action. An operator records clearance on the
worker row, only with fresh evidence of access and owner authorization:

```sql
update discovery_marketplace_workers
set health = health - 'accessRestricted'
  || jsonb_build_object('accessClearedAt', now(), 'clearedBy', '<operator>',
                        'clearanceEvidence', '<evidence reference>')
where worker_id = 'myhome-agent'
returning health;
```

Any later 401/403/challenge writes a new ACCESS_DENIED run (newer than the
clearance) and closes the circuit again; retries, rotation and challenge
interaction stay disabled.
