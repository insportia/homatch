# Verify at scale — release package for owner approval (2026-10-24)

Branch `claude/verify-scale`: 13 commits, built on the existing pipeline and touching no other workstream.
**Nothing has been deployed, migrated, scaled, bought or configured.** Each step in §6 waits for an explicit "yes".

## 1. What changed

| Area | Change | Default after deploy |
|---|---|---|
| Driver | `verify_drive_claim`: one atomic batch claim per tick (`FOR UPDATE SKIP LOCKED`, fair per user, claim re-checked on the locked row), jobs stepped concurrently, chained fan-out (≥180 jobs per 30 s tick) | on; falls back to the old sweep if the RPC is missing |
| Queue UX | time spent waiting is not counted against the execution deadline (3 h queue cap); waiting jobs show their position and a measured ETA in all six languages | on |
| Replica safety | market runs stored in the database; cluster slots for MyHome, the Telegram session and each portal's crawler; 180 s drain on shutdown, after which leases are released back to the queue | on (behaves exactly as before with one replica) |
| Network layer | per-domain proxy routing (sticky or rotating), exact byte metering per job, worker and domain, breakers that **suspend** a blocking domain rather than rotate IPs | **off**: nothing is proxied; metering is off until `PROXY_METERING=1` |
| OpenAI | shared per-model RPM/TPM budget across all edge invocations; Retry-After honoured; a report the model can't finish is **retried, never marked READY half-written** | budget **unset** (no limit) until `admin_settings.openai_limits` is filled in |
| Scaling | `verify-scaling` edge function: admin-only, re-checked on the server, confirmation required, every attempt logged; Railway token server-side only; only `homatch-official-worker` can be touched | **MANUAL**; owner-approved ceiling 3; autoscaler **off** |
| Admin | System → **Verify Scaling**: current, desired and healthy replicas; queue depth and age; throughput; p95; RAM and CPU; cost per replica count; 1–10 controls; autoscaler; per-replica heartbeats; scaling log | — |
| Load tests | the real `QueueRunner` at 50, 200 and 1,000 jobs on 1, 3 and 6 replicas, plus a scale-down mid-burst; a burst simulator fed by production durations | — |

7 migrations, all additive (new tables and functions plus one index; nothing dropped or altered):
`20261205090000_verify_drive_claim`, `…091000_verify_queue_position`, `…092000_verify_market_runs`,
`…093000_worker_global_semaphore`, `…094000_proxy_usage_events`, `…095000_openai_rate_budget`, `…096000_verify_scaling`.
These were audited by the database auditor; its two Medium findings (double claim, unindexed throughput scan) are fixed.

## 2. Test results (local, 2026-10-24)

- Worker: **746 / 746** passing, including load tests: 1,000 jobs scaled from 6 to 3 replicas mid-burst, every task completed exactly once, 13 tasks handed back on drain, 0 fenced completions.
- PGlite behaviour checks: driver claim, queue position, semaphore and market runs, OpenAI budget, scaling metrics — all OK.
- Frontend suite: all 793 files run in chunks (Windows can't spawn them in one command line; CI on Linux can). Every failure is pre-existing on Windows and also fails in the main checkout (path handling), or is a Design Studio speed test that passes when run alone.
- `check:edge` (103 functions), the migrations gate, tsgo, biome, all i18n gates, and the production build pass.
- **Not verified:** the Railway mutation (`serviceInstanceUpdate` with `multiRegionConfig`, then a redeploy) has not been run against the real API, because there is no token yet. If Railway rejects it, the event is logged as FAILED and nothing changes. The first real scale-up is the proof.

## 3. Railway

- **Current:** 1 replica in region `ams`, 8 vCPU / 8 GB limit per replica. Measured over 7 days: **1.24 GB RAM average (peak 2.92 GB), 0.013 vCPU average (peak 0.76)**.
- **Plan:** this is a personal workspace, so most likely **Hobby** — please confirm in Railway → Billing. Hobby allows **6 replicas** per service and 48 vCPU / 48 GB in total; 6 × 8 GB fits exactly. **10 replicas need Pro** ($20/month subscription instead of $5). The system will never upgrade the plan itself.
- **Price** (Railway's published rates): RAM $10 per GB-month, CPU $20 per vCPU-month, billed per minute on actual use.

| Replicas | Light load (measured average) | Busy all month (measured peak) |
|---|---|---|
| 1 (today) | $12.66 | $44.30 |
| 3 | $37.98 (**+$25.32**) | $132.90 |
| 6 | $75.96 (**+$63.30**) | $265.80 |
| 10 (Pro) | $126.60 + $15 for the plan difference | $443.00 |

Railway bills real usage, so the real figure sits between the two columns, much closer to "light" at today's volume. The Admin page recomputes this table from live metrics.

**When you click Scale Up / Scale Down:**
1. The server checks your admin rights again, then the plan limit, your approved ceiling, the spending ceiling and QUEUE mode.
2. It sets the replica count through Railway's API, and Railway redeploys the same commit.
3. Running workers get up to 3 minutes (`VERIFY_QUEUE_DRAIN_SECONDS=180`) to finish. Anything still running after that goes back to the queue and continues on another replica. No task runs twice, and a verification is charged once, only when its report is READY.
4. The count is read back from Railway and the whole event is logged. "Healthy" in the Admin counts only replicas that have reported in the last 90 s.

Side effect: a scale change restarts the existing replica too. A browser task cut off after 3 minutes runs again, which can mean one extra CAPTCHA solve (a few cents).

## 4. Throughput (measured inputs → projection)

Inputs, all from production on 2026-10-24:

- per-source concurrency caps: TAS 24, MyGov 16, TAS_MAP 8, ENREG 6, DEBTOR 6, RS 4;
- task durations: TAS p50 230 s, MyGov p50 129 s (1–3 records per job), map 51 s, RS 65 s;
- each job's non-official stages: about 5–15 min.

Run `node scripts/verify/load-sim.mjs` to reproduce the table.

| Burst | 1 replica | 3 replicas | 6 replicas | 6 replicas + caps MyGov 32 / TAS 36 |
|---|---|---|---|---|
| 50 | p95 50 min | p95 27 min | p95 27 min | p95 20 min |
| **200** | p95 160 min, all ~172 | **p50 43, p95 70, all ~87 min** | same as 3 | p50 25, p95 43, all ~68 min |
| 1,000 | ~13.5 h | ~5.8 h | ~5.8 h | ~3.1 h |

- **1,000 simultaneous submissions are accepted**: they're durable, each gets a position and ETA, and queue time never times out the execution.
- **Past 3 replicas the limit is the source caps, not replicas.** MyGov's cap of 16 binds first (94% utilised). Six or ten replicas don't shorten a 200-job burst until those caps rise.
- **All 200 done in 30 minutes is not reachable** with these sources: one verification alone needs about 8–15 min, and MyGov/TAS answer at their own pace. Raising the caps means putting more simultaneous load on my.gov.ge and TAS. That is your decision. If you take it, raise them gradually, with the breakers watching for blocks; proxies must never be used to get around a limit.
- Steady state at current caps is about 2.8 verifications a minute (about 4,000 a day), so 10k–20k a month fits on 1–3 replicas. Bursts are the only reason to scale.

## 5. Cost model per month

Measured inputs: price $1.90 (19 credits); variable cost **$0.35 per verification** (dd42a656 cost $0.354, f51a2908 $0.349); Railway about $0.006 per verification on top of the replica baseline.

| Verifications / month | Revenue | Verification cost | Railway (replicas) | Proxy | Gross margin |
|---|---|---|---|---|---|
| 1,000 | $1,900 | $350 | ~$19 (1) | $0 | ~$1,531 (81%) |
| 5,000 | $9,500 | $1,750 | ~$68 (3) | $0 | ~$7,682 (81%) |
| 10,000 | $19,000 | $3,500 | ~$98 (3) | $0 | ~$15,402 (81%) |
| 20,000 | $38,000 | $7,000 | ~$158–196 (3, bursts to 6) | $0 | ~$30,800 (81%) |

The plan subscription ($5 on Hobby, $20 on Pro) and Supabase's own plan are separate and not included. These are estimates from measured usage, not guarantees.

## 6. Proxy

**Recommendation: don't buy a package now.**

- Verify's official sources answer this worker directly, so nothing needs a proxy.
- The one source that refuses us, SS.ge (`SSGE_ACCESS_DENIED`), must not be worked around with rotating IPs.
- First, turn on `PROXY_METERING=1`. It's free and measures real bytes per job and domain.
- Decide on a package only if a source starts limiting by IP for legitimate traffic. Then use pay-as-you-go: Geonode from $0.79/GB, Shifter $2–3.5/GB (84K+ Georgian IPs), DataImpulse $4–5/GB.

Estimate, unmeasured until metering runs: 5–15 MB per verification with images, fonts and trackers blocked, so **about 5–15 GB per 1,000 verifications**, or roughly $4–75 per 1,000 depending on the provider.

## 7. Steps that need your explicit "yes"

1. **Open a PR and merge it after green CI.**
   - Vercel ships the Admin page.
   - Railway redeploys the worker, still at 1 replica.
   - The edge functions `research-agent`, `verify-queue`, `verify-synthesis` and `verify-scaling` deploy by targeted dispatch.
2. **Apply the 7 migrations** (workflow_dispatch with `run_migrations`), before the edge deploy so the new RPCs exist.
3. **Railway credential:**
   - create a Railway *project token* for the production environment and store it as Supabase secret `RAILWAY_PROJECT_TOKEN`; that's yours to create;
   - set Railway variable `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=200`, so Railway waits out the 180 s drain.
4. **Optional:** set `admin_settings.openai_limits` to your OpenAI tier's RPM/TPM per model. I need those numbers from you.
5. **Scale 1 → 3** from Admin → Verify Scaling: about **+$25 a month** at today's load.
6. **Later, only if needed:** raise the approved ceiling to 6, raise the MyGov/TAS caps, or enable the autoscaler.

## 8. Rollback

- **Replicas:** set 1 in the Admin page, or in the Railway dashboard.
- **Code:** revert the merge. Every new path falls back:
  - the driver goes back to the old sweep;
  - the network layer is already off;
  - the autoscaler is already MANUAL.
- **Migrations:** purely additive. Leaving them in place after a code revert is harmless.
