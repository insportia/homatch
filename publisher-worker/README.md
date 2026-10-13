# HOMATCH publisher worker — implementation in progress

This directory is isolated from `official-worker`. It is **not deployed or production ready**. No portal operation is enabled or represented as implemented.

Implemented and tested foundations:

- `src/contracts.ts`: normalized property, capabilities, verification levels and adapter contract.
- `src/policy.mjs`: individual confirmed selection, ownership, image validation, deterministic version fingerprints, update change detection, retry/backoff and ambiguity policy.
- `src/security.mjs`: AES-256-GCM encrypted browser sessions with tenant/account/portal authenticated binding and key IDs; ephemeral, bounded, attempt-bound authentication challenge delivery.
- `src/browser-pool.mjs`: independent contexts, conservative context cap, same-account exclusion, timeouts, cleanup and backpressure. No traces, HAR, screenshots or session files are recorded.
- `src/engine.mjs`: injected durable-store interface, fenced worker operations, lease heartbeat, kill-switch/capability checks and reconciliation before crash recovery. The store is not implemented yet.
- `schema/proposed.sql`: **unapplied review draft**, not a migration. Includes owner-only reads using the actual HOMATCH internal user mapping, private encrypted sessions, composite account ownership references, version/publication/job entities and distributed claim/heartbeat/event functions. Remaining RPCs and database integration tests are explicitly listed at the end.

Run implemented tests from repository root:

```powershell
node --test publisher-worker/test/*.test.mjs
```

Read-only rendered discovery (requires repository development dependencies and an installed Chromium):

```powershell
$env:PUBLISHER_CHROME_PATH='C:/Program Files/Google/Chrome/Application/chrome.exe'
node publisher-worker/scripts/discover.mjs myhome.ge ss.ge
```

The script only navigates and reads visible control metadata. It never authenticates, supplies an OTP, uploads photos or submits listings. Its generated artifact is not proof of authorization, account connection or publishing support. It stops after two environment network denials.

## Release gates

1. Restore `.git` write access for an isolated feature branch and read-only browser network access.
2. Inspect rendered login/submission/management DOM, portal terms and API/partner options. Record per-operation permission and evidence. Implement separate adapters only against verified workflows; use explicit assisted workflows where needed.
3. Finish and integration-test database RPCs and durable store. Generate a real migration using the Supabase CLI; reconcile local history with production before applying anything. No production DDL has been run.
4. Implement authenticated edge authorization, connection routing, revocation, per-portal/account distributed limits, external conflict comparison, cancellation, diagnostics redaction, synchronization and admin controls.
5. Build six-language frontend/editor/progress/admin and premium motion. Insert the section in the actual SitePage renderer and enforce Brokers → Publishing → Property Search for both default and published orders. Current default order places Property Search earlier than Brokers, so adding one item alone is insufficient. Preserve the other sections and test saved content orders.
6. Validate with real database isolation/concurrency tests and desktop/tablet/mobile screenshots, Georgian/English/Arabic/Hebrew, reduced motion and keyboard tests. Core mocks do not count as live portal evidence.
7. Owner-authorized test accounts are required for real mutations. No fabricated ads, payment, CAPTCHA/MFA bypass or automatic registration.
8. Benchmark Chromium and portal-limited throughput before capacity claims. Provision only a dedicated ordinary CPU Railway worker under the owner's explicit request; never restart or alter `homatch-official-worker`.
9. Integrate the new worker and tests into the existing release component map and CI, review PR, coordinated prerequisite/frontend/worker deployment and actual production artifact proof.

## Capacity model to measure

For U daily active publishers, P selected portals/user, mean browser service time S seconds and effective busy-window H hours, required steady browser slots are `ceil(U * P * S / (H * 3600))`, before measured peak headroom. Portal limits bound throughput independently of worker slots. MFA waiting should expire/park connection attempts rather than hold an unlimited browser pool. Start with 1–2 contexts per worker. No CPU/memory benchmark or production throughput claim has been made.
