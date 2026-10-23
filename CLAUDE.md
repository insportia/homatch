# HOMATCH — Claude constitution

HOMATCH (homatch.live) is a Georgian real-estate intelligence product:
property owners, buyers/tenants, brokers, and an AI research/verification
layer, in six languages (KA/EN/RU/AR/HE/TR; AR/HE are RTL). React+Vite SPA,
Supabase (Postgres 17 + RLS + Deno edge functions), Vercel frontend, one
Railway worker for AI TALK.

## Session start

Run `npm run homatch:context`. Then read only what the task needs — the map
below replaces exploratory file reading. Investigate before editing or
answering; never assume a feature is missing because a grep came back empty.

| Need | Read |
|---|---|
| Orientation, where things live | `docs/claude/generated/REPO_MAP.md` |
| Routes and access | `docs/claude/generated/ROUTE_MAP.md` |
| Edge functions and deploy modes | `docs/claude/generated/EDGE_FUNCTIONS.md` |
| Schema history | `docs/claude/generated/DB_MIGRATIONS.md` |
| Protected surfaces / design contracts | `docs/claude/PROTECTED_SURFACES.md` · `UI_CONTRACTS.md` |
| Money | `docs/claude/BILLING.md` |
| Tests and gates | `docs/claude/TESTING.md` |
| Release tiers (FAST / TARGETED / COMPONENT_FULL / REPO_FULL), routine-operation permissions | `docs/claude/RELEASE.md` |
| Production/deferred state | `docs/claude/PROJECT_STATE.md` |
| Sharp edges | `docs/claude/KNOWN_RISKS.md` |
| Code graph (Graphify): pre-flight, views, limits, private online viewer | `docs/claude/GRAPHIFY.md` |
| Deep narrative | `docs/ARCHITECTURE.md` · `docs/DATABASE.md` · `docs/DEPLOYMENT.md` |

For symbol relationships, call paths, and change impact, prefer the
codebase-memory MCP (`search_graph`, `trace_path`, `detect_changes`) —
set up via `npm run homatch:cbm`; then exact `rg` and the smallest relevant
source range. Semantic search and SPA-route questions: use the maps instead.
An index is never proof of production state.

## Non-negotiable rules

- **Billing is per service** (owner, 2026-10-22). 10 credits = $1. Each service
  has its own model; PAYG unless the owner sets another. Email Marketing is the
  one plan service: Free 50 lifetime, Pro $50/mo 50k, Scale $220/mo 100k,
  overage $2.20/1k only with explicit consent, wallet-paid, opt-in renewal
  (`email_marketing_37_63_vat_v1`). Never gate other services by plan; the
  dormant billing-v2 plan machinery stays unwired.
  Reserve → settle → release; unknown COGS never silently zero.
  Customer prices are final and VAT-inclusive (18%): extract VAT, never add it.
  Paid discovery (Find Buyers/Tenants and Find Property paid campaigns started
  since Finance V2, `paid_discovery_37_63_vat_v2`): VAT first, then HOMATCH 37% /
  execution 63% of the VAT-exclusive revenue (execution = P × 6300/11800);
  charge = spend × 11800/6300, capped at the reservation. v1 campaigns
  (2026-10-16, 37/63 of gross, ÷0.63) keep their terms —
  `src/research-core/billing/paidDiscoveryPolicy.ts` (docs/claude/BILLING.md).
- **Protected surfaces**: Verify, the black/gold public homepage identity
  (incl. AI TALK), the single Admin shell, Owner dark navy, dark Discovery.
  Functional/a11y/RTL fixes yes; redesigns only on explicit instruction.
- **Terminology**: match = დამთხვევა (never შესატყვისი); tenant = მოიჯარე;
  თბილისი; never "confirmed buyer" — "potentially interested person".
- **Internal vs external**: never fabricate a HOMATCH user from an external
  lead; native messaging uses canonical conversations; telemetry ≠ intent.
- **Property**: six-digit permanent server-generated IDs; contact phone is
  private — required ≠ public; no public/indexable/client-trusted exposure.
- **Retired providers**: DATAFORSEO — locked off, history preserved, never
  reactivated. APIFY was restored by the owner (2026-10-04) ONLY for Find
  Buyers/Tenants memo23 Actors (`APIFY_MEMO23`), only via
  `_shared/findBuyers/memo23Client.ts`; Admin → Providers' APIFY switch
  (`provider_disabled_list`) stops every memo23 run. Generic Apify execution
  stays deleted; Actors stay governed by their registry lifecycle.
  Second scope (owner, 2026-10-09): Verify's Developer Advertising stage may
  run ONE memo23 Ad Library Actor through the same client
  (`advanceDeveloperAds` in research-agent), with its own setting
  `verify_developer_ads` (Admin switch), budget and `DEVELOPER_ADS_VERIFY` cost
  rows — separate from Find Buyers orchestration, and stopped by the same
  APIFY switch. No other Verify use of Apify.
  Third scope (owner, 2026-10-16; TikTok and batched runs 2026-10-18): Find
  Property's paid social OFFER campaign (Facebook / Instagram / Telegram /
  TikTok / VK posts offering a property, for one buyer's or tenant's confirmed
  search) runs a few BATCHED memo23 Actor runs through the same client
  (`_shared/findProperty/socialOffers.ts`), with its own switch
  `find_property_social_enabled` (default OFF), reserved per run against the
  campaign's 63% provider budget (`find_property_reserve_actor_run`), and is
  stopped by the same APIFY switch. Portals and HOMATCH inventory stay free.
  Fourth scope (owner, 2026-10-18): ONE non-memo23 Actor,
  `tropical_thunderstuck~facebook-post-search` (Find Buyers `FB_KEYWORD_SEARCH`:
  buyer/tenant phrases across public Facebook posts), admitted by exact id in
  `ALLOWED_THIRD_PARTY_ACTORS` (memo23Client) — never a pattern or a publisher.
  Same client, registry, reservation, caps and APIFY switch; it never runs on an
  unverified input schema.
- **Railway**: the only worker is `homatch-official-worker`
  (`3e7f132b-d0be-4804-9bc0-0b6ad368ad15`). Never `-v2`, never create
  another. Railway deploys only when `official-worker/` changed —
  `npm run homatch:scope` prints the verdict.
- **Identifiers**: Supabase `ptxajsjhobhvsfhmutjn`; Vercel project
  `prj_oQDQ3HV4N9AiPwzfFGlRyEjXhlib`. Never create new projects/services.
- **Migrations**: append-only; the runner owns the transaction; pushing to
  main does NOT apply them. `npm run homatch:migrations` before review.
- **Deployment truth**: refs/deployed/* + exact artifact proof
  (PROVEN_EXACT). A green CLI or green step is not proof.
  `impersonate-user` / `unlock-external-contact` are hand-deploy-only.
- **Secrets**: never in CLAUDE.md, docs, commits, or generated files.

## Working discipline

- **Graphify pre-flight**: for significant/cross-cutting tasks, refresh and
  query the local graph (`node scripts/claude/graphify.mjs`; never bare
  `graphify` LLM paths), then read the source at every `file:line` it names.
  The graph is a map, never proof: report EXTRACTED vs INFERRED separately,
  and graphing a subsystem grants no permission to change it.
- **Diff awareness**: `npm run homatch:scope` classifies your diff into
  domains and prints the protected-surface warnings that apply. Run it
  before proposing review.
- **Tests**: iterate with `npm run homatch:check`; release truth is the PR's
  validation run (`npm run homatch:release:plan` shows its tier, components,
  suites and owed proofs; `npm run homatch:check:full` is diagnosis only). Matrix tests
  parse sources — when reality legitimately changed, fix the premise, don't
  weaken the assertion.
- **Fast release** (`docs/claude/RELEASE.md`): HOMATCH releases must use the
  fastest safe path. Never rerun unrelated repository-wide validation merely
  because a change touches a migration, Edge Function or workflow. Determine
  the affected dependency closure (`scripts/release/components.mjs` + the
  import graph, edge closure and migration objects). Validate that closure
  completely. Reuse trustworthy validation evidence. After merge, if content
  equivalence is proven, promote the validated code without rerunning its PR
  suites. Deploy only affected infrastructure. Production proof remains
  mandatory. Escalate to repository-wide validation only for genuinely global
  or unknown impact. New code area or suite → add it to `components.mjs` in
  the same PR (an unplaced path plans REPO_FULL).
- **Routine operations**: the owner pre-authorized routine non-destructive
  development and release operations (git, PRs, merging after green checks,
  tests/builds, read-only production inspection, reviewed migrations in
  release order, owed edge deploys, production proof). `.claude/settings.json`
  encodes this; its SQL hook allows only read-only SQL and migrations already
  on main. Do not ask again for what it allows; destructive, spending,
  secret-touching or security-weakening actions still need explicit
  confirmation. Never poll for a merge you cannot perform — report
  READY_FOR_EXTERNAL_MERGE and stop.
- **i18n**: single bundle `src/i18n/translations.ts`; extend via the
  idempotent apply-script pattern; placeholders `{{var}}` survive all six
  locales; AR/HE flip direction.
- **Token discipline**: read the generated maps, not directories; query CBM
  or `rg` before opening files; read the smallest range that answers the
  question; don't re-read large files you've already seen.
- **Production queries**: batch READ-ONLY SQL; separate reads from writes;
  query production only when live state actually matters.
- **Subagents**: give them file paths and the relevant doc pointer, not
  pasted file bodies; worktrees live OUTSIDE the repo (`.claude/worktrees`
  is gitignored history — don't nest new ones in-tree).
- **Long sessions**: keep durable state in `docs/claude/PROJECT_STATE.md`
  and commit it; context can be compacted at any time.
- **Temp files**: scratch work goes in the session scratchpad, never the
  repo; nothing under `docs/claude/generated/` is hand-edited.
