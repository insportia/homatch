# PROJECT STATE

last_updated: 2026-09-28
maintained_by: hand (update when production-relevant facts change; this is the
session-start truth that saves a production round-trip — but for anything that
MATTERS right now, verify against the live systems, not this file)

## Production pointers

- main == refs/deployed/frontend == refs/deployed/edge == `5a3a688`
  ("CI owes only what CI may deploy"). Verify at deploy time with a fresh
  `git fetch origin '+refs/deployed/*:refs/deployed/*'`.
- Vercel: project `homatch` (`prj_oQDQ3HV4N9AiPwzfFGlRyEjXhlib`, team
  `team_5Uh3IRBVJcl3DV1ZoOpmPGi8`), production deployment READY at 5a3a688.
- Supabase: project `ptxajsjhobhvsfhmutjn` (Postgres 17, RLS everywhere).
  Migration ledger applied through `retired_providers_and_no_spend_while_viewed`
  (8 migrations applied 2026-09-27/28).
- Railway: worker `homatch-official-worker`
  (`3e7f132b-d0be-4804-9bc0-0b6ad368ad15`) in project
  `d088991c-b680-4458-9f12-a5df2d983e6b`. It is the ONLY worker. Never `-v2`.
- Edge functions: CI deploys with exact artifact proof;
  `impersonate-user` and `unlock-external-contact` are hand-deploy-only
  (excluded from CI's owed set — see `scripts/deploy-scope.mjs`).

## Live switches and balances (as of last_updated)

- Impersonation: `impersonation_enabled = false` (admin switch OFF).
- DATAFORSEO / APIFY: RETIRED and LOCKED. History preserved. Never reactivate.
- Payment provider: mock mode (`PAYMENT_PROVIDER_SECRET` unset; webhook
  refuses with 503 without `PAYMENT_WEBHOOK_SECRET`).
- Signup credit grant: OFF. Card-added bonus: 10 credits, ON.
- SERVICE_RESERVE wallet: 76.30 credits — historical balance, untouched.
- Push subscriptions in production: 0.
- Cron: `homatch-native-intent` (*/1), `homatch-supply-matching` (*/15) — live.

## Design Studio (branch `feat/design-studio`, rolling out 2026-09-30)

- Five migrations `20260930090000`…`20260930095000` (foundation, dev catalog,
  storage categories, billable products, shares, reconstruction). Unapplied
  until the unified rollout; `scripts/design-studio/rls-check.mjs` proves them
  on PGlite (131 checks).
- Edge functions: `design-studio-floorplan`, `-model`, `-ai`, `-reconstruct`
  (all JWT-verified, act as the caller), `storage-sign` (commit-time type and
  size enforcement, `4daf32aa`).
- AI operations (DS_FLOORPLAN_READ, DS_AI_DESIGN, DS_RECONSTRUCT) are measured,
  NOT priced: `design_studio_billing_enabled = false`; the functions refuse
  (not charge) if it is switched on before a confirmation flow exists.
- Reconstruction: pictures are `ds_floorplans` rows with `purpose='REFERENCE'`;
  the reading's plan rides on the first picture's row so the shared floor-plan
  generator builds it (ESTIMATED until calibrated). Pieces carry `provenance`;
  public share snapshots strip it.
- Living engine: `canvas/livingRuntime.ts` runs every interaction (declared by
  assets, permitted by capabilities); lights are a pool of 4/3/2 per tier
  (12 per-lamp lights halved the frame rate — measured).
- Browser QA: `tests/browser/designStudio.qa.mjs` (324 checks; checkpoint 11
  runs the customer's acceptance render end to end with a hand-authored
  reading in place of the model).

## Deferred / known-open (do not "fix" casually)

- Active Search has no dedicated UI surface yet (backend + notify exist).
- 10× pricing ambiguity in research offer copy: documented, deliberately
  unresolved — do not change numbers without an explicit product decision.
- Flagged copy awaiting product wording: `credits_what_body`,
  `partners_cat2_desc`.
- Dormant billing-v2 "plan" machinery exists in code but is NOT product
  truth: HOMATCH is PAYG-only (see BILLING.md).
