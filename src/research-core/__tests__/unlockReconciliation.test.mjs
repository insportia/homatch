// THE FOUR ROWS, AND THE EXPLANATION THAT WAS WRONG.
//
// The standing account of the four orphaned MATCH_UNLOCK charges was that
// re-classification had changed intent_profile_id and rewritten the matches
// underneath them. It was plausible, it went unchallenged for weeks, and it was
// not what happened. The real chain is in the first test below, taken from
// production, and it ends with a refund issued 2 minutes 36 seconds later.
//
// The point of every test here is the DISTINCTION: a charge with no match is not
// a problem, and a charge with no money back is. Absence of a match proves
// neither.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  reconcileUnlockCharges,
  summariseReconciliation,
  matchIdFromReference,
} from '../discovery/unlock-reconciliation.ts';

const FOUNDER = '5157044e-9158-437a-86a2-e34d5ada82f7';

/** The real ledger rows for 2026-08-28, exactly as production holds them. */
const AUGUST_28 = [
  { id: '59e0cdd3-96e4-42c9-97b0-72f237a9547c', userId: FOUNDER, type: 'ADMIN_ADJUSTMENT',
    amount: 10000, reference: 'Founder testing credits', createdAt: '2026-08-28T17:44:23.205Z',
    balanceBefore: 0, balanceAfter: 10000 },
  { id: 'ee0d479d-54e4-4a67-9c06-377385328786', userId: FOUNDER, type: 'MATCH_UNLOCK',
    amount: -0.1, reference: 'match:8542037b-9ffb-4f89-bda7-f16b52af4640',
    createdAt: '2026-08-28T17:47:31.943Z', balanceBefore: 10000, balanceAfter: 9999.9 },
  { id: '0fb47c56-781c-4f47-a50e-ee36a89cb970', userId: FOUNDER, type: 'MATCH_UNLOCK',
    amount: -0.1, reference: 'match:e854dd97-342e-4e24-b6bc-3d19643e02f3',
    createdAt: '2026-08-28T17:47:54.290Z', balanceBefore: 9999.9, balanceAfter: 9999.8 },
  { id: 'd415cf3c-32c1-4879-9b61-df4621edb6e5', userId: FOUNDER, type: 'MATCH_UNLOCK',
    amount: -0.1, reference: 'match:3cee6ca7-9c91-4b42-8ede-d93d2394447c',
    createdAt: '2026-08-28T17:48:03.231Z', balanceBefore: 9999.8, balanceAfter: 9999.7 },
  { id: 'f57ff675-c731-4693-8390-6bac1cdf6277', userId: FOUNDER, type: 'MATCH_UNLOCK',
    amount: -0.1, reference: 'match:6b3956a1-2989-46a1-8872-b229bed59aca',
    createdAt: '2026-08-28T17:48:07.872Z', balanceBefore: 9999.7, balanceAfter: 9999.6 },
  { id: 'db738c44-3589-4390-bce9-673a3c9d5c5b', userId: FOUNDER, type: 'REFUND',
    amount: 0.4, reference: 'Refund: four invalid supply-side matches removed',
    createdAt: '2026-08-28T17:50:43.723Z', balanceBefore: 9999.6, balanceAfter: 10000 },
];

test('THE FOUR ROWS: explained valid history, in full, with the refund named', () => {
  const findings = reconcileUnlockCharges({
    ledger: AUGUST_28,
    // No unlock records survive: match_unlocks.match_id is ON DELETE RESTRICT,
    // so these had to be removed before the matches could be. That two-step is
    // what an operator does deliberately and never what a cascade does.
    unlocks: [],
    existingMatchIds: [],
  });

  assert.equal(findings.length, 4, 'the four charges were not all examined');
  for (const finding of findings) {
    assert.equal(finding.verdict, 'EXPLAINED_VALID_HISTORY',
      `${finding.ledgerId} came back ${finding.verdict}: ${finding.evidence}`);
    assert.equal(finding.reversedBy.ledgerId, 'db738c44-3589-4390-bce9-673a3c9d5c5b');
    assert.match(finding.reversedBy.reference, /four invalid supply-side matches removed/);
    /* And the honest half: the customer did NOT receive value. That is why it
       was refunded, and conflating "books balance" with "value delivered" is
       how a refunded failure gets counted as a sale. */
    assert.equal(finding.valueDelivered, false);
  }

  const summary = summariseReconciliation(findings);
  assert.equal(summary.byVerdict.EXPLAINED_VALID_HISTORY, 4);
  assert.equal(summary.byVerdict.ORPHANED_REFERENCE, 0);
  assert.equal(summary.byVerdict.POSSIBLE_DOUBLE_CHARGE, 0);
  assert.equal(summary.unexplainedAmount, 0, 'money is missing that should not be');
  assert.deepEqual(summary.needsHuman, [], 'the four rows do not need a human');
});

test('the balance chain across those rows is unbroken, which is the other half of the proof', () => {
  // Not the module's job, but the reason its verdict is trustworthy: if the
  // arithmetic did not close, "reversed in full" would be an assertion about
  // rows rather than about money.
  const sorted = [...AUGUST_28].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (let i = 1; i < sorted.length; i += 1) {
    assert.equal(sorted[i].balanceBefore, sorted[i - 1].balanceAfter,
      `the chain breaks at ${sorted[i].id}`);
    assert.equal(
      Number((sorted[i].balanceBefore + sorted[i].amount).toFixed(4)),
      sorted[i].balanceAfter,
      `${sorted[i].id} does not add up`,
    );
  }
  assert.equal(sorted[sorted.length - 1].balanceAfter, 10000,
    'the founder did not end where they started');
});

test('the SAME four rows with no refund are orphaned, not explained', () => {
  /*
   * The distinction the whole module exists for. Identical charges, identical
   * missing matches, identical missing unlock records — and a completely
   * different answer, because the money did not come back.
   */
  const findings = reconcileUnlockCharges({
    ledger: AUGUST_28.filter((row) => row.type !== 'REFUND'),
    unlocks: [],
    existingMatchIds: [],
  });

  assert.equal(findings.length, 4);
  for (const finding of findings) {
    assert.equal(finding.verdict, 'ORPHANED_REFERENCE');
    assert.match(finding.evidence, /no longer exists/);
    assert.match(finding.evidence, /before any balance changes/);
  }
  const summary = summariseReconciliation(findings);
  assert.equal(summary.unexplainedAmount, 0.4);
  assert.equal(summary.needsHuman.length, 4);
});

test('a partial refund explains only what it covers', () => {
  /*
   * Four 0.10 charges and a 0.10 refund is ONE explained row and three losses.
   * A checker that matched "is there a credit nearby" would report all four as
   * fine and lose 0.30 without saying so.
   */
  const ledger = [
    ...AUGUST_28.filter((row) => row.type === 'MATCH_UNLOCK'),
    { id: 'partial', userId: FOUNDER, type: 'REFUND', amount: 0.1,
      reference: 'Refund: one of them', createdAt: '2026-08-28T17:50:43.723Z' },
  ];
  const findings = reconcileUnlockCharges({ ledger, unlocks: [], existingMatchIds: [] });
  const summary = summariseReconciliation(findings);

  assert.equal(summary.byVerdict.EXPLAINED_VALID_HISTORY, 1);
  assert.equal(summary.byVerdict.ORPHANED_REFERENCE, 3);
  assert.equal(summary.unexplainedAmount, 0.3);
});

test('a top-up three weeks later does not explain an older charge', () => {
  const ledger = [
    ...AUGUST_28.filter((row) => row.type === 'MATCH_UNLOCK'),
    { id: 'topup', userId: FOUNDER, type: 'ADMIN_ADJUSTMENT', amount: 5000,
      reference: 'More testing credits', createdAt: '2026-09-18T09:00:00.000Z' },
  ];
  const findings = reconcileUnlockCharges({ ledger, unlocks: [], existingMatchIds: [] });
  assert.equal(findings.every((f) => f.verdict === 'ORPHANED_REFERENCE'), true,
    'a later top-up was read as a reversal, which would let any credit excuse any loss');
});

test('a credit BEFORE the charge is not a reversal of it', () => {
  const ledger = [
    { id: 'early', userId: FOUNDER, type: 'REFUND', amount: 5,
      reference: 'something else', createdAt: '2026-08-28T17:40:00.000Z' },
    AUGUST_28[1],
  ];
  const findings = reconcileUnlockCharges({ ledger, unlocks: [], existingMatchIds: [] });
  assert.equal(findings[0].verdict, 'ORPHANED_REFERENCE');
});

test('another user\'s refund does not explain this user\'s charge', () => {
  const ledger = [
    AUGUST_28[1],
    { id: 'theirs', userId: '00000000-0000-0000-0000-000000000009', type: 'REFUND', amount: 100,
      reference: 'unrelated', createdAt: '2026-08-28T17:48:00.000Z' },
  ];
  const findings = reconcileUnlockCharges({ ledger, unlocks: [], existingMatchIds: [] });
  assert.equal(findings[0].verdict, 'ORPHANED_REFERENCE');
});

test('the ordinary case: a live match with its unlock record', () => {
  const findings = reconcileUnlockCharges({
    ledger: [{
      id: '4d9d5b3a-c6fb-4fd7-b604-504ee428d636', userId: FOUNDER, type: 'MATCH_UNLOCK',
      amount: -35, reference: 'match:920dcdea-7901-4556-91f2-bcba29afefd0',
      createdAt: '2026-09-25T21:59:00.323Z',
    }],
    unlocks: [{
      id: '2b5b8da9-4634-4883-9888-bd23473f215a',
      matchId: '920dcdea-7901-4556-91f2-bcba29afefd0',
      userId: FOUNDER, ledgerEntryId: '4d9d5b3a-c6fb-4fd7-b604-504ee428d636', creditsCharged: 35,
    }],
    existingMatchIds: ['920dcdea-7901-4556-91f2-bcba29afefd0'],
  });

  assert.equal(findings[0].verdict, 'EXPLAINED_VALID_HISTORY');
  assert.equal(findings[0].valueDelivered, true);
  assert.match(findings[0].evidence, /still exists/);
});

test('one match charged twice with nothing reversed is flagged, not asserted', () => {
  /*
   * THE DEFECT THIS WATCHES FOR, and it is the financial shadow of the duplicate
   * match bug: forum.ge post 14328580 held two matches on one property, one
   * already unlocked for 35 credits and one offered for another 20. Had the
   * second been bought, this is the row that would have said so.
   *
   * The verdict is POSSIBLE, not CONFIRMED, because a legitimate re-charge
   * exists: unlock, refund, unlock again is two charges and two deliveries.
   */
  const findings = reconcileUnlockCharges({
    ledger: [
      { id: 'first', userId: FOUNDER, type: 'MATCH_UNLOCK', amount: -35,
        reference: 'match:920dcdea-7901-4556-91f2-bcba29afefd0', createdAt: '2026-09-25T21:59:00Z' },
      { id: 'second', userId: FOUNDER, type: 'MATCH_UNLOCK', amount: -20,
        reference: 'match:920dcdea-7901-4556-91f2-bcba29afefd0', createdAt: '2026-09-26T08:00:00Z' },
    ],
    unlocks: [
      { id: 'u1', matchId: '920dcdea-7901-4556-91f2-bcba29afefd0', userId: FOUNDER,
        ledgerEntryId: 'first', creditsCharged: 35 },
      { id: 'u2', matchId: '920dcdea-7901-4556-91f2-bcba29afefd0', userId: FOUNDER,
        ledgerEntryId: 'second', creditsCharged: 20 },
    ],
    existingMatchIds: ['920dcdea-7901-4556-91f2-bcba29afefd0'],
  });

  assert.equal(findings[0].verdict, 'EXPLAINED_VALID_HISTORY');
  assert.equal(findings[1].verdict, 'POSSIBLE_DOUBLE_CHARGE');
  assert.match(findings[1].evidence, /paid twice to see one person/);
  assert.match(findings[1].evidence, /Needs a human before any money moves/);

  const summary = summariseReconciliation(findings);
  assert.equal(summary.unexplainedAmount, 20);
});

test('unlock, refund, unlock again is two honest charges', () => {
  const findings = reconcileUnlockCharges({
    ledger: [
      { id: 'first', userId: FOUNDER, type: 'MATCH_UNLOCK', amount: -35,
        reference: 'match:aaaaaaaa-0000-0000-0000-000000000001', createdAt: '2026-09-01T10:00:00Z' },
      { id: 'refund', userId: FOUNDER, type: 'REFUND', amount: 35,
        reference: 'contact details were stale', createdAt: '2026-09-01T11:00:00Z' },
      { id: 'second', userId: FOUNDER, type: 'MATCH_UNLOCK', amount: -35,
        reference: 'match:aaaaaaaa-0000-0000-0000-000000000001', createdAt: '2026-09-10T10:00:00Z' },
    ],
    unlocks: [
      { id: 'u1', matchId: 'aaaaaaaa-0000-0000-0000-000000000001', userId: FOUNDER,
        ledgerEntryId: 'first', creditsCharged: 35 },
      { id: 'u2', matchId: 'aaaaaaaa-0000-0000-0000-000000000001', userId: FOUNDER,
        ledgerEntryId: 'second', creditsCharged: 35 },
    ],
    existingMatchIds: ['aaaaaaaa-0000-0000-0000-000000000001'],
  });

  const summary = summariseReconciliation(findings);
  assert.equal(summary.byVerdict.POSSIBLE_DOUBLE_CHARGE, 0,
    'a refunded-then-rebought match was reported as a double charge');
  assert.equal(summary.unexplainedAmount, 0);
});

test('a charge with no match reference is UNKNOWN, never "probably fine"', () => {
  const findings = reconcileUnlockCharges({
    ledger: [{ id: 'weird', userId: FOUNDER, type: 'MATCH_UNLOCK', amount: -5,
      reference: null, createdAt: '2026-09-01T10:00:00Z' }],
    unlocks: [], existingMatchIds: [],
  });
  assert.equal(findings[0].verdict, 'UNKNOWN');
  assert.match(findings[0].evidence, /cannot be established either way/);
  // UNKNOWN is not counted as money lost, and not counted as fine either.
  const summary = summariseReconciliation(findings);
  assert.equal(summary.byVerdict.UNKNOWN, 1);
  assert.equal(summary.unexplainedAmount, 0);
  assert.equal(summary.needsHuman.length, 0);
});

test('a surviving match with no unlock record is still an orphan', () => {
  // The other shape: the match is there, the money is gone, and there is no
  // record of what the customer was shown.
  const findings = reconcileUnlockCharges({
    ledger: [{ id: 'x', userId: FOUNDER, type: 'MATCH_UNLOCK', amount: -12,
      reference: 'match:bbbbbbbb-0000-0000-0000-000000000002', createdAt: '2026-09-01T10:00:00Z' }],
    unlocks: [],
    existingMatchIds: ['bbbbbbbb-0000-0000-0000-000000000002'],
  });
  assert.equal(findings[0].verdict, 'ORPHANED_REFERENCE');
  assert.match(findings[0].evidence, /exists but has no unlock record/);
});

test('nothing in this module can change a balance', () => {
  const ledger = structuredClone(AUGUST_28);
  const before = JSON.stringify(ledger);
  reconcileUnlockCharges({ ledger, unlocks: [], existingMatchIds: [] });
  assert.equal(JSON.stringify(ledger), before, 'the reconciler mutated the rows it was given');

  const source = readFileSync('src/research-core/discovery/unlock-reconciliation.ts', 'utf8');
  for (const forbidden of ['update(', 'insert(', 'delete(', 'rpc(']) {
    assert.equal(source.includes(forbidden), false,
      `the reconciler contains ${forbidden}; classification must not move money`);
  }
});

test('a match reference is parsed strictly', () => {
  assert.equal(matchIdFromReference('match:920DCDEA-7901-4556-91F2-BCBA29AFEFD0'),
    '920dcdea-7901-4556-91f2-bcba29afefd0');
  assert.equal(matchIdFromReference('match:not-a-uuid'), null);
  assert.equal(matchIdFromReference('Refund: four invalid supply-side matches removed'), null);
  assert.equal(matchIdFromReference('unlock:920dcdea-7901-4556-91f2-bcba29afefd0'), null);
  assert.equal(matchIdFromReference(null), null);
  assert.equal(matchIdFromReference(''), null);
});

test('the 18 production MATCH_UNLOCK rows reconcile to zero unexplained credits', () => {
  /*
   * The whole ledger as measured 2026-09-26: four reversed charges from the
   * first day and fourteen that still have their unlock record and their match.
   * This is the number that would have to change for there to be a financial
   * problem, and it is the number to re-run this against after any future
   * cleanup.
   */
  const live = [
    ['aaff3fa7-437f-48cf-a99c-19fff158477b', '2457d5e3-684b-4514-a0db-4cc167812ad1', 0.5],
    ['a65fa623-75df-4ff0-9243-fdd4b418cb81', 'c5df46e7-fc2f-4035-ba81-d83489e1e8a2', 0.16],
    ['eda13364-5579-416c-a9de-5b54d5aaf4a6', '0c01336c-828a-41fa-8c56-0477adf21f78', 0.16],
    ['7836a23b-a7a0-4df4-b2d5-072b46867169', 'ddcbab8e-3a58-4891-bfe6-3520aa96c989', 0.16],
    ['c68de949-ee78-4c7a-b962-d0379702796a', '9189f07a-439b-450a-a257-965d40b8847f', 0.16],
    ['bf270956-51aa-4ae4-83d4-c3ecdb20fa24', '9913ad00-a24c-4347-8ff8-760c117fdabb', 0.16],
    ['e5e863d3-c9d8-4d82-a31a-79346c34daf5', '62063ea7-8043-4310-905a-4e279ddd9d25', 0.16],
    ['7646aed6-8042-48f3-acfd-f36f6fc3c715', '8d57ea1b-3e6c-44fb-a488-0e4060573c74', 0.16],
    ['92b7e176-0c31-45ee-8352-408e12a35259', '9a5d0132-63ce-491c-a9f8-86bb42ca4265', 0.16],
    ['c0f00ca8-2ad8-488c-bb71-13b6532a9e39', '05ad7c04-fd36-4b70-ad43-44e0733d5695', 0.16],
    ['f9296d7f-a10f-4c18-bc90-a2f1b9069d5e', 'a34339d0-7a48-4c07-85a5-c385918c70f5', 0.1],
    ['8032faa9-c9d3-4de7-8890-522e1a739495', '84b33c08-38bd-44fd-9414-4acfc6fbd3c6', 0.1],
    ['5f2e72f2-d50a-403b-b5ad-7878ed634e12', 'c2e29966-d88e-4e36-a8ac-e398124326d7', 1.6],
    ['4d9d5b3a-c6fb-4fd7-b604-504ee428d636', '920dcdea-7901-4556-91f2-bcba29afefd0', 35],
  ];

  const findings = reconcileUnlockCharges({
    ledger: [
      ...AUGUST_28,
      ...live.map(([ledgerId, matchId, amount], i) => ({
        id: ledgerId, userId: FOUNDER, type: 'MATCH_UNLOCK', amount: -amount,
        reference: `match:${matchId}`,
        createdAt: `2026-08-30T07:${String(31 + i).padStart(2, '0')}:00.000Z`,
      })),
    ],
    unlocks: live.map(([ledgerId, matchId, amount], i) => ({
      id: `u${i}`, matchId, userId: FOUNDER, ledgerEntryId: ledgerId, creditsCharged: amount,
    })),
    existingMatchIds: live.map(([, matchId]) => matchId),
  });

  const summary = summariseReconciliation(findings);
  assert.equal(summary.charges, 18, 'the ledger no longer holds 18 unlock charges');
  assert.equal(summary.byVerdict.EXPLAINED_VALID_HISTORY, 18);
  assert.equal(summary.byVerdict.ORPHANED_REFERENCE, 0);
  assert.equal(summary.byVerdict.POSSIBLE_DOUBLE_CHARGE, 0);
  assert.equal(summary.byVerdict.UNKNOWN, 0);
  assert.equal(summary.unexplainedAmount, 0);

  /* Fourteen deliveries and four refunded failures. Not eighteen sales. */
  assert.equal(findings.filter((f) => f.valueDelivered).length, 14);
  assert.equal(findings.filter((f) => !f.valueDelivered).length, 4);
});
