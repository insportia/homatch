// mygovRecordPriority.test.mjs — which NAPR records the fixed CAPTCHA budget opens.
//
// Production, parcel 01.14.07.001.044 (jobs 61c1c38c 2026-10-22, 055a9868
// 2026-10-23): 76 records newest-first; the 12 paid solves were spent in that
// order, and all 38 records left gated were completed registrations
// (statusId 10) while refused (12) and terminated (13) applications were opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import { prioritiseNaprRecords } from '../.tstest-build/workflows/mygov/MyGovApiWorkflow.js';

test('completed registrations come first; newest-first order is kept within each status', () => {
  const recs = [
    { appID: 'a', statusId: '10' }, { appID: 'b', statusId: '12' }, { appID: 'c', statusId: '12' },
    { appID: 'd', statusId: '13' }, { appID: 'e', statusId: '10' }, { appID: 'f', statusId: '99' },
    { appID: 'g', statusId: '10' },
  ];
  assert.deepEqual(prioritiseNaprRecords(recs).map((r) => r.appID), ['a', 'e', 'g', 'f', 'd', 'b', 'c']);
});

test('the production mix: a 12-solve budget now reaches the 12 newest completed registrations', () => {
  // Shape of job 055a9868: 11 completed, then a batch of refusals/terminations, then 39 older completed.
  const recs = [
    ...Array.from({ length: 11 }, (_, i) => ({ appID: `c${i}`, statusId: '10' })),
    ...Array.from({ length: 17 }, (_, i) => ({ appID: `r${i}`, statusId: '12' })),
    ...Array.from({ length: 8 }, (_, i) => ({ appID: `t${i}`, statusId: '13' })),
    ...Array.from({ length: 39 }, (_, i) => ({ appID: `c${11 + i}`, statusId: '10' })),
  ];
  const first12 = prioritiseNaprRecords(recs).slice(0, 12).map((r) => r.appID);
  assert.ok(first12.every((id) => id.startsWith('c')));
  assert.deepEqual(first12.slice(0, 2), ['c0', 'c1']);
  assert.equal(prioritiseNaprRecords(recs).length, recs.length, 'no record is dropped');
});

test('records without a status keep their place between completed and refused', () => {
  assert.deepEqual(prioritiseNaprRecords([{ appID: 'x' }, { appID: 'y', statusId: 10 }]).map((r) => r.appID), ['y', 'x']);
});
