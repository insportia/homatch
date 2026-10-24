# Verify at scale — release package for owner approval (2026-10-24)

PR [insportia/homatch#329](https://github.com/insportia/homatch/pull/329), branch `claude/verify-scale`, merged
with current main (Email Studio #327 included).

**Nothing has been merged, migrated, deployed or scaled. No secret has been created.**

Approved rollout: ship the optimized engine at **1 replica** → prove production health → scale to **3** only
after a separate approval → 6 (the Hobby maximum) or 10 (Pro) later, prepared but not activated.

## 1. What ships

| Area | Change | State after deploy |
|---|---|---|
| Driver | One atomic, fair batch claim per tick (`FOR UPDATE SKIP LOCKED`, claim re-checked on the locked row). Jobs are stepped concurrently, with chained fan-out of ≥180 jobs per 30 s tick. | On. Falls back to the old sweep without the RPC. |
| Queue UX | Waiting is not execution time (3 h queue cap). Waiting jobs show position and a measured ETA, in six languages. | On |
| Replica safety | Market runs live in the database. Cluster slots for MyHome, the Telegram session and each portal crawler. 180 s drain, then leases go back to the queue. | On. Identical behaviour at 1 replica. |
| Network layer | Per-domain proxy routing, exact metering, breakers that suspend rather than rotate. | **Off.** Nothing is proxied or metered. |
| OpenAI | Shared RPM/TPM budget; Retry-After honoured. A report the model can't finish is retried, never shipped half-written as READY. | Budget **unset** (= no limit) |
| Scaling | `verify-scaling`: admin-only with a server re-check, confirmation, and a log of every attempt. Railway token server-side only. One service only. | **MANUAL**, approved ceiling **3**, autoscaler **off** |
| Admin | System → Verify Scaling (live numbers, cost table, 1–10 controls, heartbeats, log) | — |

Government-source concurrency caps (`verify_source_policy`) are **unchanged**: TAS 24, MyGov 16, TAS_MAP 8, ENREG 6, DEBTOR 6, RS 4.

## 2. CI and local results

- **Linux CI on #329:** see §9. Filled in from the run on the final head.
- **Worker:** 746 / 746 passing locally, including the real `QueueRunner` load tests (50 / 200 / 1,000; 6→3 replicas mid-burst; exactly once, 0 fenced completions, 13 tasks handed back on drain).
- **PGlite behaviour checks:** driver claim, queue position, semaphore/market runs, OpenAI budget, scaling metrics.
- **Migrations on production's real table definitions:** `scripts/verify/prod-shape-migrations-check.mjs`. Apply twice, run every function, roll back, apply again: OK.
- **Railway contract:** `scripts/verify/railway-contract-check.mjs`. All four GraphQL documents validated against Railway's live schema, 0 errors, nothing deprecated.
- **Also passing:** `check:edge` (103 functions), the migrations gate, tsgo, biome, i18n gates, the production build.

## 3. Compatibility

- **Current main (incl. Email Studio #327):** merged into the branch.
  - translations were re-applied through the idempotent scripts;
  - PROJECT_STATE keeps both sections.
- **Migration version clash, fixed:** #327 took `20261201090000`, and open HOMI #325 adds `20261201090000`–`096000`, exactly the numbers these seven had. Supabase keys migrations by version, so they now run as **`20261205090000`–`096000`**.
  - Separately, #325 itself still collides with #327's already-merged `20261201090000`. HOMI's owner needs to renumber.
- **HOMI #325:** a dry-run merge (`git merge-tree`) against this branch merges every code file cleanly, including `components.mjs`, `navigation.ts` and `routes.tsx`.
  - The only conflicts are `translations.ts` and `PROJECT_STATE.md`, both fixed by re-running the apply scripts.
  - The combined admin sidebar stays at its 8-group limit, and the Verify Scaling route is present.

## 4. Migrations vs production (read-only audit, 2026-10-24)

- **Not applied:** none of the seven is in the production ledger.
- **No collisions:** none of their 6 tables, 7 functions or 6 indexes already exists.
- **Columns:** every column they reference exists in production:
  - `research_jobs`: `user_id`, `status`, `deleted_at`, `cancelled_at`, `driver_claimed_at`, `completed_at`;
  - `verify_tasks`: `lane`, `state`, `source`, `priority`, `run_after`, `started_at`, `finished_at`, `cancel_requested`;
  - `admin_settings`: `key` (UNIQUE), `value`, `updated_by`, `updated_at`.
- **Mode:** `verify_execution_mode = QUEUE` (needed for more than 1 replica).
- **Size:** production holds 110 jobs, 144 tasks and 0 live jobs, so the two new indexes on existing tables build instantly.
- **What changes:** the migrations only add objects, plus one setting row (`verify_scaling`, MANUAL, inserted only if absent). The only writes to existing rows are the `driver_claimed_at` stamps the driver already uses.
- **Independent audit:** the database auditor found no blockers. Its 2 Medium and 3 Low findings are fixed (double-claim re-check, finished-task index, active-job filter, append-only ledger, 90-day prune).

**Rollback / recovery**

- **Recommended:** revert the code, keep the schema. Main never calls the new objects, so leaving them is harmless.
- **If you want the schema back too:** `docs/infra/verify-scaling-rollback.sql` drops exactly the new objects. It's proven on production's table definitions, and so is re-applying afterwards.

## 5. Railway — plan, limits, cost (verified)

**Plan:** **Hobby**, confirmed by Railway's own plan-limits tool (`planTier: HOBBY`).

| | Value |
|---|---|
| Max replicas per service | **6** |
| Per-replica limit | 8 vCPU / 8 GB (applied: 8 / 8) |
| Current | **1** replica, region `ams` |
| Included usage | Railway's tool reports $0, so the estimates below count all usage as billed |
| 10 replicas | needs **Pro**: $20/month subscription instead of $5; up to 42 replicas |

Measured over the last 7 days: RAM average 1.24 GB (peak 2.92 GB), CPU average 0.013 vCPU (peak 0.76). Prices are $10 per GB-month and $20 per vCPU-month.

| Replicas | Light (measured average) | Busy all month (measured peak) | Change vs today, light |
|---|---|---|---|
| 1 (release) | $12.66 | $44.30 | — |
| **3 (next approval)** | **$37.98** | $132.90 | **+$25.32/month** |
| 6 (Hobby max) | $75.96 | $265.80 | +$63.30/month |
| 10 (Pro) | $126.60 | $443.00 | +$113.94/month, plus $15 for the plan difference |

Railway bills actual use, so real cost sits between the columns, close to "light" at today's volume. These are estimates, not guarantees, and they exclude the $5 subscription.

## 6. Latency — measured vs simulated

**Measured** in production: 16 completed verifications in the last 30 days, all on 1 replica.

| Stage | p50 | p90 |
|---|---|---|
| Before official sources (identity) | 0.7 min | — |
| Official sources (first task → last task done) | **8.0 min** | 23.3 min |
| After the last source (public research tail, market, report) | **3.3 min** | 10.3 min |
| **Total** | **14.1 min** | **24.7 min** (min 6.1, max 29.8) |

| Source | Tasks per job | Starts after submit | Queue wait p50 / p95 | Run p50 / p95 |
|---|---|---|---|---|
| TAS | 1.00 | 43 s | 9 s / 15 s | **230 s / 557 s** |
| MyGov (up to 3 records in one task) | 0.75 | 49 s | 9 s / 16 s | **129 s / 346 s** |
| TAS_MAP | 0.94 | 45 s | 8 s / 16 s | 51 s / 155 s |
| ENREG | 2.44 | 210 s | 5 s / 26 s | 13 s / 19 s |
| DEBTOR | 2.38 | 210 s | 11 s / 27 s | 5 s / 7 s |
| RS | 1.06 | 219 s | 3 s / 13 s | 65 s / 92 s |

**Why one verification takes 8–15 minutes:**
- **TAS:** the documents read takes 230 s at the median, 9 min at p95.
- **MyGov:** the register read is the last thing to finish in 5 of 16 jobs, ending around 15 min.
- **Company checks:** they can only start once public research has named the companies (about 3.5 min in). With 2–3 companies per job, RS often finishes last (5 of 16 jobs).
- **Report:** the tail after the last source adds about 3 min (up to 10).
- **Queue wait:** at today's load, waiting for a slot is seconds. The time is the sources themselves.

**Simulated:** `scripts/verify/load-sim.mjs`, built from the measured numbers above. One job alone reproduces the measured 14 min median and 25 min p90. These are projections, never measurements of a real burst.

| 200 at once | All done | p50 / p95 per job | Limit hit |
|---|---|---|---|
| 1 replica | ~212 min | 133 / 200 min | browser slots |
| **3 replicas** | **~101 min** | 58 / 91 min | browser slots (3 per replica) |
| 6 replicas | ~84 min | 41 / 73 min | **RS cap 4** (a government source) |
| 10 replicas | ~84 min | same as 6 | RS cap 4 |

- 50 at once on 3 replicas: about 50 min. 1,000 at once: about 7.4 h (3 replicas) or 5.6 h (6 replicas).
- **1,000 simultaneous submissions are accepted:** they're durable, each gets a position and ETA, and queue time never times out the execution.
- **The ceiling at 6+ replicas is RS's cap, which stays as it is.** Raising government-site concurrency is out of scope, so 200 in 30 minutes is not reachable. The honest figure is about 1.4 h at 6 replicas.
- **Prepared, not activated:** raising `VERIFY_QUEUE_BROWSER_SLOTS` from 3 to 5 per replica (a worker setting, not a source cap) would give 3 replicas the same ~84 min as 6. It needs a RAM measurement first, since peak today is 2.9 GB of 8 GB with 3 browser slots.

## 7. Cost per month (estimates)

Variable cost $0.35 per verification, measured (dd42a656 $0.354, f51a2908 $0.349). Price $1.90 (19 credits). Railway adds about $0.006 per verification on top of the replica baseline.

| Verifications / month | Revenue | Verification cost | Railway | Proxy | Gross margin |
|---|---|---|---|---|---|
| 1,000 | $1,900 | $350 | ~$19 (1 replica) | $0 | ~$1,531 (81%) |
| 5,000 | $9,500 | $1,750 | ~$68 (3) | $0 | ~$7,682 (81%) |
| 10,000 | $19,000 | $3,500 | ~$98 (3) | $0 | ~$15,402 (81%) |
| 20,000 | $38,000 | $7,000 | ~$158–196 (3, bursts to 6) | $0 | ~$30,800 (81%) |

Steady state at today's caps is about 3 verifications a minute, so 20,000 a month fits on 1–3 replicas. Replicas are for bursts. The plan subscription and Supabase's own plan aren't included.

**Proxy: none needed, so nothing to buy.** Verify's sources answer the worker directly. SS.ge's refusal must not be worked around. Metering (`PROXY_METERING=1`, free) can measure real bytes before any decision.

## 8. What the controls can and cannot do (verified by tests)

- **Server-side checks** (`validateTarget`) run before any Railway call. A request is refused when it is:
  - not an integer, or outside 1–10;
  - above the plan (Hobby 6);
  - above the owner-approved ceiling (3);
  - over the spending ceiling;
  - more than 1 replica outside QUEUE mode.
- **Every request is logged** in `verify_scaling_events`, whether refused, applied, verified or failed. The log is append-only: update and delete are revoked.
- **Owner-only settings:** the ceiling (`approvedMax`) and the plan can't be changed through the admin API. A request carrying them is refused (`OWNER_APPROVAL_REQUIRED`) and logged. Stored values are clamped to the plan and to 10.
- **One service only:** service, project and environment ids are constants. The client refuses any other `serviceId` before sending. There is no create, delete or connect mutation anywhere, and the edge function never names a service.
- **Read back:** after a change, the count is read back from Railway. "Healthy" counts only replicas that reported in the last 90 s.
- **Not provable without a token:** whether a Railway project token may run `serviceInstanceUpdate`. If Railway refuses it (HTTP 200 with `errors`), the attempt is logged as FAILED and nothing changes. The first approved scale-up is the proof.

## 9. Final one-release checklist

**A. Approval 1 — release at 1 replica** (no Railway cost change)

1. **CI:** #329 green on the final head; read the Linux run.
2. **Merge #329** into main (Vercel ships the page; Railway rebuilds the worker, still 1 replica).
3. **Apply the 7 migrations** `20261205090000…096000` by workflow_dispatch `run_migrations`, before the edge deploy, so the RPCs exist. Then confirm:
   - all seven are in the ledger;
   - the grants are service_role only.
4. **Deploy the edge functions** `research-agent`, `verify-queue`, `verify-synthesis` and `verify-scaling` by targeted dispatch (redeploy blank). Prove each one PROVEN_EXACT and version N→N+1.
5. **Railway:** the worker deployment reaches SUCCESS, `/health/browser` is OK, and a `worker_replicas` row appears within 60 s.
6. **Production health at 1 replica.** Driver ticks claim through `verify_drive_claim` (no `claim_rpc_unavailable` in logs). Then one owner-run live Verify must:
   - reach READY at 19 credits;
   - be charged once;
   - show a queue line if it waits;
   - leave no fenced completion and no stuck lease.
7. **Admin → Verify Scaling** shows live numbers. Railway reads "not configured" until step B1, which is expected.

**B. Approval 2 — scale to 3** (Railway: about +$25/month at today's load, up to +$89 if busy all month)

1. **Owner:** create a Railway project token (production environment) and store it as the Supabase secret `RAILWAY_PROJECT_TOKEN`.
2. **Owner-approved Railway variable:** `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=200`.
3. **Scale:** Admin → Verify Scaling → 3 → confirm. Then:
   - the event reads VERIFIED;
   - Railway shows 3;
   - three healthy heartbeats appear;
   - one live Verify is clean.
4. **Watch for 24 h:** RAM per replica, queue age, and no duplicate tasks or charges.

**C. Prepared only** (each needs its own approval)

- **Ceiling to 6:** Hobby allows it; owner-approved settings change.
- **10 replicas:** needs the Pro upgrade, owner action.
- **Browser slots 3 → 5:** after a RAM check.
- **OpenAI budget:** your tier's RPM/TPM per model.
- **Autoscaler:** Automatic only on your switch.
- **`PROXY_METERING=1`:** for measurement only.

**Rollback at any point:**
- set 1 replica in the Admin page (or the Railway dashboard);
- revert #329, which brings back the old sweep;
- leave the additive schema, or run `verify-scaling-rollback.sql` if you choose to.
