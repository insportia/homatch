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

- **PAYG only.** 10 credits = $1. No Free/Premium/VIP gating, ever.
  Reserve → settle → release; unknown COGS never silently zero.
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
