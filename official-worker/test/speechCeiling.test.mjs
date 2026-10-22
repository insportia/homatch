// Optional ceiling on concurrent AI TALK speech sockets per worker process
// (capacity audit 2026-10-18). Unset = unlimited = the behaviour before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { speechSessionCeiling } = await import('../.tstest-build/speech/SpeechGateway.js');

test('unset, empty, zero, negative or non-integer means no ceiling (unchanged behaviour)', () => {
  for (const v of [undefined, '', '0', '-3', '2.5', 'abc']) assert.equal(speechSessionCeiling({ SPEECH_MAX_SESSIONS: v }), null, String(v));
});

test('a positive integer is the ceiling', () => {
  assert.equal(speechSessionCeiling({ SPEECH_MAX_SESSIONS: '40' }), 40);
});

test('at the ceiling the upgrade is refused with 503 before any stream opens; grants are checked first', () => {
  const src = readFileSync(new URL('../src/speech/SpeechGateway.ts', import.meta.url), 'utf8');
  const up = src.slice(src.indexOf("server.on('upgrade'"), src.indexOf('return { available: true'));
  assert.ok(up.indexOf('verifyGrant(') < up.indexOf('wss.clients.size >= ceiling'));
  assert.ok(up.indexOf('wss.clients.size >= ceiling') < up.indexOf('wss.handleUpgrade('));
  assert.match(up, /503 Service Unavailable\\r\\nRetry-After: 5/);
});
