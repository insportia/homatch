#!/usr/bin/env node
// Provision the browser driver for the Verify mobile regression suite.
//
// WHY THIS IS NOT A devDependency
//
// CI installs with `pnpm install --frozen-lockfile`. Adding playwright-core
// to package.json without regenerating pnpm-lock.yaml makes that install
// FAIL, which would take the whole pipeline down for a test that CI does not
// yet run. Regenerating the lockfile needs pnpm, which is not available in
// every environment this repo is worked on from.
//
// So the driver is provisioned into a gitignored directory by one documented
// command instead. That removes the real problem — a suite that only ran if
// you happened to know an undocumented environment variable — without
// risking the install step every other job depends on.
//
// It downloads NO browsers: playwright-core drives the Chrome already on the
// machine. If Chrome is absent the suite skips and says so.
//
//   npm run test:mobile:setup     # once
//   npm run build:harness
//   npm run test:mobile

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const DIR = join(ROOT, '.tooling');
const VERSION = 'playwright-core@1.49.1';

if (existsSync(join(DIR, 'node_modules', 'playwright-core', 'package.json'))) {
  console.log('[mobile-test] driver already present in .tooling/ — nothing to do.');
  process.exit(0);
}

mkdirSync(DIR, { recursive: true });
writeFileSync(
  join(DIR, 'package.json'),
  JSON.stringify({ name: 'homatch-mobile-test-tooling', private: true, version: '1.0.0' }, null, 2) + '\n'
);

console.log(`[mobile-test] installing ${VERSION} into .tooling/ (no browsers are downloaded)...`);
try {
  execFileSync('npm', ['install', VERSION, '--no-audit', '--no-fund', '--loglevel', 'error'], {
    cwd: DIR,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  console.log('[mobile-test] done. Now run: npm run build:harness && npm run test:mobile');
} catch (e) {
  console.error('[mobile-test] install failed:', e instanceof Error ? e.message : String(e));
  console.error('[mobile-test] the suite will skip rather than fail; nothing else is affected.');
  process.exit(1);
}
