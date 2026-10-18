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
| P1-2 | Free Find Property: one requester's burst starved everyone; 1 search per portal at a time | **PARTLY FIXED** — fair claim order (`20261114110000`). Throughput unchanged: needs more slots or replicas (§5, owner) |
| P1-3 | Verify 2.2 s polling × full-row reads + advance per poll | **PARTLY FIXED** — no second full read on contended polls; no unguarded advance. Cadence and payload unchanged (product behaviour; options in §6) |
| P1-4 | 30 s sweep scanned every completed report's JSON | **FIXED** — `20261114090000`: partial index + literal-predicate function; research-agent falls back until it is applied |
| P1-5 | No enforced global provider spend ceiling; free quotas non-atomic | **NOT CHANGED** — needs owner thresholds (§7). Signed-in assistant turns are wallet-billed (`ai_chat_billing_enabled=true` [PROD]) |
| P2-6 | `cron.job_run_details` 322 MB = 62% of DB | **READY, APPROVAL REQUIRED** — `20261114120000` (port of PR #136) deletes run history older than 7 days |
| P2-7 | Railway idle polling ≈ 2.2 M edge calls / month | **NOT CHANGED** — lowering it delays free-search start; ~$4/month at today's rates |
| P2-8 | Single replica, unbounded in-memory state | **PARTLY FIXED** — finished jobs evicted after 6 h; debug screenshots after 1 h. Replicas → §5 |
| P2-9 | memo23 slot count asymmetric (Find Buyers counts only its own table) | **NOT CHANGED** — lives in `find_buyers_reserve_actor_run` (Find Buyers workstream, PR #251 active). Proposed fix in §6 |
| P2-10 | Wallet reservation sweeper never scheduled | **NOT CHANGED** — releasing "expired" reservations of long campaigns could forfeit legitimate charges; 0 affected today [PROD]. Owner decision |
| P2-11 | Verify budget gate / advance lease failed open | **FIXED** — gate ERROR defers the stage (nothing launched, paused, charged or released); lease error skips the step |
| P2-12 | No overlap guard on `classify-signals-v2` (paid OpenAI) | **NOT CHANGED** — needs a row claim inside the Find Buyers pipeline; design in §6 |
| P2-13 | spend_cap: truncated sum, unauthenticated `spend-cap-check` | **FIXED** — SQL aggregate (`20261114100000`) with paged fallback; read failure refuses the paid send; service role only |
| P2-14 | `homatch-official-worker-v2` live, stale image | **NOT TOUCHED** (instruction). Owner decision |
| P2-15 | AI TALK sockets uncapped in a shared process | **LEVER ADDED** — `SPEECH_MAX_SESSIONS` (unset = unchanged). AI TALK is paused |
| P2-16 | Realtime cost / unfiltered subscriptions | **NOT CHANGED** — see §4 (Realtime connection limit is the first hard wall) |
| — | Verify cancel left a running Developer Ads Actor to its timeout | **FIXED** — stops it under the advance lease, as pause does |

## 3. Before / after measurements

| Path | Before | After | Where |
|---|---|---|---|
| Verify market-refresh sweep (every 30 s) | 51.7 ms, ~12 MB buffers @ 76 completed jobs [PROD]; 181 ms, ~33k buffers @ 2,000 jobs [LOCAL] | 0.05 ms / 2 buffers (index), 0.17 ms via the function @ 2,000 jobs [LOCAL] | `20261114090000` |
| Verify status poll while another advancer holds the job | 2 full-row reads (avg 108 KB [PROD]) | 1 | research-agent |
| Free-search claim, 10,000 queued from 2,000 requesters | ~5 ms, FIFO [LOCAL] | 30–55 ms, fair [LOCAL]; ~0.2 ms at today's sizes | `20261114110000` |
| Spend-cap sum | one select, truncated at max rows | one aggregate row per provider; identical totals on 5,000 rows [LOCAL] | `20261114100000` |

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

1. **Apply the four migrations** in order: `20261114090000`, `20261114100000`, `20261114110000`, `20261114120000`.
   - The first three are additive or behaviour-preserving.
   - **`20261114120000` deletes cron run history older than 7 days** (~240k rows, ~300 MB). It is operational log only, but irreversible.
2. **Railway deploy** of `homatch-official-worker`. The auth change refuses user-token calls to the worker; no product caller uses them.
3. **Edge deploy**: research-agent, spend-cap-check, outreach-send. Email Studio picks up `_shared/spend_cap.ts` on its next deploy.
4. **Behaviour changes to confirm**:
   - Verify: a budget-gate error delays a stage instead of running it.
   - Verify: cancel stops a running Developer Ads Actor.
   - Outreach and Email Studio: an unreadable spend total refuses the send instead of allowing it.
   - Free Find Property: claim order is fair across requesters.
5. **Decisions**:
   - spend cap off / compute upgrade (§5);
   - global provider thresholds (§6.4);
   - wallet sweeper policy;
   - `homatch-official-worker-v2`;
   - a separate AI TALK service vs the CLAUDE.md rule;
   - `SPEECH_MAX_SESSIONS` value before AI TALK is re-enabled.

## 8. Release manifest and rollback

**Release plan**: REPO_FULL (`npm run homatch:release:plan`). Components: RAILWAY, VERIFY, BILLING, EDGE.
- New SQL objects are owned by no component.
- The cron migration touches a platform-global object.

| Piece | Deploy | Proof owed | Rollback |
|---|---|---|---|
| Worker (`official-worker/`) | Railway auto-deploy of `homatch-official-worker` on merge | deployment SUCCESS at the merge commit; `/health`; one Verify job end-to-end; a request with a user JWT → 401 | redeploy previous deployment `b5d45b88` |
| research-agent, spend-cap-check, outreach-send | CI edge deploy | PROVEN_EXACT | redeploy the previous artifact |
| `20261114090000` | migration runner (approved) | ledger row; `research_jobs_market_refresh_running` grants | drop function + 2 indexes (in file header) |
| `20261114100000` | migration runner | ledger row | drop function |
| `20261114110000` | migration runner | ledger row; a free search completes | re-run the 20261010100000 function body; drop index |
| `20261114120000` | migration runner, **after owner approval** | `cron.job` has `homatch-cron-history-retention`; table shrinking | `cron.unschedule(...)`; drop function. **Deleted rows are not restorable** |

**Order**: (1) migrations 090000 → 110000; (2) merge (edge + Railway auto-deploy); (3) 120000 after approval.
- Edge code tolerates the functions being absent (PGRST202 fallbacks).
- Worker and edge changes are independent.

**Tests run on the branch**:
- unit/static `npm test`: 9,328 pass / 0 fail;
- `npm run lint` incl. production build: pass;
- `homatch:check`: pass;
- worker suite: 655 pass / 0 fail / 2 skipped, incl. 15 new;
- `check:edge`: pass;
- `homatch:migrations`: PASS;
- `tests/sql/marketplace_fair_claim/run.sh`: PASS;
- `tests/sql/cron_history_retention/run.sh`: PASS.

Mobile and browser suites run in the PR validation.

**Product-output evidence**: no report, ranking, matching, pricing, credit or translation code changed. The existing Verify (845), shared-edge, Find Buyers, Find Property and pricing suites pass unchanged, apart from one premise update (`marketRefresh.test.mjs` now pins the same columns and filter in their new place).
