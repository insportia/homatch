#!/usr/bin/env node
// Verify at scale — wall-clock projection for a burst of verifications (owner 2026-10-24).
//
// A discrete-event simulation of the official-source stage, which is the shared, capacity-bound part of a
// verification (identity, public research, market and the report run per job on edge functions and OpenAI,
// in parallel, and are added as a measured per-job tail). Inputs are production's own numbers, read 2026-10-24:
//   * verify_source_policy.max_running per source (cluster-wide caps; replicas cannot exceed them)
//   * verify_tasks durations (30 days): lognormal through each source's p50 and p95
//   * tasks per verification: TAS, the map, 1–3 MyGov records, ENREG+DEBTOR+RS for ~40% (company owners)
//   * worker slots per replica: HTTP 12, BROWSER 3 (VERIFY_QUEUE_*_SLOTS defaults)
//   * the non-official tail: research_jobs total minus official span, p50 ≈ 330 s, p95 ≈ 900 s
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
export const TAIL = { p50: 330, p95: 900 };
export const SLOTS = { HTTP: 12, BROWSER: 3 };

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function lognormal(p50, p95, r) {
  const sigma = Math.log(p95 / p50) / 1.645;
  const z = Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r());
  return Math.min(p95 * 3, p50 * Math.exp(sigma * z));
}

export function simulate({ jobs, replicas, caps = {}, seed = 11 }) {
  const r = rng(seed);
  const src = Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => [k, { ...v, cap: caps[k] ?? v.cap }]));
  const queue = [];
  const left = new Array(jobs).fill(0);
  for (let j = 0; j < jobs; j++) {
    const add = (s) => { queue.push({ job: j, s, d: lognormal(src[s].p50, src[s].p95, r) }); left[j]++; };
    add('tas'); add('TAS_MAP');
    const records = 1 + Math.floor(r() * 3);
    for (let k = 0; k < records; k++) add('mygov');
    if (r() < 0.4) { add('enreg'); add('debtor'); add('rstax'); }
  }
  const slots = { HTTP: SLOTS.HTTP * replicas, BROWSER: SLOTS.BROWSER * replicas };
  const busy = { HTTP: 0, BROWSER: 0 };
  const running = Object.fromEntries(Object.keys(src).map((k) => [k, 0]));
  const busySeconds = Object.fromEntries(Object.keys(src).map((k) => [k, 0]));
  const events = []; // [time, task]
  const officialDone = new Array(jobs).fill(0);
  let t = 0;
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
  dispatch();
  while (events.length) {
    const [at, q] = events.shift();
    t = at;
    busy[src[q.s].lane]--; running[q.s]--;
    if (--left[q.job] === 0) officialDone[q.job] = t;
    dispatch();
  }
  const finish = officialDone.map((o) => o + lognormal(TAIL.p50, TAIL.p95, r)).sort((a, b) => a - b);
  const pct = (p) => finish[Math.min(finish.length - 1, Math.floor(p * finish.length))];
  const makespan = t;
  // What held the burst back: a source at its cluster cap, or a lane's worker slots (too few replicas).
  const laneSeconds = { HTTP: 0, BROWSER: 0 };
  for (const [k, s] of Object.entries(busySeconds)) laneSeconds[src[k].lane] += s;
  const binding = [
    ...Object.entries(busySeconds).map(([k, s]) => [k, s / (src[k].cap * makespan)]),
    ...Object.entries(laneSeconds).map(([lane, s]) => [`${lane} worker slots`, s / (slots[lane] * makespan)]),
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
  const caps = Object.fromEntries(capsArg.split(',').filter(Boolean).map((kv) => { const [k, v] = kv.split('='); return [k, Number(v)]; }));
  const rows = [];
  for (const jobs of [50, 200, 1000]) for (const replicas of [1, 3, 6, 10]) rows.push(simulate({ jobs, replicas, caps }));
  if (process.argv.includes('--json')) console.log(JSON.stringify({ caps: { ...Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => [k, v.cap])), ...caps }, rows }, null, 2));
  else {
    console.log(`caps: ${Object.entries(SOURCES).map(([k, v]) => `${k}=${caps[k] ?? v.cap}`).join(' ')}`);
    console.log('jobs  replicas  official-stage  p50 job  p95 job  all done  binding source');
    for (const r of rows) console.log(`${String(r.jobs).padStart(4)}  ${String(r.replicas).padStart(8)}  ${String(r.officialMinutes).padStart(10)} min  ${String(r.p50Minutes).padStart(4)} min  ${String(r.p95Minutes).padStart(4)} min  ${String(r.allDoneMinutes).padStart(5)} min  ${r.bindingSource} (${r.bindingUtilisation}%)`);
  }
}
