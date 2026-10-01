# RELEASE — the HOMATCH Fast Release Rule

> HOMATCH releases must use the fastest safe path.
> Never rerun unrelated repository-wide validation merely because a change
> touches a migration, Edge Function or workflow.
> Determine the affected dependency closure. Validate that closure completely.
> Reuse trustworthy validation evidence. After merge, if content equivalence is
> proven, promote the validated code without rerunning its PR suites.
> Deploy only affected infrastructure. Production proof remains mandatory.
> Escalate to repository-wide validation only for genuinely global or unknown
> impact.

```
change → plan (components + dependency closure) → PR validation ONCE
       (parallel jobs, recorded by git tree) → merge → provenance proof
       → FAST: deploy prerequisites → owed deploy → production proof
       → no proof: the same plan, same parallel jobs → deploy → proof
```

Implementation: `scripts/release/` — `components.mjs` (the component table and
suite catalogue), `graph.mjs` (frontend/test import graph), `classify.mjs`
(tiers, promotion), `context.mjs`, `plan.mjs`, `run-suite.mjs`, `record.mjs`,
`provenance.mjs`; `.github/workflows/pr-check.yml` (also `workflow_call`ed by
the deploy) and the provenance / validate / prerequisites jobs of
`deploy.yml`. Guarded by `tests/matrix/releasePath.test.mjs`.

## Components

Ownership is the first matching rule in `components.mjs`. Dependencies are
**computed**, not hand-written:

| Change | How its reach is computed |
|---|---|
| `src/**`, `tests/**` helpers | the import graph, walked upward to every file that imports it. A static import by the app shell (`CORE_SHARED`) means every screen → REPO_FULL; a lazy route import does not. |
| `supabase/functions/<fn>/**` | that function's owner; deploy owes that function only |
| `supabase/functions/_shared/**` | the functions whose import closure holds it (`deploy-scope.mjs`) → their owners. > 2 components, or an auth / cors / jwt primitive → REPO_FULL |
| `supabase/migrations/*.sql` | the objects it creates / alters / drops / grants on / writes (function bodies excluded) → owners by name (`ds_`, `meta_`, `storage_`, `site_`, `dt_` …). A global object (`users`, `is_admin`, `auth.*`, `storage.objects`, default privileges) → REPO_FULL; access-control SQL on unowned objects → REPO_FULL |
| `src/i18n/translations.ts` | the changed keys' prefixes (`ds_`, `mm_`/`mads_`/`madsb_`, `studio_` …). Any other key or a structural edit → every mobile shard + a11y |
| a browser suite's own file | that suite |

| Component | Owns (summary) | Suites when its UI or security changes |
|---|---|---|
| RELEASE_ENGINE (repo) | `pr-check.yml`, `deploy.yml`, `scripts/release/`, deploy-scope, edge/migration audits | all |
| TOOLCHAIN (repo) | dependencies, build config, lint rules, test runners, unowned workflows | all |
| CORE_SHARED (repo) | `main`/`App`/`routes`, contexts, db, hooks, ui/layouts/common, i18n runtime | all |
| AUTH_SECURITY ★ | auth pages, impersonation, auth edge functions | mobile:auth, mobile:routes, mobile:shell |
| BILLING ★ | credits / billing / payment code and functions | mobile:routes, mobile:shell |
| STORAGE ★ | storage-* functions, `storage_*` objects | — (proof: storage-selftest) |
| DESIGN_STUDIO | designStudio code, share viewer, `design-studio-*` functions and workflows, `ds_*` | — (no gated browser suite visits it; see gaps) |
| DEVELOPER | developer / floorplan code, `developer-*` functions, `dt_*` | developer, onboarding, floorplan, mobile:routes |
| META_ADS | metaAds code, `meta-*` functions, `meta_*` | mobile:meta-ads |
| SITE_STUDIO | Site Studio, App Content, `src/site`, `site_*` | studio:editor, studio:content, mobile:routes, a11y |
| DISCOVERY | matching / discovery code and functions | mobile:discovery, mobile:routes |
| PWA_PUSH | service worker, push, notifications | push, a11y, mobile:shell |
| VERIFY, MORTGAGE, EXPATS, BROKER | their pages / functions | their mobile shard (+ mobile:routes) |
| PUBLIC_HOMEPAGE, ADMIN, PRODUCT | public pages, admin, other customer surfaces | route sweeps, shell, a11y / tasks |
| RAILWAY | `official-worker/` | worker |
| EDGE, DATABASE, TOOLING, TESTS, I18N | backend-only, docs, tests, translations | none beyond static + unit |

★ security components: every change is COMPONENT_FULL.

## The tiers

| Tier | When | What runs |
|---|---|---|
| **REPO_FULL** | toolchain / dependencies; the release engine; the app shell or anything statically reaching it; a global auth / RLS primitive; shared edge code reaching > 2 components; a path no rule places; an unreadable migration; no dependency graph; an uncomputable change set; the base branch's engine says so | every suite (static, unit, all 15 browser shards, worker) |
| **COMPONENT_FULL** | a security-relevant change inside known components: access-control SQL on their objects, an auth / secret / policy path, shared edge code, the component's own workflow, any AUTH / BILLING / STORAGE change | static + unit (every unit, matrix and security source test) + the complete suite set of each affected component |
| **TARGETED** | every path is placed and reaches no security surface | static + unit + the suites of the components the change reaches. Backend-only changes (edge function, plain migration, script) add **no** browser suite: every browser suite stubs the network and cannot observe them |
| **FAST** (post-merge) | deployed tree == a tree a successful `PR Checks` run recorded, that run covered every suite the merged change requires, and the release engine did not change | **no validation job**; deploy prerequisites, the owed deploy and production proof only |

`static` (type-check `tsconfig.check.json`, lint incl. ast-grep rules and
i18n:all, edge syntax, migration history, production build) and `unit`
(`pnpm test`, ~45 s, every matrix and security test) always run: they are
cheap and the critical path is a browser shard anyway.

## Suites (one parallel job each)

`mobile:routes` (routeOverflow, routeHealth, textContrast, formControls) ·
`mobile:shell` (shellAndMotion, appShell, chatComposer) · `mobile:auth`
(authScreens — the slowest file, ~5.4 min) · `mobile:verify` ·
`mobile:meta-ads` · `mobile:mortgage` · `mobile:expats` · `mobile:discovery` ·
`mobile:broker` · `mobile:tasks` · `developer` · `onboarding` · `floorplan` ·
`studio:editor` · `studio:content` · `push` · `a11y` · `worker`.

The mobile shards are exactly `test:mobile`, the studio shards exactly
`test:studio`, every script suite exactly its `package.json` script, and every
browser test file is gated somewhere or declared manual — proven by test 13.
Each browser job builds its own harness; none reads a stale `dist/`.

## Validated-code identity and promotion

The PR's `Validate PR` job — green only if every planned job passed — writes
the `validation-record` artifact (version 2): `validatedTree`
(`HEAD^{tree}` of the tested merge commit), tier, components, suites,
`engineTree`, PR number / head / base, run id.

After merge `provenance.mjs`: deployed commit's tree → the merged PR by
`merge_commit_sha` (never a branch name) → its newest **successful**
`pull_request` run of `pr-check.yml` → that run's record →
`promotionDecision()`: same tree, record v2, known tier and suites, suites ⊇
what the merged change requires, release engine untouched → `FAST`. Anything
else → `VALIDATE`: deploy.yml calls `pr-check.yml` for the merged commit's own
change (planned against its parent) — the same component plan and parallel
jobs, not a serial repository gate — and deploys only after it is green.

A squash merge keeps the tree, so it promotes. If main moved under the PR the
trees differ and the change is validated again. A v1 record (pre-component
engine) is not trusted.

**Self-certification.** (1) Post-merge, a change to the release engine is
never FAST. (2) In the PR, the plan is computed by the PR's engine **and** by
the base branch's engine (`git archive` of the merge base); the stricter
answer wins, and a base engine that cannot run makes it REPO_FULL. An engine
change therefore cannot plan itself less validation.

## Deployment targeting

- Edge: `deploy-scope.mjs` diffs `refs/deployed/edge` → HEAD and deploys only
  the functions whose import closure changed; each is proven PROVEN_EXACT
  against the production artifact before the ref advances. Already-current
  functions are never redeployed.
- Frontend: Vercel's Git integration; CI builds the exact tree and advances
  `refs/deployed/frontend`.
- Migrations: never applied by merging. `run_migrations` dispatch or the
  reviewed MCP apply, in the order the PR records (before deploy / after
  deploy / activation after proof).
- Railway: only when `official-worker/` changed (`npm run homatch:scope`).

## Production proof — never weaker

The plan lists the proof each change owes (`proof owed:` lines): PROVEN_EXACT
for the owed functions; Vercel READY at the merge commit and aliased to
`www.homatch.live`; migrations present in the ledger; RLS / grants verified on
the objects a security migration touched; `cron.job_run_details` for a
schedule; `storage-selftest` for storage. Nothing is PRODUCTION-PROVEN from CI alone.

## Routine operations (owner-authorized)

Project permissions live in `.claude/settings.json` (shared, checked in):

- **No prompt:** git read/branch/commit/push/merge/rebase; npm / pnpm / node
  scripts, tests, lint, type-check, builds; Supabase CLI function deploy and
  inspection; `gh` PR / run inspection, PR create / merge; Vercel inspect /
  logs / deploy; Railway status / logs; GitHub / Supabase / Vercel / Railway MCP read tools;
  GitHub PR / branch / merge tools; Supabase `deploy_edge_function`.
- **SQL** (`.claude/hooks/sql-guard.mjs`, a PreToolUse hook): provably
  read-only SQL on the HOMATCH project is allowed; applying a migration is
  allowed only when its SQL is byte-identical to a file already on
  `origin/main`. Everything else asks.
- **Always asks:** `curl` (a URL glob is a prefix match — it would also match
  look-alike hosts and extra arguments; health checks use WebFetch / MCP reads),
  `sudo`, `rm -rf`, force push, push to main, `reset --hard`, `git clean`,
  `supabase db push`, secrets / env changes, Railway deploy / restart /
  variables, `gh api`, Supabase branches / restore, token readers.
- **Denied:** creating / pausing / deleting projects or services, purchases,
  `supabase db reset`, creating or forking repositories.

## Local commands

- `npm run homatch:release:plan` — tier, components, suites, deploy targets
  and owed proofs, with every reason (includes uncommitted work).
- `node scripts/release/run-suite.mjs <suite>` after `npm run build:harness`
  — one shard, exactly as CI runs it.
- `npm run homatch:check` — targeted iteration; `npm run homatch:check:full`
  — diagnosis only, never a second required gate.

## Watching and merging

Do not poll. PR / CI events arrive by subscription. With write access and
authorization, merge once `Validate PR` is green; without it, report
READY_FOR_EXTERNAL_MERGE and stop. Unavoidable external polling uses backoff
and stops when the owner must act.

## Measurements

Baseline (before the component engine):

- PR run 36816875975 (PR #24, FULL, parallel since #26): 5 m 56 s; critical
  path the mobile shards (5 m 20 s / 5 m 28 s; authScreens alone 5 m 22 s)
  and Site Studio (4 m 40 s).
- Deploy #861 (run 36813098669, the #26 merge — FULL because the engine
  changed): Validate 19 m 42 s serial (mobile 9 m 30 s, studio 4 m 1 s,
  journeys 3 m 14 s, lint 1 m 13 s) → edge NO_WORK 20 s → 20 m 30 s total.
- Deploy #860 (Meta Ads): Validate 17 m 42 s + edge 55 s.

Results after: see `PROJECT_STATE.md` (measured from the real runs of the
PR that introduced this engine and the first merges after it).

## Case study — PR #24 (Design Studio catalogue infrastructure)

29 files: a component workflow, two Design Studio scripts, Design Studio
frontend and unit tests, `_shared/storage/keys.ts`, the `design-studio-model`
function and a migration that adds `ds_catalog_*` tables / policies and
**redefines `public.storage_authorize()`** (the storage authorization used by
every product's storage namespace).

**Old engine: FULL** — every suite (mobile ×2 shards, developer, onboarding,
floorplan, studio, push, a11y). Triggers: `.github/` (any workflow),
`scripts/design-studio/catalog-import.mjs` (no rule), `rls-check.mjs` ("rls"
in the path), `_shared/` (any shared edge file) and policy SQL — keywords, not
dependencies. After merge, `.github/` also made it un-promotable: the deploy
would have re-run the 19–20 min serial gate.

**New engine: COMPONENT_FULL — DESIGN_STUDIO + STORAGE.** The workflow,
scripts, frontend and function are Design Studio (the import graph shows no
importer outside it; the shell only imports `designStudio/access.ts`, which
#24 does not touch). `keys.ts` is imported by `design-studio-model`,
`design-studio-reconstruct` and the four `storage-*` functions → DESIGN_STUDIO
+ STORAGE. The migration defines `ds_*` objects and `storage_authorize` →
same two components, access-control SQL → COMPONENT_FULL.

Runs: `static` (type-check, lint, ast-grep, i18n, edge syntax, migration
audit, build) + `unit` (every unit / matrix / security test, including
`catalogPolicy`, `keys`, the catalogue suites and `designStudio.test.mjs`).
No Meta Ads, Site Studio, Developer-journey, push, a11y or mobile suite: none
of them can observe this change (they stub storage and never visit Design
Studio). Owed after deploy: PROVEN_EXACT for the six functions, the migration
in the ledger, RLS / grants on `ds_catalog_*` and `storage_authorize`
verified in production, `storage-selftest` PASS, Vercel READY.

## Known gaps (explicit, not hidden)

- No gated browser suite visits Design Studio; `tests/browser/designStudio.qa.mjs`
  needs a `VITE_FEATURE_DESIGN_STUDIO=on` harness and is manual.
- `tests/mobile/heroMobile.test.mjs`, `test:pwa` and `test:surfaces` are manual
  suites (declared in `components.mjs` TESTS).
- `tsconfig.check.json` excludes `src/components/ui` (generated primitives).
