# PROJECT STATE

last_updated: 2026-09-29
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

## Deferred / known-open (do not "fix" casually)

- Active Search has no dedicated UI surface yet (backend + notify exist).
- 10× pricing ambiguity in research offer copy: documented, deliberately
  unresolved — do not change numbers without an explicit product decision.
- Flagged copy awaiting product wording: `credits_what_body`,
  `partners_cat2_desc`.
- Dormant billing-v2 "plan" machinery exists in code but is NOT product
  truth: HOMATCH is PAYG-only (see BILLING.md).

## Meta Ads (branch claude/homatch-discovery-engine-rqdnza, 2026-09-29)

- Production runs Meta Ads in MOCK: `META_APP_ID` / `META_APP_SECRET` are not
  set as Edge secrets. The only production "connection" is a mock one (mock_
  assets, "TEST Page"); 4 DRAFT campaigns, 0 launches, 0 leads, 0 webhooks.
- Branch adds: per-goal Graph payloads (`src/lib/metaAds/payload.ts`), launch
  engine (`meta-ads-api/engine.ts`), signed OAuth state, header-only tokens +
  appsecret_proof, optional token sealing (`META_TOKEN_ENCRYPTION_KEY`),
  webhook signature-before-dedupe, maintenance cron, stepped builder.
  Migration `20260930120000_meta_ads_live_readiness.sql` NOT applied.
- MONEY MODEL (code default, confirm before any paid launch):
  `meta_ads_budget_billing` = CUSTOMER_AD_ACCOUNT — the campaign runs on the
  customer's own ad account, Meta bills the budget there, HOMATCH holds only
  its fee (refunded on unspent budget). HOMATCH_WALLET holds the budget in the
  HOMATCH balance and is only correct for an ad account HOMATCH pays. Never
  both.

## Discovery engine (same branch)

- Telegram MTProto gateway in the official worker (token-only `/telegram/*`),
  `WorkerTelegramClient`, community-sync MTPROTO mode, source discovery.
  Worker needs `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION`,
  `TELEGRAM_ENABLED` in Railway (homatch-official-worker only).
- ONE active-demand rule: `discovery_freshness_policy` (30 days; 0–7 / 8–14 /
  15–30 bands; undated ineligible) via `judgeActiveDemand`, applied by
  run-matching-v2, run-matching, the Matches screen (older demand is a
  collapsed history section) and atomic-unlock (`DEMAND_NOT_CURRENT`, 409).
  `matches.demand_published_at` carries the date. The 7-day
  `evidence_delivery_window_days` is a different rule (have we seen the post
  recently) and stays.
- Structured gates in run-matching-v2 (`research-core/match/structured-gates.ts`):
  city across scripts (place table), budget across currencies (fx_rates only —
  production holds NO GEL/USD rate yet, so cross-currency budgets are UNKNOWN,
  never guessed), bedrooms. Market query reads every city spelling.
- Campaigns: PAYG-only (`allowIncluded:false`), budget is a ceiling, 50-Credit
  minimum. Gap discovery queues TELEGRAM / TELEGRAM_SOURCES / FORUM source jobs
  and finishes asynchronously via the discovery driver
  (`discovery-queue-worker` mode `drive`, cron `homatch-discovery-driver`).
  One ending for both paths: `_shared/campaignRun.ts` counts ONLY new matches
  on current demand created by this run.
- Classifier: nine-label taxonomy + classifier-version fingerprint cache
  (`research-core/discovery/signal-taxonomy.ts`); agency posts labelled
  BROKER_AGENCY and routed to broker review, never matches.
- Admin: `/admin/discovery` (RPC `admin_discovery_overview`; stop/retry via
  the driver with an admin session).
- Migration `20260930130000_discovery_engine_queue_freshness_campaigns.sql`
  NOT applied. Every new switch defaults OFF. Applying it also cancels the
  6,557 dead APIFY/DATAFORSEO PENDING rows (history kept) and sets FIND_CLIENTS
  to PAYG-only with a 50-Credit minimum — billing changes that need approval.
- FX: run-matching-v2 never fetches. match-campaign / the discovery driver
  fetch official NBG rates (_shared/fx.ts, 4s, best effort) and pass them in;
  the writer re-validates (<= 3 days old). fx_rates rows count only when
  dated within 7 days. No rate = cross-currency budget UNKNOWN (never a
  rejection). Same-currency matching never depends on FX.
- Pre-migration production snapshot (2026-09-29): 74 matches, 0 within 30
  days, 69 older, 5 undated; 14 opened (11 stale + 3 undated) — all stay
  accessible. Dry run of both migrations in a rolled-back transaction on
  production: PASS (6,557 retired rows -> CANCELLED, 69 matches dated,
  updated_at moved on 0 rows, 14 unlocks intact, 5 crons, all switches off).
- Railway courteous-success also contains a pre-existing
  `homatch-official-worker-v2` service (not created by this workstream; never
  use it). The canonical worker has NO Telegram variables.

