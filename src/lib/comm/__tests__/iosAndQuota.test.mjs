/*
 * WHY AN IPHONE SAID "UNAVAILABLE" WHILE AN ANDROID WORKED.
 *
 * It was not Safari. Production logs, 2026-09-19 07:02:48 to 07:03:17 UTC:
 * four `grant_refused` events, reason DAILY_LIMIT_REACHED. The visitor is
 * identified by hashVisitor(ip, salt), so the allowance is per NETWORK, and
 * that network had spent 2,386 of its 2,400 daily seconds across 50 sessions.
 * Fourteen were left; decideGrant refuses a grant below fifteen because a
 * demo that stops mid-sentence reads as broken. The Android was on a
 * different address with 1,004 seconds still on it.
 *
 * The bug was that the visitor could not tell any of that from an outage.
 *
 * These tests cover the quota boundary exactly as it is -- the policy is not
 * changed here -- and the two genuine Safari weaknesses found while looking
 * for a Safari bug that did not exist.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decideGrant, DEFAULT_TALK_LIMITS } from '../talkAllowance.ts';

const CR = String.fromCharCode(13);
const read = (p) => readFileSync(p, 'utf8').split(CR).join('');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const client = read('src/lib/comm/voiceClient.ts');
const panel = read('src/components/home/AiTalkPanel.tsx');
const translations = read('src/i18n/translations.ts');

/** Production's real limits, from admin_settings.ai_talk_limits. */
const LIVE = {
  ...DEFAULT_TALK_LIMITS,
  sessionSeconds: 120, dailySeconds: 2400, dailySessions: 60,
  globalConcurrent: 500, perVisitorConcurrent: 1,
};
const ask = (over) => decideGrant({
  limits: LIVE, usageTier: 'ANONYMOUS', enabled: true,
  consumedTodaySeconds: 0, sessionsStartedToday: 0,
  visitorActiveSessions: 0, globalActiveSessions: 0,
  ...over,
});

/* ── The boundary, exactly as the policy stands ─────────────────────────── */

test('fourteen seconds left is refused, and fifteen is a fifteen-second demo', () => {
  // The precise arithmetic that refused the iPhone four times.
  const fourteen = ask({ consumedTodaySeconds: LIVE.dailySeconds - 14 });
  assert.equal(fourteen.granted, false);
  assert.equal(fourteen.reason, 'DAILY_LIMIT_REACHED');
  assert.equal(fourteen.userMessage, 'LIMIT_REACHED');
  assert.equal(fourteen.seconds, 0);

  const fifteen = ask({ consumedTodaySeconds: LIVE.dailySeconds - 15 });
  assert.equal(fifteen.granted, true, 'fifteen is the floor, not the first refusal');
  assert.equal(fifteen.seconds, 15);

  // Unchanged either side of it.
  assert.equal(ask({ consumedTodaySeconds: 0 }).seconds, 120);
  assert.equal(ask({ consumedTodaySeconds: LIVE.dailySeconds }).reason, 'DAILY_LIMIT_REACHED');
  assert.equal(ask({ consumedTodaySeconds: LIVE.dailySeconds + 500 }).reason, 'DAILY_LIMIT_REACHED');
});

test('the quota is untouched: same limits, same refusals, same reasons', () => {
  // Nothing in this pass may loosen the allowance. Asserted against the
  // shipped defaults so a change to them has to come here and argue.
  assert.equal(DEFAULT_TALK_LIMITS.sessionSeconds, 120);
  assert.equal(DEFAULT_TALK_LIMITS.dailySeconds, 240);
  assert.equal(DEFAULT_TALK_LIMITS.dailySessions, 6);
  assert.equal(DEFAULT_TALK_LIMITS.perVisitorConcurrent, 1);
  const allowance = read('src/lib/comm/talkAllowance.ts');
  assert.match(allowance, /if \(seconds < 15\) return refuse\('DAILY_LIMIT_REACHED', 'LIMIT_REACHED'\);/);
  assert.match(allowance, /hashVisitor/, 'the visitor is still the network, unchanged');
});

test('each refusal reason is a different thing to be told', () => {
  assert.equal(ask({ sessionsStartedToday: LIVE.dailySessions }).reason, 'TOO_MANY_SESSIONS_TODAY');
  assert.equal(ask({ visitorActiveSessions: 1 }).reason, 'ALREADY_IN_SESSION');
  assert.equal(ask({ globalActiveSessions: LIVE.globalConcurrent }).reason, 'PLATFORM_AT_CAPACITY');
  assert.equal(ask({ enabled: false }).reason, 'DISABLED');
  // And the server has always sent it. The panel simply never read it.
  const edge = read('supabase/functions/ai-talk-session/index.ts');
  assert.match(edge, /return json\(\{ ok: false, reason: decision\.reason, userMessage: decision\.userMessage \}, 429\);/);
});

/* ── A: a quota is not an outage, a microphone or a browser ─────────────── */

test('a used-up daily allowance says so, and says it is temporary', () => {
  assert.match(panel, /DAILY_LIMIT_REACHED: 'talk_quota_daily_body',/);
  assert.match(panel, /TOO_MANY_SESSIONS_TODAY: 'talk_quota_sessions_body',/);
  assert.match(panel, /if \(grant\?\.reason\) setFailure\(grant\.reason\);/);

  const body = translations.match(/talk_quota_daily_body: '([^']*)'/)[1];
  // It must name the cause, and say it comes back.
  assert.match(body, /network/i);
  assert.match(body, /resets/i);
  // And it must not read as any of the three things it is not.
  assert.ok(!/microphone/i.test(body), 'not a microphone problem');
  assert.ok(!/browser/i.test(body), 'not a browser problem');
  assert.ok(!/unavailable|down|error/i.test(body), 'not an outage');
  // Present, and really translated, in all six.
  const rows = translations.match(/^  talk_quota_daily_body: '.*',$/gm) ?? [];
  assert.equal(rows.length, 6, 'six locales');
  assert.equal(new Set(rows).size, 6, 'six DIFFERENT sentences, not English copied');
});

test('the quota sentence is not the sentence for a finished session', () => {
  // These were the same string, which is how "you have used today's time"
  // and "this conversation is over" became indistinguishable.
  const quota = translations.match(/talk_quota_daily_body: '([^']*)'/)[1];
  const ended = translations.match(/talk_limit_body: '([^']*)'/)[1];
  assert.notEqual(quota, ended);
});

/* ── B: a browser that cannot capture audio at all ──────────────────────── */

test('a missing mediaDevices is BROWSER_UNSUPPORTED, not a missing microphone', () => {
  /*
   * navigator.mediaDevices is undefined on a page that is not a secure
   * context and inside several in-app browsers. Reaching through it threw a
   * TypeError, whose name matches nothing in the table, so it fell to
   * AUDIO_UNAVAILABLE and told the visitor no microphone was found -- on a
   * phone that has one, with nothing they could do about it.
   */
  const c = strip(client);
  assert.match(c, /export function microphoneCapability\(\): 'OK' \| 'BROWSER_UNSUPPORTED'/);
  assert.match(c, /if \(!devices \|\| typeof devices\.getUserMedia !== 'function'\) return 'BROWSER_UNSUPPORTED';/);
  assert.match(c, /if \(typeof Ctx !== 'function'\) return 'BROWSER_UNSUPPORTED';/);
  // Asked BEFORE the property is dereferenced, so no TypeError is thrown.
  assert.match(c, /if \(microphoneCapability\(\) !== 'OK'\) throw new Error\('BROWSER_UNSUPPORTED'\);/);
  const openAt = c.indexOf('private async openMicrophone');
  const guardAt = c.indexOf("throw new Error('BROWSER_UNSUPPORTED')", openAt);
  const useAt = c.indexOf('navigator.mediaDevices.getUserMedia', openAt);
  assert.ok(guardAt > openAt && guardAt < useAt, 'the guard precedes the dereference');
  // And a TypeError that reaches the classifier anyway is named correctly.
  assert.match(c, /if \(err\?\.message === 'BROWSER_UNSUPPORTED' \|\| err\?\.name === 'TypeError'\) return 'BROWSER_UNSUPPORTED';/);
  // The panel answers it before touching the network.
  assert.match(panel, /const \{ microphoneCapability \} = await modulePromise;/);
  assert.match(panel, /setFailure\('BROWSER_UNSUPPORTED'\);/);
  assert.match(panel, /BROWSER_UNSUPPORTED: 'talk_browser_unsupported_body',/);
});

test('every microphone outcome has its own sentence', () => {
  // MIC_MISSING, MIC_BUSY, MIC_TIMEOUT and AUDIO_UNAVAILABLE all fell through
  // to one sentence about a missing device, which was wrong for three of them.
  for (const [code, key] of [
    ['MIC_MISSING', 'talk_mic_unavailable_body'],
    ['MIC_BUSY', 'talk_mic_busy_body'],
    ['MIC_TIMEOUT', 'talk_mic_timeout_body'],
    ['AUDIO_UNAVAILABLE', 'talk_audio_unavailable_body'],
    ['BROWSER_UNSUPPORTED', 'talk_browser_unsupported_body'],
  ]) {
    assert.ok(panel.includes(`${code}: '${key}',`), `${code} -> ${key}`);
    const q = String.fromCharCode(34) + String.fromCharCode(39);
    const rows = translations.match(new RegExp('^  ' + key + ': [' + q + '].*,$', 'gm')) ?? [];
    assert.equal(rows.length, 6, `${key} in six locales`);
  }
  // MIC_DENIED keeps its own, which already existed and is correct.
  assert.match(panel, /MIC_DENIED: 'talk_mic_denied_body',/);
});

/* ── D: the gesture Safari will not let us borrow later ─────────────────── */

test('the audio context is built inside the tap, before any await', () => {
  /*
   * WebKit lets a page make sound only when the AudioContext can be
   * attributed to a user gesture, and the gesture does not survive a token
   * read, an edge round trip and a 174 KB dynamic import. A context built
   * after those starts suspended and its resume is refused -- silently: the
   * session still reaches LISTENING and simply never makes a sound.
   */
  const p = strip(panel);
  const startAt = p.indexOf('const start = useCallback(async () => {');
  const ctxAt = p.indexOf('new AudioCtx()', startAt);
  const firstAwait = p.indexOf('await ', startAt);
  assert.ok(ctxAt > startAt, 'a context is constructed in the handler');
  assert.ok(ctxAt < firstAwait, 'and before the first await in it');
  assert.match(p, /if \(primed\.state === 'suspended'\) void primed\.resume\(\)/);
  // The import is started in the gesture too, so it is no longer in the way.
  const importAt = p.indexOf("import('@/lib/comm/voiceClient')", startAt);
  assert.ok(importAt < firstAwait, 'the module fetch starts inside the tap');
  assert.match(p, /const \{ VoiceSession: Session \} = await modulePromise;/);
  // The session adopts it rather than building its own too late.
  assert.match(p, /session\.adoptAudioContext\(primed\);/);
  const c = strip(client);
  assert.match(c, /adoptAudioContext\(ctx: AudioContext \| null\): void \{/);
  assert.match(c, /this\.audioContext = this\.primedContext \?\? new Ctx\(\);/);
});

test('a suspended context is still not treated as a failure', () => {
  // The session must proceed and report, never refuse to start.
  const c = strip(client);
  assert.match(c, /if \(this\.audioContext\.state === 'suspended'\) \{\s*await this\.audioContext\.resume\(\)\.catch/);
  assert.match(c, /if \(this\.audioContext\.state === 'running'\) this\.milestone\('audio_context_running'\);/);
  // And a context that could not be built at all does not strand the session.
  assert.match(strip(panel), /\} catch \{ primed = null; \}/);
});

test('constraints Safari may refuse outright are asked for as preferences', () => {
  // A bare value may be treated as a requirement, and WebKit is stricter than
  // Chromium: a device that cannot do 16 kHz mono answers OverconstrainedError
  // instead of doing its best, and that read as a broken microphone.
  const c = strip(client);
  for (const pref of ['echoCancellation: { ideal: true }', 'noiseSuppression: { ideal: true }',
    'autoGainControl: { ideal: true }', 'channelCount: { ideal: 1 }',
    'sampleRate: { ideal: TARGET_SAMPLE_RATE }']) {
    assert.ok(c.includes(pref), pref);
  }
  // Nothing downstream assumes any of them was granted.
  assert.match(c, /this\.resampler = new Resampler\(this\.audioContext\.sampleRate, TARGET_SAMPLE_RATE\);/);
});

/* ── C, E, F: the paths that must not have moved ────────────────────────── */

test('a denied permission is still its own state, not a quota or an outage', () => {
  const c = strip(client);
  assert.match(c, /case 'NotAllowedError':\s*case 'SecurityError':\s*case 'PermissionDeniedError':\s*return 'MIC_DENIED';/);
  assert.match(c, /this\.setState\(reason === 'MIC_DENIED' \? 'MIC_DENIED' : 'MIC_UNAVAILABLE'/);
  assert.match(panel, /MIC_DENIED: 'talk_mic_denied_body',/);
});

test('a real backend failure is still a backend failure', () => {
  // No reason from the server, or a transport error, still reads as an outage
  // rather than being mistaken for a quota.
  assert.match(panel, /setState\(grant\?\.userMessage === 'LIMIT_REACHED' \? 'LIMIT_REACHED' : 'PROVIDER_ERROR'\);/);
  assert.match(panel, /PROVIDER_ERROR: 'talk_unavailable_body',/);
  assert.match(panel, /DISABLED: 'talk_unavailable_body',/);
});

test('the supported path is unchanged, and so is everything behind it', () => {
  const c = strip(client);
  // One pipeline. Google speech, Luna, Cartesia, exactly as before.
  assert.match(c, /createScriptProcessor\(4096, 1, 1\)/, 'same capture path');
  assert.match(c, /navigator\.mediaDevices\.getUserMedia\(/, 'same microphone call');
  assert.equal((c.match(/navigator\.mediaDevices\.getUserMedia\(/g) ?? []).length, 1,
    'one microphone call, not a second pipeline');
  assert.match(read('supabase/functions/_shared/comm/llm.ts'), /'gpt-5\.6-luna'/);
  const edge = strip(read('supabase/functions/ai-talk-session/index.ts'));
  assert.match(edge, /streamCartesiaPcm/);
  assert.match(edge, /role: 'STT', model: `\$\{GOOGLE_STT_MODEL\}:\$\{leg\.stream\}`/);
  // The work of the last several passes is still standing.
  assert.match(c, /get turnShape\(\)/);
  assert.match(c, /this\.unconfirmedLanguage = resolution\.proposedLanguage;/);
  assert.match(edge, /recordTurnUsage/);
  assert.match(edge, /abandon\(/);
  const t = read('src/lib/comm/transcript.ts');
  assert.match(t, /assertiveEnergy: 0\.34,/);
  assert.match(t, /confirmMs: 450,/);
});
