// UNDERSTANDING THE CUSTOMER'S PHOTOS — one project, nothing invented.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPhotoAnswers, openPhotoQuestions, PHOTO_SCHEMA, photoEvidence, photoOfRoom, photoReadRequest, validatePhotoReading,
} from '../photoRead.ts';
import { directionFrom, imageInstruction, modeContextProblem, referenceOf, specRequest } from '../designSpec.ts';

const reading = (over = {}) => ({
  usable: true, unusable: null, propertyKind: 'APARTMENT', summary: 'Two rooms', currentStyle: 'dated', light: 'BRIGHT',
  rooms: [
    { id: 'r1', kind: 'LIVING', label: 'Living room', photos: [0, 2], primaryPhoto: 2, fixed: ['two windows', 'radiator under the window'], openings: [{ type: 'WINDOW', photo: 0, note: 'left wall' }, { type: 'BALCONY_DOOR', photo: 2, note: '' }], condition: 'FURNISHED', confidence: 0.9 },
    { id: 'r2', kind: 'BEDROOM', label: 'Bedroom', photos: [1], primaryPhoto: 1, fixed: [], openings: [], condition: 'SHELL', confidence: 0.7 },
  ],
  photos: [
    { index: 0, roomId: 'r1', usable: true, unusable: null, view: 'from the door' },
    { index: 1, roomId: 'r2', usable: true, unusable: null, view: '' },
    { index: 2, roomId: 'r1', usable: true, unusable: null, view: 'from the window' },
  ],
  questions: [
    { id: 'qa', kind: 'ROOM_PURPOSE', question: 'Is this a bedroom or a study?', options: [{ id: 'BEDROOM', label: 'Bedroom' }, { id: 'OFFICE', label: 'Study' }], suggested: 'BEDROOM', roomId: 'r2', photos: [1] },
  ],
  heroRoomId: 'r1',
  ...over,
});

test('two photos of the same room are ONE room with both photos; another room stays separate', () => {
  const u = validatePhotoReading(reading(), 3);
  assert.equal(u.rooms.length, 2);
  assert.deepEqual(u.rooms[0].photos, [0, 2]);
  assert.equal(u.rooms[0].primaryPhoto, 2);
  assert.deepEqual(u.photos.map((p) => p.roomId), ['r1', 'r2', 'r1'], 'every photo traceable to its room');
  assert.equal(u.heroRoomId, 'r1');
});

test('nothing outside the upload survives: a photo index that was never sent, a room no photo shows', () => {
  const u = validatePhotoReading(reading({
    rooms: [...reading().rooms, { id: 'r3', kind: 'KITCHEN', label: 'Kitchen', photos: [7], primaryPhoto: 7, fixed: [], openings: [], condition: 'UNKNOWN', confidence: 0.4 }],
  }), 3);
  assert.equal(u.rooms.length, 2, 'an unseen kitchen is not invented');
});

test('a photo claimed by two rooms belongs to the first; an unusable photo belongs to none', () => {
  const u = validatePhotoReading(reading({
    rooms: [reading().rooms[0], { ...reading().rooms[1], photos: [1, 2] }],
    photos: [{ index: 0, usable: true }, { index: 1, usable: false, unusable: 'TOO_DARK' }, { index: 2, usable: true }],
  }), 3);
  assert.deepEqual(u.rooms.map((r) => r.photos), [[0, 2]]);
  assert.equal(u.photos[1].usable, false);
  assert.equal(u.photos[1].unusable, 'TOO_DARK');
});

test('nothing usable: usable false, with a reason — the customer is told to choose another photo', () => {
  const u = validatePhotoReading(reading({ usable: false, unusable: 'EXTERIOR_ONLY', rooms: [], photos: [{ index: 0, usable: false, unusable: 'EXTERIOR_ONLY' }] }), 1);
  assert.equal(u.usable, false);
  assert.equal(u.unusable, 'EXTERIOR_ONLY');
  assert.equal(u.heroRoomId, null);
});

test('questions: only well-formed ones, about a room that exists, at most three, renumbered', () => {
  const bad = { id: 'x', kind: 'ROOM_PURPOSE', question: 'What colour?', options: [{ id: 'A', label: 'A' }], suggested: 'A', roomId: 'r1', photos: [] };
  const ghost = { ...reading().questions[0], roomId: 'r9' };
  const many = Array.from({ length: 5 }, () => reading().questions[0]);
  const u = validatePhotoReading(reading({ questions: [bad, ghost, ...many] }), 3);
  assert.equal(u.questions.length, 3);
  assert.deepEqual(u.questions.map((q) => q.id), ['q1', 'q2', 'q3']);
});

test('an answer is applied: the room takes the purpose the customer named', () => {
  const u = validatePhotoReading(reading(), 3);
  assert.equal(openPhotoQuestions(u, []).length, 1);
  const a = [{ questionId: 'q1', value: 'OFFICE' }];
  assert.equal(openPhotoQuestions(u, a).length, 0);
  const applied = applyPhotoAnswers(u, a);
  assert.equal(applied.rooms[1].kind, 'OFFICE');
});

test('the design is drawn over the room\'s own photo; the master over the hero room', () => {
  const u = validatePhotoReading(reading(), 3);
  assert.equal(photoOfRoom(u, null), 2, 'the hero room\'s best photo');
  assert.equal(photoOfRoom(u, 'r2'), 1);
  assert.equal(referenceOf('ROOM', 'PHOTO'), 'SOURCE', 'a photo room is drawn over its own photo, never the master');
  assert.equal(referenceOf('VARIANT', 'PHOTO'), 'SOURCE');
  assert.equal(referenceOf('ROOM'), 'MASTER', 'a floor plan\'s rooms still come from the approved master');
});

test('photo evidence: the rooms seen, their fixed elements; no invented scale, walls or sizes', () => {
  const ev = photoEvidence(validatePhotoReading(reading(), 3), []);
  assert.equal(ev.sourceKind, 'PHOTO');
  assert.deepEqual(ev.rooms.map((r) => r.id), ['r1', 'r2']);
  assert.ok(ev.rooms.every((r) => r.areaM2 === null));
  assert.equal(ev.scale.metresPerPx, null);
  assert.equal(ev.walls.total, 0);
  assert.ok(ev.fixedElements.some((f) => /radiator/.test(f)));
  assert.equal(ev.unresolved.length, 1, 'an unanswered question is carried as uncertain');
});

test('every photo goes to OpenAI in one reading, in order, with a strict schema', () => {
  const body = photoReadRequest('m', [{ dataUrl: 'data:image/png;base64,AA', width: 10, height: 10 }, { dataUrl: 'data:image/png;base64,BB', width: 10, height: 10 }], 'Georgian');
  const images = body.input[1].content.filter((c) => c.type === 'input_image');
  assert.equal(images.length, 2);
  assert.equal(body.text.format.strict, true);
  assert.deepEqual(Object.keys(PHOTO_SCHEMA.properties).sort(), [...PHOTO_SCHEMA.required].sort());
});

test('a photo ROOM specification sees its own photo, the approved master and the other photos as context', () => {
  const ev = photoEvidence(validatePhotoReading(reading(), 3), []);
  const ctx = { mode: 'ROOM', evidence: ev, direction: directionFrom({ look: null, preferences: {} }), room: { id: 'r2', name: 'Bedroom' }, approvedSpec: { design: {} } };
  const body = specRequest('m', ctx, { source: 'data:S', master: 'data:M', context: ['data:C1', 'data:C2'] });
  const urls = body.input[1].content.filter((c) => c.type === 'input_image').map((c) => c.image_url);
  assert.deepEqual(urls, ['data:S', 'data:M', 'data:C1', 'data:C2']);
  assert.match(body.input[1].content[0].text, /same camera/i);
  assert.equal(modeContextProblem({ ...ctx, room: { id: 'r9', name: null } }, { source: true, master: true }), 'ROOM_UNKNOWN');
});

test('the photo master\'s instruction keeps the customer\'s camera', () => {
  const ev = photoEvidence(validatePhotoReading(reading(), 3), []);
  const spec = {
    architecture: { sourceReading: '', immutable: [], rooms: [], openings: [], adjacency: [], proportions: '', indoorOutdoor: [], fixedElements: [], conflicts: [] },
    design: { styleInterpretation: 's', qualityInterpretation: 'q', materials: [], palette: [{ name: 'a', hex: '#ffffff', role: 'DOMINANT' }], furnishing: [], lighting: { strategy: 'x', timeOfDay: 'DAY', temperature: 'WARM' }, cabinetry: '', textilesAndDecor: '', continuity: [] },
    generation: { mustRemain: [], mayChange: [], camera: '', photorealism: [], negative: [], imageInstruction: 'x'.repeat(220), continuityInstruction: '' },
  };
  const text = imageInstruction(spec, { mode: 'MASTER', evidence: ev, direction: directionFrom({}) });
  assert.match(text, /same camera position, lens and framing/);
  const room = imageInstruction(spec, { mode: 'ROOM', evidence: ev, direction: directionFrom({}), room: { id: 'r2', name: 'Bedroom' } });
  assert.match(room, /Redesign the room in THIS photograph \(Bedroom\)/);
});
