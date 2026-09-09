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
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = 'src';
const files = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (entry.endsWith('.test.mjs')) files.push(full);
  }
}
walk(ROOT);

if (files.length === 0) {
  console.error(`No *.test.mjs files found under ${ROOT}/ — refusing to report success.`);
  process.exit(1);
}

const res = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(res.status ?? 1);
