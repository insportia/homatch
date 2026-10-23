// The email review gate (owner brief §10): approved, with the content it was approved with,
// never a legacy simulated campaign — and the server route actually calls it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { editDropsApproval, emailPhase, emailSendGate, isEditable } from '../reviewState.ts';

const ok = { status: 'APPROVED', content_hash: 'h1', approved_content_hash: 'h1', send_eligibility: 'PRODUCTION' };

test('historical statuses read as the Email Studio phases', () => {
  assert.equal(emailPhase('REVIEW_REQUIRED'), 'UNDER_REVIEW');
  assert.equal(emailPhase('RUNNING'), 'SENDING');
  assert.equal(emailPhase('COMPLETED'), 'SENT');
  assert.equal(emailPhase('COMPLIANCE_PAUSED'), 'PAUSED');
  assert.equal(emailPhase('READY'), 'DRAFT');
  assert.equal(emailPhase(null), 'DRAFT');
});

test('the gate passes only an approved campaign with unchanged content', () => {
  assert.deepEqual(emailSendGate(ok), { ok: true });
  assert.deepEqual(emailSendGate({ ...ok, status: 'SCHEDULED' }), { ok: true });
  assert.deepEqual(emailSendGate({ ...ok, status: 'RUNNING' }), { ok: true });
  for (const s of ['DRAFT', 'READY', 'READY_FOR_REVIEW', 'UNDER_REVIEW', 'REVIEW_REQUIRED', 'CHANGES_REQUESTED', 'REJECTED']) {
    assert.deepEqual(emailSendGate({ ...ok, status: s }), { ok: false, reason: 'NOT_APPROVED' }, s);
  }
  assert.deepEqual(emailSendGate({ ...ok, approved_content_hash: null }), { ok: false, reason: 'NOT_APPROVED' });
  assert.deepEqual(emailSendGate({ ...ok, content_hash: 'h2' }), { ok: false, reason: 'APPROVAL_STALE' });
  assert.deepEqual(emailSendGate({ ...ok, send_eligibility: 'LEGACY_MOCK' }), { ok: false, reason: 'LEGACY_MOCK' });
  assert.deepEqual(emailSendGate({ ...ok, risk_level: 'BLOCKED' }), { ok: false, reason: 'BLOCKED' });
  assert.deepEqual(emailSendGate({ ...ok, status: 'COMPLETED' }), { ok: false, reason: 'FINISHED' });
});

test('editing rules mirror the database guard', () => {
  assert.equal(isEditable('RUNNING'), false);
  assert.equal(isEditable('COMPLETED'), false);
  assert.equal(isEditable('APPROVED'), true);
  assert.equal(editDropsApproval('APPROVED'), true);
  assert.equal(editDropsApproval('DRAFT'), false);
});

test('outreach-send enforces the gate before any reservation or send, for email only', () => {
  const src = readFileSync('supabase/functions/outreach-send/index.ts', 'utf8');
  const gate = src.indexOf('const gate = emailSendGate(campaign)');
  assert.ok(gate > 0, 'the gate is called');
  assert.ok(gate < src.indexOf('reserveQuota('), 'before quota is reserved');
  assert.ok(gate < src.indexOf("update({ status: 'RUNNING'"), 'before the campaign starts');
  assert.match(src.slice(gate - 200, gate), /campaign\.campaign_type === 'EMAIL'/);
  assert.match(src, /campaign_type === 'EMAIL' \? \['APPROVED', 'SCHEDULED', 'PAUSED'\]/, 'a draft email is never started');
});

test('the scheduler claims an email campaign only with a current approval', () => {
  const sql = readFileSync('supabase/migrations/20261127120000_email_studio_review.sql', 'utf8');
  const claim = sql.slice(sql.indexOf('create or replace function public.outreach_claim_due_campaigns'));
  assert.match(claim, /c2\.approved_content_hash = c2\.content_hash/);
});
