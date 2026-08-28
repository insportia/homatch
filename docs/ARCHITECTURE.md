# Homatch — Architecture

## System Overview

Homatch is an AI-powered property intent-matching SaaS. Property owners add their listings;
the platform collects demand signals (social posts, search queries) from public sources,
classifies intent with AI, matches signals to properties, and charges Credits to unlock
full signal details.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Frontend (React + Vite + Tailwind + shadcn/ui)                     │
│  Customer: Dashboard, Properties, Matches, Credits, Activity        │
│  Admin:    Overview, Sources, Signals, Providers, Pricing, Caps     │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ HTTPS / REST / Realtime
┌──────────────────────────▼──────────────────────────────────────────┐
│  Backend: Supabase (PostgreSQL + Edge Functions + Storage + Auth)   │
│                                                                     │
│  Edge Functions (Deno):                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │import-property│  │run-matching  │  │atomic-unlock             │  │
│  │dataforseo-srch│  │classify-sgnl │  │credits-topup             │  │
│  │social-collect │  │payment-wbhk  │  │provider-health-check     │  │
│  │spend-cap-check│  └──────────────┘  └──────────────────────────┘  │
│  └──────────────┘                                                   │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ Service Role (server-only)
┌──────────────────────────▼──────────────────────────────────────────┐
│  Worker / Scheduler (Deno, portable)                                │
│  discoverMarketSources  →  collectSourceUpdates                     │
│  classifyCandidateSignals  →  runMatching  →  sendNotifications     │
│  aggregateProviderCosts  →  cleanupExpiredData                      │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ API calls (with spend cap enforcement)
┌──────────────────────────▼──────────────────────────────────────────┐
│  External Providers (all optional — mock fallback when absent)      │
│  DataForSEO   │  Apify   │  ZenRows   │  ScrapingBee               │
│  BrightData   │  OpenAI  │  Stripe    │  Resend                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Frontend

**Stack:** React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, React Router v6

**Key directories:**
- `src/pages/` — page components (customer + admin sections)
- `src/components/layouts/` — `AppLayout`, `AdminLayout` (role-enforced)
- `src/services/api.ts` — all Supabase queries and Edge Function invocations
- `src/types/types.ts` — canonical TypeScript interfaces for all entities
- `src/i18n/translations.ts` — 6-language static bundles (KA/EN/RU/TR/AR/HE)
- `src/contexts/AuthContext.tsx` — session + homatchUser state

**Routing:** `src/routes.tsx` — 26 routes. Admin routes wrapped in `AdminLayout`
which redirects non-admins to `/dashboard` on the client; server-side RLS and
Edge Function auth checks enforce this independently.

**i18n:** Static bundles, no runtime AI translation. RTL supported for AR and HE
via `dir` attribute on `<html>`.

---

## Backend (Supabase)

### Authentication

Supabase Auth with email/password. On signup, a `users` row is created in the
public schema with `auth_id = auth.uid()`. The `is_admin` boolean on `users`
is the single source of admin role — never derived from JWT claims.

Every Edge Function validates the Authorization header and checks `is_admin`
server-side before processing admin requests.

### Edge Functions

All Edge Functions are in `supabase/functions/`. Each is a self-contained Deno
module. They call external providers and write `cost_events` for COGS tracking.

| Function | Purpose |
|---|---|
| `import-property` | URL extraction pipeline with SSRF protection |
| `dataforseo-search` | SERP queries for source discovery |
| `social-collect` | Apify social collection trigger |
| `classify-signals` | OpenAI intent classification |
| `run-matching` | Property × IntentProfile matching engine |
| `atomic-unlock` | Credit deduction + unlock in one transaction |
| `credits-topup` | Stripe checkout session creation |
| `payment-webhook` | Stripe webhook → idempotent credit grant |
| `provider-health-check` | Admin: test provider and update health table |
| `spend-cap-check` | Check monthly caps before paid call |

### Row Level Security

Every table has RLS enabled. The general pattern:
- Users can only SELECT/INSERT/UPDATE their own rows (`user_id = auth.uid()` via `users` join)
- Admin tables (`admin_settings`, `provider_health`, `cost_events` SELECT) require `is_admin = true`
- Audit tables (`credit_ledger`, `match_unlocks`, `payments`, `cost_events`) are INSERT-only via service role, SELECT for owner + admin

---

## Database

See `docs/DATABASE.md` for full schema.

PostgreSQL 15+ (Supabase). All migrations in `supabase/migrations/` — numbered
sequentially, idempotent (using `IF NOT EXISTS`, `ON CONFLICT DO NOTHING`).

---

## Importer Pipeline

URL import follows this fallback chain (no circular fallback):

```
1. Direct fetch + JSON-LD extraction
   ↓ (if fails or JS required)
2. ZenRows (if ZENROWS_API_KEY set)
   ↓ (if fails)
3. ScrapingBee (if SCRAPINGBEE_API_KEY set)
   ↓ (if all fail)
ERROR — report to user, log to property_imports
```

**SSRF protection:** `isPublicUrl()` blocks localhost, private IPs (10.x, 172.16-31.x, 192.168.x),
cloud metadata endpoints (169.254.169.254), and non-HTTP/S protocols. Applied before
any outbound request.

Each step logs a `cost_event` with provider, operation, cost, and success flag.

---

## AI Orchestration

Signal classification pipeline:

```
raw_signals (PENDING)
   ↓ cheap pre-filter (length, language rule)
   ↓ OpenAI GPT-4o-mini classification
   ↓ parse JSON response → IntentProfile
   ↓ reject: SELLER / AGENT_AD / SPAM / NOISE / UNKNOWN
   ↓ accept: BUY / RENT / INVEST / RELOCATE_*
intent_profiles (created)
```

Deduplication: canonical URL + external ID + content fingerprint (SHA-256 of first 200 chars).
Cache: same signal not re-classified if fingerprint matches existing `raw_signals` row.

---

## MatchingEngine

Located in `run-matching` Edge Function and `_shared/jobs.ts`.

**Scoring (0–100):**
- Hard knockout: country mismatch → score 0
- Hard knockout: transaction type mismatch → score 0
- City match: +25 points
- Property type match: +15 points
- Bedroom match: +10 points
- Budget fit: +20 points
- Intent confidence: up to +30 points

**Signal strength tiers:** POTENTIAL (30–44) → GOOD (45–59) → STRONG (60–74) →
VERY_STRONG (75–89) → EXCEPTIONAL (90–100)

---

## PricingEngine

Base prices per strength tier × multipliers:

| Tier | Base |
|---|---|
| POTENTIAL | $0.50 |
| GOOD | $1.00 |
| STRONG | $2.00 |
| VERY_STRONG | $3.50 |
| EXCEPTIONAL | $5.00 |

Multipliers: recency (1.3×), source quality (1.2×), COGS (1.15×)

All values configurable via Admin → Pricing Config (stored in `admin_settings`).
Server always calculates price. No qualified match is ever free. Min/max bounds enforced.

---

## Credits and Ledger

- `credit_accounts` — server-authoritative balance per user
- `credit_ledger` — immutable append-only ledger: TOP_UP, MATCH_UNLOCK, REFUND, ADMIN_ADJUSTMENT
- Credits are separate from COGS — `credit_ledger` tracks revenue, `cost_events` tracks COGS

**Atomic unlock** (in `atomic-unlock` Edge Function):
1. Verify session
2. Verify property ownership
3. Verify match not already unlocked
4. Calculate price from PricingEngine
5. Check sufficient credits
6. Debit + create `match_unlocks` + create `credit_ledger` entry — all in one transaction

---

## Admin Section

All admin routes (`/admin/*`) are protected by `AdminLayout` (client-side redirect)
and by `is_admin` check in every Edge Function called from admin pages.

**Admin metrics** are computed from live database queries — no pre-aggregated materialized views.
For high scale, materialized views can be added without changing the API contract.

---

## Payment Flow

```
User → CreditsPage → initiateTopUp() → credits-topup Edge Function
       → Stripe Checkout Session → user pays
       → Stripe webhook → payment-webhook Edge Function
       → verify signature → idempotency check → grant credits
       → credit_accounts.balance += amount
       → credit_ledger INSERT (TOP_UP)
       → payments INSERT (COMPLETED)
       → notification INSERT (CREDITS_TOPPED_UP)
```

PaymentProvider is fully independent from Ledger, Pricing, and Unlock logic.
Switching providers requires only `credits-topup` and `payment-webhook` changes.

---

## Spend Cap Enforcement

Before every paid provider call (in jobs and Edge Functions):

1. Query `cost_events` for current month spend by provider
2. Query `admin_settings` for caps
3. If provider spend ≥ cap OR global spend ≥ global cap → skip call, log warning
4. No retry of blocked calls in same job run

Cap status visible in Admin → Spend Caps with live progress bars.

---

## Storage

Private property photos: Supabase Storage bucket `property-photos` with RLS.
Storage abstraction: `STORAGE_PROVIDER` env var. Migrate to S3-compatible storage
by updating storage client calls (documented in `MIGRATION.md`).

---

## Zero Vendor Lock-in

- All critical logic is in `src/` and `supabase/functions/` — exportable source
- Jobs in `_shared/jobs.ts` run on any Deno runtime
- Worker in `worker/scheduler.ts` is a standalone Deno process
- Database is standard PostgreSQL with migrations
- `Dockerfile` + `docker-compose.yml` enable deployment on any Linux host
- Auth, payment, storage, email — all have documented replacement paths (see `MIGRATION.md`)
