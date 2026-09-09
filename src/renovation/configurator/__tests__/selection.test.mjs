import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TAXONOMY,
  resolveSelection,
  defaultSelection,
  groupByCategory,
  taxonomyNode,
} from '../selection.ts';
import { TBILISI_PRICE_BOOK } from '../../calculations/priceBook.ts';

/*
 * The invariant these exist to protect:
 *
 *   NOT_DECIDED IS NEVER A NUMBER.
 *
 * An undecided or unpriceable item must not be quietly included (inflating
 * the budget and implying a decision) or quietly excluded (making the
 * renovation look cheaper than it will be). It has to leave the resolver as
 * something the customer is told about.
 */

/* ---------------------------------------------------------------- *
 * Taxonomy integrity                                                *
 * ---------------------------------------------------------------- */

test('every taxonomy id and option id is unique', () => {
  const ids = TAXONOMY.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const n of TAXONOMY) {
    const o = n.options.map((x) => x.id);
    assert.equal(new Set(o).size, o.length, `duplicate option in ${n.id}`);
    assert.ok(n.options.length > 0, `${n.id} has no options`);
  }
});

test('every non-null itemKey exists in the real price book', () => {
  // A taxonomy that points at a price item which does not exist would produce
  // a silently missing line rather than a visible gap.
  const keys = new Set(TBILISI_PRICE_BOOK.items.map((i) => i.key));
  for (const n of TAXONOMY) {
    for (const o of n.options) {
      if (o.itemKey) {
        assert.ok(keys.has(o.itemKey), `${n.id}/${o.id} -> unknown price item ${o.itemKey}`);
      }
    }
  }
});

test('anything the price book cannot cost is NOT defaulted to INCLUDE', () => {
  // Defaulting an unpriceable node to INCLUDE would contribute zero to the
  // total, which reads as "free" rather than "not counted".
  for (const n of TAXONOMY) {
    const firstPriced = n.options[0]?.itemKey;
    if (!firstPriced && n.defaultChoice === 'INCLUDE') {
      assert.fail(`${n.id} defaults to INCLUDE but its first option has no price item`);
    }
  }
});

test('taxonomyNode looks nodes up and returns null for unknown ids', () => {
  assert.equal(taxonomyNode('floors.finish')?.category, 'FLOORS');
  assert.equal(taxonomyNode('nope'), null);
});

/* ---------------------------------------------------------------- *
 * The three outcomes stay separate                                  *
 * ---------------------------------------------------------------- */

test('an INCLUDE with a priced option lands in the total', () => {
  const r = resolveSelection({ 'floors.finish': { choice: 'INCLUDE', optionId: 'laminate' } });
  assert.ok(r.includedItemKeys.includes('floor.laminate'));
});

test('an EXCLUDE never reaches the total, and is reported', () => {
  const r = resolveSelection({ 'doors.interior': { choice: 'EXCLUDE' } });
  assert.ok(!r.includedItemKeys.includes('door.interior'));
  assert.ok(r.excluded.some((e) => e.id === 'doors.interior'));
});

test('NOT_DECIDED never reaches the total, and is reported', () => {
  const r = resolveSelection({ 'floors.finish': { choice: 'NOT_DECIDED' } });
  assert.ok(!r.includedItemKeys.includes('floor.laminate'));
  assert.ok(!r.includedItemKeys.includes('floor.tile'));
  assert.ok(r.undecided.some((u) => u.id === 'floors.finish'));
});

test('a chosen but unpriceable option is surfaced, never silently zero', () => {
  // "I want a stretch ceiling" is a real decision the price book cannot cost.
  const r = resolveSelection({ 'ceilings.finish': { choice: 'INCLUDE', optionId: 'stretch' } });
  assert.equal(r.includedItemKeys.includes('ceiling.paint'), false);
  const hit = r.selectedButNotPriced.find((x) => x.id === 'ceilings.finish');
  assert.ok(hit, 'must be reported as selected-but-not-priced');
  assert.equal(hit.optionLabel, 'Stretch ceiling');
});

test('excluded, undecided and unpriced are mutually exclusive sets', () => {
  const r = resolveSelection(defaultSelection());
  const ids = [
    ...r.excluded.map((x) => x.id),
    ...r.undecided.map((x) => x.id),
    ...r.selectedButNotPriced.map((x) => x.id),
  ];
  assert.equal(new Set(ids).size, ids.length, 'a node appeared in two outcome lists');
});

/* ---------------------------------------------------------------- *
 * Mutually exclusive material choices                               *
 * ---------------------------------------------------------------- */

test('choosing one floor covering excludes the alternatives', () => {
  const r = resolveSelection({ 'floors.finish': { choice: 'INCLUDE', optionId: 'tile' } });
  assert.ok(r.includedItemKeys.includes('floor.tile'));
  assert.ok(!r.includedItemKeys.includes('floor.laminate'), 'only one covering may be costed');
});

test('an option id that no longer exists falls back rather than throwing', () => {
  // Saved scenarios outlive taxonomy edits.
  const r = resolveSelection({ 'floors.finish': { choice: 'INCLUDE', optionId: 'removed_option' } });
  assert.ok(r.includedItemKeys.includes('floor.laminate'));
});

/* ---------------------------------------------------------------- *
 * Per-item segment override                                         *
 * ---------------------------------------------------------------- */

test('premium flooring can sit beside economy paint in one project', () => {
  const r = resolveSelection({
    'floors.finish': { choice: 'INCLUDE', optionId: 'laminate', tier: 'high' },
    'walls.finish': { choice: 'INCLUDE', optionId: 'paint', tier: 'low' },
  });
  assert.equal(r.itemTierOverrides['floor.laminate'], 'high');
  assert.equal(r.itemTierOverrides['wall.paint'], 'low');
});

test('a tier on an excluded node does not leak into the estimate', () => {
  const r = resolveSelection({ 'doors.interior': { choice: 'EXCLUDE', tier: 'high' } });
  assert.equal(r.itemTierOverrides['door.interior'], undefined);
});

/* ---------------------------------------------------------------- *
 * Completeness                                                      *
 * ---------------------------------------------------------------- */

test('the default project is NOT complete, because real decisions remain', () => {
  // The expensive, unpriceable parts (kitchen, sanitary ware, windows,
  // heating, appliances) start undecided on purpose.
  const r = resolveSelection(defaultSelection());
  assert.equal(r.isComplete, false);
  assert.ok(r.undecided.length > 0);
});

test('a project is complete only when nothing is undecided or unpriceable', () => {
  const sel = defaultSelection();
  for (const n of TAXONOMY) {
    const priced = n.options.find((o) => o.itemKey);
    sel[n.id] = priced
      ? { choice: 'INCLUDE', optionId: priced.id }
      : { choice: 'EXCLUDE' };
  }
  const r = resolveSelection(sel);
  assert.equal(r.undecided.length, 0);
  assert.equal(r.selectedButNotPriced.length, 0);
  assert.equal(r.isComplete, true);
});

test('an untouched node uses its own default, not silence', () => {
  const r = resolveSelection({});
  assert.ok(r.includedItemKeys.length > 0, 'defaults must still produce a plan');
  assert.ok(r.undecided.length > 0, 'and must still admit what is undecided');
});

test('included keys are unique even if two nodes map to the same item', () => {
  const r = resolveSelection(defaultSelection());
  assert.equal(new Set(r.includedItemKeys).size, r.includedItemKeys.length);
});

/* ---------------------------------------------------------------- *
 * Rendering                                                         *
 * ---------------------------------------------------------------- */

test('grouping preserves taxonomy order and loses no node', () => {
  const groups = groupByCategory();
  assert.equal(
    groups.reduce((n, g) => n + g.nodes.length, 0),
    TAXONOMY.length
  );
  assert.equal(groups[0].category, TAXONOMY[0].category);
});
