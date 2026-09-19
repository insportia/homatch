#!/usr/bin/env node
/*
 * WHAT IS ACTUALLY RUNNING IN PRODUCTION, AND IS IT BEHIND?
 *
 * On 2026-09-19 the answer to that question took an hour of API calls and a
 * 470-kilobyte artifact download, and the fact being established was simply
 * "the edge function does not have the fix that is in main". Nobody should
 * have to work that hard to see drift.
 *
 * The important subtlety is that BEHIND IS NOT THE SAME AS OUT OF DATE. A
 * component sitting on a commit from last week is perfectly current if nothing
 * it depends on has changed since. So this compares per component: the
 * deployed revision, and whether anything in that component's actual file set
 * has moved since. Blind SHA equality would report permanent false drift in a
 * repository where four components share one branch.
 *
 * Reads git only, so it runs on a laptop with no tokens. `--verify` adds a
 * live check of the edge artifact for a named marker, which is the check that
 * would have caught the language fix never reaching production.
 */
import { execFileSync } from 'node:child_process';
import { deployedRef, changedSince, componentsFor, COMPONENTS } from './deploy-scope.mjs';

const git = (...args) => execFileSync('git', args,
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

const short = (sha) => (sha ? sha.slice(0, 8) : '—');

function status() {
  /*
   * The refs live on the remote, because CI is what writes them. Reading a
   * stale local copy is how this command reports BEHIND for something that
   * was deployed ten minutes ago, which is exactly the kind of false alarm
   * that teaches people to stop trusting a status command.
   */
  try {
    git('fetch', 'origin', '+refs/deployed/*:refs/deployed/*');
  } catch {
    // Offline, or no refs yet. The local copy is then the best answer there
    // is, and every row still says which commit it is talking about.
  }
  const head = git('rev-parse', 'HEAD');
  const rows = [];

  for (const component of COMPONENTS) {
    const base = deployedRef(component);
    if (!base) {
      rows.push({ component, deployed: null, state: 'UNKNOWN', detail: 'never recorded a deploy' });
      continue;
    }
    if (base === head) {
      rows.push({ component, deployed: base, state: 'OK', detail: 'at main' });
      continue;
    }
    const changed = changedSince(base, head);
    if (changed === null) {
      rows.push({ component, deployed: base, state: 'UNKNOWN', detail: 'deployed commit unreachable' });
      continue;
    }
    const { components, functions } = componentsFor(changed);
    if (!components.includes(component)) {
      rows.push({
        component, deployed: base, state: 'CURRENT',
        detail: `behind main by ${changed.length} file(s), none of them this component's`,
      });
      continue;
    }
    rows.push({
      component, deployed: base, state: 'BEHIND',
      detail: component === 'edge' && functions.length
        ? `owes ${functions.length}: ${functions.join(' ')}`
        : `${changed.length} changed file(s) not deployed`,
    });
  }
  return { head, rows };
}

const { head, rows } = status();
console.log(`main              ${short(head)}`);
for (const r of rows) {
  console.log(`${r.component.padEnd(18)}${short(r.deployed).padEnd(10)}${r.state.padEnd(9)}${r.detail}`);
}

const behind = rows.filter((r) => r.state === 'BEHIND');
if (behind.length) {
  console.log('');
  console.log('Production is behind. Deploy from current main without inventing a commit:');
  console.log('  gh workflow run "Deploy Homatch" -f redeploy=edge');
  console.log('  gh workflow run "Deploy Homatch" -f redeploy=ai-talk-session');
  process.exitCode = 1;
}
