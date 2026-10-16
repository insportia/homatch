# Verify at scale — durable queue, load harness, rollout

Everything here is **off by default**. Nothing in this directory touches
production; the harness runs against a scratch Postgres only.

## What changed (and why)

| Before | Now (QUEUE mode) |
|---|---|
| One in-memory worker job per Verify; a worker restart lost every running job | Each official source is a row in `verify_tasks`; any replica claims it under a lease (`FOR UPDATE SKIP LOCKED`), heartbeats, and a crashed holder's lease is recovered |
| One Chromium per job, even for HTTP sources | Two lanes: `HTTP` (TAS API, MyGov API + 2Captcha, no browser) and `BROWSER` (TAS_MAP, ENREG, Debtor, RS.ge) with separate per-replica slots |
| 4 jobs per worker, the rest queued in memory | Configurable slots per replica; more replicas of the same service scale out |
| The same building researched again for every flat | Single-flight per scope + evidence cache: TAS case files once per building (flats delegate to the parcel), registry extracts once per company, with per-source freshness (`verify_source_policy`) |
| Client poll and driver could both step the same job | `research_job_advance_acquire`: one advancer per job |
| A retried start created a second job | `clientRequestId`, unique per caller |
| CAPTCHA cap 50/day, counted in memory | No built-in cap (owner decision); every solve recorded in `verify_captcha_events`, per source and cost, visible in Admin |
| Document text cut to fit the payload | Complete text stored in the private `verify-evidence` bucket (content-addressed); results carry excerpts + `fullTextRef` and an honest `textTruncated` |

## Files

- `supabase/migrations/20261026090000_verify_durable_execution.sql` — tables,
  claim/heartbeat/complete/fail/release/delegate/cancel functions, metrics,
  bucket, `verify_execution_mode` = `"LEGACY"`.
- `supabase/functions/verify-queue/` — the worker's door (WORKER_TOKEN).
- `official-worker/src/queue/` — `QueueRunner` (lanes, leases, graceful
  release), `executor` (per-source), `evidence` (complete-text storage),
  `gateway`, `startVerifyQueue` (env-gated).
- `src/verify/queueOfficial.ts` — research-agent's task plan and view.
- `tests/sql/verify_durable_execution*.sql` — SQL behaviour checks.
- `queue-load.mjs` — this harness.

## Running the checks locally

```bash
# scratch Postgres 16 on a socket in /tmp, port 55432 (never production)
P="psql -h /tmp -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "create database vq_t"
$P -d vq_t -f tests/sql/verify_durable_execution_fixture.sql
$P -d vq_t -f supabase/migrations/20261026090000_verify_durable_execution.sql
$P -d vq_t -f tests/sql/verify_durable_execution.sql      # "all checks passed"

PG_BIN=/usr/lib/postgresql/16/bin node scripts/verify-scale/queue-load.mjs > report.json
```

## Measured (2026-10-10, scratch PG16, 4 vCPU / 15 GB, workers simulated in SQL)

These numbers measure the **coordination layer** only — Postgres doing
admission, claiming, fencing, single-flight and recovery. They say nothing
about how fast government sites answer or how many Chromium sessions a
replica can hold; see "Capacity" below.

| Scenario | Result |
|---|---|
| Admission, 100 submissions | p50 169 ms, p99 224 ms, 0 failed |
| Admission, 1,000 submissions | p50 96 ms, p99 472 ms, ~1,200/s, 0 failed |
| Admission, 10,000 submissions (200 connections) | p50 96 ms, p95 247 ms, p99 407 ms, ~1,600/s, 0 failed; 9,996 jobs (10 % of submissions were deliberate retries of an earlier request id → deduplicated), 3 tasks each |
| Drain 30k tasks (64 simulated replicas, batch 5) | 27.5 s, every task SUCCEEDED, `attempts = 1` everywhere (exactly once) |
| Crash: half the claims abandoned | 145/145 leases recovered, every task completed, no completion accepted from a stale holder |
| Same building, 1,000 jobs over 50 flats | **1** TAS case-file read for the building, 50 TAS_MAP reads (one per flat), 2,850 tasks served by shared work |

## Capacity (what the measurements do and do not prove)

- The queue itself is not the bottleneck at 10k submissions.
- Real throughput is bounded by **sources**, not by the queue: the per-source
  `max_running` caps in `verify_source_policy` (TAS 24, MyGov 16, TAS_MAP 8,
  ENREG/Debtor 6, RS.ge 4 across all replicas) exist to stay polite to
  government sites. Raising them is a deliberate decision, not a tuning knob.
- Chromium: plan ~400 MB per browser task. A replica with
  `VERIFY_QUEUE_BROWSER_SLOTS=3` needs ~1.5 GB for browsers plus the Node
  process. HTTP slots are cheap (12 default).
- **Not proven:** 10,000 simultaneous browser sessions, or 10,000 complete
  reports within minutes. Neither is claimed. A live benchmark against the
  real sources (with the owner's approval and budget) is the only way to
  establish end-to-end reports per hour.

## Rollout (each step needs the owner's explicit approval)

1. Apply migration `20261026090000` (additive: new tables/functions/bucket,
   two nullable columns + one unique index on `research_jobs`). With the flag
   at `LEGACY` nothing changes behaviour.
2. Merge → CI deploys `research-agent` (LEGACY path unchanged; advance lease
   and idempotent start become active) and `verify-queue` (inert).
3. Railway (same service `homatch-official-worker`, no new service): set
   `VERIFY_QUEUE_ENABLED=1`, `VERIFY_QUEUE_HTTP_SLOTS=12`,
   `VERIFY_QUEUE_BROWSER_SLOTS=3`; keep 1 replica first.
4. Set `admin_settings.verify_execution_mode` to `"QUEUE"`. New cadastral
   jobs use the queue; running jobs finish on the path they started on.
5. Run one Verify for the test property; check Admin → Verify official
   sources → Durable queue (backlog, dead-lettered, reused, CAPTCHA cost).
6. Scale replicas only after step 5 is clean, watching memory per replica.

## Rollback

- Set `verify_execution_mode` back to `"LEGACY"` — new jobs immediately use
  the old path. Jobs already in QUEUE mode keep reading their task rows.
- `VERIFY_QUEUE_ENABLED=0` (or unset) on Railway stops claiming; unfinished
  tasks are released on shutdown and stay in the table.
- The migration is additive; nothing needs to be dropped to roll back.
  No wallet, ledger, research history or evidence row is modified by it.

## Verify credit budget — deployment checklist (owner approval at every step)

Nothing below has been executed. `verify_billing_enabled` stays `false` and
`verify_execution_mode` stays `"LEGACY"` until the owner says otherwise.

1. Merge PR #145 (owner). CI deploys `research-agent` and `verify-queue`;
   with both flags off, behaviour is unchanged (no gate decision is ever
   AWAIT/LIMIT without an ACTIVE `verify_billing` row).
2. Apply `20261026090000` then `20261026100000` in release order (owner).
   Additive: new tables/functions/settings; no wallet, ledger or job row is
   rewritten. Check `verify_budget_policy()` (25 / +25 / 4 / 100).
3. Frontend deploy (Vercel, from main). The launch dialog only appears when
   `verify_launch_quote().enabled` is true.
4. Owner test account only: set `verify_billing_enabled = true`, run one
   Verify, approve one +25, stop, continue; confirm in SQL:
   `verify_billing_authorizations` rows = approvals + 1, `credit_accounts.reserved`
   back to 0 after each stop, `charged_total_credits` ≤ `authorized_total_credits`.
5. Railway (`homatch-official-worker`, same service) only when
   `official-worker/` changed — needed for legacy-mode Stop (`/research/:id/cancel`).

### Rollback

- `verify_billing_enabled = false` — new Verifies are not charged; open
  sessions are closed by the driver sweep (charged for completed reports,
  released for failures). No refund is invented and none is lost.
- Jobs already held at AWAIT stay PAUSED with their results saved; a job
  that already has a budget keeps its rules (continuing it still needs the
  customer's +25 approval, never more than 100). Only new jobs are unbilled.
- The migrations are additive; nothing needs dropping. Wallet balances,
  ledgers, research history and evidence are untouched by rollback.
