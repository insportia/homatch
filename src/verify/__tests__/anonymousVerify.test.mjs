// Running a verification before you have an account.
//
// The bargain is specific: the research runs in full — same job, same
// evidence, same synthesis — and the REPORT is what you sign in for. Which
// makes exactly one thing load-bearing, and it is not a UI state:
//
//   the finished report must not be in the response.
//
// A gate implemented in React is not a gate. The report would still be in the
// network tab, in the React tree, and in any copy of the page source. So the
// tests below are mostly about the shape of what leaves the server, and about
// the three limits that stop an unpaid visitor spending unbounded provider
// money.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ANON_TOKEN_MIN_LENGTH,
  anonSessionUsable,
  anonTokenPlausible,
} from '../../auth/anonymousSessionServer.ts';

const ROOT = process.cwd();
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

const agent = () => read('supabase', 'functions', 'research-agent', 'index.ts');
const page = () => read('src', 'pages', 'VerifyPage.tsx');
const aiFn = () => read('supabase', 'functions', 'homatch-ai', 'index.ts');

const HOUR = 3_600_000;
const session = (over = {}) => ({
  id: 's1',
  expires_at: new Date(Date.now() + 24 * HOUR).toISOString(),
  claimed_at: null,
  research_jobs: 0,
  ...over,
});

/* ── the shared rule, exercised rather than read ─────────────────────── */

test('a live, unclaimed session may act', () => {
  assert.equal(anonSessionUsable(session()), true);
});

test('a claimed session may not act again', () => {
  // Its work belongs to an account now, and RLS is what protects it there.
  // Honouring the old secret would be a second, weaker key that outlives the
  // handover.
  assert.equal(anonSessionUsable(session({ claimed_at: new Date().toISOString() })), false);
});

test('an expired session may not act', () => {
  assert.equal(anonSessionUsable(session({ expires_at: new Date(Date.now() - HOUR).toISOString() })), false);
});

test('a session expiring this instant is already over', () => {
  const now = Date.now();
  assert.equal(anonSessionUsable(session({ expires_at: new Date(now).toISOString() }), now), false);
});

test('a missing session is not a usable one', () => {
  assert.equal(anonSessionUsable(null), false);
  assert.equal(anonSessionUsable(undefined), false);
});

test('a token too short to be one of ours is refused before any lookup', () => {
  // Not only about guessing: a lookup is an oracle, and refusing on shape
  // first means obviously-invalid input never reaches the database at all.
  assert.equal(anonTokenPlausible('x'.repeat(ANON_TOKEN_MIN_LENGTH - 1)), false);
  assert.equal(anonTokenPlausible('x'.repeat(ANON_TOKEN_MIN_LENGTH)), true);
  for (const notAToken of [null, undefined, 0, {}, [], true]) {
    assert.equal(anonTokenPlausible(notAToken), false, `${String(notAToken)} was accepted`);
  }
});

test('both anonymous endpoints ask the same question', () => {
  // If the two ever drift, the looser one becomes the real rule.
  for (const [name, src] of [['research-agent', agent()], ['homatch-ai', aiFn()]]) {
    assert.ok(/anonSessionUsable\(/.test(src), `${name} judges a session by its own rule`);
    assert.ok(/anonymousSessionServer\.ts'/.test(src), `${name} does not import the shared rule`);
  }
});

/* ── the report does not leave ───────────────────────────────────────── */

test('a finished report is removed from the response, not hidden in it', () => {
  const src = agent();
  const i = src.indexOf('function withholdReportUntilSignIn');
  assert.ok(i > 0, 'nothing withholds the report');
  const fn = src.slice(i, src.indexOf('\nfunction ', i + 10));
  for (const field of ['result_json', 'report', 'synthesis']) {
    assert.ok(new RegExp(`${field}: _`).test(fn), `${field} still reaches an anonymous caller`);
  }
  assert.ok(/awaitingSignIn: true/.test(fn), 'the client is told nothing about why');
});

test('every job response for an anonymous caller goes through the gate', () => {
  const src = agent();
  // forCaller() is the only thing that may answer with a job; a bare
  // sanitizeForCustomer() in the handler would be a hole.
  const handler = src.slice(src.indexOf("const a = req.headers.get('Authorization');"));
  const bare = handler.match(/return json\(sanitizeForCustomer\(/g) ?? [];
  assert.equal(bare.length, 0, 'a job is returned without passing the anonymous gate');
  // Three places answer with a job: cancel-on-finished, cancel, and status.
  assert.equal((handler.match(/forCaller\(/g) ?? []).length, 3,
    'a job response was added or removed without going through the gate');
});

test('a job still running is not altered by the gate', () => {
  // There is no report yet to withhold, and the visitor should keep watching
  // their own research run.
  assert.ok(/if \(!job \|\| job\.status !== 'COMPLETE'\) return job;/.test(agent()),
    'the gate touches jobs that have nothing to hide');
});

test('reads are scoped by owner, so knowing a job id is never enough', () => {
  const src = agent();
  // research_jobs.id appears in URLs. It authorises nothing.
  assert.ok(!/\.eq\('id', id\)\.eq\('user_id', user\.id\)/.test(src),
    'a read still hard-codes the account owner and cannot see an anonymous job');
  assert.equal((src.match(/ownedBy\(sb\.from\('research_jobs'\)/g) ?? []).length, 3,
    'not every job read is owner-scoped');
  assert.ok(/anonSession \? q\.eq\('anon_session_id', anonSession\.id\) : q\.eq\('user_id', user!\.id\)/.test(src),
    'ownership is not decided by who the caller actually is');
});

test('an anonymous job is owned by the session, never by nobody', () => {
  // user_id IS NULL with no anon_session_id would be a row no policy matches
  // and no claim could ever move — invisible work.
  assert.ok(/\{ user_id: null, anon_session_id: anonSession\.id \}/.test(agent()),
    'an anonymous job is not attached to its session');
});

/* ── the spend is bounded ────────────────────────────────────────────── */

test('one verification per anonymous session, counted in the database', () => {
  const src = agent();
  assert.ok(/const ANON_RESEARCH_JOBS_PER_SESSION = 1;/.test(src), 'the per-session limit is gone');
  assert.ok(/\(anonSession\.research_jobs \?\? 0\) >= ANON_RESEARCH_JOBS_PER_SESSION/.test(src),
    'the limit is not checked');
  assert.ok(/update\(\{ research_jobs: \(anonSession\.research_jobs \?\? 0\) \+ 1 \}\)/.test(src),
    'the count never rises, so the limit never binds');
});

test('and a ceiling per address, because minting a session is cheap', () => {
  const src = agent();
  assert.ok(/ANON_RESEARCH_STARTS_PER_IP_PER_DAY/.test(src), 'clearing site data buys another free run');
  assert.ok(/rate_limit_events/.test(src), 'the ceiling is not recorded anywhere');
});

test('the verification is counted before the money is spent', () => {
  // The opposite of the chat turn, deliberately: a run that fails halfway has
  // still spent provider money, so the failure worth preventing here is an
  // unbounded retry loop.
  const src = agent();
  const iCount = src.indexOf('research_jobs: (anonSession.research_jobs ?? 0) + 1');
  const iInsert = src.indexOf("const { data: j, error } = await sb.from('research_jobs').insert(");
  assert.ok(iCount > 0 && iInsert > iCount, 'an anonymous run starts before it is counted');
});

test('being out of free runs is not presented as a failure', () => {
  assert.ok(/code: 'ANON_LIMIT_REACHED'/.test(agent()), 'the client cannot tell this from an error');
});

/* ── the page ────────────────────────────────────────────────────────── */

test('the withheld state is handled before the branch that needs a report', () => {
  // The COMPLETE branch requires result_json, which is exactly what is
  // missing. Handled in the wrong order, the page polls a finished job for
  // ever and the visitor watches research that ended minutes ago.
  const src = page();
  const iWithheld = src.indexOf("if(data?.awaitingSignIn)");
  const iComplete = src.indexOf("if(data?.status==='COMPLETE'&&data.result_json)");
  assert.ok(iWithheld > 0, 'the page does not handle a withheld report');
  assert.ok(iWithheld < iComplete, 'the withheld case is checked after the case that cannot match');
});

test('the page stops polling once there is nothing left to wait for', () => {
  const src = page();
  const i = src.indexOf('if(data?.awaitingSignIn)');
  const block = src.slice(i, i + 400);
  assert.ok(/again=false;stop\(\)/.test(block), 'the page keeps polling a finished job');
  assert.ok(/setLoading\(false\)/.test(block), 'the page keeps showing a research stream');
});

test('a poll never mints an anonymous identity', () => {
  // Only starting a verification creates one. A status poll that minted a
  // session would hand a fresh identity to anyone who loaded a job URL.
  const src = page();
  assert.ok(/action:'status'[^}]*currentAnonymousToken\(\)/.test(src),
    'the status poll does not carry the existing token');
  assert.ok(!/action:'status'[^}]*ensureAnonymousSession/.test(src),
    'a status poll can mint a session');
  assert.ok(/action:'start'[\s\S]{0,200}anonToken/.test(src), 'starting a run carries no session');
});

test('signing in re-reads the job rather than running it again', () => {
  // Same row, same id; only the owner changed. Re-running would charge the
  // provider twice for research that is already finished and paid for.
  const src = page();
  const i = src.indexOf("'homatch:anon-claimed'");
  assert.ok(i > 0, 'nothing happens when the work is claimed');
  const handler = src.slice(src.lastIndexOf('const onClaimed', i), i);
  assert.ok(/check\(id\)/.test(handler), 'the claimed job is not re-read');
  assert.ok(!/action:'start'|run\(\)/.test(handler), 'signing in starts a second research run');
});

test('the sign-in prompt says the research is already done', () => {
  // "Sign in to run this" and "sign in to see what we already found" are
  // different products. It is the second.
  const en = read('src', 'i18n', 'translations.ts');
  assert.ok(/verify_anon_ready_title: 'Your full research is ready'/.test(en));
  assert.ok(/verify_anon_ready_body: 'Sign in to view it\./.test(en));
  assert.equal((en.match(/verify_anon_ready_title:/g) ?? []).length, 6,
    'the copy is missing in some language, so those buyers see English');
});

/* ── coming back to where you were ───────────────────────────────────── */

test('a remembered return path only ever points inside this app', async () => {
  // It is read back out of storage and navigated to, so a value naming another
  // origin would be an open redirect firing on a freshly authenticated
  // session. Refused, not sanitised.
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const { rememberPendingPath, takePendingPath } = await import('../../services/returnTo.ts');

  rememberPendingPath('/verify?job=abc');
  assert.equal(takePendingPath(), '/verify?job=abc');

  for (const hostile of ['//evil.example/x', 'https://evil.example', 'javascript:alert(1)']) {
    store.clear();
    rememberPendingPath(hostile);
    assert.equal(takePendingPath(), null, `${hostile} was accepted as a return path`);
  }
});

test('a return path is consumed once', async () => {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const { rememberPendingPath, takePendingPath } = await import('../../services/returnTo.ts');
  rememberPendingPath('/verify?job=abc');
  assert.equal(takePendingPath(), '/verify?job=abc');
  assert.equal(takePendingPath(), null, 'a stale return path survives to hijack a later sign-in');
});

test('both ways into an account honour it', () => {
  // Email and Google land in different files; only one of them having it
  // means half the visitors silently lose their place.
  assert.ok(/takePendingPath\(\)/.test(read('src', 'pages', 'auth', 'LoginPage.tsx')));
  assert.ok(/takePendingPath\(\)/.test(read('src', 'pages', 'auth', 'AuthCallbackPage.tsx')));
});
