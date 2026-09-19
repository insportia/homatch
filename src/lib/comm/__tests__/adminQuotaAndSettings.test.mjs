/*
 * AN ADMINISTRATOR HAS NO DAILY BUDGET, AND THE ONE NUMBER THEY DO HAVE IS A
 * LIFECYCLE CEILING ON A SINGLE SOCKET.
 *
 * ADMIN_SESSION_SECONDS reads like a quota and is not one. It is the fifteen
 * minutes the speech worker enforces on its own connection, after which a
 * session is a leak rather than a conversation. Reaching it spends nothing,
 * because there is nothing to spend: decideGrant returns for an administrator
 * BEFORE either rolling-day cap is read, so no quantity of past usage can
 * turn into a refusal. These tests pin that ordering, because it is an
 * ordering -- one reordered block and an administrator inherits the demo
 * quota silently.
 *
 * The second half covers the two authenticated limits becoming editable in
 * the Admin screen that already writes admin_settings.ai_talk_limits. No new
 * settings system, no new table, no second writer: the same key the edge
 * function already reads on every grant.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decideGrant, DEFAULT_TALK_LIMITS, ADMIN_SESSION_SECONDS } from '../talkAllowance.ts';

const CR = String.fromCharCode(13);
const read = (p) => readFileSync(p, 'utf8').split(CR).join('');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const EDGE = code(read('supabase/functions/ai-talk-session/index.ts'));
const ALLOWANCE = code(read('src/lib/comm/talkAllowance.ts'));
const TALK_PANEL = read('src/components/home/AiTalkPanel.tsx');
const ADMIN_PANEL = read('src/components/admin/CommunicationsVoicePanel.tsx');
const SERVICE = read('src/services/communications.ts');
const TYPES = read('src/types/communications.ts');
const I18N = read('src/i18n/translations.ts');

const ask = (over = {}) => decideGrant({
  limits: { ...DEFAULT_TALK_LIMITS },
  enabled: true,
  consumedTodaySeconds: 0,
  sessionsStartedToday: 0,
  visitorActiveSessions: 0,
  globalActiveSessions: 0,
  ...over,
});

const admin = (over = {}) => ask({ usageTier: 'ADMIN_UNLIMITED', ...over });

/* ── The administrator's rolling quota is unlimited ──────────────────────*/

test('no amount of accumulated time refuses an administrator', () => {
  // A full day of talking, a week of it, and a number past any real total.
  for (const consumed of [600, 2_400, 86_400, 10_000_000]) {
    const d = admin({ consumedTodaySeconds: consumed });
    assert.equal(d.granted, true, `refused after ${consumed}s`);
    assert.equal(d.seconds, ADMIN_SESSION_SECONDS);
    assert.notEqual(d.reason, 'DAILY_LIMIT_REACHED');
  }
});

test('no number of sessions today refuses an administrator', () => {
  for (const started of [6, 12, 50, 500]) {
    const d = admin({ sessionsStartedToday: started });
    assert.equal(d.granted, true, `refused after ${started} sessions`);
    assert.notEqual(d.reason, 'TOO_MANY_SESSIONS_TODAY');
  }
});

test('both at once, which is what a day of real testing looks like', () => {
  const d = admin({ consumedTodaySeconds: 99_999, sessionsStartedToday: 999 });
  assert.equal(d.granted, true);
  assert.equal(d.seconds, ADMIN_SESSION_SECONDS);
  assert.equal(d.limitBypassed, true);
  assert.equal(d.bypassReason, 'VERIFIED_ADMIN_ENTITLEMENT');
});

test('the admin branch is read before either daily cap, and that is the guarantee', () => {
  const at = ALLOWANCE.indexOf('if (admin) {');
  const sessions = ALLOWANCE.indexOf('sessionsStartedToday >=');
  const seconds = ALLOWANCE.indexOf('remainingToday <= 0');
  assert.ok(at > 0 && sessions > 0 && seconds > 0, 'decideGrant no longer reads the way this test does');
  assert.ok(at < sessions, 'the session-count cap is now reached before the admin bypass');
  assert.ok(at < seconds, 'the seconds cap is now reached before the admin bypass');
});

/* ── The ceiling is a session length, not a budget ───────────────────────*/

test('the ceiling is one number about one session', () => {
  assert.equal(ADMIN_SESSION_SECONDS, 900);
  // It does not shrink as the day goes on, which is what a budget would do.
  assert.equal(admin({ consumedTodaySeconds: 0 }).seconds, 900);
  assert.equal(admin({ consumedTodaySeconds: 850 }).seconds, 900);
  assert.equal(admin({ consumedTodaySeconds: 100_000 }).seconds, 900);
});

test('a session that reaches the ceiling is ENDED, so the next Start is free', () => {
  /*
   * The row has to stop being ACTIVE, or perVisitorConcurrent would refuse
   * the next attempt for as long as the expiry window had left. The heartbeat
   * writes ENDED the moment shouldEndSession says so.
   */
  const at = EDGE.indexOf('const verdict = shouldEndSession({');
  assert.ok(at > 0, 'the heartbeat verdict has moved');
  const after = EDGE.slice(at, at + 2000);
  assert.ok(
    /verdict\.end \? \{ state: 'ENDED', ended_at: [^}]*ended_reason: verdict\.reason \}/.test(after),
    'a session that hit its ceiling is left ACTIVE, which locks the next one out',
  );

  // And with the row ended, the very next decision is a grant.
  const next = admin({ visitorActiveSessions: 0, consumedTodaySeconds: 900 });
  assert.equal(next.granted, true);
  assert.equal(next.seconds, ADMIN_SESSION_SECONDS);
});

test('what an administrator still does not get to skip', () => {
  assert.equal(admin({ enabled: false }).reason, 'DISABLED');
  assert.equal(admin({ visitorActiveSessions: 1 }).reason, 'ALREADY_IN_SESSION');
  assert.equal(
    admin({ globalActiveSessions: DEFAULT_TALK_LIMITS.globalConcurrent }).reason,
    'PLATFORM_AT_CAPACITY',
  );
});

test('an administrator is never told their allowance ran out', () => {
  assert.ok(/talk_session_ceiling_body/.test(TALK_PANEL), 'the ceiling sentence is gone');
  assert.ok(
    /grantedTier === 'ADMIN_UNLIMITED'/.test(code(TALK_PANEL)),
    'the ending is no longer distinguished by the tier the session was granted on',
  );
  const rows = I18N.match(/^  talk_session_ceiling_body: '(.*)',$/gm) ?? [];
  assert.equal(rows.length, 6, `the ceiling sentence is in ${rows.length} locales, not six`);
  const en = I18N.match(/^  talk_session_ceiling_body: '(.*)',$/m)[1];
  assert.ok(!/limit reached|allowance|used up|over for now/i.test(en), 'it still reads as a spent allowance');
});

/* ── The two authenticated limits, editable where the others already are ─*/

test('the shape an operator edits carries both', () => {
  assert.match(TYPES, /authenticated_daily_seconds: number;/);
  assert.match(TYPES, /authenticated_daily_sessions: number;/);
});

test('the server reads both from the same settings key it already read', () => {
  assert.match(EDGE, /eq\('key', 'ai_talk_limits'\)/);
  assert.match(EDGE, /authenticatedDailySeconds: num\(\s*'authenticated_daily_seconds',/);
  assert.match(EDGE, /authenticatedDailySessions: num\(\s*'authenticated_daily_sessions',/);
});

test('the Admin screen offers a control for each', () => {
  assert.match(ADMIN_PANEL, /labelKey="admin_talk_auth_seconds"/);
  assert.match(ADMIN_PANEL, /labelKey="admin_talk_auth_sessions"/);
  assert.match(ADMIN_PANEL, /authenticated_daily_seconds: v/);
  assert.match(ADMIN_PANEL, /authenticated_daily_sessions: v/);
  for (const key of ['admin_talk_auth_group', 'admin_talk_auth_seconds', 'admin_talk_auth_seconds_hint',
    'admin_talk_auth_sessions', 'admin_talk_auth_sessions_hint', 'admin_talk_minutes',
    'admin_talk_auth_below_anon']) {
    const rows = I18N.match(new RegExp(`^  ${key}: '`, 'gm')) ?? [];
    assert.equal(rows.length, 6, `${key} is in ${rows.length} locales, not six`);
  }
});

test('production values are unchanged, and Reset would write exactly them', () => {
  assert.equal(DEFAULT_TALK_LIMITS.authenticatedDailySeconds, 600);
  assert.equal(DEFAULT_TALK_LIMITS.authenticatedDailySessions, 12);
  const block = ADMIN_PANEL.slice(
    ADMIN_PANEL.indexOf('const DEFAULT_LIMITS'),
    ADMIN_PANEL.indexOf('export function CommunicationsVoicePanel'),
  );
  const shipped = {
    session_seconds: DEFAULT_TALK_LIMITS.sessionSeconds,
    daily_seconds: DEFAULT_TALK_LIMITS.dailySeconds,
    global_concurrent: DEFAULT_TALK_LIMITS.globalConcurrent,
    per_visitor_concurrent: DEFAULT_TALK_LIMITS.perVisitorConcurrent,
    daily_sessions: DEFAULT_TALK_LIMITS.dailySessions,
    authenticated_daily_seconds: DEFAULT_TALK_LIMITS.authenticatedDailySeconds,
    authenticated_daily_sessions: DEFAULT_TALK_LIMITS.authenticatedDailySessions,
  };
  for (const [field, value] of Object.entries(shipped)) {
    assert.match(
      block, new RegExp(`${field}: ${value},`),
      `Reset would write a ${field} the server does not ship -- the button does something other than its label`,
    );
  }
});

test('signing in can never be made to take time away', () => {
  const guard = ADMIN_PANEL.slice(
    ADMIN_PANEL.indexOf('const onSaveLimits'),
    ADMIN_PANEL.indexOf('setSavingLimits(true)'),
  );
  assert.ok(
    /limits\.authenticated_daily_seconds < limits\.daily_seconds/.test(guard),
    'a signed-in allowance below the anonymous one can be saved',
  );
  assert.ok(
    /limits\.authenticated_daily_sessions < limits\.daily_sessions/.test(guard),
    'a signed-in session cap below the anonymous one can be saved',
  );
  assert.ok(/admin_talk_auth_below_anon/.test(guard), 'the refusal is silent');
  assert.ok(/return;/.test(guard), 'the invalid value is reported and then saved anyway');
});

test('negative and out-of-range values cannot be typed in, let alone saved', () => {
  // The control clamps as it is typed; these are the bounds it clamps to.
  const seconds = ADMIN_PANEL.slice(ADMIN_PANEL.indexOf('labelKey="admin_talk_auth_seconds"'));
  assert.match(seconds.slice(0, 300), /min=\{60\} max=\{7200\}/);
  const sessions = ADMIN_PANEL.slice(ADMIN_PANEL.indexOf('labelKey="admin_talk_auth_sessions"'));
  assert.match(sessions.slice(0, 300), /min=\{1\} max=\{100\}/);
  assert.match(ADMIN_PANEL, /onChange\(Math\.min\(max, Math\.max\(min, n\)\)\)/);
  assert.match(ADMIN_PANEL, /if \(Number\.isFinite\(n\)\)/, 'a blank or NaN would reach the state');
});

test('seconds stay the stored unit; minutes are only ever read back', () => {
  assert.match(ADMIN_PANEL, /function minutesOf\(seconds: number\): string/);
  // Shown beside the field, never written: the note is a prop on the label,
  // and nothing converts on the way to the database.
  assert.match(ADMIN_PANEL, /note=\{t\('admin_talk_minutes', \{ minutes: minutesOf\(/);
  assert.ok(
    !/authenticated_daily_seconds: [a-z]*[Mm]inutes/.test(ADMIN_PANEL),
    'the setting is being stored in minutes',
  );
  const en = I18N.match(/^  admin_talk_minutes: '(.*)',$/m)[1];
  assert.ok(en.includes('{{minutes}}'), 'the placeholder t() substitutes is {{minutes}}');
});

test('no second settings system was created', () => {
  // One key, one reader, one writer.
  assert.equal((SERVICE.match(/'ai_talk_limits'/g) ?? []).length, 2, 'ai_talk_limits is read and written once each');
  assert.match(SERVICE, /export async function saveAiTalkLimits/);
  assert.ok(
    !/ai_talk_authenticated|authenticated_limits|ai_talk_user_limits/.test(SERVICE + ADMIN_PANEL + EDGE),
    'a parallel settings key was introduced',
  );
  // And the save still carries whatever is on the object, so the two new
  // fields travel without a second write path.
  assert.match(SERVICE, /const \{ enabled, \.\.\.limits \} = value;/);
});

test('the anonymous abuse-protection settings are untouched', () => {
  assert.equal(DEFAULT_TALK_LIMITS.dailySeconds, 240);
  assert.equal(DEFAULT_TALK_LIMITS.dailySessions, 6);
  assert.equal(DEFAULT_TALK_LIMITS.perVisitorConcurrent, 1);
  assert.equal(DEFAULT_TALK_LIMITS.globalConcurrent, 25);
  // per_visitor_concurrent was never editable here and still is not.
  assert.ok(
    !/labelKey="admin_talk_per_visitor/.test(ADMIN_PANEL),
    'the per-visitor concurrency guard became editable, which is not a quota',
  );
});
