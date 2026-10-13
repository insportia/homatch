# Publishing Center continuation checkpoint

PR https://github.com/insportia/homatch/pull/204 — keep **draft; do not merge/deploy**.
Branch `feat/property-publishing-foundations`. Original commit `1edbffdaf6ea071197dc50d8e6527f4215bb8cc9` preserved. Work remains incomplete; **zero live portal integrations** claimed.

## Latest preservation and CI

- Continuation pushed and branch ref verified at `6dd6feacef0caac5be8d0a0cb10f6a6d34ddc795`. PR remains draft. Comparison: 58 changed files, zero protected-system paths; remote translations preserved with 408 additions and zero deletions. Shared routes/admin/release changes replayed onto newer remote content.
- [Publishing Center checks run 38379391816](https://github.com/insportia/homatch/actions/runs/38379391816) **passed**, including unit tests, isolated CPU Docker build, disposable Postgres/RLS and parallel claims, UI fixture build and browser/visual checks. Repository-wide PR Checks still require final result review.
- MCP local-only `about:blank` probe also fails closed-target. Browser debug classifications show launch succeeded, no missing executable or explicit permission denial. This happens before any external website request; do not attribute it to portal restrictions. Native tools remain absent. No repeated external retries performed.
- Repository CI exposed three publishing regressions: deployment registry omissions, signed-out navigation to an authenticated route, and a 2.04 MB entry bundle over the existing 2 MB limit. Fixed in `31fedfdea2799b73ff056973f679aee5cd7983ca`, pushed and ref verified. Registry/public navigation fixes pass **34 targeted tests**; showcase uses a separate lazy chunk. Updated CI accessibility/language gate **passed** with entry 2,010.46 kB (gzip 580.98 kB), below the unchanged threshold. [Publishing CI 38380056501](https://github.com/insportia/homatch/actions/runs/38380056501) also passed.
- Extended owned-UI QA to all six languages: **2 Chrome tests passed across nine configurations** including Georgian mobile, Russian and Turkish; screenshots inspected. Real data/portal/auth integration remains unverified.
- Repository CI at `31fedfdea2799b73ff056973f679aee5cd7983ca`: **8,835 unit/matrix tests passed**, Static checks passed, accessibility/language chunks passed. Full build succeeds in clean CI; root local dependency blockers are not a production build failure.
- All six local tools actively probed; [TOOLKIT.md](TOOLKIT.md) and [actual JSON evidence](TOOLKIT-RESULTS.json). Installed Playwright and redacted rrweb recording/replay passed local fixtures; MCP, Stagehand and Browser Use browser startups failed; Ollama service works but has zero models. Owner model-download approval pending; no inference/download claimed. MyHome/SS discovery with installed Playwright 1.64.0 again confirmed environment network denial. No bypass or paid service used.

## Added implementation

- Authenticated `publisher-center` endpoint: owner-scoped snapshots, selection persistence, normalized immutable versions, enqueue, cancellation, reconciliation retry, disconnect, monitoring/kill switches. Verifies Auth, internal user ID, suspension and read-only impersonation. Unsupported connection requests return explicit errors.
- Durable Supabase transport and SQL RPCs: atomic portal/account-limited claims, leases, fenced completion, safe retry, crash recovery, immutable job identity, external URL validation, publication price/version/status mapping and audited revocation. Schema remains an unapplied review draft, not a migration.
- Isolated CPU worker entrypoint, concurrency/memory backpressure, health/readiness, shutdown, pinned lockfile, non-root Dockerfile and separate Railway config. No service created or locally built image claimed.
- Customer Publishing Center/property/portal/activity routes and admin-only console. Controls call authenticated endpoints. Creation, editing and photos reuse `/property/create` and `/property/:id/edit`. No raw sessions/private photo URLs exposed.
- Custom architectural homepage and backend-event journey visuals, Motion, reduced-motion/offscreen handling, mobile and RTL. Both default and saved homepage orders enforce Brokers → Publishing → Property Search. Public/admin navigation integrated.
- 66 new translation keys in all six languages using the existing idempotent applier.
- Dedicated CI for unit/security, disposable Postgres/RLS/parallel claims, Docker build and browser screenshots; release ownership registered. CI results must be checked after push.

## Verified evidence

- **74 unit/security tests passed**: 68 worker/endpoint and 6 property/order/link tests.
- **50 real PostgreSQL assertions passed** with synthetic users and temporary objects inside a rolled-back transaction. Ownership, RLS, exact selection, idempotency, fencing, crash recovery, moderation, snapshots, admin, revocation, safe cancellation and recovery after source deletion covered. Parallel separate-session test prepared for disposable CI, not locally run.
- **2 real Chrome browser tests passed**, including exact confirmation targets, restoration, injected progress/failure/success events, keyboard focus, nine responsive/RTL/reduced-motion configurations covering all six languages and showcase screenshots. Screenshots inspected. Data/backend mocked; this is not live portal or full-app acceptance.
- **67 existing Site Studio/admin tests passed**. `check:edge`, `i18n:all` and isolated publishing fixture production build passed.
- Full local type check has no publishing errors but fails on missing existing `@huggingface/transformers` and `pdfjs-dist` dependencies in Design Studio. No unrelated files changed to hide it.
- Release-path suite: **23 passed, 2 failed** when temporary Git fixture planning returned REPO_FULL with permission/missing-engine-path diagnostics. Do not report the global release gate green or weaken the tests.

## Environment and deployment facts

- `.git` writes denied; update the existing PR with GitHub tools. Local checkout contains unrelated Verify work; never stage it.
- PR branch is newer than local checkout. Replay only publishing edits onto remote route/admin/release files and preserve all newer remote translations.
- Local Playwright MCP initializes/lists 26 tools; native browser tools are absent here and navigation failed closed-target. [Exact config/reload diagnosis](MCP-SETUP.md). Owned UI renders through existing Playwright. No paid tools used.
- Supabase CLI **2.119.0 recovered through offline npm cache**. No migration created/applied.
- Production migration max `20261020090000`; PR branch has 369 migrations through `20261101090000`. Audit exact publisher migration dependency/order; never blanket-push pending unrelated migrations or alter history.
- Production read-only checks confirmed `public.publisher_jobs` and `public.publisher_portals` absent. No publishing endpoint, worker, frontend, advertisement, payment or infrastructure deployment performed.

## Exact next actions

1. Check new PR commit/CI and fix only publishing issues or verified environment problems. Keep draft.
2. Reload native Playwright MCP; inspect MyHome/SS rendered login, submission, terms and management, then other candidates. Registry candidates are not adapters.
3. Complete permitted portal-specific connectors/adapters or working assisted handoffs. Real authentication/challenge routing, session persistence RPCs, photo hashing/limits, mandatory portal fields and external conflict checks remain incomplete. Owner-authorized test accounts required for live mutations.
4. Finish full-app/property/photo/portal QA, worker benchmarks, synchronization and capacity evidence. Generate/review the migration only after remaining schema gates pass.
5. Release prerequisites/frontend/isolated worker together only after complete required checks, then verify production artifacts/routes. Never modify/restart `homatch-official-worker`.
