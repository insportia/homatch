// Microphone failures, told apart.
//
// "Allow the microphone" is useless advice to somebody who has no microphone,
// and worse than useless to somebody whose microphone is held by another
// application — they will sit in a permission dialog that never appears.
//
// These used to collapse into two outcomes: denied, or a generic provider
// error. And getUserMedia had no timeout at all, so a browser that never
// decided left the control saying "Connecting" forever. That was observed on
// a machine with no microphone: the session never started and never failed.
//
// classifyMicError and withTimeout are module-private, so this reads them out
// of the source. They are small and pure; the shape of the file is asserted
// first, so the test fails loudly rather than silently testing nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync('src/lib/comm/voiceClient.ts', 'utf8');

function loadPrivate(name) {
  const start = SRC.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} not found in voiceClient.ts — this test must not pass vacuously`);
  const end = SRC.indexOf('\n}', start) + 2;
  const body = SRC.slice(start, end)
    .replace(/: MicFailure/g, '')
    .replace(/<T>/g, '')
    .replace(/: Promise<T>/g, '')
    .replace(/: unknown/g, '')
    .replace(/: number/g, '')
    .replace(/: string/g, '')
    .replace(/ as \{[^}]*\} \| null/g, '');
  // eslint-disable-next-line no-new-func
  return new Function(`${body}; return ${name};`)();
}

const classifyMicError = loadPrivate('classifyMicError');

test('a refused permission is told apart from an absent device', () => {
  assert.equal(classifyMicError({ name: 'NotAllowedError' }), 'MIC_DENIED');
  assert.equal(classifyMicError({ name: 'SecurityError' }), 'MIC_DENIED');
  assert.equal(classifyMicError({ name: 'PermissionDeniedError' }), 'MIC_DENIED');

  assert.equal(classifyMicError({ name: 'NotFoundError' }), 'MIC_MISSING');
  assert.equal(classifyMicError({ name: 'DevicesNotFoundError' }), 'MIC_MISSING');
});

test('a device another application is holding is its own answer', () => {
  // The user has a microphone and has granted permission. Telling them to
  // allow access sends them looking for a dialog that will never appear.
  assert.equal(classifyMicError({ name: 'NotReadableError' }), 'MIC_BUSY');
  assert.equal(classifyMicError({ name: 'TrackStartError' }), 'MIC_BUSY');
});

test('a hang is reported as a timeout, not as a denial', () => {
  assert.equal(classifyMicError(new Error('MIC_TIMEOUT')), 'MIC_TIMEOUT');
});

test('anything unrecognised degrades to a generic audio failure, never to success', () => {
  for (const e of [null, undefined, {}, { name: 'SomethingNew' }, new Error('boom')]) {
    const out = classifyMicError(e);
    assert.ok(
      ['MIC_DENIED', 'MIC_MISSING', 'MIC_BUSY', 'MIC_TIMEOUT', 'AUDIO_UNAVAILABLE'].includes(out),
      `unexpected classification ${out}`,
    );
  }
  assert.equal(classifyMicError({ name: 'SomethingNew' }), 'AUDIO_UNAVAILABLE');
});

test('start() puts a timeout around getUserMedia', () => {
  // The defect was structural, not a wrong constant: there was no timeout at
  // all, so CONNECTING was terminal. Assert the call is wrapped.
  assert.match(
    SRC,
    /withTimeout\(\s*this\.openMicrophone\(\)/,
    'openMicrophone must be called through withTimeout or Connecting can hang forever',
  );
});

test('a terminal microphone state is not overwritten by stop()', () => {
  // stop() sets ENDED. If it did that after MIC_UNAVAILABLE, the screen would
  // say the session ended normally and the reason would be lost.
  const guard = SRC.match(/this\.state !== 'LIMIT_REACHED'[^\n]*/);
  assert.ok(guard, 'the stop() terminal-state guard was not found');
  assert.match(guard[0], /MIC_DENIED/);
  assert.match(guard[0], /MIC_UNAVAILABLE/);
});

test('every mic failure reaches the caller through onError', () => {
  // The state drives the screen; onError drives logging and any toast. Both
  // have to be fed, or one surface reports a failure the other does not.
  assert.match(SRC, /this\.cb\.onError\?\.\(reason\)/);
});
