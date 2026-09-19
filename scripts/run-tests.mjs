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
  // The same, for the journey before that one: an account with no
  // workspace at all. Own CI step (`test:onboarding`).
  /developerOnboarding\.test\.mjs$/,
  // Drives the whole 2D -> 3D chain in Chrome, including a WebGL render.
  // Its own CI step (`test:floorplan`).
  /floorplanPipeline\.test\.mjs$/,
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

/*
 * NODE_TEST_CONTEXT MUST NOT REACH THE CHILD.
 *
 * node:test sets NODE_TEST_CONTEXT for every test file it runs, and anything
 * spawned from inside a test inherits it. A `node --test` that sees it starts
 * in child mode: it reports its results to a supervising runner over the v8
 * serialization channel and EXITS 0 WHATEVER HAPPENS, because the status is
 * supposed to be the parent's to decide.
 *
 * With no supervising runner listening, that status goes nowhere. Measured
 * here against a suite containing one deliberately failing test:
 *
 *   npm test                              exit 1
 *   NODE_TEST_CONTEXT=child-v8 npm test   exit 0     <-- a real failure, green
 *
 * So the canonical command's verdict depended on an environment variable it
 * never set and nobody looks at. Deleting it makes this run a top-level run
 * every time, which is the only kind whose exit code means anything.
 */
const childEnv = { ...process.env };
delete childEnv.NODE_TEST_CONTEXT;

const res = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  env: childEnv,
});

/*
 * THE VERDICT IS PRINTED, NOT ONLY RETURNED.
 *
 * This runner already propagates the child's status correctly, and so does
 * `npm test` above it and CI above that — measured layer by layer, a single
 * failing test gives exit 1 at every one of them.
 *
 * It stops being true the moment the command is put on the left of a shell
 * pipe. `npm test | tail`, `| tee`, `| grep`, `| cat` — a POSIX shell reports
 * the status of the LAST command in a pipeline, so all of them return 0 no
 * matter what happened to the left of the `|`. That is how a run with a real
 * failure in it got read as green here: the failure was in the output, and
 * the exit code that was looked at belonged to `tail`.
 *
 * Nothing this file can do makes a pipeline report the right status. What it
 * can do is make the LAST LINE of its own output state the verdict, so a
 * truncated or piped view ends with the answer rather than with the tail of
 * whichever error dump happened to print last. node:test prints its failure
 * details AFTER the summary counts, which is exactly why `| tail -10` showed
 * an assertion dump and no `fail` line at all.
 *
 * The line below is derived from the child's exit status — the same value
 * this process exits with — never from scraping the output for a word like
 * "fail". If you are reading a piped run, this line and the exit code cannot
 * disagree; if you are reading a bare run, use the exit code.
 */
const failed = res.status !== 0;
if (res.signal) {
  console.error(`TEST GATE: FAIL — the test process was killed by ${res.signal}`);
} else if (failed) {
  console.error(`TEST GATE: FAIL — the test process exited ${res.status ?? 'without a status'}`);
} else {
  console.log(`TEST GATE: PASS — ${files.length} files, exit 0`);
}
process.exit(res.status ?? 1);
