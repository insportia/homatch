#!/usr/bin/env node
/*
 * node scripts/release/shard.mjs <index>/<count>
 *
 * Runs one shard of `npm run test:mobile`, reading the file list from the
 * package.json script itself, so the shards can never drift from the
 * canonical command: tests/matrix/releasePath.test.mjs proves their union is
 * exactly that list. Exit status is node --test's own.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mobileShards } from './classify.mjs';

const [i, n] = String(process.argv[2] ?? '').split('/').map(Number);
if (!Number.isInteger(i) || !Number.isInteger(n) || i < 1 || i > n) {
  console.error('usage: shard.mjs <index>/<count>, e.g. 1/2');
  process.exit(2);
}
const script = JSON.parse(readFileSync('package.json', 'utf8')).scripts['test:mobile'];
const files = mobileShards(script, n)[i - 1];
if (!files.length) { console.error('empty shard: refusing to report success on nothing'); process.exit(1); }
console.log(`mobile shard ${i}/${n}: ${files.join(' ')}`);
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
