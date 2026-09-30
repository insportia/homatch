# PROJECT STATE

last_updated: 2026-09-30
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
- Edge functions: `design-studio-model` and `design-studio-reconstruct`, which
  routes the three AI readings by path (`/`, `/floorplan`, `/design`) because the
  Free plan caps a project at 100 edge functions and production is at the cap
  (all JWT-verified, act as the caller), `storage-sign` (commit-time type and
  size enforcement, `4daf32aa`).
- AI operations (DS_FLOORPLAN_READ, DS_AI_DESIGN, DS_RECONSTRUCT) are measured,
  NOT priced: `design_studio_billing_enabled = false`; the functions refuse
  (not charge) if it is switched on before a confirmation flow exists.
- Reconstruction: pictures are `ds_floorplans` rows with `purpose='REFERENCE'`;
  the reading's plan rides on the first picture's row so the shared floor-plan
  generator builds it (ESTIMATED until calibrated). Pieces carry `provenance`;
  public share snapshots strip it.
- Permanent project deletion (`20261001170000`): never from the browser (the
  direct DELETE is revoked — it would orphan every R2 upload). The route
  `design-studio-reconstruct/project-delete` begins as the owner
  (`ds_project_delete_begin`: hides, freezes, revokes all shares), deletes
  everything under the project's three R2 prefixes (listed from the bucket),
  marks storage rows DELETED, then `ds_project_delete_finish` (service only)
  refuses unless storage is empty, writes an ids-only tombstone and cascades.
  Billing/usage rows are never touched. Interrupted deletions resume on the
  owner's next launcher visit.
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


## Brokers (same branch, 2026-09-29)

Migration `20260930140000_broker_lifecycle.sql` (NOT yet applied at time of
writing; apply after the Meta and Discovery migrations, via MCP
`apply_migration` name `broker_lifecycle`).

- Account: `users.account_type` PERSONAL/BROKER/AGENCY, `suspended_at`,
  `suspension_reason` — server-set only (trigger resets them unless
  service_role or GUC `homatch.account_rpc`). Signup "I'm a professional"
  routes to `/broker/onboarding`.
- One profile per owner (`broker_directory_listings`, unique owner, DRAFT
  status). `broker_profile_save` / `broker_complete_onboarding` /
  `broker_directory_submit` / `broker_directory_purchase(idempotency key)`.
- Verification UNVERIFIED/PENDING/VERIFIED/REJECTED/SUSPENDED: private bucket
  `broker-verification`, `admin_set_broker_verification` (audited, notifies).
- Leads: `matches.lead_state` NEW→REVIEWED→CONTACTED→IN_PROGRESS→WON/CLOSED;
  contact states need a `match_unlocks` row (`set_match_lead_state`).
- Broker Review: classify-signals-v2 queues BROKER_AGENCY posts into
  `broker_review_items`; admin ACCEPT writes `broker_intelligence` only from
  a public identity (never invents one).
- Suspension blocks new unlocks, campaigns, Meta launch, directory purchase;
  already-paid contacts stay readable.
- Native supply role: properties carry `listed_by_role`; supply-matching uses
  `nativeSupplyRole` (rentals → LANDLORD, broker listings → BROKER/AGENCY).
- UI: `/broker` desk, `/broker/onboarding`, lead status in the opened-contact
  dialog, Admin → Brokers Verification + Broker Review tabs + detail dialog.
- LIMITATION: agency TEAMS (members under an agency) are not implemented;
  `agency_listing_id` exists for later. An agent joins as an individual broker.
- `tests/browser/developerAcceptance.test.mjs` UNIT_UI / MOBILE_INTERACTIVE
  failed on origin/main too: a stale test premise, not a product bug. The
  project page defaults to the visual building (unit buttons read number AND
  area) and the drawer shows the price in its editable Price input. The test
  now finds a unit by its accessible name and reads dialog input values; the
  Developer product code was not touched.

## Workstream B rollout (2026-09-30) — PRODUCTION

- Merged: insportia/homatch#9 as `48943c8`. Later `main` = `d103891` (Design Studio #8).
- Migrations applied via MCP (ledger names; versions are MCP timestamps):
  `meta_ads_live_readiness` 20260930022058, `discovery_engine_queue_freshness_campaigns`
  20260930022225, `broker_lifecycle` 20260930022722. Each dry-run first (rolled back)
  against current production incl. the Design Studio migrations.
- Edge: all 28 Workstream B functions PROVEN_EXACT (runs 835/836/837 at 48943c8, and
  again in 838 at d103891). The CI bundler lost 6 uploads in run 835 (CLI printed
  "Deployed", no new version) and crashed once on discovery-queue-worker (exit 135 after
  Docker `toomanyrequests`); single-function `redeploy` dispatch fixed it.
  `refs/deployed/edge` still reads 87c715b: dispatch runs never advance it by design, and
  run 838 failed on two Design Studio functions (design-studio-ai, design-studio-floorplan
  UNAVAILABLE) — Workstream A's to resolve. `refs/deployed/frontend` = d103891.
- Vercel prod READY on 48943c8 (then d103891). Railway `homatch-official-worker`
  SUCCESS on 48943c8.
- Switches: `classifier_schedule_enabled` = true (proven: gate call skipped at $0;
  acceptance call classified 7 pending, 0 errors, $0.00012, classifierVersion
  signals-v2.1). All others OFF: Telegram credentials missing on the worker
  (TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION, TELEGRAM_ENABLED);
  forum cron is coupled to `discovery_background_refresh_enabled` (which also runs the
  Telegram sync); campaign source discovery would only reach one forum source.
- Meta: fee 9%, `meta_ads_budget_billing` = CUSTOMER_AD_ACCOUNT, 4 DRAFT campaigns,
  0 launched. Paid launch NOT performed — awaiting owner approval.
- Matches: 74 total, 69 dated, 0 within the 30-day active window (all history).
- Found, not changed: Railway service `homatch-official-worker-v2` exists (never use);
  7 `public.users` rows have no `auth.users` account; `admin_settings` held a plaintext
  `meta_ads_maintenance_token` (RLS admin-only) — moved to Vault by migration
  20261001120000_workstream_b_final_hardening.
- Known follow-up (latent, HOMATCH_WALLET billing only): Meta settlement posts RELEASE
  and META_SPEND as separate writes outside the ledger balance lock; make settlement
  one locked RPC before HOMATCH_WALLET is ever enabled. CUSTOMER_AD_ACCOUNT is unaffected.

## Workstream B final hardening (2026-09-30) — PR #11
- Merged to main as `d09ea5a` ([insportia/homatch#11](https://github.com/insportia/homatch/pull/11)).
- Migration `workstream_b_final_hardening` APPLIED to production (ledger version
  `20260930061526`, via MCP). Verified live: maintenance token in Vault (admin_settings row
  gone; RPC service-role only), maintenance cron reads Vault, ledger balance guard trigger,
  forum cron gated by `forum_schedule_enabled` (false), broker expiry cron `7 * * * *`,
  finished-search trigger, whole-row directory policy dropped.
- Production acceptance (rolled-back transaction, real identities): new broker DRAFT →
  self-activate 0 rows → purchase NOT_APPROVED → submit PENDING_REVIEW → self-approve
  FORBIDDEN; admin approves; zero balance INSUFFICIENT_CREDITS; purchase 290 once, replay
  `duplicate` (1000 → 710); stranger table 0 / view 1; anon table denied / view 1; admin
  detail + overview OK, non-admin FORBIDDEN; owner sees own matches only.
- Deploy run #839 did NOT deploy: Validate failed on 3 browser tests whose premises changed
  on purpose (6 discovery switches; review shows "charged by HOMATCH now" = fee only).
  Premises fixed on the branch. Until the next rollout, production runs the previous
  edge/frontend on the new schema: compatible, except the Meta maintenance pass is refused
  (old meta-ads-api reads the token from admin_settings) — fails closed, MOCK mode.
- Next rollout (one PR): the test-premise fixes + Facebook Login for Business
  (config_id 970930962712211, code grant, system-user token) + Meta Data Deletion Request
  callback + migration `20261001130000_meta_data_deletion_requests`.

## Workstream B final release (2026-09-30)
- Meta: production REAL; META_APP_ID / META_APP_SECRET / META_TOKEN_ENCRYPTION_KEY present;
  maintenance `tokenKeyCheck` valid=true roundTrip=true (meta-ads-api v11, PROVEN_EXACT at
  f2dda41). meta-webhooks PROVEN_EXACT; meta-oauth needed a single-function redeploy (run
  #845 reported it deduplicated/STALE). The one existing connection is the admin's TEST
  (mock_) connection: health = RECONNECT_REQUIRED; the maintenance pass retires it to
  ERROR/TEST_MODE_TOKEN once the next meta-ads-api is live. No real Meta connection yet;
  no campaign launched; no spend.
- Telegram: worker `homatch-official-worker` (Railway project d088991c…) MTProto
  configured/connected/authorized. `telegram_discovery_enabled` and
  `discovery_background_refresh_enabled` switched ON 08:42 UTC (cron `homatch-telegram-sync`
  */15). `telegram_source_auto_enable` stays OFF (operator activates found communities).
  Source discovery found 7 communities; 2 qualifying (udzravi_qoneba, moonlightbatumi2023)
  enabled; the 08:45 tick stored 263 current posts with t.me permalinks, target_id and (after
  migration 20261001160000) source_id; classifier cron */5 is working through them.
  Migrations 20261001140000 (community_targets columns), 20261001150000 (broker evidence
  RPC), 20261001160000 (Telegram registry backfill) APPLIED via MCP.
- Counters: one definition of current matches (src/matching/currentDemand.ts) now also in
  portfolioIntelligence and Outreach Insights. Property 244486: 14 current / 0 new / 9 strong
  (55/38/10 was all non-rejected rows including history).
- Deploys: push runs fail on Workstream A's `design-studio-ai` (402 function cap). Workstream B
  functions ship by `workflow_dispatch` with `redeploy=<list>`; no cap workaround exists in
  this repo and Design Studio is not touched from Workstream B.
