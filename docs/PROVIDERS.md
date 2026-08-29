# Homatch — Provider Reference

Each provider has a defined status lifecycle:
`NOT_CONFIGURED` → `CONFIGURED_UNVERIFIED` → `REAL_TEST_PASSED` / `ERROR`

Mock mode is active when credentials are absent. Mock providers are never
displayed as real in Admin → Provider Health.

---

## DataForSEO

**Purpose:** SERP queries to discover new real estate groups and communities
(Facebook, Telegram, VK) by market. One search serves all properties in a market
(QueryPack deduplication — never repeat identical searches).

**Credentials:**
```
DATAFORSEO_LOGIN=your@email.com
DATAFORSEO_PASSWORD=yourpassword
```

**Cost model:** ~$0.003 per SERP query (varies by task type and depth)

**Monthly cap:** `spend_cap_dataforseo` (default $40)

**Fallback:** MOCK — logs zero-cost event, no sources discovered

**When not configured:** `discoverMarketSources()` logs mock events and skips
real API calls. Source discovery does not run. Already-registered sources
continue to be collected via Apify if configured.

**Failure handling:** HTTP 4xx/5xx → log error, skip market for this job run,
retry on next scheduled run. No infinite retries.

**Admin test:** Admin → Provider Health → DataForSEO → Run Test (sends one live
SERP query to `api.dataforseo.com/v3/serp/google/organic/live/advanced`).

---

## Apify

**Purpose:** Collect posts/messages from registered Facebook Groups, Telegram
Groups/Supergroups, Instagram public profiles, VK communities.
Incremental collection — only new content since `last_collected_at`.

**Credentials:**
```
APIFY_API_TOKEN=apify_api_xxxxx
APIFY_FACEBOOK_ACTOR_ID=apify/facebook-posts-scraper  # or your custom actor
APIFY_TELEGRAM_ACTOR_ID=username/telegram-scraper
APIFY_INSTAGRAM_ACTOR_ID=apify/instagram-scraper
APIFY_VK_ACTOR_ID=username/vk-scraper
```

**Cost model:** ~$0.05 per actor run (256MB, 50 items). Varies by actor and run size.

**Monthly cap:** `spend_cap_apify` (default $100)

**Fallback:** MOCK — no signals collected, zero-cost event logged

**Important limitations:**
- **Telegram:** Actor must be given known group URLs; global search is not available
- **Facebook:** Public groups only; private groups require login bypass (not supported)
- **Instagram:** Public profiles and hashtags; private accounts return no data
- **VK:** Public communities only

**Failure handling:** Apify run failure → log cost event (success=false), skip source,
update source `last_collected_at` only on success.

**Admin test:** Admin → Provider Health → Apify → Run Test (calls `api.apify.com/v2/users/me`).

---

## ZenRows

**Purpose:** First extraction fallback after direct fetch fails. Handles
JavaScript-rendered pages and sites with bot protection.

**Credentials:**
```
ZENROWS_API_KEY=your_zenrows_key
```

**Cost model:** ~$0.001–0.002 per request (JS render costs more)

**Monthly cap:** `spend_cap_zenrows` (default $20)

**Fallback chain position:** Direct → **ZenRows** → ScrapingBee

**When not configured:** Step is skipped; ScrapingBee is tried next if configured.

**Failure handling:** HTTP error or timeout → log cost_event (success=false), proceed to
next fallback. No retry within same import request.

**Admin test:** Admin → Provider Health → ZenRows → Run Test
(calls `api.zenrows.com/v1/` with `httpbin.org/get`).

---

## ScrapingBee

**Purpose:** Second extraction fallback. Used when both direct fetch and ZenRows fail.

**Credentials:**
```
SCRAPINGBEE_API_KEY=your_scrapingbee_key
```

**Cost model:** ~$0.001 per request (JS render: ~$0.01)

**Monthly cap:** `spend_cap_scrapingbee` (default $5)

**Fallback chain position:** Direct → ZenRows → **ScrapingBee**

**When not configured:** Step is skipped; import fails with `RENDER_PROVIDER_UNAVAILABLE`.

**Failure handling:** Same as ZenRows. No circular fallback — ScrapingBee is the
last extraction option.

**Admin test:** Admin → Provider Health → ScrapingBee → Run Test
(calls `app.scrapingbee.com/api/v1/` with `httpbin.org/get`).

---

## BrightData

**Purpose:** Premium proxy/extraction alternative. Currently in provider registry
for future use; not wired into active fallback chain in this version.

**Credentials:**
```
BRIGHTDATA_API_KEY=your_brightdata_key
```

**Cost model:** Variable — proxy traffic-based

**Monthly cap:** `spend_cap_brightdata` (default $10)

**Current status:** Registered in `provider_health` for Admin visibility.
Integration can be added as a ZenRows/ScrapingBee peer fallback.

**Admin test:** Admin → Provider Health → BrightData → Run Test
(calls `api.brightdata.com/zones`).

---

## OpenAI

**Purpose:** GPT-4o-mini for intent classification of collected raw signals.
Extracts: intent_type, country, city, transaction, property_types, bedrooms,
budget, currency, confidence, language.

**Credentials:**
```
OPENAI_API_KEY=sk-proj-xxxxx
```

**Cost model:** GPT-4o-mini input $0.00015/1K tokens, output $0.0006/1K tokens.
~$0.0001–0.0003 per signal classification.

**Monthly cap:** `spend_cap_openai` (default $15)

**Fallback:** MOCK — signals stay in PENDING status, no intent profiles created

**Pipeline:** Cheap pre-filter first (length, language rule) → AI only for
candidates that pass. Deduplication by fingerprint prevents re-classification.

**Rejected intent types:** SELLER, AGENT_AD, PROPERTY_AD, SPAM, NOISE, UNKNOWN —
these never create IntentProfiles or Matches.

**Failure handling:** OpenAI error → signal stays PENDING, retry on next job run.
Bounded to 3 attempts total (exponential backoff in `withRetry()`).

**Admin test:** Admin → Provider Health → OpenAI → Run Test
(calls `api.openai.com/v1/models`).

---

## Stripe (Payment Provider)

**Purpose:** Credit top-up payments via Checkout Sessions. Webhook delivers
idempotent exactly-once credit grants.

**Credentials:**
```
PAYMENT_PROVIDER_SECRET=sk_live_xxxxx  # or sk_test_ for testing
PAYMENT_WEBHOOK_SECRET=whsec_xxxxx
```

**Cost model:** Stripe fees (~2.9% + $0.30 per transaction) — not tracked as
Homatch COGS (customer-facing payment processing fee, separate accounting).

**Webhook events listened to:**
- `checkout.session.completed`
- `payment_intent.succeeded`

**Idempotency:** `payments.idempotency_key` has a UNIQUE constraint.
Stripe `session.id` is used as the idempotency key — duplicate webhook deliveries
are silently ignored.

**Fallback:** MOCK — returns a fake session ID, credits granted immediately in
dev/testing mode when `MOCK_DATA_PROVIDERS=true`

**Admin test:** Admin → Provider Health → Stripe → Run Test
(calls `api.stripe.com/v1/balance`).

---

## Resend (Email Provider)

**Purpose:** Transactional email notifications (new match, low credits, etc.).
Currently wired but email dispatch is not triggered in this version — in-app
notifications are used instead.

**Credentials:**
```
RESEND_API_KEY=re_xxxxx
EMAIL_FROM=noreply@your-domain.com
```

**Cost model:** Resend free tier: 3,000 emails/month. Paid plans from $20/mo.

**Monthly cap:** Not tracked via `cost_events` in this version (email costs minimal).

**Fallback:** Silent skip — in-app notifications still fire even if email is not configured.

**Admin test:** Admin → Provider Health → Resend → Run Test
(calls `api.resend.com/emails` with GET — validates API key).

---

## Provider Status Reference

| Status | Meaning |
|---|---|
| `NOT_CONFIGURED` | No credentials set. Mock mode active. |
| `MOCK` | Running in mock mode (dev environment or missing credentials). |
| `CONFIGURED_UNVERIFIED` | Credentials present but Run Test not yet executed. |
| `REAL_TEST_PASSED` | Run Test succeeded against live API. |
| `ERROR` | Last test or live call failed. Check `last_error` in provider_health. |

**Rule:** Admin UI never displays MOCK or NOT_CONFIGURED providers as healthy or real.
A provider showing REAL_TEST_PASSED has passed a live API call within the last test run.
