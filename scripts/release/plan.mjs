#!/usr/bin/env node
/*
 * node scripts/release/plan.mjs [--base <ref>] [--head <ref>] [--json]
 *
 * Which suites this change needs (FULL or TARGETED), from the files it
 * changes between the merge base and HEAD. In GitHub Actions it writes one
 * `run_<suite>=true|false` output per suite plus `tier` and `suites`, and a
 * step summary that lists every reason. Locally it prints the same plan.
 *
 * Any error — a base that cannot be found, git failing — plans FULL.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { classifyChanges, SUITES } from './classify.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const base = arg('--base', process.env.RELEASE_BASE || 'origin/main');
const head = arg('--head', 'HEAD');

let plan;
try {
  const mergeBase = git('merge-base', base, head);
  const files = git('diff', '--name-only', `${mergeBase}..${head}`).split('\n').filter(Boolean);
  // Locally, uncommitted and untracked work is part of the change too (CI
  // checks out a commit, so there is none there). Those are read from disk.
  const local = process.env.GITHUB_ACTIONS ? [] : [
    ...git('diff', '--name-only', 'HEAD').split('\n'),
    ...git('ls-files', '--others', '--exclude-standard').split('\n'),
  ].filter(Boolean);
  const onDisk = new Set(local);
  plan = classifyChanges([...files, ...local], {
    read: (f) => (onDisk.has(f) ? readFileSync(f, 'utf8') : git('show', `${head}:${f}`)),
  });
} catch (err) {
  plan = { tier: 'FULL', suites: [...SUITES], reasons: [`could not compute the change set (${String(err.message ?? err).split('\n')[0]}) → FULL`], files: [] };
}

if (args.includes('--json')) {
  console.log(JSON.stringify(plan, null, 2));
} else {
  console.log(`RELEASE PLAN: ${plan.tier}`);
  console.log(`suites: ${plan.suites.join(' ')}`);
  for (const r of plan.reasons) console.log(`  · ${r}`);
}

if (process.env.GITHUB_OUTPUT) {
  const lines = [`tier=${plan.tier}`, `suites=${plan.suites.join(' ')}`, ...SUITES.map((s) => `run_${s}=${plan.suites.includes(s)}`)];
  appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  const skipped = SUITES.filter((s) => !plan.suites.includes(s));
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    `### Release plan: ${plan.tier}`,
    `Runs: ${plan.suites.join(', ')}${skipped.length ? ` · not affected: ${skipped.join(', ')}` : ''}`,
    '',
    ...plan.reasons.slice(0, 60).map((r) => `- ${r}`),
    plan.reasons.length > 60 ? `- … ${plan.reasons.length - 60} more` : '',
    '',
  ].join('\n'));
}
