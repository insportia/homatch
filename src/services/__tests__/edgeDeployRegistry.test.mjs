import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/*
 * A FIX THAT CANNOT BE DEPLOYED IS NOT A FIX.
 *
 * The deploy workflow ships edge functions from two hand-maintained lists.
 * A function that is in neither is invisible to CI: it can be written,
 * reviewed, type-checked, tested and merged, and production keeps running
 * whatever was last pushed by hand — for months, with every gate green.
 *
 * This is not hypothetical, and the workflow's own comments are a history of
 * it: outreach-send's duplicate-send race lived in a file CI never shipped;
 * homatch-ai was production from day one and never listed; developer-score
 * had never been deployed at all, which is what made /developer/:id a dead
 * route.
 *
 * It happened again, and worse, with notifications. notify_emit went live —
 * dedupe, aggregation, preferences, quiet hours, push — and twelve producers
 * were migrated onto it. Four of them were not in either list, so in
 * production a direct message, a viewing request, a finished research
 * purchase and a saved-search hit carried on writing rows straight into the
 * table: no dedupe, no grouping, no preference check, no push. The migration
 * was complete in the repository and absent from the product.
 *
 * So: every function directory is either shipped by CI, or named below with
 * the reason it is not. Adding a function forces that choice at the moment it
 * is cheapest to make.
 */

/* CRLF in the checkout, LF in the regexes below. Normalised once here so
   the gate does not silently find nothing on a Windows working copy —
   which is a green test that checks the empty set. */
const WORKFLOW = readFileSync('.github/workflows/deploy.yml', 'utf8').replace(/\r\n/g, '\n');

function listNamed(name) {
  const block = WORKFLOW.match(new RegExp(`^ *${name}=\\(\\n([\\s\\S]*?)\\n\\s*\\)\\n`, 'm'));
  assert.ok(block, `${name} is no longer declared in the deploy workflow`);
  return [...block[1].matchAll(/^\s*"([a-z0-9-]+)"\s*$/gm)].map(m => m[1]);
}

const jwt = listNamed('JWT_FUNCTIONS');
const noJwt = listNamed('NO_JWT_FUNCTIONS');

const functionDirs = readdirSync('supabase/functions')
  .filter(d => !d.startsWith('_'))
  .filter(d => statSync(join('supabase/functions', d)).isDirectory())
  .sort();

/*
 * NOT SHIPPED BY CI, AND WHY.
 *
 * Two kinds, and the difference matters. The first kind is a decision: an
 * operator tool with no customer path, which should not be one merge away
 * from being live. The second kind is a backlog: functions deployed by hand
 * before this gate existed, whose route into CI has not been reviewed. They
 * are listed rather than quietly excluded so the backlog has a length.
 */
const UNSHIPPED = {
  // ── Operator tools. Deliberately not one merge from production. ──────
  'run-migration': 'executes arbitrary SQL; a merge must not be able to run it',
  'impersonate-user': 'mints a session as another customer; deployed deliberately or not at all',
  'enable-google-oauth': 'one-off provider setup, run once by hand',
  'seed-demo-matches': 'writes fixture data; never wanted on a production deploy',
  'seed-discovery-queries': 'writes fixture data; never wanted on a production deploy',
  tests: 'a test harness, not a customer surface',

  // ── Hand-deployed, route into CI not yet reviewed. ───────────────────
  'admin-user360': 'hand-deployed; CI route unreviewed',
  'apify-discover': 'hand-deployed; CI route unreviewed',
  'browserbase-handoff': 'hand-deployed; CI route unreviewed',
  'classify-signals-v2': 'hand-deployed; CI route unreviewed',
  'generate-search-profile': 'hand-deployed; CI route unreviewed',
  'outreach-campaign-preview': 'hand-deployed; CI route unreviewed',
  'outreach-provider-status': 'hand-deployed; CI route unreviewed',
  'outreach-sms-webhook': 'hand-deployed; CI route unreviewed',
  'outreach-unsubscribe': 'hand-deployed; CI route unreviewed',
  'retell-webhook': 'hand-deployed; CI route unreviewed',
  'source-discovery-massive': 'hand-deployed; CI route unreviewed',
  'source-monitor-public': 'hand-deployed; CI route unreviewed',
  'system-health': 'hand-deployed; CI route unreviewed',
  'unlock-external-contact': 'hand-deployed; CI route unreviewed',
};

test('every edge function is shipped by CI, or says why it is not', () => {
  const shipped = new Set([...jwt, ...noJwt]);
  const orphans = functionDirs.filter(d => !shipped.has(d) && !(d in UNSHIPPED));
  assert.deepEqual(orphans, [],
    `these exist in the repository and nothing deploys them, so changes to them cannot reach production:\n${orphans.join('\n')}`);
});

test('nothing claims to be both shipped and unshipped', () => {
  const shipped = new Set([...jwt, ...noJwt]);
  const both = Object.keys(UNSHIPPED).filter(d => shipped.has(d));
  assert.deepEqual(both, [], `listed in a deploy list and in UNSHIPPED:\n${both.join('\n')}`);
});

test('the exclusion list has not outlived the functions it excuses', () => {
  const gone = Object.keys(UNSHIPPED).filter(d => !functionDirs.includes(d));
  assert.deepEqual(gone, [],
    `these are excused from deployment and no longer exist:\n${gone.join('\n')}`);
});

test('no function is deployed twice, or with two different JWT settings', () => {
  const dupes = [...jwt, ...noJwt].filter((n, i, a) => a.indexOf(n) !== i);
  assert.deepEqual([...new Set(dupes)], [],
    `deployed more than once — the last one wins, which makes the JWT setting a matter of list order:\n${dupes.join('\n')}`);
});

test('every function that emits a notification is one CI can ship', () => {
  /*
   * The specific regression, held separately from the general rule above.
   *
   * A producer that imports the notification helper and is not deployed is
   * the exact shape of the defect: the repository is correct, the tests pass,
   * and in production the event still writes a raw row. That is worse than
   * not having migrated it, because the source now says it was done.
   */
  const shipped = new Set([...jwt, ...noJwt]);
  const stranded = [];
  for (const dir of functionDirs) {
    const entry = join('supabase/functions', dir, 'index.ts');
    let src;
    try { src = readFileSync(entry, 'utf8'); } catch { continue; }
    if (!/from\s+['"][^'"]*notify\.ts['"]/.test(src)) continue;
    if (!shipped.has(dir)) stranded.push(dir);
  }
  assert.deepEqual(stranded, [],
    `these notify through notify_emit in the repository and run last year's code in production:\n${stranded.join('\n')}`);
});
