import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  inferPropertyType, buildActionPlan, buildQuestions,
  buildDocumentChecklist, buildBuyerPlan,
} from '../buyerPlan.ts';

/*
 * BUYER PLAN GROUNDING.
 *
 * The whole point of this module is that it CANNOT produce generic filler.
 * Every item must name the evidence that caused it, and an empty evidence set
 * must produce an empty plan rather than a confident-looking checklist.
 *
 * The fixture mirrors the real Krtsanisi property from production job
 * 3aa36828: a company-owned unit under construction, with a Bank of Georgia
 * pledge on the parent parcel.
 */

const f = (type, value, over = {}) => ({
  type, value, state: 'CONFIRMED', source: 'enreg', documentRef: 'B24099518', ...over,
});

const DEVELOPER = {
  cadastralCode: '01.18.06.019.055.03.01.601',
  findings: [
    f('property.kind', 'APARTMENT'),
    f('property.unitNumber', '601'),
    f('ownership.owner', 'შპს მილენიო გრუპი'),
    f('ownership.ownerType', 'COMPANY'),
    f('construction.status', 'UNDER_CONSTRUCTION', { source: 'tas' }),
    f('company.name', 'შპს მილენიო გრუპი'),
    f('company.idCode', '404670272'),
    f('encumbrance.mortgage', 'Bank of Georgia'),
    f('registry.extract', 'B24099518'),
  ],
};

const PRIVATE = {
  findings: [
    f('property.kind', 'APARTMENT'),
    f('property.unitNumber', '12'),
    f('ownership.owner', 'ი. ივანიძე'),
    f('ownership.ownerType', 'INDIVIDUAL'),
    f('building.registered', true),
  ],
};

const LAND = {
  findings: [
    f('property.kind', 'LAND'),
    f('land.category', 'NON_AGRICULTURAL'),
    f('land.k2', 2.1),
    f('ownership.owner', 'ს. ს.'),
  ],
};

const EMPTY = { findings: [] };

/* ------------------------------------------------------------------ *
 * Adaptive classification.                                            *
 * ------------------------------------------------------------------ */

test('a company-owned unit under construction is a developer apartment', () => {
  const r = inferPropertyType(DEVELOPER);
  assert.equal(r.type, 'DEVELOPER_APARTMENT');
  assert.equal(r.groundedIn.length > 0, true);
});

test('an individually-owned apartment is a private apartment', () => {
  assert.equal(inferPropertyType(PRIVATE).type, 'PRIVATE_APARTMENT');
});

test('land is recognised from its own category evidence', () => {
  assert.equal(inferPropertyType(LAND).type, 'LAND');
});

test('with no evidence the type is UNKNOWN — never a guess', () => {
  const r = inferPropertyType(EMPTY);
  assert.equal(r.type, 'UNKNOWN');
  assert.equal(r.state, 'UNAVAILABLE');
});

/* ------------------------------------------------------------------ *
 * NO EVIDENCE = NO FACT.                                              *
 * ------------------------------------------------------------------ */

test('an empty Verify produces an EMPTY plan, not a generic checklist', () => {
  const plan = buildBuyerPlan(EMPTY);
  assert.deepEqual(plan.actions, []);
  assert.deepEqual(plan.questions, []);
  assert.deepEqual(plan.documents, []);
});

test('EVERY produced item names the evidence that caused it', () => {
  for (const ctx of [DEVELOPER, PRIVATE, LAND]) {
    const plan = buildBuyerPlan(ctx);
    for (const item of [...plan.actions, ...plan.questions, ...plan.documents]) {
      assert.equal(Array.isArray(item.groundedIn) && item.groundedIn.length > 0, true,
        `${item.key} has no grounding`);
    }
  }
});

test('UNAVAILABLE findings do not ground anything', () => {
  const ctx = { findings: [f('encumbrance.mortgage', null, { state: 'UNAVAILABLE' })] };
  const actions = buildActionPlan(ctx, 'DEVELOPER_APARTMENT');
  assert.equal(actions.some((a) => a.key === 'mortgage-release-terms'), false);
});

/* ------------------------------------------------------------------ *
 * The plan actually adapts.                                           *
 * ------------------------------------------------------------------ */

test('a developer apartment gets handover, contract and mortgage-release actions', () => {
  const keys = buildActionPlan(DEVELOPER, 'DEVELOPER_APARTMENT').map((a) => a.key);
  for (const k of ['latest-purchase-agreement', 'handover-date-and-condition', 'parent-mortgage-release', 'payment-schedule-vs-progress']) {
    assert.equal(keys.includes(k), true, `developer plan must include ${k}`);
  }
});

test('a private apartment gets seller-authority, NOT developer handover items', () => {
  const keys = buildActionPlan(PRIVATE, 'PRIVATE_APARTMENT').map((a) => a.key);
  assert.equal(keys.includes('seller-authority'), true);
  assert.equal(keys.includes('handover-date-and-condition'), false, 'no developer handover for a resale');
  assert.equal(keys.includes('latest-purchase-agreement'), false);
});

test('land gets K-coefficient and category actions, not handover or contract ones', () => {
  const keys = buildActionPlan(LAND, 'LAND').map((a) => a.key);
  assert.equal(keys.includes('development-coefficients'), true);
  assert.equal(keys.includes('land-category-implications'), true);
  assert.equal(keys.includes('handover-date-and-condition'), false);
});

test('actions are ordered by priority so the important thing is first', () => {
  const actions = buildActionPlan(DEVELOPER, 'DEVELOPER_APARTMENT');
  for (let i = 1; i < actions.length; i++) {
    assert.equal(actions[i - 1].priority <= actions[i].priority, true);
  }
});

/* ------------------------------------------------------------------ *
 * Questions.                                                          *
 * ------------------------------------------------------------------ */

test('developer questions are addressed to the developer and explain WHY', () => {
  const qs = buildQuestions(DEVELOPER, 'DEVELOPER_APARTMENT');
  assert.equal(qs.length > 0, true);
  assert.equal(qs.every((q) => q.audience === 'DEVELOPER'), true);
  assert.equal(qs.every((q) => typeof q.why === 'string' && q.why.length > 20), true, 'every question must justify itself');
});

test('a resale asks the SELLER, not a developer', () => {
  const qs = buildQuestions(PRIVATE, 'PRIVATE_APARTMENT');
  assert.equal(qs.every((q) => q.audience === 'SELLER'), true);
});

test('the mortgage-release question appears only when a mortgage exists', () => {
  const withM = buildQuestions(DEVELOPER, 'DEVELOPER_APARTMENT').map((q) => q.key);
  assert.equal(withM.includes('q-mortgage-release'), true);

  const noMortgage = { findings: DEVELOPER.findings.filter((x) => x.type !== 'encumbrance.mortgage') };
  const without = buildQuestions(noMortgage, 'DEVELOPER_APARTMENT').map((q) => q.key);
  assert.equal(without.includes('q-mortgage-release'), false);
});

/* ------------------------------------------------------------------ *
 * Documents.                                                          *
 * ------------------------------------------------------------------ */

test('a document Verify already retrieved is marked as such, not requested again', () => {
  const docs = buildDocumentChecklist(DEVELOPER, 'DEVELOPER_APARTMENT');
  const extract = docs.find((d) => d.key === 'registry-extract');
  assert.equal(extract.state, 'VERIFIED_BY_VERIFY');
});

test('a document Verify does NOT have is recommended', () => {
  const docs = buildDocumentChecklist(DEVELOPER, 'DEVELOPER_APARTMENT');
  assert.equal(docs.find((d) => d.key === 'purchase-agreement').state, 'RECOMMENDED');
});

test('no internal evidence clutter reaches the customer-facing fields', () => {
  const plan = buildBuyerPlan(DEVELOPER);
  const text = [...plan.actions, ...plan.questions, ...plan.documents]
    .map((i) => `${i.title || i.question || i.label} ${i.why}`)
    .join(' ');
  for (const jargon of ['worker', 'FSM', 'CONFIRMED', 'orchestrator', 'idCode', 'B24099518', 'enreg', 'json']) {
    assert.equal(text.includes(jargon), false, `customer text must not contain "${jargon}"`);
  }
});

test('grounding references are kept internally, separate from customer text', () => {
  const plan = buildBuyerPlan(DEVELOPER);
  const grounded = plan.actions.flatMap((a) => a.groundedIn).join(' ');
  // The engineering detail lives here, where the customer never sees it.
  assert.match(grounded, /enreg|tas/);
});
