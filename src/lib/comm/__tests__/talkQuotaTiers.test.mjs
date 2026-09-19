/*
 * THREE TIERS, AND A REFUSAL THAT SURVIVES THE TRIP TO THE SCREEN.
 *
 * A real iPhone was shown "the voice demo is temporarily unavailable" while
 * the demo was working perfectly. The string was talk_unavailable_body, the
 * PROVIDER_ERROR fallback -- which proved the panel had no reason at all to
 * render. Production logs named the real one: at 2026-09-19T07:56:57.963Z a
 * grant was refused ALREADY_IN_SESSION on tier ADMIN_UNLIMITED, four seconds
 * after that same visitor was GRANTED 900 seconds at 07:56:53.760Z.
 *
 * Two independent defects, and both are covered here.
 *
 *   The reason never arrived. The refusal was HTTP 429, and supabase-js does
 *   not read the body of a non-2xx response -- it raises FunctionsHttpError
 *   and leaves the Response unconsumed on error.context. Every refusal there
 *   has ever been therefore reached the visitor as one generic sentence.
 *
 *   The refusal was wrong. A person's own stale session -- a reload, a closed
 *   tab -- locked them out of a second one for the rest of its grant, and an
 *   administrator felt it hardest because their grant is the longest.
 *
 * The tiers are the third thing: an administrator verified by Postgres, a
 * signed-in person spending their own allowance, and an anonymous visitor
 * spending a shared one. Claims about the server are asserted against its
 * source, because these are .ts/.tsx modules with imports and JSX a bare node
 * test cannot resolve -- the same constraint talkRecovery.test.mjs works
 * under.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decideGrant, DEFAULT_TALK_LIMITS, ADMIN_SESSION_SECONDS } from '../talkAllowance.ts';

const CR = String.fromCharCode(13);
const read = (p) => readFileSync(p, 'utf8').split(CR).join('');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const EDGE = read('supabase/functions/ai-talk-session/index.ts');
const EDGE_CODE = code(EDGE);
const PANEL = read('src/components/home/AiTalkPanel.tsx');
const PANEL_CODE = code(PANEL);
const ALLOWANCE_CODE = code(read('src/lib/comm/talkAllowance.ts'));
const I18N = read('src/i18n/translations.ts');

/** Production's real limits, as admin_settings.ai_talk_limits holds them. */
const LIVE = {
  ...DEFAULT_TALK_LIMITS,
  sessionSeconds: 120,
  dailySeconds: 2400,
  dailySessions: 60,
  globalConcurrent: 500,
  perVisitorConcurrent: 1,
};

const ask = (over = {}) => decideGrant({
  limits: LIVE,
  enabled: true,
  consumedTodaySeconds: 0,
  sessionsStartedToday: 0,
  visitorActiveSessions: 0,
  globalActiveSessions: 0,
  ...over,
});

/* ── 1-10 · ADMIN_UNLIMITED ──────────────────────────────────────────────
 * Unlimited means the product's demo QUOTA is set aside. It does not mean
 * the kill switch, concurrency, session lifecycle or metering are.
 */

test('01 · a verified administrator is granted despite a spent allowance', () => {
  const d = ask({ usageTier: 'ADMIN_UNLIMITED', consumedTodaySeconds: 99_999, sessionsStartedToday: 500 });
  assert.equal(d.granted, true);
  assert.equal(d.seconds, ADMIN_SESSION_SECONDS);
});

test('02 · the bypass is recorded, with the authority it came from', () => {
  const d = ask({ usageTier: 'ADMIN_UNLIMITED' });
  assert.equal(d.limitBypassed, true);
  assert.equal(d.bypassReason, 'VERIFIED_ADMIN_ENTITLEMENT');
  assert.equal(d.usageTier, 'ADMIN_UNLIMITED');
});

test('03 · an administrator does not override the operator kill switch', () => {
  const d = ask({ usageTier: 'ADMIN_UNLIMITED', enabled: false });
  assert.equal(d.granted, false);
  assert.equal(d.reason, 'DISABLED');
});

test('04 · an administrator does not override platform concurrency', () => {
  const d = ask({ usageTier: 'ADMIN_UNLIMITED', globalActiveSessions: LIVE.globalConcurrent });
  assert.equal(d.granted, false);
  assert.equal(d.reason, 'PLATFORM_AT_CAPACITY');
});

test('05 · one live session per visitor still holds for an administrator', () => {
  const d = ask({ usageTier: 'ADMIN_UNLIMITED', visitorActiveSessions: 1 });
  assert.equal(d.granted, false);
  assert.equal(d.reason, 'ALREADY_IN_SESSION');
});

test('06 · unlimited is a ceiling, not the absence of one', () => {
  assert.equal(ADMIN_SESSION_SECONDS, 900);
  const d = ask({ usageTier: 'ADMIN_UNLIMITED' });
  assert.ok(Number.isFinite(d.seconds) && d.seconds > 0, 'a session with no end is a leak, not a privilege');
});

test('07 · the tier is never read out of the request body', () => {
  const from = EDGE_CODE.indexOf('const usageTier');
  const decl = EDGE_CODE.slice(from, EDGE_CODE.indexOf('switch (body.action)'));
  assert.ok(from > 0 && decl.length > 40, 'the tier declaration has moved');
  assert.ok(!/body\./.test(decl), 'the caller can state their own tier');
  for (const claim of ['isAdmin', 'unlimited:', 'adminEmail', 'ADMIN_EMAIL']) {
    assert.ok(!EDGE_CODE.includes(claim), `a client-assertable admin claim exists: ${claim}`);
  }
});

test('08 · the entitlement is Postgres answering for the caller own token', () => {
  assert.ok(
    /caller\.sb\.rpc\('is_admin'\)/.test(EDGE_CODE),
    'is_admin must be asked of the client bound to the verified JWT, not the service client',
  );
  assert.ok(
    !/serviceClient\(\)[\s\S]{0,200}rpc\('is_admin'/.test(EDGE_CODE),
    'asking as the service role answers for the wrong identity, and would be true for everybody',
  );
});

test('09 · an administrator session is metered exactly like any other', () => {
  const at = EDGE_CODE.indexOf('const recordTurnUsage');
  assert.ok(at > 0, 'the usage recorder has moved or gone');
  const recorder = EDGE_CODE.slice(at, at + 3000);
  assert.ok(
    !/usageTier|ADMIN_UNLIMITED|limitBypassed/.test(recorder),
    'metering must not be conditional on who is talking, or administrator cost disappears',
  );
});

test('10 · no person, address or device is written into the entitlement path', () => {
  const forbidden = [
    /[a-z0-9._%+-]+@(gmail|outlook|yahoo|homatch)\./i,
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
    /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
  ];
  /*
   * Scoped to the code that DECIDES entitlement, deliberately. Elsewhere the
   * function holds provider identifiers -- a Cartesia voice is a uuid -- and
   * a sweep of the whole file would be a test about the wrong thing. What
   * must contain no person, address or device is the path from "who is this"
   * to "how many seconds do they get".
   */
  const entitlement = EDGE_CODE.slice(EDGE_CODE.indexOf('const usageTier'));
  const quota = entitlement.slice(0, entitlement.indexOf('const expiresAt'));
  assert.ok(quota.length > 1000, 'the entitlement path has moved');
  for (const source of [quota, ALLOWANCE_CODE, PANEL_CODE]) {
    for (const pattern of forbidden) {
      assert.ok(!pattern.test(source), `a hardcoded identity matching ${pattern} is in the shipped code`);
    }
  }
});

/* ── 11-17 · STANDARD, a signed-in person ────────────────────────────────
 * Their allowance is their own: counted against the account, and the same on
 * every device and every network they sign in from.
 */

const authed = (over) => decideGrant({
  limits: { ...DEFAULT_TALK_LIMITS },
  usageTier: 'STANDARD',
  enabled: true,
  consumedTodaySeconds: 0,
  sessionsStartedToday: 0,
  visitorActiveSessions: 0,
  globalActiveSessions: 0,
  ...over,
});

test('11 · a signed-in person spends the authenticated allowance', () => {
  assert.equal(DEFAULT_TALK_LIMITS.authenticatedDailySeconds, 600);
  const d = authed({ consumedTodaySeconds: DEFAULT_TALK_LIMITS.dailySeconds + 60 });
  assert.equal(d.granted, true, 'the anonymous ceiling is still being applied to an account');
});

test('12 · an account is counted against its user id, not its network', () => {
  assert.ok(
    /countedAgainst[\s\S]{0,300}user_id[\s\S]{0,160}ip_hash/.test(EDGE_CODE),
    'the allowance key no longer switches on whether the caller is authenticated',
  );
  assert.ok(
    !/\.eq\('ip_hash', ipHash\)\.gte\('created_at', day\)/.test(EDGE_CODE),
    'consumption is still read on the network for everybody',
  );
});

test('13 · an unset authenticated allowance falls back down, never open', () => {
  const limits = { ...DEFAULT_TALK_LIMITS };
  delete limits.authenticatedDailySeconds;
  const d = decideGrant({
    limits, usageTier: 'STANDARD', enabled: true,
    consumedTodaySeconds: limits.dailySeconds,
    sessionsStartedToday: 0, visitorActiveSessions: 0, globalActiveSessions: 0,
  });
  assert.equal(d.granted, false, 'a missing setting must not mean unlimited');
  assert.equal(d.reason, 'DAILY_LIMIT_REACHED');
});

test('14 · the session count cap cannot end an allowance early', () => {
  const d = authed({ consumedTodaySeconds: 180, sessionsStartedToday: DEFAULT_TALK_LIMITS.dailySessions });
  assert.equal(d.granted, true, 'six short calls must not end a ten-minute allowance');
  assert.ok(
    DEFAULT_TALK_LIMITS.authenticatedDailySessions > DEFAULT_TALK_LIMITS.dailySessions,
    'the two caps contradict each other again',
  );
});

test('15 · a spent authenticated allowance refuses by name', () => {
  const d = authed({ consumedTodaySeconds: DEFAULT_TALK_LIMITS.authenticatedDailySeconds });
  assert.equal(d.granted, false);
  assert.equal(d.reason, 'DAILY_LIMIT_REACHED');
  assert.equal(d.usageTier, 'STANDARD');
});

test('16 · the fifteen-second floor applies to an account too', () => {
  const d = authed({ consumedTodaySeconds: DEFAULT_TALK_LIMITS.authenticatedDailySeconds - 14 });
  assert.equal(d.granted, false, 'a demo that stops mid-sentence reads as broken');
  assert.equal(d.reason, 'DAILY_LIMIT_REACHED');
});

test('17 · signing in does not bypass the kill switch or concurrency', () => {
  assert.equal(ask({ usageTier: 'STANDARD', enabled: false }).reason, 'DISABLED');
  assert.equal(ask({ usageTier: 'STANDARD', visitorActiveSessions: 1 }).reason, 'ALREADY_IN_SESSION');
  assert.equal(
    ask({ usageTier: 'STANDARD', globalActiveSessions: LIVE.globalConcurrent }).reason,
    'PLATFORM_AT_CAPACITY',
  );
});

/* ── 18-19 · ANONYMOUS, unchanged ────────────────────────────────────────
 * The shared network allowance is abuse control. This work must not widen it.
 */

test('18 · the anonymous allowance is exactly what it was', () => {
  assert.equal(DEFAULT_TALK_LIMITS.dailySeconds, 240);
  assert.equal(DEFAULT_TALK_LIMITS.dailySessions, 6);
  assert.equal(DEFAULT_TALK_LIMITS.sessionSeconds, 120);
  assert.equal(DEFAULT_TALK_LIMITS.perVisitorConcurrent, 1);
  const d = ask({ usageTier: 'ANONYMOUS', consumedTodaySeconds: LIVE.dailySeconds });
  assert.equal(d.granted, false);
  assert.equal(d.reason, 'DAILY_LIMIT_REACHED');
});

test('19 · an anonymous visitor is still counted on the hashed network', () => {
  assert.ok(/ip_hash', value: ipHash/.test(EDGE_CODE), 'anonymous counting is no longer keyed on the network');
  assert.ok(/visitorHash|hashVisitor/.test(EDGE_CODE), 'the address must only ever be stored salted and hashed');
  assert.ok(!/remoteAddr|x-forwarded-for/i.test(ALLOWANCE_CODE), 'a raw address has entered the policy module');
});

/* ── 20-22 · precedence ──────────────────────────────────────────────────*/

test('20 · an absent tier is anonymous, never privileged', () => {
  const d = ask({ consumedTodaySeconds: LIVE.dailySeconds });
  assert.equal(d.usageTier, 'ANONYMOUS');
  assert.equal(d.granted, false);
});

test('21 · the tiers are ordered, and ordered the right way round', () => {
  const at300 = (tier) => decideGrant({
    limits: { ...DEFAULT_TALK_LIMITS }, usageTier: tier, enabled: true, consumedTodaySeconds: 300,
    sessionsStartedToday: 0, visitorActiveSessions: 0, globalActiveSessions: 0,
  });
  assert.equal(at300('ADMIN_UNLIMITED').seconds, ADMIN_SESSION_SECONDS);
  assert.equal(at300('STANDARD').granted, true);
  assert.equal(at300('ANONYMOUS').granted, false, '300 seconds is past the anonymous 240');
});

test('22 · every decision says which tier it was made for', () => {
  for (const tier of ['ANONYMOUS', 'STANDARD', 'ADMIN_UNLIMITED']) {
    assert.equal(ask({ usageTier: tier }).usageTier, tier);
    assert.equal(ask({ usageTier: tier, enabled: false }).usageTier, tier);
  }
});

/* ── 23-29 · what the person is actually told ────────────────────────────*/

test('23 · every refusal decideGrant can produce has a sentence of its own', () => {
  for (const r of ['DAILY_LIMIT_REACHED', 'TOO_MANY_SESSIONS_TODAY', 'ALREADY_IN_SESSION', 'PLATFORM_AT_CAPACITY', 'DISABLED']) {
    assert.ok(new RegExp(`${r}: 'talk_`).test(PANEL), `${r} has no sentence`);
  }
});

test('24 · a spent allowance is not rendered as the generic outage', () => {
  assert.ok(/DAILY_LIMIT_REACHED: 'DAILY_LIMIT_REACHED'/.test(PANEL_CODE), 'the reason no longer maps to a state');
  assert.ok(/DAILY_LIMIT_REACHED: 'talk_quota_daily_body'/.test(PANEL), 'the sentence is gone');
  const invitation = PANEL_CODE.slice(PANEL_CODE.indexOf('const messageKey'));
  assert.ok(
    !/DAILY_LIMIT_REACHED: 'talk_unavailable_body'/.test(invitation),
    'a quota is not an outage and must never say it is',
  );
});

test('25 · the status line names the state, and none of them says Unavailable', () => {
  for (const [state, key] of [
    ['DAILY_LIMIT_REACHED', 'talk_state_daily_limit'],
    ['SESSION_ALREADY_ACTIVE', 'talk_state_session_active'],
    ['BROWSER_UNSUPPORTED', 'talk_state_browser_unsupported'],
    ['NETWORK_ERROR', 'talk_state_network_error'],
  ]) {
    assert.ok(new RegExp(`${state}: '${key}'`).test(PANEL), `${state} has no status word`);
    assert.ok(new RegExp(`^  ${key}: '`, 'm').test(I18N), `${key} is not translated`);
  }
});

test('26 · a spent allowance is offered no retry, and is not a dead end', () => {
  const from = PANEL_CODE.indexOf("state === 'DAILY_LIMIT_REACHED' ? (");
  assert.ok(from > 0, 'the quota branch is gone from the control row');
  const branch = PANEL_CODE.slice(from, PANEL_CODE.indexOf('onClick={() => void start()}'));
  assert.ok(!/void start\(\)/.test(branch), 'a retry guaranteed to fail is being offered');
  assert.ok(/navigate\(/.test(branch), 'the one resting state without a retry must offer a way forward');
});

test('27 · the refusal body is read whether it arrives as data or as an error', () => {
  assert.ok(/async function readStartResponse/.test(PANEL_CODE), 'the refusal reader is gone');
  assert.ok(/error as \{ context\?: unknown \}/.test(PANEL_CODE), 'a 429 from an older runtime loses its reason again');
  assert.ok(/await readStartResponse\(data, error\)/.test(PANEL_CODE), 'start no longer reads the refusal');
});

test('28 · the quota copy exists in all six languages and promises renewal', () => {
  for (const key of ['talk_quota_daily_body', 'talk_quota_account_body', 'talk_quota_signin', 'talk_network_body']) {
    const rows = I18N.match(new RegExp(`^  ${key}: '`, 'gm')) ?? [];
    assert.equal(rows.length, 6, `${key} is in ${rows.length} locales, not six`);
  }
  const en = I18N.match(/^  talk_quota_account_body: '(.*)',$/m)[1];
  assert.ok(/renews within a day/.test(en), 'the copy must say it comes back');
  assert.ok(!/\d{1,2}:\d{2}|midnight|tomorrow at/i.test(en), 'a rolling window has no clock time to promise');
});

test('29 · a signed-in person is not told that their network ran out', () => {
  assert.ok(/'talk_quota_account_body'/.test(PANEL_CODE), 'the account sentence is never selected');
  assert.ok(/tier === 'STANDARD'/.test(PANEL_CODE), 'the sentence no longer depends on whose allowance it was');
  const account = I18N.match(/^  talk_quota_account_body: '(.*)',$/m)[1];
  assert.ok(!/network/i.test(account), 'an account allowance has nothing to do with a network');
  const shared = I18N.match(/^  talk_quota_daily_body: '(.*)',$/m)[1];
  assert.ok(/network/i.test(shared), 'the anonymous sentence must say whose allowance it is');
});

/* ── 30-32 · the boundaries, unchanged ───────────────────────────────────*/

test('30 · fifteen seconds is granted and fourteen is refused', () => {
  const left = (n) => ask({ usageTier: 'ANONYMOUS', consumedTodaySeconds: LIVE.dailySeconds - n });
  assert.equal(left(15).granted, true);
  assert.equal(left(15).seconds, 15);
  assert.equal(left(14).granted, false);
  assert.equal(left(14).reason, 'DAILY_LIMIT_REACHED');
});

test('31 · overspending cannot produce a negative or unbounded grant', () => {
  const d = ask({ usageTier: 'ANONYMOUS', consumedTodaySeconds: LIVE.dailySeconds * 10 });
  assert.equal(d.granted, false);
  assert.equal(d.seconds, 0);
  const n = ask({ usageTier: 'ANONYMOUS', consumedTodaySeconds: -5_000 });
  assert.ok(n.seconds <= LIVE.sessionSeconds, 'a negative consumption must not buy extra time');
});

test('32 · the window is a rolling day, which is what the copy promises', () => {
  assert.ok(/86_400_000/.test(EDGE_CODE), 'the window is no longer a rolling 24 hours');
  assert.ok(!/setHours\(0, 0, 0, 0\)/.test(EDGE_CODE), 'a calendar midnight would make the copy a lie');
  assert.ok(/window: 'ROLLING_24H'/.test(EDGE_CODE), 'the refusal no longer says which window it means');
});

/* ── 33-40 · the regressions this pass exists to prevent ─────────────────*/

test('33 · a refusal answers 200 so that its body is delivered', () => {
  const at = EDGE_CODE.indexOf("logEvent('ai-talk', 'grant_refused'");
  assert.ok(at > 0, 'the refusal branch has moved');
  const refusal = EDGE_CODE.slice(at, EDGE_CODE.indexOf('const expiresAt'));
  assert.ok(/reason: decision\.reason/.test(refusal), 'the reason is no longer in the body');
  assert.ok(/\}, 200\);/.test(refusal), 'a non-2xx refusal body is discarded by supabase-js');
});

test('34 · no refusal in the grant path answers 429 any more', () => {
  const grant = EDGE_CODE.slice(EDGE_CODE.indexOf('async function start('), EDGE_CODE.indexOf('const expiresAt'));
  assert.ok(grant.length > 500, 'start() has moved');
  assert.ok(!/, 429\)/.test(grant), 'a 429 here loses the reason on its way to the browser');
});

test('35 · a visitor own stale session is superseded, not held against them', () => {
  const at = EDGE_CODE.indexOf("ended_reason: 'superseded'");
  assert.ok(at > 0, 'the supersede is gone, and a reload locks people out again');
  assert.ok(at < EDGE_CODE.indexOf('const decision = decideGrant('), 'superseding after the decision is too late');
});

test('36 · superseding is scoped to one visitor and never to everybody', () => {
  const at = EDGE_CODE.indexOf("ended_reason: 'superseded'");
  const stmt = EDGE_CODE.slice(at, at + 400);
  assert.ok(/\.eq\(countedAgainst\.column, countedAgainst\.value\)/.test(stmt), 'it is not keyed on the visitor');
  assert.ok(/\.eq\('state', 'ACTIVE'\)/.test(stmt), 'it would end sessions that had already ended');
});

test('37 · no internal term is ever put in front of a person', () => {
  const leaks = ['grant_refused', 'usageTier', 'ip_hash', 'visitor hash', 'quota engine', 'DAILY_LIMIT_REACHED'];
  for (const line of I18N.split('\n').filter((l) => /^  talk_/.test(l))) {
    for (const leak of leaks) {
      assert.ok(!line.includes(leak), `a translation leaks an internal term: ${line.trim().slice(0, 60)}`);
    }
  }
});

test('38 · the browser never declares its own tier', () => {
  assert.ok(!/usageTier:\s*'/.test(PANEL_CODE), 'the panel is asserting a tier rather than being told one');
  const at = PANEL_CODE.indexOf("body: { action: 'start'");
  assert.ok(at > 0, 'the start request has moved');
  assert.ok(!/admin|tier|unlimited/i.test(PANEL_CODE.slice(at, at + 200)), 'the start request carries a privilege claim');
});

test('39 · the generic sentence is the last fallback and nothing else', () => {
  assert.ok(/PROVIDER_ERROR: 'talk_unavailable_body'/.test(PANEL), 'the final fallback is gone');
  const map = PANEL_CODE.slice(PANEL_CODE.indexOf('const REFUSAL_STATE'), PANEL_CODE.indexOf('type StartResponse'));
  assert.equal((map.match(/'PROVIDER_ERROR'/g) ?? []).length, 1, 'only an operator kill switch is honestly unavailable');
  assert.ok(/DISABLED: 'PROVIDER_ERROR'/.test(map), 'the kill switch is the one reason that IS unavailability');
});

test('40 · all four new states are translated in every language', () => {
  for (const key of ['talk_state_daily_limit', 'talk_state_session_active', 'talk_state_browser_unsupported', 'talk_state_network_error']) {
    const rows = I18N.match(new RegExp(`^  ${key}: '(.*)',$`, 'gm')) ?? [];
    assert.equal(rows.length, 6, `${key} is in ${rows.length} locales, not six`);
    for (const row of rows) {
      assert.ok(!/: ''/.test(row), `${key} is empty in one locale`);
      assert.ok(!/unavailable/i.test(row), `${key} still says unavailable`);
    }
  }
});
