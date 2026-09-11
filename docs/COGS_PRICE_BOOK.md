# The rates Verify is priced at, and where they came from

`provider_price_book` was empty, so every verification read `UNPRICED`. These
are the real rates, with their sources, so the numbers can be audited rather
than trusted.

## What Verify actually meters

Checked against `cost_events` rather than assumed: Verify touches **OpenAI and
nothing else**. `DATAFORSEO` and `APIFY` rows belong to the discovery product
and have not run since 2026-08-29. The four research stages run on
`gpt-5.6-terra`; the report runs on `gpt-5.6-luna` in `verify-synthesis`.

Deliberately **not** in the price book:

- **The official-source worker.** It is local Playwright Chromium
  (`official-worker`, `browserRuntime: 'local-playwright-chromium'`) on a
  Railway service. Real money, but a fixed subscription shared by every job,
  so charging a slice of it per Verify would be an allocation, not a
  measurement. It belongs in a gross-margin model.
- **Browserbase.** Not used. The worker drives its own Chromium.
- **A `REASONING_TOKEN` rate.** OpenAI folds reasoning into `output_tokens`.
  Pricing it separately would double-charge every run, so the absence of a
  rate here is correct and `cogs.ts` treats "no rate" as "included in output",
  not as "free".

## The rates

All USD, effective from **2026-07-30** (GPT-5.6 launch pricing).
Source: `developers.openai.com/api/docs/pricing`, retrieved 2026-09-11.

| provider | model | unit | rate | per |
|---|---|---|---|---|
| OPENAI | gpt-5.6-terra | INPUT_TOKEN | $2.00 | 1,000,000 |
| OPENAI | gpt-5.6-terra | CACHED_INPUT_TOKEN | $0.20 | 1,000,000 |
| OPENAI | gpt-5.6-terra | OUTPUT_TOKEN | $12.00 | 1,000,000 |
| OPENAI | gpt-5.6-luna | INPUT_TOKEN | $0.20 | 1,000,000 |
| OPENAI | gpt-5.6-luna | CACHED_INPUT_TOKEN | $0.02 | 1,000,000 |
| OPENAI | gpt-5.6-luna | OUTPUT_TOKEN | $1.20 | 1,000,000 |
| OPENAI | *(any)* | WEB_SEARCH_CALL | $10.00 | 1,000 |

The web-search row is provider-wide because both models are reasoning models
and take the same `$10.00 / 1k calls` rate; an exact-model row would override
it if that ever stops being true. The pricing page states no effective date
for the tool, so 2026-07-30 was adopted to match the model price list, which
covers every measured run. That assumption is recorded in the row's `notes`.

## Three double-count traps, all guarded

1. **Cached input is a subset of `input_tokens`**, not an extra bucket. It is
   subtracted from billed input and charged at the cached rate. Pricing both
   at full rate would overstate every reused prompt — and would make the reuse
   work look like it had achieved nothing.
2. **Reasoning tokens are inside `output_tokens`.** See above.
3. **Web-search content tokens are billed at model rates and already appear
   inside `usage.input_tokens`.** OpenAI bills roughly 8,000 input tokens per
   search on top of the call fee, and those arrive in the usage we already
   record. So the `$10/1k` call fee is the *only* additional charge, and the
   tokens are priced where they land.

Trap 3 has a consequence worth stating plainly, because it changes where the
money is: **a market web search costs about $0.04 all-in**, not $0.01. Measured
across thirteen production market stages, implied non-search tokens held at
20,717–31,600 regardless of search count, while total cost tracked search count
almost linearly — $0.198 at four searches, $0.396 at nine.

## Reading a cost back

`verify_stage_cogs` and `verify_job_cogs` price a job from the usage stored on
it, at the rates in force at `completed_at`. They are views: they recompute
rather than rewrite, so a job read in March still prices at September's rate,
and `cost_events.cost_usd` — the financial record — is never touched by
reading.

`total_cogs_cents` on `verify_job_cogs` is the figure the pricing and wallet
work consumes. It is **cost**, never a price: no margin, no VAT, no allocated
infrastructure.

## Changing a rate

Never edit a row. Close it (`effective_to`) and insert the new one, so history
stays priceable at what it actually cost. The exclusion constraint
`provider_price_book_no_overlap` enforces that two rates for the same
(provider, model, unit) cannot both be in force.

Repricing existing `cost_events` rows is a separate, explicit operation —
see `docs/COGS_REPRICING.md`. It is not automated, because it rewrites a
financial record.
