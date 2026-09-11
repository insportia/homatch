# Pricing what Verify costs us

Verify records what it consumes. It does **not** know what any of it costs
until somebody tells it, and it will not guess.

Right now every cost row is written with the real token and search counts and
`cost_usd = 0`, marked `unpriced`. That is the designed state, not a bug: a
COGS figure invented from a plausible-looking rate is worse than a visible gap,
because the gap gets fixed and the guess gets quoted in a board deck.

This page is how to finish it.

## What is already recorded

Every completed verification writes one `cost_events` row per stage, linked to
`research_jobs.id`:

| column | meaning |
|---|---|
| `operation_type` | `VERIFY_IDENTITY`, `VERIFY_OFFICIAL_COLLECTION`, `VERIFY_PUBLIC_RESEARCH`, `VERIFY_MARKET`, `VERIFY_SYNTHESIS` |
| `units` | total tokens for that stage |
| `cache_hit` | true when part of the prompt came back from the provider's cache |
| `source` | `model=<name>`, plus `unpriced=<units>` and `searches=<n>` when they apply |
| `cost_usd` | dollars, or `0` while the rate is unknown |

Per-stage rather than per-job on purpose: *the public research is expensive and
the synthesis is not* is the finding that makes optimisation actionable, and a
single total hides it.

## Adding a rate

Rates live in `provider_price_book`, effective-dated. Correcting a price means
closing one row and opening another — never editing the past, because
re-pricing last month's jobs at this month's rate quietly rewrites history.

```sql
insert into provider_price_book
  (provider, model, unit, rate, per_units, currency, effective_from, source)
values
  -- Token prices are quoted per million.
  ('OPENAI', 'gpt-5.6-terra', 'INPUT_TOKEN',        1.25, 1000000, 'USD', now(), 'openai.com/pricing 2026-09-11'),
  ('OPENAI', 'gpt-5.6-terra', 'CACHED_INPUT_TOKEN', 0.125, 1000000, 'USD', now(), 'openai.com/pricing 2026-09-11'),
  ('OPENAI', 'gpt-5.6-terra', 'OUTPUT_TOKEN',      10.00, 1000000, 'USD', now(), 'openai.com/pricing 2026-09-11'),
  -- A per-request charge that does not vary by model: leave `model` null.
  ('OPENAI', null,            'WEB_SEARCH_CALL',    0.01,       1, 'USD', now(), 'openai.com/pricing 2026-09-11');
```

The models in use come from the edge function environment:
`OPENAI_RESEARCH_MODEL` for the four research stages and `OPENAI_MODEL` for the
report.

### The units

| unit | when to price it |
|---|---|
| `INPUT_TOKEN` | always |
| `CACHED_INPUT_TOKEN` | when the provider bills cached input at a lower rate. Omitting it is safe — cached input then bills at the full input rate, which is the conservative reading. |
| `OUTPUT_TOKEN` | always |
| `REASONING_TOKEN` | **only if billed separately.** Where a provider folds reasoning into output, leaving this unpriced is correct: those tokens are already inside `output_tokens`, and pricing both charges twice for the same thing. |
| `WEB_SEARCH_CALL` | when searches are billed per call |
| `TOOL_CALL` | other per-call tool charges |
| `PROVIDER_CALL` | per-request charges from non-model providers |

### Changing a price

Close the old row, open the new one. Overlapping periods for the same
(provider, model, unit) are rejected by an exclusion constraint — two
applicable rates would mean a job's cost depends on which row the query picked,
and a total that changes between two identical reads is worse than no total.

```sql
update provider_price_book
   set effective_to = '2026-10-01T00:00:00Z'
 where provider = 'OPENAI' and model = 'gpt-5.6-terra'
   and unit = 'INPUT_TOKEN' and effective_to is null;

insert into provider_price_book
  (provider, model, unit, rate, per_units, currency, effective_from, source)
values
  ('OPENAI', 'gpt-5.6-terra', 'INPUT_TOKEN', 1.10, 1000000, 'USD',
   '2026-10-01T00:00:00Z', 'openai.com/pricing 2026-10-01');
```

A period that starts exactly where the previous one ended is adjacent, not
overlapping, and is accepted.

## Re-pricing what is already recorded

New verifications pick the rates up automatically. Rows already written keep
`cost_usd = 0`; recompute them from the units they already carry:

```sql
-- What each stage of each verification cost, at the rate in force when it ran.
select ce.job_id,
       ce.operation_type,
       ce.units,
       p.rate,
       round((ce.units / p.per_units * p.rate)::numeric, 6) as cost_usd
from cost_events ce
join research_jobs rj on rj.id = ce.job_id
join provider_price_book p
  on p.provider = ce.provider
 and p.unit = 'INPUT_TOKEN'
 and p.effective_from <= ce.timestamp
 and (p.effective_to is null or p.effective_to > ce.timestamp)
where ce.operation_type like 'VERIFY_%';
```

This is deliberately not automated. Backfilled dollars are a judgement about
which model ran which stage on which date, and that judgement should be made
by somebody looking at it rather than by a migration.

## Reading the state

`cogs.ts` reports one of three states, and the state travels with the number:

- **PRICED** — every dimension of every stage had a rate.
- **PARTIALLY_PRICED** — some did not. `unpricedUnits` names exactly which, so
  the gap is actionable rather than merely visible.
- **UNPRICED** — nothing could be priced. The usage is still complete.

A total that silently omitted a stage would read as a cheaper job, which is
why the state is not optional.

## What customers see

Nothing. `costUsage`, `webSearchCalls` and the reuse plan are stripped at the
customer boundary, `cost_events` and `provider_price_book` are readable only by
an admin, and a Verify's price has no relationship to what it cost to produce.
What Homatch pays a supplier is not a fact about anybody's property.
