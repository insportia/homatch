// WAITING ON WORK THE SERVER OWNS — a lost connection is waiting, never failure.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DesignStudioFailure, isRetryable, storedFailure, watchOperation } from '../durable.ts';
import { resumeStep, openQuestions } from '../../../lib/designStudio/photoProject.ts';
import { statusOf } from '../../../lib/designStudio/projectStatus.ts';

const clock = () => {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
};

test('a stored failure keeps its category; a legacy plain code counts as retryable', () => {
  assert.deepEqual(storedFailure('TERMINAL:NOT_A_SUPPORTED_IMAGE'), { code: 'NOT_A_SUPPORTED_IMAGE', retryable: false });
  assert.deepEqual(storedFailure('RETRYABLE:READING_FAILED'), { code: 'READING_FAILED', retryable: true });
  assert.deepEqual(storedFailure('READING_FAILED'), { code: 'READING_FAILED', retryable: true });
  assert.deepEqual(storedFailure(null), { code: 'UNKNOWN', retryable: true });
});

test('the watch asks once, then only watches; it ends when the server says DONE', async () => {
  const c = clock();
  let kicks = 0; let polls = 0;
  await watchOperation({
    kick: async () => { kicks += 1; },
    poll: async () => { polls += 1; return polls >= 4 ? { state: 'DONE' } : null; },
    pollMs: 1000, rekickMs: 60_000, ...c,
  });
  assert.equal(kicks, 1, 'no second request while the work is under way');
  assert.equal(polls, 4);
});

test('network errors while watching are waiting, not failure', async () => {
  const c = clock();
  let polls = 0;
  await watchOperation({
    kick: async () => { throw new Error('offline'); },
    poll: async () => { polls += 1; if (polls < 3) throw new Error('offline'); return { state: 'DONE' }; },
    pollMs: 1000, ...c,
  });
  assert.equal(polls, 3);
});

test('a stored failure ends the watch with its category (retry offered, or another file)', async () => {
  const c = clock();
  await assert.rejects(
    watchOperation({ kick: async () => {}, poll: async () => ({ state: 'FAILED', code: 'NOT_A_SUPPORTED_IMAGE', retryable: false }), ...c }),
    (e) => e instanceof DesignStudioFailure && e.code === 'DS_NOT_A_SUPPORTED_IMAGE' && e.retryable === false && !isRetryable(e),
  );
});

test('a long wait re-asks now and then (that restarts abandoned work); giving up never fails the work', async () => {
  const c = clock();
  let kicks = 0;
  await assert.rejects(
    watchOperation({ kick: async () => { kicks += 1; }, poll: async () => null, pollMs: 5000, rekickMs: 20_000, timeoutMs: 61_000, ...c }),
    (e) => e.code === 'DS_STILL_WORKING' && !(e instanceof DesignStudioFailure),
  );
  assert.ok(kicks >= 3 && kicks <= 5, `re-asked ${kicks} times`);
});

test('a resumed photo project opens on the step the server has — finished work is never repeated', () => {
  const u = { questions: [{ id: 'q1' }] };
  assert.equal(resumeStep({ status: 'READING', understood: false, flow: null, questionsLeft: 0 }), 'READING');
  assert.equal(resumeStep({ status: 'FAILED', understood: false, flow: null, questionsLeft: 0 }), 'FAILED');
  assert.equal(resumeStep({ status: 'READ', understood: true, flow: { kind: 'PHOTOS', step: 'READING', answers: [] }, questionsLeft: openQuestions(u, []).length }), 'QUESTION');
  assert.equal(resumeStep({ status: 'READ', understood: true, flow: { kind: 'PHOTOS', step: 'QUALITY', answers: [] }, questionsLeft: 0 }), 'QUALITY');
  assert.equal(resumeStep({ status: 'BUILT', understood: true, flow: { kind: 'PHOTOS', step: 'GENERATING', answers: [] }, questionsLeft: 0 }), 'GENERATING');
  assert.equal(resumeStep({ status: 'READ', understood: true, flow: { kind: 'PHOTOS', step: 'DONE', answers: [] }, questionsLeft: 0 }), 'DONE');
});

test('the library status comes from the server rows: work first, then a waiting detail, then a result', () => {
  const now = Date.parse('2026-10-03T12:00:00Z');
  const none = { renders: [], readings: [], photos: [], designs: [] };
  assert.equal(statusOf(none, now), null);
  assert.equal(statusOf({ ...none, photos: [{ status: 'READING' }] }, now), 'WORKING');
  assert.equal(statusOf({ ...none, designs: [{ status: 'RUNNING', created_at: '2026-10-03T11:50:00Z' }] }, now), 'WORKING');
  assert.equal(statusOf({ ...none, designs: [{ status: 'RUNNING', created_at: '2026-10-03T09:00:00Z' }] }, now), null, 'a design abandoned hours ago is not "working"');
  const asked = { status: 'READ', analysis: { kind: 'PHOTO_UNDERSTANDING', rooms: [], questions: [{ id: 'q1' }] }, corrections: { flow: { kind: 'PHOTOS', step: 'QUESTION', answers: [] } } };
  assert.equal(statusOf({ ...none, photos: [asked] }, now), 'QUESTION');
  assert.equal(statusOf({ ...none, renders: [{ status: 'READY' }, { status: 'FAILED' }] }, now), 'READY', 'a failed variant never hides a ready design');
  assert.equal(statusOf({ ...none, renders: [{ status: 'READY' }, { status: 'RENDERING' }] }, now), 'WORKING');
  assert.equal(statusOf({ ...none, photos: [{ status: 'FAILED' }] }, now), 'FAILED');
});

test('abandoned work is not "in progress" forever: a reading or picture whose row stopped moving no longer says WORKING', async () => {
  // Production, project 9a747384: a photo reading left at READING (its instance lost, 2026-10-03 06:53) kept the
  // library saying "Design Studio is working on your project" a day later, over a finished design.
  const { statusOf, STALE_MS } = await import('../../../lib/designStudio/projectStatus.ts');
  const now = Date.parse('2026-10-04T10:00:00Z');
  const ago = (ms) => new Date(now - ms).toISOString();
  const ready = [{ status: 'READY', updated_at: ago(3600_000) }];
  const stuck = { renders: ready, readings: [], photos: [{ status: 'READING', updated_at: ago(24 * 3600_000) }], designs: [] };
  assert.equal(statusOf(stuck, now), 'READY', 'the finished design shows, not a reading lost a day ago');
  assert.equal(statusOf({ ...stuck, photos: [{ status: 'READING', updated_at: ago(60_000) }] }, now), 'WORKING', 'a reading under way still shows');
  assert.equal(statusOf({ renders: [{ status: 'RENDERING', updated_at: ago(STALE_MS + 1000) }], readings: [], photos: [], designs: [] }, now), null);
  assert.equal(statusOf({ renders: [{ status: 'RENDERING', updated_at: ago(30_000) }], readings: [], photos: [], designs: [] }, now), 'WORKING');
  assert.equal(statusOf({ renders: [], readings: [{ status: 'INTERPRETING', updated_at: ago(STALE_MS * 4) }], photos: [], designs: [] }, now), null);
  assert.ok(STALE_MS > 8 * 60_000, 'longer than the server\'s own lease, so live work is never dropped');
});
