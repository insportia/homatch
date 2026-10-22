# BILLING

Read this before touching anything money-adjacent. `npm run homatch:scope`
warns when a diff enters this domain.

## Invariants

- **PAYG only.** 10 credits = $1. There are no Free/Premium/VIP packages and
  no feature gating by plan. Marketing copy saying "premium design" describes
  aesthetics, not a Premium package. Dormant "billing-v2" plan machinery in
  the codebase is NOT product truth and must not be wired up.
- **Wallet ≠ Budget ≠ Spend ≠ COGS.** Four distinct concepts; never conflate
  them in schema, service code, or copy.
- **Reserve → settle → release.** Every paid action reserves first, settles
  what was actually consumed, releases the remainder. No path may skip the
  reservation or settle more than was reserved.
- **Unknown COGS is never silently zero.** If cost of goods is unknown, that
  is an explicit state, not `0`.
- **Retired providers stay retired.** DATAFORSEO and APIFY are locked off;
  their history (spend, ledger rows) is preserved. Never reactivate, never
  delete history.
  Exception (owner, 2026-10-04): memo23 Apify Actors for FIND BUYERS /
  FIND TENANTS run as provider `APIFY_MEMO23` (registry, verified pricing,
  per-campaign provider ceiling = `find_buyers_provider_share_bps` of the
  customer budget, integer-microdollar ledger `find_buyers_cost_ledger`).
  Second exception (owner, 2026-10-09): Verify's Developer Advertising stage
  runs one memo23 Ad Library Actor per job (`verify_developer_ads`, Admin
  switch; per-run provider ceiling maxChargeUsd $0.50, 50 items, 180 s; 24 h cache). Its COGS is a
  `cost_events` row `provider=APIFY_MEMO23`, `operation_type=DEVELOPER_ADS_VERIFY`
  (ACTUAL / ESTIMATED / UNPRICED — never a silent 0), inside the Verify
  job's existing price; it never touches the Find Buyers ledger or budget.
- **Finance V2 (owner, 2026-10-19) — one financial layer.** Customer prices are final and
  VAT-inclusive (Georgian VAT 18 %, `finance_tax_profiles` GE_VAT_18_ALL, applied to every
  customer: no jurisdiction data exists on users). VAT is extracted, never added:
  net = gross × 10000 / (10000 + bps), `finance_split_gross`. Wallet top-ups carry no VAT
  (deposits); VAT is recognised when credits are consumed. Every customer policy is a row in
  `finance_commercial_policies` (a changed rule is a new id; a transaction keeps the policy it
  started under), every service a row in `finance_services`. The ledger is two views —
  `finance_v2_revenue_lines` (every charge: usage_events, credit_ledger direct debits,
  meta_ads_ledger fee) and `finance_v2_cost_lines` (every attributable provider/AI line from
  its authoritative source; `cost_usd` NULL = UNPRICED, never 0) — read only through the
  admin RPCs `finance_v2_services / _service_detail / _execution / _quote`
  (Admin → Finance → Services). Free services still record COGS. Find Property search AI cost
  is the correlated `cost_events` record (`correlation_id` = search id, model, tokens; PARTIAL =
  lower bound — `20261119130000_find_property_costs`, Admin → Finance → Find Property); the
  ledger reads it as recorded and never re-prices it. Shared/background cost
  (`shared_platform`, `retired_providers`, `unattributed`) never enters a service's profit.
  The `billing_cogs_tax_bps` 18 % COGS uplift stays in non-Verify cost-based PRICING
  (owner, 2026-10-19) and is reported separately; it is not COGS in the ledger.
- **Paid discovery pricing policy `paid_discovery_37_63_vat_v2`** (owner, Finance V2,
  2026-10-19) — CURRENT for every new Find Buyers / Find Tenants and Find Property paid
  campaign (`PAID_DISCOVERY_CURRENT_POLICY`). VAT first, then 37 / 63 of the VAT-exclusive
  revenue N = P / 1.18; every provider and AI cost is paid from the 63 %:
  - execution budget = floor(P_micros × 6300 / 11800) (SQL twin
    `paid_discovery_execution_micros`): $5 → $2.669491, $10 → $5.338983, $30 → $16.016949;
    VAT $10 → $1.525424, HOMATCH $10 → $3.135593.
  - charge = ceil(spend × 11800 / 6300) to the cent, capped at the reservation
    (`creditsForSpend(…, v2)`, SQL `paid_discovery_gross_for_spend_micros`). Find Buyers v2
    settles on its own campaign ledger (`find_buyers_campaign_spend_micros`: actor runs + the
    campaign's OpenAI rows) and refuses to settle on a guessed spend.
  - The gross-based ÷ 0.63 inverse exists only for v1 campaigns.
- **Paid discovery pricing policy `paid_discovery_37_63_v1`** (owner,
  2026-10-16) — HISTORICAL: campaigns stamped with it keep it. It applied to every paid
  discovery campaign started 2026-10-16 … Finance V2:
  Find Buyers / Find Tenants (`find_buyers_campaigns.pricing_policy`) and the
  Find Property paid social OFFER campaign (`discovery_runs.pricing_policy`).
  - HOMATCH profit = 37% of the TOTAL price P; provider budget = 63% of P
    (55% − 18%·P / 45% + 18%·P). $5 → $1.85 / $3.15, $10 → $3.70 / $6.30,
    $30 → $11.10 / $18.90, $100 → $37.00 / $63.00. Never VAT-inclusive (no
    $2.745); statutory VAT is accounted separately.
  - Provider budget = floor(P_micros × 6300 / 10000), integer micro-USD; SQL
    twin `paid_discovery_provider_share_bps()` = 6300. Every provider run is
    reserved against it (`find_buyers_reserve_actor_run` /
    `find_property_reserve_actor_run`), and capped at Apify by
    maxTotalChargeUsd = its reservation, so a $5 campaign never spends more
    than $3.15.
  - Charge = provider spend consumed ÷ 0.63, rounded UP to the cent, capped
    at the reservation (`creditsForSpend` → `settleExecution({ priceCredits })`
    / `settlePaidSocialRun` → `wallet_settle`); the rest is released. Unknown
    run cost counts at its reservation, never 0. Nothing consumed → full
    release. A customer stop charges what was consumed; a HOMATCH-side failure
    releases everything (HOMATCH carries the spend).
  - Prospective: campaigns without `pricing_policy` keep the terms they
    started under (Find Buyers' `find_buyers_provider_share_bps` split and
    `billing_price_quote`). No historical transaction is rewritten.
  - Find Property paid minimum: max(50 credits = $5, `campaign_min_credits`);
    explicit confirmation of the exact price (`confirm.priceCredits`,
    `acceptedTerms`) before `wallet_reserve`. Free search (HOMATCH + portals)
    never reserves or charges.
  - Admin → Demand intelligence → Analytics shows charged (wallet), provider
    spend (booked cost) and HOMATCH profit per policy.
- **Find Buyers / Find Tenants minimum** (owner, 2026-10-19): exactly $5 =
  50 credits at 10/$ (VAT-inclusive where VAT applies), the paid discovery
  policy's `PAID_DISCOVERY_MIN_USD` converted through `credits_per_usd` —
  `minimumCampaignCredits` in match-campaign, refused (`BELOW_CAMPAIGN_MINIMUM`)
  before `wallet_reserve`. `find_buyers_min_usd` (was $10) no longer moves it;
  migration 20261119120000 sets it to 5 so every read agrees. Presets: 50 / 100 /
  500 / 1,000 / 1,500 / 2,000 (`search_budget_presets_find_clients`); larger
  budgets stay supported up to `campaign_max_credits`. Not a second credit rate.
- **Find Buyers execution budget = the central policy's number, consumed, never
  re-derived.** `find_buyers_campaigns.provider_budget_micros` is stamped from
  `allocateCampaign` (paidDiscoveryPolicy.ts) at start and widened by
  `paid_discovery_provider_share_bps()` on an extension. When Global Finance V2
  (VAT-first 37/63) replaces that policy, Find Buyers inherits it with no change
  here; nothing under `_shared/findBuyers` or `research-core/findBuyers` computes
  VAT, a split or a margin (tests/matrix/findBuyersMinCampaign.test.mjs).
  Inside that budget every attributable cost counts: memo23 runs (atomic reserve)
  AND OpenAI. Since 20261119120000 the reserve also holds classification
  headroom for every in-flight run's items (`find_buyers_ai_headroom_micros_per_item`,
  default 250 µ$), and the worker refuses any OpenAI call the remaining budget
  cannot cover (`executionBudget.ts` AiSpendGate; items it cannot afford stay
  UNVERIFIED). Unknown spend shuts the gate.

- **Verify credit budget** (migration `20261026100000`, OFF until
  `admin_settings.verify_billing_enabled` = true). A Verify reserves its
  authorised budget (`billable_products.VERIFY.config.verify_budget.max_budget_credits`,
  100 — the cap across authorisations; 25 to start) through `wallet_reserve`, prices its METERED cost live, and settles the
  cumulative price minus what earlier sessions of the same job charged
  (stop/resume never charges twice; the total never exceeds the recorded
  authorisations). Price: net = max((landed + contingency_bps) / (1 − target_margin_bps),
  landed + min_net_profit_usd $1.00 — COMPLETED reports only); gross = net ×
  (1 + vat_rate_bps), credits rounded up, capped — a floor, never a fee on top
  of the margin; stopped/partial sessions are margin-only, system failures
  release everything. If the cap prevents the floor, the shortfall is recorded
  (`profit_floor_shortfall`, needs_review), never charged — Verify's own policy, NOT
  `billing_price_quote()` and NOT a plan's `profit_share_to_customer_bps`.
  System failure → release all; customer stop → charge incurred. Missing rate
  → policy `fallback_usd` (FALLBACK) or UNPRICED + `verify_billing.needs_review`.
  Customer UI shows credits used / available / returned only.
  **Incremental authorisation (owner rule 2026-10-10):** 25 credits to start,
  +25 only per explicit customer approval, at most 4 authorisations / 100
  credits per job, cumulative across every stop and continuation, never
  reset. Each authorisation is one row in `verify_billing_authorizations`
  (own id, unique key `verify:<job>:auth<seq>`, unique (job, seq)); an
  extension names the authorisation count the customer saw
  (`p_expected_authorizations`), so a double click or stale tab adds nothing.
  Before each chargeable stage research-agent calls `verify_budget_gate`:
  the job's cumulative price after the stage at its p95 estimate (policy
  `stage_estimates_usd`; SYNTHESIS also covers REPORT and is priced as the
  completed report, floor included) must fit the authorisation. No
  percentage threshold interrupts a run. GO runs; AWAIT holds the job PAUSED
  (`_pause.reason = BUDGET`) and closes the session (incurred charged, rest
  released — nothing held while waiting); LIMIT (100 reached) holds with
  `BUDGET_LIMIT` and is never extended. Usage above the authorisation is
  absorbed (wallet_settle caps the charge), recorded as `overrun_credits`
  and flagged `needs_review` for finance.
  VAT once (owner rule 2026-10-10): Verify's cost is `verify_cost_cents` —
  actual provider cost + real fees (`billing_cogs_fee_bps`) + non-recoverable
  input tax only when a provider genuinely charges it (policy
  `nonrecoverable_input_tax_bps`, 0). The global `billing_cogs_tax_bps` 18 %
  uplift is NOT used by Verify (other products unchanged). Output VAT 18 % is
  applied once, on the customer price; top-ups carry no VAT (payments
  vat_rate_bps 0).

## Where it lives

- Edge: `supabase/functions/{billing,credits-topup,payment-webhook,
  payment-method-setup,atomic-unlock,unlock-external-contact,
  research-purchase}/`, shared logic in
  `supabase/functions/_shared/billing.ts` and `payment_provider.ts`.
- SQL: ledger/wallet functions live in migrations (repo is schema truth;
  the applied ledger is production truth — `npm run deploy:status`).
- Client: `src/pages/CreditsPage`, billing/credits services under
  `src/services/`.

## Facts that look like bugs but are state

- Payment provider runs in mock mode until `PAYMENT_PROVIDER_SECRET` is
  configured; the webhook 503-refuses without `PAYMENT_WEBHOOK_SECRET`.
- SERVICE_RESERVE wallet holds a historical 76.30 credits. Do not "clean up".
- Signup grant OFF; card-added bonus 10 credits ON.
- The 10× research-offer pricing ambiguity is documented and deliberately
  unresolved; changing numbers is a product decision, not a code fix.

## Why there is no static PAYG guard test

A source-level "no plan gating" test was evaluated and judged brittle: the
dormant billing-v2 machinery makes any regex-level assertion either
false-positive on dead code or blind to real gating. The invariant is
enforced here, in review, and by the absence of plan wiring — flag any diff
that starts connecting plan machinery to live surfaces.
