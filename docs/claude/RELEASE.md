# RELEASE — the HOMATCH Fast Release Rule

Validate once, with full strength, where the change is proposed. Promote the
exact validated code. Prove it in production. Never re-run a repository-wide
gate over code whose identity is already proven to have passed it — and never
skip one when that proof is missing.

```
change → targeted local checks → PR → validation ONCE (parallel, recorded)
       → merge → provenance proof → deploy owed components → production proof
```

Implementation: `scripts/release/` (classifier, plan, record, provenance,
mobile shards), `.github/workflows/pr-check.yml`, the Validate job of
`.github/workflows/deploy.yml`. Guarded by `tests/matrix/releasePath.test.mjs`.

## The three levels

| Level | When | What runs |
|---|---|---|
| **FULL** | dependencies / lockfile / toolchain; `.github/`; build system (vite, tsconfig, biome, tailwind, index.html, `.env.harness`); release, test and deploy machinery (`scripts/release/`, `run-tests`, `lint.sh`, `deploy-scope`, `edgeArtifacts`, `.rules/`); app shell (`main`/`App`/`routes`), `src/contexts`, `src/db`, `src/hooks`, shared UI primitives, global CSS, i18n runtime; `supabase/functions/_shared/`; any path naming auth / RLS / grant / permission / security / secret / credential / vault / impersonation; a migration that creates/alters policies, grants, RLS, `security definer` or reads `auth.*()`; the Railway worker; **any path no rule can place**; an empty or uncomputable change set | every suite |
| **TARGETED** | every changed path belongs to a known, isolated area | `static` + `unit` always, plus only the browser suites those areas can affect |
| **FAST** (post-merge only) | the deployed commit's git **tree** equals the tree a successful `PR Checks` run recorded, that run covered every suite the change requires, and the change does not touch the release machinery | no repository suites re-run; deployment checks + production proof still run |

Areas (TARGETED): Meta Ads → mobile, a11y · Developer / Design Studio →
mobile, developer, onboarding, floorplan · Site Studio → mobile, studio ·
push / PWA → mobile, push, a11y · `translations.ts` → mobile, a11y · a browser
suite's own files → that suite · edge functions (not `_shared`), plain
migrations, docs, tooling scripts, unit/matrix tests → static + unit only.
`static` = type-check (`tsconfig.check.json`), lint (tsgo, biome, ast-grep
rules, Tailwind, i18n:all), edge syntax, migration history, production build.
`unit` = `pnpm test` (the whole regression suite, ~45 s — always run).

Escalation is automatic and one-way: one FULL path makes the whole change
FULL. There is no "skip tests" input anywhere.

## Validated-code identity

The PR run records `validatedTree = git rev-parse HEAD^{tree}` of the commit it
tested (GitHub's merge of the PR into main) in the `validation-record`
artifact — uploaded by the `Validate PR` job only after every planned suite
passed.

After merge, `scripts/release/provenance.mjs` (first step of deploy
Validate):

1. tree id of the commit being deployed;
2. the merged pull request whose `merge_commit_sha` is that commit — not a
   branch name;
3. the newest **successful** `pull_request` run of `pr-check.yml` for that
   PR's final head commit, from the Actions API;
4. that run's `validation-record` artifact;
5. `promotionDecision()`.

A tree id is the hash of every file's bytes, so equal trees mean identical
code, whatever commit id a squash merge produces. If main moved between
validation and merge, the trees differ and the deploy runs the full gate.
The record can only be produced by the workflow run itself; nothing a person
hand-edits is trusted.

A change to `.github/` or `scripts/release/` is never FAST after merge: the
machinery that would skip validation cannot certify its own change.

## What runs where

| Check | PR (before) | Post-merge (before) | PR (now) | Post-merge FAST (now) | Post-merge FULL (now) |
|---|---|---|---|---|---|
| Type-check | `tsc --noEmit` on root — compiles **nothing** | `tsconfig.check.json` | `tsconfig.check.json` (static) | — | ✓ |
| Lint (tsgo, biome, ast-grep, Tailwind, i18n) | ✓ but **no ast-grep binary**: rules silently not enforced | ✓ | ✓ with ast-grep (static) | — | ✓ |
| Unit + matrix (`pnpm test`) | ✓ | ✓ (repeat) | ✓ always | — | ✓ |
| Harness build | ✓ | ✓ (repeat) | per browser job | — | ✓ |
| Mobile regression (~10 min) | ✓ | ✓ (repeat) | 2 parallel shards, if planned | — | ✓ |
| Developer / onboarding / floorplan | ✓ | **missing** | if planned | — | ✓ (added) |
| Site Studio (~4 min) | ✓ | ✓ (repeat) | parallel job, if planned | — | ✓ |
| Web push | **missing** | ✓ | if planned | — | ✓ |
| a11y + language chunks | **missing** | ✓ | if planned | — | ✓ |
| Edge syntax | ✓ | ✓ | ✓ (static) | **✓ always** | ✓ |
| Migration history audit | — | migrate job only | ✓ (static) | **✓ always** | ✓ |
| Production build | ✓ | ✓ (build-frontend) | ✓ (static) | **✓ build-frontend** | ✓ |
| Edge deploy of owed functions only | — | ✓ | — | **✓** | ✓ |
| Artifact proof (PROVEN_EXACT) + ref advance | — | ✓ | — | **✓** | ✓ |
| Frontend | Vercel preview | Vercel production (independent of CI) | same | same | same |

Before this rule neither stage ran the complete gate: the PR lacked push,
a11y, the real type-check and the ast-grep rules; the deploy lacked the
Developer journeys. Both full gates are now the same set
(`releasePath.test.mjs` proves it).

## Measured (2026-09-30, the Meta Ads release)

- PR validation, run 36766810516 — one sequential job, **19 m 36 s**: lint
  1 m 12 s · tests 42 s · harness 11 s · **mobile 10 m 0 s** · developer 56 s
  · onboarding 1 m 19 s · floorplan 30 s · **studio 4 m 5 s** · edge 12 s ·
  build 10 s.
- Post-merge deploy #860 (run 36769104862) — Validate **17 m 42 s**
  (19:56:12–20:13:54; the same suites again, minus the Developer journeys,
  plus push 5 s and a11y 26 s) → edge deploy + proof **55 s** → edge proven
  18 m 40 s after the merge. Frontend: Vercel production at the merge commit
  within ~1 minute, independently of the workflow.
- Duplicated: ~17 min of the post-merge 18 m 49 s re-ran suites that had just
  passed on the same code.

## Expected after the change (projected from the measured steps)

- PR: critical path = the slowest parallel job instead of the sum, about
  6–8 min (mobile shards each ~half of 10 min plus setup; studio ~5 min;
  static ~3 min). A TARGETED change skips unaffected browser jobs; an
  edge-only or docs-only change needs ~3 min.
- Post-merge FAST: Validate ~1 min (provenance, install, edge syntax,
  migration audit) → edge deploy + proof ~1 min → **edge proven ~2–3 min after
  merge** (was ~18–19 min).
- Post-merge FULL (no provenance): as before plus ~3 min for the Developer
  journeys now added for parity.

These are projections; the first FAST deploy is the measurement. The PR that
introduces this rule is itself FULL at both stages (it changes the
machinery), so the first FAST promotion is the next ordinary merge.

## Migrations

Unchanged by FAST: append-only; the migration-history audit runs on every
path; production application stays a deliberate act (`run_migrations`
dispatch or the reviewed MCP apply). Decide per migration: **before deploy**
(new tables/columns the code reads), **after deploy** (anything that calls
or schedules new code — cron jobs), **activation-only after production proof**
(switches, schedules). Record the order in the PR.

## Production proof — never weaker

FAST removes repeated *repository* checks only. Still required, by CI or by
the release owner:

- Edge: owed set only; PROVEN_EXACT per function; a stale or skipped function
  gets a single-function redeploy (`workflow_dispatch redeploy=<fn>`), then is
  proven again.
- Frontend: Vercel deployment READY at the merge commit and aliased to
  `www.homatch.live`; served entry asset belongs to it.
- Database: expected migrations present in the ledger.
- Cron/background: real execution evidence (`cron.job_run_details`,
  `net._http_response`) when changed.

Nothing is PRODUCTION-PROVEN from CI alone.

## Local commands

- `npm run homatch:release:plan` — what the PR will run, with every reason
  (includes uncommitted work).
- `npm run homatch:check` — targeted iteration.
- `npm run homatch:check:full` — the full gate locally; for diagnosis, not a
  second required gate: the PR run is the one full validation.
