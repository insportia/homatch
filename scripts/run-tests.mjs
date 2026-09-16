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
 *   tests/developer/
 *                   Homatch for Developers: the spreadsheet writer, and the
 *                   Digital Twin's two load-bearing guarantees (only Homatch
 *                   staff may write the 3D; the public manifest carries counts
 *                   rather than unit rows). Both read source files and need no
 *                   browser and no database.
 *   supabase/functions/
 *                   pure helpers in edge code. Added because a test written
 *                   beside llm.ts ran zero times and reported nothing: the
 *                   suite said 2060 passed both before and after it was
 *                   added, which is exactly as useless as not writing it.
 *                   Edge code that can be tested without Deno should be.
 *
 * THE ONES THAT DRIVE A REAL CHROME ARE EXCLUDED, AND THIS IS WHY
 *
 * commSurfaces, pushHandlers and accessibilityAudit all need a real browser:
 * a harness build, a live service worker, a push subscription. They take
 * minutes, and where the browser is absent or the platform withholds
 * something (headless Chrome keeps no notifications) they fail for reasons
 * that have nothing to do with the change under test.
 *
 * That is not a theoretical cost. pushHandlers and accessibilityAudit were
 * added to this walk on 2026-09-14 and every CI run from that commit onward
 * failed at the Lint step, which gates `validate`, which every deploy job
 * depends on. So NOTHING deployed — not the frontend, not the edge functions,
 * not the migrations — for hours, across two unrelated workstreams, and the
 * only symptom was a red tick nobody was watching.
 *
 * Each has its own command and all of them are in `npm run test:browser`,
 * exactly as tests/mobile/ has `npm run test:mobile`. A gate you have to
 * remember to run is weaker than an enforced one; a gate that blocks every
 * release on an environment difference is worse than either.
 */
const ROOTS = ['src', 'tests/matrix', 'tests/browser', 'tests/developer', 'supabase/functions'];
const EXCLUDE = [
  /commSurfaces\.test\.mjs$/,
  /pushHandlers\.test\.mjs$/,
  /accessibilityAudit\.test\.mjs$/,
  // Drives real Chrome through the whole Developer journey for about a
  // minute and a half, and needs the harness bundle in dist/. It runs as
  // its own CI step (`test:developer`) rather than inside the unit suite.
  /developerAcceptance\.test\.mjs$/,
  /pwaInstallSheet\.test\.mjs$/,
];
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
