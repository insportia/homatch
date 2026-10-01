#!/usr/bin/env node
/*
 * node scripts/release/plan.mjs [--base <ref>] [--head <ref>] [--json] [--no-base-engine]
 *
 * The validation a change needs: tier, components, suites, deploy targets
 * and the production proof it will owe — from the files it changes between
 * the merge base and HEAD (locally, uncommitted work too).
 *
 * In GitHub Actions it writes `tier`, `suites`, `matrix` (the browser suites
 * as a JSON job matrix), `has_browser` and `run_worker` to GITHUB_OUTPUT and
 * the full reasoning to the step summary.
 *
 * SELF-CERTIFICATION GUARD. The engine that plans a PR is the PR's own code,
 * so a change to the engine could plan too little and pass itself. The plan
 * is therefore ALSO computed by the base branch's engine, and the stricter
 * answer wins: if the base engine says repository-wide, it is repository-
 * wide; otherwise the suites are the union. A base engine that cannot run
 * makes the plan REPO_FULL.
 *
 * Any error — a base that cannot be found, git failing — plans REPO_FULL.
 */
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyChanges, SUITES, upgradeSuiteNames } from './classify.mjs';
import { SUITE_CATALOGUE } from './components.mjs';
import { changedFiles, git, repoContext } from './context.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const base = arg('--base', process.env.RELEASE_BASE || 'origin/main');
const head = arg('--head', 'HEAD');
const local = !process.env.GITHUB_ACTIONS && head === 'HEAD';

const full = (why) => ({ tier: 'REPO_FULL', suites: [...SUITES], components: {}, reasons: [why], files: [], deploy: {}, proofs: [] });

let plan;
let mergeBase = null;
try {
  const ch = changedFiles({ base, head, includeWorkingTree: local });
  mergeBase = ch.mergeBase;
  plan = classifyChanges(ch.files, repoContext({ base: mergeBase, head, includeWorkingTree: local }));
} catch (err) {
  plan = full(`could not compute the change set (${String(err.message ?? err).split('\n')[0]}) → REPO_FULL`);
}

/* The base branch's engine, run over the same change. */
function baseEnginePlan() {
  const dir = mkdtempSync(join(tmpdir(), 'base-engine-'));
  try {
    // The whole scripts/ tree: the engine imports deploy-scope.mjs beside it.
    execFileSync('sh', ['-c', `git archive ${mergeBase} scripts | tar -x -C "${dir}"`], { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = execFileSync(process.execPath, [join(dir, 'scripts/release/plan.mjs'), '--base', base, '--head', head, '--json', '--no-base-engine'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '' },
    });
    return JSON.parse(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (!args.includes('--no-base-engine') && mergeBase && plan.tier !== 'REPO_FULL') {
  let b = null;
  try { b = baseEnginePlan(); } catch (err) { b = { error: String(err.message ?? err).split('\n')[0] }; }
  if (b?.error || !b?.tier) {
    plan = { ...full(`the base branch's release engine could not plan this change (${b?.error ?? 'no answer'}) → REPO_FULL`), deploy: plan.deploy, proofs: plan.proofs };
  } else if (b.tier === 'FULL' || b.tier === 'REPO_FULL') {
    plan = { ...plan, tier: 'REPO_FULL', suites: [...SUITES], reasons: ['the base branch\'s release engine plans this change repository-wide, and the stricter engine wins → REPO_FULL', ...(b.reasons ?? []).slice(0, 10).map((r) => `  base engine: ${r}`), ...plan.reasons] };
  } else {
    const extra = upgradeSuiteNames(b.suites);
    if (extra == null) {
      plan = { ...full('the base branch\'s release engine named suites this engine does not know → REPO_FULL'), deploy: plan.deploy, proofs: plan.proofs };
    } else {
      const missing = extra.filter((s) => !plan.suites.includes(s));
      if (missing.length) {
        plan = { ...plan, suites: SUITES.filter((s) => plan.suites.includes(s) || missing.includes(s)), reasons: [`base engine also requires: ${missing.join(', ')}`, ...plan.reasons] };
      }
    }
  }
}

if (args.includes('--json')) {
  console.log(JSON.stringify(plan, null, 2));
} else {
  console.log(`RELEASE PLAN: ${plan.tier}`);
  console.log(`components: ${Object.keys(plan.components ?? {}).join(' ') || '—'}`);
  console.log(`suites: ${plan.suites.join(' ')}`);
  for (const r of plan.reasons) console.log(`  · ${r}`);
  if (plan.deploy) console.log(`deploy: frontend=${plan.deploy.frontend} railway=${plan.deploy.railway} functions=[${(plan.deploy.functions ?? []).join(' ')}] migrations=${(plan.deploy.migrations ?? []).length}`);
  for (const p of plan.proofs ?? []) console.log(`  proof owed: ${p}`);
}

const browser = plan.suites.filter((s) => SUITE_CATALOGUE[s]?.files?.length);
if (process.env.GITHUB_OUTPUT) {
  const matrix = JSON.stringify(browser.map((id) => ({ id, title: SUITE_CATALOGUE[id].title })));
  const lines = [
    `tier=${plan.tier}`, `suites=${plan.suites.join(' ')}`, `matrix=${matrix}`,
    `has_browser=${browser.length > 0}`, `run_worker=${plan.suites.includes('worker')}`,
    `components=${Object.keys(plan.components ?? {}).join(' ')}`,
  ];
  appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  const skipped = SUITES.filter((s) => !plan.suites.includes(s));
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    `### Release plan: ${plan.tier}`,
    `Components: ${Object.keys(plan.components ?? {}).join(', ') || '—'}`,
    `Runs: ${plan.suites.join(', ')}${skipped.length ? ` · not affected: ${skipped.join(', ')}` : ''}`,
    '',
    ...plan.reasons.slice(0, 80).map((r) => `- ${r}`),
    plan.reasons.length > 80 ? `- … ${plan.reasons.length - 80} more` : '',
    '',
    ...(plan.proofs ?? []).map((p) => `- proof owed after deploy: ${p}`),
    '',
  ].join('\n'));
}
