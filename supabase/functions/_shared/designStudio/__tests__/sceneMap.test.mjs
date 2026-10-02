// The AI edit map: OpenAI's traced outlines refined against the picture's own
// pixels, in the exact id-picture + legend contract the stable edit pipeline
// (PR #65) reads — checked here on a synthetic interior with exact ground truth.

import test from 'node:test';
import assert from 'node:assert/strict';
import { aiLabelOf, buildEditMap, idColor, isBoxOutline, rasterPolygon, validateScene } from '../sceneMap.ts';
import { maskFromIds, resizeMask } from '../renderCheck.ts';
import { validateLegend } from '../renderPrompt.ts';

const W = 900; const H = 600;

/** A deterministic picture: wall, floor, an L-shaped sofa with arms and back, a round lamp on a thin stem, a rug. */
function scene() {
  const data = new Uint8Array(W * H * 3);
  const truth = { sofa: new Uint8Array(W * H), lamp: new Uint8Array(W * H), rug: new Uint8Array(W * H), floor: new Uint8Array(W * H), wall: new Uint8Array(W * H) };
  let seed = 7; const noise = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed % 13) - 6; };
  const inSofa = (x, y) => (x >= 250 && x < 650 && y >= 300 && y < 400) || (x >= 250 && x < 650 && y >= 250 && y < 300 && x < 600) // seat + back
    || (x >= 230 && x < 270 && y >= 270 && y < 410) || (x >= 630 && x < 670 && y >= 290 && y < 410); // arms
  const inLamp = (x, y) => ((x - 760) ** 2 + (y - 200) ** 2 < 32 ** 2) || (x >= 756 && x < 764 && y >= 230 && y < 420);
  const inRug = (x, y) => { const t = (y - 420) / 120; return y >= 420 && y < 540 && x >= 200 - t * 60 && x < 700 + t * 60; };
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const i = y * W + x; let c;
    if (inLamp(x, y)) { c = [236, 196, 120]; truth.lamp[i] = 1; }
    else if (inSofa(x, y)) { c = [88, 112, 96]; truth.sofa[i] = 1; }
    else if (inRug(x, y)) { c = [170, 150, 210]; truth.rug[i] = 1; }
    else if (y >= 230) { c = [196, 168, 132]; truth.floor[i] = 1; }
    else { c = [236, 230, 220]; truth.wall[i] = 1; }
    data[i * 3] = c[0] + noise(); data[i * 3 + 1] = c[1] + noise(); data[i * 3 + 2] = c[2] + noise();
  }
  return { img: { width: W, height: H, data, channels: 3 }, truth };
}

/** An outline the way a vision model gives it: roughly along the edge, a little off. */
const n = (pts) => pts.map(([x, y], k) => [Math.min(1, Math.max(0, (x + ((k % 3) - 1) * 6) / W)), Math.min(1, Math.max(0, (y + ((k % 2) * 2 - 1) * 5) / H))]);
const SOFA_OUTLINE = n([[232, 268], [270, 270], [270, 250], [600, 250], [600, 290], [630, 290], [668, 292], [668, 408], [232, 408]]);
const LAMP_OUTLINE = n([[728, 196], [736, 176], [760, 168], [784, 176], [792, 200], [784, 224], [764, 232], [764, 418], [756, 418], [756, 232], [736, 224]]);
const RUG_OUTLINE = n([[200, 422], [700, 422], [760, 538], [140, 538]]);
const elements = [
  { label: 'WALL', kind: 'WALL', room: 'R1', outline: [[0, 0], [1, 0], [1, 0.383], [0, 0.383]], inside: [[0.1, 0.1]] },
  { label: 'FLOOR', kind: 'FLOOR', room: 'R1', outline: [[0, 0.383], [1, 0.383], [1, 1], [0, 1]], inside: [[0.05, 0.95]] },
  { label: 'RUG', kind: 'OBJECT', room: 'R1', outline: RUG_OUTLINE, inside: [[450 / W, 480 / H]] },
  { label: 'SOFA', kind: 'OBJECT', room: 'R1', outline: SOFA_OUTLINE, inside: [[450 / W, 350 / H], [300 / W, 330 / H]] },
  { label: 'LAMP', kind: 'OBJECT', room: 'R1', outline: LAMP_OUTLINE, inside: [[760 / W, 200 / H]] },
];

/** What the edit pipeline would use as the edit mask for a legend entry (its own functions). */
function editMaskOf(map, id, grow = 2) {
  const entry = map.legend.entries.find((e) => e.id === id);
  const raw = maskFromIds(map.ids, entry.color, grow);
  return resizeMask(raw, W, H);
}
const iou = (a, b) => { let i = 0; let u = 0; for (let k = 0; k < a.length; k += 1) { if (a[k] && b[k]) i += 1; if (a[k] || b[k]) u += 1; } return i / u; };
const insideShare = (mask, truth) => { let inT = 0; let all = 0; for (let k = 0; k < mask.length; k += 1) if (mask[k]) { all += 1; if (truth[k]) inT += 1; } return inT / all; };

test('the edit map follows each object\'s own shape, not its box', () => {
  const { img, truth } = scene();
  const map = buildEditMap(img, elements, new Set(['R1']));
  const ids = Object.fromEntries(map.accepted.map((a) => [a.label, a.id]));
  assert.ok(ids.SOFA && ids.LAMP && ids.RUG && ids.WALL && ids.FLOOR, JSON.stringify(map.accepted));
  // The mask itself (grow 0), and the mask the edit pipeline actually uses (its own 2-pixel grow, which widens a thin stem most).
  for (const [label, t, own, used] of [['SOFA', truth.sofa, 0.9, 0.85], ['LAMP', truth.lamp, 0.8, 0.7], ['RUG', truth.rug, 0.9, 0.85]]) {
    const method = map.accepted.find((a) => a.label === label).method;
    const exact = iou(editMaskOf(map, ids[label], 0), t);
    const grown = iou(editMaskOf(map, ids[label]), t);
    console.log(`  ${label}: IoU ${exact.toFixed(3)} (mask) / ${grown.toFixed(3)} (as edited) — ${method}`);
    assert.ok(exact >= own, `${label}: the mask's IoU with the true silhouette ${exact.toFixed(3)}`);
    assert.ok(grown >= used, `${label}: the edit mask's IoU ${grown.toFixed(3)}`);
  }
  // The lamp (a shade on a thin stem) is where a box would be most wrong: its bounding box is mostly wall.
  const lampEntry = map.legend.entries.find((x) => x.id === ids.LAMP);
  const lampBox = (lampEntry.box[2] - lampEntry.box[0]) * W * (lampEntry.box[3] - lampEntry.box[1]) * H;
  let lampPx = 0; for (const v of editMaskOf(map, ids.LAMP)) lampPx += v;
  assert.ok(lampPx < lampBox * 0.6, `the lamp mask is not its rectangle (${lampPx} of ${Math.round(lampBox)})`);
  // The lamp's thin stem survives (a box would swallow the wall around it).
  assert.ok(insideShare(editMaskOf(map, ids.LAMP), truth.lamp) >= 0.7, 'the lamp mask stays on the lamp');
  assert.equal(map.accepted.find((a) => a.label === 'SOFA').method, 'REFINED', 'the sofa outline was refined on the pixels');
});

test('objects sit over surfaces: the sofa is never painted as floor, the floor never steals the sofa', () => {
  const { img, truth } = scene();
  const map = buildEditMap(img, elements, new Set(['R1']));
  const floor = editMaskOf(map, map.accepted.find((a) => a.label === 'FLOOR').id);
  let floorOnSofa = 0; let sofa = 0;
  for (let k = 0; k < floor.length; k += 1) if (truth.sofa[k]) { sofa += 1; if (floor[k]) floorOnSofa += 1; }
  assert.ok(floorOnSofa / sofa < 0.1, `floor mask covers ${(100 * floorOnSofa / sofa).toFixed(1)}% of the sofa`);
});

test('the legend and the id picture are exactly the contract the edit pipeline reads', () => {
  const { img } = scene();
  const map = buildEditMap(img, elements, new Set(['R1']));
  const legend = validateLegend(JSON.parse(JSON.stringify(map.legend)));
  assert.ok(legend, 'validateLegend accepts it');
  assert.equal(legend.entries.length, map.legend.entries.length, 'no entry is dropped by the validator');
  assert.equal(new Set(legend.entries.map((e) => e.color)).size, legend.entries.length, 'one colour per target');
  assert.ok(legend.entries.every((e) => e.color !== '#000000'), 'black means nothing editable');
  assert.ok(legend.entries.every((e) => /^ai:[a-z_]+:\d+$/.test(e.id) && e.id.length <= 80), 'ids pass the edit route');
  assert.ok(legend.entries.every((e) => e.roomId === 'R1'));
  assert.deepEqual([map.ids.width, map.ids.height], [legend.width, legend.height]);
  assert.ok(map.ids.width <= 768 && map.ids.height <= 768, 'a working-size id picture (the pipeline resizes the mask)');
  for (const e of legend.entries) assert.ok(maskFromIds(map.ids, e.color, 0).pixels > 0, `${e.id} is in the id picture`);
  assert.equal(aiLabelOf('ai:sofa:1'), 'SOFA');
  assert.equal(aiLabelOf('ai:kitchen_cabinets:2'), 'KITCHEN_CABINETS');
  assert.equal(aiLabelOf('obj-12'), null);
});

test('a bare bounding box the pixels do not confirm is dropped, never shipped as a rectangular edit', () => {
  const { img } = scene();
  // A box around the lamp: mostly wall; the lamp fills too little of it to confirm it.
  const box = { label: 'LAMP', kind: 'OBJECT', room: 'R1', outline: [[690 / W, 150 / H], [830 / W, 150 / H], [830 / W, 430 / H], [690 / W, 430 / H]], inside: [[700 / W, 400 / H]] };
  assert.ok(isBoxOutline(box.outline));
  const map = buildEditMap(img, [elements[0], elements[1], box], new Set(['R1']));
  const lamp = map.accepted.find((a) => a.label === 'LAMP');
  if (lamp) {
    // If the pixels did confirm something, it is pixel-shaped — never the box.
    const e = map.legend.entries.find((x) => x.id === lamp.id);
    const boxArea = (e.box[2] - e.box[0]) * (e.box[3] - e.box[1]) * map.ids.width * map.ids.height;
    assert.equal(lamp.method, 'REFINED');
    assert.ok(lamp.pixels < boxArea * 0.9);
  } else {
    assert.ok(map.rejected.some((r) => r.label === 'LAMP' && r.reason === 'BOX_OUTLINE'), JSON.stringify(map.rejected));
  }
  const loose = { ...box, inside: [[760 / W, 300 / H]] }; // on the stem: the stem is too thin to grow into a box
  const map2 = buildEditMap(img, [loose], new Set(['R1']));
  for (const a of map2.accepted) assert.notEqual(a.method, 'OUTLINE', 'a box outline is never the mask');
});

test('the scene answer is bounded and checked', () => {
  const raw = { elements: [
    { label: 'SOFA', kind: 'OBJECT', room: 'R1', outline: [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]], inside: [[0.15, 0.15]] },
    { label: 'DRAGON', kind: 'OBJECT', room: '', outline: [[0, 0], [1, 0], [1, 1]], inside: [] },
    { label: 'RUG', kind: 'OBJECT', room: '', outline: [[0.1, 0.1], [0.2, 0.2]], inside: [] },
    { label: 'LAMP', kind: 'OBJECT', room: '', outline: [[0.1, 0.1], [5, 0.2], [0.2, 0.3], [0.3, 0.3]], inside: [] },
  ] };
  const els = validateScene(raw);
  assert.deepEqual(els.map((e) => e.label), ['SOFA', 'LAMP'], 'unknown labels and too-short outlines are dropped');
  assert.equal(els[1].outline.length, 3, 'points outside the picture are dropped');
  assert.deepEqual(validateScene(null), []);
  assert.equal(validateScene({ elements: Array.from({ length: 80 }, () => raw.elements[0]) }).length, 48);
});

test('rasterising and colours are deterministic', () => {
  const tri = rasterPolygon([[0, 0], [1, 0], [0, 1]], 10, 10);
  let n = 0; for (const v of tri) n += v;
  assert.ok(n >= 40 && n <= 60, String(n));
  const colours = Array.from({ length: 200 }, (_, i) => idColor(i));
  assert.equal(new Set(colours).size, 200);
  assert.ok(colours.every((c) => /^#[0-9a-f]{6}$/.test(c) && c !== '#000000'));
});
