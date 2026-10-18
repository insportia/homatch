# CAPACITY — what HOMATCH can carry, what was hardened, what still needs a decision

Source: the read-only production capacity audit of 2026-10-18, and the hardening branch
`claude/architecture-viewer-repair-mqdt18` built from it. Every number is labelled:

- **[PROD]** — measured in production on 2026-10-18.
- **[CODE]** — read from main @ `a3e6d115`.
- **[LOCAL]** — measured on a throwaway Postgres 16 / Node 22 in the session sandbox. Never production.
- **[MODEL]** — arithmetic on measured inputs. It is **UNVERIFIED** as throughput: no load test was run, by instruction.

**10,000 simultaneous users is NOT demonstrated.** This document says what blocks it and what each step costs.

## 1. Production baseline (2026-10-18) [PROD]

| Item | Value |
|---|---|
| Supabase | Pro org, project `ptxajsjhobhvsfhmutjn`, **Small** compute (2-core ARM shared, 2 GB, `max_connections` 90, pooler 400 clients), Postgres 17.6, DB 517 MB, ledger head `20261020090000` |
| Railway | `homatch-official-worker`: 1 replica, `ams`, ceiling 8 vCPU / 8 GB, deployment `b5d45b88` @ `8218107c` (no `official-worker/` change on main since). 7-day CPU avg 0.006 vCPU, memory avg 0.71 / peak 1.69 GB |
| Railway | `homatch-official-worker-v2`: live, idle (~60 MB, 0 network for 7 days), image from 2026-09-07. Untouched |
| Vercel | `homatch` static Vite SPA (no functions); latest production `dpl_3n2h2ebBrP7tNXj55iQaWGqRjFp2` READY |
| Load | 17 auth users (12 active / 7 days); 0 active Verify jobs; 0 open wallet reservations; credits 99,607.33 held, 0 reserved |
| Edge calls / day | ~86,000 (marketplace-worker-ingest 65,682 — Railway idle polling; verify-queue 9,189) |
| Provider COGS (30 days) | APIFY_MEMO23 $7.76 · OpenAI $8.96 · other $0.01 |

## 2. Audit findings → status

| # | Finding | Status on this branch |
|---|---|---|
| P1-1 | Worker accepted any user JWT on `/research`, `/verify/*`, `/tas/test` (bypassed billing, switch, limits) | **FIXED** — `official-worker/src/http/workerAuth.ts`: `WORKER_TOKEN` only, constant-time, 503 when unset. Every caller verified to send the token |
| P1-2 | Free Find Property: one requester's burst starved everyone; 1 search per portal at a time | **PARTLY FIXED** — fair claim order moved to PR #266 (`20261116090000`, with shared portal runs and the live-search quota). Throughput unchanged: needs more slots or replicas (§5, owner) |
| P1-3 | Verify 2.2 s polling × full-row reads + advance per poll | **PARTLY FIXED** — no second full read on contended polls; no unguarded advance. Cadence and payload unchanged (product behaviour; options in §6) |
| P1-4 | 30 s sweep scanned every completed report's JSON | **FIXED** — `20261115090000`: partial index + literal-predicate function; research-agent falls back until it is applied |
| P1-5 | No enforced global provider spend ceiling; free quotas non-atomic | **NOT CHANGED** — needs owner thresholds (§7). Signed-in assistant turns are wallet-billed (`ai_chat_billing_enabled=true` [PROD]) |
| P2-6 | `cron.job_run_details` 322 MB = 62% of DB | **REMOVED FROM THIS RELEASE** (zero-data-loss rule, 2026-10-18): the retention migration deletes history and is not on this branch. Proposal stays on PR #136; not urgent (Pro includes 8 GB disk) |
| P2-7 | Railway idle polling ≈ 2.2 M edge calls / month | **NOT CHANGED** — lowering it delays free-search start; ~$4/month at today's rates |
| P2-8 | Single replica, unbounded in-memory state | **NOT CHANGED** — an eviction was written and then withdrawn: property-mode Verify reads finished worker jobs back, and a late read could have lost official results. A safe version needs research-agent to acknowledge the harvest first. Replicas → §5 |
| P2-9 | memo23 slot count asymmetric (Find Buyers counts only its own table) | **NOT CHANGED** — lives in `find_buyers_reserve_actor_run` (Find Buyers workstream, PR #251 active). Proposed fix in §6 |
| P2-10 | Wallet reservation sweeper never scheduled | **NOT CHANGED** — releasing "expired" reservations of long campaigns could forfeit legitimate charges; 0 affected today [PROD]. Owner decision |
| P2-11 | Verify budget gate / advance lease failed open | **FIXED** — gate ERROR defers the stage (nothing launched, paused, charged or released); lease error skips the step |
| P2-12 | No overlap guard on `classify-signals-v2` (paid OpenAI) | **NOT CHANGED** — needs a row claim inside the Find Buyers pipeline; design in §6 |
| P2-13 | spend_cap: truncated sum, unauthenticated `spend-cap-check` | **FIXED** — SQL aggregate (`20261115100000`) with paged fallback; read failure refuses the paid send; service role only |
| P2-14 | `homatch-official-worker-v2` live, stale image | **NOT TOUCHED** (instruction). Owner decision |
| P2-15 | AI TALK sockets uncapped in a shared process | **LEVER ADDED** — `SPEECH_MAX_SESSIONS` (unset = unchanged). AI TALK is paused |
| P2-16 | Realtime cost / unfiltered subscriptions | **NOT CHANGED** — see §4 (Realtime connection limit is the first hard wall) |
| — | Verify cancel left a running Developer Ads Actor to its timeout | **FIXED** — stops it under the advance lease, as pause does |

## 3. Before / after measurements

| Path | Before | After | Where |
|---|---|---|---|
| Verify market-refresh sweep (every 30 s) | 51.7 ms, ~12 MB buffers @ 76 completed jobs [PROD]; 181 ms, ~33k buffers @ 2,000 jobs [LOCAL] | 0.05 ms / 2 buffers (index), 0.17 ms via the function @ 2,000 jobs [LOCAL] | `20261115090000` |
| Verify status poll while another advancer holds the job | 2 full-row reads (avg 108 KB [PROD]) | 1 | research-agent |
| Free-search claim, 10,000 queued from 2,000 requesters | ~5 ms, FIFO [LOCAL] | 30–55 ms, fair [LOCAL]; ~0.2 ms at today's sizes | PR #266 |
| Spend-cap sum | one select, truncated at max rows | one aggregate row per provider; identical totals on 5,000 rows [LOCAL] | `20261115100000` |

## 4. Capacity model [MODEL — UNVERIFIED]

"Users" = open signed-in tabs. Heavy jobs are counted separately.

**Idle tab** [CODE]: JobsContext RPC every 30 s + service controls every 60 s ≈ 0.05 req/s, plus one Realtime socket.

| | 1,000 users | 5,000 users | 10,000 users |
|---|---|---|---|
| PostgREST from idle tabs | ~50 req/s | ~250 req/s | ~500 req/s (~0.2 DB core at 0.4 ms) |
| **Realtime sockets** | **1,000 > 500 Pro limit with spend cap ON** [official docs] | 5,000 | 10,000 = Pro (spend cap OFF) limit |
| Realtime peak-connection cost (500 incl., $10 / 1,000) | ~$5/mo | ~$45/mo | ~$95/mo |

**The Realtime connection limit is the first hard wall, at about 500 open tabs.** Raising it means turning the Supabase spend cap off (owner, §7).

**Heavy workloads** (measured inputs; throughput is per the current single replica):

| Workload | Measured input | Throughput today | 10,000 queued | Notes |
|---|---|---|---|---|
| Verify | p50 11.5 min, p95 23.1 min / job [PROD]; 3 browser + 12 HTTP queue slots, 4 legacy | **UNKNOWN** — per-task lane time not instrumented; order of tens of jobs/hour per replica | days | DB: each active tab polls every 2.2 s; at ~20 ms DB per poll a Small instance saturates near **~200 concurrently running Verify jobs**; edge calls ≈ 0.45/s per running job (~$78/day overage at 1,000) |
| Free Find Property | 1 run per portal at a time; Home.ge p50 146 s, SS.ge 114 s, Allhome 86 s, Place 54 s, MyHome 13 s [PROD] | **≈25 complete searches / hour** (Home.ge-bound) | ≈17 days | Fair now; throughput needs slots (portal politeness) or replicas with DB-coordinated pacing |
| Find Buyers | 4 global memo23 slots; run p50 33 s / p95 128 s; ~25 runs / campaign; avg $0.03 / run [PROD] | ≈436 runs/h ≈ **17 campaigns / hour** | ≈23 h of runs | `APIFY_MEMO23` is an admin setting; the Apify account's own concurrency ceiling is **UNKNOWN** |
| Publishing | paused; migration `20261108090000` not applied | 0 | — | Up to `min(4, PUBLISHING_CONCURRENCY)` contexts, one browser |
| AI TALK | paused; allowance `global_concurrent` 500 [PROD] | 0 | — | Separate it from Chromium before enabling at scale (§5) |
| Design Studio | paused; no global RunPod cap [CODE] | 0 | — | RunPod account ceiling **UNKNOWN** |

**"10,000 simultaneously executing heavy jobs" is not possible by design**:
- One 8 GB replica holds roughly 15–20 headed Chromium.
- Portals run one search at a time each.
- memo23 runs on 4 slots.

That ceiling is deliberate (politeness and spend). Raising it means more replicas or slots and a measured load test (§5, §7).

## 5. Infrastructure recommendations (none purchased; all require owner approval)

| Step | When (measured trigger) | Cost (official rates) |
|---|---|---|
| Supabase spend cap OFF (Realtime > 500, edge overage) | before ~500 concurrent tabs | usage-based: edge $2 / 1M over 2M; Realtime $10 / 1,000 peak over 500; egress $0.09/GB over 250 GB |
| Supabase compute Small → **Large** (2 dedicated cores, 8 GB, 160 conns, 800 pooler) | DB CPU > 60% sustained, or > ~100 running Verify jobs | ~$110/mo vs ~$15 |
| → **XL** (4 dedicated cores, 16 GB, 240 conns) | 10,000-user target | ~$210/mo |
| Railway second worker replica | after the legacy `/research` path is unused (QUEUE is replica-safe) and portal pacing is DB-coordinated | usage-based: $20 / vCPU-month, $10 / GB-month; today's replica ≈ 0.7 GB avg ≈ $7/mo RAM + CPU |
| Separate AI TALK speech from browser jobs | before enabling AI TALK at scale | **conflicts with CLAUDE.md "never create another Railway service"** — owner decision |
| Railway workspace hard usage limit + email alert | now | free setting (Workspace → Usage → Set Usage Limits) |

Vercel serves static assets only: entry ≈ 2 MB raw / ≈ 0.57 MB gzip, `public/` 11 MB. Its plan and included bandwidth are **UNKNOWN** from this session.

Rates sources:
- Supabase docs: Manage Compute usage; Compute and Disk; About billing; Realtime Limits.
- Railway docs: pricing (`$20/vCPU-month`, `$10/GB-month`); cost-control (hard limit).

## 6. Proposed next changes (designed, not implemented here)

1. **Verify polling**:
   - poll at 4–5 s outside stage changes (today 2.2 s);
   - serve unchanged progress from `updated_at` without reading the report.

   Both change product timing. They need explicit approval and a Verify protected-surface review.
2. **memo23 slots** (Find Buyers workstream): count `find_property_actor_runs` in `find_buyers_reserve_actor_run` exactly as `find_property_reserve_actor_run` already counts both, and add a stale sweep for `find_property_actor_runs`. Coordinate with PR #251.
3. **classify-signals-v2 claim**:
   - a nullable `raw_signals.classification_claimed_until`;
   - a `raw_signals_claim_pending(limit, source, lease)` RPC using SKIP LOCKED;
   - the function reads through it.

   Overlapping cron and campaign calls then never pay twice.
4. **Global provider ceilings**: one shared guard at `openaiFetch` / memo23 reserve that reads the existing `spend_cap_*` settings. Shadow mode first (log only), enforcement switch per provider. Owner sets the thresholds.
5. **Atomic free quotas**:
   - a `rate_limit_reserve` / `rate_limit_refund` pair (advisory lock per subject);
   - homatch-ai, investment-consultant and Design Studio hourly limits use it, with the same numbers.

## 7. Owner approvals required

1. **Apply two migrations** in order: `20261115090000`, `20261115100000`. (The fair claim, formerly `20261115110000`, moved to PR #266.)
   - The first two are additive: new indexes and new functions, with no row changes.
   - **No migration in this release deletes or rewrites a row.**
2. **Railway deploy** of `homatch-official-worker`. The only effective change is the auth rule: user tokens on privileged routes return 401. No product caller uses them.
3. **Edge deploy**: research-agent, spend-cap-check, outreach-send. Email Studio picks up `_shared/spend_cap.ts` on its next deploy.
4. **Behaviour changes to confirm**:
   - Verify: a budget-gate error delays a stage instead of running it.
   - Verify: cancel stops a running Developer Ads Actor.
   - Outreach and Email Studio: an unreadable spend total refuses the send.
   - Free Find Property: claim order is fair across requesters.
5. **Decisions, separate from this release**:
   - cron history retention (PR #136, deletes history);
   - spend cap off / compute upgrade (§5);
   - global provider thresholds (§6.4);
   - wallet sweeper policy;
   - `homatch-official-worker-v2`;
   - a separate AI TALK service vs the CLAUDE.md rule;
   - `SPEECH_MAX_SESSIONS` value.

## 8. Data integrity and regression protection

**Not touched by this release** (verified by diff against main):
- Cloudflare R2 and Supabase Storage: no file, bucket, object key, URL, policy or credential.
- Design Studio and the RunPod pipeline.
- Wallet, payment and credit SQL or edge code.
- Publishing, MyHome.ge, Find Buyers.
- Every frontend file.
- Every Railway variable.
- The v2 service.

**Changed services**:

| Service | Change | Data written differently? |
|---|---|---|
| `homatch-official-worker` | token-only auth; optional `SPEECH_MAX_SESSIONS` (unset) | no |
| research-agent | indexed sweep read (same rows); lease/gate errors delay instead of running; one fewer read per contended poll; cancel stops a running Developer Ads Actor under the lease and records its cost | cancel: a `cost_events` row for the aborted Actor (previously its cost went unrecorded); `result_json` is never written by cancel |
| spend-cap-check, outreach-send, Email Studio (shared `spend_cap.ts`) | correct monthly sum; refuse on unknown spend; service-role-only endpoint | no (outreach / email sending are OFF in production) |
| Postgres | two indexes, two read-only functions, claim order | no |

**Production regression baseline** (read-only counts, 2026-10-18 05:38 UTC). Re-check after deploy: every count may only grow, and the sums must not change except through customer activity.

| research_jobs | COMPLETE | Find Property searches / runs / listings | Find Buyers campaigns / assessments / actor runs | matches / UNLOCKED |
|---|---|---|---|---|
| 99 | 76 | 31 / 81 / 5,591 | 10 / 3,333 / 253 | 75 / 14 |

| deal-room documents | Design Studio projects / walkthroughs | credit accounts / balance sum / reserved | credit_ledger / reservations / payments | cost_events / USD |
|---|---|---|---|---|
| 12 | 24 / 35 | 24 / 99,607.33 / 0 | 153 / 43 / 2 | 1,758 / 44.2995 |

| storage.objects / buckets | R2 registry (`storage_objects`) | cron jobs | service controls |
|---|---|---|---|
| 292 / 16 | 11,661 | 18 | 20 |

**Remaining risks** (accepted only with approval):
- A persistent `verify_budget_gate` or advance-lease error now **delays** billed Verify stages instead of running them unguarded. It is logged (`verify_budget_gate` / `verify_advance_lease`); production Postgres logged 0 errors in the 24 h before.
- The capacity limits in §4 are unchanged by this release except fairness and DB load.

## 9. Release manifest, deployment sequence, rollback, baseline comparison

**Release plan**: REPO_FULL (`npm run homatch:release:plan`). Components: RAILWAY, VERIFY, BILLING, EDGE. Owed functions: research-agent, spend-cap-check, outreach-send. Migrations: 3.

**Deployment sequence** (each step only after the owner's approval; stop at the first failed proof):

0. **Pre-flight**, read-only:
   - re-run the baseline query below and save the output;
   - confirm `claim_marketplace_worker_runs` md5 is still `2aa4d3035c73ab287426d65ebd7acf1f`;
   - confirm no Verify job is mid-stage (`research_jobs` live statuses = 0, or note them).
1. **Migrations**, through the approved runner, in order: `20261115090000_verify_sweep_indexes`, `20261115100000_provider_spend_totals`.
   - Proof: two ledger rows.
   - `research_jobs_market_refresh_running` and `provider_spend_totals_since` are executable by `service_role` only.
   - The two research_jobs indexes and the runs index exist.
   - `claim_marketplace_worker_runs` keeps SECURITY DEFINER, `search_path=""` and service-role-only execute.
   - Old edge code keeps working: it does not call the new functions.
2. **Merge PR #253**:
   - CI deploys research-agent, spend-cap-check and outreach-send. Proof: PROVEN_EXACT.
   - Railway auto-deploys `homatch-official-worker`, because `official-worker/` changed. Proof: deployment SUCCESS at the merge commit and `/health` OK.
   - Vercel redeploys the unchanged frontend. Proof: READY at the merge commit.
3. **Smoke checks**, bounded, no paid runs:
   - a worker call with a user JWT on `/research` → 401;
   - with `WORKER_TOKEN` → unchanged;
   - one free Find Property search completes;
   - `pg_stat_statements` mean for the market-refresh read falls from ~51.7 ms;
   - `homatch-verify-driver` keeps succeeding;
   - research-agent logs show no `SKIPPED_NO_LEASE` / `ERROR_DEFERRED` bursts.
4. **Baseline comparison**, the same query as step 0:
   - counts may only grow;
   - credit balance/reserved, ledger, payment and cost totals change only by real customer activity in the window;
   - storage object counts and the R2 registry may only grow.

**Baseline query** (read-only; counts and sums only, no customer content):

```sql
select now(),
 (select count(*) from research_jobs), (select count(*) from research_jobs where status='COMPLETE'),
 (select count(*) from discovery_marketplace_searches), (select count(*) from discovery_marketplace_worker_runs),
 (select count(*) from discovery_marketplace_listings),
 (select count(*) from find_buyers_campaigns), (select count(*) from find_buyers_assessments), (select count(*) from find_buyers_actor_runs),
 (select count(*) from matches), (select count(*) from matches where status::text='UNLOCKED'),
 (select count(*) from deal_room_documents), (select count(*) from ds_projects), (select count(*) from ds_walkthroughs),
 (select count(*) from credit_accounts), (select sum(balance) from credit_accounts), (select sum(reserved) from credit_accounts),
 (select count(*) from credit_ledger), (select count(*) from usage_reservations), (select count(*) from payments),
 (select count(*) from cost_events), (select round(sum(coalesce(cost_usd,0))::numeric,4) from cost_events),
 (select count(*) from storage.objects), (select count(*) from storage.buckets), (select count(*) from storage_objects),
 (select count(*) from cron.job), (select count(*) from service_controls);
```

**Rollback** (no step deletes data; each is independent):

| Piece | Rollback |
|---|---|
| Worker | Railway: redeploy the previous deployment (`b5d45b88` @ `8218107c`) |
| research-agent / spend-cap-check / outreach-send | CI `redeploy=<fn>` from the previous main commit; prove PROVEN_EXACT |
| `20261115100000` | `drop function if exists public.provider_spend_totals_since(timestamptz);` (spend_cap.ts falls back to paging) |
| `20261115090000` | `drop function if exists public.research_jobs_market_refresh_running(integer); drop index if exists public.research_jobs_market_refresh_running_idx; drop index if exists public.research_jobs_developer_ads_cache_idx;` (research-agent falls back to the PostgREST filter) |

**Answers to the owner's pre-deployment questions (2026-10-18)**

1. **Results, calculations and data preserved**:
   - No report, ranking, matching, pricing, credit, wallet or storage code changed (diff §8).
   - Each behaviour change only alters what happens on an error or under contention.
2. **Budget-gate failures cannot strand a job permanently**:
   - ERROR writes nothing, so the job stays the oldest in the drive sweep and is retried every 30 s (a transient error costs ≤30 s).
   - If the error persists past the driver window (6 h from creation), the existing reaper marks the job FAILED with its evidence untouched. The budget sweep then closes it as SYSTEM_FAILED, which releases the whole reservation: the customer pays nothing.
   - The reservation TTL is 12 h, longer than the 6 h window.
   - Pinned by `budgetGateFailsClosed.test.mjs`.
   - Cost of a persistent gate fault: one of the 6 drive slots per tick is spent re-trying that job.
3. **Developer Ads cancellation**:
   - Cancel never writes `result_json`; collected evidence and completed stages are kept (existing guard test).
   - The aborted run's cost is booked once (`costRecorded`, under the advance lease) and priced by `verify_job_cost` like any non-OpenAI provider cost.
   - `verify_billing_close('STOPPED')` charges what was incurred, capped by the authorisation, and releases the rest — identical to pause.
   - Before, the Actor ran on unrecorded and HOMATCH carried that COGS (≤ $0.50, `maxChargeUsd`).
   - The research-agent `cancel` action has **no frontend caller today**: the Verify page's Stop uses `pause`.
4. **Spend-check failures**:
   - They return a distinct reason: outreach-send `423 {blocked, reason:'SPEND_UNKNOWN'}`; Email Studio `state:'SPEND_UNKNOWN'`, shown as "temporarily unavailable".
   - They are logged (`spend_cap` / `SPEND_UNKNOWN_REFUSED`).
   - Both refuse before any send is claimed or written, so nothing is lost and a retry works.
   - Outreach and Email Studio sending are OFF in production.
5. **Free Find Property**: the claim's eligibility, locks, caps, lease and UPDATE/SET clause are byte-identical. Only the ORDER of queued runs changes, and each run's request, adapter, parsing and result processing are untouched.
   - Coverage: every claimable run is still claimed exactly once (SQL proof 60/60).
   - Quality: unchanged per run.
   - Under contention, waiting is redistributed: a requester with many queued searches waits longer for their later ones, and others less. A run that reaches its deadline before being claimed is TIMED_OUT exactly as before. Today's median claim wait is 3–4 s [PROD], so no customer-visible effect is expected at current load.

## 10. Test results (branch head after merging main @ `d1f18bbb`)

| Check | Result |
|---|---|
| `npm test` (unit + static) | 9,332 pass / 0 fail |
| `npm run lint` (incl. production build) | pass |
| `npm run homatch:check` (typecheck, i18n, affected suites) | pass |
| `npm run check:edge` | all 102 edge functions pass |
| `npm run homatch:migrations` | PASS |
| worker `node --test` | 649 pass / 0 fail / 2 skipped (9 new) |
| mobile / browser suites | run by the PR validation — **not yet run** |

**Product-output evidence**:
- No report, ranking, matching, pricing, credit, translation or storage code changed.
- The existing Verify, shared-edge, Find Buyers, Find Property and pricing suites pass unchanged, except one premise update: `marketRefresh.test.mjs` pins the same columns and filter in their new place.
- The one existing guard that touched a changed path ("cancelling discards collected evidence") was kept, and the code was adapted to it.
