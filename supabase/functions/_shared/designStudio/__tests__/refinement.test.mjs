// Design Studio refinement (production, mobile): the reported cases.
//
//   A  the architecture is a hard rule: no missing wall, no cut-away for show,
//      openings and partitions kept, in every mode's instruction
//   B  a screenshot around a property picture is read, isolated and designed
//      from (never rejected for its app chrome; the chrome never redrawn)
//   C  a room is drawn from the SELECTED generated design (the source stays
//      the architecture), and an upload is never shown as a generated room
//   D  several selected references are sent, stored and used — exactly those
//   E  the 3D tour starts from the project (a photo design walks on the
//      project's plan; otherwise exactly what is missing is named)
//   F  a double tap is one operation: one paid picture, one walkthrough
//
// Pure modules are exercised directly; the routes and the page (Deno / React)
// are checked from their source, as the matrix tests do.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ALWAYS_NEGATIVE, CHANGE_FOCUS, directionFrom, ENVELOPE_RULES, imageInstruction, isChangeFocus, MAX_REFERENCES, OUTPUT_REQUIREMENTS, SPEC_SCHEMA, SPEC_SYSTEM, specRequest, validateSpec,
} from '../designSpec.ts';
import { cropScaleRgba, PHOTO_SCHEMA, PHOTO_SYSTEM, photoEvidence, subjectBox, subjectCrop, validatePhotoReading } from '../photoRead.ts';
import { openAiEditRequest } from '../imageProviders.ts';
import { runImageStep } from '../generationFlow.ts';

const code = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const SOURCE = 'data:image/png;base64,U09VUkNF';
const MASTER = 'data:image/png;base64,TUFTVEVS';
const REF2 = 'data:image/png;base64,UkVGMg==';
const REF3 = 'data:image/png;base64,UkVGMw==';
const DIRECTION = directionFrom({ look: { style: 'MODERN', quality: 'PREMIUM' }, preferences: {} });

const planEvidence = () => ({
  sourceKind: 'FLOOR_PLAN', scale: { metresPerPx: 0.01, uncertaintyPct: 3, overallM: [9.2, 7.4], printedSizes: 2 }, ceilingM: 2.7,
  rooms: [
    { id: 'R1', kind: 'LIVING', label: 'Living room', areaM2: 24, outdoor: false, printedSize: null, confidence: 0.9 },
    { id: 'R2', kind: 'BEDROOM', label: 'Bedroom', areaM2: 13, outdoor: false, printedSize: null, confidence: 0.9 },
    { id: 'R3', kind: 'BALCONY', label: 'Balcony', areaM2: 4, outdoor: true, printedSize: null, confidence: 0.8 },
  ],
  walls: { total: 14, exterior: 6, interior: 8, uncertain: [] },
  openings: [{ id: 'D1', type: 'DOOR', between: ['R1', 'R2'], widthM: 0.8, confidence: 0.9 }, { id: 'W1', type: 'WINDOW', between: ['R1', 'OUTSIDE'], widthM: 1.6, confidence: 0.9 }],
  adjacency: [['R1', 'R2'], ['R1', 'R3']], stairs: [], fixedElements: ['balcony R3 stays outdoors'], unresolved: [], answers: [], issues: [],
});
const rawSpec = (over = {}) => ({
  architecture: {
    sourceReading: 'A two-room flat with a balcony.', immutable: ['The exterior wall along the balcony stays whole.'],
    rooms: [{ id: 'R1', name: 'Living room', kind: 'LIVING', keep: 'L-shaped, window on the south wall' }, { id: 'R2', name: 'Bedroom', kind: 'BEDROOM', keep: 'door from the living room' }],
    openings: [{ id: 'D1', type: 'DOOR', between: 'R1-R2', keep: 'where drawn' }], adjacency: ['R1-R2'], proportions: '9.2 by 7.4 m',
    envelope: 'Exterior walls on all four sides; the balcony door on the south wall; the entrance on the north wall.',
    circulation: 'Entrance into the living room; the bedroom and the balcony from it.',
    indoorOutdoor: ['R3 outdoors'], fixedElements: [], conflicts: [],
  },
  design: {
    styleInterpretation: 'Warm modern', qualityInterpretation: 'Premium', materials: ['oiled oak'],
    palette: [{ name: 'Chalk', hex: '#f2f0eb', role: 'DOMINANT' }, { name: 'Oak', hex: '#b08a5a', role: 'WOOD' }, { name: 'Graphite', hex: '#2d2f33', role: 'METAL' }],
    furnishing: ['a low sofa facing the window'], lighting: { strategy: 'layered warm light', timeOfDay: 'EVENING', temperature: 'WARM' },
    cabinetry: 'handleless oak', flooring: 'wide oak boards', wallFinishes: 'mineral plaster in chalk', fixtures: 'linear pendants', wetRooms: 'honed travertine',
    textilesAndDecor: 'linen and wool', continuity: ['oak throughout'],
  },
  generation: {
    mustRemain: ['every wall and opening'], mayChange: ['furniture'], camera: 'three-quarter overview from the south-east', photorealism: ['soft shadows'],
    negative: ['no clutter'], imageInstruction: 'Show the whole flat in warm modern: oak floors, chalk plaster walls, a low bouclé sofa facing the south window. '.repeat(3), continuityInstruction: 'the same oak and chalk',
  },
  ...over,
});

// ── A ────────────────────────────────────────────────────────────────────

test('A: the envelope is a hard rule in the specification, its schema and every picture\'s instruction', () => {
  const ev = planEvidence();
  for (const rule of ENVELOPE_RULES) assert.ok(SPEC_SYSTEM.includes(rule), 'the designer is given every envelope rule');
  assert.match(SPEC_SYSTEM, /UNKNOWN is better than invented architecture/);
  assert.ok(SPEC_SCHEMA.properties.architecture.required.includes('envelope') && SPEC_SCHEMA.properties.architecture.required.includes('circulation'));
  for (const f of ['flooring', 'wallFinishes', 'fixtures', 'wetRooms']) assert.ok(SPEC_SCHEMA.properties.design.required.includes(f), f);
  const spec = validateSpec(rawSpec(), ev);
  assert.ok(spec, 'a full specification validates');
  for (const mode of ['MASTER', 'VARIANT', 'ROOM']) {
    const text = imageInstruction(spec, { mode, evidence: ev, direction: DIRECTION, room: mode === 'ROOM' ? { id: 'R2', name: 'Bedroom' } : null, approvedSpec: spec, references: 1 });
    const order = ['SOURCE TRUTH', 'PRESERVATION RULES', 'DESIGN INTENT', 'NEGATIVE CONSTRAINTS', 'OUTPUT REQUIREMENTS'].map((h) => text.indexOf(h));
    assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), `${mode}: structured, architecture first`);
    for (const rule of ENVELOPE_RULES) assert.ok(text.includes(rule), `${mode}: ${rule.slice(0, 40)}`);
    assert.match(text, /Envelope: Exterior walls on all four sides/);
    assert.match(text, /Circulation: Entrance into the living room/);
    assert.match(text, /no missing, broken, lowered or cut-away wall sections; no gap in the exterior boundary/);
    assert.match(text, /no removed, moved or added doors, windows, arches or openings/);
    assert.match(text, /Flooring: wide oak boards/);
    assert.match(text, /Wall finishes: mineral plaster/);
  }
  // The plan's overview keeps every wall: a uniform section, never a missing wall; a photo keeps its own presentation.
  const plan = imageInstruction(spec, { mode: 'MASTER', evidence: ev, direction: DIRECTION });
  assert.match(plan, /EVERY wall of the plan is present|Every wall of the plan is present/);
  assert.match(plan, /never a missing or lowered wall section/);
  assert.doesNotMatch(plan, /cut-away \(dollhouse\) view/, 'never asked for a dollhouse presentation');
  const photo = imageInstruction(spec, { mode: 'MASTER', evidence: { ...ev, sourceKind: 'PHOTO' }, direction: DIRECTION });
  assert.match(photo, /an overview stays the same overview, every wall it shows kept whole/);
  assert.doesNotMatch(photo, /cut-away \(dollhouse\)/);
  assert.ok(ALWAYS_NEGATIVE.includes('no floating furniture: everything stands on its floor or hangs on its wall'));
  assert.ok(OUTPUT_REQUIREMENTS.some((r) => /realistic scale/.test(r)));
});

// ── B ────────────────────────────────────────────────────────────────────

const screenshotReading = () => ({
  usable: true, unusable: null, propertyKind: 'APARTMENT', summary: 'an apartment render inside an app', currentStyle: 'modern', light: 'BRIGHT',
  rooms: [{ id: 'r1', kind: 'LIVING', label: 'Living', photos: [0], primaryPhoto: 0, fixed: [], openings: [], condition: 'FURNISHED', confidence: 0.8 }],
  photos: [{ index: 0, roomId: 'r1', usable: true, unusable: null, view: 'axonometric render inside a phone screenshot', wholeHome: true, screenshot: true, subject: { x: 0.05, y: 0.22, width: 0.9, height: 0.45 } }],
  questions: [], heroRoomId: 'r1',
});

test('B: a screenshot around a property render is usable; the reader finds the picture inside it', () => {
  assert.match(PHOTO_SYSTEM, /screenshot = true/);
  assert.match(PHOTO_SYSTEM, /is NOT unusable/);
  assert.doesNotMatch(PHOTO_SYSTEM, /a close-up of an object, a screenshot\)/, 'a screenshot is no longer listed as unusable');
  assert.ok(PHOTO_SCHEMA.properties.photos.items.required.includes('subject') && PHOTO_SCHEMA.properties.photos.items.required.includes('screenshot'));
  const u = validatePhotoReading(screenshotReading(), 1);
  assert.equal(u.usable, true, 'not rejected for its app chrome');
  assert.equal(u.photos[0].screenshot, true);
  assert.deepEqual(u.photos[0].subject, { x: 0.05, y: 0.22, width: 0.9, height: 0.45 });
  assert.equal(subjectBox({ x: 0, y: 0, width: 1, height: 1 }), null, 'a picture that fills the upload needs no isolation');
  assert.equal(subjectBox({ x: 0.2, y: 0.2, width: 0.02, height: 0.5 }), null, 'a sliver is not a picture');
  assert.equal(subjectBox('nonsense'), null);
});

test('B: the isolation widens the box (never cuts the property) and keeps only the picture\'s pixels', () => {
  // A 100×200 "phone screenshot": grey chrome, a coloured render from y=40 to y=140.
  const W = 100; const H = 200;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const k = (y * W + x) * 4; const render = y >= 40 && y < 140;
    data[k] = render ? 200 : 128; data[k + 1] = render ? 60 : 128; data[k + 2] = render ? 40 : 128; data[k + 3] = 255;
  }
  const rect = subjectCrop({ x: 0, y: 0.2, width: 1, height: 0.5 }, W, H);
  assert.ok(rect.top <= 40 && rect.top + rect.height >= 140, 'the whole render is inside the crop (a margin, never narrower)');
  assert.ok(rect.height < H * 0.7, 'the chrome above and below is dropped');
  const cut = cropScaleRgba({ data, width: W, height: H }, rect, 2048);
  assert.equal(cut.width, rect.width); assert.equal(cut.height, rect.height);
  const mid = ((cut.height >> 1) * cut.width + (cut.width >> 1)) * 4;
  assert.deepEqual([...cut.data.subarray(mid, mid + 3)], [200, 60, 40], 'the render itself, unchanged');
  const small = cropScaleRgba({ data, width: W, height: H }, rect, 50);
  assert.ok(Math.max(small.width, small.height) <= 50, 'scaled to the working size');
  assert.equal(subjectCrop({ x: 0.01, y: 0.01, width: 0.97, height: 0.97 }, W, H), null, 'nothing to isolate when it fills the picture');
});

test('B: the route isolates, keeps the upload, and the design is drawn from the isolated picture', () => {
  const photos = code('supabase/functions/design-studio-reconstruct/photos.ts');
  assert.match(photos, /const isolated = await isolateScreens\(recon, ordered, images, u\);/);
  assert.match(photos, /photos\[i\] = \{ \.\.\.p, normalizedKey: key \};/, 'the isolated picture is recorded beside the upload');
  assert.doesNotMatch(photos, /deleteObject/, 'the upload is kept for provenance');
  const gen = code('supabase/functions/design-studio-reconstruct/generate.ts');
  assert.match(gen, /const keys = originals\.map\(\(k, i\) => normalizedKeyOf\(understanding, i, k\)\);/);
  assert.match(gen, /sourceCapture: shot\.normalizedKey && sourceKey === shot\.normalizedKey \? 'SCREENSHOT_CROPPED' : 'SCREENSHOT'/);
  // When the picture could not be isolated, the image model is told exactly what to ignore.
  const ev = { ...photoEvidence(validatePhotoReading(screenshotReading(), 1), []), sourceCapture: 'SCREENSHOT' };
  const spec = validateSpec(rawSpec({ architecture: { ...rawSpec().architecture, rooms: [{ id: 'r1', name: 'Living', kind: 'LIVING', keep: 'as shown' }] } }), ev);
  const text = imageInstruction(spec, { mode: 'MASTER', evidence: ev, direction: DIRECTION });
  assert.match(text, /never reproduce the surrounding application, status bar, buttons, headers, captions, text, margins or background/);
  assert.match(text, /no interface elements: no app chrome, buttons, status bars, captions or screen frames/);
});

// ── C / D ────────────────────────────────────────────────────────────────

test('C/D: a room is specified from the selected generated design(s), every one of them, in order', () => {
  const ev = planEvidence();
  const approved = validateSpec(rawSpec(), ev);
  const ctx = { mode: 'ROOM', evidence: ev, direction: DIRECTION, room: { id: 'R2', name: 'Bedroom' }, approvedSpec: approved, references: 3 };
  const body = specRequest('m', ctx, { source: SOURCE, master: MASTER, references: [REF2, REF3] });
  const imgs = body.input[1].content.filter((c) => c.type === 'input_image').map((c) => c.image_url);
  assert.deepEqual(imgs, [SOURCE, MASTER, REF2, REF3], 'the architecture evidence, then exactly the selected designs');
  const words = JSON.stringify(body);
  assert.match(words, /SELECTED DESIGN REFERENCE 1/); assert.match(words, /SELECTED DESIGN REFERENCE 3/);
  assert.match(words, /ARCHITECTURAL EVIDENCE/);
  assert.match(words, /source of truth for the design language/);
  assert.equal(MAX_REFERENCES, 4);
  const many = specRequest('m', ctx, { source: SOURCE, master: MASTER, references: [REF2, REF3, REF2, REF3, REF2] });
  assert.equal(many.input[1].content.filter((c) => c.type === 'input_image').length, MAX_REFERENCES + 1, 'never more than the cap');
  // A photo room: drawn over its own photo (architecture) with the selected designs as the design reference.
  const photoEv = { ...ev, sourceKind: 'PHOTO' };
  const text = imageInstruction(approved, { ...ctx, evidence: photoEv, references: 2 });
  assert.match(text, /THE FIRST image, the customer's own photograph \(Bedroom\)/);
  assert.match(text, /The other images are the generated designs the customer selected/);
  assert.match(text, /never their walls, windows or camera/);
});

test('C/D: several references reach the image model as image[] (the base first); one picture stays the single image field', () => {
  const base = { bytes: new Uint8Array([1]), mime: 'image/png' };
  const r1 = { bytes: new Uint8Array([2]), mime: 'image/png' }; const r2 = { bytes: new Uint8Array([3]), mime: 'image/jpeg' };
  const one = openAiEditRequest({ model: 'gpt-image-2', prompt: 'p', image: base, maskPng: null, size: { width: 1536, height: 1024 }, quality: 'high' });
  assert.equal(one.getAll('image').length, 1); assert.equal(one.getAll('image[]').length, 0);
  const several = openAiEditRequest({ model: 'gpt-image-2', prompt: 'p', image: base, maskPng: null, size: { width: 1536, height: 1024 }, quality: 'high', refs: [r1, r2] });
  const files = several.getAll('image[]');
  assert.equal(files.length, 3); assert.equal(several.getAll('image').length, 0);
  assert.equal(files[0].name, 'image-0.png', 'the base first');
  // A masked edit never takes references (the mask belongs to one picture).
  const masked = openAiEditRequest({ model: 'gpt-image-2', prompt: 'p', image: base, maskPng: new Uint8Array([7]), size: { width: 1536, height: 1024 }, quality: 'high', refs: [r1] });
  assert.equal(masked.getAll('image[]').length, 0);
});

test('C/D/F: the picture step sends the references it is given, and an interrupted ask is never paid twice', async () => {
  let clock = Date.parse('2026-10-04T10:00:00Z');
  const row = { id: 'x', user_id: 'u', project_id: 'p', status: 'QUEUED', final_key: null, lease_at: null, finish: {}, timings: { ai: { step: 'IMAGE', mode: 'ROOM', specJobId: 's' } } };
  const seen = [];
  const io = {
    now: () => clock,
    async claim(r, from, patch) { if (!from.includes(row.status)) return null; Object.assign(row, patch); return structuredClone(row); },
    async save(r, lease, patch) { if (row.lease_at !== lease) return null; Object.assign(row, patch); return structuredClone(row); },
    async reference() { return { bytes: new Uint8Array([1]), mime: 'image/png' }; },
    async references() { return [{ bytes: new Uint8Array([2]), mime: 'image/png' }, { bytes: new Uint8Array([3]), mime: 'image/png' }]; },
    async instruction() { return 'SOURCE TRUTH… DESIGN INTENT…'; },
    size: () => ({ width: 1536, height: 1024 }),
    async image(input) { seen.push(input); throw new Error('worker killed'); },
    async fail(r, code) { row.status = 'FAILED'; row.error = code; return true; },
  };
  await assert.rejects(runImageStep(io, structuredClone(row)));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].refs.length, 2, 'both selected references reached the image call');
  // The worker died after asking: the next pass fails it rather than asking (and paying) again.
  clock += 10 * 60_000; row.lease_at = null; row.status = 'RENDERING';
  assert.equal(await runImageStep(io, structuredClone(row)), 'FAILED');
  assert.equal(seen.length, 1, 'no second paid call');
  assert.equal(row.error, 'GENERATION_INTERRUPTED');
});

test('C/D: the route takes exactly the selected references, refuses a substitute, and records them on the job and the render', () => {
  const gen = code('supabase/functions/design-studio-reconstruct/generate.ts');
  assert.match(gen, /if \(references\.some\(\(r\) => !r \|\| r\.kind === 'ROOM'\)\) return json\(\{ error: 'REFERENCE_MISSING' \}, 409\);/, 'an unknown or foreign reference is refused, never replaced');
  assert.match(gen, /\.\.\.\(mode === 'ROOM' \? \{ referenceRenderIds \} : \{\}\),/, 'stored on the job input');
  assert.match(gen, /referenceRenderIds: \[\.\.\.\(approved \? \[String\(approved\.id\)\] : \[\]\), \.\.\.extraRefs\.map\(\(r\) => String\(r\.id\)\)\]/, 'stored on the specification');
  assert.match(gen, /referenceRenderIds: Array\.isArray\(job\.output\.referenceRenderIds\) \? job\.output\.referenceRenderIds/, 'stored on the render (finish)');
  assert.match(gen, /\(refImages\.some\(\(x\) => !x\) \? 'REFERENCE_MISSING' : null\)/, 'every selected reference is seen, or nothing is made');
  assert.match(gen, /const wanted = overPhoto \? ids : ids\.filter\(\(id\) => id !== parentId\);/);
});

test('C: the Result shows a room picture only once one was generated; never the customer\'s upload', () => {
  const result = code('src/components/designStudio/unified/DesignResult.tsx');
  assert.doesNotMatch(result, /room\.photoUrl/, 'an upload is never shown as a room result');
  assert.match(result, /const img = shot \? urls\.get\(shot\.id\) : null;/);
  assert.match(result, /data-testid="room-empty"/);
  assert.match(result, /data-testid="room-refs"/);
  assert.match(result, /refs: chosen, parentRenderId: chosen\[0\]/, 'the selected references are what is sent');
  assert.match(code('src/services/designStudio/designRun.ts'), /referenceRenderIds: input\.referenceRenderIds/);
});

// ── E ────────────────────────────────────────────────────────────────────

test('E: the 3D tour starts from the project; a photo design walks on the project\'s plan, carrying its design', () => {
  const walk = code('supabase/functions/design-studio-reconstruct/walkthrough.ts');
  assert.match(walk, /if \(source\?\.kind === 'PHOTO_SET'\) \{\s*const onPlan = await designOnPlan\(admin, version, project\.id\);/);
  assert.match(walk, /const id = await uuidFrom\(`ds-walk-photo-design:\$\{version\.id\}:\$\{plan\.id\}`\);/, 'asked again, the same version');
  assert.match(walk, /design_dna: version\.design_dna \?\? null,\s*\}, \{ onConflict: 'id', ignoreDuplicates: true \}\);\s*if \(error\) return null;/, 'the design (DNA → its specification) is carried onto the plan');
  assert.match(walk, /missing: \['WALLS', 'DOORS', 'ROOM_SIZES'\], have: \['DESIGN', 'PHOTOS'\]/, 'what is missing, exactly');
  const panel = code('src/components/designStudio/unified/WalkthroughPanel.tsx');
  assert.match(panel, /else if \(r\.error === 'WALKTHROUGH_NEEDS_FLOOR_PLAN'\) setNeedsPlan\(true\);/);
  assert.match(panel, /data-testid="walk-missing"/);
  const result = code('src/components/designStudio/unified/DesignResult.tsx');
  assert.doesNotMatch(result, /data-testid="photo-tour"/, 'no generic "upload again" card');
});

// ── F ────────────────────────────────────────────────────────────────────

test('F: a double tap is one operation (room, confirm, walkthrough)', () => {
  const result = code('src/components/designStudio/unified/DesignResult.tsx');
  assert.match(result, /key: `room-\$\{data\.head\.id\.slice\(0, 8\)\}-\$\{roomId\.slice\(0, 40\)\}-\$\{style \?\? 'same'\}-\$\{fingerprint\(chosen\)\}`/, 'a room\'s key has no randomness');
  assert.match(result, /if \(!pending \|\| busy \|\| confirming\.current\) return;/);
  const panel = code('src/components/designStudio/unified/WalkthroughPanel.tsx');
  assert.match(panel, /if \(asking \|\| inFlight\.current\) return;/);
  const gen = code('supabase/functions/design-studio-reconstruct/generate.ts');
  assert.match(gen, /The same Generate again \(a double tap, a reload, the chain asked twice\): the same row, never a second picture\./);
  assert.match(gen, /Two identical requests that raced: the earliest stays/);
});

// ── Actions ──────────────────────────────────────────────────────────────

test('actions: "Surprise me" is gone; "More changes" are focus codes the server defines', () => {
  assert.doesNotMatch(code('src/components/designStudio/planToHome/SimpleSteps.tsx'), /surprise/i);
  for (const f of ['src/components/designStudio/unified/PhotoFlow.tsx', 'src/components/designStudio/FloorPlanFlow.tsx']) assert.doesNotMatch(code(f), /onSurprise|surpriseStyle/, f);
  const result = code('src/components/designStudio/unified/DesignResult.tsx');
  const focuses = result.match(/const FOCUSES = \[([^\]]+)\]/)[1].match(/'([A-Z]+)'/g).map((s) => s.slice(1, -1));
  for (const f of focuses) assert.ok(isChangeFocus(f) && CHANGE_FOCUS[f].length > 40, `${f} is defined on the server`);
  assert.equal(isChangeFocus('IGNORE_PREVIOUS'), false);
  assert.match(code('supabase/functions/design-studio-reconstruct/generate.ts'), /focus: mode === 'VARIANT' && isChangeFocus\(body\.change\.focus\) \? body\.change\.focus : null/);
});
