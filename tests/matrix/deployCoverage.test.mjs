// A function that is not in the deploy workflow cannot reach production.
//
// WHY THIS EXISTS
//
// The deploy workflow names the functions it deploys in two hand-maintained
// bash arrays. A function absent from both is simply never deployed, and
// nothing anywhere says so: CI is green, the merge is green, the frontend
// ships, and every call from the new screens 404s.
//
// That has already happened here more than once. deploy.yml's own comments
// record it: homatch-ai "has been production since day one and was NEVER
// listed here: every version was deployed by hand, so repository changes to it
// could not reach customers", and developer-score "has never been deployed at
// all, which is what made /developer/:id a dead route".
//
// It happened again with all ten Communications functions, which were written,
// tested and committed without ever being added to either array.
//
// WHY THE LIST A FUNCTION IS IN MATTERS JUST AS MUCH
//
// The two arrays are not interchangeable. The no-JWT array deploys with
// --no-verify-jwt; everything else gets the gateway's JWT check.
//
// Meta and Vapi send no Authorization header at all. A webhook in the JWT
// array is rejected with 401 before its code runs — and that failure is total
// and silent. Meta's subscription handshake never succeeds, so the webhook
// cannot be registered; no inbound message, no delivery receipt, no call
// lifecycle event. Calls never settle, cost is never recorded, campaigns never
// complete, and every screen still looks fine.
//
// So this checks both: that every function is deployed, and that the ones
// which authenticate themselves are in the array that lets them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const WORKFLOW = readFileSync(join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');
const CONFIG = readFileSync(join(ROOT, 'supabase', 'config.toml'), 'utf8');
const FUNCTIONS_DIR = join(ROOT, 'supabase', 'functions');

/** Pull the function names out of one bash array in the workflow. */
function arrayNames(varName) {
  const start = WORKFLOW.indexOf(`${varName}=(`);
  assert.ok(start > -1, `${varName} is not declared in deploy.yml`);
  const end = WORKFLOW.indexOf('\n          )', start);
  assert.ok(end > start, `${varName} is not closed`);
  return new Set(
    [...WORKFLOW.slice(start, end).matchAll(/^\s+"([a-z0-9-]+)"\s*$/gm)].map((m) => m[1])
  );
}

const withJwt = arrayNames('JWT_FUNCTIONS');
const withoutJwt = arrayNames('NO_JWT_FUNCTIONS');

/** Every function that actually exists in the repository. */
const onDisk = readdirSync(FUNCTIONS_DIR)
  .filter((name) => !name.startsWith('_') && name !== 'tests')
  .filter((name) => statSync(join(FUNCTIONS_DIR, name)).isDirectory())
  .filter((name) => existsSync(join(FUNCTIONS_DIR, name, 'index.ts')));

/*
 * The Communications functions, and how each one is reached.
 *
 * 'browser'  a signed-in page calls it; the caller presents a JWT (the anon
 *            key counts) and the function authenticates on top of that.
 * 'service'  an external provider or pg_cron calls it with no Supabase JWT at
 *            all, and it authenticates the request itself.
 */
const COMMUNICATIONS = {
  'comm-agent': 'browser',
  'comm-campaign-launch': 'browser',
  'comm-provider-status': 'browser',
  'whatsapp-send': 'browser',
  'whatsapp-sync': 'browser',
  'cartesia-access-token': 'browser',
  'ai-talk-session': 'browser',
  'whatsapp-webhook': 'service',
  'voice-webhook': 'service',
  'comm-dispatch-worker': 'service',
};

test('every Communications function is actually deployed by the workflow', () => {
  const undeployed = Object.keys(COMMUNICATIONS)
    .filter((fn) => !withJwt.has(fn) && !withoutJwt.has(fn));
  assert.deepEqual(undeployed, [],
    'these exist in the repository and would never reach production:\n  - ' + undeployed.join('\n  - '));
});

test('each Communications function is in the array that matches how it is called', () => {
  const wrong = [];
  for (const [fn, caller] of Object.entries(COMMUNICATIONS)) {
    if (caller === 'service' && !withoutJwt.has(fn)) {
      wrong.push(`${fn}: called by an external service with no JWT, but would deploy WITH the gateway check — every provider request would 401 before the function ran`);
    }
    if (caller === 'browser' && !withJwt.has(fn)) {
      wrong.push(`${fn}: called from a signed-in page, but is not in JWT_FUNCTIONS — deploying it without the gateway check removes an outer gate for nothing`);
    }
    if (withJwt.has(fn) && withoutJwt.has(fn)) {
      wrong.push(`${fn}: listed in both arrays; the later deploy silently decides which setting wins`);
    }
  }
  assert.deepEqual(wrong, []);
});

test('a function deployed without the gateway check authenticates itself', () => {
  /*
   * --no-verify-jwt removes the only check outside the function. If the
   * function then does not check either, it is open to the internet. This
   * reads the source rather than trusting the array.
   */
  const SELF_AUTH = [
    /verifyMetaSignature/, /x-hub-signature-256/i, /hub\.verify_token/,
    /isInternalWorker/, /timingSafeEqual/, /x-vapi-secret/,
    /requireAdmin/, /authenticate\(req\)/, /x-cron-token/i, /jobs_worker_token/,
    /WEBHOOK_SECRET/, /verifySignature/,
  ];
  const check = (fn) => {
    const file = join(FUNCTIONS_DIR, fn, 'index.ts');
    if (!existsSync(file)) return true; // covered by the existence test below
    return SELF_AUTH.some((re) => re.test(readFileSync(file, 'utf8')));
  };

  // Hard, for what this branch is responsible for.
  const mine = Object.entries(COMMUNICATIONS)
    .filter(([, caller]) => caller === 'service')
    .map(([fn]) => fn)
    .filter((fn) => !check(fn));
  assert.deepEqual(mine, [],
    'deployed with --no-verify-jwt and no authentication of its own:\n  - ' + mine.join('\n  - '));

  /*
   * Reported, for what it is not.
   *
   * Five older functions are deployed with --no-verify-jwt and show no caller
   * check in their source — they build a service-role client and act. They
   * predate this branch by a long way and are outside what it was asked to
   * touch, so this prints them rather than failing. It prints them because the
   * alternative is that nobody ever finds out.
   *
   * This is an observation from a pattern match, NOT a verified finding: a
   * function may authenticate in a way these patterns do not recognise, which
   * is exactly what happened with payment-webhook before its real check
   * (a provider webhook secret and signature) was added to the list above.
   * Each one needs reading before anything is concluded.
   */
  const preExisting = [...withoutJwt]
    .filter((fn) => !(fn in COMMUNICATIONS))
    .filter((fn) => !check(fn));
  if (preExisting.length) {
    console.log(`\n  ${preExisting.length} pre-existing function(s) deploy with --no-verify-jwt and show no` +
      ` caller check in source. Worth reading; not a finding on its own, and not from this branch:\n    ` +
      preExisting.join('\n    ') + '\n');
  }
});

test('the workflow never names a function that does not exist', () => {
  const missing = [...withJwt, ...withoutJwt]
    .filter((fn) => !existsSync(join(FUNCTIONS_DIR, fn, 'index.ts')));
  assert.deepEqual(missing, [],
    'deploy.yml would fail on these, taking the whole deploy with them:\n  - ' + missing.join('\n  - '));
});

test('config.toml agrees with the workflow about which functions skip the JWT check', () => {
  /*
   * The workflow passes --no-verify-jwt explicitly; config.toml is what a
   * deploy run BY HAND reads. When they disagree, whichever way the function
   * was last deployed wins, and nothing records which that was. That drift is
   * how homatch-ai stayed hand-deployed for months.
   *
   * Checked only for the communications functions: the two older workers
   * predate this file and are already consistent, and widening the check to
   * every historical function would turn a real guard into a chore.
   */
  const declared = new Set(
    [...CONFIG.matchAll(/^\[functions\.([a-z0-9-]+)\]\s*\nverify_jwt\s*=\s*false/gm)].map((m) => m[1])
  );
  const disagreements = [];
  for (const [fn, caller] of Object.entries(COMMUNICATIONS)) {
    if (caller === 'service' && !declared.has(fn)) {
      disagreements.push(`${fn}: deployed --no-verify-jwt by CI but config.toml does not say so, so a manual deploy would turn the check back on`);
    }
    if (caller === 'browser' && declared.has(fn)) {
      disagreements.push(`${fn}: config.toml disables the JWT check, but CI deploys it with the check on`);
    }
  }
  assert.deepEqual(disagreements, []);
});

test('no edge function in the repository is silently undeployable', () => {
  /*
   * Reported rather than asserted for the whole tree: a good number of older
   * functions are deployed by hand or are dormant, and failing on all of them
   * would make this file noise that gets skipped. The hard assertion above
   * covers the ten this branch adds; this prints the rest so the backlog is
   * visible instead of invisible.
   */
  const undeployed = onDisk.filter((fn) => !withJwt.has(fn) && !withoutJwt.has(fn));
  if (undeployed.length) {
    console.log(`\n  ${undeployed.length} edge function(s) exist but are in neither deploy array` +
      ` (pre-existing, not introduced here):\n    ${undeployed.join('\n    ')}\n`);
  }
  const comms = undeployed.filter((fn) => fn in COMMUNICATIONS);
  assert.deepEqual(comms, [], 'a Communications function slipped out of the deploy arrays');
});
