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

  /* ── Hand-deployed, route into CI not yet reviewed. ─────────────────
   *
   * Four names left this list on 2026-09-25, and it is worth saying why
   * rather than just shortening the list. apify-discover,
   * source-discovery-massive, source-monitor-public and
   * classify-signals-v2 were all excused here, which meant exactly what
   * the first test below says: changes to them could not reach
   * production.
   *
   * That became a real problem the moment the first three were turned
   * into 423 retirement stubs. The repository said Apify was retired
   * and production went on running the live Apify code, and nothing
   * anywhere would have reported the difference -- run 724's upload
   * accounting caught it only because the functions became OWED and
   * then matched no deploy loop.
   *
   * An entry here is a statement that a function is deliberately not
   * one merge from production. For an operator tool that is a security
   * property. For an ordinary function it is a trap.
   */
  'admin-user360': 'hand-deployed; CI route unreviewed',
  'browserbase-handoff': 'hand-deployed; CI route unreviewed',
  'generate-search-profile': 'hand-deployed; CI route unreviewed',
  'outreach-provider-status': 'hand-deployed; CI route unreviewed',
  'outreach-sms-webhook': 'hand-deployed; CI route unreviewed',
  'outreach-unsubscribe': 'hand-deployed; CI route unreviewed',
  'retell-webhook': 'hand-deployed; CI route unreviewed',
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

test('every function CI deploys without a JWT declares that in config.toml', () => {
  /*
   * Two places say whether a function verifies its caller's JWT, and they
   * must agree.
   *
   *   deploy.yml passes --no-verify-jwt for the functions in NO_JWT_FUNCTIONS
   *   supabase/config.toml carries [functions.<name>] verify_jwt = false
   *
   * CI wins while CI is deploying. But a `supabase functions deploy` run by
   * hand reads config.toml and nothing else, so a function that is in the
   * workflow list and NOT in the config silently has its gateway check turned
   * back ON by the next manual deploy -- and a pg_cron tick that suddenly
   * requires a user JWT stops working completely, with every screen still
   * looking correct.
   *
   * config.toml's own header says these entries exist for exactly that
   * reason. This is the check that makes it true rather than remembered.
   */
  const config = readFileSync('supabase/config.toml', 'utf8');
  const declared = new Set(declaredFalse(config));
  assert.ok(declared.size > 0, 'config.toml declares no functions at all');

  const undeclared = noJwt.filter((fn) => !declared.has(fn));
  assert.deepEqual(undeclared, [],
    'CI deploys these with --no-verify-jwt and config.toml does not say so, so a '
    + 'manual deploy would turn the gateway check back on:\n  - ' + undeclared.join('\n  - '));
});

/**
 * The functions config.toml actually declares verify_jwt = FALSE for.
 *
 * The value is read, not inferred from the section existing. Both checks here say
 * "declares verify_jwt = false", and for a while that was true by accident: every
 * section in the file was a no-JWT declaration, so presence and value agreed.
 *
 * They stop agreeing the moment somebody adds a section for a function that DOES
 * verify its caller -- a harmless, even well-intentioned entry -- and the second
 * check then fails while naming a function whose config says the opposite of what
 * the failure message claims. Reading the value keeps the message honest.
 */
function declaredFalse(config) {
  const out = [];
  let current = null;
  for (const raw of config.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const section = line.match(/^\[functions\.([a-z0-9-]+)\]$/i);
    if (section) {
      current = section[1];
      continue;
    }
    /* Any other section header ends this function's block, so a verify_jwt
       further down the file cannot be attributed to it. */
    if (/^\[/.test(line)) {
      current = null;
      continue;
    }
    const value = line.match(/^verify_jwt\s*=\s*(true|false)$/i);
    if (value && current) {
      if (value[1].toLowerCase() === 'false') out.push(current);
      current = null;
    }
  }
  return out;
}

test('nothing declares verify_jwt = false without CI deploying it that way', () => {
  // The other direction. A config entry for a function CI deploys WITH the
  // JWT check is a trap in the opposite direction: the two deploy paths
  // disagree and which one ran last decides production's behaviour.
  const config = readFileSync('supabase/config.toml', 'utf8');
  const inJwtList = declaredFalse(config).filter((fn) => jwt.includes(fn));
  assert.deepEqual(inJwtList, [],
    'declared verify_jwt = false but deployed by the JWT loop:\n  - ' + inJwtList.join('\n  - '));
});
