# What Verify gives the pricing and wallet work

A separate workstream owns plans, credits, reservations, entitlements and
customer pricing. This is the contract between it and Verify.

**Verify reports cost. Pricing decides price.** Nothing in here is a price, a
margin, a VAT figure, a plan or an entitlement, and Verify does not read any of
those. The two sides can change independently.

## The interface

`public.verify_billing_events` — one row per completed verification.
Service-role read only.

| field | meaning |
|---|---|
| `job_id` | the verification |
| `product_type` | always `VERIFY` |
| `quality_tier` | **null today.** See below. |
| `user_id`, `subject`, `completed_at`, `duration_seconds` | who, what, when, how long |
| `total_tokens`, `cached_input_tokens`, `web_searches` | what it consumed |
| `provider` | `OPENAI` — the only per-job metered provider Verify uses |
| `model_cost_usd`, `search_cost_usd` | split, because they behave differently |
| `provider_cogs_usd`, `provider_cogs_cents`, `cogs_currency` | **the number to consume** |
| `price_state` | `PRICED` or `PARTIALLY_PRICED` |
| `price_book_effective_from` | which rate version produced the figure |
| `reuse_graph_hit`, `reuse_facts_reused`, `reuse_facts_required`, `reuse_facts_on_subject`, `reuse_facts_on_lineage` | why it cost what it cost |
| `stage_breakdown` | per-stage tokens, searches, cost and model, as JSON |

`provider_cogs_cents` is the headline. Cents and USD, because that is what
`research_products` and the credit ledger already speak.

## Two things to know before using it

**`quality_tier` is null on purpose.** Verify does not emit a tier yet.
Returning a guessed one would have the pricing engine bill against a concept
this side does not implement. The column exists so it can be filled without a
schema change or a migration on the consumer.

**`provider_cogs_cents` excludes the official-source worker.** That worker is
local Playwright Chromium on a fixed Railway subscription — real money, but a
shared subscription rather than a per-unit meter, so charging a slice of it per
job would be an allocation, not a measurement. It belongs in a gross-margin
model alongside Supabase and hosting. `docs/COGS_PRICE_BOOK.md` records the
reasoning.

## What the numbers look like

Measured production runs, 2026-09-11:

| case | tokens | searches | COGS | reuse |
|---|---|---|---|---|
| cold, no graph | 203,585 | 15 | **63¢** | `reuse_graph_hit: false` |
| warm repeat | 171,425 | 9 | **52¢** | 15/25 facts, 3 on subject |
| second flat in a known building | 186,437 | 12 | **54¢** | 11/23 facts, **0 on subject**, 10 on lineage |
| warm + bounded market | 156,524 | 9 | **45¢** | 15/25 facts |

The second-flat row is the one worth understanding: `reuse_facts_on_subject: 0`
means nothing is known about that exact apartment, while
`reuse_facts_on_lineage: 10` means a great deal is known about the building it
is in. That is a genuinely cheaper unit of work, not a discount.

## Reading it

```sql
select provider_cogs_cents, price_state, reuse_graph_hit, stage_breakdown
from verify_billing_events
where job_id = $1;
```

`price_state = 'PARTIALLY_PRICED'` means a unit that was consumed had no rate
in force. Treat the figure as a floor and look at `stage_breakdown`; do not
treat it as complete.

## Where cost comes from, if you need to explain it

Roughly 45% of a Verify is the market stage, and most of that is web search.
OpenAI bills search-content tokens at model rates on top of the $10/1k call
fee — about 8,000 tokens a search — so one market search costs about **$0.04**,
not $0.01. Search count, not prompt size, is what moves a Verify's cost.

The registry stage (`official_collection`) is deliberately never throttled. It
is the evidence a buyer is actually exposed to, and it stays at full effort
whatever the graph holds.
