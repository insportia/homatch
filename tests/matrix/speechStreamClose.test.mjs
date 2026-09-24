/*
 * A NINETEEN-SECOND SPEECH STREAM, AND NOTHING SAYING WHY.
 *
 * MEASURED on Railway's http log for homatch-official-worker, one physical
 * Android session on 2026-09-24:
 *
 *   15:16:45.094  /speech/stream  19,709 ms
 *   15:16:45.095  /speech/stream  19,427 ms   <- one millisecond apart
 *   15:16:10.583  /speech/stream   5,946 ms
 *   15:16:10.603  /speech/stream   5,621 ms   <- twenty milliseconds apart
 *   15:16:18.296  /speech/stream   6,721 ms
 *   15:16:18.399  /speech/stream   6,207 ms   <- a hundred and three
 *   15:17:19.477  /speech/stream       1 ms   status 499
 *
 * Two things were invisible here and both are now logged. The PAIRING was the
 * unconditional second-opinion socket, fixed on the client side. The DURATIONS
 * were unreadable: session_closed reported frames, bytes and language, and
 * finish() knew the reason all along -- it put it in the WebSocket close frame
 * and the log threw it away. So a 19.7-second stream could have ended on a
 * final, on a grace timeout, on the browser walking away, or on the
 * fifteen-minute ceiling, and no amount of reading the log would say which.
 *
 * The 499 is the other half. `totalDuration: 1` with "client has closed the
 * request before the server could send a response" is not a failure and not a
 * timeout: it is a socket opened and abandoned inside a millisecond, which is
 * what an immediately-superseded stream looks like from the proxy's side.
 * CLOSED_BEFORE_OPEN is the name for it.
 *
 * WHY THIS LIVES IN tests/matrix AND NOT IN official-worker/test. The worker
 * has its own `npm test`, and CI's validate job does not run it -- so a guard
 * placed beside the code it guards would never once have run on a push. The
 * root walk covers tests/matrix, which is the only place an assertion about the
 * worker actually holds anything to account.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CR = String.fromCharCode(13);
const GATEWAY = readFileSync('official-worker/src/speech/SpeechGateway.ts', 'utf8').split(CR).join('');

test('EVERY_CLOSE_HAS_A_CATEGORY, and one of them is the 499', () => {
  const union = /let closeReason:\s*([^=]+)=/.exec(GATEWAY)[1];
  for (const reason of [
    'CLIENT_DONE',            // the final arrived; the half-close did its job
    'CLIENT_DONE_NO_FINAL',   // the grace window expired without one
    'SOCKET_CLOSED',          // the browser went away
    'SOCKET_ERROR',
    'SESSION_LIMIT',          // the fifteen-minute ceiling
    'PROVIDER_UNAVAILABLE',
    'CLOSED_BEFORE_OPEN',     // the 499: gone inside a millisecond
  ]) {
    assert.ok(union.includes(`'${reason}'`), `${reason} is not a nameable close reason`);
  }
  // The default is the 499 case, because a socket that dies before anything is
  // decided genuinely has no other reason to report.
  assert.match(GATEWAY, /= 'CLOSED_BEFORE_OPEN';/);
});

test('FIRST_CLOSE_WINS, and the provider is not overwritten by the generic name', () => {
  /*
   * finish() is idempotent for the close frame already; the ledger has to
   * follow the same rule or a socket that failed at the provider and then saw
   * its browser disconnect would be filed under the disconnect.
   */
  assert.match(GATEWAY, /if \(closeReason === 'CLOSED_BEFORE_OPEN' && reason !== 'PROVIDER_UNAVAILABLE'\) \{/);
  // Set by its own caller, before finish() runs.
  const unavailable = GATEWAY.slice(GATEWAY.indexOf('onUnavailable: (reason)'), GATEWAY.indexOf('function finish('));
  assert.ok(
    unavailable.indexOf("closeReason = 'PROVIDER_UNAVAILABLE';") < unavailable.indexOf('finish(1011, reason);'),
    'the category is set after finish(), which cannot work',
  );
});

test('A_DURATION_IS_NOW_READABLE: was there a half-close, did a final leave, how long did it take', () => {
  const log = GATEWAY.slice(GATEWAY.indexOf("event: 'session_closed'"));
  for (const field of ['closeReason', 'finalsSent', 'halfClosed', 'finalizeMs']) {
    assert.ok(log.includes(field), `session_closed does not report ${field}`);
  }
  // finalizeMs is measured from the half-close, which is the only point it
  // means anything from -- and null when there was never one, rather than 0.
  assert.match(GATEWAY, /finalizeMs: halfClosedAt === null \? null : Date\.now\(\) - halfClosedAt,/);
  assert.match(GATEWAY, /halfClosedAt = Date\.now\(\);/);
  // Counted where a final actually goes out, so it cannot drift from the send.
  const onFinal = GATEWAY.slice(GATEWAY.indexOf('onFinal: (text, confidence, heard)'), GATEWAY.indexOf('onRestart:'));
  assert.match(onFinal, /finalsSent \+= 1;/);
});

test('STILL_NOT_ONE_WORD_OF_WHAT_WAS_SAID', () => {
  /*
   * The whole reason this log is counts-only. Adding four fields to it is
   * exactly the moment a transcript gets attached "just for debugging", so the
   * rule is asserted rather than remembered.
   */
  const from = GATEWAY.indexOf("event: 'session_closed'");
  /*
   * Comments stripped first. A comment that mentions a transcript is not a
   * transcript, and the first version of this assertion failed on the sentence
   * directly above it explaining that the log carries no words.
   */
  const NL = String.fromCharCode(10);
  const log = GATEWAY.slice(from, GATEWAY.indexOf('}));', from))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(NL).filter((l) => !l.trim().startsWith('//')).join(NL);
  for (const leak of ['text', 'transcript', 'said', 'words']) {
    assert.ok(!log.includes(leak), `session_closed now carries ${leak}`);
  }
  // And what it DOES carry is all counts, categories and booleans.
  assert.match(log, /frames: stream\.frames, bytes: stream\.bytes, language,/);
  // And the reason string that goes to the close frame is still truncated.
  assert.match(GATEWAY, /ws\.close\(code, reason\.slice\(0, 120\)\)/);
});

test('THE_SERVER_SIDE_NUMBER_THAT_ENDS_THE_BLAME: finalizeMs is comparable to the client deadline', () => {
  /*
   * The point of measuring finalisation on BOTH sides. The client's
   * NO_FINAL_TIMEOUT_MS bounds how long it waits; finalizeMs says how long the
   * provider actually took. Without the server number, a slow turn is an
   * argument; with it, one of the two is simply wrong.
   *
   * FINAL_GRACE_MS is the worker's own patience and is deliberately left
   * alone: it is the provider's flush window, not the visitor's wait, and the
   * client stops waiting on its own schedule regardless.
   */
  assert.match(GATEWAY, /const FINAL_GRACE_MS = 4000;/);
  const client = readFileSync('src/lib/comm/voiceClient.ts', 'utf8').split(CR).join('');
  const deadline = Number(/const NO_FINAL_TIMEOUT_MS = ([\d_]+);/.exec(client)[1].split('_').join(''));
  /*
   * The client must give up FIRST. If the worker's grace were the shorter of
   * the two, the client would sit waiting for a socket that had already
   * decided nothing was coming -- which is the freeze with the roles swapped.
   */
  assert.ok(deadline < 4000, `the client waits ${deadline}ms, longer than the worker's 4000ms grace`);
});
