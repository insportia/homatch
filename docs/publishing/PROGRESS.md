# Publishing Center progress

**Current continuation checkpoint: [CHECKPOINT.md](CHECKPOINT.md).** The foundation history below is retained; the checkpoint has current implementation, test results, environment diagnosis and exact next actions.

Started 2026-10-13. Implementation incomplete; no live publishing claims.

- Located repository at `C:/Users/User/homatch`; existing branch has unrelated Verify changes. Do not stage or modify these.
- Inspected homepage: `HomePage` renders `SitePage`; ordering is in `src/site/render/order.ts`, navigation in `src/site/publicNav.ts`.
- GitHub repository connection works. Local git fetch and worktree creation failed with filesystem permission errors on `.git`.
- Initial web checks reached MyHome, SS, Livo, Home, Korter, Place and Binebi. Area, Gancxadebebi and Dgiurad fetches failed; these are not evidence that the sites are inactive.
- No portal account authentication, listing submission, edits, removals, payments, migrations, deployments or infrastructure changes performed.

## Implemented foundations

- New isolated source directory `publisher-worker/`; no changes to official-worker or existing frontend features.
- Adapter/type contract, normalized property, explicit selection/ownership checks, photo validation, canonical fingerprints and field change detection.
- AES-256-GCM session encryption bound to user/portal/account; rotating key ID support; ephemeral bounded OTP challenge broker.
- Browser context pool with capacity/account isolation, timeouts and cleanup.
- Publishing engine against an injected store, lease fencing and heartbeat, permission/capability/kill-switch checks, reconciliation for potentially accepted submissions and safe error codes.
- Unapplied SQL review draft at `publisher-worker/schema/proposed.sql`. Not a migration and not ready to apply: pending RPCs/integration gates are listed in the file.
- Read-only rendered discovery script and resumable evidence report at `docs/publishing/PORTAL-EVIDENCE.md`.

## Validation

`node --test publisher-worker/test/*.test.mjs`: **46 passed, 0 failed**. Tests cover policies, session security/challenges, injected-store engine recovery and fake-browser pool isolation. These are foundation unit/mock tests, not real database or real portal integration tests.

Initial run found a floating-point/backoff bound failure; fixed by capping the final jittered delay. Final run passed.

`node publisher-worker/scripts/discover.mjs myhome.ge ss.ge`: both failed with `ENVIRONMENT_NETWORK_DENIED`. Generated local artifact is ignored. No rendered forms inspected.

## Production inspection

Read-only Supabase inspection confirmed `properties`, `property_facts`, private-photo conventions and internal `users.id` ownership via `get_user_id()` / `user_owns_property()`. This differs from auth UID. Production migration versions include `20261020090000` while this checkout's latest is `20261019090000`; reconcile before generating/applying migrations. No production writes performed.

## Environment blockers

- `.git/FETCH_HEAD` and branch lock writes denied. Local fetch and worktree creation failed. GitHub connector fallback created `feat/property-publishing-foundations` from current main `a97d4b0269979fa164cf1c90c8d32e41db30996f`; foundations are being preserved in a draft PR. No local branch was created.
- Creating a sibling checkout directory denied. Applied edits are only new files inside the existing repository.
- Chromium external networking denied for MyHome and SS. Web retrieval is available but is not a replacement for rendered inspection.
- Supabase CLI unavailable. Graphify extraction failed. No migration filenames invented or history changed.
- Asked owner asynchronously to enable repository git writes and browser networking. No permission answer received as of this update.

## Still outstanding — do not mark complete

Durable database store and remaining RPCs, migration generation/integration tests, authenticated edge endpoints, actual portal adapters/assisted flows, connection routing and real auth, frontend/editor/homepage/navigation/six-language motion and admin console, synchronization, browser/visual QA, benchmarks, CI/CD and production deployment. Draft PR is preservation/review of foundations only, not an acceptance deliverable. No portal meets any live-operation verification state. No live mutation, payment, infrastructure creation or deployment performed.

Next: restore environment permissions, establish isolated checkout, finish core datastore/security integration, inspect rendered portal workflows, implement and test permitted paths, then build/verify frontend and coordinated release. See `publisher-worker/README.md` for exact release gates.
