# HOMATCH broker product

Two concepts, two sets of tables, and no path between them.

| Concept | Storage | Who writes | Who reads |
|---|---|---|---|
| **HOMATCH BROKER DIRECTORY** — a firm that applied, was reviewed and has a current paid period | `broker_directory_listings`, exposed to customers only through the view `broker_directory_public` (`status = 'ACTIVE' and paid_until > now()`) | the applicant, via `broker_directory_apply` (always `PENDING_REVIEW`, `paid_until` null, `broker_id` null); an admin, via `admin_set_broker_listing_status` (audited) | everyone, through the view; the owner, their own rows; admins, via `admin_list_broker_directory` |
| **DISCOVERED BROKER INTELLIGENCE** — a firm we observed on public listings | `broker_intelligence` + `broker_intelligence_sources` (RLS on, no policies: service role only) | `supply-discovery` only, dedup on `(key_kind, natural_key)` | `find-property` (as provenance on a result, labelled *not registered*); admins, via `admin_list_broker_intelligence` |

`broker_intelligence` has no paid, verified, plan or owner column, and `broker_directory_listings.owner_user_id` is `NOT NULL` with no default, so discovery cannot create a listing (migration `20260926270000`). Migration `20260928300000_broker_directory_review_and_apply.sql` adds the way in and the reviewer, and none of its functions reads intelligence into a listing. `tests/matrix/brokerSeparation.test.mjs` asserts all of this against the source.

## Production state (read-only, 2026-09-27)

`broker_directory_listings` 0 · `broker_directory_public` 0 · `broker_intelligence` 0 · `broker_intelligence_sources` 0. Before this branch the listings table had two SELECT policies and no insert path; there were no broker functions.

## Payment

There is no payment path for directory listings: no product row, no checkout, no webhook. So `ACTIVE` needs the admin to give an explicit future `paid_until` and a written payment basis (invoice or reference), and to tick a confirmation in the UI. The audit row records `payment_basis: ADMIN_ASSERTED`. When a real payment path exists it should set `paid_until` itself, and this rule should then require its reference. Nothing infers or defaults a paid period.

## Surface audit

| Surface | Where | Classification | Notes |
|---|---|---|---|
| `/brokers` directory | `src/pages/BrokersPage.tsx` | **Found: NEEDS_MIGRATION** (`classification.ts` said APPROVED_CURRENT_DESIGN, which was wrong). **Now: APPROVED_CURRENT_DESIGN** (rebuilt on this branch; still needs owner sign-off) | It was shadcn Card/Badge on the root palette in a 672px column, had no search, and its CTA said "get in touch" with nothing to get in touch through. Rebuilt on `PRODUCT_SURFACE` (`.hm-product`): filters for market, language and type over the view's columns; contact actions only where the listing provides them; an honest empty state; and a signed-in application form. Reads only `broker_directory_public`. |
| Broker block on a Find Property result | `src/components/customer/ListingCard.tsx`, fed by `FindPropertyPage.tsx` / `find-property` | APPROVED_CURRENT_DESIGN (inside `.hm-discovery`) | The standing comes only from `directoryStandingOf` → `discloseBroker`. A discovered firm is labelled `broker_disclosure_observed` ("not registered with Homatch") and shown with its provenance (sources, listings, last seen). It is never called registered, verified or paid. |
| `/partners` (brokers & developers marketing, `partner_inquiries` form) | `src/pages/PartnersPage.tsx` | LEGACY_DESIGN | This is an advertising and sponsorship inquiry, not a directory registration, so the directory does not link to it. |
| Developer → broker distribution | `src/components/developer/BrokerPanel.tsx`, `DeveloperMarketingPage.tsx`, `DeveloperCommissionsPage.tsx` | PROTECTED from this workstream (separate developer product) | Invites outside brokers to a developer's inventory. This is not the directory and not intelligence. |
| Admin → Brokers (new) | `src/pages/admin/AdminBrokersPage.tsx`, route `/admin/brokers`, nav group *Property & discovery* | Content page inside the protected admin shell | Two tabs: *Directory listings* (status, paid until, owner, public now or not, with Activate/Suspend/Expire through the audited RPC) and *Discovered brokers* (identity key, provenance count, adapters, validation state, last seen). Discovered brokers are read-only. Filters: name/contact/key, market, status, visibility, validation, source adapter, freshness. |
| `BROKER_FINDER` product | `PricingSimulator.tsx` (admin) | n/a | Registered but `enabled = false`. Not advertised on `/brokers`. `credits_what_body` still says credits pay for "broker searches"; this is flagged for the pricing owner and was not changed here. |

## Matching participation

`src/research-core/match/participants.ts` treats AGENCY and BROKER as supply for every demand role (BUYER, TENANT, GUEST, INVESTOR) in every deal kind that role does. `src/research-core/__tests__/brokerMatching.test.mjs` covers:

- the full supply↔demand table for both broker roles, plus the impossible pairings
- symmetric assessment when a broker listing is compared from either side
- dedup, both in memory and in storage, on `(key_kind, natural_key)`
- a first sighting stored as `UNVERIFIED`
- provenance and freshness carried to the customer read
- the observed label negating registration in all six languages

`supply-matching` reads `supply_role` (not `source_status`); this is asserted in `brokerSeparation`.
