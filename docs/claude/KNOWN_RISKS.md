# KNOWN RISKS AND SHARP EDGES

Things that have already bitten a session once. Read before they bite twice.

## Deployment

- **CLI success ≠ deployed.** Two silent CLI deploy failures shipped green
  steps; only the exact artifact proof (`scripts/edgeArtifacts.mjs`,
  PROVEN_EXACT) caught them. Trust refs/deployed/* advancement + artifact
  proof, nothing else.
- **Pushing to `main` does not apply migrations.** Migrations are applied
  deliberately, in order, against production — the deploy workflow's ledger
  comparison (`npm run deploy:status`) is the authority.
- **`refs/deployed/*` cannot be pushed from a session** (proxy silently
  no-ops). Only the CI run advances them.
- **`ezbr_sha256` is not reproducible** and is never proof. The eszip module
  diff is.
- **Hand-deploy pair**: `impersonate-user`, `unlock-external-contact` are
  excluded from CI's owed set; changing them means hand-deploying them and
  proving the artifact.

## Database

- **Append-only migrations.** Never edit an applied migration; the hygiene
  gate (`npm run homatch:migrations`) grandfathers frozen history explicitly.
- **The runner owns the transaction.** No top-level `begin/commit` in new
  migrations (the broker-directory migration had to be patched for this).
- **RLS + SECURITY DEFINER everywhere**: never disable RLS; grants are
  guarded by `tests/matrix/functionGrants.test.mjs`.
- **Property contact phones are private.** Required at creation ≠ public.
  No public, indexable, or client-trusted path may expose them.

## Product semantics

- **Internal vs external match.** Never fabricate a HOMATCH user from an
  external lead. Native messaging uses canonical conversations only.
- **Telemetry ≠ intent.** The native pipeline (interaction → source event →
  interpretation → deterministic validation → effective intent) is the only
  path to a match; objection ≠ rejection ≠ interest.
- **Property IDs** are permanent six-digit server-generated immutable.

## Environment (cloud sessions)

- Egress denies homatch.live and *.supabase.co directly: use
  `mcp__Vercel__web_fetch_vercel_url` for site fetches and `pg_net` for
  server-side probes.
- GitHub Actions log blobs are unreachable; use the jobs/steps API.
- Containers are ephemeral: anything not committed and pushed dies with the
  container, including the CBM index cache (`~/.cache/codebase-memory-mcp`).

## Tooling honesty

- The affected-test selector is an iteration aid; only `homatch:check:full`
  plus the pipeline gates decide a release.
- Generated maps are stamped with the HEAD that produced them; a stale stamp
  means regenerate, not trust.
- CBM's index is a map of code, never proof of production state, and its
  in-degree-0 results are not proof of dead code.

## Migration history: clean rebuild

- The repository history is NOT replayable end to end from an empty database.
  `scripts/claude/replay-migrations.sh` (against a throwaway local Postgres,
  with `supabase/replay/platform-bootstrap.sql`) replays it with two repairs:
  the eight legacy `000xx_` files run at their chronological place, and
  `supabase/replay/before/<version>.sql` fills gaps where production objects
  were created by hand and only declared later (the discovery_query_queue
  claim/cost columns; `increment_source_failure`, `rls_auto_enable`).
- It stops at `20260829180000_outreach_schema_reconciliation`: that migration
  renames columns of outreach tables that were built in production by hand
  and were never declared by any migration. Reconstructing them would mean
  inventing their shape. Applied migrations stay frozen; the fix, when
  wanted, is a fragment derived from a production schema dump, not a guess.
- Production ledger versions are MCP-generated for migrations applied through
  the Supabase migration API (e.g. repo 20260929220000 = ledger
  20260929131644). `supabase db push` would therefore see already-applied
  migrations as pending: do not run the workflow_dispatch migrate job without
  first aligning the ledger.

## meta-oauth reads "deduplicated / already-current" in multi-function push deploys
Runs #845 and #848 both left meta-oauth STALE (version unchanged, index.ts mismatched) while the
other owed functions in the same run moved and proved. A single-function dispatch
(`redeploy=meta-oauth`, runs #846/#849) proved it exact both times. The artifact proof caught it;
until the cause is known, redeploy meta-oauth on its own when the proof flags it.

## Entry bundle ratchet at 2MB (translations split per language, 2026-09-30)

`tests/browser/accessibilityAudit.test.mjs` fails the Validate job — and so
blocks every edge deploy — when the Vite entry chunk passes its ceiling. The
entry peaked at 6.21MB (all six languages of `src/i18n/translations.ts` were
imported synchronously); the owner approved 6.5MB for the Meta Ads release
with per-language loading named as the follow-up. That follow-up is done:

- English ships in the entry; ka/ru/tr/ar/he are separate chunks cut from
  `translations.ts` at build time by the `i18nLanguageChunks` plugin in
  `vite.config.ts` and read through `src/i18n/bundles.ts`. `translations.ts`
  stays the single source for apply-scripts, gates and tests.
- `main.tsx` renders after the visitor's language arrives (bounded at 4s; a
  failed chunk renders English), and a switch loads before it switches, so no
  flash of English. `tests/browser/languageChunks.test.mjs` holds both.
- Entry 6.21MB → 1.62MB; ceiling 6.5MB → 2MB.
- Keep new runtime code off `@/i18n/translations` and `@/i18n/appContent`
  (value imports): either one puts all six languages back into the entry. Use
  `@/i18n/bundles` or `@/i18n/locales`; type imports are free.
- Watch-out seen during this release: Vercel auto-deploys `main` even when the
  Validate job fails, so a failed deploy run can leave a NEW frontend live
  against OLD edge functions. Check both after every main merge.
