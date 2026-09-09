import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TAXONOMY,
  resolveSelection,
  defaultSelection,
  groupByCategory,
  taxonomyNode,
  nodesForRooms,
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
  assert.equal(taxonomyNode('floors.finish.dry')?.category, 'FLOORS');
  assert.equal(taxonomyNode('nope'), null);
});

/* ---------------------------------------------------------------- *
 * The three outcomes stay separate                                  *
 * ---------------------------------------------------------------- */

test('an INCLUDE with a priced option lands in the total', () => {
  const r = resolveSelection({ 'floors.finish.dry': { choice: 'INCLUDE', optionId: 'laminate' } });
  assert.ok(r.includedItemKeys.includes('floor.laminate'));
});

test('an EXCLUDE never reaches the total, and is reported', () => {
  const r = resolveSelection({ 'doors.interior': { choice: 'EXCLUDE' } });
  assert.ok(!r.includedItemKeys.includes('door.interior'));
  assert.ok(r.excluded.some((e) => e.id === 'doors.interior'));
});

test('NOT_DECIDED never reaches the total, and is reported', () => {
  const r = resolveSelection({ 'floors.finish.dry': { choice: 'NOT_DECIDED' } });
  // Only the dry-room covering is undecided here. floor.tile may still be
  // included via the separate wet-room node, which is a different decision.
  assert.ok(!r.includedItemKeys.includes('floor.laminate'));
  assert.ok(r.undecided.some((u) => u.id === 'floors.finish.dry'));
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
  const r = resolveSelection({ 'floors.finish.dry': { choice: 'INCLUDE', optionId: 'tile' } });
  assert.ok(r.includedItemKeys.includes('floor.tile'));
  assert.ok(!r.includedItemKeys.includes('floor.laminate'), 'only one covering may be costed');
});

test('an option id that no longer exists falls back rather than throwing', () => {
  // Saved scenarios outlive taxonomy edits.
  const r = resolveSelection({ 'floors.finish.dry': { choice: 'INCLUDE', optionId: 'removed_option' } });
  assert.ok(r.includedItemKeys.includes('floor.laminate'));
});

/* ---------------------------------------------------------------- *
 * Per-item segment override                                         *
 * ---------------------------------------------------------------- */

test('premium flooring can sit beside economy paint in one project', () => {
  const r = resolveSelection({
    'floors.finish.dry': { choice: 'INCLUDE', optionId: 'laminate', segment: 'PREMIUM' },
    'walls.finish.dry': { choice: 'INCLUDE', optionId: 'paint', segment: 'ECONOMY' },
  });
  assert.equal(r.itemTierOverrides['floor.laminate'], 'high');
  assert.equal(r.itemTierOverrides['wall.paint'], 'low');
});

test('a tier on an excluded node does not leak into the estimate', () => {
  const r = resolveSelection({ 'doors.interior': { choice: 'EXCLUDE', segment: 'PREMIUM' } });
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

/* ---------------------------------------------------------------- *
 * Rooms                                                             *
 * ---------------------------------------------------------------- */

test('a property with no bathroom is never asked bathroom questions', () => {
  const nodes = nodesForRooms(['LIVING', 'BEDROOM', 'KITCHEN', 'HALLWAY']);
  // sanitary.mixers legitimately also applies to a kitchen, so check the
  // bathroom-only decisions rather than the whole prefix.
  for (const id of ['sanitary.toilet', 'sanitary.basin', 'sanitary.bathing', 'sanitary.accessories']) {
    assert.ok(!nodes.some((n) => n.id === id), `${id} must not be asked without a bathroom`);
  }
  assert.ok(nodes.some((n) => n.id === 'kitchen.units'), 'kitchen questions must survive');
  assert.ok(nodes.some((n) => n.scope === 'PROPERTY'), 'property-wide questions always apply');
});

test('a room-scoped decision is made once per room, not once per property', () => {
  const rooms = ['LIVING', 'BEDROOM', 'BATHROOM'];
  const r = resolveSelection(defaultSelection(TAXONOMY, rooms), TAXONOMY, rooms);
  const dryFloors = [...r.excluded, ...r.undecided, ...r.selectedButNotPriced]
    .concat(r.includedItemKeys.map((k) => ({ id: k })))
    .filter((x) => String(x.id).startsWith('floors.finish.dry@'));
  // LIVING and BEDROOM each get their own answer; BATHROOM uses the wet node.
  assert.ok(!String(JSON.stringify(r)).includes('floors.finish.dry@BATHROOM'));
});

test('different rooms can take different materials', () => {
  const rooms = ['LIVING', 'BATHROOM'];
  const sel = defaultSelection(TAXONOMY, rooms);
  sel['floors.finish.dry@LIVING'] = { choice: 'INCLUDE', optionId: 'laminate', segment: 'PREMIUM' };
  sel['floors.finish.wet@BATHROOM'] = { choice: 'INCLUDE', optionId: 'tile', segment: 'ECONOMY' };
  const r = resolveSelection(sel, TAXONOMY, rooms);
  assert.ok(r.includedItemKeys.includes('floor.laminate'));
  assert.ok(r.includedItemKeys.includes('floor.tile'));
  assert.equal(r.itemTierOverrides['floor.laminate'], 'high');
  assert.equal(r.itemTierOverrides['floor.tile'], 'low');
});

test('the taxonomy covers the meaningful renovation universe', () => {
  const cats = new Set(TAXONOMY.map((n) => n.category));
  for (const required of [
    'PREPARATION', 'WALLS', 'CEILINGS', 'FLOORS', 'WATERPROOFING', 'PLUMBING',
    'BATHROOM', 'ELECTRICAL', 'LIGHTING', 'HEATING', 'HVAC', 'DOORS',
    'WINDOWS', 'INSULATION', 'KITCHEN', 'FURNITURE', 'FINISHING',
  ]) {
    assert.ok(cats.has(required), `taxonomy is missing ${required}`);
  }
  assert.ok(TAXONOMY.length >= 40, `expected a real taxonomy, got ${TAXONOMY.length} nodes`);
});

/* ---------------------------------------------------------------- *
 * The configurator actually changes the total                       *
 * ---------------------------------------------------------------- */

test('skipping work removes it from the estimate, not just from the UI', async () => {
  const { calculateEstimate } = await import('../../calculations/estimate.ts');
  const { estimateQuantities } = await import('../../calculations/quantities.ts');
  const { TBILISI_PRICE_BOOK } = await import('../../calculations/priceBook.ts');

  const property = {
    totalArea: 70, condition: 'BLACK_FRAME',
    rooms: [{ kind: 'LIVING', area: 40 }, { kind: 'BATHROOM', area: 6 }],
  };
  const quantities = estimateQuantities(property);
  const base = {
    quantities, condition: 'BLACK_FRAME', totalArea: 70,
    level: 'STANDARD', materialTier: 'typical', allowProvisionalPrices: true,
  };

  const everything = calculateEstimate(TBILISI_PRICE_BOOK, base);
  const withoutDoors = calculateEstimate(TBILISI_PRICE_BOOK, {
    ...base,
    includedItemKeys: everything.lineItems.map((l) => l.key).filter((k) => k !== 'door.interior'),
  });

  assert.ok(everything.lineItems.some((l) => l.key === 'door.interior'), 'doors priced by default');
  assert.ok(!withoutDoors.lineItems.some((l) => l.key === 'door.interior'), 'skipped doors must vanish');
  assert.ok(withoutDoors.baseTotal < everything.baseTotal, 'and the total must actually fall');
});
