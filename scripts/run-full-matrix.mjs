// THE ACCEPTANCE MATRIX RUNNER: 4 widths x 6 locales, on the customer-critical set.
//
// A tiny script rather than a package.json one-liner, for two reasons that both bit
// earlier today.
//
//   cross-env IS NOT INSTALLED here. `cross-env-shell HOMATCH_FULL_MATRIX=1 ...` looks
//   perfectly idiomatic and would have failed on every machine, and `VAR=x cmd` is not
//   valid in the PowerShell this repo's scripts run under either. Passing the variable
//   through spawn's env is the only form that works on both.
//
//   THE HARNESS SERVES A PREBUILT dist/. A stale bundle produces false passes -- it
//   produced one today, where an admin route 404'd because the build predated the page
//   and the overflow gate measured the not-found screen. So the build is not optional
//   and is not left to the caller to remember.

import { spawnSync } from 'node:child_process';

const step = (label, command, args, env) => {
  process.stdout.write(`\n[matrix] ${label}\n`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    process.stdout.write(`[matrix] ${label} FAILED (exit ${result.status})\n`);
    process.exit(result.status ?? 1);
  }
};

/*
 * Rebuilt every run. Twenty seconds against the risk of measuring a bundle that does
 * not contain the screens under test is not a trade worth making.
 */
step('building the harness bundle so dist/ cannot be stale', 'npm', ['run', 'build:harness']);

step(
  'full matrix: 4 widths x 6 locales across the customer-critical surfaces',
  'node',
  ['--test', '--test-timeout=2400000', 'tests/mobile/routeOverflow.test.mjs'],
  { HOMATCH_FULL_MATRIX: '1' },
);

process.stdout.write('\n[matrix] PASS — the acceptance matrix is green\n');
