// FIND BUYERS — the elapsed search timer is computed from the server's clock
// marks only: it survives a refresh, freezes while paused and stops at the end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { elapsedMs, elapsedTicks, formatElapsed } from '../elapsed.ts';

const T0 = Date.parse('2026-10-16T10:00:00Z');
const iso = (offsetSec) => new Date(T0 + offsetSec * 1000).toISOString();
const base = { createdAt: iso(-30), startedAt: iso(0), completedAt: null, pausedAt: null };

test('a running search counts from startedAt to now', () => {
  assert.equal(elapsedMs({ ...base, state: 'SEARCHING' }, T0 + 125_000), 125_000);
  assert.equal(elapsedMs({ ...base, state: 'PARTIAL_RESULTS' }, T0 + 5_000), 5_000);
  assert.equal(elapsedMs({ ...base, state: 'PAUSING' }, T0 + 9_000), 9_000, 'pausing is still running');
});

test('before the first source starts, createdAt is the start', () => {
  assert.equal(elapsedMs({ ...base, startedAt: null, state: 'PREPARING' }, T0), 30_000);
});

test('the same timestamps give the same value after a reload (no client state)', () => {
  const c = { ...base, state: 'SEARCHING' };
  const now = T0 + 61_000;
  assert.equal(elapsedMs(c, now), elapsedMs(JSON.parse(JSON.stringify(c)), now));
});

test('paused: frozen at pausedAt however late it is read', () => {
  const c = { ...base, state: 'PAUSED', pausedAt: iso(300) };
  assert.equal(elapsedMs(c, T0 + 900_000), 300_000);
  assert.equal(elapsedMs(c, T0 + 9_000_000), 300_000);
  assert.equal(elapsedTicks(c), false, 'no tick while paused');
});

test('finished: ends at completedAt and stops ticking', () => {
  const c = { ...base, state: 'COMPLETED_WITH_RESULTS', completedAt: iso(1830) };
  assert.equal(elapsedMs(c, T0 + 99_999_000), 1_830_000);
  assert.equal(elapsedTicks(c), false);
  assert.equal(elapsedTicks({ ...base, state: 'SEARCHING' }), true);
});

test('no start, bad dates or a clock skew never produce a negative or invented time', () => {
  assert.equal(elapsedMs(null, T0), null);
  assert.equal(elapsedMs({ ...base, createdAt: null, startedAt: null, state: 'SEARCHING' }, T0), null);
  assert.equal(elapsedMs({ ...base, startedAt: 'not a date', createdAt: null, state: 'SEARCHING' }, T0), null);
  assert.equal(elapsedMs({ ...base, state: 'SEARCHING' }, T0 - 10_000), 0, 'server ahead of the device clock');
});

test('format: mm:ss under an hour, h:mm:ss from an hour, digits only', () => {
  assert.equal(formatElapsed(0), '00:00');
  assert.equal(formatElapsed(65_400), '01:05');
  assert.equal(formatElapsed(59 * 60_000 + 59_999), '59:59');
  assert.equal(formatElapsed(3_600_000), '1:00:00');
  assert.equal(formatElapsed(3_600_000 * 2 + 61_000), '2:01:01');
  assert.equal(formatElapsed(null), '—');
  assert.match(formatElapsed(12_345_678), /^[0-9:]+$/);
});
