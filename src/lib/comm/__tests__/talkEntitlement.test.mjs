// The admin testing entitlement, and every way it must NOT be reachable.
//
// The quota it sets aside is the product's own: sessions and seconds per
// rolling day, and the length of one demo session. What it may never set
// aside is anything that protects the platform rather than the price of a
// demo — the kill switch, per-visitor concurrency, platform concurrency —
// and it may never be reachable from anything a client can write.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  decideGrant, DEFAULT_TALK_LIMITS, ADMIN_SESSION_SECONDS,
} from '../talkAllowance.ts';

const read = (p) => readFileSync(p, 'utf8').split('\r\n').join('\n');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The production limits as configured today, and a visitor who has used them up. */
const LIVE_LIMITS = {
  sessionSeconds: 90, dailySeconds: 2400, globalConcurrent: 25, perVisitorConcurrent: 1, dailySessions: 60,
};
const EXHAUSTED = {
  limits: LIVE_LIMITS,
  consumedTodaySeconds: 2400,     // every second of the day's allowance spent
  sessionsStartedToday: 60,       // and every session
  visitorActiveSessions: 0,
  globalActiveSessions: 3,
  enabled: true,
};

// ── VERIFIED_TATO_ADMIN_UNLIMITED / IP cap / daily cap / session cap ────────

test('a verified administrator is granted through an exhausted IP quota', () => {
  const d = decideGrant({ ...EXHAUSTED, usageTier: 'ADMIN_UNLIMITED' });
  assert.equal(d.granted, true, `refused: ${d.reason}`);
  assert.equal(d.usageTier, 'ADMIN_UNLIMITED');
  assert.equal(d.limitBypassed, true);
  assert.equal(d.bypassReason, 'VERIFIED_ADMIN_ENTITLEMENT');
});

test('the session-count cap does not apply to a verified administrator', () => {
  const d = decideGrant({ ...EXHAUSTED, consumedTodaySeconds: 0, usageTier: 'ADMIN_UNLIMITED' });
  assert.equal(d.granted, true);
  assert.notEqual(d.reason, 'TOO_MANY_SESSIONS_TODAY');
});

test('the daily-seconds cap does not apply to a verified administrator', () => {
  const d = decideGrant({ ...EXHAUSTED, sessionsStartedToday: 0, usageTier: 'ADMIN_UNLIMITED' });
  assert.equal(d.granted, true);
  assert.notEqual(d.reason, 'DAILY_LIMIT_REACHED');
});

test('an administrator gets the technical ceiling, not the demo length, and not forever', () => {
  const d = decideGrant({ ...EXHAUSTED, usageTier: 'ADMIN_UNLIMITED' });
  assert.equal(d.seconds, ADMIN_SESSION_SECONDS);
  assert.equal(ADMIN_SESSION_SECONDS, 900,
    'fifteen minutes: the speech worker closes its own socket at that point, so longer is a leak');
  assert.ok(d.seconds > LIVE_LIMITS.sessionSeconds, 'the 90-second demo cap is a product limit and is bypassed');
});

// ── NORMAL_USER_LIMITS_UNCHANGED / ANONYMOUS_LIMITS_UNCHANGED ──────────────

test('an ordinary signed-in account is held to exactly the anonymous rules', () => {
  const anon = decideGrant({ ...EXHAUSTED, usageTier: 'ANONYMOUS' });
  const user = decideGrant({ ...EXHAUSTED, usageTier: 'STANDARD' });
  assert.equal(anon.granted, false);
  assert.equal(user.granted, false);
  assert.equal(user.reason, anon.reason, 'signing in must buy nothing');
  assert.equal(user.limitBypassed, false);

  const freshAnon = decideGrant({ ...EXHAUSTED, consumedTodaySeconds: 0, sessionsStartedToday: 0, usageTier: 'ANONYMOUS' });
  const freshUser = decideGrant({ ...EXHAUSTED, consumedTodaySeconds: 0, sessionsStartedToday: 0, usageTier: 'STANDARD' });
  assert.equal(freshAnon.seconds, LIVE_LIMITS.sessionSeconds, 'anonymous demo length unchanged');
  assert.equal(freshUser.seconds, LIVE_LIMITS.sessionSeconds, 'standard demo length unchanged');
});

test('an absent tier means anonymous, so an older caller cannot be promoted by omission', () => {
  const d = decideGrant({ ...EXHAUSTED });
  assert.equal(d.usageTier, 'ANONYMOUS');
  assert.equal(d.granted, false);
});

test('the defaults still fail closed for anonymous visitors', () => {
  const d = decideGrant({
    limits: DEFAULT_TALK_LIMITS, consumedTodaySeconds: 0, sessionsStartedToday: 6,
    visitorActiveSessions: 0, globalActiveSessions: 0, enabled: true, usageTier: 'ANONYMOUS',
  });
  assert.equal(d.reason, 'TOO_MANY_SESSIONS_TODAY');
});

// ── GLOBAL_KILL_SWITCH_STILL_WORKS / PROVIDER_SAFETY_LIMITS_STILL_WORK ─────

test('the kill switch refuses an administrator too', () => {
  const d = decideGrant({ ...EXHAUSTED, enabled: false, usageTier: 'ADMIN_UNLIMITED' });
  assert.equal(d.granted, false);
  assert.equal(d.reason, 'DISABLED');
  assert.equal(d.limitBypassed, false);
});

test('platform concurrency refuses an administrator too', () => {
  const d = decideGrant({ ...EXHAUSTED, globalActiveSessions: 25, usageTier: 'ADMIN_UNLIMITED' });
  assert.equal(d.granted, false);
  assert.equal(d.reason, 'PLATFORM_AT_CAPACITY');
});

test('a second concurrent session from the same visitor refuses an administrator too', () => {
  // Two tabs fighting over one microphone is not a quota; it is a bug.
  const d = decideGrant({ ...EXHAUSTED, visitorActiveSessions: 1, usageTier: 'ADMIN_UNLIMITED' });
  assert.equal(d.granted, false);
  assert.equal(d.reason, 'ALREADY_IN_SESSION');
});

// ── SPOOFED_EMAIL / CLIENT_FLAG / INVALID_JWT / OTHER_USER cannot bypass ───

test('the tier is decided from the verified token and Postgres, never from the request', () => {
  const edge = strip(read('supabase/functions/ai-talk-session/index.ts'));
  const at = edge.indexOf('const usageTier: UsageTier =');
  assert.ok(at > 0, 'the tier decision is missing');
  // The expression only — up to its terminating semicolon. The dispatch that
  // follows legitimately reads body.action, and is not the tier decision.
  const decision = edge.slice(at, edge.indexOf(';', at) + 1);

  assert.ok(/caller\s*\?/.test(decision), 'no verified caller must mean anonymous');
  assert.ok(/caller\.sb\.rpc\('is_admin'\)/.test(decision),
    'admin status must come from public.is_admin() evaluated for the token\'s own auth.uid()');
  assert.ok(!/body\./.test(decision), 'nothing in the request body may influence the tier');
  assert.ok(!/email/i.test(decision), 'no email comparison anywhere in the tier decision');
});

test('no request field can claim the entitlement', () => {
  // The words a spoofer would try, absent from the entire grant path.
  const edge = strip(read('supabase/functions/ai-talk-session/index.ts'));
  const start = edge.slice(edge.indexOf('async function start('), edge.indexOf('\n}\n', edge.indexOf('async function start(')));
  for (const field of ['body.admin', 'body.unlimited', 'body.skipLimit', 'body.email', 'body.usageTier', 'body.tier']) {
    assert.ok(!start.includes(field), `${field} must have no authority`);
  }
  const allowance = strip(read('src/lib/comm/talkAllowance.ts'));
  assert.ok(!/email/i.test(allowance), 'the allowance module must not know what an email is');
});

test('an unverified token is anonymous, and an authenticated non-admin is standard', () => {
  // authenticate() returns null unless the auth service verifies the token;
  // is_admin() is asked only of a verified client. Both are structural: the
  // tier expression has exactly three outcomes and two of them are refusals
  // of the entitlement.
  const edge = strip(read('supabase/functions/ai-talk-session/index.ts'));
  const at = edge.indexOf('const usageTier: UsageTier =');
  const decision = edge.slice(at, edge.indexOf(';', at) + 1);
  assert.ok(/'ADMIN_UNLIMITED'/.test(decision) && /'STANDARD'/.test(decision) && /'ANONYMOUS'/.test(decision));
  assert.ok(/catch\(\(\) => false\)/.test(decision), 'a failed admin check must fall to non-admin, not throw open');
});

test('every grant decision is explained without a token, an address or an email', () => {
  const edge = read('supabase/functions/ai-talk-session/index.ts');
  const at = edge.indexOf("logEvent('ai-talk', 'grant_decided'");
  assert.ok(at > 0, 'grant decisions must be logged');
  const body = edge.slice(at, edge.indexOf('});', at));
  for (const field of ['authenticated', 'usageTier', 'limitType', 'limitBypassed', 'bypassReason']) {
    assert.ok(body.includes(field), `grant_decided must carry ${field}`);
  }
  assert.ok(!/ipHash|email|token|Authorization/.test(body), 'the decision log must carry no identity material');
});

// ── The signed-in visitor's AI TALK carries their identity ─────────────────

test('converse sends the session token as bearer when signed in, the anon key otherwise', () => {
  const read = (p) => readFileSync(p, 'utf8').split('\r\n').join('\n');
  const converse = read('src/lib/comm/converse.ts');
  // The bearer prefers the access token and falls back to the anon key.
  assert.ok(/Bearer \$\{req\.accessToken \|\| req\.anonKey\}/.test(converse),
    'the conversation must run as the signed-in visitor when there is one');
  // apikey stays the anon key — that header is the project key, not identity.
  assert.ok(/apikey: req\.anonKey/.test(converse));

  const panel = read('src/components/home/AiTalkPanel.tsx');
  assert.ok(/supabase\.auth\.getSession\(\)/.test(panel),
    'the panel must resolve the visitor session at start');
  assert.ok(/accessToken: accessTokenRef\.current/.test(panel),
    'the resolved token must reach converse');
});
