# Requirements Document

## 1. Application Overview

**Application Name**: HOMATCH

**Application Description**: HOMATCH is an AI-driven property intent-matching SaaS platform. This document covers Parts 1–3 (complete) plus a UX/Functional QA and Demo Mode continuation layer. The continuation does not redesign or restart the platform. The existing dark/orange Homatch visual identity and all existing architecture from Parts 1–3 are preserved.

**Build Scope**: Continuation of Parts 1–3. Parts 1, 2, and 3 are not rebuilt. All prior functionality remains unchanged except where explicitly modified below.

---

## 2. Page Structure and Feature Description

### 2.1 Page Hierarchy (Part 3 additions — unchanged)

```
HOMATCH (Part 3 additions)
├── Admin Section (role-gated, server-enforced)
│   ├── Overview
│   ├── Users
│   ├── Properties
│   ├── Campaigns
│   ├── Markets
│   ├── Sources
│   ├── Signals
│   ├── Matches
│   ├── Credits
│   ├── Payments
│   ├── Provider Costs / Health
│   ├── Pricing Config
│   ├── Spend Caps
│   └── Import Diagnostics
└── docs/ (documentation files)
    ├── DEPLOYMENT.md
    ├── MIGRATION.md
    ├── ARCHITECTURE.md
    ├── DATABASE.md
    └── PROVIDERS.md
```

### 2.2 Admin Section — Access Control (unchanged)

- Admin role is separate from customer role; access is enforced server-side on every Admin endpoint and page.
- Customers cannot access any Admin route or data.
- Admin role is assigned via a protected mechanism (not self-service).

### 2.3 Admin Overview Page (unchanged)

Displays platform-wide metrics:
- Total users, properties, campaigns
- Raw signals, qualified signals
- Matches, unlocks, unlock conversion rate
- Credits purchased vs. consumed
- COGS, gross profit, gross margin
- Cache hit rate
- All metrics breakable down by: provider, platform/source, market

### 2.4 Admin Users Page (unchanged)

- List of all registered users with key attributes
- Ability to view a user's properties, campaigns, credit balance, and activity

### 2.5 Admin Properties Page (unchanged)

- List of all properties across all users
- Filter by market, status, transaction type

### 2.6 Admin Campaigns Page (unchanged)

- List of all MatchingCampaigns with status, spend, signals, matches, unlocks

### 2.7 Admin Markets Page (unchanged)

- View and toggle market enabled/disabled status
- View per-market metrics

### 2.8 Admin Sources Page — Source Quality Management (unchanged)

Per source record:
- Qualified signals, matches, unlocks
- COGS attributed, revenue attributed
- Spam rate, quality score
- Admin can disable a source that has poor quality metrics

### 2.9 Admin Signals Page (unchanged)

- List of RawSignals and IntentProfiles
- Filter by source, market, status (raw / qualified / rejected / noise)
- View signal details

### 2.10 Admin Matches Page (unchanged)

- List of all Matches with lock/unlock status
- View match details, associated property, signal, cost

### 2.11 Admin Credits Page (unchanged)

- Credit purchase history, consumption history
- Per-user credit balance overview

### 2.12 Admin Payments Page (unchanged)

- Payment records with status, amount, provider reference
- Webhook delivery status

### 2.13 Admin Provider Costs / Health Page (unchanged)

Covers providers: DataForSEO, Apify, ZenRows, ScrapingBee, Bright Data, OpenAI, email provider, payment provider.

Per provider:
- Configuration status: NOT_CONFIGURED / MOCK / CONFIGURED_UNVERIFIED / REAL_TEST_PASSED / ERROR
- Success rate, failure rate, average latency
- Recent errors
- Usage count, total cost attributed
- Mock providers are never displayed as real or healthy

### 2.14 Admin Pricing Config Page (unchanged)

- Editable settings for PricingEngine:
  - Min price, max price
  - Strength-tier multipliers
  - Recency factor, source-quality factor, COGS factor
- Changes are saved to admin_settings; server recalculates prices using these values
- No qualified Match may be priced at zero

### 2.15 Admin Spend Caps Page (unchanged)

- Editable monthly spend caps stored in admin_settings:
  - GLOBAL cap: $250
  - DATAFORSEO cap: $40
  - APIFY cap: $100
  - ZENROWS cap: $20
  - SCRAPINGBEE cap: $5
  - BRIGHTDATA cap: $10
  - OPENAI cap: $15
- Warning state displayed at 80% of any cap
- Hard stop enforced at 100%: non-critical paid work is safely degraded, not retried infinitely
- CostEvent is the authoritative source for spend tracking; Credits/revenue are kept separate from COGS

### 2.16 Admin Import Diagnostics Page (unchanged)

- Per-import log: URL, pipeline steps attempted, provider used, CostEvent logged, error type, final status
- Useful for debugging extraction failures and provider fallback behavior

### 2.17 Homepage (updated)

The existing homepage design and dark/orange visual identity are preserved. The main URL analyse action remains the dominant element. The following sections are added below the hero:

1. **How it works** — 4-step explanation of the matching process
2. **Who Homatch finds** — four buyer personas: Buyer, Investor, Tenant, Relocating buyer
3. **Where Homatch searches** — sources listed: Public Web, Google, Bing, FB Groups, TG Groups, Instagram, VK, Forums
4. **Demo Match card** — clearly labeled DEMO; displays score, source, language, location, budget, locked preview, unlock price; uses mock data only; never mixed with production results
5. **Private/Off-Market explanation** — describes the Private Listing feature
6. **Credits explanation** — $1 = 1 Credit
7. **FAQ accordion** — expandable Q&A items; all accordion interactions must be functional

All cards, buttons, and accordions on the homepage must be interactive and functional on Android Chrome, iPhone Safari, and desktop.

### 2.18 Login / Signup Pages (updated)

- Email/password login and registration remain.
- \"Continue with Google\" is added to both Login and Signup pages using OSS Google login.
- Selected language, pending property URL, and pending private-listing action are preserved through the auth flow and restored after successful authentication.
- Login and registration are always present together.

---

## 3. Business Rules and Logic

### 3.1 Spend Cap Enforcement (unchanged)

- Before executing any paid provider call, the system checks current-month spend against the relevant provider cap and the GLOBAL cap.
- If either cap is at or above 100%, the paid call is blocked and the operation degrades gracefully.
- Warning notifications are surfaced in Admin at 80% of any cap.
- No infinite retries; retry logic uses bounded exponential backoff only.

### 3.2 Optimization and Cost Efficiency Rules (unchanged)

- Shared search (QueryPack): identical search queries across properties are not repeated as separate paid calls.
- Signal reuse: a RawSignal or IntentProfile already collected is reused across matching runs without re-fetching.
- Cache layers: extraction results, JS render results, search results, AI classification outputs, and AI translation outputs are cached. Cache hit rate is tracked.
- Deduplication: candidates are deduplicated by canonical URL, external listing ID, content fingerprint, and time window before any paid processing.
- Cheap filtering is applied before expensive AI classification.
- Incremental monitoring: only new or changed signals are processed in subsequent runs.

### 3.3 Extraction Fallback Chain (unchanged)

Order (no circular fallback):
1. Direct fetch + structured data / site adapter (MyHome.ge, SS.ge)
2. ZenRows (if configured)
3. ScrapingBee (if configured)

Each step logs the provider used and records a CostEvent. If a provider is not configured, that step is skipped.

### 3.4 Search Fallback Chain (unchanged)

Order:
1. DataForSEO
2. Configured fallback provider

### 3.5 Job Architecture (unchanged)

Exportable job functions (runnable independently or via scheduler):
- discoverMarketSources()
- collectSourceUpdates()
- classifyCandidateSignals()
- runMatching()
- sendNotifications()
- aggregateProviderCosts()
- cleanupExpiredData()

All jobs use bounded retries with exponential backoff. Jobs never block the UI. Provider jobs run in background workers.

### 3.6 Pricing Engine Rules (unchanged)

- Server calculates all Match prices using PricingEngine settings from admin_settings.
- Factors: strength tier, recency, source quality, COGS.
- No qualified Match is ever priced at zero.
- Price bounds enforced by min/max settings.

### 3.7 Security Rules (unchanged)

**Importer blocking**:
- Block URLs with localhost, private IP ranges, cloud metadata endpoints (e.g., 169.254.169.254), file:// and ftp:// protocols, and unsafe redirects.

**Rate limiting** applied to:
- Analyse / import / JS render endpoints
- Provider test endpoints
- Login endpoint
- Unlock endpoint
- Payment endpoints
- Admin endpoints

**Anonymous users**: cannot trigger paid provider calls. Provider cost is only incurred for authenticated users.

**Auditability**: CreditLedger, Payments, MatchUnlocks, and CostEvents must maintain a complete, immutable audit trail.

**Payment webhooks**: verified for authenticity before processing. Credit grants are idempotent (exactly-once). Unlock operations are atomic — no double charge.

**Ownership enforcement**: users can only access their own properties, campaigns, matches, and credits. Server-enforced on every request.

**Private photos**: access control enforced server-side; photoVisibility setting respected at all times.

**Secrets**: all provider API keys, payment secrets, and webhook secrets stored as environment variables, never in source code or database.

**Data retention**: noise signals, rejected signals, and verbose logs follow defined retention rules (configurable in admin_settings).

### 3.8 Zero Vendor Lock-in Rules (unchanged)

- All critical logic is exportable source code: frontend, backend, importer, MatchingEngine, PricingEngine, Credits, MatchUnlock, provider adapters, AI orchestration, jobs, Admin, i18n, payment orchestration.
- Source is Git-compatible; GitHub export process is documented in docs/MIGRATION.md.
- PostgreSQL schema, indexes, and migrations are maintained and exportable.
- All data entities are exportable: Users, Properties/Facts/Photos metadata, SearchProfiles, Campaigns, Markets, QueryPacks, Sources, RawSignals, IntentProfiles, Matches/Unlocks, CreditAccounts/Ledger, Payments, CostEvents, AdminSettings.
- Storage is portable via StorageProvider abstraction (S3-compatible); private photos remain private during and after migration.
- Auth system is documented for export/replacement.
- PaymentProvider is independent from Ledger, Pricing, and Unlock logic.

### 3.9 Decimal Input Rules (new)

- All numeric inputs that represent area, price, price/m², land area, or balcony area must accept and store decimal values without rounding.
- Examples of valid values: 94.4, 97.2, 103.75.
- Input fields use step=0.01 or equivalent to permit decimal entry.
- The stored value must exactly match the entered value; no silent truncation or rounding is permitted.

### 3.10 Price Interdependency Rules (new)

- Three fields are interdependent: Total Price, Price/m², and Area.
- If Area and Price/m² are both provided, Total Price is calculated automatically.
- If Area and Total Price are both provided, Price/m² is calculated automatically.
- The field currently being edited by the user is never overwritten by the calculation.
- Currency is kept synchronized across all three fields.
- Decimal precision is preserved in all calculated values.

### 3.11 Demo / Mock Matching Mode Rules (new)

- When real provider keys are not configured and demo mode is enabled, the system uses MockProvider to simulate the full matching pipeline.
- Demo mode produces a realistic mock cycle: signal discovery, classification, matching, locked previews, and unlock.
- Mock results are never mixed with production results.
- The UI, PricingEngine, CreditLedger, lock/unlock logic, and campaign state management use real application logic in demo mode; only the source data is mock.
- Mock mode tests the same server-side locked redaction as production: before unlock, full content, source, and profile are not sent to the browser; after unlock, full mock content is returned.
- Lock is never implemented as CSS blur only; redaction is enforced server-side.
- Campaign supports ACTIVE, PAUSED, and LOW_BALANCE states in both real and demo mode.
- Pause and Resume actions are functional in both modes.

### 3.12 Mock Signal Fixtures (new)

Six realistic demo signals are created, clearly marked as DEMO. Each signal includes: location, budget, property type, bedrooms, recency, matchScore, intentConfidence, signalStrength, and unlockPriceCredits.

1. Russian Telegram Group buyer
2. Georgian Facebook Group buyer
3. English investor
4. Turkish relocation buyer
5. Arabic investor
6. Hebrew buyer

These fixtures are used exclusively in demo/mock mode and are never surfaced in production matching results.

### 3.13 URL Import and Photo Extraction Rules (new)

- During URL import, the system attempts to extract cover and gallery photos from: OpenGraph metadata, structured data, embedded app state, and site adapters.
- Extracted image references are stored in normalized form.
- If images are unavailable or extraction fails, the import still succeeds and reports \"photos unavailable\" to the user.
- Import never silently presents an empty review as a successful extraction.

### 3.14 MyHome.ge Real Importer Rules (new)

- The real importer for myhome.ge extracts the following fields when available: title, transaction type, property type, city, district, address, total price, price/m², currency, area (with decimal precision), rooms, bedrooms, floor, total floors, description, features, cover image, gallery images.
- No field values are hardcoded.
- If direct fetch fails, the configured browser-render flow is used.
- The importer never silently presents an empty review as a successful result.
- Each result is clearly marked as REAL or MOCK.

### 3.15 Import Review UX Rules (new)

- Successfully extracted fields are prefilled in the review form.
- Fields that could not be extracted are highlighted for manual completion.
- Decimal values (e.g., 94.4) are never converted to integers (e.g., 94) during prefill or save.
- The customer may correct uncertain or missing data before saving.

---

## 4. Environment and Deployment (unchanged)

### 4.1 Environment Variables

.env.example is maintained and includes all variables:

```
# Database
DATABASE_URL

# App
APP_URL
NODE_ENV

# Scraping / Rendering
ZENROWS_API_KEY
SCRAPINGBEE_API_KEY

# Search
DATAFORSEO_LOGIN
DATAFORSEO_PASSWORD

# Additional providers
APOFY_API_TOKEN
BRIGHTDATA_API_KEY

# AI
OPENAI_API_KEY

# Storage
STORAGE_PROVIDER
S3_ENDPOINT
S3_BUCKET
S3_ACCESS_KEY
S3_SECRET_KEY

# Email
EMAIL_PROVIDER
EMAIL_API_KEY
EMAIL_FROM

# Payment
PAYMENT_PROVIDER
PAYMENT_SECRET_KEY
PAYMENT_WEBHOOK_SECRET

# Spend caps (USD, monthly)
SPEND_CAP_GLOBAL
SPEND_CAP_DATAFORSEO
SPEND_CAP_APIFY
SPEND_CAP_ZENROWS
SPEND_CAP_SCRAPINGBEE
SPEND_CAP_BRIGHTDATA
SPEND_CAP_OPENAI

# Dev
MOCK_DATA_PROVIDERS
```

### 4.2 Deployment Targets (unchanged)

Supported generic targets: Hostinger VPS, Hetzner, DigitalOcean, Railway, Render, AWS.

No host-specific business logic. Deployment is via standard Linux environment.

### 4.3 Deployment Components (unchanged)

- Node.js runtime (application server)
- PostgreSQL database
- Background worker / scheduler process
- Reverse proxy with SSL termination
- S3-compatible object storage

### 4.4 Deployment Artifacts (unchanged)

- Dockerfile for application container
- docker-compose.yml covering: app, PostgreSQL, worker/scheduler, reverse proxy

---

## 5. Documentation (docs/) (unchanged)

### 5.1 docs/DEPLOYMENT.md

Covers: environment variables reference, database setup and migrations, build and start commands, worker and scheduler setup, storage configuration, SSL and domain setup, webhook configuration, backup and restore procedures.

### 5.2 docs/MIGRATION.md — How to Leave the Builder

Covers: source code and Git export, database export, file/photo export, environment variable migration, auth system export/replacement, payment provider migration and webhook re-registration, email provider migration, DNS cutover, worker and scheduler setup on new host, credential rotation, generic VPS deployment steps.

### 5.3 docs/ARCHITECTURE.md

Covers: overall application architecture, backend structure, database layer, background workers, provider integrations, importer pipeline, AI orchestration, MatchingEngine, PricingEngine, Credits and Ledger, Admin section, auth system, payment flow, storage layer.

### 5.4 docs/DATABASE.md

Covers: all data models and their relations, indexes, migration strategy and commands.

### 5.5 docs/PROVIDERS.md

Per provider (DataForSEO, Apify, ZenRows, ScrapingBee, Bright Data, OpenAI, email, payment): purpose, required credentials, fallback behavior, cost model, spend cap, failure handling.

---

## 6. UX and Functional Fixes

### 6.1 UI Functionality Audit

Every interactive element must function correctly on Android Chrome, iPhone Safari, and desktop. Elements covered:
- Dropdowns (all)
- Language selector
- Navigation menu
- Notification indicators
- Property cards
- Back, Continue, Save, Analyse, Add, Private Listing, Start Matching, Pause, Resume, Credits, Activity, Dashboard buttons
- Match cards
- Accordions

Fixes required:
- z-index conflicts causing overlapping elements
- Overlay elements blocking pointer events
- Touch event handling on mobile
- Any element that is visually present but non-interactive

### 6.2 Save Property Crash Fix

- The Private Listing Save action currently produces a generic application error.
- The root cause must be traced through: form validation, database mutation, required fields, enum values, decimal field handling, auth/ownership checks, photo handling, and localization.
- The root cause is fixed; the symptom is not masked.
- Field-level validation errors are shown to the user in a clear, actionable format.
- Duplicate submit is prevented; the Save button transitions through states: Save Property -> Saving... -> success or error.

### 6.3 Start Matching

- Start Matching must be functional.
- If real providers are configured, the real pipeline is used.
- If real providers are not available and demo mode is enabled, MockProvider is used.
- Campaign states supported: ACTIVE, PAUSED, LOW_BALANCE.
- Pause and Resume actions are functional.

### 6.4 Language Audit

- All six languages are audited: EN, KA, RU, TR, AR, HE.
- Missing translation keys are identified and filled.
- Navigation, forms, and error messages are fully translated in all six languages.
- Georgian (KA) text wrapping is corrected.
- Arabic (AR) and Hebrew (HE) render in true RTL layout.

### 6.5 Mobile Fixes

- Horizontal overflow is eliminated.
- Clipped text is corrected.
- Sticky header and bottom navigation do not overlap content.
- Dropdown overlays display correctly on mobile.
- Keyboard appearance does not break layout.
- Loading states are visible and correct.
- Tap targets meet minimum size requirements.
- Development/environment badge does not obstruct any interactive control.

### 6.6 Error and Loading States

All async actions display correct loading and error states:
- Analyse -> Analysing...
- Save -> Saving...
- Start Matching -> Starting...
- Unlock -> Unlocking...

Duplicate action triggers are disabled while an action is in progress. Generic crash messages are replaced with clear, user-readable error descriptions.

---

## 7. Performance and QA

### 7.1 Performance Requirements (unchanged)

- Database queries use appropriate indexes; pagination applied to all list endpoints.
- Extraction, search, AI, and render results are cached to avoid redundant paid calls.
- Background jobs never block the UI or API response.
- Images use lazy loading.
- Mobile responsiveness maintained across all new Admin pages.

### 7.2 QA Test Scope (Part 3 — unchanged)

**Admin access control**:
- Customer cannot access any Admin page or endpoint
- Admin can access all Admin pages

**Spend cap enforcement**:
- At 80% of any cap, warning is shown in Admin
- At 100% of any cap, paid call is blocked and operation degrades gracefully
- No paid call is made for anonymous users

**Provider health display**:
- Mock providers show MOCK status, never REAL_TEST_PASSED
- Unconfigured providers show NOT_CONFIGURED

**Extraction fallback**:
- If ZenRows is not configured, step is skipped; ScrapingBee is tried next if configured
- Each step logs provider and CostEvent

**Pricing engine**:
- No qualified Match is priced at zero
- Price respects min/max bounds from admin_settings

**Security**:
- Importer blocks localhost, private IPs, metadata endpoints, file:// and ftp:// URLs
- Rate limiting active on all specified endpoints
- Payment webhook rejected if signature invalid
- Unlock is atomic; no double charge on retry

**Full E2E test path (Part 3)**:
1. User registers and sets language preference
2. User imports property via URL or creates private listing
3. Normalization and SearchProfile generated
4. Matching runs; signals and IntentProfiles created
5. Locked match preview shown to user
6. User tops up Credits via payment
7. User unlocks match; CreditLedger and CostEvent updated
8. Admin views margin, COGS, unlock conversion rate for the transaction

**Desktop and mobile**: all Admin pages tested on both

**All 6 languages** (KA/EN/RU/TR/AR/HE): Admin pages respect language setting; AR/HE render in RTL

### 7.3 QA Test Scope (UX/Demo Mode continuation)

**Decimal input**:
- Area field accepts 94.4, 97.2, 103.75 without rounding
- Stored value matches entered value exactly

**Price interdependency**:
- Area + Price/m² calculates Total Price correctly
- Area + Total Price calculates Price/m² correctly
- The field being edited is not overwritten

**Save Property**:
- Private Listing saves without crash
- Field-level errors shown on validation failure
- Button transitions through Save Property -> Saving... states
- Duplicate submit is blocked

**Google Sign-In (OSS Google login)**:
- Login and Signup pages display \"Continue with Google\"
- Language preference, pending property URL, and pending private-listing action are restored after auth

**Homepage**:
- All 7 added sections render correctly
- Demo Match card is clearly labeled DEMO
- FAQ accordion opens and closes correctly
- All buttons and cards are interactive on Android Chrome, iPhone Safari, and desktop

**URL import and photos**:
- Photos extracted from OpenGraph, structured data, embedded app state, or site adapters where available
- If photos unavailable, import succeeds and reports \"photos unavailable\"

**MyHome.ge real importer**:
- All listed fields extracted when available
- Decimal area values preserved
- Result clearly marked REAL or MOCK
- Empty review is never presented as successful

**Import review UX**:
- Extracted fields are prefilled
- Missing fields are highlighted
- 94.4 is not converted to 94

**Demo/Mock matching mode**:
- Full end-to-end flow completes without real provider keys
- 6 mock fixtures appear as locked previews with varying signal strengths and prices
- Unlock deducts Credits exactly once
- Full mock result is visible after unlock
- Mock results are never mixed with production results
- Server-side redaction is enforced before unlock; full content returned after unlock
- Lock is not CSS blur only

**Start Matching**:
- Functional with real providers when configured
- Falls back to MockProvider in demo mode
- ACTIVE, PAUSED, LOW_BALANCE states work correctly
- Pause and Resume work correctly

**Languages**:
- No untranslated strings in EN, KA, RU, TR, AR, HE
- Georgian text wraps correctly
- AR and HE render in true RTL

**Mobile**:
- No overflow or clipped text
- Navigation does not overlap content
- Dropdowns display correctly
- Tap targets are usable
- Development badge does not obstruct controls

**Full E2E test path (UX/Demo continuation)**:
1. Authenticate via OSS Google login or email/password; switch language
2. Create Private Listing; enter Area as 94.4; confirm value is accepted exactly
3. Enter Price/m²; confirm Total Price is calculated; save without crash
4. Start Matching in MOCK mode; confirm campaign becomes ACTIVE
5. Confirm locked mock match previews appear with varying signal strengths and prices
6. Unlock one match; confirm Credits are deducted exactly once and full result is visible
7. Pause campaign; confirm state changes to PAUSED; Resume and confirm ACTIVE
8. Navigate to Dashboard; confirm all dropdowns and buttons are functional
9. Test all navigation on mobile

**Separately**: URL import path and real MyHome.ge provider path tested independently.

---

## 8. Final Report (unchanged)

Upon Part 3 completion, a Final Report is generated covering:

- Product completeness: which features are complete vs. incomplete
- Per-integration status: real / mock / error, with missing credentials identified
- COGS, Credits, margin, and spend cap status at time of report
- Security audit status: each security rule verified or flagged
- Portability status: Git export, DB export, file export, Docker, VPS deployment readiness
- Test results: real vs. mock, which tests passed/failed
- Build status
- Known limitations
- Overall readiness assessment

The report does not rebuild Parts 1 or 2, does not fake integrations, and does not hide limitations.

---

## 9. Acceptance Criteria

1. Admin user logs in and accesses the Admin Overview page; customer account is blocked from the same route.
2. Admin navigates to Spend Caps page, reduces OPENAI cap to a low value, triggers an AI classification job, and confirms the job is blocked with a graceful degradation message once the cap is reached.
3. Admin navigates to Provider Health page and confirms a mock provider shows MOCK status, not REAL_TEST_PASSED.
4. Admin navigates to Pricing Config, sets a new min price, and confirms a newly generated Match is priced at or above that minimum.
5. Admin navigates to Sources page, disables a low-quality source, and confirms no new signals are collected from that source in the next job run.
6. A customer completes the full E2E path: add property -> matching active -> locked match preview -> credit top-up -> unlock -> Admin margin view reflects the transaction.
7. Importer rejects a URL pointing to a private IP address with an appropriate error; no provider call is made.
8. Payment webhook with invalid signature is rejected; valid webhook grants Credits exactly once on retry.
9. docker-compose.yml starts all components successfully on a clean Linux environment.
10. docs/MIGRATION.md contains complete steps to export source, database, files, and reconfigure auth and payments on a new host.
11. Area field accepts 94.4 and stores it without rounding; the value 94.4 is present in the database after save.
12. Private Listing saves without a generic application error; field-level errors are shown when validation fails.
13. \"Continue with Google\" (OSS Google login) is present on Login and Signup pages; language preference and pending actions are restored after authentication.
14. Homepage FAQ accordion opens and closes; Demo Match card is labeled DEMO and does not display production data.
15. Full mock E2E path completes: create property -> ACTIVE mock campaign -> locked mock matches -> unlock -> Credits deducted once -> full mock result visible -> Pause -> Resume.
16. All six languages render without untranslated strings; AR and HE display in RTL; KA text does not clip or overflow.
17. On mobile, no interactive control is obstructed by the development badge or navigation elements.

---

## 10. Out of Scope

- Rebuilding or modifying any Part 1 or Part 2 functionality not referenced above
- New customer-facing features beyond what is described in this document
- Host-specific deployment automation (CI/CD pipelines, cloud-provider SDKs)
- Automated penetration testing tooling
- Multi-tenant Admin (single Admin role only)
- Redesigning the visual identity or layout system
- Adding languages beyond the existing six (KA, EN, RU, TR, AR, HE)