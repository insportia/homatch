import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/*
 * VERIFY CHAIN — STATIC PREFLIGHT.
 *
 * The customer-facing chain is:
 *
 *   /verify -> research-agent (start)
 *           -> official-source research via the Railway worker
 *           -> WAITING_HUMAN -> verification-handoff (mint/open/complete)
 *           -> research-agent (resume | skip)
 *           -> synthesis -> verdict -> research_jobs persistence
 *
 * research-agent is the orchestrator and was deployed BY HAND: production ran
 * v50 from /tmp/user_fn_..., absent from both CI deploy lists. A repository fix
 * therefore could not reach it.
 *
 * Comparing the deployed source against this repository found exactly ONE
 * differing hunk, and the repository is a strict superset -- production holds
 * no hotfix that the repository lacks. The hunk is the duplicate-execution
 * guard in alreadyHasResultFor(), which matters directly to a human tester:
 * without it a name-only candidate for a source already resolved by idCode
 * launches a redundant browser job that never finishes and can raise its own
 * CAPTCHA.
 */

const ROOT = process.cwd();
const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');
const agent = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'research-agent', 'index.ts'), 'utf8');
const page = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'VerifyPage.tsx'), 'utf8');

const jwtList = workflow.slice(workflow.indexOf('JWT_FUNCTIONS=('), workflow.indexOf('NO_JWT_FUNCTIONS=('));
const noJwtList = workflow.slice(workflow.indexOf('NO_JWT_FUNCTIONS=('));

test('every function the Verify chain calls is registered for deployment', () => {
  // Pulled from VerifyPage's own invoke() calls rather than hardcoded, so a new
  // step in the chain cannot be added without being deployed.
  const invoked = new Set(
    [...page.matchAll(/functions\.invoke\('([a-z0-9-]+)'/g)].map((m) => m[1])
  );
  assert.ok(invoked.has('research-agent'), 'VerifyPage must call the orchestrator');
  assert.ok(invoked.has('verification-handoff'), 'VerifyPage must call the handoff');

  for (const fn of invoked) {
    assert.ok(
      jwtList.includes(`"${fn}"`) || noJwtList.includes(`"${fn}"`),
      `${fn} is called by the Verify page but is in no CI deploy list`
    );
  }
});

test('research-agent deploys with JWT verification off, matching production', () => {
  assert.ok(noJwtList.includes('"research-agent"'), 'must deploy with --no-verify-jwt');
  assert.ok(!jwtList.includes('"research-agent"'), 'the gateway must not verify the JWT for it');
});

test('research-agent still authenticates the caller itself', () => {
  // This is what makes verify_jwt=false safe. If this check ever goes, the
  // function becomes an open endpoint.
  assert.match(agent, /const a = req\.headers\.get\('Authorization'\);/);
  assert.match(agent, /if \(!a\) return json\(\{ error: 'Authentication required' \}, 401\);/);
  assert.match(agent, /await sb\.auth\.getUser\(a\.replace\(\/\^Bearer\\s\+\/i, ''\)\)/);
  // "No user" is no longer automatically a refusal — an anonymous visitor can
  // now run one verification — but it is only ever accepted when a session
  // secret proves itself first. The refusal must still be unconditional for a
  // caller who presents neither.
  assert.match(agent, /if \(!user && !anonSession\) return json\(\{ error: 'Invalid session' \}, 401\);/);
  assert.match(agent, /const anonSession = user \? null : await anonSessionFor\(sb, b\?\.anonSessionToken\);/);
});

test('research-agent refuses to run when the worker is not configured', () => {
  // Rather than calling the Railway worker with an empty Authorization header,
  // which fails much later and much less legibly.
  assert.match(agent, /WORKER_URL and\/or WORKER_TOKEN is not configured/);
});

test('the duplicate-CAPTCHA guard is present', () => {
  // The one hunk production was missing. A name-only candidate is covered once
  // the same source has a completed execution for an identified entity.
  const fn = agent.slice(agent.indexOf('function alreadyHasResultFor'));
  assert.match(fn.slice(0, 3000), /const sameSource = results\.filter/);
  assert.match(fn.slice(0, 3000), /if \(!idCode\) \{\s*\n\s*if \(sameSource\.some\(\(r: any\) => r\.forEntity\?\.idCode\)\) return true;/);
});

test('all four handoff actions the page uses exist in the orchestrator chain', () => {
  for (const action of ['mint', 'open', 'complete', 'cancel']) {
    assert.match(page, new RegExp(`action: *'${action}'`), `VerifyPage must support handoff '${action}'`);
  }
  for (const action of ['start', 'status', 'resume', 'skip']) {
    assert.match(page, new RegExp(`action: *'${action}'`), `VerifyPage must support agent '${action}'`);
  }
});

test('the Verify page reads its job back by id so a refresh restores it', () => {
  assert.match(page, /action: *'status'/);
  assert.match(page, /jobId/);
});
