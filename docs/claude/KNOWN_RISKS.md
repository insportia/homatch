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
