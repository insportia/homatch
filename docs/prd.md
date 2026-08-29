# Requirements Document

## 1. Application Overview

**Application Name**: HOMATCH

**Application Description**: HOMATCH is an AI-driven real estate search, match, connect, and verify SaaS platform serving both demand (buyers/renters) and supply (sellers/landlords). It operates across the full cycle: SEARCH -> MATCH -> CONNECT -> VERIFY. Supports all property types (apartments, houses, villas, penthouses, land, offices, commercial, warehouses, hotels) and all transaction types (buy/sell, long-term/monthly rent, daily/short-term rent, commercial/land lease, event rental). This document covers Parts 1-3 (complete) plus UX/Functional QA, Demo Mode, Phase 3 new features, and the major product experience overhaul described in this revision.

**Build Scope**: Additive improvement on top of the existing Phase 1/2/3 implementation. Parts 1, 2, and 3 are not rebuilt. All prior functionality remains unchanged except where explicitly modified below.

---

## 2. Page Structure and Feature Description

### 2.1 Page Hierarchy (full, updated)

```
HOMATCH
├── / (Homepage — redesigned)
├── /ai (AI Assistant — new)
├── /verify (Verification Center — new)
├── /partners (Partner/Advertise — new)
├── /login
├── /signup
├── /dashboard (improved)
├── /properties
├── /properties/:id
├── /matches
├── /active-searches
├── /messages
├── /viewings
├── /developers
├── /developers/:id
├── /account
├── /credits
└── Admin Section (role-gated, server-enforced)
    ├── Overview
    ├── Users
    ├── Properties
    ├── Campaigns
    ├── Markets
    ├── Sources
    ├── Signals
    ├── Matches
    ├── Credits
    ├── Payments
    ├── Provider Costs / Health
    ├── Pricing Config
    ├── Spend Caps
    ├── Import Diagnostics
    ├── PAYG Pricing Engine Config
    └── Sponsored / Partners (new)
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

### 2.8 Admin Sources Page (unchanged)

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

### 2.17 Admin PAYG Pricing Engine Config Page (unchanged)

- Lists all configured pricing operations: provider, operation name, actual cost, base cost, markupMultiplier, customerPrice, currency
- Admin can update markupMultiplier globally or per operation
- Changes take effect immediately for new operations; existing ledger entries are immutable
- No hardcoded prices; all values stored in the pricing engine table

### 2.18 Admin Sponsored / Partners Page (new)

- List of all sponsored placements with: creative, destination URL, market, language, start date, end date, enabled/disabled status, partner category
- Admin can create, edit, enable, and disable placements
- Partner categories: developers, agencies, mortgage/financial, relocation/legal/property-service
- Sponsored placements never affect Trust Score, Match Score, Developer Score, or organic ranking

### 2.19 Homepage (redesigned — visual identity preserved)

**Hero section**:
- Headline: \"HOMATCH — AI Real Estate Search, Match and Verification\"
- Sub-headline: \"Tell Homatch what you need. We search, match, compare and help you verify.\"
- Primary CTA is an AI conversation input field (not a traditional portal search form)
- Secondary CTAs immediately below hero:
  - FIND A PROPERTY — routes to AI Assistant with buyer/renter context
  - FIND A BUYER/RENTER — routes to property upload/import flow
  - VERIFY PROPERTY — routes to /verify
  - CHECK A DEVELOPER — routes to /verify with Developer tab active
  - PASTE A PROPERTY LINK — routes to import/compare flow

**Sections below hero** (in order):
1. KEY FEATURES — accent/underline typography for each differentiator: AI PROPERTY SEARCH; BUYER/SELLER MATCHING; MULTI-SOURCE DISCOVERY; FIND SAME PROPERTY CHEAPER; DUPLICATE DETECTION; HOMATCH TRUST SCORE; CADASTRAL VERIFICATION; DEVELOPER TRUST PROFILE; ACTIVE AI SEARCH; REAL-TIME CHAT; VIEWING REQUESTS; MULTILINGUAL DISCOVERY
2. Visual dual-flow diagram: BUYER/RENTER flow and SELLER/LANDLORD flow
3. HOW HOMATCH WORKS: SEARCH -> MATCH -> CONNECT -> VERIFY with concrete examples per step
4. WHY HOMATCH: stop checking many portals manually; one request; internal supply/demand first; AI filters and ranks; duplicates and price differences surfaced; verify before decisions; Active Searches continue automatically
5. Demo UI section (clearly labeled DEMO): sample AI query with ranked result cards showing Match %, price, source, Trust indicator; mock data only
6. Verification teaser: \"Before you pay, verify.\" with CTA to /verify
7. Partner/Sponsored placements area — tasteful, every placement labeled Sponsored or Ad
8. Pricing section: FREE $0/month, PLUS $4.90/month, PRO $9.90/month
9. FAQ accordion — all interactions functional

All cards, buttons, and accordions must be interactive on Android Chrome, iPhone Safari, and desktop.

### 2.20 Login / Signup Pages (unchanged)

- Email/password login and registration remain.
- \"Continue with Google\" added to both pages using OSS Google login.
- Selected language, pending property URL, and pending private-listing action are preserved through the auth flow.

### 2.21 HOMATCH AI Assistant (new)

**Access points**:
- Floating button available on all pages
- Prominent input on homepage hero
- Dedicated route: /ai
- Context-aware entry from property detail, developer profile, matches, verification, and dashboard

**Capabilities**:
- Natural language queries including but not limited to:
  - \"Find a 2-bedroom apartment in Vake under $150k\"
  - \"Find buyers for my apartment\"
  - \"Compare these properties\"
  - \"Is this listing suspicious?\"
  - \"Check this cadastral code\"
  - \"Tell me about this developer\"
  - \"Find the same apartment cheaper\"
  - \"Show my strongest matches\"
  - \"Why is this match 92%?\"
  - \"Find a villa for 20 people this weekend\"
- Context-aware: when opened from a property page, AI receives that property's context automatically; same for developer page, matches page, verification page
- Connects to all existing Homatch data and tools: internal properties, external discovery, buyer/renter demand, seller properties, matches, saved/Active Searches, duplicate detection, Trust Score, verification, developer profiles, conversations, viewings, credits/balance, account data
- Multi-turn context: prior constraints are preserved across follow-up messages within the same conversation
- Persistent conversation history per user: conversation list with titles, ability to start a new chat, contextual follow-ups
- Responses streamed via SSE using Gemini 2.5 Flash via Edge Function
- Mobile: AI entry point must not cover important content

### 2.22 Verification Center (/verify) (new)

**Page structure**:
- Search mode tabs at top: PROPERTY / CADASTRAL CODE / DEVELOPER / PROJECT
- Each tab has its own search input and results area

**Property / Cadastral Code verification results show**:
- Cadastral code, address/location
- Official/public characteristics
- Listing-vs-record comparison, area mismatch detection
- Restrictions, mortgage, lien where available
- Related developer/project
- Sources used
- Trust Score and risk indicators
- Last checked timestamp
- Option to order paid official documents — never silently purchased; exact credit price shown and explicit confirmation required

**Developer / Project search results show**:
- Company/project information
- Active and completed projects
- Land and cadastral signals
- Permits and status
- Completion history
- Public risk indicators
- Developer Score with explainable factors
- Evidence list
- lastCheckedAt timestamp
- Sponsored content clearly labeled \"Sponsored\"; never influences Developer Score

**Data labeling**:
- Every data point is labeled as one of: official/public data, source-reported data, AI inference, or unavailable
- Scores are explainable; no guarantees are stated
- No automatic fraud accusations

### 2.23 Partner / Advertise Page (/partners) (new)

- Describes partner and advertising opportunities for: developers, agencies, mortgage/financial providers, relocation/legal/property-service providers
- Contact or inquiry form for partnership interest
- States clearly that sponsored placements are always labeled and never affect organic scores or rankings

### 2.24 In-App Chat (unchanged)

- Accessible from: Match detail, Viewing Request detail, user profile context
- Conversation list view: shows all active conversations, unread count per conversation, last message preview, timestamp
- Conversation detail view: message thread with SENT/DELIVERED/SEEN/FAILED status per message, timestamps, send input
- Contact details (phone, WhatsApp, Telegram) are private by default; user explicitly chooses to share each contact type within the conversation
- Block, report, and mute actions available per conversation
- Notification preferences: user can configure in-app, push, and email notification settings per conversation or globally
- On first contact between two users: in-app notification + push notification + one transactional email sent
- Subsequent messages: realtime and push only; no additional transactional email
- Uses existing Supabase Realtime architecture
- Internal Homatch users connect via Chat; they do not go through the external contact unlock flow

### 2.25 Viewing Request (unchanged)

- Buyer/renter can submit a viewing request from a property detail page or match detail
- Request form: preferred date, preferred time, optional note
- States: PENDING, ACCEPTED, DECLINED, RESCHEDULE_PROPOSED, CANCELLED, COMPLETED
- Seller/landlord receives notification and can accept, decline, or propose a reschedule with an alternative date/time
- Buyer/renter is notified of state changes
- Both parties can cancel a pending or accepted request
- COMPLETED state is set by manual confirmation from either party
- Viewing requests are listed in the user's dashboard for both parties

### 2.26 External Contact Unlock (unchanged)

- Applies to external demand signals (non-Homatch users) only
- Pre-unlock display is mandatory: Match Score, buyer/renter/investor type, requested location, transaction type, budget (when known), requirements, signal freshness, source, confidence level
- Phone, email, WhatsApp, and Telegram are never shown before authorized unlock
- Uncertain leads are labeled \"Possible Buyer\" or \"Possible Renter\"; never labeled \"confirmed\"
- Exact credit price is shown and user must confirm before unlock is executed
- Unlock is atomic and idempotent; credits are deducted exactly once
- After unlock, full available contact details are revealed
- Internal Homatch users are never routed through this flow

### 2.27 Active Search — Bi-Directional (unchanged)

- Buyers/renters with an active search profile automatically receive notifications when new matching properties are indexed or updated
- Sellers/landlords with active listings automatically receive notifications when new matching demand signals are found
- Matching is triggered by newly indexed or updated data (event-driven, background)
- Notifications delivered via in-app and push; no additional transactional email per match event beyond the first-contact rule
- User can pause or resume their active search from the dashboard

### 2.28 Canonical Deduplication (unchanged)

- The system identifies when multiple sources refer to the same physical property using: address, coordinates, cadastral code, area, rooms/floor, text similarity, price similarity, image similarity
- One physical property = one canonical entity; multiple source records are linked to it
- On property detail and match views, a deduplication summary is shown when applicable: example — \"Found on 3 sources. Lowest price $67,000. Difference $5,000.\"
- Deduplication runs as a background process; it does not block import or matching

### 2.29 Homatch Trust Score (unchanged)

- Displayed on property detail pages and match previews
- Factors evaluated: conflicting price/area/location across sources, duplicate images, stale data, cadastral mismatch, source confidence
- Output: a risk indicator and confidence language (e.g., \"High Confidence\", \"Some Discrepancies Found\", \"Low Confidence\")
- Language is never accusatory; the system never automatically labels a listing as fraudulent
- Trust Score is recalculated when new source data is available

### 2.30 Developer Trust Profiles (unchanged)

- Accessible from property detail pages where a developer/company is identified
- Displays: company/project history, completed projects, current projects, land and cadastral information, permits, completion history, restrictions, public risk evidence
- An explainable Developer Score is shown with a lastCheckedAt timestamp
- Sponsored content is clearly labeled \"Sponsored\" and never influences the Developer Score
- Developer Trust Profiles are informational; no automatic fraud accusations

### 2.31 Dashboard (improved)

- Never feels empty; widgets are context-aware based on user activity
- Widget set:
  - Continue with Homatch AI (prominent, always shown)
  - Active Searches with new match counts
  - New Property Matches / Potential Buyers/Renters
  - My Properties
  - Recent Conversations
  - Upcoming Viewings
  - Saved Properties
  - Verification History
  - Credits/Plan summary
- Empty states for each widget explain the next action with a clear CTA
- Widgets that have no data are shown with an empty state, not hidden

### 2.32 Property Detail — AI-Integrated Actions (updated)

Actions available on property result cards and detail pages:
- Ask Homatch AI (AI receives current property context automatically)
- Compare
- Find Same Property Elsewhere
- Find Better Deal
- Verify (routes to /verify with property pre-filled)
- Save
- Chat / Contact

For seller-owned properties:
- Find Buyers/Renters action exposed
- Internal and external demand matches displayed

Every match card includes a \"Why this match?\" explanation.

### 2.33 Navigation (updated)

Main navigation items:
- AI / Search
- Properties / Matches
- Find Buyers/Renters (Sell)
- Active Searches
- Messages (with unread count badge)
- Verification
- Developers
- Viewings
- Account / Balance

Secondary tools grouped to avoid overcrowding.

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
- Cache layers: extraction results, JS render results, search results, AI classification outputs, and AI translation outputs are cached.
- Deduplication: candidates are deduplicated by canonical URL, external listing ID, content fingerprint, and time window before any paid processing.
- Cheap filtering is applied before expensive AI classification.
- Incremental monitoring: only new or changed signals are processed in subsequent runs.

### 3.3 Extraction Fallback Chain (unchanged)

Order:
1. Direct fetch + structured data / site adapter (MyHome.ge, SS.ge)
2. ZenRows (if configured)
3. ScrapingBee (if configured)

Each step logs the provider used and records a CostEvent.

### 3.4 Search Fallback Chain (unchanged)

Order:
1. DataForSEO
2. Configured fallback provider

### 3.5 Job Architecture (unchanged)

Exportable job functions:
- discoverMarketSources()
- collectSourceUpdates()
- classifyCandidateSignals()
- runMatching()
- sendNotifications()
- aggregateProviderCosts()
- cleanupExpiredData()

All jobs use bounded retries with exponential backoff. Jobs never block the UI.

### 3.6 Pricing Engine Rules (unchanged)

- Server calculates all Match prices using PricingEngine settings from admin_settings.
- Factors: strength tier, recency, source quality, COGS.
- No qualified Match is ever priced at zero.
- Price bounds enforced by min/max settings.

### 3.7 Security Rules (unchanged)

- Importer blocks: localhost, private IP ranges, cloud metadata endpoints (e.g., 169.254.169.254), file:// and ftp:// protocols, unsafe redirects.
- Rate limiting applied to: Analyse/import/JS render, provider test, login, unlock, payment, and Admin endpoints.
- Anonymous users cannot trigger paid provider calls.
- CreditLedger, Payments, MatchUnlocks, and CostEvents maintain a complete, immutable audit trail.
- Payment webhooks verified for authenticity before processing; credit grants are idempotent; unlock operations are atomic.
- Ownership enforcement: users can only access their own properties, campaigns, matches, and credits.
- Private photos: access control enforced server-side.
- Secrets: all provider API keys, payment secrets, and webhook secrets stored as environment variables.
- Data retention: noise signals, rejected signals, and verbose logs follow defined retention rules.

### 3.8 Zero Vendor Lock-in Rules (unchanged)

- All critical logic is exportable source code.
- Source is Git-compatible; GitHub export process documented in docs/MIGRATION.md.
- PostgreSQL schema, indexes, and migrations are maintained and exportable.
- All data entities are exportable.
- Storage is portable via StorageProvider abstraction (S3-compatible).
- Auth system is documented for export/replacement.
- PaymentProvider is independent from Ledger, Pricing, and Unlock logic.

### 3.9 Decimal Input Rules (unchanged)

- All numeric inputs representing area, price, price/m2, land area, or balcony area must accept and store decimal values without rounding.
- Input fields use step=0.01 or equivalent.
- Stored value must exactly match the entered value.

### 3.10 Price Interdependency Rules (unchanged)

- Total Price, Price/m2, and Area are interdependent.
- If Area and Price/m2 are both provided, Total Price is calculated automatically.
- If Area and Total Price are both provided, Price/m2 is calculated automatically.
- The field currently being edited is never overwritten by the calculation.
- Currency is kept synchronized across all three fields.

### 3.11 Demo / Mock Matching Mode Rules (unchanged)

- When real provider keys are not configured and demo mode is enabled, MockProvider simulates the full matching pipeline.
- Mock results are never mixed with production results.
- Lock is never implemented as CSS blur only; redaction is enforced server-side.
- Campaign supports ACTIVE, PAUSED, and LOW_BALANCE states in both real and demo mode.

### 3.12 Mock Signal Fixtures (unchanged)

Six realistic demo signals, clearly marked DEMO:
1. Russian Telegram Group buyer
2. Georgian Facebook Group buyer
3. English investor
4. Turkish relocation buyer
5. Arabic investor
6. Hebrew buyer

### 3.13 URL Import and Photo Extraction Rules (unchanged)

- System attempts to extract cover and gallery photos from: OpenGraph metadata, structured data, embedded app state, and site adapters.
- If images are unavailable, import still succeeds and reports \"photos unavailable\".

### 3.14 MyHome.ge Real Importer Rules (unchanged)

- Extracts: title, transaction type, property type, city, district, address, total price, price/m2, currency, area (with decimal precision), rooms, bedrooms, floor, total floors, description, features, cover image, gallery images.
- No field values are hardcoded.
- Each result is clearly marked REAL or MOCK.

### 3.15 Import Review UX Rules (unchanged)

- Successfully extracted fields are prefilled in the review form.
- Fields that could not be extracted are highlighted for manual completion.
- Decimal values are never converted to integers during prefill or save.

### 3.16 PAYG Pricing Engine Rules (unchanged)

- CUSTOMER_PRICE = ACTUAL_EXTERNAL_COST x markupMultiplier (default 2.0).
- One pricing engine table stores: provider, operation, actual cost, base cost, markupMultiplier, customerPrice, currency, timestamp.
- Admin can change markupMultiplier globally or per operation from the Admin PAYG Pricing Engine Config page.
- No prices are hardcoded anywhere in the application.
- Before any paid operation, the exact credit price is shown to the user and explicit confirmation is required.
- The existing credits/wallet system is extended; no new billing system is introduced.
- The immutable ledger and idempotency rules from the existing CreditLedger apply.
- Actual provider cost is recorded separately from the customer price in CostEvent.
- Cost resolution order: INTERNAL/CACHE -> LOW-COST -> PAID EXTERNAL -> USER-CONFIRMED PAYG.

### 3.17 Fixed Subscription Pricing (unchanged)

- FREE: $0/month
- PLUS: $4.90/month
- PRO: $9.90/month
- Plans apply equally to buyers and sellers.
- Fixed plan pricing is separate from PAYG credits and is not affected by the PAYG markupMultiplier.

### 3.18 Chat and Messaging Rules (unchanged)

- Message delivery states: SENT, DELIVERED, SEEN, FAILED.
- Unread counts are maintained per conversation and surfaced in navigation.
- Contact details (phone, WhatsApp, Telegram) are private by default; sharing is an explicit user action per contact type.
- On first contact between two users: one transactional email is sent in addition to in-app and push notifications.
- Subsequent messages trigger realtime and push notifications only.
- Block action: blocked user cannot send messages; blocked user is not notified of the block.
- Mute action: muted conversation does not trigger push notifications.
- Report action: submits a report for Admin review.
- Internal Homatch users always use Chat; they never go through the external contact unlock flow.

### 3.19 Viewing Request Rules (unchanged)

- A viewing request can only be submitted by a buyer/renter to a seller/landlord for a specific property.
- State transitions:
  - PENDING -> ACCEPTED, DECLINED, CANCELLED
  - PENDING -> RESCHEDULE_PROPOSED (by seller/landlord)
  - RESCHEDULE_PROPOSED -> ACCEPTED, DECLINED, CANCELLED (by buyer/renter)
  - ACCEPTED -> COMPLETED, CANCELLED
- COMPLETED is set by manual confirmation from either party.
- Both parties receive notifications on every state change.

### 3.20 External Contact Unlock Rules (unchanged)

- Applies only to external demand signals (non-Homatch users).
- Pre-unlock display is mandatory: Match Score, lead type, requested location, transaction type, budget (when known), requirements, freshness, source, confidence.
- Uncertain leads use \"Possible Buyer\" or \"Possible Renter\" labels; never \"confirmed\".
- Phone, email, WhatsApp, and Telegram are never transmitted to the browser before unlock.
- Unlock is atomic and idempotent; credits are deducted exactly once.
- Exact credit price is shown and confirmation is required before deduction.

### 3.21 Canonical Deduplication Rules (unchanged)

- Deduplication signals: address match, coordinate proximity, cadastral code match, area match, room/floor match, text similarity threshold, price similarity threshold, image hash similarity.
- One canonical property entity is maintained; source records are linked to it.
- Deduplication runs as a background job; it does not block import, matching, or UI.
- Deduplication summary is shown on property detail and match views when multiple sources are found.

### 3.22 Trust Score Rules (unchanged)

- Trust Score is computed from: cross-source price/area/location conflicts, duplicate image detection, data staleness, cadastral mismatch, source confidence scores.
- Output is a confidence label and risk indicators; no automatic fraud accusation.
- Trust Score is recalculated when new source data is ingested.
- Developer Trust Score is never influenced by sponsored status; sponsored content is always labeled \"Sponsored\".

### 3.23 AI Assistant Rules (new)

- AI Assistant connects to all existing Homatch data and tools; it does not bypass existing access control or ownership rules.
- Context injection: when AI is opened from a specific page, the relevant entity context (property, developer, match, verification) is passed automatically.
- Multi-turn context is maintained within a conversation session; prior constraints are preserved across follow-up messages.
- Conversation history is persisted per user; each conversation has a title.
- Responses are streamed via SSE.
- AI never guarantees legal, financial, or fraud-detection outcomes.
- AI never silently triggers paid operations; any paid action requires explicit user confirmation per existing PAYG rules.
- Anonymous users may interact with AI in a limited demo capacity; paid or account-specific queries require authentication.

### 3.24 Sponsored Placement Rules (new)

- Every sponsored placement must display a visible \"Sponsored\" or \"Ad\" label.
- Sponsored placements never affect Trust Score, Match Score, Developer Score, or organic ranking.
- Sponsored placements are managed exclusively via the Admin Sponsored / Partners page.
- Placements respect market and language targeting settings.
- Placements outside their start/end date range are not shown.

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
GEMINI_API_KEY

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

### 5.2 docs/MIGRATION.md

Covers: source code and Git export, database export, file/photo export, environment variable migration, auth system export/replacement, payment provider migration and webhook re-registration, email provider migration, DNS cutover, worker and scheduler setup on new host, credential rotation, generic VPS deployment steps.

### 5.3 docs/ARCHITECTURE.md

Covers: overall application architecture, backend structure, database layer, background workers, provider integrations, importer pipeline, AI orchestration, MatchingEngine, PricingEngine, Credits and Ledger, Admin section, auth system, payment flow, storage layer.

### 5.4 docs/DATABASE.md

Covers: all data models and their relations, indexes, migration strategy and commands.

### 5.5 docs/PROVIDERS.md

Per provider: purpose, required credentials, fallback behavior, cost model, spend cap, failure handling.

---

## 6. UX and Functional Fixes (unchanged)

### 6.1 UI Functionality Audit

Every interactive element must function correctly on Android Chrome, iPhone Safari, and desktop. Fixes required:
- z-index conflicts causing overlapping elements
- Overlay elements blocking pointer events
- Touch event handling on mobile
- Any element that is visually present but non-interactive

### 6.2 Save Property Crash Fix

- Root cause traced and fixed through: form validation, database mutation, required fields, enum values, decimal field handling, auth/ownership checks, photo handling, and localization.
- Field-level validation errors shown in a clear, actionable format.
- Duplicate submit is prevented; Save button transitions: Save Property -> Saving... -> success or error.

### 6.3 Start Matching

- Functional with real providers when configured.
- Falls back to MockProvider in demo mode.
- Campaign states: ACTIVE, PAUSED, LOW_BALANCE.
- Pause and Resume actions are functional.

### 6.4 Language Audit

- All six languages audited: EN, KA, RU, TR, AR, HE.
- Missing translation keys identified and filled.
- Georgian (KA) text wrapping corrected.
- Arabic (AR) and Hebrew (HE) render in true RTL layout.

### 6.5 Mobile Fixes

- Horizontal overflow eliminated.
- Sticky header and bottom navigation do not overlap content.
- Dropdown overlays display correctly on mobile.
- Tap targets meet minimum size requirements.
- Development/environment badge does not obstruct any interactive control.
- AI floating button does not cover important content or interactive controls.

### 6.6 Error and Loading States

All async actions display correct loading and error states:
- Analyse -> Analysing...
- Save -> Saving...
- Start Matching -> Starting...
- Unlock -> Unlocking...

Duplicate action triggers are disabled while an action is in progress.

---

## 7. Performance and QA

### 7.1 Performance Requirements (unchanged)

- Database queries use appropriate indexes; pagination applied to all list endpoints.
- Extraction, search, AI, and render results are cached.
- Background jobs never block the UI or API response.
- Images use lazy loading.

### 7.2 QA Test Scope (Part 3 — unchanged)

**Admin access control**: Customer cannot access any Admin page or endpoint.

**Spend cap enforcement**: Warning at 80%; hard block at 100%; no paid calls for anonymous users.

**Provider health display**: Mock providers show MOCK; unconfigured show NOT_CONFIGURED.

**Extraction fallback**: Unconfigured steps are skipped; each step logs provider and CostEvent.

**Pricing engine**: No qualified Match priced at zero; price respects min/max bounds.

**Security**: Importer blocks private IPs and unsafe protocols; rate limiting active; webhook rejected if signature invalid; unlock is atomic.

**Full E2E test path (Part 3)**:
1. User registers and sets language preference
2. User imports property via URL or creates private listing
3. Normalization and SearchProfile generated
4. Matching runs; signals and IntentProfiles created
5. Locked match preview shown to user
6. User tops up Credits via payment
7. User unlocks match; CreditLedger and CostEvent updated
8. Admin views margin, COGS, unlock conversion rate for the transaction

### 7.3 QA Test Scope (UX/Demo Mode — unchanged)

**Decimal input**: Area field accepts 94.4, 97.2, 103.75 without rounding.

**Price interdependency**: Calculations correct; field being edited is not overwritten.

**Save Property**: Saves without crash; field-level errors shown; duplicate submit blocked.

**Google Sign-In**: OSS Google login present on Login and Signup; language and pending actions restored after auth.

**Homepage**: All sections render; Demo Match card labeled DEMO; FAQ accordion functional.

**URL import and photos**: Photos extracted where available; import succeeds with \"photos unavailable\" when not.

**MyHome.ge real importer**: All fields extracted; decimal area preserved; result marked REAL or MOCK.

**Demo/Mock matching mode**: Full E2E without real provider keys; 6 mock fixtures appear; unlock deducts credits once; server-side redaction enforced; lock is not CSS blur only.

**Languages**: No untranslated strings in any of the 6 languages; AR and HE in true RTL.

**Mobile**: No overflow; navigation does not overlap content; tap targets usable.

### 7.4 QA Test Scope (Phase 3 New Features — unchanged)

**Realtime Chat**: Two matched internal users exchange messages in realtime; message status progresses through SENT, DELIVERED, SEEN; unread count updates correctly; contact details not visible until explicitly shared; first contact triggers one transactional email; block, mute, and report execute without error.

**Viewing Request**: Buyer submits request; seller receives notification and can accept, decline, or propose reschedule; all state transitions execute correctly; COMPLETED state settable by manual confirmation.

**External Contact Unlock**: Pre-unlock view shows all required fields; no contact details visible; uncertain leads labeled correctly; exact price shown and confirmation required; credits deducted exactly once; internal users never routed through this flow.

**Active Search**: Buyer receives notification when new matching property indexed; seller receives notification when new matching demand signal found; user can pause and resume.

**Canonical Deduplication**: Property on 3 sources merged into one canonical entity; deduplication summary displayed; runs in background without blocking import.

**Trust Score**: Displayed with correct confidence label; conflicting data produces lower confidence; no fraud accusation language; Developer Trust Score not affected by sponsored status; sponsored content labeled \"Sponsored\".

**PAYG Pricing Engine**: CUSTOMER_PRICE = ACTUAL_EXTERNAL_COST x 2.0 by default; Admin changes markupMultiplier; new operations use updated multiplier; existing ledger entries unchanged; exact price shown and confirmation required; cost resolution order respected.

**Full E2E test path (Phase 3 new features)**:
1. Authenticate via OSS Google login; set language preference
2. Create property; enter Area as 94.4; confirm value stored exactly
3. Start Matching; confirm campaign becomes ACTIVE
4. Locked match previews appear; unlock external signal; confirm credits deducted once and contact details visible
5. Send first in-app message to matched internal user; confirm transactional email sent once
6. Send second message; confirm no additional transactional email
7. Submit viewing request; seller accepts; confirm state is ACCEPTED
8. Pause active search; confirm paused; resume and confirm ACTIVE
9. View property with multiple sources; confirm deduplication summary shown
10. View Trust Score on property detail; confirm confidence label present

### 7.5 QA Test Scope (Overhaul New Features)

**Homepage redesign**:
- Hero AI input is present and functional
- All five secondary CTAs route to correct destinations
- KEY FEATURES section renders all 12 differentiators
- Dual-flow diagram renders correctly
- Demo UI section is labeled DEMO and shows no production data
- Verification teaser CTA routes to /verify
- Sponsored placements are labeled Sponsored or Ad
- Pricing section shows FREE $0, PLUS $4.90/mo, PRO $9.90/mo
- FAQ accordion functional on Android Chrome, iPhone Safari, and desktop

**AI Assistant**:
- Floating button present on all pages and does not cover interactive controls on mobile
- /ai route loads conversation interface
- Natural language query returns relevant results
- Context is injected correctly when opened from property detail, developer profile, matches, and verification pages
- Multi-turn context: follow-up message preserves prior constraints
- Conversation history persists across sessions
- AI does not silently trigger paid operations; confirmation required
- Anonymous user receives limited demo response; account-specific query prompts authentication

**Verification Center**:
- /verify loads with PROPERTY / CADASTRAL CODE / DEVELOPER / PROJECT tabs
- Property search returns Trust Score, data labels, and last checked timestamp
- Paid document order shows exact credit price and requires confirmation before deduction
- Developer search returns Developer Score with explainable factors and lastCheckedAt
- Sponsored content on developer results is labeled Sponsored and does not affect Developer Score
- Every data point is labeled as official/public, source-reported, AI inference, or unavailable

**Partner / Advertise Page**:
- /partners loads and describes partner categories
- Inquiry form submits without error

**Admin Sponsored / Partners Page**:
- Admin can create, edit, enable, and disable a sponsored placement
- Placement with past end date does not appear on frontend
- Sponsored placement does not affect Trust Score, Match Score, or Developer Score

**Dashboard improvements**:
- All widgets render with correct data when user has activity
- Empty state widgets show a CTA explaining the next action
- \"Continue with Homatch AI\" widget is always shown prominently

**Property detail AI actions**:
- \"Ask Homatch AI\" action opens AI with property context pre-loaded
- \"Verify\" action routes to /verify with property pre-filled
- \"Why this match?\" explanation is present on match cards
- Seller property exposes \"Find Buyers/Renters\" action

**Navigation**:
- All navigation items route to correct pages
- Messages item shows unread count badge
- Navigation does not overlap content on mobile

**Full E2E test path (overhaul)**:
1. Visit homepage; confirm hero AI input present and five secondary CTAs visible
2. Type a natural language property query in hero AI input; confirm results returned
3. Open AI floating button from a property detail page; confirm property context injected
4. Send follow-up message narrowing results; confirm prior constraints preserved
5. Navigate to /verify; search for a property by address; confirm Trust Score and data labels shown
6. Search for a developer; confirm Developer Score and lastCheckedAt shown; confirm sponsored label present if applicable
7. Log in; open dashboard; confirm all widgets present with empty states or real data
8. Open a property detail; confirm Ask Homatch AI, Verify, and Why this match actions present
9. Admin logs in; creates a sponsored placement; confirms it appears on homepage with Sponsored label
10. Admin disables the placement; confirms it no longer appears on homepage

---

## 8. Final Report (unchanged)

Upon completion, a Final Report is generated covering:
- Product completeness: which features are complete vs. incomplete
- Per-integration status: real / mock / error, with missing credentials identified
- COGS, Credits, margin, and spend cap status at time of report
- Security audit status: each security rule verified or flagged
- Portability status: Git export, DB export, file export, Docker, VPS deployment readiness
- Test results: real vs. mock, which tests passed/failed
- Build status
- Known limitations
- Overall readiness assessment

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
17. On mobile, no interactive control is obstructed by the development badge, navigation elements, or AI floating button.
18. Two matched internal users exchange messages in realtime; contact details remain hidden until explicitly shared; first contact triggers exactly one transactional email.
19. Viewing request submitted by buyer transitions through all states correctly; both parties notified on each transition.
20. External contact unlock shows pre-unlock summary without contact details; credits deducted exactly once; full details visible after unlock.
21. Admin updates PAYG markupMultiplier; new paid operation uses updated multiplier; existing ledger entries are unchanged.
22. Property appearing on 3 sources is shown with a deduplication summary on the property detail page.
23. Trust Score displayed on property detail with a confidence label; no fraud accusation language present; Developer Trust Score is not affected by sponsored status.
24. Buyer with active search profile receives a notification when a new matching property is indexed; user can pause and resume active search.
25. Homepage hero AI input is present; typing a natural language query returns results; five secondary CTAs route to correct destinations.
26. AI floating button is present on all pages; opening it from a property detail page injects that property's context; a follow-up message preserves prior constraints.
27. /verify loads with four tabs; property search returns Trust Score with data labels; developer search returns Developer Score with lastCheckedAt; paid document order requires explicit confirmation.
28. Admin creates a sponsored placement; it appears on the homepage with a visible Sponsored label; disabling it removes it from the homepage; it does not affect any organic score.
29. Dashboard shows all widgets with correct data or empty states with CTAs; \"Continue with Homatch AI\" widget is always visible.
30. Property detail page shows Ask Homatch AI, Verify, and Why this match actions; seller property shows Find Buyers/Renters action.

---

## 10. Out of Scope

- Rebuilding or modifying any Part 1 or Part 2 functionality not referenced above
- New customer-facing features beyond what is described in this document
- Host-specific deployment automation (CI/CD pipelines, cloud-provider SDKs)
- Automated penetration testing tooling
- Multi-tenant Admin (single Admin role only)
- Redesigning the visual identity or color system
- Adding languages beyond the existing six (KA, EN, RU, TR, AR, HE)
- Automated fraud detection or legal accusations based on Trust Score
- Video or voice calling within Chat
- Calendar integration for Viewing Requests
- Public developer profile pages beyond what is described in section 2.30
- New subscription pricing tiers beyond FREE, PLUS, and PRO
- AI-generated legal or financial advice