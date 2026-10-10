# HOMATCH-owned MyHome integration engine

## Status and evidence

Engine implemented; **live source access restricted**, not live verified.
October9 production records show an earlier44-listing MyHome success, followed
by a first-detail HTTP403/CHALLENGE_REQUIRED response (Cloudflare) for21944160.
The first search page had parsed successfully. SS.ge independently persisted46
listings. These records establish the failed stage, not why Cloudflare changed
its decision. Verify does not provide evidence of a successful replacement.

The anonymous statements API previously returned401. The existing adapter uses
ordinary public Next.js hydration for search/details and API dictionaries/count.
Its optional ordinary Chromium transport has no stealth, solving or proxying.
No new source request, paid operation or production mutation was performed here.

## Owned integration

acquireMyHome stays the shared Find Property/Verify interface. Existing api.ts,
public-page.ts, mapping.ts and next-data.ts separate acquisition, strict schema/
query/identity validation and normalization. Injected fetcher/pageFetcher ports
keep approved transports independent of matching and persistence. No AI browser
agent or third-party scraping service runs per search.

engine.ts adds:
- Immediate access-stop circuit for401/403 and explicit HTTP200 challenges,
  preserving the actual HTTP status. No automatic half-open probes or clearance.
- Durable registry health plus prior ACCESS_DENIED reports across restarts.
  Existing dedicated worker authentication is required; a worker cannot clear
  access or change another provider. Health-read failure stops source requests.
- A process-wide policy shared by both products in the official worker. Other
  deployments must provide MyHomeAccessStore; memory alone is not durable.
- One-hour locale/endpoint dictionary cache, bounded to12 entries; no listing,
  price, image or detail caching that could claim stale data is current.
- Existing bounded transient retries (two retries,500ms exponential backoff),
  per-request/run deadlines, repeated-page/no-progress protection and strong IDs.
- Acknowledged page checkpoints in existing query_applied metadata, accepted only
  for identical generated queries. Interrupted batches replay through upserts.
- Persisted identity counts instead of additive batch counts, so replay cannot
  inflate totals. Run-state writes must succeed before acknowledgement.

No migration, new service, secret or provider activation is required. SS.ge's
adapter, dedicated token and switches remain independent. Raw provenance, source
URLs/photos, publication/update/observation semantics and freshness policy remain
unchanged. Failed acquisition is never a deletion or an empty-success response.

This provides per-run recovery, not an immutable marketplace snapshot: source
ordering can change. New full refresh starts at page1. It does not introduce a
parallel global property index or invent an incremental/deletion feed.

## Authorized source options and requirements

No official API licence, approved browser access or licensed feed has been
provided. Priority: MyHome/TNET-approved API/feed; documented public endpoints
with confirmed automated-use permission; explicitly approved ordinary browser
access; owner-authorized imports with ownership/redistribution consent. Do not
invent an endpoint, supplier licence, owner identity or anonymous import endpoint.

Required from MyHome/TNET: endpoint/feed documentation, staging access, permitted
automation and hosting origins/IPs, authentication/rotation, rate limits, stable
listing IDs, pagination/cursors, updated-since or change-feed semantics, deletions
and availability, currency/unit definitions, location dictionaries, property
attributes, timestamp meanings, image rights/URLs and customer-display/
redistribution/attribution terms. Incremental synchronization requires a reliable
change cursor; otherwise use bounded full refresh with identity upserts.

### Access request draft — not sent

HOMATCH requests authorized server-side MyHome property data for property search
and evidence-based comparable analysis. Please provide an API or licensed feed
agreement covering stored facts, original URLs, photographs, freshness, updates/
deletions and customer display. We need documented pagination, stable identifiers,
authentication, rate limits, permitted infrastructure and attribution. Our ordinary
public-page transport currently receives a Cloudflare challenge; we will not
bypass it. Please confirm an approved integration route and staging credentials
through a secure channel, with licensing/pricing terms.

## Release, clearance and rollback

Deploy only the scoped marketplace-worker-ingest function BEFORE the existing
official worker, after all applicable gates pass. Preserve unrelated production
holds and provider settings. Existing restriction evidence should stop startup
smoke requests. No automatic deployment or paid fallback is authorized by this
document.

After an actual source grant, an authorized operator deliberately records a newer
health.accessClearedAt and accessRestricted=false (preserving other health fields),
then restarts the canonical worker. There is no worker clearance action. Run one
bounded authorized search; verify fresh source identities, exact criteria, prices,
areas, source URLs/images, stored canonical properties and authenticated desktop/
mobile UI before claiming LIVE SOURCE CONNECTED.

Rollback only these scoped function/worker commits; retain source data and access
restriction metadata. Never roll back unrelated migrations/functions.

## Test boundaries

The preserved successful Next detail fixture25610778 verifies priceUSD165000,
area101m², UUID and original image URLs. Synthetic pagination, failure and image
fixtures are regression evidence, not current live access or image availability.
The recovered browser image test verifies decoding, inactive-photo laziness,
broken-image recovery, thumbnails and mobile overflow.

Local gates:120 focused marketplace tests,47 adapter/engine/SS.ge tests,20
provider-policy/concurrency tests; repository typecheck, i18n coverage/keys and
production build passed. Full worker compilation was blocked locally by the
missing already-declared @2captcha/captcha-solver package, not waived. The sandbox
account relocked; final remote CI must validate the exact committed code, including
acknowledgement checks, before release. Authenticated production browser acceptance
remains unverified; no source permission or live recovery is inferred from CI.
