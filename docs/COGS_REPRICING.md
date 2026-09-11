# Pricing usage that was measured before there were prices

`provider_price_book` is empty, so every verification so far is recorded
`UNPRICED`. That is the correct state — inventing supplier rates would produce a
COGS figure that looks authoritative and is fiction — and it is deliberately not
allowed to block work on tokens and searches, which are measurable without it.

This note records why the measurements already taken will still be priceable
when real rates arrive, and what to run.

## Nothing is lost while the book is empty

Three things have to survive for a past job to be priced later. All three do.

**The usage itself.** `research_jobs.result_json.costUsage` holds, per stage,
`input_tokens`, `output_tokens`, `total_tokens`,
`input_tokens_details.cached_tokens` and `output_tokens_details.reasoning_tokens`.
That is the full breakdown a rate card needs, not just a total — cached input is
billed differently from fresh input, and reasoning tokens are billed differently
again where a provider prices them separately.

**The searches.** `result_json.webSearchCalls` holds the per-stage count, and
`cost_events.source` repeats it as `searches=N`. Web search is billed per call,
so a token-only record would miss a real line item.

**Which model did which stage.** The four research stages and the report are run
on different models, and `cost_events.source` records `model=<id>` per row. The
two are not interchangeable and pricing them as one would misattribute whichever
half turns out to be expensive.

## Why a later price is the right price

`provider_price_book` is effective-dated (`effective_from` / `effective_to`, as a
half-open range), and `recordVerificationCost` resolves rates `at`
`job.completed_at` rather than at the time it runs. So repricing a job from
September prices it at September's rate even if it is repriced in March, and a
rate entered today does not silently rewrite last month's numbers.

`totalVerificationCost` returns a state of `PRICED`, `PARTIALLY_PRICED` or
`UNPRICED`, and `cost_events.source` names every unit that had no rate
(`unpriced=INPUT_TOKEN+CACHED_INPUT_TOKEN+…`). A gap is therefore visible and
actionable rather than appearing as a zero that reads like "free".

## What to run once rates exist

1. Insert the real rates into `provider_price_book`, dated from when they
   actually applied — not from today — for every `(provider, model, unit)` in
   use. `docs/COGS_PRICING.md` lists the seven units.

2. Reprice. `recordVerificationCost` deliberately refuses to write twice for one
   job (there is a partial unique index enforcing it), so repricing is an
   explicit act, not an accident:

   ```sql
   -- The rows to be replaced. Inspect before deleting.
   select job_id, operation_type, units, cost_usd, source
   from cost_events
   where operation_type like 'VERIFY\_%'
     and cost_usd = 0
     and source like '%unpriced=%'
   order by timestamp;
   ```

   Delete exactly those rows and re-run the costing for the affected jobs. The
   usage they were computed from is still on the job, so nothing is
   reconstructed or estimated.

3. Check the result reads `PRICED` and not `PARTIALLY_PRICED`. The latter means
   a unit in use still has no rate, and the `source` column names it.

## What is deliberately not automated

There is no job that watches for rates appearing and reprices behind you.
Repricing rewrites a financial record, and it should happen because somebody
decided to do it, with the rates they entered, at a moment they chose. The
mechanism is ready; the trigger is a person.
