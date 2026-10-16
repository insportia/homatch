// FIND BUYERS 3.0 — adaptive comment sampling: expand only on evidence, once, within limits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideCommentSampling } from '../findBuyers/commentSampling.ts';

const base = { analyzed: 40, interested: 16, total: 240, depth: 0, probe: 40, maxResults: 100 };

test('a productive first sample of a large post expands once, within the Actor maximum', () => {
  assert.deepEqual(decideCommentSampling(base), { decision: 'EXPAND', size: 100 });
  assert.deepEqual(decideCommentSampling({ ...base, maxResults: 500 }), { decision: 'EXPAND', size: 120 });
});

test('poor interest stops early', () => {
  assert.equal(decideCommentSampling({ ...base, interested: 2 }).decision, 'STOP_LOW_YIELD');
});

test('nothing more to read, or an unknown total, never expands', () => {
  assert.equal(decideCommentSampling({ ...base, total: 40 }).decision, 'STOP_EXHAUSTED');
  assert.equal(decideCommentSampling({ ...base, total: null }).decision, 'STOP_UNKNOWN_TOTAL');
  assert.equal(decideCommentSampling({ ...base, analyzed: 0 }).decision, 'STOP_EXHAUSTED');
});

test('a post is expanded at most once', () => {
  assert.equal(decideCommentSampling({ ...base, depth: 1 }).decision, 'STOP_DEPTH');
});

test('an expansion never asks for more than the post has', () => {
  assert.deepEqual(decideCommentSampling({ ...base, total: 60, maxResults: 500 }), { decision: 'EXPAND', size: 60 });
});
