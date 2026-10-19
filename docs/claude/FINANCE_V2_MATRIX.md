# FINANCE V2 — live service pricing matrix (evidence, 2026-10-19)

Read-only audit of production (`ptxajsjhobhvsfhmutjn`) and `main` at 6c61fecb. Every
row cites its source of truth. Nothing here changes a price; see BILLING.md for rules.
10 credits = $1 (`admin_settings.credits_per_usd`). `vat_rate_bps` = 1800.

## Services

| Service | Product code | Live? | Customer price (source) | Kind | 37/63 | Profit floor | VAT today | Wallet path |
|---|---|---|---|---|---|---|---|---|
| Verify | `VERIFY` | ON (`verify_billing_enabled`=true) | cost-based: net = max((landed+10%)/0.45, landed+$1 on COMPLETE); gross = net×1.18; 25 cr start, +25 per approval, max 4 / 100 cr (`billable_products.VERIFY.config.verify_budget`, `verify_price_for_cost`) | variable | no | **$1 net, COMPLETED reports only** | 18% added once on net (= inclusive in quoted gross) | reserve → cumulative settle → release (`verify_billing_*`) |
| Find Buyers / Tenants | `FIND_CLIENTS` | ON | customer budget ≥ `find_buyers_min_usd` $10 = 100 cr; charge = provider spend ÷ 0.63, cap = reservation (`paidDiscoveryPolicy.ts`, `campaignRun.ts`) | variable (budget) | yes, **of gross** (`paid_discovery_37_63_v1`) | none | none (split on gross) | reserve → `settleExecution(priceCredits)` → release; per-run `find_buyers_reserve_actor_run` |
| Find Property search | (none) | ON | free | free | — | — | — | none (COGS only) |
| Find Property paid social / Deep Search | `FIND_PROPERTY` | **OFF** (`find_property_deep` service off, `find_property_social_enabled`=false) | ≥ 50 cr ($5); ÷0.63 | variable | yes, of gross | none | none | reserve → `settlePaidSocialRun` |
| HOMATCH Leads unlock | `INTERNAL_LEAD_STANDARD` / `_PREMIUM` | ON | **$0.30 / $1.00** = 3 / 10 cr (`billable_products.standard_retail_cents`, `internal_leads_unlock`) | fixed | no | none | none | reserve+settle in one tx |
| External match unlock | (matches) | ON | `matches.unlock_price_credits`, written by run-matching-v2 from `pricing_*` settings (5–50 cr bases, 1–100 cr) | fixed per match | no | none | none | direct debit `credit_ledger` MATCH_UNLOCK |
| Contract Intelligence | `CONTRACT_INTELLIGENCE` | ON | cost-based `billing_price_quote` (ref 80¢ / COGS 18.88¢, 55% floor) | variable | no | 55% gross-margin floor | none (COGS +18% `billing_cogs_tax_bps`) | reserve → settle on measured AI cost |
| AI Chat | `AI_CHAT_RESPONSE` | ON (`ai_chat_billing_enabled`=true) | cost-based `billing_price_quote` (ref 13.47¢), anon free | variable | no | 55% margin floor | none | reserve → settle on measured AI cost |
| Meta Ads AI image | `META_AD_IMAGE_GEN` | ON | cost-based quote × variations (ref 13¢) | variable | no | 55% margin floor | none | reserve → settle |
| Meta Ads service fee | (USD wallet `meta_ads_ledger`) | ON | 9% of media (`meta_ads_fee_percent`); media on customer ad account | % fee | no | none | none | USD ledger, pro-rata refund |
| Broker directory listing | `BROKER_DIRECTORY_LISTING` | service OFF (`brokers_directory`) | $29 / 30 days = 290 cr | fixed | no | none | none | direct debit |
| Broker discovery | `BROKER_DISCOVERY` | ON (supply-discovery) | $0.20 per new broker = 2 cr | fixed | no | none | none | direct debit |
| Design Studio | `DS_*` | billing OFF (`design_studio_billing_enabled`=false); service paused | free today (renders priced est/0.45 if switched on) | free | no | (55% if on) | none | metered, unbilled |
| AI Talk | `AI_TALK` | service paused; free allowance | free | free | — | — | — | `voice_usage_events` |
| Research products | `research_products` | legacy (last purchase 2026-09-16) | price_cents VAT-inclusive | fixed | no | none | inclusive | legacy reserve/capture |
| Email Studio / Publishing | — | free / paused | free | free | — | — | — | none |
| AI Call / WhatsApp / Broker Finder / Email campaign | — | disabled | — | — | — | — | — | — |

Wallet top-ups: `payments.vat_rate_bps` = 0 (deposit, no VAT). Legacy `pricing_versions` v1 and plan
settings are dormant reference data, not prices.

## Conflicts and defects found

1. **Paid discovery splits gross, not VAT-exclusive revenue** (owner rule V2 requires VAT first).
   Formula sites: `paidDiscoveryPolicy.ts` (6300 bps, ÷0.63), SQL `paid_discovery_provider_share_bps`,
   `find_buyers_extend_budget`, `find_property_customer_micros` live figure, `settlePaidSocialRun`.
2. **Shared $0 "ESTIMATED" bug**: `estimatedProviderCost` turns a missing price (SQL null) into
   `Number(null)` = 0. Every Find Property search AI call (gpt-4o-mini, no price row) is recorded as
   a $0 estimate; same path in Meta Ads, Email Studio, property chat.
3. **`billing_ai_cost_cents` coalesces missing rates to 0** (production-only function, not in repo).
   AI Chat, Contract Intelligence, research and Design Studio record a silent 0 for an unpriced model.
4. **Meta image generation**: a missing rate becomes $0 labelled ACTUAL.
5. **Find Buyers charge** sums `cost_events` by property and time, not by campaign; translation AI
   cost consumes the provider budget but is never charged.
6. **COGS +18% uplift** (`billing_cogs_tax_bps`) is added to non-Verify COGS as if input VAT were
   non-recoverable — a business assumption, not measured.
7. **Find Buyers minimum** is still $10 / 100 cr (the 50-credit change is not in code).
8. **Match unlock units**: old-unit price writers remain (`run-matching`, `_shared/jobs.ts`, v2
   fallbacks, `src/services/api.ts`); production holds mixed prices (1, 1.6, 5, 26, 35 cr).
9. **Uncosted AI calls**: find-property-plan, generate-search-profile, deal-room-ai,
   investment-consultant, developer-floorplan-extract, social-post-generate (Gemini), ZenRows import.
10. **Six price registries** (provider_price_book, finance_provider_prices, find_buyers_openai_price_book,
    Design Studio PRICE_TABLE/env, RUNPOD/CAPTCHA env, outreach settings).
11. `finance_cost_facts` ignores `pricing_state` and excludes `usage_events` / `voice_usage_events`.
12. Verify (minor): translation AI cost excluded from billing; FALLBACK not flagged for review;
    BILLING.md said max budget 25 (it is 100).
13. **VAT jurisdiction is unknowable today**: `users` has no country / business fields; Verify applies
    18% to every customer.
