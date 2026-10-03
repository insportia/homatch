# PROJECT STATE

last_updated: 2026-10-03
maintained_by: hand (update when production-relevant facts change; this is the
session-start truth that saves a production round-trip — but for anything that
MATTERS right now, verify against the live systems, not this file)

## Production pointers

- main == refs/deployed/frontend == refs/deployed/edge == `d4be0a86`
  (PR #28, Meta Ads dashboard; deploy #864, FAST). Verify at deploy time with a fresh
  `git fetch origin '+refs/deployed/*:refs/deployed/*'`.
- Vercel: project `homatch` (`prj_oQDQ3HV4N9AiPwzfFGlRyEjXhlib`, team
  `team_5Uh3IRBVJcl3DV1ZoOpmPGi8`), production deployment READY at d4be0a86
  (`dpl_Cda9Z6fxRaYaqysFdQS3iyitbmXq`, aliased to www.homatch.live).
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

## Design Studio asset catalogue (branch `feat/design-studio-catalog-import`, 2026-09-30)

- IMPLEMENTED, pushed, NO PR (no GitHub credentials in the session), NOT
  merged, NOT deployed; migration `20261002210000` NOT applied; nothing
  imported; Blendkit key UNVERIFIED. Owner approval gate: no bulk import
  without "APPROVE FULL IMPORT". Canary (only after merge + deploy + migration):
  Poly Haven oak_wood_planks, white_plaster_02, anniversary_lounge; Blendkit
  CC0 Soave sofa, Teo chair, Danish dining table, Geberit toilet, Hansgrohe
  faucet, Lampe-Gras floor lamp, snake plant.
- Runtime policy (`catalogSource.RUNTIME_POLICY`): a model reaches the browser
  only as an optimised GLB (textures ≤ 2048, KTX2 — UASTC normals, ETC1S
  rest — meshopt, Khronos-validated, ≤ 20 MB) plus LOD1 (≤ 1024, ≤ 8 MB,
  simplified above 30k triangles). The original is stored `restricted`; a model
  that misses the budget or cannot be optimised is FAILED (final, not retried).
  Source and runtime bytes are recorded separately.
- Signing route (`design-studio-model/catalog`, service role only): an R2 PUT
  only for a recorded asset with an importable licence (CC0 today) and a
  public key only for CC0; a Blendkit download only for a file that asset
  listed. RF and UNKNOWN are refused at the credential boundary
  (`catalogPolicy.ts`).
- Kitchen boundary: cabinetry and built-ins (KITCHEN_RUN, KITCHEN_ISLAND) are
  HOMATCH parametric generation fitted to the measured wall
  (`reconstruction.PARAMETRIC_ONLY`); movable pieces (appliances, stools,
  tables, sanitaryware) come from the catalogue.
- One catalogue, provider adapters (`src/lib/designStudio/catalogProviders/`):
  Poly Haven = materials + HDRIs (final selection 671 + 330, 4,822 files,
  11,614,991,023 bytes exact); Blendkit = physical objects.
- Blendkit Royalty-Free is STOPPED (FAQ: only where assets "can't be extracted
  by the users in an easy way"; browser delivery does not clearly satisfy it).
  BLOCKED_PENDING_PERMISSION: 1,948 curated RF assets (12,230,929,404 bytes)
  are not downloaded. CC0 after the name-first audit: 40 KEEP (228,706,336
  bytes); not imported automatically. No CC0 bed, kitchen object or door passes.
- Runs only by manual dispatch of "Design Studio catalogue import" (the
  autonomous scheduled variant was refused by the environment's persistence
  guard and removed). BLENDKIT_API_KEY authentication is unverified until the
  signing route is deployed.
- Unrelated: on Windows the Meta Ads test "no Meta Ads frontend code carries its
  own fee percent" fails on a path bug (C:\\C:\\…); passes on Linux CI.

## Design Studio (branch `feat/design-studio`, rolling out 2026-09-30)

- Migrations `20260930090000`…`095000` and `20261001170000`…`200000` are all
  APPLIED in production (the last four by hand runner SQL + ledger rows whose
  `statements` point at the repo files). `scripts/design-studio/rls-check.mjs`
  proves them on PGlite (171 checks).
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
- Fidelity (`ds-recon-2`): the model traces
  every room/opening/piece in picture pixels; `sourceCamera.ts` fits each
  picture's camera (orthographic or perspective) and the plan is unprojected
  from the pixels (geometry `PIXELS`, else `ESTIMATE`). Match Reference View
  uses that fitted camera. A pictures reconstruction is labelled "From your
  pictures" (`20261001180000` sets `provenance.origin` from the plan's purpose;
  `20261001200000` gives the public share a coarse `origin`, so its note says
  "rebuilt from pictures").
- KNOWN LIMIT (measured on the real render): the reader's pixel traces are too
  coarse to trust (camera fit rms ≈ 9–11% of image height vs the 2.5% trust
  gate), so production readings fall back to the model's estimated plan
  (labelled ESTIMATE; the reference panel says "aligned approximately"). The
  layout is recognisable but not faithful (L-shape read as a rectangle).
  ROOT CAUSE (2026-09-30): the camera is fitted AGAINST the reader's own
  metres, so a wrong layout can never fit and the traces are thrown away.
  FIX on branch `feat/design-studio-measured-frame` (69bc4a0e, stacked on #19,
  NOT merged/deployed/applied): the browser measures an isometric picture's
  frame at upload (`pictureGeometry.ts` → `pictureFrame.ts`, byte-identical in
  `_shared`), stores `picture_geometry` + `plan_view_key` (migration
  `20261004100000`, NOT applied), and the reader traces rooms on the top-down
  plan view in the same single reading. Outline error replaces the fitted-camera
  rms as the matched/approximate number (FIT_TRUST unchanged). Needs production
  acceptance on the real fixture (a NEW upload — old rows have no frame).
- PHOTOREAL / SOURCE FIDELITY (branch `feat/design-studio-photoreal`, 2026-10-01;
  measured-frame + wave 1 merged in, frame migration renumbered `20261004100000`):
  * Plan view was MIRRORED (measureAxes axis order); fixed — the axes keep the
    picture's handedness (test). Frame also records the picture `background`.
  * Reading `ds-recon-3`: objects carry `form`, `secondaryColor`, `frontPx`; on a
    framed (aerial) picture objects are traced on their TOP face and lowered by
    their height through the measured camera; facing from the front edge; frame
    aligned on rooms+openings, then refined with the lowered pieces;
    `fidelity.wallM` (picture's cut height) + `wallCutRatio` → `interiorWallM`;
    `frameColor` → `state.frames`. Frame vs fitted-camera disagreement → fitted.
  * Pieces keep what was seen: `ObjectInstance.shape` (size/form/secondary,
    `objectShape.ts`; parametric pieces drawn at it, catalogue models scaled
    within 0.7–1.45). A model is used only if it `looksLike` the seen piece.
    Placement: settle into the reader's room, square, back to the wall (or the
    room edge for railings), quarter-turn fallback; door zones only while the
    doors between the rooms stay walkable; small pieces that would block a door
    are left out (reported), essential ones never.
  * Surfaces: `chooseSurfaceMaterial` picks imported PBR by pattern/words/colour
    family (worn textures penalised, paint stays flat) and `tint` balances the
    texture to the seen colour (albedo mean measured at load).
  * Render: GTAO + MSAA HDR post (`postFx.ts`, HIGH tier live + all stills),
    exposure 0.88, NW sun, light wall cut; source look = exact picture camera,
    picture background (ground hidden), section cut rebuilt at wall/partition
    heights, doors+glazing shown, ceiling fittings hidden. Download images
    start with the picture-camera still. New procedural forms
    (`proceduralForms.ts`): curved sofa, shell lounge/dining chairs, pedestal/
    drum tables, leaf foliage, made bed, TV on stand.
  * Local acceptance loop (harness + traced reading of the real picture) lives
    in the session scratchpad only; production acceptance is the real model.
- Wave 1 (#19: bundle ratchet 6.5 MiB, floor pattern, storage-sign refuses
  DELETED, original preservation — its migration `20261001210000` IS applied)
  is reconciled with main `aee8f77d` but blocked: every main deploy fails
  Validate on Workstream B's own test "balance card: the non-refundable
  disclosure is rendered" (B removed `mm_w_bal_disclosure` from
  ServiceBalanceCard). Not ours to change; B notified.
- Rendering fidelity (#17): HOMATCH-drawn procedural finishes
  (`canvas/finishTextures.ts`: planks, herringbone, tile, stone, concrete,
  carpet, paint, fabric, wood grain, leather — normal-mapped, per-tier size),
  bevelled/soft concept blocks, PMREM RoomEnvironment light following time of
  day, skirting, contact shadows. Floors carry a structured `pattern`; the
  rebuild also derives it from the reader's own material words in six
  languages (`floorPattern`). Render cost of the acceptance home: 832 draw
  calls / 129k tris / 14 textures (before: 783 / 17k / 2). The 783-call
  baseline (walls, paint faces, edges as separate meshes) is the real mobile
  cost — not yet optimised.
- Catalogue: still 56 `dev/*` procedural placeholders. No licensed mesh
  library exists; the schema (`model_key`, `lods`, `license`, provenance) is
  ready but empty — the main remaining fidelity gap.
- AI COGS (`20261001190000`): the handlers priced from unset env rates, so every
  job was written as a silent 0. Now `metering.ts` prices through
  `ds_ai_cost_evidence` (the price book) and writes
  `usage_events.pricing_state` = ESTIMATED, or UNPRICED with a null cost.
  `finance_design_studio_economics` feeds Admin → Finance → Products
  (statistics over priced samples only; the candidate price is planning-only
  and sets nothing). Measured sample: gpt-5.6-luna 3,839 in / 10,606 out =
  1.3495¢ raw, 1.5924¢ landed.
- Living engine: `canvas/livingRuntime.ts` runs every interaction (declared by
  assets, permitted by capabilities); lights are a pool of 4/3/2 per tier
  (12 per-lamp lights halved the frame rate — measured).
- Browser QA: `tests/browser/designStudio.qa.mjs` (360+ checks, incl. on-screen
  look direction and a render-cost budget; checkpoint 11
  runs the customer's acceptance render end to end with a hand-authored
  reading in place of the model).

## Find Property — Marketplace Search foundation (branch ccr-76ef455d-0qvt80, 2026-10-03) — NOT ACTIVE

- Built: brief/readiness/worker contract/pipeline (`src/research-core/marketplace`), edge
  `marketplace-search` + `marketplace-worker-ingest`, UI `src/components/findProperty`, admin panel.
- Migration `20261010100000_marketplace_search_foundation.sql` prepared and locally proven; NOT applied.
- `marketplace_search_enabled` seeded OFF → `/find-property` keeps the legacy experience.
- No marketplace worker registered. Deep Search shown as not yet available.
- Map and activation checklist: `docs/claude/FIND_PROPERTY_MARKETPLACE.md`.

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

## Phase 1 release (2026-09-30 10:21 UTC) — main 924776b (PR #14)
- Vercel production READY on 924776b (dpl_AKtYPXtuJRXwxuTjB6DkdetGAKYk); live bundle inspected:
  new /brokers (evidence links, no navy hero, no distinction block), current-demand counters,
  TEST_MODE_TOKEN copy, six-locale strings. refs/deployed/frontend advanced by run #848.
- Edge: community-sync v16 + meta-ads-api v12 PROVEN_EXACT (#848); meta-oauth v11 PROVEN_EXACT
  (#849, single-function dispatch); meta-webhooks unchanged since its #845 proof.
- Meta: REAL, secrets present, tokenKeyCheck valid/roundTrip true; old test connection now
  ERROR/TEST_MODE_TOKEN. Ready for the owner's first real Connect Meta.
- Property 244486: 14 current / 0 new / 9 strong (STRONG+VERY_STRONG+EXCEPTIONAL) — one rule
  in header, cards, Matches, Insights.

## Meta Ads master (in progress on claude/homatch-discovery-engine-rqdnza, NOT yet on main)

Phase 2 (Universal Discovery) is blocked until this is live and proven.

- Migration `20261002100000_meta_ads_master.sql` — written, proven idempotent on
  the local fixture, NOT applied to production. Production pre-check: none of its
  tables exist, 0 meta_leads rows (the status remap is a no-op), 5 campaigns
  (3 DRAFT, 1 NEEDS_CHANGES, 1 PAYMENT_REQUIRED), 0 launched.
- Edge (meta-ads-api): `engine.ts` (v2 strategy, targeting, creative advice,
  fee policy, 3-day settlement grace), `lifecycle.ts` (write-through
  pause/resume/end/edit), `monitor.ts` (deterministic 15-min cycle: Guard →
  insights → analysis → events; lead backfill; duplicate scans every 6 h;
  briefs at 08:00 local), `actions.ts` (geo search, strategy preview, drill-down,
  dashboard, recommendations, premium lead forms, admin Guard/fees/economics),
  `notifier.ts` (canonical events → notify() → push-send → email via Resend).
- Shared: metaLeads attribution + localized notify(); notifyEmail; push-send
  meta_* categories; outreach_providers parameter properties made explicit
  (behaviour-neutral, needed for node type-stripping tests).
- Fixed in passing: `_shared/metaAds.ts` 190 check compared string to number,
  so invalidated tokens never marked the connection EXPIRED.
- UI: four slices (builder, campaign drill-down, workspace/leads/balance,
  admin + notification center) with i18n data files spliced by
  `scripts/meta-master-i18n-apply.mjs`.
- Remaining: gates, production migration apply, one rollout (meta-ads-api,
  meta-webhooks, push-send + frontend), PROVEN_EXACT proof, non-spending
  acceptance, final report. No paid Meta actions; owner performs first launch.
- 2026-09-30: PR #18 merged (3d3d433); migration applied to production and
  fingerprint-verified; deploy #853 stopped at the entry-bundle ratchet
  (6.21MB > 6MB) so edge was not deployed while Vercel served the new frontend.
  Ceiling moved to 6.5MB (owner-approved, PR #20). Follow-up: per-language
  lazy loading of translations, then lower the ceiling.
- 2026-09-30: Admin financial control (PR #20). Migration
  `20261002110000_meta_ads_finance_control.sql` applied to production (MCP name
  `meta_ads_finance_control`); function bodies, columns, constraints and
  policies fingerprint-identical to the fixture; anon has no execute.
  The fee has one server-side home, `meta_effective_fee_percent` (policy over
  `admin_settings.meta_ads_fee_percent` = 9), used by the edge; no frontend
  fee literal (tested). Adjustments only via `admin_meta_adjust_balance`
  (ledger ADJUSTMENT + immutable `meta_finance_adjustments` + admin audit;
  overdraft and self-adjust refused). The ledger guard now also covers
  ADJUSTMENT and WITHDRAWAL debits.
  The owner-operator admin account has FEE_EXEMPT, set through
  `admin_set_meta_fee_policy` under that admin's own identity (a self-set by
  the only admin, audited). No email address is anywhere in code.
  Production acceptance ran as a rolled-back transaction, and all 10 proofs
  passed. Nothing persisted except the exemption.
- 2026-09-30 (evening): Meta Ads release rolled out. PR #20 squash-merged as
  7f5fc1d. Vercel production READY at 7f5fc1d (refs/deployed/frontend =
  7f5fc1d). Edge, all PROVEN_EXACT at 7f5fc1d:
  - run #857: meta-ads-api v13, meta-oauth v12, outreach-send v35;
  - run #858 (single-function redeploy): meta-webhooks v12;
  - run #859 (single-function redeploy): push-send v24.
  The CLI deduplicated meta-webhooks and push-send in #857 (STALE), the known
  failure mode. refs/deployed/edge is still a32f74d because single-function
  runs do not advance it; the next main deploy re-proves the five and advances
  it. Railway not touched.
  Live checks:
  - The new maintenance build answers the */15 cron in REAL mode (monitor
    block present, 0 errors, 0 AI calls).
  - Unauthenticated, forged-JWT and bad-cron-token calls are refused
    (401/401/403); a wrong webhook verify token gets 403.
  - Bad-signature and unsigned webhooks get 200 but are only stored as
    signature_ok=false, never processed.
  Meta connection: the owner's real connection is CONNECTED with base scopes
  only (no leads_retrieval / pages_manage_ads / pages_manage_metadata). Instant
  Forms stay blocked on Meta App Review, and the preflight names the missing
  scopes. No campaign launched and no spend. The owner's ENGAGEMENT campaign
  sits at PAYMENT_REQUIRED from before the exemption; it is launchable
  fee-free by the owner.
- Follow-up done on branch claude/homatch-discovery-engine-rqdnza (not yet
  merged): per-language translation chunks. Entry 6.21MB -> 1.62MB, ratchet
  lowered to 2MB, full gate green at 43aec4d.
- 2026-09-30 (night): the owner launched the first real Meta campaign
  (MESSAGES, sale property, HOUSING, fee 0%, $5/day × 7) and then paused it
  from Meta Ads Manager. HOMATCH detected the pause at the next scheduled
  sync: status PAUSED, ad CAMPAIGN_PAUSED, Guard MANUAL_PAUSE NOTICE, in-app
  notification. EXTERNAL META STATUS RECONCILIATION: PRODUCTION-PROVEN.
  Claude did not touch the campaign, launch anything or spend anything.
- Released in PR #25 (main 6cd79ce); originally listed as pending:
  - Status sync: a new `homatch-meta-ads-status-sync` cron runs every minute
    (migration 20261002120000). Campaigns are grouped by ad account, with two
    Graph reads per account. Paused campaigns are read every fifth minute.
    Insights, Guard and analysis stay on the 15-minute pass.
  - Rate-limit observability: `graph()` captures X-Business-Use-Case-Usage,
    X-Ad-Account-Usage and X-App-Usage (percentages only) and stores them in
    `meta_api_usage` (migration 20261002130000, admin-read RLS).
    `rateLimit.ts` sets the pressure levels: NORMAL, ELEVATED at 50%, HIGH at
    75%, CRITICAL at 90%, and THROTTLED while Meta reports a regain time.
    Throttle errors are classified before auth errors and are never retried
    in the same call. Admin gets a "Meta API health" tab.
  - Status-change notifications carry provenance (statusChange.ts); neutral
    wording is used when a change can't be attributed. The notifier queried
    the missing column `users.language`, which made every notification
    English with no email; it now uses `preferred_language`.
  - Paused semantics: a paused campaign never shows green "healthy", and
    fresh data is a STATE (FRESH) rather than a verdict. Recommendations are
    worded for the lifecycle stage.
  - START NOW means server time + 1 minute (`launchStartTime`). The requested
    start is persisted separately from Meta's start_time.
  - Campaign rename (HOMATCH display name, audited on the timeline). A default
    name from the property, goal and month is set in review.
  - "HOMATCH ახლა" assistant panel: four answers from stored facts only;
    Campaign Guard is the only automatic actor. Autopilot is NOT IMPLEMENTED.
  - Release order: apply 20261002130000 BEFORE the edge deploy; apply
    20261002120000 AFTER meta-ads-api is PROVEN_EXACT.
- 2026-09-30 / 10-01: PR #25 → main 6cd79ce. PRODUCTION-PROVEN:
  - Edge (deploy #860, then independently re-read from production): all 5
    PROVEN_EXACT, no redeploy needed: meta-ads-api v15 (36/36 modules
    byte-identical to main), meta-oauth v14 (7/7), meta-webhooks v13 (12/12),
    outreach-send v36 (3/3, deduplicated, unchanged since 7f5fc1d),
    push-send v24 (2/2, deduplicated, unchanged since 7f5fc1d).
    refs/deployed/edge = refs/deployed/frontend = 6cd79ce.
  - Vercel: dpl_FwUBdAGh11mUo3WAwMC3mhu6UTR3 READY at 6cd79ce, aliased to
    www.homatch.live (homatch.live redirects there).
  - Migrations: meta_api_usage before the edge deploy;
    meta_ads_status_sync_cron (job 31, every minute) after meta-ads-api was
    proven. It runs every minute with 200 {ok, mode REAL}. On fifth minutes
    it reads the paused campaign with 1 account, 1 campaign and 2 Graph
    calls; no-token / bad-token calls get 401 / 403.
  - Meta usage (first real capture, 02:40 UTC): tier development_access;
    ads_management 4% calls / 1% CPU / 1% time; ads_insights 1/1/1;
    ad-account util 0%; app usage 0%; no regain time — NORMAL.
  - Health on the real paused campaign: DELIVERY STATE/PAUSED,
    DATA_HEALTH STATE/FRESH, recommendation PAUSED_NOT_COLLECTING (not
    actionable). Rename DB path proven in a rolled-back transaction.
  - Status-change notification: deployed; awaiting the next real external
    status change for proof.
- Fast Release Rule (docs/claude/RELEASE.md): validation once in parallel
  PR jobs with a tree-id validation record; post-merge provenance step
  promotes byte-identical validated code without re-running repository
  suites. Projections: PR ~6–8 min (was 19.6), merge→edge proven ~2–3 min on
  FAST (was ~18.7).

## Release engine v2 — component-aware (PR #27, 2026-10-01)

- `scripts/release/components.mjs` is the component/suite table; reach is
  computed (import graph, edge closure, migration objects, translation keys).
  Tiers: TARGETED / COMPONENT_FULL / REPO_FULL; FAST post-merge on a v2
  record covering the change. v1 records (before #27) are never promoted.
- PR: one parallel job per planned suite (mobile by owner ×10, studio ×2,
  journeys, push, a11y, worker). Post-merge without proof: deploy.yml calls
  pr-check.yml for the merged change (parallel), not the serial gate.
- Baseline measured: PR FULL 5 m 56 s (run 36816875975); deploy #861
  20 m 30 s, 19 m 42 s of it a serial Validate (run 36813098669).
- Measured after: see the PR #27 / its merge runs (to be filled from real
  runs; do not quote projections as measurements).
- Permissions: `.claude/settings.json` + `.claude/hooks/sql-guard.mjs`
  (read-only SQL and on-main migrations auto-allowed; the rest asks).
- Gap: no gated browser suite visits Design Studio (designStudio.qa.mjs is
  manual, needs VITE_FEATURE_DESIGN_STUDIO=on).
- Debt (recorded 2026-10-02, PR #68): `tests/browser/designStudio.qa.mjs`
  checkpoint 5 is STALE on main — it waits for the heading "Check what
  HOMATCH read" (`ds_fp_review_title`), which no screen renders since the
  plan-to-home path of #57 (`64b55124`). It is in no CI workflow and no npm
  gate (run-tests, run-full-matrix, lint), so nothing release-blocking runs
  it. The customer path it once covered is covered by
  `tests/browser/planToHome.qa.mjs` (A zero-question, B one-question,
  C RTL, D architecture-critical questions). Fix later: move checkpoint 5 onto
  the simple flow, or retire it.

## Meta Ads canonical status + first FAST release (PR #28, 2026-10-01)

- One customer-facing status: `src/lib/metaAds/uiStatus.ts` (server counts
  in `meta-ads-api` dashboard and every UI surface). Meta-paused is PAUSED,
  never ACTIVE. Production on 2026-10-01: 3 DRAFT, 1 NEEDS_CHANGES, 1 PAUSED
  at Meta (`911e571e…`) → Active 0 · Paused 1 · Needs attention 1.
- First real FAST promotion, measured: PR validation run 36823453627
  TARGETED (static, unit, mobile:meta-ads) 3 m 14 s; deploy #864
  (run 36824324056) RELEASE PATH: FAST — tree `ba0d5d72` identical to the
  validated tree — 1 m 11 s merge-push → edge proven (meta-ads-api v16
  PROVEN_EXACT, refs/deployed/{edge,frontend} → d4be0a86).
- Not provable from the sandbox: the logged-in production screen (the proxy
  refuses www.homatch.live); proven instead by alias → deployment at the
  merge commit, the deployed function over the production rows, and the
  browser suite with the production fixture.

## Meta Ads Admin Control Center (PR after #28, 2026-10-01)

- Admin campaign state = `src/lib/metaAds/adminView.ts` on top of uiStatus:
  KPIs (all / delivering / paused / review / drafts / attention / rejected /
  failed / mismatch / stale) open `?tab=campaigns&view=…` filtered by the
  same predicate. Rows show HOMATCH lifecycle, canonical chip, Meta
  external_status, sync freshness (stale > 20 min for SUBMITTED/META_REVIEW/
  ACTIVE/PAUSED at Meta) and any HOMATCH≠Meta mismatch.
- Settings and kill switches: only through `admin_setting_set` (admin, not
  suspended, reason ≥ 3, `src/lib/metaAds/adminSettings.ts` validation,
  admin_audit_log with previous/next; reverted if the audit row fails).
  admin_settings still has an admin RLS write policy (shared table, not
  changed here): the UI never uses it.
- Moderation: only through `admin_moderation_decide` (admin, OPEN only,
  note, decided_by, audit with before/after). CHANGES_REQUESTED →
  NEEDS_CHANGES, REJECTED → REJECTED. APPROVED (`src/lib/metaAds/moderation.ts`):
  stores the SHA-256 claim fingerprint of the approved creative text; the
  HOMATCH check passes that exact text next time (any edit is reviewed
  again) and never opens a second OPEN case; with no other review open the
  campaign goes MANUAL_REVIEW → PREFLIGHT_REQUIRED with `preflight` cleared
  (never READY: the normal check builds the plan). Approval never launches,
  publishes, resumes or spends. Customer status: MANUAL_REVIEW = uiStatus
  `HOMATCH_REVIEW` ("In review", distinct from Meta's IN_REVIEW).
- API health probe: booleans + `lastStatusSyncAt` / `lastUsageReportAt`.


## Meta Ads production polish (2026-10-01)

- Instant Forms (LEADS_ON_META): goal switch ON, but no production connection
  holds leads_retrieval / pages_manage_ads / pages_manage_metadata. State is
  server-decided (`src/lib/metaAds/instantForms.ts`): COMING_SOON (nobody
  holds them — App Review / Login for Business configuration pending),
  RECONNECT (some connection does), AVAILABLE, DISABLED. Customers see product
  words only; Admin sees the missing permissions (API health probe, Connections).
  Owner checklist to unblock: Business Verification; App Review Advanced Access
  for leads_retrieval, pages_manage_ads, pages_manage_metadata (+ the base set
  if not yet approved); Ads Management Standard Access; add the three to the
  Login for Business configuration (META_LOGIN_CONFIG_ID); leadgen webhook on
  the Page object; customers reconnect Meta; Leads Access Manager grant where
  customised. Sources: Meta docs via search summaries (direct fetch blocked) —
  re-verify in the App Dashboard.
- Admin owner identity: `admin_meta_people` (admin-only, ids → name/username/
  email/connection/ad accounts; users stays own-row-only, nothing copied).
- CTA: one rule `payload.resolveCta` for payload/preview/review/editor;
  LEADS_ON_META no longer offers CONTACT_US, PROMOTE no SEE_MORE, WhatsApp
  sends WHATSAPP_MESSAGE. Message ads expose headline/description editors.
- Capacity: ELEVATED pressure now halves insights and drops breakdowns
  (`allowance().insightsSlowdown/breakdowns` were unused); maintenance skips a
  THROTTLED account; duplicate scans wait from HIGH. Known throughput ceilings
  (HOMATCH side): maintenance ≤ 25 campaigns per 15-min pass (40 s budget),
  status sync one 40 s invocation per minute (≤ 200 rows) — the first scaling
  blockers, ahead of Meta's per-account limits (tier: development_access).

## Design Studio scene factory (branch `feat/design-studio-hybrid-engine`, 2026-10-02) — NOT yet on main

- Architecture corrected per owner: AI = understanding/planning/comparison/correction; HOMATCH compiles
  its canonical scene into a strict SceneBuildSpec (`src/lib/designStudio/hybrid/sceneSpec.ts`, data only,
  validated in TS, on the edge, in the worker and inside Blender); Blender on Runpod is the scene factory
  (`infra/design-studio-gpu-worker/worker/factory/`). SAM/TRELLIS removed from the worker entirely: no
  weights, no HF_TOKEN.
- Engine: pass 1 build+render → visual check → bounded corrections → pass 2 build+render+export →
  verifying check → third pass only if justified and within budget; superseded exports discarded.
  Runtime = HOMATCH walkthrough; factory piece GLBs replace drawn pieces (non-interactive kinds);
  architecture stays HOMATCH-native (editable surfaces); whole-home GLB tiers stored as artifacts.
- Floor plan → realistic 3D: workspace "Realistic 3D" action (FLOORPLAN_SCENE sources), one pass,
  plan check reported only; walkability / intersection / scale checks on every build.
- Migration `20261005100000_design_studio_factory.sql` NOT applied: ds_factory_jobs, ds_factory_assets
  (PROJECT_PRIVATE), ds_reconstructions.engine_report, ds_create_share strips `generated`. PGlite RLS
  check: 200/200 incl. 13 factory checks.
- Owner actions still required after merge: Runpod endpoint from GitHub (Dockerfile in the worker dir,
  24 GB GPU, min 0 / max 1, no endpoint secrets) + Supabase secrets RUNPOD_API_KEY,
  RUNPOD_DS_ENDPOINT_ID, RUNPOD_DS_USD_PER_SECOND. Docker image never built locally (no Docker); it
  self-tests the factory at build time.
- Golden picture sha256 89919f728795c08aee17922745b484bca6d6d8d6965bcd8b0f64a201ee3ff94f (owner uploads).
- Windows-only test failures (reproduced on pristine main fd1cdd72, not regressions): bundleImports +
  metaAds customerFinance (`URL.pathname` → `C:\C:\`), releasePath 11b + plan.mjs (MSYS tar reads `C:` as
  a remote host in plan.mjs's `git archive | tar -x -C`), placementSearch timing (10.9 ms alone, 36 ms
  only under full-suite contention).

## Design Studio "your plan → your designed home" (same branch, 2026-10-02) — NOT yet deployed

- Two sources of truth: GEOMETRY = the validated reconstruction (spatial source); DESIGN = PropertyDesignDNA
  (ds_versions.design_dna, ds-dna-1) + the approved DesignState. Renders are Blender views (worker
  views.py/look.py: dollhouse master + eye-level room views, exact object-id maps) finished by OpenAI
  (only provider in production: selectProvider is OpenAI-only; model via admin_settings
  `design_studio_render_model` → DS_RENDER_MODEL → gpt-image-2; quality ≥ high; Gemini unreachable from routes)
  and checked against Blender (renderCheck.ts); refused finishes keep Blender's picture.
- Routes (design-studio-reconstruct): render-quote / render-start / render-status / render-edit; finishes and
  edits run in EdgeRuntime.waitUntil. ds_renders (owner read-only). Products DS_MASTER_RENDER /
  DS_ROOM_RENDER / DS_RENDER_EDIT: PROPOSED prices 6 / 5 / 4 credits (renderPricing.ts) — owner decision;
  charging follows design_studio_billing_enabled (still false → quotes say "not charged during the preview").
- Home hub /design-studio/:id/home (Plan · 3D design · Rooms · Walkthrough): tap-to-edit through the object map
  (edits = DesignState operations → new version; Undo = previous version), room views N per room,
  walkthrough = factory build of the approved version + object-map consistency check against the master.
- Migrations to apply after merge (MCP apply_migration, byte-exact): 20261007110000_design_studio_factory_views,
  20261007120000_design_studio_renders (renumbered after main's meta_ads 20261006100000/20261007100000).

## Design Studio plan-to-home (branch `feat/design-studio-plan-to-home`, 2026-10-02)

- PR #55 merged as 43080be3 (factory fixes); Runpod template arm0q8wpxq set to `sha-43080be3…`
  (endpoint qtry95qmlfzsb0 unchanged). After this branch merges the template must move to its new sha.
- Customer path (FloorPlanFlow): upload → reading (ds-read-2: model + deterministic fusion with the
  raster, `_shared/designStudio/planRead/`, browser copies in `src/lib/designStudio/planRead/`) →
  review (PlanReview: clean plan, printed-size solve, ≤6 questions, tap-to-fix) → look (DesignChooser,
  DesignPreferences) → generate (services/designStudio/planToHome.ts generateHome: resumable, flow
  pointer on ds_floorplans.corrections[-1].flow; factory idempotent by spec) → /walkthrough.
  "Your plan" compare panel in editor and walkthrough. Reading cache by (user, sha256, ds-read-2).
- Stairs + opening leaves end to end (generator, space, walkthrough, placement, spec, worker).
  Stairs are solid obstacles (not climbable); one storey only.
- Picture reader: partitions corrected for their lower cut, coverage check, full-height balcony glazing,
  scale checked against standard pieces (strong consensus replaces the reader's self-reported size).
- Golden floor plan (local, recorded v1 reading + fusion): scale 0.64% off, rooms ≤3.6% from printed,
  15/15 openings within 0.054 m, stairs carved from kitchen, 1 question. Browser QA
  tests/browser/planToHome.qa.mjs 26/26 (1440 en, 390 ka, reload mid-generation = one factory job).
- Not yet proven in production: ds-read-2 prompt against the live model, edge image decode under Deno
  (jpeg-js/fast-png verified in Node only), walkthrough with factory GLBs on the golden floor plan.

## Design Studio golden apartment — first real E2E (branch `fix/design-studio-factory-golden`, 2026-10-02)

- Project 8dfe8dfd-7297-40fb-90a8-23639bee5ed0. Runpod endpoint qtry95qmlfzsb0 (RTX A5000, OptiX),
  template arm0q8wpxq. Pass 1 job 9a35262c COMPLETED: delay 5.1 s, execution 11.6 s, Blender 8.0 s,
  render 6.4 s, $0.0022. Pass 2 job b8e1afb7: execution 52.9 s, $0.0101, every GLB FAILED at the edge.
- Fixed on the branch (commit 699c968b, not yet merged): BAD_SPEC camera.near (compile clamp), meshopt
  fallback buffers refused by modelInspect, factory-status verification race (atomic verifyingAt claim),
  failed-output jobs reused forever, tint balanced against placeholder #ffffff (worker), metalness on
  non-metals, curved sofa bent from 8-vertex boxes (worker slices first).
- After merge: the GHCR workflow publishes `sha-<merge>` and `:main`; the owner must point Runpod
  template arm0q8wpxq at `sha-<merge>` before the worker fixes apply. Then ONE rerun (the last allowed
  correction iteration) through the UI.
- Not fixed (class A, reading): bedroom 2 read 3.10x1.52 m and living 1.63 m deep (4 pieces unplaced),
  west closet missing, glazed living/balcony wall read as solid. Camera verified within ~0.5%.

## Meta Ads final product finish (2026-10-01)
- Meta Housing Special Ad Category is declared ONLY when a housing offer reaches US/territories,
  Canada (25 km floor) or Meta's European list (15 km floor) — Meta Business Help "About audiences
  for credit, employment or housing campaigns", checked 2026-10-01. Georgia-only property ads:
  ages/gender are the owner's choice (targeting.housingRule / declaredSpecialAdCategories; engine
  strategyInputFor uses the same function). Advertiser-based-in-US is not detected (no ad-account
  business country is stored) — documented limitation.
- Targeting intent now carries pins (custom_locations), languages (Meta locale keys from
  locale_search type=adlocale) and international intent (UI intent → places/languages the owner
  confirms). HOMATCH SVG map (Natural Earth outlines, lazy chunk) — no tile provider.
- Migration 20261003120000: meta_creatives.priority, meta_campaigns.owner_brief + brief_understanding.
  Priority creatives always included / first in buildPlan; part of the launch fingerprint.
- New meta-ads-api actions: locale_search, brief_interpret (LLM → closed vocabularies, cost_events,
  20/h), delivery_estimate (Meta MAU bounds only, 60/h). ai_copy: no invented numbers; TRANSLATE keeps
  every number.
- Builder: 10 steps (new "brief" before review); review = campaign story + expectations (room to
  learn, Meta estimate) + holistic consistency check with one-tap fixes + learning card.

## Meta Ads mobile simplification, real-signal learning, leads, domain guard (2026-10-01)
- Advertiser business country: assets refresh stores the ad account's Meta `business_country_code`
  in capabilities (ISO2 or null). housingRule/declaredSpecialAdCategories treat a US advertiser as
  restricted wherever the ad runs (supersedes the "not detected" limitation above). Unknown → only
  the places decide.
- Location model: places refine countries, nothing is replaced (masterLogic.addLocation);
  targeting.effectiveLocations drops a country that has places inside it; buildPlan runs the
  effective places; the builder shows one effective-geography line (geographyGroups).
- Domain guard (src/lib/metaAds/domainScope.ts, deterministic, no AI): ALLOWED / NEEDS_REVIEW /
  BLOCKED_OUT_OF_SCOPE. Runs in preflight (check `domain_scope`) and again at launch on the stored
  campaign (409 OUT_OF_SCOPE / IN_REVIEW). Evidence in meta_moderation_cases reason DOMAIN_SCOPE
  (findings: domain, domain_reason, signals, domain_fingerprint, source, checked_at); BLOCKED is
  auto-REJECTED, NEEDS_REVIEW opens a case a person decides; approval is per fingerprint. No migration.
- LEADS BLOCKER (production, read-only 2026-10-01): connection CONNECTED, the three Instant Form
  permissions absent, declined_scopes [] → the Facebook Login for Business configuration
  (config 970930962712211) does not request leads_retrieval / pages_manage_ads /
  pages_manage_metadata. Owner action in the Meta app dashboard: add them to that configuration
  (non-role users additionally need Advanced Access via App Review + Business Verification), then
  the customer reconnects. Customers see one action (reconnect, or "collect leads through messages");
  Admin shows the cause (instantForms.instantFormsCause: NOT_REQUESTED / DECLINED).
- Learning model: analysis.learningStage(launched, evidence) → NEW / COLLECTING / USING_SIGNALS,
  shown in the builder review and the campaign overview. Recommendations stay RECOMMEND-only.
- Mobile: the builder bar replaces the app bottom nav on phones (bottom-0, z-[60], safe-area);
  audience/creative/review fold their detail; ☆/★ priority; money nowrap. Browser gate at
  320/360/390/430/768/1440.
- Lead Ads Terms (2026-10-01): Meta's per-Page Lead Ads Terms are read from the Page field
  `leadgen_tos_accepted` (Page token) by assets_refresh and the new `forms_recheck` action, stored in
  the PAGE asset capabilities (leadgen_tos_accepted / _reason / _checked_at, leadgen_forms_readable).
  instantForms states: AVAILABLE (perms + Meta-confirmed terms) / TERMS_REQUIRED / PAGE_REQUIRED /
  RECONNECT / COMING_SOON / RECHECK (unknown, never assumed) / DISABLED. The owner accepts on Meta's
  own page (facebook.com/ads/leadgen/tos?page_id=…) opened in a separate window (opener cut; link
  fallback when popups are blocked); HOMATCH re-asks Meta on close/return — no message listener, no
  local "accepted" flag, nothing accepted for the user. Preflight check `lead_terms`.
  Production 2026-10-01: Page "Tbilisi Premium Apartments" has NO terms reading stored yet (never
  read before this release); the proven blocker remains PERMISSIONS (config does not request them).

## Graphify — local + private online architecture viewer (2026-10-01, PR #47)

- Local: Graphify 0.9.73 (`graphifyy[sql]`), official project skill, LLM-free
  wrapper `scripts/claude/graphify.mjs` (presets, traces, digest). Doc:
  `docs/claude/GRAPHIFY.md`.
- Online: `graphify-viewer/` = separate Vercel project `homatch-architecture`
  (`prj_oRMiFPyvDLKzugaO6fuWOLgoZauj`, Root Directory `graphify-viewer`,
  Vercel Authentication, no custom domain). Created by the owner 2026-10-02.
  Deploys c028ec49…beaa065c: first READY one built the customer app (Root
  Directory unset → repo-root vercel.json); the rest failed ("No Output
  Directory named 'public'") because build.mjs wrote <repo>/.vercel/output
  outside the Root Directory. Fixed: output inside graphify-viewer/. The
  Claude Vercel connector is scoped to the homatch project only: it cannot
  read or fetch homatch-architecture.
- Isolation: root vercel.json ignoreCommand skips homatch builds for commits
  that only change graphify-viewer/, docs/, tests/matrix/ or *.md (seven
  viewer-only commits had each redeployed homatch production). Proven: #52
  → homatch "Canceled by Ignored Build Step".
- Production (2026-10-02): #51 631e4630 → homatch-architecture
  dpl_9jS4qELRGJKGF3mgfLt8ChY2214P READY (first real viewer deploy); #52
  aeb330c1 → dpl_4mDDqRYXpgcZUsDF5LdXamzUymKU READY.
- SECURITY incident 2026-10-02: the bare homatch-architecture.vercel.app
  served the viewer (graph.json included) anonymously; closed by #52 (host
  allowlist → 404). OWNER: remove that domain from the project in the
  dashboard. Viewer URL: https://homatch-architecture-insportia.vercel.app
- Viewer features: live status polling, "What changed" per build (green
  new-node glow), smoother graph (edges hidden on drag/zoom).
- Graph of the merged architecture (main 9f4b1777 = #48 + #49, 2026-10-02):
  22,412 nodes; Design Studio preset includes the Runpod worker and the
  headless-Blender scene factory (infra/design-studio-gpu-worker); the
  Design Studio trace resolves all 13 factory stages; the Meta Leads trace
  includes #49's Lead Ads Terms flow and domain guard.
- Not a HOMATCH runtime dependency; merging #47 triggers only the routine
  customer Vercel rebuild of identical app code.

## Meta Ads closure (2026-10-02, branch claude/homatch-discovery-engine-rqdnza)

- **Lead Ads Terms root cause**: the production token still holds the 6 pre-reconfiguration
  scopes (no leads_retrieval / pages_manage_ads / pages_manage_metadata); the Meta reconnect
  started 2026-10-02 06:41 never completed (oauth_nonce still pending), so "refresh assets"
  re-read Meta with the OLD token. A `leadgen_tos_accepted=false` read with that token was
  shown as "terms not accepted". Now: `instantForms.ts` state model PERMISSIONS_MISSING /
  TERMS_REQUIRED / TERMS_UNKNOWN / FORM_ACCESS_UNAVAILABLE / PAGE_UNAVAILABLE / META_ERROR /
  READY; terms evidence = tos true | acceptance time | Page already has forms (ACCEPTED);
  a create refused for terms or false read WITH lead permissions (REQUIRED); else UNKNOWN.
  `engine.checkLeadPage` (page token, then /{page}/leadgen_forms) logs `meta_lead_check`.
  The owner must complete "Reconnect Meta" once for the new scopes to reach the token.
- **Audience**: no default locations anywhere (UI, brief, server strategy input). Multilingual
  geo search (`geoQuery.ts`: locale + Latin transliteration, street detection → pin).
  Map = targets only (`geo/mapTargets.ts`), always visible, numbered, real radius.
- **Lead Form Builder**: sections, phone preview (approximate), custom questions with
  sensitive-topic refusal, advertiser privacy URL (HOMATCH policy only flagged, never implied),
  readiness list, explicit confirm before Meta creation.
- **HOMATCH AI creatives**: `meta-ads-api/creativeAi.ts` + `src/lib/metaAds/creativeAi.ts`;
  table `meta_creative_ai_jobs`; product META_AD_IMAGE_GEN (13¢ retail / 9¢ reference,
  PER_UNIT, settled on measured gpt-image-1 tokens × provider_price_book, only delivered
  images; 0 delivered = release; stale RUNNING job > 8 min = release). Kill switch
  `admin_settings.meta_ads_ai_creative_enabled`. Analysis free to the customer, metered in
  cost_events (`meta_ads_creative_analysis`). Env overrides: OPENAI_META_IMAGE_MODEL,
  OPENAI_META_CREATIVE_MODEL (an unpriced image model refuses to run — PRICING_UNAVAILABLE).
- **Video**: player + cover (manual frame or deterministic `videoCover.ts`); cover is a
  separate still `${uid}/covers/*.jpg`; launch sends it as video_data.image_hash.
- **Fixed in passing**: meta_funnel_events check never allowed forms_recheck /
  brief_interpret / delivery_estimate, so those rate limiters never counted.
- Migrations: 20261006100000_meta_ads_creative_ai.sql, 20261006100100_meta_ads_creative_ai_pricing.sql.

## Meta Ads mobile UX + connect hardening (2026-10-02)

- Builder buttons use `builder/MetaButton.tsx` (grows with its label, min 44 px) instead of the
  fixed-height shared Button; review/confirm rows use `ui.SummaryRow` (label above, value full
  width, pencil Edit) + `keepWordsWhole` (short slash/hyphen tokens never split).
- Sticky bar height is measured (ResizeObserver → `--mm-nav-h`) and reserved exactly.
- Meta connect: `lib/metaAds/connectFlow.ts` state machine + `builder/useMetaConnect.ts`
  (one attempt per tab, same-tab navigation to Meta's official dialog, bfcache unlock, one
  shared post-callback refresh). The return path (draft + step + `from`) is validated by
  `oauth.safeReturnPath` and sealed in the HMAC state; meta-oauth re-validates it and redirects
  only to the configured HOMATCH origin. Cancel (`access_denied`) → `connect=denied`, nonce
  retired; replayed callbacks write nothing; the nonce claim is atomic.
- Native Facebook-app handoff: Meta documents app switch only for its native SDKs; a web app
  has no supported mechanism, so none is attempted (no URI schemes). Facebook's own dialog
  page decides any app routing.
- Migration 20261007100000_meta_creative_ai_jobs_grants.sql: authenticated has SELECT only.

## Meta Ads final acceptance (2026-10-02, branch claude/homatch-discovery-engine-rqdnza)

- **Readiness**: `src/lib/metaAds/readiness.ts` maps every preflight check / detail
  code → step → field; unknown codes are dropped (the check title still speaks),
  scope names collapse to one "reconnect and allow ad account access" line. Every
  row, "Left to fix: N" and the footer gap hint deep-link (`focusField.ts`).
- **Location**: one universal search (`geo_search` type `any`): CLDR country names
  in every script (no dictionary) + Meta regions/cities/districts, typed subtitles,
  chips; a street asks only its other comma parts and is flagged `nearest` + pin.
- **Connect**: `meta_ads_login_config_id` admin setting (seeded with 970930962712211,
  the SYSTEM-USER config that shows "share business assets"). A USER-access-token
  Login for Business config gives the standard consent with Page selection — it
  must be created in the Meta App Dashboard, then set here. Short-lived user
  tokens are exchanged server-side for long-lived; `expires_soon` asks to reconnect.
- **Intelligence**: `homatchIntelligence.ts` — opt-in (`meta_campaigns.intelligence`),
  hard constraints, evidence + cooldown + no-reversal. Suggest-only; APPLY stays the
  owner's. No automated Meta rules created (deferred: needs live spend to verify).
- **Lead Center**: `leadCenter.ts` + migration 20261008100100 (follow-ups, lost
  reason, won date, quality, contact_key, `meta_lead_events` timeline) + 20261008100200
  (Realtime publication). Drafts are copy-only, never sent.
- **Privacy**: HOMATCH's /privacy covers the platform only — never prefilled; the
  owner's own link from their previous HOMATCH form is reused with "Change".

## Phase 2 — Universal Discovery (branch ccr-76ef455d-0qvt80, 2026-10-02)

- Gap map, build list, operations and recovery: docs/claude/PHASE2_DISCOVERY.md.
- Owner decisions: DataForSEO/Apify stay RETIRED (native routes only); Hybrid
  worker (DB queue canonical; portal hops can route through
  homatch-official-worker; no DB credential on Railway); Find Property is
  PAYG like Find Buyers (FIND_PROPERTY priced like FIND_CLIENTS); Verify FROZEN.
- Production facts found (read-only): Telegram is the only live collector
  (541 posts, 356 listings, all discarded as not-demand until Phase 2); no
  external listing had ever reached a Find Property search (supply_matches
  could not store the shape); 32 supply observations / 1 entity.
- Migrations 20261009100000 (core) and 20261009100100 (admin intelligence):
  written, proven on a local fixture (tests/sql/run-phase2.sh), NOT applied.
- Every new switch defaults OFF; nothing changes for customers until an
  operator switches find_property_discovery_enabled /
  campaign_source_discovery_enabled on.


## Design Studio unified OpenAI-first rebuild (branch `feat/design-studio-unified`, 2026-10-03) — NOT merged, NOT deployed

Base: main `53489d04` (PR #68 live: design-studio-reconstruct v22). Scope: frontend + `design-studio-reconstruct` + ONE migration.

- **Photos are first class.** Launcher: two equal cards (Photos / Floor plan); `?start=photos` (and the old
  `?start=image`) open `unified/PhotoFlow.tsx`. Up to 6 photos → `design-studio-reconstruct/photos` (photos.ts):
  ONE OpenAI reading of all photos (`_shared/designStudio/photoRead.ts`: same room vs different rooms, fixed
  elements, ≤3 questions, unusable flag) → a `PHOTO_SET` spatial source + Original version (server-side) →
  Style → Quality → `designRun.ts` → the Result. Never ReconstructionFlow, catalogue, factory, Blender, RunPod
  or the 3D editor (a PHOTO_SET project always opens on `/home`).
- **Server-owned work** (`design-studio-reconstruct/durable.ts`): floorplan, photos and design-spec answer at
  once (202 RUNNING) and continue via `EdgeRuntime.waitUntil`; CAS claim on `updated_at`/job status; lease
  8 min then takeover; failures stored `RETRYABLE:<CODE>` / `TERMINAL:<CODE>`; only `retry: true` asks again.
  design-spec with `then: { quoteToken, versionName }` chains by itself: AI version (deterministic id
  `uuidFrom('ds-chain:<job>:version')`) → render (startGenerated, reserved once) → IMAGE/SCENE → `kick`
  render-generate-step for MAP. Clients send `durable: true`; a request WITHOUT it gets the old synchronous
  answer (rollout safety for open tabs).
- **Migration (prepared, tested on PGlite, NOT applied):** `20261010100000_design_studio_photo_set_source.sql`
  — adds `PHOTO_SET` to the kind check and its payload rule. The photos route cannot create its source until
  it is applied: **apply it before (or with) the edge deploy.**
- **Result** (`unified/DesignResult.tsx`) for photo projects and OpenAI-first plan projects: before/after,
  edit (render-edit, PR #65 pipeline untouched), another option / style / quality (VARIANT), other rooms
  (ROOM; photos: drawn over that room's own photo; "another style" allowed for photos). Legacy Result kept for
  earlier projects.
- **Snake**: `src/lib/games/snake.ts` + `src/components/games/SnakeGame.tsx` (lazy); watches status only.
- Copy: `scripts/design-studio-i18n-data-26.mjs` (`dsx_*`, owner-approved Georgian verbatim); data-25
  `sf_style_luxury` / `sf_style_warm_cozy` renamed (ids unchanged). CONTEMPORARY keeps its name; no
  Scandinavian id exists (not added).
- **Legacy map:** RETAINED — ReconstructionFlow (only "furnish from pictures" inside an existing floor-plan
  design), the legacy home Result (projects without OpenAI renders), factory/Blender (3D walkthrough, gated
  off). DISCONNECTED — launcher → ReconstructionFlow, NoSpacePanel → ReconstructionFlow, photos → editor.
  SAFE TO REMOVE LATER (not removed) — `UploadStep/UnderstandingStep/BuildingStep` (deleted already),
  `requestDesignSpec` (unused), old `sf_upload_*`/`sf_reading_*`/`sf_building_*` keys, `tests/browser/designStudio.qa.mjs`
  photo checkpoints (stale; still click `ds-start-image`).
- Not integrated: the global JobCenter (`background_jobs` is Verify-coupled shared infra). Status lives in
  the Design Studio library (`services/designStudio/status.ts`) instead.
- Production record `29423f13` (project `9a747384`) still READING with a RUNNING job — untouched; it is a
  legacy reconstruct row (the new routes never claim it); recover only with owner approval.
