// Edge boot smoke in the deploy pipeline (stabilization 2026-10-30).
//
// Production 2026-10-29: verify-synthesis was deployed and proven byte-exact
// yet could not boot (a missing export): every call answered 503 BOOT_ERROR.
// After an edge deploy, every critical function is now asked one CORS
// preflight; anything but a booted module fails the deploy summary.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { CRITICAL_FUNCTIONS, classifyBoot, probe, retryable, summaryMarkdown } from '../../scripts/release/edgeBootSmoke.mjs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const WF = read('.github/workflows/deploy.yml');

test('the critical list is the one the incident review asked for, and every function exists', () => {
  for (const fn of ['verify-synthesis', 'research-agent', 'homatch-ai', 'saas-checkout', 'saas-payments-webhook', 'marketplace-search', 'deal-room-document-analyze', 'jobs-worker', 'atomic-unlock', 'homi-voice-transcribe']) {
    assert.ok(CRITICAL_FUNCTIONS.includes(fn), fn);
  }
  for (const fn of CRITICAL_FUNCTIONS) assert.ok(existsSync(new URL(`../../supabase/functions/${fn}/index.ts`, import.meta.url)), `${fn} exists`);
});

test('a preflight is side-effect free: every critical function answers OPTIONS (or refuses the method) before anything else', () => {
  for (const fn of CRITICAL_FUNCTIONS) {
    const src = read(`supabase/functions/${fn}/index.ts`);
    const early = /req\.method === 'OPTIONS'\)\s*return/.test(src) || /req\.method !== 'POST'\)\s*return json\(\{ error: 'METHOD_NOT_ALLOWED' \}, 405\)/.test(src);
    assert.ok(early, `${fn} must answer OPTIONS / refuse non-POST without doing work`);
  }
});

test('classification: booted, boot error, server error, missing, gateway-only', () => {
  assert.equal(classifyBoot(200, 'ok'), 'BOOTED');
  assert.equal(classifyBoot(204, ''), 'BOOTED');
  assert.equal(classifyBoot(405, '{"error":"METHOD_NOT_ALLOWED"}'), 'BOOTED');
  assert.equal(classifyBoot(401, '{"error":"Unauthorized"}'), 'BOOTED', 'the function itself refused: it booted');
  assert.equal(classifyBoot(503, '{"code":"BOOT_ERROR","message":"Worker failed to boot (please check logs)"}'), 'BOOT_ERROR');
  assert.equal(classifyBoot(500, 'SyntaxError: The requested module does not provide an export named x'), 'BOOT_ERROR');
  assert.equal(classifyBoot(502, 'bad gateway'), 'SERVER_ERROR');
  assert.equal(classifyBoot(546, 'WORKER_LIMIT'), 'SERVER_ERROR');
  assert.equal(classifyBoot(404, '{"code":"NOT_FOUND","message":"Requested function was not found"}'), 'NOT_DEPLOYED');
  assert.equal(classifyBoot(401, '{"code":401,"message":"Missing authorization header"}'), 'UNPROVEN');
  assert.equal(classifyBoot(401, '{"code":401,"message":"Invalid JWT"}'), 'UNPROVEN');
  assert.equal(classifyBoot(0, 'fetch failed'), 'UNREACHABLE');
  assert.equal(retryable('SERVER_ERROR'), true);
  assert.equal(retryable('BOOT_ERROR'), false, 'a boot error is not a cold start');
});

test('probe: OPTIONS with the anon key, retries transient 5xx, stops at a boot error', async () => {
  const calls = [];
  const answers = [[502, 'x'], [200, 'ok']];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const [status, body] = answers.shift();
    return { status, text: async () => body };
  };
  const r = await probe('https://p.supabase.co', 'verify-synthesis', { anonKey: 'anon', fetchImpl, sleep: async () => {} });
  assert.equal(r.verdict, 'BOOTED');
  assert.equal(r.tries, 2);
  assert.equal(calls[0].url, 'https://p.supabase.co/functions/v1/verify-synthesis');
  assert.equal(calls[0].init.method, 'OPTIONS');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer anon');
  assert.equal('body' in calls[0].init, false, 'no body is ever sent');

  let n = 0;
  const boot = await probe('https://p.supabase.co', 'x', { fetchImpl: async () => { n++; return { status: 503, text: async () => 'BOOT_ERROR' }; }, sleep: async () => {} });
  assert.equal(boot.verdict, 'BOOT_ERROR');
  assert.equal(n, 1);
});

test('the summary names every function that did not boot', () => {
  const md = summaryMarkdown([{ fn: 'a', verdict: 'BOOTED', status: 200, body: '', tries: 1 }, { fn: 'verify-synthesis', verdict: 'BOOT_ERROR', status: 503, body: 'BOOT_ERROR', tries: 1 }]);
  assert.match(md, /FAILED \(1 of 2 did not boot\)/);
  assert.match(md, /`verify-synthesis` \| \*\*BOOT_ERROR\*\* \| 503/);
});

test('deploy.yml: the smoke runs after an edge deploy, keeps every proof step, and turns the summary red', () => {
  const job = WF.slice(WF.indexOf('  deploy-functions:'), WF.indexOf('  summary:'));
  const proveAt = job.indexOf('- name: Prove it in production');
  const advanceAt = job.indexOf('- name: Advance refs/deployed/edge');
  const smokeAt = job.indexOf('- name: Edge boot smoke (critical functions)');
  assert.ok(proveAt > 0 && advanceAt > proveAt, 'existing proof and ref steps intact and in order');
  assert.ok(smokeAt > advanceAt, 'the smoke never decides the ref: it runs after it');
  const step = job.slice(smokeAt);
  assert.match(step, /if: always\(\) && steps\.owed\.outputs\.count != '0'/);
  assert.match(step, /SUPABASE_ANON_KEY: \$\{\{ secrets\.VITE_SUPABASE_ANON_KEY \}\}/);
  assert.match(step, /node scripts\/release\/edgeBootSmoke\.mjs/);
  assert.match(step, /exit 1/);
  assert.equal(/SERVICE_ROLE/.test(step), false, 'never the service key');
  assert.match(job, /boot_smoke: \$\{\{ steps\.boot\.outputs\.result \}\}/);
  assert.match(WF, /\| Edge boot smoke \| \$\{\{ needs\.deploy-functions\.outputs\.boot_smoke/);
});
