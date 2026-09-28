# HOMATCH Claude engineering layer

Tooling and context for AI-assisted engineering on this repository. Nothing in
this directory changes product behavior; it exists so a session spends its
context on the task, not on rediscovering the repository.

## Start here, every session

```bash
npm run homatch:context     # one-screen snapshot: branch, deployed refs, diff domains, map freshness
```

Then, by task, read the smallest thing that answers the question:

| Question | Source |
|---|---|
| Where does a route/page live, who may open it | `docs/claude/generated/ROUTE_MAP.md` |
| How does an edge function deploy | `docs/claude/generated/EDGE_FUNCTIONS.md` |
| What migration created a table | `docs/claude/generated/DB_MIGRATIONS.md` |
| Where things live in general | `docs/claude/generated/REPO_MAP.md` |
| What is protected and why | `PROTECTED_SURFACES.md` |
| Per-surface design contracts | `UI_CONTRACTS.md` |
| Money rules | `BILLING.md` |
| Test tiers, harness env | `TESTING.md` |
| Current production/deferred state | `PROJECT_STATE.md` |
| Sharp edges | `KNOWN_RISKS.md` |
| System narrative | `../ARCHITECTURE.md` · `../DATABASE.md` · `../DEPLOYMENT.md` |

The generated maps carry a `head:` stamp; `homatch:context` reports when they
are stale. Regenerate with `npm run homatch:map` — never edit them by hand.

## Commands

| Command | What it does |
|---|---|
| `npm run homatch:context` | Session snapshot (git + filesystem only; no network) |
| `npm run homatch:scope` | Classify the current diff into HOMATCH domains + protected-surface warnings + Railway verdict |
| `npm run homatch:map` | Regenerate `generated/*` maps deterministically |
| `npm run homatch:test:affected` | Smallest meaningful test set for the diff (`--run` executes unit-level) |
| `npm run homatch:check` | Iteration gate: typecheck + i18n checks + affected unit tests |
| `npm run homatch:check:full` | Release truth: typecheck, lint, i18n:all, full unit run, browser matrix, studio, a11y |
| `npm run homatch:migrations` | Local migration hygiene (ordering, naming, transaction ownership). No production access |
| `npm run homatch:deploy:scope` | The repo's own deploy-scope analysis (owed edge functions for a diff) |
| `npm run homatch:security` | `npm audit --audit-level=high` |
| `npm run homatch:cbm` | Controlled codebase-memory-mcp install + confined index of this repo |

`homatch:test:affected` is for iteration only. Release readiness is decided by
`homatch:check:full` and the deploy pipeline's own gates, always.

## Repository intelligence (codebase-memory-mcp)

The generic layer — symbol search, call tracing, change impact — is
[codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) (MIT),
installed only via `npm run homatch:cbm`: vendored audited installer,
checksum-verified download, `--skip-config` (it never writes agent config,
hooks, or skills), watcher/auto-index/UI off, index confined to this repo via
`CBM_ALLOWED_ROOT`. The `.mcp.json` it writes is machine-specific and
gitignored. Containers here are ephemeral: rerun `homatch:cbm` in a fresh one.

**Fresh-container bootstrap — decision.** Claude Cloud's setup script lives
in the environment's settings (cloud environment menu → Edit → Setup script),
not in a repository file, so there is no repo-side mechanism that runs when a
fresh container is created — and this layer deliberately does not invent one
(no SessionStart auto-installer: it would run network installs for every
contributor on every session). The explicit command stays the workflow:
`npm run homatch:cbm` is idempotent (skips the download when the binary
exists, re-registers only a missing `.mcp.json`, reindexes), and a failure
leaves the repository untouched. To automate it for cloud sessions, add this
single line to the environment's Setup script yourself:

```bash
npm run homatch:cbm || true
```

What it is good at here (verified): BM25 symbol search (`search_graph`),
callers/callees (`trace_path --function-name X --direction inbound`), diff
impact (`detect_changes`), file outlines, read-only Cypher (`query_graph`).
What it is NOT: semantic_query ranks poorly on this codebase; SPA routes are
invisible to it (use ROUTE_MAP); 18 plpgsql migrations parse as unusable (use
DB_MIGRATIONS + the SQL itself); in-degree-0 is not proof of dead code. The
index is never proof of production state.

## Decisions this layer made (so you don't re-litigate them)

- **No Claude hooks.** Map freshness is a `homatch:context` check, not a hook;
  CBM's own hook suite (Grep/Glob/Bash interception) was deliberately not
  installed.
- **No knip / dependency-cruiser / jscpd / eslint added.** The Deno/jsr URL
  imports under `supabase/functions/` produce false-positive storms in all of
  them; `importClosure` in `scripts/deploy-scope.mjs`, the runtime-neutrality
  seam tests, and the `tests/matrix/` guards already cover the real needs, and
  the lockfile stays untouched.
- **Migration hygiene grandfathers frozen history** (see the LEGACY list in
  `scripts/claude/migrations-check.mjs`): applied migrations are facts;
  new violations still fail.
- **CBM watcher off.** One session per ephemeral container; explicit
  `homatch:cbm` reindex beats a background daemon that can go stale across
  worktrees.
