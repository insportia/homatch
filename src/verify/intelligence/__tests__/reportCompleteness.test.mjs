import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildEvidenceGroups, groupFor, evidenceRowCount } from '../evidenceGroups.ts';
import { buildBuyerChecklist } from '../buyerChecklist.ts';
import { selectComparables } from '../comparableSelection.ts';

/*
 * WHAT THE MODEL MUST NOT BE ABLE TO DELETE.
 *
 * The live Villion synthesis (job 347f9933-e9e9-475d-a2aa-59c55c67c9ee)
 * returned:
 *
 *     evidenceUsed: []      nextSteps: []
 *
 * while the very same report displayed a company identification code, two
 * shareholders with exact percentages, a registered pledge and an official
 * extract reference. The evidence existed; a model that did not write
 * citations had erased the customer's view of it, and the closing buyer
 * checklist disappeared with it.
 *
 * These are the deterministic replacements. A model may order and phrase
 * them. It may not decide whether they exist.
 */

const item = (over = {}) => ({
  id: 'e1', tier: 1, category: 'PROPERTY', claim: 'a claim',
  provenance: 'DERIVED', certainty: 'REPORTED', ...over,
});

/* ------------------------------------------------------------------ *
 * Evidence & Sources                                                  *
 * ------------------------------------------------------------------ */

test('evidence survives a model that cited nothing at all', () => {
  const items = [
    item({ id: 'e1', claim: 'საიდენტიფიკაციო კოდი: 404670272', provenance: 'OFFICIAL_REGISTRY', category: 'DEVELOPER' }),
    item({ id: 'e2', claim: 'წილის მფლობელი: ლევან ჩაჩუა — 50%', provenance: 'OFFICIAL_REGISTRY', category: 'DEVELOPER' }),
    item({ id: 'e3', claim: 'კომპანიის დონეზე რეგისტრირებული გირავნობა: R23757008', provenance: 'OFFICIAL_REGISTRY', category: 'ENCUMBRANCE' }),
    item({ id: 'e4', claim: 'განცხადება 1,850 USD/მ²', provenance: 'MARKET_LISTING', category: 'MARKET' }),
  ];
  // The exact production condition: the model cited nothing.
  const groups = buildEvidenceGroups(items, new Set());

  assert.ok(groups.length > 0, 'evidence that exists must reach the customer');
  assert.equal(evidenceRowCount(groups), 4);
  const claims = groups.flatMap((g) => g.rows.map((r) => r.claim)).join('\n');
  assert.match(claims, /404670272/);
  assert.match(claims, /R23757008/);
});

test('official evidence leads, and market listings are their own group', () => {
  const groups = buildEvidenceGroups([
    item({ id: 'm', claim: 'market', provenance: 'MARKET_LISTING', category: 'MARKET' }),
    item({ id: 'o', claim: 'official', provenance: 'OFFICIAL_REGISTRY', category: 'DEVELOPER' }),
  ]);
  assert.equal(groups[0].key, 'OFFICIAL_REGISTRY', 'the official record is read first');
  assert.ok(groups.some((g) => g.key === 'MARKET'));
});

test('an official source outranks its category', () => {
  // A company fact stated by the register belongs with the official record,
  // which is where a reader looks for it.
  assert.equal(groupFor(item({ provenance: 'OFFICIAL_REGISTRY', category: 'DEVELOPER' })), 'OFFICIAL_REGISTRY');
  assert.equal(groupFor(item({ provenance: 'DEVELOPER_STATEMENT', category: 'DEVELOPER' })), 'COMPANY');
  assert.equal(groupFor(item({ provenance: 'MARKET_LISTING', category: 'MARKET' })), 'MARKET');
  assert.equal(groupFor(item({ provenance: 'SOCIAL_SIGNAL', category: 'SOCIAL' })), 'OTHER');
});

test('citations promote within a group but can never remove a row', () => {
  const items = [
    item({ id: 'a', claim: 'first', provenance: 'MARKET_LISTING', category: 'MARKET' }),
    item({ id: 'b', claim: 'second', provenance: 'MARKET_LISTING', category: 'MARKET' }),
  ];
  const cited = buildEvidenceGroups(items, new Set(['b']));
  assert.equal(cited[0].rows[0].claim, 'second', 'what the model leaned on comes first');
  assert.equal(cited[0].rows.length, 2, 'and the uncited row is still there');
});

test('the same observation from two lanes is one row', () => {
  const groups = buildEvidenceGroups([
    item({ id: 'a', claim: 'კომპანია: შპს „მილენიო გრუპი“' }),
    item({ id: 'b', claim: 'კომპანია: შპს მილენიო გრუპი' }),
  ]);
  assert.equal(evidenceRowCount(groups), 1, 'quotes are not a different fact');
});

test('no internal identifier, tier or score reaches a customer row', () => {
  const [group] = buildEvidenceGroups([item({ id: 'e42', tier: 3, claim: 'x', source: 'napr.gov.ge' })]);
  const row = group.rows[0];
  assert.deepEqual(
    Object.keys(row).sort(),
    ['claim', 'corroborated', 'official', 'source'].sort()
  );
  assert.equal('id' in row, false);
  assert.equal('tier' in row, false);
});

test('a non-http destination is never offered as a link', () => {
  const [g] = buildEvidenceGroups([item({ url: 'javascript:alert(1)', claim: 'x' })]);
  assert.equal('url' in g.rows[0], false);
  const [g2] = buildEvidenceGroups([item({ url: 'https://napr.gov.ge/doc', claim: 'y' })]);
  assert.equal(g2.rows[0].url, 'https://napr.gov.ge/doc');
});

test('empty groups are omitted rather than rendered blank', () => {
  assert.deepEqual(buildEvidenceGroups([]), []);
  assert.deepEqual(buildEvidenceGroups([item({ claim: '   ' })]), []);
});

/* ------------------------------------------------------------------ *
 * The buyer checklist                                                 *
 * ------------------------------------------------------------------ */

const VILLION_COMPANY = {
  status: 'REGISTRY_CONFIRMED',
  legalName: 'შპს მილენიო გრუპი',
  idCode: '404670272',
  representationRule: 'JOINT',
  encumbrances: [{ kind: 'PLEDGE_LEASE', reference: 'R23757008', creditor: 'სს საქართველოს ბანკი', registeredAt: '19/12/2023', scope: 'COMPANY' }],
  directors: [], ownership: [], registryFields: [], registryBacked: true,
};

test('the checklist is built from findings, not from a fixed template', () => {
  const steps = buildBuyerChecklist({
    cadastralCode: '01.18.06.019.055.03.01.601',
    company: VILLION_COMPANY,
    market: { contextAvailable: true },
    parkingMentioned: true,
    subjectPriceKnown: false,
  });
  const keys = steps.map((s) => s.key);

  // Each of these is EARNED by something the report actually found.
  assert.ok(keys.includes('PROPERTY_EXTRACT'), 'a cadastral code earns its extract');
  assert.ok(keys.includes('ENCUMBRANCE_SCOPE'), 'a company pledge earns a property-level check');
  assert.ok(keys.includes('TAXPAYER_STATUS'), 'a company id earns a taxpayer check');
  assert.ok(keys.includes('JOINT_SIGNATURE'), 'joint representation earns a signing note');
  assert.ok(keys.includes('PARKING_RIGHTS'));
  assert.ok(keys.includes('PRICE_AGAINST_MARKET'), 'market context without a subject price');

  // Real destinations only, and only ones this product already links to.
  const extract = steps.find((s) => s.key === 'PROPERTY_EXTRACT');
  assert.equal(extract.value, '01.18.06.019.055.03.01.601');
  assert.match(extract.url, /^https:\/\/www\.my\.gov\.ge\//);
  assert.match(steps.find((s) => s.key === 'TAXPAYER_STATUS').url, /^https:\/\/www\.rs\.ge\//);
});

test('nothing is asked for that the report has no reason to ask', () => {
  const bare = buildBuyerChecklist({ cadastralCode: null, company: null, market: null });
  assert.deepEqual(bare, [], 'no findings, no checklist — not a generic list');

  // A company with no pledge earns no pledge question.
  const noPledge = buildBuyerChecklist({
    cadastralCode: 'X', company: { ...VILLION_COMPANY, encumbrances: [] },
  });
  assert.equal(noPledge.some((s) => s.key === 'ENCUMBRANCE_SCOPE'), false);

  // Sole representation earns no joint-signature note.
  const sole = buildBuyerChecklist({
    cadastralCode: 'X', company: { ...VILLION_COMPANY, representationRule: 'SOLE' },
  });
  assert.equal(sole.some((s) => s.key === 'JOINT_SIGNATURE'), false);
});

test('a known subject price removes the price-comparison step', () => {
  const steps = buildBuyerChecklist({
    cadastralCode: 'X', company: null,
    market: { contextAvailable: true }, subjectPriceKnown: true,
  });
  assert.equal(steps.some((s) => s.key === 'PRICE_AGAINST_MARKET'), false);
});

test('every step carries a translatable label and reason, never raw prose', () => {
  const steps = buildBuyerChecklist({
    cadastralCode: 'X', company: VILLION_COMPANY, market: { contextAvailable: true },
  });
  for (const s of steps) {
    assert.match(s.labelKey, /^bc_/, `${s.key} must use an i18n key`);
    assert.match(s.detailKey, /^bc_/);
  }
});

/* ------------------------------------------------------------------ *
 * Comparables: direct versus wider city                               *
 * ------------------------------------------------------------------ */

const comp = (tier, relevance, over = {}) => ({
  tier, relevance, pricePerSqm: 1800, currency: 'USD', reasons: [], state: 'ACTIVE', ...over,
});

test('unrelated districts are context, never direct comparables', () => {
  // The live shape: one local listing, then a pile of citywide ones.
  const scored = [
    comp('SAME_PROJECT', 95),
    comp('WIDER_MARKET', 60), comp('WIDER_MARKET', 58), comp('WIDER_MARKET', 55),
    comp('WIDER_MARKET', 52), comp('WIDER_MARKET', 50), comp('WIDER_MARKET', 48),
  ];
  const sel = selectComparables(scored);

  assert.equal(sel.direct.length, 1, 'only the genuinely local one is direct');
  assert.equal(sel.direct[0].tier, 'SAME_PROJECT');
  assert.ok(sel.direct.every((d) => d.tier !== 'WIDER_MARKET'), 'no citywide listing may be direct');
  assert.ok(sel.context.length > 0, 'the rest is explicitly wider-city context');
  assert.ok(sel.context.every((c) => c.reasonKey === 'cmp_reason_wider_market'));
  assert.equal(sel.directIsThin, true, 'one listing is an anecdote, and the report should say so');
  assert.equal(sel.rawCount, 7);
});

test('the direct set is never padded to hit a number', () => {
  const sel = selectComparables([comp('WIDER_MARKET', 90), comp('WIDER_MARKET', 80)]);
  assert.deepEqual(sel.direct, [], 'no local evidence means no direct comparables');
  assert.equal(sel.counts.WIDER_MARKET, 2);
});

test('bands are ordered strongest first, and each carries its reason', () => {
  const sel = selectComparables([
    comp('PEER_PROJECT', 70), comp('SAME_STREET', 60),
    comp('SAME_PROJECT', 50), comp('SAME_DISTRICT', 65),
  ]);
  assert.deepEqual(
    sel.direct.map((d) => d.tier),
    ['SAME_PROJECT', 'SAME_STREET', 'SAME_DISTRICT', 'PEER_PROJECT'],
    'band beats raw relevance — a same-project flat outranks a better-scoring stranger'
  );
  assert.deepEqual(
    sel.direct.map((d) => d.reasonKey),
    ['cmp_reason_same_project', 'cmp_reason_same_street', 'cmp_reason_same_district', 'cmp_reason_peer_project']
  );
  assert.equal(sel.directIsThin, false);
});

test('a strong local set is capped rather than dumped', () => {
  const many = Array.from({ length: 12 }, (_, i) => comp('SAME_PROJECT', 90 - i));
  const sel = selectComparables(many);
  assert.equal(sel.direct.length, 4, 'a small useful set, not everything we hold');
  assert.equal(sel.counts.SAME_PROJECT, 12, 'while still reporting the real basis');
});
