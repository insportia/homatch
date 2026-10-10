import { test } from 'node:test';
import assert from 'node:assert/strict';

import { withPropertyRegister } from '../registerEnrichment.ts';
import { buildBuyerChecklist } from '../buyerChecklist.ts';
import { buildPropertyRegister } from '../propertyRegister.ts';
import { browserOfficial, CODE } from './fixtures/propertyRegisterFixture.mjs';

/*
 * The persisted c80f7237 report, reduced to the parts the register corrects.
 * It is a READ — none of this may require a model call.
 */
const RESULT_JSON = {
  browserOfficial: browserOfficial(),
  companyProfile: {
    name: 'შპს მილენიო გრუპი', idCode: '404670272',
    directors: [{ name: 'A' }, { name: 'B' }], representation: 'ერთობლივად',
    encumbrances: [{ type: 'PLEDGE_LEASE', number: 'R23757008', date: '2023-12-19' }],
  },
};
const PERSISTED = {
  report: {
    summary: { label: 'BALANCED', statement: 'კარგი პროექტია.', highlights: [] },
    sections: [{ key: 'SNAPSHOT', body: 'ბინა N503. მესაკუთრედ მითითებულია შპს „მილენიო გრუპი“.' }],
    keyFindings: [], attentionPoints: [],
  },
  snapshot: { cadastralCode: CODE, owner: 'შპს მილენიო გრუპი', parking: 'ორდონიანი' },
  checklist: [
    { key: 'PROPERTY_EXTRACT', labelKey: 'bc_extract_label', detailKey: 'bc_extract_detail' },
    { key: 'ENCUMBRANCE_SCOPE', labelKey: 'bc_encumbrance_label', detailKey: 'bc_encumbrance_detail' },
  ],
  selfChecks: [{ kind: 'PROPERTY_EXTRACT' }, { kind: 'TAXPAYER_REGISTRY', contextValue: 'შპს მილენიო გრუპი' }],
  market: null,
};

test('persisted report: owner, prose, checklist and self-checks follow the extract', () => {
  const out = withPropertyRegister(PERSISTED, RESULT_JSON);
  assert.equal(out.snapshot.owner, 'სატესტო მესაკუთრე');
  assert.ok(!out.report.sections[0].body.includes('მილენიო'));
  const keys = out.checklist.map((c) => c.key);
  assert.ok(keys.includes('EXTRACT_ON_SIGNING_DAY'), 'acknowledges the retrieved extract');
  assert.ok(!keys.includes('PROPERTY_EXTRACT'), 'never asks for an extract HOMATCH already read');
  assert.ok(!keys.includes('ENCUMBRANCE_SCOPE'), 'company pledge is not framed as the unit question');
  assert.ok(keys.includes('UNIT_MORTGAGE_NMA0003673681'));
  assert.ok(keys.includes('SELLER_IS_OWNER'));
  assert.ok(!keys.includes('COMMISSIONING_ACT'), 'a finished building is not sent to be "verified" (owner, 2026-10-09)');
  assert.ok(!keys.includes('JOINT_SIGNATURE'), 'the developer is not the seller');
  assert.deepEqual(out.selfChecks.map((c) => c.kind), ['PROPERTY_EXTRACT']);
  assert.equal(out.propertyRegister.coverage.found, 4);
  // The original object is never mutated (the stored row is never modified).
  assert.equal(PERSISTED.snapshot.owner, 'შპს მილენიო გრუპი');
});

test('checklist params carry the extract date, creditor and registration date', () => {
  const reg = buildPropertyRegister(browserOfficial());
  const items = buildBuyerChecklist({ cadastralCode: CODE, register: reg });
  const fresh = items.find((i) => i.key === 'EXTRACT_ON_SIGNING_DAY');
  assert.equal(fresh.params.date, '22.09.2026');
  const m = items.find((i) => i.key.startsWith('UNIT_MORTGAGE'));
  assert.deepEqual(m.params, { date: '22.09.2026', creditor: 'საქართველოს ბანკი', registered: '02.09.2026' });
  assert.equal(items.find((i) => i.key === 'SELLER_IS_OWNER').params.since, '27.05.2026');
});

test('without an extract the checklist is unchanged in shape: company pledge earns the unit question', () => {
  const company = { idCode: '404670272', legalName: 'X', encumbrances: [{}], representationRule: 'JOINT' };
  const keys = buildBuyerChecklist({ cadastralCode: CODE, company }).map((i) => i.key);
  assert.deepEqual(keys, ['PROPERTY_EXTRACT', 'ENCUMBRANCE_SCOPE', 'TAXPAYER_STATUS', 'JOINT_SIGNATURE', 'PAYMENT_ACCOUNT']);
});

test('a report with no Service 176 data is returned with only the malformed-history guard applied', () => {
  const out = withPropertyRegister(PERSISTED, { browserOfficial: { results: [] } });
  assert.equal(out.snapshot.owner, 'შპს მილენიო გრუპი');
  assert.equal(out.checklist, PERSISTED.checklist);
  assert.equal(out.propertyRegister, undefined);
});

test('malformed purpose history: header words and land categories are not building functions', async () => {
  const { acceptableValue } = await import('../tasIntelligence.ts');
  assert.equal(acceptableValue('buildingFunction', 'ფართობი'), false);
  assert.equal(acceptableValue('buildingFunction', 'არასასოფლო სამეურნეო'), false);
  assert.equal(acceptableValue('buildingFunction', 'საცხოვრებელი'), true);
  assert.equal(acceptableValue('landArea', '2145 კვ.მ'), true);
  const out = withPropertyRegister({ officialHistory: { evolution: [
    { key: 'buildingFunction', from: 'ფართობი', to: 'არასასოფლო სამეურნეო' },
    { key: 'floors', from: '8', to: '9' },
  ] } }, {});
  assert.deepEqual(out.officialHistory.evolution.map((e) => e.key), ['floors']);
});
