import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  claimAnnouncement, jobAnnouncementKeys, notificationAnnouncementKeys, resetAnnouncements,
} from '../announced.ts';

/* One popup per finished thing, whichever surface hears first. */

test('the job centre and the live notification for one verification show one card', () => {
  resetAnnouncements();
  /* verify-synthesis announces the report first … */
  const notif = { id: 'n1', type: 'VERIFY_COMPLETE', entity_type: 'research_job', entity_id: 'r1', metadata: { kind: 'VERIFY_COMPLETE', job_id: 'r1' } };
  assert.equal(claimAnnouncement(notificationAnnouncementKeys(notif)), true);
  /* … then background_jobs turns COMPLETED for the same research job. */
  assert.equal(claimAnnouncement(jobAnnouncementKeys({ id: 'b1', subjectId: 'r1' })), false);
});

test('the other order too: a finished search, then its notification', () => {
  resetAnnouncements();
  assert.equal(claimAnnouncement(jobAnnouncementKeys({ id: 'b2', subjectId: 'm1' })), true);
  const notif = { id: 'n2', entity_type: 'matching_jobs', entity_id: 'm1', metadata: { kind: 'FIND_CLIENTS_DONE', background_job_id: 'b2', matching_job_id: 'm1' } };
  assert.equal(claimAnnouncement(notificationAnnouncementKeys(notif)), false);
});

test('unrelated things each get their card, and a message is never swallowed', () => {
  resetAnnouncements();
  assert.equal(claimAnnouncement(jobAnnouncementKeys({ id: 'b3', subjectId: 'r3' })), true);
  assert.equal(claimAnnouncement(jobAnnouncementKeys({ id: 'b4', subjectId: 'r4' })), true);
  assert.equal(claimAnnouncement(notificationAnnouncementKeys({ id: 'm1', type: 'NEW_MESSAGE', metadata: { conversation_id: 'c' } })), true);
  assert.equal(claimAnnouncement(notificationAnnouncementKeys({ id: 'm2', type: 'NEW_MESSAGE', metadata: { conversation_id: 'c' } })), true);
});

test('memory fades: an hour later the same subject is news again', () => {
  resetAnnouncements();
  assert.equal(claimAnnouncement(['subject:x'], 0), true);
  assert.equal(claimAnnouncement(['subject:x'], 60_000), false);
  assert.equal(claimAnnouncement(['subject:x'], 60 * 60_000 + 120_000), true);
});
