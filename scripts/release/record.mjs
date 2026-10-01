#!/usr/bin/env node
/*
 * node scripts/release/record.mjs <out.json> --tier <TIER> --suites "<s1 s2 …>"
 *
 * Written by the PR workflow's final job, only after every planned suite
 * passed. It records WHAT was validated as a git tree id — the hash of every
 * file's exact bytes — so the deploy workflow can later prove that the code
 * it is about to ship is the code that passed, whatever commit id a squash
 * merge gives it. Branch names and commit ids are recorded for humans; the
 * tree is the identity.
 */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { RECORD_VERSION, SUITES } from './classify.mjs';

const args = process.argv.slice(2);
const out = args[0];
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : '');
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();

const tier = arg('--tier');
const suites = arg('--suites').split(/\s+/).filter(Boolean);
if (!out || !['FULL', 'TARGETED'].includes(tier) || suites.some((s) => !SUITES.includes(s))) {
  console.error('usage: record.mjs <out.json> --tier FULL|TARGETED --suites "<known suites>"');
  process.exit(1);
}

const record = {
  version: RECORD_VERSION,
  tier,
  suites,
  validatedTree: git('rev-parse', 'HEAD^{tree}'),
  validatedCommit: git('rev-parse', 'HEAD'),
  prHeadSha: process.env.PR_HEAD_SHA || null,
  baseSha: process.env.PR_BASE_SHA || null,
  runId: process.env.GITHUB_RUN_ID || null,
  runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  createdAt: new Date().toISOString(),
};
writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
console.log(`validation record: tier ${tier}, tree ${record.validatedTree.slice(0, 12)}, suites ${suites.join(' ')}`);
