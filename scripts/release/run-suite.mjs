#!/usr/bin/env node
/*
 * node scripts/release/run-suite.mjs <suite-id>
 *
 * Runs one browser suite from the catalogue in components.mjs — the same
 * files `test:mobile` / `test:studio` / `test:<name>` run, split by owner.
 * tests/matrix/releasePath.test.mjs proves the shards are exactly those
 * scripts' file lists, so nothing can be dropped by sharding.
 *
 * CI=true makes a missing browser a FAILURE, not a skip. An unknown or empty
 * suite fails: a job that ran nothing must not report success.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { SUITE_CATALOGUE } from './components.mjs';

const id = process.argv[2];
const suite = SUITE_CATALOGUE[id];
if (!suite || !suite.files?.length) {
  console.error(`unknown or empty suite "${id}": refusing to report success on nothing`);
  process.exit(2);
}
const node = (...a) => spawnSync(process.execPath, a, { stdio: 'inherit' }).status ?? 1;

if (suite.script) {
  // The package script itself, so its flags (timeouts) are the ones used.
  const cmd = JSON.parse(readFileSync('package.json', 'utf8')).scripts[suite.script];
  const parts = cmd.split(/\s+/);
  if (parts[0] !== 'node') { console.error(`${suite.script} is not a node command`); process.exit(2); }
  console.log(`suite ${id}: ${cmd}`);
  process.exit(node(...parts.slice(1)));
}
console.log(`suite ${id}: ${suite.files.join(' ')}`);
if (suite.serial) {
  // test:studio runs its files one process at a time (each serves the
  // harness on its own port); keep that.
  for (const f of suite.files) { const s = node('--test', f); if (s !== 0) process.exit(s); }
  process.exit(0);
}
process.exit(node('--test', ...suite.files));
