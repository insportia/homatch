import { test } from 'node:test';
import assert from 'node:assert/strict';

import { jobNoticeFor, jobDeepLink } from '../jobNotice.ts';

/*
 * WHICH FINISHED JOBS TELL THEIR OWNER, AND WHERE THE NOTICE OPENS.
 *
 * Owner, 2026-10-25: "when Verify jobs and jobs in general finish I get no
 * notification by email, nor via the PWA, nor inside the site." In
 * production 14 finished Find Buyers / Tenants searches had told nobody.
 */

const job = (over = {}) => ({
  jobId: 'b1', productType: 'VERIFY', subjectType: 'RESEARCH_JOB', subjectId: 'r1',
  state: 'COMPLETED', resultRef: '/verify?job=r1', userSafeError: null, ...over,
});

test('the three products people wait on each get their own notice', () => {
  assert.deepEqual(jobNoticeFor(job()), { kind: 'VERIFY_DONE', deepLink: '/verify?job=r1' });
  assert.equal(jobNoticeFor(job({ productType: 'DOCUMENT_ANALYSIS', subjectType: 'DOCUMENT', subjectId: 'd1', resultRef: '/contracts/d1' })).kind, 'DOCUMENT_DONE');
  assert.equal(jobNoticeFor(job({ productType: 'CONTRACT_ANALYSIS', subjectType: 'DOCUMENT', subjectId: 'd1', resultRef: null })).deepLink, '/contracts/d1');
  const search = jobNoticeFor(job({ productType: 'FIND_CLIENTS', subjectType: 'MATCHING_JOB', subjectId: 'm1', resultRef: '/property/p1/buyers/external?job=m1' }));
  assert.deepEqual(search, { kind: 'SEARCH_DONE', deepLink: '/property/p1/buyers/external?job=m1' });
});

test('a failure is told, with a way back; a refusal for payment is not a failure', () => {
  assert.equal(jobNoticeFor(job({ state: 'FAILED', userSafeError: 'job_failed_generic' })).kind, 'FAILED');
  assert.equal(jobNoticeFor(job({ state: 'FAILED', productType: 'DOCUMENT_ANALYSIS', userSafeError: 'doc_error_billing' })).kind, 'SKIP');
  assert.equal(jobNoticeFor(job({ state: 'FAILED', productType: 'DOCUMENT_ANALYSIS', userSafeError: 'doc_error_requires_ocr' })).kind, 'DOCUMENT_UNREADABLE');
  assert.equal(jobNoticeFor(job({ state: 'FAILED', productType: 'DOCUMENT_ANALYSIS', userSafeError: 'doc_error_unsupported' })).kind, 'DOCUMENT_UNREADABLE');
});

test('campaigns announce themselves; a cancellation is the person\'s own doing', () => {
  for (const productType of ['EMAIL_CAMPAIGN', 'WHATSAPP_CAMPAIGN', 'AI_CALL', 'AI_TALK']) {
    assert.deepEqual(jobNoticeFor(job({ productType })), { kind: 'SKIP', deepLink: null, reason: 'PRODUCER_OWNS_COMPLETION' }, productType);
  }
  assert.equal(jobNoticeFor(job({ state: 'CANCELLED' })).kind, 'SKIP');
  assert.equal(jobNoticeFor(job({ productType: 'MARKET_RESEARCH' })).reason, 'NO_NOTICE_FOR_PRODUCT');
});

test('the deep link is the job centre\'s own destination and always a plain path', () => {
  /* The legacy plural spelling is rewritten, never followed to Not Found. */
  assert.equal(jobDeepLink(job({ productType: 'FIND_CLIENTS', subjectType: 'MATCHING_JOB', resultRef: '/properties/p9/matches' })), '/property/p9/matches');
  /* A protocol-relative or foreign ref never becomes a link. */
  assert.equal(jobDeepLink(job({ resultRef: '//evil.example/x' })), '/verify?job=r1');
  assert.equal(jobDeepLink(job({ productType: 'UNKNOWN', subjectType: null, subjectId: null, resultRef: null })), '/activity');
  /* The notifications column's own CHECK: a path of safe characters. */
  for (const link of [jobDeepLink(job()), jobDeepLink(job({ resultRef: '/property/p1/buyers/external?job=m1' }))]) {
    assert.match(link, /^\/[A-Za-z0-9/_%\-?=&.]*$/);
  }
});
