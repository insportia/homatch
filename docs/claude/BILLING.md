# BILLING

Read this before touching anything money-adjacent. `npm run homatch:scope`
warns when a diff enters this domain.

## Subscriptions (owner decision 2026-10-29) — SUPERSEDES "PAYG only"

Migrations `20261207100000_saas_subscriptions_core.sql`, `20261207100100_saas_entitlement_wiring.sql`.
Operator: შპს „ულტრა ქონექშენ“, identification code 406378511.

- **Plans** (`saas_plans`, code references `billing_plans`): STANDARD 990, VIP 2900, UNLIMITED 9900
  GEL tetri a month, VAT inclusive, `priority_tier` 10/20/30. **Allowances** per billing period
  (`saas_plan_entitlements`): VERIFY 5 / 15 / unlimited, CONTRACT_ANALYSIS 10 / 30 / unlimited; boolean
  HOMI_UNLIMITED, INTERNAL_SEARCH, INTERNAL_MATCHING, INTERNAL_UNLOCK_FREE on every plan;
  PREMIUM_DISCOVERY rows exist (disabled) with a trial switch for the Find Property workstream.
  Every number is a row edited only through `admin_saas_set_plan / _set_entitlement / _set_trial /
  _set_setting` (admin only, reason required, `admin_audit_log` SAAS_* with old/new). Admin → Plans
  and entitlements (`/admin/plans`). No artificial chat quota exists anywhere.
- **Why new tables**: `user_subscriptions` is read by `billing_current_plan → billing_entitlements →
  beginExecution / billing_price_quote`. An ACTIVE row there would make every PAYG product answer
  NOT_FOUND for STANDARD (no `product_plan_entitlements` rows) and apply VIP's dormant 25 % member
  discount. The subscription truth is `saas_subscriptions`; `billing_current_plan` keeps answering
  FREE and the legacy wallet path is unchanged. STANDARD/UNLIMITED were added to `billing_plans` with
  `enabled = false` (the dormant catalogue never renders them); VIP's dormant USD row is untouched.
  `users.plan` is not mirrored.
- **Funding order** (`saas_usage_begin`, advisory lock per user+feature): first-use trial
  (`saas_trials`, PK (user, feature): RESERVED → CONSUMED / RELEASED; a CONSUMED trial never comes
  back; account must have a confirmed email or phone and not be suspended) → plan allowance of the
  live period (RESERVED + COMMITTED count, so concurrent starts cannot exceed it) → legacy credit
  balance (only when `credit_accounts.balance > 0`) → refusal `SUBSCRIPTION_REQUIRED` /
  `ALLOWANCE_EXHAUSTED` (402; the UI shows the plans, never a top-up).
- **Success-only usage** (`saas_usage`, unique (user, feature, idempotency_key)): commit only on
  delivery, release on failure / stop / timeout; `saas_usage_sweep` (via `saas_subscription_tick`,
  jobs-worker every tick) releases RESERVED rows past the feature TTL (VERIFY 48 h, CONTRACT 1 h).
  A delivery after the sweep still commits (the customer got it) and is flagged `over_allowance`
  when the period was full.
- **Wiring**: Verify — `verify_billing_open` / `_close` / `verify_launch_quote` are wrappers; the
  previous functions are renamed `*_wallet` and keep the fixed-price path for legacy credit holders
  (a job that already holds a wallet session keeps it). Key `verify:<job>`; COMPLETE commits,
  STOPPED / PARTIAL / SYSTEM_FAILED release. Contract Analysis — `deal-room-document-analyze` and
  `developer-document-extract` go through `_shared/entitlements.ts beginEntitled` (keys
  `contract:<doc>:<sha>`, `devdoc:<doc>:<sha>`), legacy wallet with `allowIncluded: false`: the old
  "1 free a month for everyone" is gone. Plan-funded analyses still record COGS (`cost_events`,
  CONTRACT_ANALYSIS). Internal lead unlock — `internal_leads_unlock` is free (0 credits, no wallet
  call) for any live subscriber, decided under the lock from the subscription row;
  non-subscribers keep the priced path only with a positive legacy balance, otherwise
  `SUBSCRIPTION_REQUIRED`. Contacts are exposed only through `internal_lead_unlocks` rows.
- **UI reads one function**: `entitlement_status_for_me()` (plan, subscription, per-feature
  used/limit/unlimited/remaining, trial state/availability, legacy balance).
- **Lifecycle** (`saas_subscriptions`, one live row per user; `saas_subscription_events` audit +
  notification outbox): activate on the first verified payment (period = now → +1 calendar month in
  Asia/Tbilisi, `saas_period_end`); **upgrade now** (new plan and a NEW period start immediately,
  allowances reset, no proration, no refund of unused days); **downgrade at period end**
  (`pending_plan_code`); **cancel at period end**; renewal paid inside the 3-day window
  (`saas_renewal_window_days`) sets `next_period_paid` and the tick rolls into it; unpaid period end →
  `PAST_DUE` with `saas_past_due_grace_days` (3) of continued access → `EXPIRED`; a payment while
  PAST_DUE starts a fresh period at once. Notices (jobs-worker → `notify()`): SUBSCRIPTION_ACTIVATED,
  SUBSCRIPTION_RENEWED, SUBSCRIPTION_ENDED, SUBSCRIPTION_PAYMENT_DUE, PAYMENT_FAILED, TRIAL_USED
  (enum values added; email templates belong to the notifications workstream).
- **Payments** (`_shared/saasPayments`): one adapter interface (createSession, verifyWebhook →
  normalised event, lookupTransaction, refund, chargeRecurring, testConnectivity, capabilities).
  Access is granted ONLY by `saas_payment_event_apply` after verification: idempotent on
  (provider, event_id), amount and currency must equal the checkout (else AMOUNT_MISMATCH, nothing
  granted). The redirect back (`/subscription/confirm`) only polls. `saas-payments-webhook?provider=`
  is the single door (no JWT; the adapter authenticates). jobs-worker re-reads PENDING bank checkouts
  (reconciliation) and charges consented saved cards once per period (no automatic retry).
  - **Bank of Georgia**: OAuth2 client_credentials, create order (GEL, callback, redirect URLs,
    external_order_id = checkout id), callback `Callback-Signature` SHA256withRSA over the raw body
    with the bank's public key AND a re-read of the receipt before anything is applied, receipt
    lookup, refund, saved card for automatic payments + charge. Secrets `BOG_CLIENT_ID`,
    `BOG_CLIENT_SECRET`, `BOG_CALLBACK_PUBLIC_KEY`.
  - **TBC Checkout (tpay)**: apikey + client_id/secret token, create payment (merchantPaymentId =
    checkout id, callbackUrl), callback carries only a payment id so the status is ALWAYS re-read
    from the API, cancel/refund, saveCard + recId recurring execution. Secrets `TBC_API_KEY`,
    `TBC_CLIENT_ID`, `TBC_CLIENT_SECRET`.
  - **SANDBOX**: HMAC-signed test events (`SAAS_SANDBOX_SECRET` + `saas_sandbox_payments_enabled`),
    admin-only, labelled everywhere (`is_test` on checkouts and payment events), and it grants
    access ONLY on a database where a superuser set `homatch.saas_sandbox_grants = 'on'` — never in
    production (there it records `SANDBOX_NO_GRANT`).
  - Customers are sent only to the live provider in `admin_settings.saas_default_payment_provider`
    (NONE by default) and only when its secrets exist; otherwise the pricing page shows "online
    payment activation pending". Until then the audited admin support grant (`admin_saas_support`
    GRANT / EXTEND / CANCEL_*) is the only way to activate a plan.
  - The Stripe / mock top-up code (`_shared/payment_provider.ts`, `payment-webhook`) is untouched and
    keeps serving top-up history. Historic payments, invoices and legal records of the previous
    operator are never rewritten.
- **Credits**: `credits-topup` answers 410 `CREDIT_SALES_CLOSED` unless
  `admin_settings.credit_topups_enabled` is true (seeded false). `/credits` is read-only history.
  Existing balances stay spendable (legacy path above). Pass-through costs (Meta Ads budgets, paid
  external discovery / Apify, GPU rendering) are not in any plan and keep their wallet / explicit
  charge; how those are funded now that credits are not sold is an owner decision.
- **Tests**: `tests/matrix/saasSubscriptions.test.mjs` (adapters, signatures, webhook path, funding
  order, notices, source facts), `tests/sql/saas/realdb.mjs` (real PostgreSQL 17: trials, concurrency,
  lifecycle, replay, sandbox guard, Verify / unlock wiring, admin audit).

The sections below describe the PAYG model as it was. They stay true for legacy credit holders and
for the pass-through products; where they say "PAYG only" or "no plan gating", this section wins.

## Invariants

- **Billing is per service** (owner decision, 2026-10-22, replacing "PAYG only").
  10 credits = $1. SUPERSEDED 2026-10-29 by Subscriptions above (saas_* tables). The dormant
  "billing-v2" machinery (user_subscriptions, product_plan_entitlements) is still NOT product
  truth and must not be wired up.
- **Email Marketing plans** (`email_plans`, `email_subscriptions`,
  `email_quota_periods`, migration 20261124090000): Free 50 emails once per
  account (lifetime, never reset); Pro $50/month 50,000; Scale $220/month
  100,000; overage $2.20 per started 1,000, OFF until the customer consents
  (optional block cap). Prices are VAT-inclusive; policy
  `email_marketing_37_63_vat_v1` extracts VAT then allocates 37/63 of net.
  Paid from the wallet (EMAIL_PLAN_PRO / EMAIL_PLAN_SCALE / EMAIL_OVERAGE_1K via
  wallet_reserve → wallet_settle); renewal only with auto_renew on, keyed per
  ending period so it can never charge twice. Billable unit: one message the
  provider accepted; failed/suppressed sends consume nothing. Card recurring
  billing does not exist (payment provider in mock mode).
  Atomicity: `email_plan_activate` checks the wallet hold is still RESERVED and
  settles it in the same transaction as the period (never a plan without its
  charge); a purchase is refused under the subscription lock while a same-or-
  higher paid month has >3 days left; a renewal must name the period it renews.
  Overage blocks are counted PENDING under the period lock at reservation, and
  `email_quota_bill_overage` charges + records them in one transaction; unpaid
  overage never counts as sent. Quota keys are one per send attempt (a settled
  key is STALE_KEY, never a re-grant); `email_quota_release_stale` (jobs-worker,
  every 10 min) returns abandoned reservations. Safeguards (admin_settings, 0 =
  off): `email_marketing_tenant_daily_cap` (default 5000) and
  `email_marketing_provider_monthly_cap` (set it to the active Resend plan's
  monthly limit before enabling sending).
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
- **Finance V2.1 (2026-10-22) — cost coverage, one price resolution.** Every metered AI /
  provider call records a `cost_events` row through `_shared/providerCost.ts`
  `recordUsageCost` (provider, model, operation, `finance_service`, `correlation_id`, units,
  tokens, `pricing_state`, `idempotency_key`); never throws, off the response path
  (`deferCost` → `EdgeRuntime.waitUntil`) where latency matters (AI Talk). Usage comes only from
  the provider response (`tokenUsage`); no usage → UNPRICED with units unknown, never an assumed
  count. Rates resolve in ONE place, `provider_estimated_cost_usd` (provider_price_book, dated):
  NULL when no row → UNPRICED (cost_usd 0 is a placeholder; the ledger view returns NULL);
  some dimensions priced → PARTIAL (a lower bound); provider-reported dollars → ACTUAL. Retries,
  callbacks and replays are idempotent via the unique `cost_events.idempotency_key`
  (upsert, ignore duplicates). Sources with no reliable billable data are listed in
  `finance_cost_coverage` (UNSUPPORTED / PARTIAL / UNPRICED_SOURCE) and every affected
  service reads `costComplete=false` in Admin — its profit is shown as "not final".
  Shared infrastructure (`finance_v2_shared_costs`: price-book MONTH rows prorated,
  `finance_fixed_expenses`; unconfigured = NOT_CONFIGURED, never $0) is reported beside, never
  inside, a service's profit. Remaining pinned copies of rates (Design Studio `PRICE_TABLE`, the
  Find Buyers OpenAI default and its `admin_settings` copy) are checked against the book by
  `tests/matrix/priceRegistryDrift.test.mjs` and live by `finance_v2_price_drift()`.
  Coverage matrix: `docs/claude/FINANCE_V2_1_COVERAGE.md`.
- **Reservation sweeper (PR #264) — OFF by default.** `wallet_sweep_expired_reservations`
  releases RESERVED holds past `expires_at` via `wallet_release` and marks them EXPIRED only if
  the release succeeded (V2.1 fixes the race: `for update skip locked`, count only rows it
  released). Switch: `admin_settings.wallet_reservation_sweeper_enabled` (absent/false = off).
  Enabling it is an owner decision. Rollback: set it false (or delete the row); already
  released holds are not re-reserved — the customer keeps the credits, nothing is charged.
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

- **Verify fixed price + 30-day validity** (migration `20261127090000`,
  owner decisions 2026-10-23; supersedes the cost-based budget below for
  every job opened after it). ONE customer price per Verify, V1 and V2
  alike: `billable_products.VERIFY` (`billing_mode` FIXED,
  `standard_retail_cents` 190 → 19 credits at `credits_per_usd`), **VAT
  included**. Admin → Pricing Configuration edits it through
  `admin_set_verify_price(p_cents, p_reason)` (admin only, row-locked,
  whole credits only — refused, never rounded; `pricing_version` bump;
  `admin_audit_log` VERIFY_PRICE_UPDATED with old/new/reason;
  `admin_verify_price_history`). `verify_billing_open` snapshots the price
  on the job (`price_mode/price_credits/price_cents/pricing_version`) and
  refuses a start whose quoted price (`p_expected_credits`, sent by the page
  from `verify_launch_quote`) differs: `PRICE_CHANGED`, nothing held.
  Charged ONLY on delivery: `verify_billing_close('COMPLETE')` settles the
  snapshot minus earlier charges; STOPPED / PARTIAL / SYSTEM_FAILED release
  everything. `verify_budget_gate` always answers GO (no budget pauses, no
  +25 extensions). The metered cost is still recorded on every session for
  finance; a run that costs more than its price is absorbed and flagged
  `needs_review`. Jobs whose billing row has no snapshot (opened before the
  migration) close on the cost-based rules below. `finance_services.verify`
  → `fixed_retail_v1`.
  **Validity:** a report delivered (synthesis READY, status COMPLETE) with
  `completed_at` ≥ `admin_settings.verify_report_validity.effective_at` (the
  migration time) is registered in `retention_records` by trigger
  `trg_verify_report_validity`: available_at = completed_at, expires_at =
  `retention_expiry(completed_at)` (+30 days UTC), policy STANDARD_30D, never
  moved. Access ends at that instant through the existing read-time gates
  (RLS `research_jobs_retention_gate`, `retentionGuard` 410 REPORT_EXPIRED)
  — no sweep has to run. **Migration policy:** reports delivered before the
  cutover get no record and stay permanent; failed jobs are never
  registered; nothing is deleted (access expiry only; billing, ledger and
  audit rows untouched). The global `storage_retention` switch is NOT used:
  it would also start expiring contract documents.
  **Known metering difference (not changed here):** `verify_job_cost()` prices
  the cost-based research SYNTHESIS stage with the policy map's
  `ai_models.synthesis = gpt-5.6-luna` (20261026100000) while it runs on
  gpt-5.6-terra — about $0.061 low per cost-based V1 job. Fixed-price jobs do
  not charge from that meter.

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

## External Leads Database (owner, 2026-10-24)

- Product `CURATED_LEAD`: **$0.10 per lead = 1 credit** (10 credits = $1), final and
  VAT-inclusive, set in cents by `admin_curated_set_price` (audited). PAYG, no plan.
  Finance V2 service `curated_leads`, policy `fixed_retail_v1`.
- One entitlement per account and lead (`curated_lead_unlocks` UNIQUE): a purchase never
  removes the lead from the shared catalog; the same account is never charged twice.
- `curated_leads_unlock` (service role, via `atomic-unlock` kind `curated_leads`): advisory lock
  per account, idempotency key replay, all-or-nothing reserve → settle of exactly
  new-leads × price, refuses a selection that grew past the confirmed `expectedCredits`
  (`PRICE_CHANGED`), ≤ 5,000 new leads per purchase; contacts land in the account's
  standing "HOMATCH Curated Leads" email list in the same transaction.
- Internal-match unlock prices (3 / 5 / 10 credits) are unchanged and separate.

## HOMI voice messages (owner, 2026-10-25)

- Product `HOMI_VOICE_MESSAGE` (migration `20261204105000`): **0.3 credits per minute = $0.03**,
  FIXED, VAT-inclusive, PAYG, billed **per started 10 seconds (0.05 credits)** on the duration
  Google billed (recorded length only when Google reported none); at most 2 minutes per message.
  Finance V2 service `homi_voice`, policy `fixed_retail_v1`.
- Edge `homi-voice-transcribe`: consent once per account (`homi_voice_consents`, service-role
  writes only; refused without it, `CONSENT_REQUIRED`) → `beginExecution` (hold = price of the
  recorded length + one step) → worker `/speech/transcribe` (Google chirp_3, WORKER_TOKEN) →
  `settleExecution({ priceCredits })`. HOMATCH-side failure or no words heard → full release.
- COGS: `provider_price_book` GOOGLE / chirp_3 / AUDIO_SECOND ($0.016/min) at the seconds Google
  billed (× attempts when a refused language was retried with `auto`); no rate → UNPRICED.
  Landed ≈ $0.0189/min, so the fixed price is ≈ 37 % gross margin: below the 55 % cost-based
  floor by owner decision (product config `pricing_policy` CUSTOM).

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

## Why there is no static PAYG guard test (historical; subscriptions replaced PAYG-only)

A source-level "no plan gating" test was evaluated and judged brittle: the
dormant billing-v2 machinery makes any regex-level assertion either
false-positive on dead code or blind to real gating. The invariant is
enforced here, in review, and by the absence of plan wiring — flag any diff
that starts connecting plan machinery to live surfaces.
