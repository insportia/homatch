// Two minutes, governed by time and nothing else.
//
// A real Android conversation stopped answering after four Georgian turns.
// The cause was not a bug in the audio path: production carried
// session_seconds = 90, four unhurried turns reach it, and reaching it ran
//
//   void this.stop('allowance');   // not awaited
//   this.setState('LIMIT_REACHED');
//
// from inside a 250ms interval. If the assistant was speaking it was cut off
// mid-sentence; if it was not, the panel simply stopped answering. Neither
// tells a visitor that their two minutes are up.
//
// These drive the decision itself rather than reading the source of it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_TALK_LIMITS, decideGrant, shouldEndSession, grantExpiry } from '../talkAllowance.ts';

test('one session is two minutes', () => {
  assert.equal(DEFAULT_TALK_LIMITS.sessionSeconds, 120);
});

test('nothing in the allowance counts TURNS', () => {
  // The governing limit is time. A visitor who takes twelve short turns must
  // not be cut off before one who takes four long ones.
  assert.ok(!Object.keys(DEFAULT_TALK_LIMITS).some((k) => /turn/i.test(k)),
    `a turn ceiling appeared in ${Object.keys(DEFAULT_TALK_LIMITS).join(', ')}`);
});

test('a fresh visitor is granted the full two minutes', () => {
  const d = decideGrant({
    tier: 'ANONYMOUS', limits: DEFAULT_TALK_LIMITS,
    consumedTodaySeconds: 0, sessionsStartedToday: 0,
    globalActive: 0, visitorActive: 0, enabled: true, providersReady: true,
  });
  assert.equal(d.granted, true, d.granted ? '' : String(d.reason));
  assert.equal(d.seconds, 120, 'the whole two minutes, not a fraction of them');
});

test('many short turns inside the window are all allowed', () => {
  // Twelve turns of eight seconds is 96s: inside two minutes, so the session
  // must still be live at every one of them.
  const startedAt = new Date('2026-01-01T00:00:00Z');
  const expiresAt = grantExpiry(120, startedAt);
  for (let turn = 1; turn <= 12; turn++) {
    const consumed = turn * 8;
    const v = shouldEndSession({
      grantedSeconds: 120, consumedSeconds: consumed, startedAt, expiresAt,
      now: new Date(startedAt.getTime() + consumed * 1000),
    });
    assert.equal(v.end, false, `turn ${turn} at ${consumed}s was ended early`);
  }
});

test('the session ends on TIME, and says which limit it was', () => {
  const startedAt = new Date('2026-01-01T00:00:00Z');
  const v = shouldEndSession({
    grantedSeconds: 120, consumedSeconds: 120, startedAt,
    expiresAt: grantExpiry(120, startedAt),
    now: new Date(startedAt.getTime() + 120_000),
  });
  assert.equal(v.end, true);
  assert.ok(v.reason, 'an ending with no reason is indistinguishable from a freeze');
});

test('the grant outlives the allowance, so nothing expires mid-sentence', () => {
  const startedAt = new Date('2026-01-01T00:00:00Z');
  const slack = grantExpiry(120, startedAt).getTime() - startedAt.getTime() - 120_000;
  assert.ok(slack >= 10_000,
    `only ${slack}ms of slack: a grant that dies while somebody is talking reads as a crash`);
});

// ── The client's half of it ───────────────────────────────────────────────

const client = readFileSync('src/lib/comm/voiceClient.ts', 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('reaching the limit blocks new turns instead of severing the current one', () => {
  const c = strip(client);
  assert.match(c, /if \(this\.newTurnsBlocked\) return;/,
    'no NEW turn may start once the time is up');
  assert.match(c, /SESSION_LIMIT_GRACE_MS/,
    'and whatever is already being said must get a bounded chance to finish');
  assert.doesNotMatch(c, /void this\.stop\('allowance'\);\s*\n\s*this\.setState\('LIMIT_REACHED'\)/,
    'ending from inside the tick, unawaited, is what cut people off mid-sentence');
});

test('a session that stops answering can always say why', () => {
  const c = strip(client);
  for (const field of ['sessionElapsedMs', 'sessionRemainingMs', 'sessionMaxMs',
    'turnCount', 'newTurnsBlocked', 'sessionEndReason']) {
    assert.ok(c.includes(field), `${field} must reach the trace`);
  }
  assert.match(c, /SESSION_TIME_LIMIT/, 'the reason must be nameable, not just truthy');
});
