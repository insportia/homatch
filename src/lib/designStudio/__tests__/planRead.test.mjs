// The browser re-solves and applies answers with the SAME code the edge
// function fuses with: src/lib/designStudio/planRead/* are byte-identical
// copies of supabase/functions/_shared/designStudio/planRead/*.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyAnswers, parseDimension, PLAN_READ_VERSION, roomSizeM, solvePlan } from '../planRead/index.ts';

const SHARED = path.join(process.cwd(), 'supabase/functions/_shared/designStudio/planRead');
const BROWSER = path.join(process.cwd(), 'src/lib/designStudio/planRead');

test('the browser and the server read plans with byte-identical code', () => {
  const shared = fs.readdirSync(SHARED).filter((f) => f.endsWith('.ts')).sort();
  const browser = fs.readdirSync(BROWSER).filter((f) => f.endsWith('.ts') && f !== 'index.ts').sort();
  assert.deepEqual(browser, shared, 'the same files on both sides');
  for (const file of shared) {
    const a = fs.readFileSync(path.join(SHARED, file), 'utf8').replace(/\r\n/g, '\n');
    const b = fs.readFileSync(path.join(BROWSER, file), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(b, a, file);
  }
});

test('the browser API: parse, measure, re-solve after a confirmed size, apply answers', () => {
  assert.equal(PLAN_READ_VERSION, 'ds-read-2');
  assert.deepEqual(parseDimension('3,20×4,10')?.values, [3.2, 4.1]);
  const room = { id: 'r1', kind: 'LIVING', label: 'LIVING', polygon: [{ x: 0, y: 0 }, { x: 160, y: 0 }, { x: 160, y: 200 }, { x: 0, y: 200 }], statedAreaM2: null, dimensionText: null, confidence: 0.9, state: 'UNVERIFIED' };
  const doc = {
    sourceAssetId: 'k', imageWidth: 300, imageHeight: 300, detectedScale: null, scaleConfidence: 0, ceilingHeight: null, ceilingHeightSource: null,
    walls: [], doors: [], windows: [], rooms: [room], balconies: [], unknownElements: [], warnings: [], extractionConfidence: 0.9,
  };
  const size = roomSizeM(room, 0.02);
  assert.ok(Math.abs(size.w - 3.2) < 0.05 && Math.abs(size.d - 4) < 0.05);
  assert.equal(solvePlan(doc, []), null);
  const answers = [{ questionId: 'DIMENSION:r1', kind: 'DIMENSION', value: [3.2, 4.0] }];
  const next = applyAnswers(doc, answers);
  assert.equal(next.rooms[0].dimensionText, '3.200 x 4.000 m');
  const report = solvePlan(next, [], answers);
  assert.ok(report && Math.abs(report.metresPerPx - 0.02) < 0.0005);
  assert.equal(doc.rooms[0].dimensionText, null, 'pure');
});
