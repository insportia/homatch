// EXPAND SEARCH: BUYING ONLY WHAT HAS NOT BEEN BOUGHT.
//
// Three properties carry the whole feature, and each of them is a way for a
// customer to be charged for something they already have:
//
//   1. an expansion must not re-read a source the campaign already paid for
//   2. two clicks must not be two purchases
//   3. "we recorded nothing" must never render as "you have seen everything"
//
// The third one is the quiet one. A failed first sweep writes no headroom, and a
// planner that read a missing record as "nothing left" would tell a customer
// their search was complete when in fact it barely ran.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  planExpansion,
  expansionIdempotencyKey,
  customerFacingHeadroom,
  withoutAlreadyRead,
} from '../discovery/search-expansion.ts';

const CAMPAIGN = 'c0000000-0000-0000-0000-000000000001';
const JOB = 'j0000000-0000-0000-0000-000000000001';

/** A FREE first sweep: read 3 of 8, five left. The measured production shape. */
const FREE_HEADROOM = {
  searchDepth: 'STANDARD',
  sourcesSearched: 3,
  sourcesAvailableDeeper: 5,
  resultCeiling: 10,
  moreAvailable: true,
};

const base = (overrides = {}) => ({
  campaignId: CAMPAIGN,
  previousJobId: JOB,
  previousJobStatus: 'COMPLETED',
  campaignStatus: 'ACTIVE',
  headroom: FREE_HEADROOM,
  sourcesAlreadyRead: ['portal:ss.ge', 'portal:myhome.ge', 'portal:place.ge'],
  ...overrides,
});

test('a FREE sweep with five sources left is expandable, excluding the three it read', () => {
  const plan = planExpansion(base());

  assert.equal(plan.eligible, true, plan.rationale);
  assert.equal(plan.additionalSourcesAvailable, 5);
  assert.deepEqual(plan.excludeSourceIds,
    ['portal:myhome.ge', 'portal:place.ge', 'portal:ss.ge'], 'the exclusion set is not sorted');
  assert.match(plan.rationale, /only work that has not been done/);
});

test('nothing deeper means no offer, and says so as a measurement', () => {
  const plan = planExpansion(base({
    headroom: { ...FREE_HEADROOM, sourcesAvailableDeeper: 0, moreAvailable: false },
  }));
  assert.equal(plan.eligible, false);
  assert.equal(plan.refusal, 'NOTHING_DEEPER');
  assert.match(plan.rationale, /nothing to sell/);
});

test('moreAvailable false overrules a positive count', () => {
  // Belt and braces: the writer sets both, and a disagreement must fail closed
  // rather than sell on the more flattering of the two.
  const plan = planExpansion(base({
    headroom: { ...FREE_HEADROOM, sourcesAvailableDeeper: 5, moreAvailable: false },
  }));
  assert.equal(plan.eligible, false);
  assert.equal(plan.refusal, 'NOTHING_DEEPER');
});

test('NO HEADROOM is not "you have seen everything"', () => {
  /*
   * The distinction that protects the customer from a confident lie. A sweep
   * that crashed before writing its reach has told us nothing at all, and the
   * refusal reason must say that rather than borrowing NOTHING_DEEPER.
   */
  const plan = planExpansion(base({ headroom: null }));
  assert.equal(plan.eligible, false);
  assert.equal(plan.refusal, 'NO_HEADROOM_RECORDED');
  assert.notEqual(plan.refusal, 'NOTHING_DEEPER');
  assert.match(plan.rationale, /unknown/);
  assert.match(plan.rationale, /claiming the search was complete would not be/);
});

test('a running sweep cannot be expanded, because its list is still growing', () => {
  for (const status of ['RUNNING', 'PENDING', 'QUEUED', 'DISCOVERING']) {
    const plan = planExpansion(base({ previousJobStatus: status }));
    assert.equal(plan.eligible, false, `${status} was expandable`);
    assert.equal(plan.refusal, 'CAMPAIGN_NOT_READY');
    assert.match(plan.rationale, /still changing/);
  }
});

test('a settled sweep can be expanded even if it ended badly', () => {
  // A partial or failed sweep is exactly when a customer most wants more, and
  // what it DID read is settled, which is all the exclusion set needs.
  for (const status of ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'PARTIAL', 'FAILED']) {
    const plan = planExpansion(base({ previousJobStatus: status }));
    assert.equal(plan.eligible, true, `${status} was refused: ${plan.rationale}`);
  }
});

test('a cancelled or archived campaign is not expandable', () => {
  for (const status of ['CANCELLED', 'ARCHIVED', 'PAUSED', 'DRAFT']) {
    const plan = planExpansion(base({ campaignStatus: status }));
    assert.equal(plan.eligible, false, `${status} was expandable`);
    assert.equal(plan.refusal, 'CAMPAIGN_NOT_READY');
  }
});

test('TWO CLICKS ARE ONE PURCHASE: the key is stable across identical calls', () => {
  const first = planExpansion(base());
  const second = planExpansion(base());
  assert.equal(first.idempotencyKey, second.idempotencyKey);

  // And the order the sources arrive in must not change it.
  const reordered = planExpansion(base({
    sourcesAlreadyRead: ['portal:place.ge', 'portal:ss.ge', 'portal:myhome.ge'],
  }));
  assert.equal(reordered.idempotencyKey, first.idempotencyKey,
    'reordering the already-read list produced a second purchase');

  // A duplicate in the list is not new work either.
  const duplicated = planExpansion(base({
    sourcesAlreadyRead: ['portal:ss.ge', 'portal:ss.ge', 'portal:myhome.ge', 'portal:place.ge'],
  }));
  assert.equal(duplicated.idempotencyKey, first.idempotencyKey);
});

test('the key contains no clock and no randomness', () => {
  // Either would turn every click into a new purchase, which is the whole bug.
  const a = expansionIdempotencyKey(CAMPAIGN, JOB, ['x']);
  const b = expansionIdempotencyKey(CAMPAIGN, JOB, ['x']);
  assert.equal(a, b);
  assert.match(a, /^expand:c0000000-0000-0000-0000-000000000001:j0000000-0000-0000-0000-000000000001:[0-9a-f]{8}$/);
});

test('a SECOND expansion after more sources were read is a different purchase', () => {
  /*
   * The other half of idempotency, and the half that is easy to break by making
   * the key too stable. The first expansion read two more sources; the next one
   * is different work and must be buyable.
   */
  const first = planExpansion(base());
  const afterFirst = planExpansion(base({
    sourcesAlreadyRead: [...base().sourcesAlreadyRead, 'portal:home.ge', 'portal:makler.ge'],
    headroom: { ...FREE_HEADROOM, sourcesSearched: 5, sourcesAvailableDeeper: 3 },
    priorExpansionKeys: [first.idempotencyKey],
  }));

  assert.notEqual(afterFirst.idempotencyKey, first.idempotencyKey);
  assert.equal(afterFirst.eligible, true, afterFirst.rationale);
  assert.equal(afterFirst.additionalSourcesAvailable, 3);
  assert.equal(afterFirst.excludeSourceIds.length, 5);
});

test('an already-authorised expansion is refused rather than charged again', () => {
  const first = planExpansion(base());
  const repeat = planExpansion(base({ priorExpansionKeys: [first.idempotencyKey] }));
  assert.equal(repeat.eligible, false);
  assert.equal(repeat.refusal, 'ALREADY_EXPANDED');
  assert.match(repeat.rationale, /must not reserve twice/);
});

test('a campaign with no prior reads still excludes nothing and remains buyable', () => {
  const plan = planExpansion(base({ sourcesAlreadyRead: [] }));
  assert.equal(plan.eligible, true);
  assert.deepEqual(plan.excludeSourceIds, []);
});

test('blank and whitespace ids are not treated as sources', () => {
  const plan = planExpansion(base({ sourcesAlreadyRead: ['', '  ', 'portal:ss.ge', ' portal:ss.ge '] }));
  assert.deepEqual(plan.excludeSourceIds, ['portal:ss.ge']);
});

/* ── the exclusion actually applied ───────────────────────────────────────── */

test('withoutAlreadyRead removes exactly the paid-for sources and says why', () => {
  const sources = [
    { id: 'portal:ss.ge' }, { id: 'portal:home.ge' },
    { id: 'portal:makler.ge' }, { id: 'portal:place.ge' },
  ];
  const { fresh, skipped } = withoutAlreadyRead(sources, ['portal:ss.ge', 'portal:place.ge']);

  assert.deepEqual(fresh.map((s) => s.id), ['portal:home.ge', 'portal:makler.ge']);
  assert.equal(skipped.length, 2);
  for (const entry of skipped) {
    assert.equal(entry.reason, 'ALREADY_READ');
    assert.match(entry.detail, /buys new work only/);
  }
});

test('an exclusion list naming nothing present leaves the list alone', () => {
  const sources = [{ id: 'portal:home.ge' }];
  const { fresh, skipped } = withoutAlreadyRead(sources, ['portal:gone.ge']);
  assert.deepEqual(fresh.map((s) => s.id), ['portal:home.ge']);
  assert.deepEqual(skipped, []);
});

test('excluding everything leaves an empty sweep rather than a full one', () => {
  // The failure this prevents is the inverse of double-charging: an expansion
  // that silently falls back to "read everything" when its exclusion set covers
  // the lot.
  const sources = [{ id: 'a' }, { id: 'b' }];
  const { fresh, skipped } = withoutAlreadyRead(sources, ['a', 'b']);
  assert.deepEqual(fresh, []);
  assert.equal(skipped.length, 2);
});

/* ── what reaches the screen ──────────────────────────────────────────────── */

test('the customer-facing shape carries counts and nothing else', () => {
  const shape = customerFacingHeadroom(FREE_HEADROOM);
  assert.deepEqual(Object.keys(shape).sort(), ['deeperAvailable', 'offerExpansion', 'searched']);
  assert.equal(shape.searched, 3);
  assert.equal(shape.deeperAvailable, 5);
  assert.equal(shape.offerExpansion, true);

  /*
   * The load-bearing assertion, and the reason this function exists rather than
   * the component reading the column directly: there is nowhere in the return
   * value to put a tier, an adapter id, a supplier name, a cost or a plan. The
   * screen cannot leak what it cannot reach.
   */
  const leaky = customerFacingHeadroom({
    ...FREE_HEADROOM,
    searchDepth: 'MAXIMUM',
    resultCeiling: 250,
  });
  const serialised = JSON.stringify(leaky);
  for (const forbidden of ['MAXIMUM', 'STANDARD', 'ENHANCED', '250', 'portal:', 'tier', 'cent']) {
    assert.equal(serialised.includes(forbidden), false,
      `${forbidden} reached the customer-facing shape: ${serialised}`);
  }
});

test('no headroom offers nothing, without inventing a zero-source search', () => {
  const shape = customerFacingHeadroom(null);
  assert.equal(shape.offerExpansion, false);
  assert.equal(shape.searched, 0);
  assert.equal(shape.deeperAvailable, 0);
});

test('a sweep that read nothing is not offered a deeper version of nothing', () => {
  // searched === 0 means the first sweep did not work. The answer to that is to
  // look at why, not to sell a second one.
  const shape = customerFacingHeadroom({ ...FREE_HEADROOM, sourcesSearched: 0 });
  assert.equal(shape.offerExpansion, false);
});

test('nonsense counts are clamped rather than rendered', () => {
  const shape = customerFacingHeadroom({
    searchDepth: null, sourcesSearched: -3, sourcesAvailableDeeper: 2.7,
    resultCeiling: null, moreAvailable: true,
  });
  assert.equal(shape.searched, 0);
  assert.equal(shape.deeperAvailable, 2);
  assert.equal(shape.offerExpansion, false, 'a negative search count was offered an expansion');
});

test('the planner holds no price, plan or tier vocabulary at all', () => {
  const source = readFileSync('src/research-core/discovery/search-expansion.ts', 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const forbidden of ['FREE', 'VIP', 'PREMIUM', 'priceCents', 'costUsd', 'credits *=',
    'PAYG_CEILING', 'priority_tier']) {
    assert.equal(code.includes(forbidden), false,
      `the expansion planner names ${forbidden}; pricing and plans are decided elsewhere`);
  }
});
