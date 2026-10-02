// The simple first-run flow's pure parts: Style × Quality → DesignPreferences,
// which reading questions genuinely stop the customer, and the four customer
// stages derived from the real ones.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { LOOK_QUALITIES, LOOK_STYLES, lookPreferences, readLook } from '../lookPresets.ts';
import { DEFAULT_PREFERENCES, FURNISHING_CAP, normalizePreferences } from '../planToHome.ts';
import { STYLE_CODES } from '../grammar.ts';
import { isNecessary, MAX_QUICK, necessaryQuestions, WEAK } from '../quickQuestions.ts';
import { CUSTOMER_STAGE_OF, CUSTOMER_STAGES, customerStages } from '../customerStages.ts';
import { STAGES } from '../hybrid/contract.ts';

test('every Style × Quality gives a valid, normalised, deterministic DesignPreferences', () => {
  assert.equal(LOOK_STYLES.length, 6);
  assert.equal(LOOK_QUALITIES.length, 3);
  const seen = new Set();
  for (const s of LOOK_STYLES) for (const q of LOOK_QUALITIES) {
    const p = lookPreferences(s, q);
    assert.deepEqual(p, normalizePreferences(p), `${s}/${q} survives normalisation unchanged`);
    assert.deepEqual(p, lookPreferences(s, q), `${s}/${q} is deterministic`);
    assert.ok(STYLE_CODES.includes(p.style), `${s}/${q}: a real style code (${p.style})`);
    assert.ok(p.brief.length > 0 && p.brief.length <= 600, `${s}/${q}: a briefed direction within 600 characters`);
    seen.add(JSON.stringify(p));
  }
  assert.equal(seen.size, 18, 'eighteen distinct directions');
});

test('quality sets how fully rooms are furnished and how rich the materials are; style sets the look', () => {
  for (const s of LOOK_STYLES) {
    const budget = lookPreferences(s, 'SMART_BUDGET'); const high = lookPreferences(s, 'HIGH_QUALITY'); const premium = lookPreferences(s, 'PREMIUM');
    assert.deepEqual([budget.furnishing, high.furnishing, premium.furnishing], ['ESSENTIAL', 'FULL', 'STAGED'], s);
    assert.ok(FURNISHING_CAP[budget.furnishing] < FURNISHING_CAP[high.furnishing] && FURNISHING_CAP[high.furnishing] < FURNISHING_CAP[premium.furnishing], s);
    assert.ok(!['MARBLE', 'STONE'].includes(budget.floor), `${s}: no marble or stone at smart budget (${budget.floor})`);
    assert.ok(!['TILE', 'CONCRETE'].includes(premium.floor), `${s}: no tile or concrete at premium (${premium.floor})`);
    for (const p of [budget, high, premium]) assert.equal(p.style, high.style, `${s}: the style code does not depend on quality`);
    assert.match(budget.brief, /Smart budget/); assert.match(high.brief, /High quality/); assert.match(premium.brief, /Premium/);
  }
  assert.deepEqual(new Set(LOOK_STYLES.map((s) => lookPreferences(s, 'HIGH_QUALITY').style)).size, 6, 'six styles, six style codes');
  assert.equal(lookPreferences('LUXURY', 'HIGH_QUALITY').floor, 'MARBLE');
  assert.equal(lookPreferences('LUXURY', 'SMART_BUDGET').floor, 'TILE');
  assert.equal(lookPreferences('CLASSIC', 'SMART_BUDGET').floor, 'LIGHT_WOOD');
});

test('a saved look is read back only when both halves are real', () => {
  assert.deepEqual(readLook({ style: 'MODERN', quality: 'PREMIUM' }), { style: 'MODERN', quality: 'PREMIUM' });
  for (const bad of [null, {}, { style: 'MODERN' }, { style: 'GOTHIC', quality: 'PREMIUM' }, { style: 'MODERN', quality: 'GOLD' }]) assert.equal(readLook(bad), null);
  assert.equal(DEFAULT_PREFERENCES.furnishing, 'FULL', 'the detailed contract is unchanged');
});

// ── Questions ───────────────────────────────────────────────────────────────

const q = (kind, confidence, extra = {}) => ({ id: `${kind}:x${Math.round(confidence * 100)}`, kind, elementId: 'x', confidence, suggested: 'BEDROOM', ...extra });

test('only weak evidence stops the customer; a confident suggestion goes ahead', () => {
  assert.equal(isNecessary(q('ROOM_TYPE', 0.7)), false, 'a room type HOMATCH is fairly sure of');
  assert.equal(isNecessary(q('ROOM_TYPE', 0.9, { suggested: 'UNKNOWN' })), true, 'a room it could not name');
  assert.equal(isNecessary(q('DIMENSION', 0.25, { suggestedM: [3, 1.5], text: "10'X8'", residualPct: 37.5 })), true, 'a printed size the drawing disagrees with by a third');
  assert.equal(isNecessary(q('DIMENSION', 0, { suggestedM: [0, 0], text: '', residualPct: 100 })), true, 'no printed size at all');
  assert.equal(isNecessary(q('DIMENSION', 0.8, { suggestedM: [3, 3], text: '', residualPct: 10 })), false);
  assert.equal(isNecessary(q('OPENING_TYPE', 0.3, { options: ['DOOR', 'WINDOW', 'OPENING', 'WALL'], suggested: 'DOOR' })), true, 'an opening HOMATCH cannot tell apart');
  assert.equal(isNecessary(q('OPENING_TYPE', WEAK, { options: [], suggested: 'DOOR' })), false, 'at the threshold it goes ahead');
});

test('one at a time: answered ones leave, at most three, in the reader\'s own order', () => {
  const list = [q('DIMENSION', 0.1, { id: 'D:1' }), q('ROOM_TYPE', 0.8, { id: 'R:1' }), q('OPENING_TYPE', 0.2, { id: 'O:1' }), q('OPENING_TYPE', 0.2, { id: 'O:2' }), q('OPENING_TYPE', 0.2, { id: 'O:3' })];
  assert.deepEqual(necessaryQuestions(list, []).map((x) => x.id), ['D:1', 'O:1', 'O:2']);
  assert.equal(necessaryQuestions(list, []).length, MAX_QUICK);
  assert.deepEqual(necessaryQuestions(list, [{ questionId: 'D:1', kind: 'DIMENSION', value: [3, 2] }]).map((x) => x.id), ['O:1', 'O:2', 'O:3']);
});

test('on the real golden readings: v1 asks nothing, v2 asks exactly the porch', async () => {
  const fix = path.join(process.cwd(), 'tests/fixtures/design-studio');
  const { understand } = await import('../../../../supabase/functions/_shared/designStudio/planRead/understand.ts');
  const buf = zlib.gunzipSync(fs.readFileSync(path.join(fix, 'golden-floorplan.pgm.gz')));
  const m = buf.subarray(0, 64).toString('latin1').match(/^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/);
  const gray = { width: Number(m[1]), height: Number(m[2]), data: new Uint8Array(buf.buffer, buf.byteOffset + m[0].length, Number(m[1]) * Number(m[2])) };
  const asked = (file) => {
    const rec = JSON.parse(fs.readFileSync(path.join(fix, file), 'utf8'));
    const out = understand({ doc: rec.rawDoc ?? rec.doc, dimensionStrings: rec.dimensionStrings, gray });
    return { all: out.understanding.questions.length, quick: necessaryQuestions(out.understanding.questions, []).map((x) => x.id) };
  };
  const v1 = asked('golden-floorplan.read-v1.json');
  assert.ok(v1.all >= 1, 'the full review still has its question');
  assert.deepEqual(v1.quick, [], 'nothing stops the customer');
  assert.deepEqual(asked('golden-floorplan.read-v2.json').quick, ['DIMENSION:R9'], 'only the porch the drawing disagrees with');
});

// ── Stages ──────────────────────────────────────────────────────────────────

test('the four customer stages cover every real stage exactly once', () => {
  const covered = CUSTOMER_STAGES.flatMap((c) => CUSTOMER_STAGE_OF[c]);
  assert.deepEqual([...covered].sort(), [...STAGES].sort());
  assert.equal(new Set(covered).size, covered.length);
});

test('a customer stage is only as far as the real stages behind it', () => {
  const all = (st) => Object.fromEntries(STAGES.map((s) => [s, st]));
  assert.deepEqual(customerStages(all('PENDING')), { PLAN: 'PENDING', DESIGN: 'PENDING', BUILD: 'PENDING', FINISH: 'PENDING' });
  assert.deepEqual(customerStages(all('DONE')), { PLAN: 'DONE', DESIGN: 'DONE', BUILD: 'DONE', FINISH: 'DONE' });
  const mid = { ...all('PENDING'), UNDERSTANDING: 'DONE', MEASURING: 'DONE', PLANNING: 'DONE', ARCHITECTURE: 'DONE', FURNISHING: 'RUNNING' };
  assert.deepEqual(customerStages(mid), { PLAN: 'DONE', DESIGN: 'DONE', BUILD: 'RUNNING', FINISH: 'PENDING' });
  const partWay = { ...all('PENDING'), UNDERSTANDING: 'DONE', MEASURING: 'DONE', PLANNING: 'DONE', ARCHITECTURE: 'DONE' };
  assert.equal(customerStages(partWay).BUILD, 'RUNNING', 'part-way is in progress, not pending');
  const noFactory = { ...all('DONE'), ARCHITECTURE: 'SKIPPED', FURNISHING: 'SKIPPED', MATERIALS: 'SKIPPED', LIGHTING: 'SKIPPED' };
  assert.equal(customerStages(noFactory).BUILD, 'SKIPPED');
  assert.equal(customerStages({}).PLAN, 'PENDING', 'missing stages are pending');
});
