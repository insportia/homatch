import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * A MICROPHONE PROBLEM MUST NOT BE A DEAD END.
 *
 * Observed on a real 390px Chrome against production: getUserMedia was
 * rejected the way a browser rejects it, AI TALK said "Allow it in your
 * browser and try again" — and then offered nothing to try it with. The only
 * way back was a page reload, which the copy never asks for.
 *
 * Worse, the session row the server had already handed out was left ACTIVE.
 * The server refuses a second session while one is active, so even a reload
 * bought the visitor a refusal from their own abandoned attempt, and the
 * browser kept heartbeating a session with no microphone and no socket.
 *
 * These three facts are what make the loop closeable. They are asserted
 * against the source text because these are .tsx/.ts modules with JSX and
 * path aliases that a bare node test cannot import — the same constraint
 * talkStates.test.mjs works under.
 */

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const PANEL = '../../components/home/AiTalkPanel.tsx';
const FUNCTION = '../../../supabase/functions/ai-talk-session/index.ts';

test('every resting state offers a way back', () => {
  const src = read(PANEL);

  // The button that restarts a session, and whatever guards it.
  const at = src.indexOf('onClick={onStart}');
  assert.ok(at > 0, 'the restart button no longer calls onStart');
  const guard = src.slice(src.lastIndexOf('{', at - 200), at);

  assert.ok(
    !/\{!unavailable \?/.test(guard),
    'the restart button is hidden for unavailable states again — a mic problem is the visitor\'s to clear, so it needs a button',
  );
  assert.ok(
    !/state !== 'PROVIDER_ERROR'/.test(guard),
    'PROVIDER_ERROR now covers a single failed transcription call, which is usually gone by the next attempt',
  );

  // And it must say "again", not "start", once they have already tried.
  assert.ok(
    /finished \|\| unavailable \? 'talk_again'/.test(src),
    'a retry after a failure should read as trying again, not as starting fresh',
  );
});

test('a resting failure says which thing failed, when it knows', () => {
  // "The voice demo is temporarily unavailable" over a failed transcription
  // call tells a visitor nothing they can act on, and told us nothing either.
  const src = read(PANEL);
  assert.ok(
    /TRANSCRIBE_FAILED: 'talk_err_stt'/.test(src),
    'a failed transcription should map to the speech-recognition sentence',
  );
  assert.ok(
    /FAILURE_KEY\[failure\] \? FAILURE_KEY\[failure\] : messageKey\[state\]/.test(src),
    'the resting face should prefer a named failure over the generic state copy',
  );
});

test('a session that never opened is handed back before the panel gives up', () => {
  const src = read(PANEL);

  const started = src.indexOf('await session.start();');
  assert.ok(started > 0, 'the panel no longer starts the session the way this test reads it');
  const heartbeat = src.indexOf('heartbeatRef.current = window.setInterval', started);
  assert.ok(heartbeat > started, 'the heartbeat no longer follows the start');

  const between = src.slice(started, heartbeat);
  assert.ok(
    /currentState/.test(between) && /endSession\(/.test(between) && /\breturn;/.test(between),
    'a start that did not reach LISTENING must release the server session and must not begin heartbeating it',
  );
  assert.ok(
    /!== 'LISTENING'/.test(between),
    'only a session that is actually listening should be kept',
  );
});

test('the server records a conversation that never happened as ABORTED', () => {
  const src = read(FUNCTION);

  const at = src.indexOf('async function end(');
  assert.ok(at > 0, 'the end handler was renamed');
  const body = src.slice(at, at + 1600);

  assert.ok(
    /consumed === 0 && reason\.startsWith\('failed_'\)/.test(body),
    'only a zero-second failed attempt may be downgraded — a session that carried speech stays ENDED',
  );
  assert.ok(
    /state: aborted \? 'ABORTED' : 'ENDED'/.test(body),
    'the end handler no longer writes ABORTED for an attempt nobody spoke into',
  );

  // ABORTED is only worth writing because the allowance ignores it.
  assert.ok(
    /\.neq\('state', 'ABORTED'\)/.test(src),
    'the daily allowance must keep excluding aborted sessions, or this downgrade buys the visitor nothing',
  );
});
