// Imports the REAL source modules directly — same pattern as the mortgage
// calculation suite (Node's TypeScript type-stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TBILISI_PRICE_BOOK, getPriceBook, findItem, validatePriceBook,
  assertPriceBookUsable, WASTE,
} from '../priceBook.ts';
import {
  estimateQuantities, roomsFromKnownProperty, perimeterOf,
  demolitionFraction, remainingStructuralFraction, DEFAULTS,
} from '../quantities.ts';
import {
  calculateEstimate, buildScenarios, contingencyRate, roundForCustomer,
} from '../estimate.ts';
import { buildPhases, criticalPath, estimateTimeline } from '../timeline.ts';

const BOOK = getPriceBook('tbilisi');
const ALLOW = { allowProvisionalPrices: true };

function propertyOf(totalArea, condition, opts = {}) {
  return {
    totalArea,
    condition,
    rooms: roomsFromKnownProperty({ totalArea, bedrooms: opts.bedrooms ?? 2, bathrooms: opts.bathrooms ?? 1, hasBalcony: opts.hasBalcony }),
  };
}

function estimateFor(totalArea, condition, over = {}) {
  const property = propertyOf(totalArea, condition, over);
  const quantities = estimateQuantities(property);
  return calculateEstimate(BOOK, {
    quantities, condition, totalArea,
    level: over.level ?? 'STANDARD',
    materialTier: over.materialTier ?? 'typical',
    itemTierOverrides: over.itemTierOverrides,
    ...ALLOW,
  });
}

/* ------------------------------------------------------------------ *
 * PRICE BOOK — provenance and the honesty gate.                       *
 * ------------------------------------------------------------------ */

test('the price book is internally valid: ordered ranges, provenance, no duplicates', () => {
  assert.deepEqual(validatePriceBook(BOOK), []);
});

test('every price carries a source and an observation date', () => {
  for (const item of BOOK.items) {
    assert.equal(item.provenance.length > 0, true, `${item.key} has no provenance`);
    for (const p of item.provenance) {
      assert.equal(typeof p.source === 'string' && p.source.length > 10, true, `${item.key}: weak source`);
      assert.equal(Number.isNaN(Date.parse(p.observedAt)), false);
    }
  }
});

test('UNREVIEWED prices may NOT silently produce a customer estimate', () => {
  const verdict = assertPriceBookUsable(BOOK);
  assert.equal(verdict.usable, false);
  assert.equal(verdict.reason, 'unreviewed_provisional_prices');
  // And the engine refuses rather than quietly producing a number.
  const property = propertyOf(60, 'GREEN_FRAME');
  assert.throws(
    () => calculateEstimate(BOOK, {
      quantities: estimateQuantities(property), condition: 'GREEN_FRAME',
      totalArea: 60, level: 'STANDARD', materialTier: 'typical',
    }),
    /not usable for customer estimates/
  );
});

test('provisional prices are usable only when explicitly allowed, and are flagged', () => {
  const e = estimateFor(60, 'GREEN_FRAME');
  assert.equal(e.provisionalPrices, true, 'the estimate must admit its prices are provisional');
  assert.equal(assertPriceBookUsable(BOOK, true).usable, true);
});

test('the estimate records which price-book version produced it', () => {
  assert.equal(estimateFor(60, 'GREEN_FRAME').priceBookVersion, BOOK.version);
});

test('waste factors are per material, never one global number', () => {
  assert.notEqual(WASTE.tile, WASTE.flooring);
  assert.equal(findItem(BOOK, 'floor.tile').wasteFactor, WASTE.tile);
  assert.equal(findItem(BOOK, 'floor.laminate').wasteFactor, WASTE.flooring);
  assert.equal(findItem(BOOK, 'door.interior').wasteFactor, 0, 'you do not waste a door');
});

/* ------------------------------------------------------------------ *
 * QUANTITIES — the anti-"area x price" requirement.                   *
 * ------------------------------------------------------------------ */

test('quantities are NOT all equal to floor area', () => {
  const q = estimateQuantities(propertyOf(94.1, 'GREEN_FRAME'));
  const area = 94.1;
  assert.notEqual(q.byItem['wall.paint'], area);
  assert.notEqual(q.byItem['skirting'], area);
  assert.equal(q.byItem['wall.paint'] > area, true, 'wall surface exceeds floor area');
  // Points and units are counts, not areas.
  assert.equal(Number.isInteger(q.byItem['electrical.point']), true);
  assert.equal(Number.isInteger(q.byItem['door.interior']), true);
});

test('perimeter is derived from area when not supplied, and used when it is', () => {
  const assumed = perimeterOf({ kind: 'BEDROOM', area: 16 });
  assert.equal(Math.abs(assumed - 2 * (Math.sqrt(16 / 1.4) + Math.sqrt(16 / 1.4) * 1.4)) < 0.01, true);
  assert.equal(perimeterOf({ kind: 'BEDROOM', area: 16, perimeter: 20 }), 20, 'a real measurement wins');
});

test('wall area accounts for ceiling height and openings', () => {
  const low = estimateQuantities({ totalArea: 60, ceilingHeight: 2.5, condition: 'BLACK_FRAME', rooms: [{ kind: 'LIVING', area: 20 }] });
  const high = estimateQuantities({ totalArea: 60, ceilingHeight: 3.2, condition: 'BLACK_FRAME', rooms: [{ kind: 'LIVING', area: 20 }] });
  assert.equal(high.byItem['wall.paint'] > low.byItem['wall.paint'], true, 'taller rooms need more paint');
  const perimeter = perimeterOf({ kind: 'LIVING', area: 20 });
  assert.equal(Math.abs(low.byItem['wall.paint'] - perimeter * 2.5 * (1 - DEFAULTS.openingsFraction)) < 0.05, true);
});

test('wet rooms are tiled and waterproofed; dry rooms are not', () => {
  const q = estimateQuantities({ totalArea: 50, condition: 'BLACK_FRAME', rooms: [{ kind: 'BATHROOM', area: 5 }] });
  assert.equal(q.byItem['wall.tile'] > 0, true);
  assert.equal(q.byItem['bath.waterproofing'] > 0, true);
  assert.equal(q.byItem['floor.laminate'] === undefined, true, 'no laminate in a bathroom');

  const dry = estimateQuantities({ totalArea: 50, condition: 'BLACK_FRAME', rooms: [{ kind: 'BEDROOM', area: 14 }] });
  assert.equal(dry.byItem['wall.tile'] === undefined, true);
  assert.equal(dry.byItem['bath.waterproofing'] === undefined, true);
  assert.equal(dry.byItem['floor.laminate'] > 0, true);
});

test('kitchens get tile, bedrooms get laminate', () => {
  const k = estimateQuantities({ totalArea: 40, condition: 'BLACK_FRAME', rooms: [{ kind: 'KITCHEN', area: 10 }] });
  assert.equal(k.byItem['floor.tile'], 10);
  assert.equal(k.byItem['floor.laminate'], undefined);
});

test('skirting is linear metres minus door openings, not an area', () => {
  const q = estimateQuantities({ totalArea: 30, condition: 'BLACK_FRAME', rooms: [{ kind: 'BEDROOM', area: 16, perimeter: 16, doors: 1 }] });
  assert.equal(q.byItem['skirting'], 16 - DEFAULTS.doorWidth);
});

test('plumbing and electrical are POINTS driven by room purpose', () => {
  const bath = estimateQuantities({ totalArea: 20, condition: 'BLACK_FRAME', rooms: [{ kind: 'BATHROOM', area: 5 }] });
  const bed = estimateQuantities({ totalArea: 20, condition: 'BLACK_FRAME', rooms: [{ kind: 'BEDROOM', area: 14 }] });
  assert.equal(bath.byItem['plumbing.point'], 4);
  assert.equal(bed.byItem['plumbing.point'], undefined, 'a bedroom has no plumbing');
  assert.equal(bed.byItem['electrical.point'] > 0, true);
});

test('CONDITION changes the work: a green frame is not re-plastered from scratch', () => {
  const black = estimateQuantities(propertyOf(70, 'BLACK_FRAME'));
  const green = estimateQuantities(propertyOf(70, 'GREEN_FRAME'));
  assert.equal(green.byItem['wall.plaster'] < black.byItem['wall.plaster'], true);
  assert.equal(green.byItem['floor.screed'] < black.byItem['floor.screed'], true);
  // But the finishes are the same amount of work.
  assert.equal(green.byItem['wall.paint'], black.byItem['wall.paint']);
});

test('demolition applies only where there is something to remove', () => {
  assert.equal(demolitionFraction('BLACK_FRAME'), 0);
  assert.equal(demolitionFraction('OLD_RENOVATION'), 1);
  assert.equal(estimateQuantities(propertyOf(70, 'BLACK_FRAME')).byItem['demolition'], undefined);
  assert.equal(estimateQuantities(propertyOf(70, 'OLD_RENOVATION')).byItem['demolition'] > 0, true);
  assert.equal(remainingStructuralFraction('BLACK_FRAME').plaster, 1);
});

test('assumptions are always reported so the customer can override them', () => {
  const q = estimateQuantities(propertyOf(94.1, 'GREEN_FRAME'));
  const keys = q.assumptions.map((a) => a.key);
  for (const k of ['ceilingHeight', 'roomShape', 'openings', 'condition']) {
    assert.equal(keys.includes(k), true, `assumption ${k} must be disclosed`);
  }
});

test('Verify prefill distributes the KNOWN area without inventing space', () => {
  const rooms = roomsFromKnownProperty({ totalArea: 94.1, bedrooms: 2, bathrooms: 2, hasBalcony: true });
  const sum = rooms.reduce((s, r) => s + r.area, 0);
  assert.equal(Math.abs(sum - 94.1) < 0.5, true, `rooms sum to ${sum}, expected ~94.1`);
  assert.equal(rooms.filter((r) => r.kind === 'BATHROOM').length, 2);
  assert.equal(rooms.filter((r) => r.kind === 'BEDROOM').length, 2);
  assert.equal(rooms.some((r) => r.kind === 'BALCONY'), true);
});

/* ------------------------------------------------------------------ *
 * COST — material/labour separation, waste, contingency.              *
 * ------------------------------------------------------------------ */

test('material and labour are calculated and reported separately', () => {
  const e = estimateFor(94.1, 'GREEN_FRAME');
  assert.equal(e.materials > 0 && e.labour > 0, true);
  assert.equal(Math.abs(e.materials + e.labour + e.softCosts.total - e.baseTotal) < 0.5, true);
});

test('WASTE applies to material only — never to labour', () => {
  const e = estimateFor(60, 'BLACK_FRAME');
  const tile = e.lineItems.find((l) => l.key === 'floor.tile');
  assert.equal(tile.quantityWithWaste > tile.quantity, true);
  assert.equal(Math.abs(tile.labourTotal - tile.quantity * tile.labourUnit) < 0.01, true, 'labour uses raw quantity');
  assert.equal(Math.abs(tile.materialTotal - tile.quantityWithWaste * tile.materialUnit) < 0.01, true);
});

test('an item with no material cost contributes labour only', () => {
  const e = estimateFor(70, 'OLD_RENOVATION');
  const demo = e.lineItems.find((l) => l.key === 'demolition');
  assert.equal(demo.materialUnit, null);
  assert.equal(demo.materialTotal, 0);
  assert.equal(demo.labourTotal > 0, true);
});

test('per-item tier overrides work — premium bathroom, standard everywhere else', () => {
  const base = estimateFor(80, 'GREEN_FRAME');
  const mixed = estimateFor(80, 'GREEN_FRAME', { itemTierOverrides: { 'wall.tile': 'high' } });
  assert.equal(mixed.baseTotal > base.baseTotal, true);
  const b = base.lineItems.find((l) => l.key === 'wall.tile');
  const m = mixed.lineItems.find((l) => l.key === 'wall.tile');
  assert.equal(m.materialUnit > b.materialUnit, true);
  // Everything else is untouched.
  const bp = base.lineItems.find((l) => l.key === 'wall.paint');
  const mp = mixed.lineItems.find((l) => l.key === 'wall.paint');
  assert.equal(bp.materialUnit, mp.materialUnit);
});

test('contingency is driven by the unknowns, not a flat percentage', () => {
  const black = contingencyRate('BLACK_FRAME', 'STANDARD');
  const old = contingencyRate('OLD_RENOVATION', 'STANDARD');
  const designer = contingencyRate('OLD_RENOVATION', 'DESIGNER');
  assert.equal(old.rate > black.rate, true, 'strip-out is riskier than a bare frame');
  assert.equal(designer.rate > old.rate, true, 'bespoke finishes add uncertainty');
  assert.equal(old.drivers.length > 0, true);
  assert.equal(designer.rate <= 0.25, true, 'contingency must stay plausible');
});

test('the planning budget is the base plus the reserve, and is shown as such', () => {
  const e = estimateFor(94.1, 'OLD_RENOVATION');
  assert.equal(Math.abs(e.planningBudget - (e.baseTotal + e.contingency.amount)) < 0.5, true);
  assert.equal(e.contingency.amount > 0, true);
});

test('NO FALSE PRECISION in customer-facing totals', () => {
  const e = estimateFor(94.1, 'GREEN_FRAME');
  const step = e.display.typical >= 100000 ? 5000 : e.display.typical >= 20000 ? 1000 : 500;
  assert.equal(e.display.typical % step, 0, 'headline must be rounded');
  assert.equal(e.display.rangeLow < e.display.typical && e.display.typical < e.display.rangeHigh, true);
  // Line items stay precise enough to add up.
  assert.equal(e.lineItems.every((l) => Number.isFinite(l.total)), true);
});

test('rounding steps scale with magnitude', () => {
  assert.equal(roundForCustomer(8123, 700).typical % 500, 0);
  assert.equal(roundForCustomer(45678, 4000).typical % 1000, 0);
  assert.equal(roundForCustomer(180432, 15000).typical % 5000, 0);
});

/* ------------------------------------------------------------------ *
 * SCENARIOS — same scope, different grade.                            *
 * ------------------------------------------------------------------ */

test('the three scenarios cover IDENTICAL scope — the cheap one omits nothing', () => {
  const property = propertyOf(94.1, 'GREEN_FRAME');
  const s = buildScenarios(BOOK, {
    quantities: estimateQuantities(property), condition: 'GREEN_FRAME',
    totalArea: 94.1, level: 'STANDARD', materialTier: 'typical', ...ALLOW,
  });
  const keys = (e) => e.lineItems.map((l) => l.key).sort().join(',');
  assert.equal(keys(s.economy), keys(s.recommended));
  assert.equal(keys(s.recommended), keys(s.premium));
  assert.equal(s.economy.baseTotal < s.recommended.baseTotal, true);
  assert.equal(s.recommended.baseTotal < s.premium.baseTotal, true);
});

test('the default is TYPICAL market pricing, not the cheapest quote', () => {
  const property = propertyOf(70, 'GREEN_FRAME');
  const s = buildScenarios(BOOK, {
    quantities: estimateQuantities(property), condition: 'GREEN_FRAME',
    totalArea: 70, level: 'STANDARD', materialTier: 'typical', ...ALLOW,
  });
  const tile = s.recommended.lineItems.find((l) => l.key === 'floor.tile');
  assert.equal(tile.materialUnit, findItem(BOOK, 'floor.tile').material.typical);
  assert.equal(tile.labourUnit, findItem(BOOK, 'floor.tile').labour.typical);
});

/* ------------------------------------------------------------------ *
 * REPRESENTATIVE APARTMENTS (PART AL).                                *
 * ------------------------------------------------------------------ */

for (const area of [45, 60, 94.1, 120]) {
  for (const condition of ['BLACK_FRAME', 'GREEN_FRAME', 'OLD_RENOVATION']) {
    test(`${area} m2 ${condition}: totals are finite, positive and scale sensibly`, () => {
      const e = estimateFor(area, condition);
      assert.equal(Number.isFinite(e.planningBudget) && e.planningBudget > 0, true);
      assert.equal(e.perSqm > 0, true);
      // Sanity band against published Tbilisi whole-renovation ranges
      // (~520-900 GEL/m2 black frame). Deliberately wide: this is a smoke
      // check that the engine is in the right universe, not a price claim.
      assert.equal(e.perSqm > 150 && e.perSqm < 3000, true, `implausible GEL/m2: ${e.perSqm}`);
    });
  }
}

test('a bigger apartment costs more, and cost per m2 stays in a sane band', () => {
  const small = estimateFor(45, 'GREEN_FRAME');
  const large = estimateFor(120, 'GREEN_FRAME');
  assert.equal(large.planningBudget > small.planningBudget, true);
  assert.equal(Math.abs(large.perSqm - small.perSqm) / small.perSqm < 0.6, true);
});

test('a worse starting condition costs more than a better one, all else equal', () => {
  assert.equal(estimateFor(80, 'OLD_RENOVATION').planningBudget > estimateFor(80, 'GREEN_FRAME').planningBudget, true);
});

test('zero and missing data degrade safely instead of producing nonsense', () => {
  const e = calculateEstimate(BOOK, {
    quantities: { byItem: {}, assumptions: [], roomAreas: {} },
    condition: 'GREEN_FRAME', totalArea: 0, level: 'STANDARD', materialTier: 'typical', ...ALLOW,
  });
  assert.equal(e.materials, 0);
  assert.equal(e.labour, 0);
  assert.equal(e.perSqm, 0, 'no division by zero');
  assert.equal(Number.isFinite(e.planningBudget), true);
});

/* ------------------------------------------------------------------ *
 * TIMELINE.                                                           *
 * ------------------------------------------------------------------ */

test('the timeline respects dependencies and is not area x constant', () => {
  const t60 = estimateTimeline('GREEN_FRAME', 60, 'STANDARD');
  const t120 = estimateTimeline('GREEN_FRAME', 120, 'STANDARD');
  assert.equal(t120.typicalDays > t60.typicalDays, true);
  assert.equal(t120.typicalDays < t60.typicalDays * 2, true, 'duration must be sub-linear in area');
});

test('curing is fixed time that no amount of labour compresses', () => {
  const phases = buildPhases('GREEN_FRAME', 60, 'STANDARD');
  const curing = phases.find((p) => p.key === 'curing');
  assert.equal(curing.fixed, true);
  const big = buildPhases('GREEN_FRAME', 200, 'PREMIUM').find((p) => p.key === 'curing');
  assert.equal(big.days, curing.days, 'curing does not scale');
});

test('the critical path is the longest chain, not the sum of all phases', () => {
  const phases = buildPhases('GREEN_FRAME', 60, 'STANDARD');
  const total = phases.reduce((s, p) => s + p.days, 0);
  const path = criticalPath(phases);
  assert.equal(path < total, true, 'independent phases must overlap');
  assert.equal(path > 0, true);
});

test('a circular dependency is rejected rather than looping forever', () => {
  assert.throws(() => criticalPath([
    { key: 'a', label: 'a', dependsOn: ['b'], days: 1 },
    { key: 'b', label: 'b', dependsOn: ['a'], days: 1 },
  ]), /circular/);
});

test('demolition only appears when there is something to demolish', () => {
  assert.equal(buildPhases('BLACK_FRAME', 60, 'STANDARD').some((p) => p.key === 'demolition'), false);
  assert.equal(buildPhases('OLD_RENOVATION', 60, 'STANDARD').some((p) => p.key === 'demolition'), true);
});

test('the timeline is a RANGE with explained drivers, never a single promise', () => {
  const t = estimateTimeline('OLD_RENOVATION', 94.1, 'PREMIUM');
  assert.equal(t.optimisticDays < t.typicalDays, true);
  assert.equal(t.typicalDays < t.bufferedDays, true);
  assert.equal(t.drivers.length > 0, true);
  assert.equal(t.drivers.some((d) => /curing/i.test(d)), true);
});
