# Buyer intelligence audit (2026-10-09)

Where buyer/tenant intent is generated, persisted, tied to an authenticated
HOMATCH account, and whether it reaches internal matching. Code-backed; counts
are read-only production reads on 2026-10-09 (project `ptxajsjhobhvsfhmutjn`).

## Summary table

| Subsystem | Status | Evidence |
|---|---|---|
| Find Property — confirmed plan (legacy confirm path) | Fully implemented & connected | `supabase/functions/find-property-plan/index.ts:255` writes `intent_profiles` (`search-plan-1.0.0`, `src/research-core/discovery/search-plan.ts:502`) and `:271` an `active_search_subscriptions` row (side `SUPPLY` = watching listings, owner = `user_id`). Read by `supply-matching`. Prod: 0 such rows. |
| Find Property — marketplace search (current flow) | Partially connected | `_shared/marketplaceSearch.ts:212,285` persists `discovery_marketplace_searches` (`user_id`, structured `request`, `brief`). Not projected to `intent_profiles`, so it never reaches internal matching (`supply-matching`). Prod: 13 searches, 1 user. Now read by buyer intelligence (request only). |
| Internal matching + scores | Defective → fixed in this branch | `src/research-core/match/compatibility.ts:589` (`assessMatch`), `:749` (`rankDemandForSupply`); `supply-matching/index.ts` → `upsert_native_match` (`20260928010000_native_intent_pipeline.sql:180`), owner read `my_native_matches` (`:498`, `src/services/nativeMatches.ts:46`). Cron `homatch-supply-matching` returned HTTP 500 `{"error":"[object Object]"}` every 15 min: the PostgREST embed `active_search_subscriptions!intent_id` has no FK (`20260911140000_phase3_schema.sql:183`), so PGRST200; last `supply_matches` write 2026-09-27. Fixed (explicit second read + error naming), commit `f64c4776`. |
| Native demand projection (chat → intent) | Defective → fixed | `_shared/nativeDemand.ts` `projectActor` used the same FK-less embed with the error ignored, so existing demand was never recognised (duplicates on every statement). Fixed, commit `78c26937`. |
| AI Chat / AI TALK | Partially connected | `ingest-live-chat/index.ts:313,341` reads `ai_messages` (role user) as surface `AI_CHAT` → `recordDemandFrom` (self-attributed only) → `intent_signals` → `projectActor`. Cron `homatch-native-intent` every minute, 1288×200 in 24 h; 112 ai_messages, 0 `intent_signals` (nothing self-stated qualified). AI TALK voice (`official-worker`, `ai-talk-session`) does not record intent. |
| Messaging | Fully implemented & connected | `send-message/index.ts:170,179,189` records own-words requirements and property interest; canonical `conversations`. Prod: 0 conversations. |
| Viewing requests | Fully implemented & connected | `viewing-request/index.ts:16` writes `viewing_requests` + `intent_signals` (`VIEWING_REQUEST`, `TRANSACTION_INTENT`) + `projectPropertyInterest`. Prod: 0. |
| Mortgage | Implemented, intentionally NOT an intent source | `mortgage_scenarios` (`20260907120000_mortgage_feature_v1.sql:110`, `src/services/mortgageApi.ts:144`). Financial data; never used to infer budget or wealth. |
| Investment services | Implemented, not an intent source | `investment-consultant`, `investment-research` write no requirement/intent rows. |
| Property profiles / facts | Fully implemented | `property_facts` (price, area, ppsqm, city/district/neighbourhood/address). Prod: 1 row. `market_snapshots` (`20260912100000_market_snapshots.sql`) holds Verify aggregates only (median/band, no raw comparables) — not usable for percentiles. |
| Market comparables | Partially connected | `discovery_marketplace_listings` (528 rows / 404 distinct listings, all SALE APARTMENT USD Tbilisi, 3 districts). Now the main comparable pool for segmentation. |
| User profiles & preferences | Missing (as buyer preferences) | `users`, `user_preferences` (language only), `search_profiles` (owner's per-property profile for finding buyers — supply side, not a buyer requirement). |
| Saved searches / favourites / search history | Partially | Saved = `active_search_subscriptions`; history = `discovery_marketplace_searches`; no favourites table; `live_chat_saved` is message bookmarks (not intent). |
| Intent extraction / classification | Fully implemented (external) | `classify-signals-v2/index.ts:189,229` writes `intent_profiles` from `raw_signals` WITHOUT a subscription — external people, never HOMATCH users. Cron every 5 min. 130 such rows. |
| Credits / wallet / unlock | Fully implemented | PAYG reserve/settle (`reserve_credits_for_product`, `20260911193543_credit_redenomination_1cr_10c.sql:187`), `atomic-unlock`. Not an intent source. |
| Admin analytics | Partially → extended | `admin_intent_signals`, `admin_supply_matches` (`20260928210000_…sql:75,256`), `/admin/intelligence`, `/admin/supply-matches`. No per-person buyer summary or segmentation existed; added `/admin/buyer-intelligence`, `/admin/market-segmentation`. |

## Intent signal trace

| Signal | Generated | Persisted | Linked to account | Feeds internal matching |
|---|---|---|---|---|
| Confirmed Find Property plan | find-property-plan | intent_profiles + subscription | subscription.user_id | Yes (supply-matching) |
| Marketplace search | marketplace-search | discovery_marketplace_searches | user_id | **No** (gap, Find Property flow — not changed here) |
| Own-words requirement (chat/AI/DM) | ingest-live-chat, send-message | intent_signals → intent_profiles + subscription | actor_user_id | Yes, after the `projectActor` fix |
| Viewing / enquiry | viewing-request, send-message | intent_signals (PROPERTY_INTEREST) | actor_user_id | Property relationship only |
| External post | classify-signals-v2 | intent_profiles (no subscription) | none (by design) | External matches only |

## What buyer intelligence reads

`20261024110000_buyer_intelligence.sql`: subscribed `intent_profiles`
(FIND_PROPERTY_PLAN / STATED_IN_CONVERSATION / SAVED_SEARCH /
BROKER_CLIENT_SEARCH), marketplace `request` (FIND_PROPERTY_MARKETPLACE),
`intent_signals` PROPERTY_INTEREST (VIEWING_REQUEST / PROPERTY_ENQUIRY).
Never: chat text, `original_text`, `brief.originalText`, mortgage tables,
raw_signals, external intent rows, find_buyers_leads people (counted only).
CASUAL_BROWSING has no source — telemetry is not intent.

## Open items

- Marketplace searches are not projected into `intent_profiles`; internal
  matching cannot see them (Find Property workstream).
- `find_buyers_leads.match_category` (20261024090000) is not in this tree or
  production; the stats report it as unavailable until it lands.
- The supply-matching fix needs an edge deploy (`supply-matching`, and the
  `_shared/nativeDemand.ts` closure) before the cron stops failing.
