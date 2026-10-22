# Finance V2.1 — cost coverage matrix (2026-10-22)

Every active cost-producing call site, what it recorded before V2.1 and what it records
after. "Recorder" = `_shared/providerCost.ts` `recordUsageCost` → `cost_events`
(`finance_service`, model, units, tokens, `pricing_state`, `idempotency_key`), priced by
`provider_estimated_cost_usd` (provider_price_book). States: ACTUAL (provider-reported
dollars), ESTIMATED (reported units × book rate), PARTIAL (some units unpriced — a floor),
UNPRICED (no rate or no usage; `cost_usd` NULL in `finance_v2_cost_lines`), never a silent $0.

Sources that cannot be priced honestly from inside HOMATCH are rows of
`finance_cost_coverage`; any service with such a row reads `costComplete = false` in
Admin → Finance → Services and its profit is labelled "not final".

## AI / model calls

| Call site | Service | Before | After |
|---|---|---|---|
| find-property-plan | find_property | none | OPENAI tokens, ESTIMATED |
| generate-search-profile | find_property | none | OPENAI tokens, ESTIMATED |
| deal-room-ai | deal_room | none | OPENAI tokens (service-role writer) |
| investment-consultant | investment_consultant | none | OPENAI tokens |
| social-post-generate | social_posts | none | GEMINI tokens; UNPRICED until the book has gemini-2.0-flash (coverage row) |
| meta-ads-api copy AI | meta_ads | none | OPENAI tokens |
| comm-agent (generate / transcribe / turn / Cartesia TTS) | communications | none | OPENAI tokens, CARTESIA characters |
| developer-floorplan-extract | developer_tools | env-var rates, 0 when unset | book rates via priceUsage; state kept in `dt_pipeline_costs.units` |
| developer-document-extract | developer_tools | none in cost_events | cost_events row; customer charge unchanged |
| classify-signals-v2 | shared_platform | hard-coded rates | book rates, one row per chunk |
| classify-signals v1 / `_shared/providers.ts` | shared_platform | assumed 200 tokens | real usage or UNPRICED |
| Design Studio image models | design_studio | PRICE_TABLE only | book rows equal to PRICE_TABLE (drift-tested) |
| Find Buyers OpenAI | find_buyers | admin_settings copy | unchanged; drift vs book via `finance_v2_price_drift()` |

## Voice, messaging, scraping, GPU

| Call site | Service | Before | After |
|---|---|---|---|
| ai-talk-session speak (TTS) | ai_talk | none | characters, deferred (`waitUntil`, no added latency) |
| ai-talk-session non-converse AI actions | ai_talk | none | OPENAI tokens, deferred |
| ai-talk-session realtime listen | ai_talk | none | UNSUPPORTED — no usage available (coverage row) |
| voice-ai | communications | none | ELEVENLABS characters |
| whatsapp-send / comm-dispatch-worker | communications | none | META MESSAGE rows; UNPRICED until a rate is booked (coverage row) |
| retell-webhook | communications | retail price booked as COGS | once per call (idempotency key), UNPRICED source (coverage row) |
| outreach-send | communications | silent 0 fallbacks | book rate or UNPRICED |
| import-property (ZenRows / ScrapingBee) | property_import | none | CREDIT rows; UNPRICED source (coverage row) |
| RunPod reconstruct / renders | design_studio | cold start labelled "measured" | ESTIMATED; PARTIAL when the job reports queue/cold-start delay; rate UNPRICED_SOURCE (coverage rows) |
| Verify captcha | verify | none | UNPRICED_SOURCE (coverage row) |

## Shared infrastructure

`finance_v2_shared_costs(from, to)`: price-book MONTH rows (e.g. Railway) prorated by
days / 30.4375 as ESTIMATED; `finance_fixed_expenses` rows with no amount are
NOT_CONFIGURED (null, never $0); `complete = false` while any is unconfigured. It is shown
beside services in Admin, never inside a service's profit.

## Not changed (documented)

- `billing_ai_cost_cents` coalesces unpriced AI to 0 in cost-based charging — changing it
  changes customer prices.
- `provider_spend_totals` (spend caps) sums the 0 placeholder of UNPRICED rows.
- Settled history is not rewritten; no backfill (no reliable usage evidence for past calls).
