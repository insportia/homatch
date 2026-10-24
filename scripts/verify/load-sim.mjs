#!/usr/bin/env node
// Verify at scale — wall-clock projection for a burst of verifications (owner 2026-10-24).
//
// A discrete-event simulation of the official-source stage, which is the shared, capacity-bound part of a
// verification (identity, public research, market and the report run per job on edge functions and OpenAI,
// in parallel, and are added as a measured per-job tail). Inputs are production's own numbers, read 2026-10-24:
//   * verify_source_policy.max_running per source (cluster-wide caps; replicas cannot exceed them)
//   * verify_tasks durations (30 days): lognormal through each source's p50 and p95
//   * tasks per verification as production plans them (see planJob), released at measured offsets
//   * worker slots per replica: HTTP 12, BROWSER 3 (VERIFY_QUEUE_*_SLOTS defaults)
//   * the non-official tail after the last source: p50 197 s, p90 619 s (measured)
// It is a projection, not a measurement of a real burst. The mechanism it assumes (caps, leases, exactly-once,
// drain) is exercised by official-worker/test/loadReplicas.test.mjs with the real QueueRunner.
//
//   node scripts/verify/load-sim.mjs                 the standard table (50 / 200 / 1,000 × 1 / 3 / 6 / 10)
//   node scripts/verify/load-sim.mjs --json          the same, as JSON
//   node scripts/verify/load-sim.mjs --caps mygov=32,tas=36   what-if source caps

export const SOURCES = {
  tas: { lane: 'HTTP', cap: 24, p50: 230, p95: 557 },
  mygov: { lane: 'HTTP', cap: 16, p50: 129, p95: 346 },
  TAS_MAP: { lane: 'BROWSER', cap: 8, p50: 51, p95: 155 },
  enreg: { lane: 'BROWSER', cap: 6, p50: 13, p95: 19 },
  debtor: { lane: 'BROWSER', cap: 6, p50: 5, p95: 7 },
  rstax: { lane: 'BROWSER', cap: 4, p50: 65, p95: 92 },
};
// Measured 2026-10-24 (16 completed verifications, 30 days): non-official time after the last source answered.
export const TAIL = { p50: 197, p95: 800 };
export const SLOTS = { HTTP: 12, BROWSER: 3 };
/* Calibration: this model alone gives one verification a 9 min median; production measures 14.1 min
   (16 jobs, p50 847 s). The ~300 s gap is what the model leaves out (30 s driver ticks, stage hand-offs,
   sequential company checks), added to every job so a single job reproduces the measured median. */
export const JOB_OVERHEAD_S = 300;
/* Measured release offsets (s after submission): TAS / map / MyGov start after identity (~45 s);
   company checks (ENREG, DEBTOR, RS) after public research (~210 s). */
export const RELEASE = { property: 45, company: 210 };

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function lognormal(p50, p95, r) {
  const sigma = Math.log(p95 / p50) / 1.645;
  const z = Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r());
  return Math.min(p95 * 3, p50 * Math.exp(sigma * z));
}

/**
 * One verification's official tasks, matching production's measured mix (per job: TAS 1.00, map 0.94,
 * MyGov 0.75 — one task reads up to 3 records; in 14 of 16 jobs a company owner: ENREG 2.44, DEBTOR 2.38,
 * RS 1.06 per job). No cross-job reuse is assumed (production reused 7 of 39 ENREG and 3 of 38 DEBTOR
 * checks), so a burst of distinct properties is modelled conservatively.
 */
export function planJob(r) {
  const out = [{ s: 'tas', at: RELEASE.property }];
  if (r() < 0.94) out.push({ s: 'TAS_MAP', at: RELEASE.property });
  if (r() < 0.75) out.push({ s: 'mygov', at: RELEASE.property });
  if (r() < 14 / 16) {
    const companies = r() < 0.79 ? 3 : 2; // averages ≈2.8 per company-owned job
    for (let k = 0; k < companies; k++) { out.push({ s: 'enreg', at: RELEASE.company }); out.push({ s: 'debtor', at: RELEASE.company }); }
    out.push({ s: 'rstax', at: RELEASE.company });
    if (r() < 0.3) out.push({ s: 'rstax', at: RELEASE.company });
  }
  return out;
}

export function simulate({ jobs, replicas, caps = {}, browserSlots = SLOTS.BROWSER, seed = 11 }) {
  const r = rng(seed);
  const src = Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => [k, { ...v, cap: caps[k] ?? v.cap }]));
  const pending = []; // not yet released
  const left = new Array(jobs).fill(0);
  for (let j = 0; j < jobs; j++) for (const t of planJob(r)) { pending.push({ job: j, s: t.s, at: t.at, d: lognormal(src[t.s].p50, src[t.s].p95, r) }); left[j]++; }
  pending.sort((a, b) => a.at - b.at);
  const queue = [];
  const slots = { HTTP: SLOTS.HTTP * replicas, BROWSER: browserSlots * replicas };
  const busy = { HTTP: 0, BROWSER: 0 };
  const running = Object.fromEntries(Object.keys(src).map((k) => [k, 0]));
  const busySeconds = Object.fromEntries(Object.keys(src).map((k) => [k, 0]));
  const events = []; // [time, task] completions
  const officialDone = new Array(jobs).fill(0);
  let t = 0;
  const release = () => { while (pending.length && pending[0].at <= t) queue.push(pending.shift()); };
  const dispatch = () => {
    for (let i = 0; i < queue.length; i++) {
      const q = queue[i], s = src[q.s];
      if (busy[s.lane] >= slots[s.lane] || running[q.s] >= s.cap) continue;
      busy[s.lane]++; running[q.s]++; busySeconds[q.s] += q.d;
      events.push([t + q.d, q]);
      queue.splice(i--, 1);
    }
    events.sort((a, b) => a[0] - b[0]);
  };
  while (pending.length || events.length || queue.length) {
    const nextDone = events.length ? events[0][0] : Infinity;
    const nextRelease = pending.length ? pending[0].at : Infinity;
    if (nextRelease <= nextDone) { t = nextRelease; release(); dispatch(); continue; }
    const [at, q] = events.shift();
    t = at;
    busy[src[q.s].lane]--; running[q.s]--;
    if (--left[q.job] === 0) officialDone[q.job] = t;
    release();
    dispatch();
  }
  const finish = officialDone.map((o) => o + JOB_OVERHEAD_S + lognormal(TAIL.p50, TAIL.p95, r)).sort((a, b) => a - b);
  const pct = (p) => finish[Math.min(finish.length - 1, Math.floor(p * finish.length))];
  const makespan = t;
  // What held the burst back: a source at its cluster cap, or a lane's worker slots (too few replicas).
  const laneSeconds = { HTTP: 0, BROWSER: 0 };
  for (const [k, sec] of Object.entries(busySeconds)) laneSeconds[src[k].lane] += sec;
  const binding = [
    ...Object.entries(busySeconds).map(([k, sec]) => [k, sec / (src[k].cap * makespan)]),
    ...Object.entries(laneSeconds).map(([lane, sec]) => [`${lane} worker slots`, sec / (slots[lane] * makespan)]),
  ].sort((a, b) => b[1] - a[1])[0];
  return {
    jobs, replicas,
    officialMinutes: Math.round(makespan / 60),
    p50Minutes: Math.round(pct(0.5) / 60),
    p95Minutes: Math.round(pct(0.95) / 60),
    allDoneMinutes: Math.round(finish[finish.length - 1] / 60),
    bindingSource: binding[0],
    bindingUtilisation: Math.round(binding[1] * 100),
  };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  const capsArg = process.argv.includes('--caps') ? process.argv[process.argv.indexOf('--caps') + 1] : '';
  const browserSlots = process.argv.includes('--browser-slots') ? Number(process.argv[process.argv.indexOf('--browser-slots') + 1]) : SLOTS.BROWSER;
  const caps = Object.fromEntries(capsArg.split(',').filter(Boolean).map((kv) => { const [k, v] = kv.split('='); return [k, Number(v)]; }));
  const rows = [];
  for (const jobs of [50, 200, 1000]) for (const replicas of [1, 3, 6, 10]) rows.push(simulate({ jobs, replicas, caps, browserSlots }));
  if (process.argv.includes('--json')) console.log(JSON.stringify({ caps: { ...Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => [k, v.cap])), ...caps }, rows }, null, 2));
  else {
    console.log(`browser slots per replica: ${browserSlots}`);
    console.log(`caps: ${Object.entries(SOURCES).map(([k, v]) => `${k}=${caps[k] ?? v.cap}`).join(' ')}`);
    console.log('jobs  replicas  official-stage  p50 job  p95 job  all done  binding source');
    for (const r of rows) console.log(`${String(r.jobs).padStart(4)}  ${String(r.replicas).padStart(8)}  ${String(r.officialMinutes).padStart(10)} min  ${String(r.p50Minutes).padStart(4)} min  ${String(r.p95Minutes).padStart(4)} min  ${String(r.allDoneMinutes).padStart(5)} min  ${r.bindingSource} (${r.bindingUtilisation}%)`);
  }
}
