# MyHome/TNET authorized data integration

Reviewed: 2026-10-10. Status: request prepared, not sent; no commercial commitment.

## Verified official sources

- [TNET corporate site](https://tnet.ge/en) identifies MyHome as its real-estate platform.
- [TNET published terms, dated 2025-04-01](https://static.my.ge/legal_documents/2025.04.01%20%E1%83%AC%E1%83%94%E1%83%A1%E1%83%94%E1%83%91%E1%83%98%20%E1%83%93%E1%83%90%20%E1%83%9E%E1%83%98%E1%83%A0%E1%83%9D%E1%83%91%E1%83%94%E1%83%91%E1%83%98.pdf), pages1-2, list info@myhome.ge / 0322800015 and info@tnet.ge / 0322470157.
- Those terms, section3.3 (page4), restrict unauthorized information collection;
  section16 (pages39-40) restricts unauthorized commercial content use and does
  not grant a content licence merely through website access. Obtain current
  written partner terms; this engineering review is not a legal opinion.
- [MyHome's official support footer](https://www.myhome.ge/en/pr/23750799/4-room-apartment-for-rent-in-vake/)
  also publishes info@myhome.ge and 0322800015. This source verifies the contact,
  not listing availability or permission to acquire its content.

The addresses are verified general support/company recipients, not verified
individual partnership decision-makers. Ask them to route to MyHome business
development and the technical data-integration owner. No guessed contact or
third-party directory is used.

## Options and decision

The official pages reviewed did not disclose a MyHome developer programme,
third-party credentials, feed schema, licensed automation rates or data-feed
pricing. This is not proof that private commercial integrations do not exist.
No authorization has been supplied to HOMATCH for a new route.

| Option | Capability and authorization needed | Current decision / cost evidence |
| --- | --- | --- |
| Official API / partner integration | Search or catalogue access, detail/media rights, stable pagination, changes and removals; written partner grant and credentials | Preferred. Availability, limits and price require TNET confirmation; no verified quote |
| Licensed JSON/XML/CSV feed | Initial snapshot, stable IDs, ordered updates/tombstones, licensed photos, replayable delivery | Equally suitable if freshness SLA meets the product; format, cadence and fees unknown |
| Documented public endpoints | Explicit permission for server automation, storage and customer display; documented support and limits | Existing internal/public endpoints are not evidence of a licence; do not reactivate without permission |
| Approved ordinary browser | Written automation/hosting approval, permitted session model and quotas; supported access without challenge bypass | Existing transport previously worked, then received403. More fragile than API/feed; no current approval or predictable access |
| Owner/agency-supplied originals | Direct files or approved export from the rights holder, explicit facts/media rights and availability updates | Useful limited-inventory fallback. A pasted MyHome URL does not grant scraping rights. Must label direct-import provenance, not freshly verified MyHome |

Third-party scraper offers are neither official MyHome authorization nor a
self-owned supported integration. They are not enabled. Existing SS.ge execution
continues independently. No proxy, identity rotation, solver or impersonation is
an acceptable recovery route.

No negotiated rate, feed price, request price or licence fee is known. Existing
hosting does not imply zero operating cost: approved volume, browser versus API
CPU, media bandwidth, storage and retention determine marginal costs. Obtain a
written quote before committing spend. Do not use ordinary listing-ad prices as
data-licence prices or promise a request rate that has not been granted.

## Ready-to-send request

To: info@myhome.ge

Cc: info@tnet.ge

Subject: HOMATCH — authorized MyHome property data partnership / API or licensed feed

Hello MyHome / TNET team,

HOMATCH would like to establish a supported, authorized integration for MyHome
property data. Please route this request to the MyHome partnership and technical
data-integration owners.

Our self-owned server integration normalizes listing observations into canonical
properties, retains source attribution and original links, and supports property
search and evidence-based comparable analysis. Acquisition runs independently
of customer page views. We do not seek account impersonation, challenge bypass
or unrestricted crawling. Our prior ordinary public-page acquisition now receives
a Cloudflare403 challenge; we will not bypass that restriction.

Please confirm whether you offer an official API, licensed catalogue/change feed,
approved partner integration, or expressly approved server browser access.
Our preferred contract includes:

1. A filtered listing-search or catalogue/snapshot endpoint covering transaction,
   property type, location, currency, price, area and supported attributes.
   Please document supported fields and canonical location dictionaries.
2. Listing detail by immutable identifier: description, price/currency, area,
   rooms/bedrooms, floor/building floors, condition/building status, amenities,
   coordinates/address where permitted, original URL and media references.
3. Stable pagination or snapshot cursors, deterministic ordering, page limits,
   total-count semantics and token expiry/replay rules.
4. An updated-since/change cursor or webhook/feed for price and attribute updates,
   with monotonic revisions and explicit deletion, expiry and reactivation events.
   Please distinguish published, updated, observed and last-verified timestamps.
5. Original photo/media access with permitted hotlinking or storage, attribution,
   watermark, resizing, retention, cache/URL expiry and removal requirements.
6. Sandbox and production credentials delivered through a secure channel;
   service-account scopes, rotation/revocation, permitted hosting origins/IPs,
   authentication scheme and any approved browser/session policy.
7. Explicit requests-per-second/minute/day, concurrent-request, pagination and
   monthly-record limits; Retry-After behaviour and supported retry policy.
   Please propose a small unpaid or agreed-cost acceptance allowance before
   production activation. We will not assume any quota or free entitlement.
8. Written rights to store normalized facts, original listing URLs, descriptions
   and approved photos; display to authenticated HOMATCH customers; deduplicate
   observations; and generate derived comparisons. Please state restrictions on
   analysis/AI processing, seller/contact data, redistribution, geography and
   historical retention. We can omit fields not licensed or necessary.
9. API/feed versioning, deprecation notice, uptime/freshness targets, support and
   incident escalation; completeness/reconciliation and removal obligations.
10. Commercial terms: setup fee, minimum commitment, per-request/record/media
    pricing, recurring fees, overages, taxes/currency, billing periods, renewal,
    termination, export and post-termination retention/deletion requirements.

Please provide sample schemas, documentation, the relevant agreement and a quote.
Please also confirm the appropriate technical and commercial points of contact.
We can then agree a bounded pilot and share the actual HOMATCH infrastructure
identity securely. We will not send customer data or credentials in this request.

Thank you,
HOMATCH engineering

## Activation requirements and acceptance

1. Owner approves the written permission, quote and any spend. Keep credentials
   out of email attachments, repository, logs and chat; use approved secret storage.
2. Implement the returned schema behind the existing MarketplaceSearchRequest /
   MarketplaceWorkerResult / ExternalListingCandidate contract. No fabricated
   endpoint or generic importer is activated before schema and rights are known.
3. Test contract drift, pagination, revisions, replay, tombstones and media expiry
   with vendor-provided fixtures. Commit no live credentials or private contacts.
4. Negotiate the synchronization schedule, bootstrap size and retention; persist
   acknowledgement cursors, upsert stable IDs, and reconcile only complete snapshots.
   Failed/incomplete acquisition must never mark unrelated listings deleted.
5. Verify the existing authenticated health and admin signals, and route alerts
   through the approved monitoring destination. Notification delivery is not yet
   proven merely because structured events or health.status=DOWN exist.
6. Pass release gates; deploy scoped ingress before the canonical worker. Quiesce
   MyHome runs before deliberate restriction clearance/restart. Preserve SS.ge.
7. Run one bounded authorized acquisition. Record fresh source IDs, exact criteria,
   source URLs/photos/prices, successful Supabase ingestion/canonicalization and
   authenticated desktop/mobile rendering. Exercise updates, replay and removals
   in sandbox; verify one-provider failure retains the other's real results.

Until these prerequisites are met: engine implementation exists and CI passed;
MyHome live connectivity is externally blocked; scheduled incremental feed and
vendor-specific connector cannot be declared operational. No production deployment
or fresh MyHome acquisition is claimed by this document.
