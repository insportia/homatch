# Service Control Center — inventory of HOMATCH services (2026-10-16)

The code-level inventory behind the expansion of the Service Control Center from six services to
every manageable HOMATCH product. Model and mechanics: `docs/claude/SERVICE_CONTROLS.md`.

**Rule for inclusion.** A service gets a switch only if it is a real customer-facing product that
can stop on its own without taking anything else down. Platform pieces never get one, because
switching them off would break other products or lock people out.

**Production state is preserved exactly.**
- The six original services keep their rows, versions and OFF state.
- Every new service is seeded `frontend = backend = ON`, because it is live today.
- A product that is dormant today is dormant through **its own setting**, which is unchanged. Its
  new switch sits in front of that setting and does not turn it on. Examples:
  - `find_property_social_enabled = false`
  - `email_studio_sending_enabled = false`
  - `outreach_email_sending_enabled = false`

## Fail mode, by kind of service

| Kind | Services | Unreadable control | Frontend before the first answer |
|---|---|---|---|
| Paused by the owner (original six) | publishing, ai_call_center, ai_talk, whatsapp, live_chat, design_studio | **closed**: refuse, hide | hidden |
| Live products (new) | all the others below | **open**: run, show (an outage of the control table must not take Verify or Find Property down) | the last answer this browser saw (`localStorage`), else visible |

An explicit OFF row is always honoured for both kinds.

## Groups and services

Each service below is listed as `key`, product.

### Discovery

**`find_property`: Find Property (free search)**
- **Routes:** `/find-property*`
- **Entry points:**
  - sidebar `dnav_find_property`
  - public nav
  - dashboard tiles
  - homepage launcher and Find Property story
  - About tile
  - AI service action `FIND_PROPERTY`
  - broker desk links
- **Backend (new work refused):**
  - `marketplace-search` `understand` and `start`
  - `find-property-plan` `draft` and `confirm`
  - `homatch-ai` surface `find-property`
- **Keeps running:** status, results, cancel, and the `marketplace-worker-ingest` claim, heartbeat and report (searches already started finish).
- **Own settings (unchanged):** `marketplace_search_enabled`, `marketplace_<portal>_enabled`.

**`find_property_deep`: Find Property paid Deep Search / social offer campaign**
- **Routes:** none of its own.
- **Entry points:** the Deep Search option, `DeepSearchPanel` and `OutsideSearchPanel`.
- **Backend (new work refused):** `find-property-run` `start`.
- **Keeps running:** pause, resume, stop, settlement, and `executeOfferJob` for a campaign already reserved and paid.
- **Own settings (unchanged):** `find_property_social_enabled` (OFF today), the APIFY provider switch.

**`find_buyers`: Find Buyers / Tenants**
- **Routes:** `/property/:id/(matches|buyers|leads|buyer)`
- **Entry points:**
  - `CampaignLaunchPanel`
  - property-page and My Properties matching links
  - dashboard match links
  - homepage launcher and matching showcase
  - AI action `FIND_BUYERS_TENANTS`
- **Backend (new work refused):** `match-campaign` new campaign and `extend_budget`.
- **Keeps running:** pause, resume, stop, settlement, and `executeSocialJob` for a campaign already reserved and paid. Property CRUD under `/property` is platform and is never gated.
- **Own settings (unchanged):** `find_buyers_social_enabled`, `campaign_source_discovery_enabled`, the APIFY switch.

### Property Intelligence

**`verify`: Verify** (protected surface; functional gating only)
- **Routes:** `/verify*`
- **Entry points:**
  - sidebar `nav_verify`, mobile bar, header, public nav
  - dashboard
  - homepage launcher, showcase, closing CTA
  - footer, About
  - AI action `VERIFY`
  - links from other pages: property page, expat pages
- **Backend (new work refused):** `research-agent` new `start` (an idempotent replay of an existing run is still answered) and `continue`.
- **Keeps running:**
  - drive cron, status, cancel, pause, `verify-queue` worker callbacks, `verify-synthesis`
  - `recover_visuals`, `fresh_photos`, `refresh_market`: `verify-synthesis` calls them while it builds a report already paid for
  - `verification-handoff` `mint` (spends nothing; the run it leads to is refused at `start`)
- **Own settings (unchanged):** `verify_billing_enabled`, `verify_*`.

**`contracts`: Contract Intelligence**
- **Routes:** `/contracts*`
- **Entry points:**
  - sidebar, mobile bar, header
  - homepage launcher and section
  - AI action `CONTRACT_INTELLIGENCE`
  - links from Verify and expat pages
- **Backend (new work refused):** `deal-room-document-analyze` (user starts), `deal-room-ai`; `jobs-worker` does not dispatch new DOCUMENT_ANALYSIS jobs while paused.
- **Keeps running:** a job already claimed finishes on the worker path; queued jobs wait and run when resumed.

**`mortgage`: Mortgage**
- **Routes:** `/mortgage`
- **Entry points:**
  - sidebar, header, public nav
  - dashboard
  - homepage launcher and section
  - footer, About
  - AI action `MORTGAGE`
  - cross-links
- **Backend:** `homatch-ai` surface `mortgage-consultant`.

**`investment`: Investment Intelligence**
- **Routes:** `/investment`
- **Entry points:**
  - sidebar, header, public nav
  - homepage launcher and story
  - footer, About
  - AI action `INVESTMENT`
  - cross-links
- **Backend:** `investment-research`, `investment-consultant`.

**`for_expats`: For Expats**
- **Routes:** `/for-expats*`
- **Entry points:**
  - sidebar group, public nav
  - homepage launcher and story
  - About
  - AI TALK destination
- **Backend:** none of its own (pages read tables), so only its visibility is switchable.

### Marketing

**`meta_ads`: Meta Ads**
- **Routes:** `/outreach/meta*`
- **Entry points:**
  - sidebar `nav_meta_ads`
  - AI action `META_ADS`
  - property-page and broker-desk "promote" links
- **Backend (new work refused):** `meta-ads-api` launch, connect, AI copy, lead forms, audiences, deposit, imports.
- **Keeps running:**
  - status, sync, archive/pause, lead export, funnel, disconnect
  - the maintenance and status-sync cron
  - `meta-oauth` and `meta-webhooks` callbacks
- **Own settings (unchanged):** `meta_ads_*`.

**`email_campaigns`: Email & SMS campaigns, Email Studio**
- **Routes:** `/outreach/email*`, `/email-studio*`
- **Entry points:**
  - sidebar `dnav_email`
  - homepage launcher and section
  - footer, About
  - comms hub, developer marketing links
- **Backend (new work refused):**
  - `outreach-send` EMAIL/SMS campaigns and `studio_*` sends
  - `comm-campaign-launch` EMAIL/SMS
- **Keeps running:** `email-webhook`, SMS webhook, unsubscribe.
- **Own settings (unchanged):** `outreach_email_sending_enabled`, `outreach_sms_sending_enabled`, `email_studio_sending_enabled` (all OFF today).

### Communications

These four are existing services, unchanged (still OFF). Details: `SERVICE_CONTROLS.md`.

- `ai_call_center`
- `whatsapp`
- `live_chat`
- `ai_talk`

### AI Assistant

**`ai_assistant`: HOMATCH AI assistant**
- **Routes:** `/ai`
- **Entry points:**
  - mobile bar, header "Ask AI"
  - shell top-bar ask box
  - floating assistant button
  - homepage AI section and hero ask box
  - footer, About
- **Backend:** `homatch-ai` general surfaces.
  - `find-property` surface: follows `find_property`.
  - `mortgage-consultant` surface: follows `mortgage`.
  - Site Studio translation: platform.
  - `agent-builder`: follows `ai_call_center`.

### Professionals

**`brokers_directory`: Brokers directory**
- **Routes:** `/brokers*`
- **Entry points:** sidebar, public nav, homepage section, About, entry pages, AI action `BROKER_FINDER`.
- **Backend:** new paid listings (`broker_listing_purchases` insert guard).

**`broker_desk`: Broker Desk**
- **Routes:** `/broker`, `/broker/onboarding`
- **Entry points:** sidebar (professionals only), signup and directory onboarding links.
- **Backend:** none of its own. Its paid actions are Find Buyers and Brokers directory, which have their own switches.

**`developers`: Developer workspace**
- **Routes:** `/developers` and `/developers/*`
- **Entry points:** public nav, footer, developer marketing.
- **Backend:** `developer-document-extract`, `developer-floorplan-extract`.
- **Keeps running:** the public buyer links (`/s/`, `/projects/`, `/buyer/`, `/p/`, `/embed/`) and `developer-buyer-document`. Customers have already been sent these links.

### Design

`design_studio` is an existing service, unchanged.

### Publishing

`publishing` is an existing service, unchanged.

## Never switched (platform)

- **Accounts and money:** auth (`/auth/*`); credits, wallet, billing, payments (`/credits`, `/pricing`, `/outreach/billing`, billing edge functions).
- **Account pages:** profile, notifications, activity, dashboard.
- **Property and messaging:**
  - property CRUD (`/property`, `/property/add|import|create|:id|:id/edit`)
  - private messages (`/chat`, `send-message`), which carry the canonical conversations Find Buyers depends on
  - leads CRM (`/leads`)
  - viewings
- **Public site:** home, about, contact, legal, `/for-buyers`, `/for-owners`, partners.
- **Admin:** the Admin shell, Site Studio, App Content.
- **The shared communications hub:** `/outreach`, campaigns, contacts, numbers, analytics.
- **Shared workers and matching:**
  - `discovery-queue-worker` drive/settle loop (only the job kinds inside it are gated)
  - `jobs-worker` tick
  - `run-matching*`, `supply-matching`, `classify-signals*`, `community-sync`, `demand-discovery`, `supply-discovery`, `revalidate-*`
  - `push-send`, `storage-*`
  - the Railway worker
- **Retired:** DATAFORSEO and generic Apify (already refusing work).

## Group controls

- There is **no global switch**. "Pause group" exists per group.
- It needs an explicit confirmation: the admin types the group's name, and the database checks it (`service_control_pause_group`).
- It touches only that group's rows, and each changed row is audited.
- The old "Pause all six" (`service_control_pause_all`) still exists and is narrowed to the original six keys, which is exactly what it did before.
