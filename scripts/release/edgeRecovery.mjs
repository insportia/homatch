#!/usr/bin/env node
/*
 * ONE DETERMINISTIC RECOVERY FOR AN OWED EDGE FUNCTION PRODUCTION DID NOT TAKE.
 *
 * Deploy #869 (2026-10-01, PR #33) owed meta-ads-api, meta-oauth and
 * meta-webhooks. meta-webhooks' own files were unchanged; its closure
 * changed through src/lib/metaAds/strategy.ts. The CLI bundled it, saw a
 * hash different from production's (it printed "Deploying Function", not
 * "No change found"), uploaded it, printed "Deployed Functions" and exited
 * 0 — and production kept version 13 with its old ezbr_sha256 and the old
 * strategy.ts. The proof called it STALE and refused to advance
 * refs/deployed/edge. That was correct. What was wrong is that recovery then
 * depended on an unrelated later deploy (#870) happening to owe the same
 * function: the IDENTICAL command, from the identical source, created v14.
 *
 * The same shape is recorded in scripts/edgeArtifacts.mjs for runs 733, 734,
 * 735, 739 and 741: entry unchanged, an imported module changed, CLI exit 0,
 * no new version, intermittent. The provider's reason is not observable from
 * the outside; what IS established is that a fresh, serial re-run of the same
 * supported command succeeds. So this module does exactly that, bounded:
 *
 *   1. the first proof failed;
 *   2. every unproven function is STALE (production runs an OLD complete
 *      closure — not INCOMPLETE, not UNAVAILABLE, which a redeploy does not
 *      explain) AND a deploy loop really attempted it (attempted.txt names
 *      the list — jwt or nojwt — so the retry is the same command);
 *      otherwise: fail closed now, no production change;
 *   3. redeploy those functions ONCE, one at a time (no concurrent uploads);
 *   4. snapshot and prove again with the same exact proof;
 *   5. exact → success; anything else → fail closed.
 *
 * MAX_RECOVERY_ATTEMPTS is 1. There is no loop, no source edit, no nonce,
 * no delete-and-recreate, and the ref advance stays downstream of success().
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

export const MAX_RECOVERY_ATTEMPTS = 1;
const MODES = new Set(['jwt', 'nojwt']);

/** attempted.txt ("<name> <list>" per line) → Map name → list. */
export function readAttempted(text) {
  return new Map(String(text ?? '').replace(/\r/g, '').split('\n')
    .map((l) => l.trim().split(/\s+/)).filter((p) => p[0]).map((p) => [p[0], p[1] ?? 'unknown']));
}

/**
 * Which unproven functions may be redeployed once, and which block recovery.
 * report: [{ name, state, proven }] from `edgeArtifacts.mjs verify --report`.
 */
export function planRecovery(report, attempted) {
  const recover = [];
  const blocked = [];
  for (const r of report ?? []) {
    if (r.proven) continue;
    const mode = attempted?.get(r.name);
    if (r.state !== 'STALE') blocked.push({ name: r.name, why: `${r.state}: a redeploy does not explain or fix it` });
    else if (!MODES.has(mode)) blocked.push({ name: r.name, why: 'STALE but no deploy loop attempted it — a missing name-list entry, not a provider skip' });
    else recover.push({ name: r.name, mode });
  }
  return { recover, blocked };
}

/**
 * The bounded proof → recovery → proof sequence. All effects are injected:
 *   verify(pass)  → { ok, report }     pass is 1 or 2
 *   deploy(name, mode) → { ok }
 *   snapshot()    → void (refreshes the post-deploy reading)
 * Returns { ok, attempts, recovered, blocked, failedDeploys, report }.
 */
export async function proveWithRecovery({ first, attempted, deploy, snapshot, verify, log = () => {} }) {
  if (first.ok) return { ok: true, attempts: 0, recovered: [], blocked: [], failedDeploys: [], report: first.report };
  const { recover, blocked } = planRecovery(first.report, attempted);
  if (blocked.length || recover.length === 0) {
    for (const b of blocked) log(`::error::${b.name} not recoverable — ${b.why}`);
    if (!recover.length && !blocked.length) log('::error::the proof failed but named no unproven function');
    return { ok: false, attempts: 0, recovered: [], blocked, failedDeploys: [], report: first.report };
  }
  log(`recovery: ${recover.length} STALE function(s), one serial redeploy each (max ${MAX_RECOVERY_ATTEMPTS})`);
  const failedDeploys = [];
  for (const { name, mode } of recover) { // serial, by construction
    log(`recovery: redeploying ${name} via the ${mode} list`);
    const r = await deploy(name, mode);
    if (!r?.ok) failedDeploys.push(name);
  }
  await snapshot();
  const second = await verify(2);
  if (!second.ok) {
    const still = (second.report ?? []).filter((r) => !r.proven).map((r) => `${r.name}=${r.state}`);
    log(`::error::still unproven after ${MAX_RECOVERY_ATTEMPTS} recovery attempt: ${still.join(', ') || 'unknown'} — refs/deployed/edge stays put; the work stays owed`);
  } else {
    log(`recovery: all owed functions PROVEN_EXACT after one redeploy of ${recover.map((r) => r.name).join(', ')}`);
  }
  return { ok: second.ok, attempts: 1, recovered: second.ok ? recover.map((r) => r.name) : [], blocked: [], failedDeploys, report: second.report };
}

/* ── CLI: called by the "Prove it in production" step after a failed first pass ──
 *
 *   node scripts/release/edgeRecovery.mjs --dir "$RUNNER_TEMP"
 *
 * Reads pre.json, owed.txt, attempted.txt, started-at-ms and proof-1.json from
 * --dir. Needs SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF, and the CLI the
 * job already installed.
 */
async function main() {
  const args = process.argv.slice(2);
  const dir = args[args.indexOf('--dir') + 1];
  const ref = process.env.SUPABASE_PROJECT_REF;
  const f = (n) => `${dir}/${n}`;
  const node = (...a) => spawnSync(process.execPath, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  const owed = readFileSync(f('owed.txt'), 'utf8').split(/\s+/).filter(Boolean);
  const first = {
    ok: false,
    report: existsSync(f('proof-1.json')) ? JSON.parse(readFileSync(f('proof-1.json'), 'utf8')) : [],
  };
  const attempted = existsSync(f('attempted.txt')) ? readAttempted(readFileSync(f('attempted.txt'), 'utf8')) : new Map();
  const result = await proveWithRecovery({
    first,
    attempted,
    log: (m) => console.log(m),
    deploy: async (name, mode) => {
      const cmd = ['functions', 'deploy', name, '--project-ref', ref, ...(mode === 'nojwt' ? ['--no-verify-jwt'] : [])];
      const r = spawnSync('supabase', cmd, { stdio: 'inherit' });
      return { ok: r.status === 0 };
    },
    snapshot: async () => {
      const r = node('scripts/edgeArtifacts.mjs', 'snapshot', ...owed);
      if (r.status !== 0) throw new Error('snapshot after recovery failed');
      writeFileSync(f('post-2.json'), r.stdout);
    },
    verify: async () => {
      const since = readFileSync(f('started-at-ms'), 'utf8').trim();
      const r = spawnSync(process.execPath, ['scripts/edgeArtifacts.mjs', 'verify', f('pre.json'), f('post-2.json'), '--since', since, '--report', f('proof-2.json')], { stdio: 'inherit' });
      const report = existsSync(f('proof-2.json')) ? JSON.parse(readFileSync(f('proof-2.json'), 'utf8')) : [];
      return { ok: r.status === 0, report };
    },
  });
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  main().catch((e) => { console.log(`::error::edge recovery could not run: ${e.message}`); process.exit(1); });
}
