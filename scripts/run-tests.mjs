#!/usr/bin/env node
/*
 * Frontend test runner.
 *
 * WHY THIS EXISTS RATHER THAN `node --test <pattern>`
 *
 * The two ways of pointing node:test at a tree disagree across the Node
 * versions this repo is built on:
 *
 *   node --test "src/**\/*.test.mjs"   glob args: Node 22+ only. On Node 20
 *                                      the pattern is taken literally and the
 *                                      run dies with "Could not find ...".
 *   node --test src                    directory args: Node 20 walks it, but
 *                                      Node 24 resolves it as a module and
 *                                      dies with MODULE_NOT_FOUND.
 *
 * CI runs Node 20 and developers here run Node 24, so either form is green on
 * one and red on the other -- which is exactly how a real 413-test suite got
 * reported as a CI failure while passing locally.
 *
 * Collecting the files ourselves and passing them explicitly works on every
 * version, and fails loudly if the suite ever resolves to nothing rather than
 * silently "passing" with zero tests.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/*
 * WHAT THIS RUN COVERS, AND WHAT IT DELIBERATELY DOES NOT
 *
 *   src/            the domain and component suites
 *   tests/matrix/   the release-status matrix, the provider-surfacing guards
 *                   and the deploy-registration guard; all of them read source
 *                   files and are as fast as any unit test
 *   tests/browser/  only the two that need no browser — the harness isolation
 *                   check and the fixture shape check. The isolation one is a
 *                   security gate, and a gate you have to remember to run
 *                   separately is not enforced.
 *
 * The browser SWEEP itself (tests/browser/commSurfaces.test.mjs) is excluded:
 * it needs a harness build and a real Chrome, takes minutes, and skips without
 * them, so including it would make `npm test` either slow or quietly skipping.
 * It has its own command, `npm run test:surfaces`, exactly as tests/mobile/
 * has `npm run test:mobile`.
 */
const ROOTS = ['src', 'tests/matrix', 'tests/browser'];
const EXCLUDE = [/commSurfaces\.test\.mjs$/];
const files = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (entry.endsWith('.test.mjs') && !EXCLUDE.some((re) => re.test(full))) files.push(full);
  }
}

for (const root of ROOTS) {
  // A missing root would otherwise be a partial run reported as a full one,
  // which is the failure mode this whole file exists to prevent.
  if (!existsSync(root)) {
    console.error(`${root}/ is missing — refusing to report success on a partial run.`);
    process.exit(1);
  }
  walk(root);
}

if (files.length === 0) {
  console.error(`No *.test.mjs files found under ${ROOTS.join(', ')} — refusing to report success.`);
  process.exit(1);
}

const res = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(res.status ?? 1);
