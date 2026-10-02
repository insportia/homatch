// Plan reading v2 on the golden plan, from the REAL production ds-read-2
// reading (tests/fixtures/design-studio/golden-floorplan.read-v2.json:
// rawDoc + dimension strings, and `doc` = what production fusion made of it).
//
// The model's reading is close: every opening has a drawn centre, the walls
// are right. Production fusion made it worse in two deterministic ways this
// file pins down:
//   - doors 7 → 15: every unclaimed hole in a wall band became a door
//     (junction ends, the stair side, a neighbour's window);
//   - the wash's short wall (I4, ended by the model at y≈431) was carried
//     down through the bath to the wall below, halving the bath.
// Coordinates here are this fixture's ground truth, read off the drawing;
// production code never sees them.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { understand } from '../planRead/understand.ts';
import { roomSizeM } from '../planRead/solve.ts';

const FIX = path.join(process.cwd(), 'tests/fixtures/design-studio');
const TRUE_SCALE = 0.01793;
const TRUE_DOORS = [
  [361, 115], [419, 115], [361, 357], [419, 357], [329, 395],
  [257, 435], [305, 435], [374, 658], [520, 702],
];
const TRUE_WINDOWS = [[266, 115], [498, 115], [490, 357], [295, 837], [432, 702], [374, 733]];
const FT = 0.3048;

function loadPgm(file) {
  const buf = zlib.gunzipSync(fs.readFileSync(file));
  const m = buf.subarray(0, 64).toString('latin1').match(/^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/);
  const width = Number(m[1]);
  const height = Number(m[2]);
  return { width, height, data: new Uint8Array(buf.buffer, buf.byteOffset + m[0].length, width * height) };
}

const v2 = JSON.parse(fs.readFileSync(path.join(FIX, 'golden-floorplan.read-v2.json'), 'utf8'));
const gray = loadPgm(path.join(FIX, 'golden-floorplan.pgm.gz'));
const fresh = () => JSON.parse(JSON.stringify(v2.rawDoc));
let cached;
const run = () => (cached ??= understand({ doc: fresh(), dimensionStrings: v2.dimensionStrings, gray }));

/** Greedy one-to-one match of found openings to the truth; returns the matched count. */
function matchAll(t, found, truth, m, kind) {
  const used = new Set();
  let matched = 0;
  for (const o of found) {
    let best = -1;
    let bd = Infinity;
    truth.forEach(([x, y], i) => {
      if (used.has(i)) return;
      const d = Math.hypot(o.centerPx.x - x, o.centerPx.y - y);
      if (d < bd) { bd = d; best = i; }
    });
    const ok = bd * m <= 0.35;
    if (ok) { used.add(best); matched += 1; }
    t.diagnostic(`${kind} ${o.id.padEnd(9)} on ${o.wallId.padEnd(6)} ${ok ? 'matches' : 'NO MATCH'} (${(bd * m).toFixed(3)} m)`);
  }
  return matched;
}

test('golden v2 fixture: production fusion really had the two defects (the baseline this file guards)', () => {
  assert.equal(v2.rawDoc.doors.length, 7);
  assert.equal(v2.doc.doors.length, 15, 'production fused 15 doors');
  const i4 = v2.doc.walls.find((w) => w.id === 'I4');
  assert.ok(Math.max(i4.start.y, i4.end.y) > 500, 'production carried I4 down through the bath');
});

test('golden v2: scale within 1% of the truth', (t) => {
  const { doc } = run();
  const err = Math.abs(doc.detectedScale / TRUE_SCALE - 1);
  t.diagnostic(`scale ${doc.detectedScale} (${(err * 100).toFixed(2)}%)`);
  assert.ok(err < 0.01);
});

test('golden v2: 8–10 doors, every one a real opening (one to one, within 0.35 m); 6 windows', (t) => {
  const { doc, fusion } = run();
  const m = doc.detectedScale;
  t.diagnostic(`doors ${doc.doors.length} (raw 7, production 15); dropped ${JSON.stringify(fusion.droppedOpenings)}`);
  assert.ok(doc.doors.length >= 8 && doc.doors.length <= 10, `${doc.doors.length} doors`);
  const dm = matchAll(t, doc.doors, TRUE_DOORS, m, 'DOOR');
  assert.equal(dm, doc.doors.length, 'no phantom doors');
  assert.ok(dm >= 8, `${dm} of ${TRUE_DOORS.length} real doors found`);
  assert.equal(doc.windows.length, 6);
  const wm = matchAll(t, doc.windows, TRUE_WINDOWS, m, 'WINDOW');
  assert.equal(wm, 6, 'every window is a real one');
});

test('golden v2: the wash core is measured as printed (bath 4\'×4\', LET 3\'6"×4\', wash 6\'4"×4\'3")', (t) => {
  const { doc } = run();
  const m = doc.detectedScale;
  const size = (id) => roomSizeM(doc.rooms.find((r) => r.id === id), m);
  const within = (id, a, b, tol) => {
    const s = size(id);
    const [lo, hi] = [Math.min(s.w, s.d), Math.max(s.w, s.d)];
    const [plo, phi] = [Math.min(a, b), Math.max(a, b)];
    t.diagnostic(`${id} ${s.w.toFixed(2)} x ${s.d.toFixed(2)} m vs ${a.toFixed(2)} x ${b.toFixed(2)} m`);
    assert.ok(Math.abs(lo / plo - 1) <= tol && Math.abs(hi / phi - 1) <= tol, `${id} ${s.w.toFixed(2)} x ${s.d.toFixed(2)}`);
  };
  within('R6', 4 * FT, 4 * FT, 0.12); // BATH
  within('R5', 3.5 * FT, 4 * FT, 0.15); // LET.
  within('R4', (6 + 4 / 12) * FT, (4 + 3 / 12) * FT, 0.15); // WASH
  // The wash's short wall stops at the bath; it is not carried through it.
  const i4 = doc.walls.find((w) => w.id === 'I4');
  assert.ok(Math.max(i4.start.y, i4.end.y) < 445, `I4 ends at ${Math.max(i4.start.y, i4.end.y)}`);
});

test('golden v2: no indoor room comes out more than 15% under its printed size; ≤ 6 questions', (t) => {
  const { doc, understanding } = run();
  for (const c of understanding.constraints.checks) {
    if (!c.measuredM || c.valueM.length !== 2) continue;
    const room = doc.rooms.find((r) => r.id === c.elementId);
    t.diagnostic(`${c.elementId} ${c.text}: ${c.measuredM.map((v) => v.toFixed(2)).join(' x ')} m (${c.residualPct}%)${room ? '' : ' [outdoor]'}`);
    // Outdoor spaces follow the reading's footprint, which here stops the porch at the end of the east wall.
    if (!room) continue;
    const [plo, phi] = [...c.valueM].sort((a, b) => a - b);
    const [mlo, mhi] = [...c.measuredM].sort((a, b) => a - b);
    assert.ok(mlo >= 0.85 * plo && mhi >= 0.85 * phi, `${c.elementId} ${c.text} measured ${mlo.toFixed(2)} x ${mhi.toFixed(2)}`);
  }
  t.diagnostic(`questions: ${understanding.questions.map((q) => q.id).join(', ')}`);
  assert.ok(understanding.questions.length <= 6);
});

test('golden v2 without the LET/bath wall: a wall the reading ended short is still not carried through the bath', (t) => {
  // The production failure, isolated: drop I3 so I4's end dangles above the bath.
  const raw = fresh();
  raw.walls = raw.walls.filter((w) => w.id !== 'I3');
  const u = understand({ doc: raw, dimensionStrings: v2.dimensionStrings, gray });
  const i4 = u.doc.walls.find((w) => w.id === 'I4');
  t.diagnostic(`I4 ${JSON.stringify(i4.start)} → ${JSON.stringify(i4.end)}`);
  assert.ok(Math.max(i4.start.y, i4.end.y) < 460, 'I4 is not extended through the bath');
  const bath = roomSizeM(u.doc.rooms.find((r) => r.id === 'R6'), u.doc.detectedScale);
  t.diagnostic(`bath ${bath.w.toFixed(2)} x ${bath.d.toFixed(2)} m`);
  assert.ok(Math.min(bath.w, bath.d) >= 0.85 * 4 * FT, 'the bath keeps its width');
  assert.ok(u.doc.doors.length <= 10, `${u.doc.doors.length} doors`);
});
