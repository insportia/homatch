// The simple first-run flow's pure parts: Style × Quality → DesignPreferences,
// which reading questions genuinely stop the customer, and the four customer
// stages derived from the real ones.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { LOOK_QUALITIES, LOOK_STYLES, lookPreferences, readLook, isPresetBrief, lookWords } from '../lookPresets.ts';
import { DEFAULT_PREFERENCES, FURNISHING_CAP, normalizePreferences } from '../planToHome.ts';
import { STYLE_CODES } from '../grammar.ts';
import { isCritical, isNecessary, MAX_QUICK, necessaryQuestions, WEAK } from '../quickQuestions.ts';
import { MAX_QUESTIONS } from '../planRead/questions.ts';
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
    // The look's words are HOMATCH's, read by the server (lookWords); the customer's brief stays theirs (empty here).
    assert.equal(p.brief, '', `${s}/${q}: no preset words in the customer's brief`);
    const w = lookWords(s, q);
    assert.ok(w && w.length > 0 && w.length <= 600 && isPresetBrief(w), `${s}/${q}: HOMATCH's own words within 600 characters`);
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
    assert.match(lookWords('MODERN', 'SMART_BUDGET'), /Smart budget/); assert.match(lookWords('MODERN', 'HIGH_QUALITY'), /High quality/); assert.match(lookWords('MODERN', 'PREMIUM'), /Premium/);
    assert.equal(isPresetBrief('warm modern, light oak, no marble'), false, 'what a customer writes is never mistaken for preset words');
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
  // Changed premise (PR #68 audit): an opening question is architecture-critical, so the threshold does not apply to it.
  assert.equal(isNecessary(q('OPENING_TYPE', WEAK, { options: [], suggested: 'DOOR' })), true, 'an opening the reader asked about is asked, whatever its confidence');
  assert.equal(isNecessary(q('ROOM_TYPE', WEAK)), false, 'a room name at the threshold goes ahead');
});

test('one at a time: answered ones leave; low-impact questions stop at three; critical ones are never capped', () => {
  // A weak room size and three uncertain openings: the openings are all asked, the size goes ahead on its suggestion.
  const list = [q('DIMENSION', 0.1, { id: 'D:1' }), q('ROOM_TYPE', 0.8, { id: 'R:1' }), q('OPENING_TYPE', 0.2, { id: 'O:1' }), q('OPENING_TYPE', 0.2, { id: 'O:2' }), q('OPENING_TYPE', 0.2, { id: 'O:3' })];
  assert.deepEqual(necessaryQuestions(list, []).map((x) => x.id), ['O:1', 'O:2', 'O:3']);
  assert.deepEqual(necessaryQuestions(list, [{ questionId: 'O:1', kind: 'OPENING_TYPE', value: 'DOOR' }]).map((x) => x.id), ['O:2', 'O:3'], 'answering never brings a capped question back');
  // Low-impact only: still at most three.
  const low = [1, 2, 3, 4].map((i) => q('ROOM_TYPE', 0.2, { id: `R:${i}`, suggested: 'BEDROOM' }));
  assert.deepEqual(necessaryQuestions(low, []).map((x) => x.id), ['R:1', 'R:2', 'R:3']);
  assert.equal(necessaryQuestions(low, []).length, MAX_QUICK);
});

// ── Architecture-critical questions (PR #68 audit) ──────────────────────────
// Each in the confidence band the first rule skipped (>= 0.4): the reader asked it, so the simple flow asks it.

const critical = {
  door: q('OPENING_TYPE', 0.6, { id: 'OPENING_TYPE:D3', elementId: 'D3', options: ['DOOR', 'WINDOW', 'OPENING', 'WALL'], suggested: 'DOOR' }),
  wall: q('IS_WALL', 0.55, { id: 'IS_WALL:W12', elementId: 'W12', suggested: true }),
  outdoor: q('OUTDOOR', 0.8, { id: 'OUTDOOR:R7', elementId: 'R7', suggested: true }),
  stairs: q('STAIRS', 0.5, { id: 'STAIRS:S1', elementId: 'S1', suggested: true }),
  overall: q('DIMENSION', 0.6, { id: 'DIMENSION:OVERALL_W', elementId: 'OVERALL_W', text: '12.4 m', suggestedM: 10.2, residualPct: 20 }),
  overallD: q('DIMENSION', 0.7, { id: 'DIMENSION:OVERALL_D', elementId: 'OVERALL_D', text: '9.1 m', suggestedM: 8.2, residualPct: 15 }),
};

for (const [name, question] of Object.entries(critical)) {
  test(`architecture-critical: an uncertain ${name} question is asked at confidence ${question.confidence}`, () => {
    assert.ok(question.confidence >= WEAK, 'in the band the first rule skipped');
    assert.equal(isCritical(question), true);
    assert.deepEqual(necessaryQuestions([question], []).map((x) => x.id), [question.id]);
  });
}

test('low-impact uncertainty stays quiet: a fairly sure room name, an ordinary room size', () => {
  const list = [q('ROOM_TYPE', 0.6, { id: 'ROOM_TYPE:R2', elementId: 'R2' }), q('DIMENSION', 0.6, { id: 'DIMENSION:R3', elementId: 'R3', text: '3x4', suggestedM: [3, 4], residualPct: 20 })];
  for (const x of list) assert.equal(isCritical(x), false, x.id);
  assert.deepEqual(necessaryQuestions(list, []), []);
});

test('critical questions survive the cap and keep the reader\'s order; low-impact ones fill only what is left', () => {
  const list = [critical.overall, q('ROOM_TYPE', 0.2, { id: 'ROOM_TYPE:R1', elementId: 'R1' }), critical.door, critical.wall, critical.stairs, q('ROOM_TYPE', 0.1, { id: 'ROOM_TYPE:R9', elementId: 'R9' })];
  assert.deepEqual(necessaryQuestions(list, []).map((x) => x.id), ['DIMENSION:OVERALL_W', 'OPENING_TYPE:D3', 'IS_WALL:W12', 'STAIRS:S1']);
  // One critical, two weak room names: three in all, the reader's order.
  const mixed = [q('ROOM_TYPE', 0.2, { id: 'ROOM_TYPE:A', elementId: 'A' }), critical.door, q('ROOM_TYPE', 0.2, { id: 'ROOM_TYPE:B', elementId: 'B' }), q('ROOM_TYPE', 0.2, { id: 'ROOM_TYPE:C', elementId: 'C' })];
  assert.deepEqual(necessaryQuestions(mixed, []).map((x) => x.id), ['ROOM_TYPE:A', 'OPENING_TYPE:D3', 'ROOM_TYPE:B']);
  // Never more than the reader's own maximum.
  const many = Array.from({ length: 9 }, (_, i) => q('IS_WALL', 0.5, { id: `IS_WALL:W${i}`, elementId: `W${i}`, suggested: true }));
  assert.equal(necessaryQuestions(many, []).length, MAX_QUESTIONS);
});

test('a reload asks the same next question; an answered one never returns; the last answer leaves nothing to ask', () => {
  const list = [critical.door, critical.wall];
  const first = necessaryQuestions(list, []);
  assert.deepEqual(first.map((x) => x.id), ['OPENING_TYPE:D3', 'IS_WALL:W12']);
  const afterOne = [{ questionId: 'OPENING_TYPE:D3', kind: 'OPENING_TYPE', value: 'DOOR' }];
  assert.deepEqual(necessaryQuestions(list, afterOne).map((x) => x.id), ['IS_WALL:W12'], 'after a reload: the next one, not the answered one');
  assert.deepEqual(necessaryQuestions(list, afterOne), necessaryQuestions(structuredClone(list), structuredClone(afterOne)), 'decided from the saved reading and answers alone');
  assert.deepEqual(necessaryQuestions(list, [...afterOne, { questionId: 'IS_WALL:W12', kind: 'IS_WALL', value: true }]), [], 'the last answer: on to Style');
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
