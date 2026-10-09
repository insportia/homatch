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
  runs one memo23 Ad Library Actor per job (`verify_developer_ads`, seeded
  off; caps maxItems/maxChargeUsd/timeout; 24 h cache). Its COGS is a
  `cost_events` row `provider=APIFY_MEMO23`, `operation_type=DEVELOPER_ADS_VERIFY`
  (ACTUAL / ESTIMATED / UNPRICED — never a silent 0), inside the Verify
  job's existing price; it never touches the Find Buyers ledger or budget.
- **Find Buyers minimum** is `find_buyers_min_usd` ($10) converted through
  `credits_per_usd` (100 credits at 10/$). It is not a second credit rate.

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
