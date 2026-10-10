// THE SELECTED DESIGN AS A SPATIAL DESIGN GRAPH: synthetic evidence (typed here, never a customer's) on the
// eight-room tour fixture — the render's scene map and legend, a design specification, a reference plan — proves
// the graph consumes the render's regions, invents nothing, reads the spec's words per room and per piece, takes
// measured pixels over words, and that the walkthrough built from it is walkable and passes (or honestly fails) the
// fidelity promotion gate.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSpaceModel } from '../space.ts';
import { buildDesignGraph, mapSourceRooms, graphToBuildPlan, applyGraphLook, fidelityOf, fidelityOfUngraphed, resolveMaterial, PROMOTION_RULES } from '../walkthrough/designGraph.ts';
import { regionAppearance } from '../walkthrough/regionAppearance.ts';
import { buildWalkthrough } from '../walkthrough/build.ts';
import { emptyDesignState } from '../designState.ts';
import { tourApartmentScene, testMaterials } from './fixtures.mjs';
import { planTour } from '../tour.ts';
import { buildWalkModel } from '../navigation.ts';

const space = buildSpaceModel(tourApartmentScene());

// The reading's rooms (as a photo reading names them), in reading order.
const sourceRooms = [
  { id: 's1', kind: 'LIVING' }, { id: 's2', kind: 'KITCHEN' }, { id: 's3', kind: 'BATHROOM' }, { id: 's4', kind: 'CORRIDOR' },
  { id: 's5', kind: 'BEDROOM' }, { id: 's6', kind: 'BEDROOM' }, { id: 's7', kind: 'HALL' }, { id: 's8', kind: 'BALCONY' },
];
const sq = (x, y, w = 0.04, h = 0.04) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const el = (kind, room, label, x, y, w, h) => ({ kind, room, label, outline: sq(x, y, w, h), inside: [[x + (w ?? 0.04) / 2, y + (h ?? 0.04) / 2]] });
const sceneMap = [
  el('FLOOR', 's1', 'FLOOR', 0.05, 0.05, 0.3, 0.3), el('WALL', 's1', 'WALL', 0.05, 0.0, 0.3, 0.05),
  el('FLOOR', 's2', 'FLOOR', 0.05, 0.5, 0.3, 0.2), el('FLOOR', 's3', 'FLOOR', 0.4, 0.55, 0.1, 0.2),
  el('OBJECT', 's1', 'ARMCHAIR', 0.1, 0.1), el('OBJECT', 's1', 'ARMCHAIR', 0.2, 0.1), el('OBJECT', 's1', 'TV_UNIT', 0.25, 0.25, 0.08, 0.03),
  el('OBJECT', 's1', 'RUG', 0.12, 0.15, 0.12, 0.08), el('OBJECT', 's1', 'ARTWORK', 0.3, 0.02, 0.03, 0.02),
  el('OBJECT', 's2', 'KITCHEN_CABINETS', 0.06, 0.52, 0.2, 0.04), el('OBJECT', 's2', 'COUNTERTOP', 0.06, 0.51, 0.2, 0.02),
  el('OBJECT', 's3', 'TOILET', 0.42, 0.6), el('OBJECT', 's3', 'VANITY', 0.45, 0.65),
  el('OBJECT', 's5', 'BED', 0.6, 0.1, 0.1, 0.1), el('OBJECT', 's5', 'NIGHTSTAND', 0.58, 0.1), el('OBJECT', 's5', 'LAMP', 0.585, 0.09, 0.02, 0.02),
  el('OBJECT', 's6', 'BED', 0.8, 0.1, 0.1, 0.1), el('OBJECT', 's6', 'WARDROBE', 0.85, 0.25, 0.08, 0.03),
];
let n = 0;
const legend = {
  width: 100, height: 100,
  entries: sceneMap.map((e) => {
    const xs = e.outline.map((p) => p[0]); const ys = e.outline.map((p) => p[1]);
    n += 1;
    const id = e.kind === 'OBJECT' ? `ai:${e.label.toLowerCase()}:${n}` : `ai:${e.kind.toLowerCase()}:${n}`;
    return { id, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], kind: e.kind, color: `#${(0x100000 + n * 7919).toString(16).slice(-6)}`, roomId: e.room, coverage: 0.01 };
  }),
};
const spec = {
  design: {
    palette: [
      { hex: '#f1e9dc', name: 'Chalk warm off-white', role: 'DOMINANT' }, { hex: '#d8c2a5', name: 'Soft sand plaster', role: 'SECONDARY' },
      { hex: '#b88768', name: 'Muted clay', role: 'ACCENT' }, { hex: '#4b3022', name: 'Smoked natural oak', role: 'WOOD' },
      { hex: '#c7b59b', name: 'Warm limestone', role: 'STONE' }, { hex: '#b08a55', name: 'Aged brushed brass', role: 'METAL' },
      { hex: '#cbbba3', name: 'Oatmeal linen', role: 'TEXTILE' }, { hex: '#4d5842', name: 'Deep olive green', role: 'ACCENT' },
      { hex: '#20201d', name: 'Existing charcoal black frames', role: 'METAL' },
    ],
    flooring: 'Make the floors a continuous dark smoked-oak herringbone in s1, s4, s5 and s6. Retain stone flooring in s3.',
    wallFinishes: 'Apply warm chalk mineral plaster to the main walls, with subtle sand feature planes behind the television wall or bed headboards.',
    cabinetry: 'Use custom dark smoked-oak cabinetry with fine-frame fronts and aged brass pulls.',
    wetRooms: 'Treat s3 as a premium bathroom: warm limestone ceramic tile, honed stone vanity, dark oak vanity fronts.',
    furnishing: [
      'In s1, place a tailored sofa in warm oatmeal linen facing the television wall, with two deep olive occasional chairs angled toward it.',
      'In s6, retain the source bed, using a quieter clay-and-oat palette.',
    ],
    lighting: { timeOfDay: 'EVENING', temperature: 'WARM' },
  },
};
const source = { renderId: 'render-1', sceneMapJobId: 'map-1', specJobId: 'spec-1' };
const graphOf = (over = {}) => buildDesignGraph({ space, spec, sceneMap, legend, sourceRooms, scenePlan: null, source, ...over });

test('the reading\'s rooms map onto the space by kind, in order (corridor ↔ hall aliases included)', () => {
  const m = mapSourceRooms(sourceRooms, space);
  assert.deepEqual(m, { s1: 'r-living', s2: 'r-kitchen', s3: 'r-bath', s4: 'r-corr', s5: 'r-bed1', s6: 'r-bed2', s7: 'r-entry', s8: 'r-balcony' });
});

test('every region of the render is consumed; nothing the render does not show is in the graph', () => {
  const g = graphOf();
  assert.equal(g.regions.filter((r) => !r.consumedBy).length, 0, JSON.stringify(g.regions.filter((r) => !r.consumedBy)));
  const objs = g.rooms.flatMap((r) => r.objects);
  assert.equal(objs.length, sceneMap.filter((e) => e.kind === 'OBJECT').length);
  assert.ok(!objs.some((o) => o.label === 'SOFA'), 'the spec mentions a sofa the render does not show: not invented');
  // A countertop is its kitchen's worktop; a bedside lamp sits on its nightstand.
  assert.ok(objs.find((o) => o.label === 'KITCHEN_CABINETS').absorbs.some((id) => id.includes('countertop')));
  assert.ok(objs.find((o) => o.label === 'NIGHTSTAND').absorbs.some((id) => id.includes('lamp')));
  // Something HOMATCH cannot build is reported, never swapped for another piece.
  assert.equal(objs.find((o) => o.label === 'ARTWORK').unresolved, 'NO_ARTWORK_GEOMETRY');
});

test('the spec is read per room and per piece: floors, wet room, feature plane, colours by clause', () => {
  const g = graphOf();
  const room = (id) => g.rooms.find((r) => r.roomId === id);
  assert.equal(room('r-living').floor.klass, 'WOOD_HERRINGBONE');
  assert.equal(room('r-living').floor.color, '#4b3022');
  assert.equal(room('r-bath').floor.klass, 'STONE_TILE');
  assert.equal(room('r-bath').walls.klass, 'CERAMIC_TILE');
  assert.equal(room('r-living').walls.klass, 'PLASTER');
  assert.equal(room('r-kitchen').floor.klass, 'WOOD_HERRINGBONE', 'unnamed rooms follow the home\'s continuous floor');
  assert.ok(room('r-kitchen').floor.evidence.includes('CONTINUITY'));
  assert.deepEqual(room('r-living').feature?.color, '#d8c2a5');
  const objs = g.rooms.flatMap((r) => r.objects);
  // "a sofa in oatmeal linen …, with two deep olive occasional chairs": the chairs are olive, not oatmeal.
  assert.equal(objs.find((o) => o.label === 'ARMCHAIR').colors.main, '#4d5842');
  assert.equal(objs.find((o) => o.label === 'ARMCHAIR').form, 'CLUB');
  assert.equal(objs.find((o) => o.label === 'KITCHEN_CABINETS').form, 'SHAKER');
  assert.deepEqual(objs.find((o) => o.label === 'KITCHEN_CABINETS').colors, { main: '#4b3022', second: '#c7b59b' });
  // s6's bed takes its own room's words (clay), not the home's textile.
  assert.equal(objs.find((o) => o.roomId === 'r-bed2' && o.label === 'BED').colors.main, '#b88768');
  assert.equal(g.frames, '#20201d');
  assert.deepEqual(g.lighting, { timeOfDay: 'EVENING', temperature: 'WARM' });
});

test('measured pixels win over words, and are recorded as evidence', () => {
  const chair = legend.entries.find((e) => e.id.startsWith('ai:armchair'));
  const floor = legend.entries.find((e) => e.kind === 'FLOOR' && e.roomId === 's1');
  const g = graphOf({ appearance: { [chair.id]: { color: '#3c4a33', second: '#2b1d14', spread: 0.05, pixels: 200 }, [floor.id]: { color: '#3a2618', second: null, spread: 0.1, pixels: 900 } } });
  const o = g.rooms.flatMap((r) => r.objects).find((x) => x.id === chair.id);
  assert.deepEqual(o.colors, { main: '#3c4a33', second: '#2b1d14' });
  assert.ok(o.evidence.includes('PIXELS'));
  const living = g.rooms.find((r) => r.roomId === 'r-living');
  assert.equal(living.floor.color, '#3a2618');
  assert.ok(living.floor.evidence.includes('PIXELS'));
});

test('region appearance: each region\'s own pixels, edges eroded, shadows trimmed, a second colour found', () => {
  // A 60×40 render: left half olive (with a 30% band of dark wood), right half chalk; the id image says which is which.
  const W = 60; const H = 40;
  const render = { width: W, height: H, data: new Uint8Array(W * H * 4) };
  const ids = { width: W, height: H, data: new Uint8Array(W * H * 4) };
  const put = (img, x, y, c) => { const k = (y * W + x) * 4; img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255; };
  const L = [{ id: 'ai:armchair:1', box: [0, 0, 0.5, 1], kind: 'OBJECT', color: '#010203', roomId: 's1', coverage: 0.5 }, { id: 'ai:wall:2', box: [0.5, 0, 1, 1], kind: 'WALL', color: '#040506', roomId: 's1', coverage: 0.5 }];
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const left = x < W / 2;
    put(ids, x, y, left ? [1, 2, 3] : [4, 5, 6]);
    // A bright seam on the boundary column (anti-aliasing) must not leak into either region.
    if (x === W / 2 || x === W / 2 - 1) { put(render, x, y, [255, 255, 255]); continue; }
    put(render, x, y, left ? (y < H * 0.3 ? [75, 48, 34] : [77, 88, 66]) : [241, 233, 220]);
  }
  const look = regionAppearance(render, ids, L, { step: 1, balance: 0 });
  assert.equal(look['ai:armchair:1'].color, '#4d5842');
  assert.equal(look['ai:armchair:1'].second, '#4b3022');
  assert.equal(look['ai:wall:2'].color, '#f1e9dc');
  assert.equal(look['ai:wall:2'].second, null, 'a surface is one colour');
});

test('materials resolve to clean catalogue materials of the class (never a worn, roof or cracked one)', () => {
  const mats = [...testMaterials().values()];
  const add = (code, name, category, baseColor) => ({ id: code, code, name, category, appliesTo: [], styleTags: [], colorFamily: null, pbr: { baseColor, roughness: 0.6, metalness: 0 }, thumbnailKey: null, provenance: 'X', isPlaceholder: false, active: true });
  mats.push(add('m-herr', 'Herringbone Parquet', 'WOOD', '#ffffff'), add('m-roof', 'Weathered Roof Tiles', 'TILE', '#c7b59b'), add('m-lime', 'Beige Interior Tiles', 'TILE', '#d9cbb5'));
  const g = graphOf();
  const living = g.rooms.find((r) => r.roomId === 'r-living');
  const bath = g.rooms.find((r) => r.roomId === 'r-bath');
  assert.equal(resolveMaterial(living.floor, 'FLOOR', mats)?.code, 'm-herr');
  assert.equal(resolveMaterial(bath.walls, 'WALL', mats)?.code, 'm-lime');
});

const assets = () => {
  // The fixture's development catalogue, plus the pieces this graph builds (dimensions as the dev catalogue's).
  const a = (code, kind, w, d, h, sub = null) => [code, { id: code, code, name: code, category: kind, subcategory: sub, roomKinds: [], styleTags: [], colorTags: [], materialTags: [], widthM: w, depthM: d, heightM: h, placement: 'FLOOR', anchor: 'WALL', clearanceM: 0.3, procedural: { kind }, modelKey: null, lods: [], triangles: null, textureBytes: null, thumbnailKey: null, materialSlots: [{ id: 'body', defaultColor: '#cccccc' }], variants: [], dominantColors: [], provenance: 'HOMATCH_DEV_PLACEHOLDER', isPlaceholder: true, active: true }];
  return new Map([
    a('dev/armchair', 'ARMCHAIR', 0.85, 0.85, 0.85), a('dev/tv-unit', 'TV_UNIT', 1.8, 0.45, 0.5), a('dev/rug-large', 'RUG', 2.4, 1.7, 0.01),
    a('dev/kitchen-run', 'KITCHEN_RUN', 2.4, 0.62, 0.9), a('dev/toilet', 'TOILET', 0.4, 0.65, 0.8), a('dev/vanity', 'VANITY', 0.8, 0.48, 0.85),
    a('dev/bed-double', 'BED', 1.6, 2.05, 0.95), a('dev/bedside', 'DRESSER', 0.45, 0.4, 0.55, 'BEDSIDE'), a('dev/wardrobe-3', 'WARDROBE', 1.8, 0.6, 2.2),
  ]);
};

function assemble(graph) {
  const cat = assets();
  const mats = [...testMaterials().values()];
  const plan = graphToBuildPlan(graph, space, mats, cat);
  const { state, report } = buildWalkthrough({ space, base: emptyDesignState(), plan, assets: cat, materialsByCode: new Map(mats.map((m) => [m.code, m])), materialsById: new Map(mats.map((m) => [m.id, m])), idPrefix: 'g' });
  return { state: applyGraphLook(graph, space, state, report, cat), report, cat };
}

test('the walkthrough built from the graph: every piece the render shows, in its design form, walkable, nothing invented', () => {
  const graph = graphOf();
  const { state, report, cat } = assemble(graph);
  // Only graph pieces; each carries its graph form and colours.
  assert.ok(report.items.every((i) => i.refKey), 'every item comes from the graph');
  for (const o of state.objects) {
    const ref = report.items.find((i) => i.instanceId === o.instanceId).refKey;
    const g = graph.rooms.flatMap((r) => r.objects).find((x) => x.id === ref);
    if (g.form) assert.equal(o.shape?.form, g.form, `${ref} form`);
    if (g.colors.main) assert.equal(o.colorOverride, g.colors.main, `${ref} colour`);
    assert.equal(o.generated, undefined, 'a designed piece is never swapped for a generic model');
  }
  // The feature plane behind the television wall, the floors' colour kept with their material, the frames.
  assert.ok(Object.entries(state.surfaces).some(([id, s]) => id.startsWith('wall:') && id.endsWith(':r-living') && s.color === '#d8c2a5'));
  assert.equal(state.surfaces['floor:r-living'].color, '#4b3022');
  assert.equal(state.frames, '#20201d');
  // Walkable: every room reachable from the entrance with the furniture in place.
  const plan = planTour(space, buildWalkModel(space, state.objects, cat));
  assert.equal(plan.reachable.size, space.rooms.length);
  const p = fidelityOf(graph, state, report, report.gate?.ok !== false);
  assert.equal(p.metrics.inventedPieces, 0);
  assert.equal(p.metrics.genericRatio, 0);
  assert.equal(p.metrics.regionConsumption, 1);
  assert.equal(p.metrics.materialCoverage, 1);
  assert.equal(p.metrics.importantRecall, 1, JSON.stringify(p.metrics.unresolvedImportant));
  assert.ok(p.promoted, JSON.stringify(p.reasons));
});

test('the promotion gate fails honestly: a generic build, missing anchors, unused regions', () => {
  const graph = graphOf();
  // A walkthrough built WITHOUT the graph: every piece generic.
  const generic = { ...emptyDesignState(), objects: [{ instanceId: 'x', assetId: 'dev/armchair', roomId: 'r-living', position: { x: 1, y: 0, z: 9 }, rotationY: 0, materialVariant: null, colorOverride: null, locked: false }] };
  assert.equal(fidelityOfUngraphed(graph, generic).genericRatio, 1);
  // Anchors the graph needed but the catalogue cannot build: recall falls under the rule, promotion refused.
  const cat = assets(); cat.delete('dev/bed-double'); cat.delete('dev/wardrobe-3'); cat.delete('dev/kitchen-run');
  const mats = [...testMaterials().values()];
  const plan = graphToBuildPlan(graph, space, mats, cat);
  const { state, report } = buildWalkthrough({ space, base: emptyDesignState(), plan, assets: cat, materialsByCode: new Map(mats.map((m) => [m.code, m])), materialsById: new Map(mats.map((m) => [m.id, m])), idPrefix: 'h' });
  const p = fidelityOf(graph, applyGraphLook(graph, space, state, report, cat), report, true);
  assert.ok(p.metrics.importantRecall < PROMOTION_RULES.minImportantRecall);
  assert.ok(!p.promoted && p.reasons.includes('IMPORTANT_OBJECTS_MISSING'));
  // Regions nobody consumed (a legend entry for a room the space does not have).
  const extra = { ...legend, entries: [...legend.entries, { id: 'ai:floor:99', box: [0, 0, 0.1, 0.1], kind: 'FLOOR', color: '#abcdef', roomId: 's99', coverage: 0.2 }, { id: 'ai:wall:98', box: [0, 0, 0.1, 0.1], kind: 'WALL', color: '#abcdee', roomId: 's99', coverage: 0.2 }, { id: 'ai:wall:97', box: [0, 0, 0.1, 0.1], kind: 'WALL', color: '#abcded', roomId: 's99', coverage: 0.2 }, { id: 'ai:wall:96', box: [0, 0, 0.1, 0.1], kind: 'WALL', color: '#abcdec', roomId: 's99', coverage: 0.2 }, { id: 'ai:wall:95', box: [0, 0, 0.1, 0.1], kind: 'WALL', color: '#abcdeb', roomId: 's99', coverage: 0.2 }] };
  const g2 = graphOf({ legend: extra });
  const a2 = assemble(g2);
  const p2 = fidelityOf(g2, a2.state, a2.report, true);
  assert.ok(p2.metrics.regionConsumption < 1);
  assert.ok(p2.reasons.includes('RENDER_REGIONS_UNUSED'), JSON.stringify(p2.metrics));
});
