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
- OPEN MONEY DECISION (do not launch paid campaigns before it is made): the
  ledger reserves the ad budget from the customer's HOMATCH balance, while
  campaigns run on the customer's OWN ad account, which Meta bills directly.
  Either HOMATCH charges only the fee (customer-billed ad account), or ads
  run on a HOMATCH-owned ad account — not both.

## Discovery engine (same branch)

- Telegram MTProto gateway in the official worker (token-only
  `/telegram/*`), `WorkerTelegramClient`, community-sync MTPROTO mode,
  source discovery, canonical 30-day freshness policy
  (`src/research-core/discovery/freshness-policy.ts`). Not yet wired into
  matching/campaigns; no migration yet; worker needs `TELEGRAM_API_ID`,
  `TELEGRAM_API_HASH`, `TELEGRAM_SESSION`, `TELEGRAM_ENABLED` in Railway.

