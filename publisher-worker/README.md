# HOMATCH publisher worker — implementation in progress

This directory is isolated from `official-worker`. It is **not deployed or production ready**. No portal operation is enabled or represented as implemented.

Current implementation and continuation state: [checkpoint](../docs/publishing/CHECKPOINT.md). Customer/admin UI, endpoint authorization, durable Supabase transport and queue RPCs have been added. There are 74 unit/security tests and 50 temporary-transaction PostgreSQL assertions, plus owned-UI browser checks. Real portal adapters and authentication remain incomplete.

Implemented and tested foundations:

- `src/contracts.ts`: normalized property, capabilities, verification levels and adapter contract.
- `src/policy.mjs`: individual confirmed selection, ownership, image validation, deterministic version fingerprints, update change detection, retry/backoff and ambiguity policy.
- `src/security.mjs`: AES-256-GCM encrypted browser sessions with tenant/account/portal authenticated binding and key IDs; ephemeral, bounded, attempt-bound authentication challenge delivery.
- `src/browser-pool.mjs`: independent contexts, conservative context cap, same-account exclusion, timeouts, cleanup and backpressure. No traces, HAR, screenshots or session files are recorded.
- `src/engine.mjs`: fenced worker operations, lease heartbeat, kill-switch/capability checks and reconciliation before crash recovery. `src/supabase-store.mjs` implements transport to the reviewed RPCs; they are not installed in production.
- `schema/proposed.sql`: **unapplied review draft**, not a migration. Includes owner-only reads using internal user mapping, private sessions, composite ownership references, immutable versions, distributed claim/heartbeat/event/finish/enqueue/cancel/retry/disconnect/admin RPCs. Session/challenge integration and photo verification remain gated. `schema/portal-seed.sql` contains ten disabled discovery candidates, not integrations.

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
3. Complete remaining authentication/photo integration and the disposable parallel-claim test. Generate a real migration using the recovered Supabase CLI after reconciling PR/production history. No production DDL has been installed.
4. Implement authenticated edge authorization, connection routing, revocation, per-portal/account distributed limits, external conflict comparison, cancellation, diagnostics redaction, synchronization and admin controls.
5. Extend the implemented six-language frontend/progress/admin and existing property editor integration. The actual SitePage renderer and saved/default order now enforce Brokers → Publishing → Property Search. Complete full-app QA and portal-specific fields before release.
6. Validate with real database isolation/concurrency tests and desktop/tablet/mobile screenshots, Georgian/English/Arabic/Hebrew, reduced motion and keyboard tests. Core mocks do not count as live portal evidence.
7. Owner-authorized test accounts are required for real mutations. No fabricated ads, payment, CAPTCHA/MFA bypass or automatic registration.
8. Benchmark Chromium and portal-limited throughput before capacity claims. Provision only a dedicated ordinary CPU Railway worker under the owner's explicit request; never restart or alter `homatch-official-worker`.
9. Integrate the new worker and tests into the existing release component map and CI, review PR, coordinated prerequisite/frontend/worker deployment and actual production artifact proof.

## Capacity model to measure

For U daily active publishers, P selected portals/user, mean browser service time S seconds and effective busy-window H hours, required steady browser slots are `ceil(U * P * S / (H * 3600))`, before measured peak headroom. Portal limits bound throughput independently of worker slots. MFA waiting should expire/park connection attempts rather than hold an unlimited browser pool. Start with 1–2 contexts per worker. No CPU/memory benchmark or production throughput claim has been made.
