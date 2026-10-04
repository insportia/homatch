// The AI Design Specification: OpenAI sees the customer's own source with
// HOMATCH's structured evidence beside it; Style and Quality are creative
// direction (no catalogue anywhere); the image instruction separates the
// immutable architecture from the designed interior; ROOM and VARIANT are the
// same engine with the approved master and its spec as continuity.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  ALWAYS_IMMUTABLE, ALWAYS_NEGATIVE, buildEvidence, directionFrom, dnaFromSpec, imageInstruction, modeContextProblem, referenceOf, roomFromWholeHome, SPEC_SCHEMA, specProblems, specRequest, validateSpec,
} from '../designSpec.ts';
import { understand } from '../planRead/understand.ts';

const FIX = path.join(process.cwd(), 'tests/fixtures/design-studio');
function golden(version = 'v2') {
  const buf = zlib.gunzipSync(fs.readFileSync(path.join(FIX, 'golden-floorplan.pgm.gz')));
  const m = buf.subarray(0, 64).toString('latin1').match(/^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/);
  const gray = { width: Number(m[1]), height: Number(m[2]), data: new Uint8Array(buf.buffer, buf.byteOffset + m[0].length, Number(m[1]) * Number(m[2])) };
  const rec = JSON.parse(fs.readFileSync(path.join(FIX, `golden-floorplan.read-${version}.json`), 'utf8'));
  return understand({ doc: rec.rawDoc ?? rec.doc, dimensionStrings: rec.dimensionStrings, gray });
}

const ANSWERS = [{ questionId: 'DIMENSION:R9', kind: 'DIMENSION', value: [3.05, 2.44] }];
const SOURCE = 'data:image/png;base64,U09VUkNF';
const MASTER = 'data:image/png;base64,TUFTVEVS';
const DIRECTION = directionFrom({
  look: { style: 'MODERN', quality: 'PREMIUM' },
  preferences: { style: 'contemporary', mood: 'BRIGHT', floor: 'LIGHT_WOOD', walls: 'COOL_WHITE', accent: 'BLACK_METAL', palette: 'NEUTRAL', furnishing: 'STAGED', brief: 'Modern: clean lines. Premium: top-tier natural materials.' },
});

function evidence() {
  const out = golden('v2');
  return buildEvidence({ doc: out.doc, understanding: out.understanding, answers: ANSWERS, sourceKind: 'FLOOR_PLAN', ceilingM: 2.7 });
}

/** A specification of the shape OpenAI returns (what a fake provider answers in the route tests too). */
export function sampleSpec(ev) {
  return {
    architecture: {
      sourceReading: 'A floor plan of a two-storey home with a porch.',
      immutable: ['Every wall and door exactly as drawn.'],
      rooms: ev.rooms.map((r) => ({ id: r.id, name: r.label ?? r.kind, kind: r.kind, keep: 'Same position, shape and size as drawn.' })),
      openings: ev.openings.slice(0, 3).map((o) => ({ id: o.id, type: o.type, between: o.between.join(' – '), keep: 'Same place and width.' })),
      adjacency: ['Living opens to the kitchen.'], proportions: 'Long and narrow, about 12 m by 7 m.',
      indoorOutdoor: ['The porch stays outdoors.'], fixedElements: ['Kitchen run on the north wall.'],
      conflicts: [{ topic: 'porch size', visual: 'drawn smaller', structured: "printed 10'x8'", resolution: 'keep the drawn outline' }],
    },
    design: {
      styleInterpretation: 'Clean modern lines, crisp white walls, slim black metal',
      qualityInterpretation: 'Premium natural oak, honed stone, layered lighting',
      materials: ['Wide natural oak boards', 'Honed travertine in the bathrooms'],
      palette: [{ name: 'Chalk', hex: '#F2F0EB', role: 'DOMINANT' }, { name: 'Oak', hex: '#c8a27a', role: 'WOOD' }, { name: 'Graphite', hex: '#2b2d30', role: 'METAL' }, { name: 'Sage', hex: '#9fae94', role: 'ACCENT' }],
      furnishing: ['A low bouclé sofa facing the window in the living room.'],
      lighting: { strategy: 'Recessed warm lines and two sculptural pendants.', timeOfDay: 'DAY', temperature: 'WARM' },
      cabinetry: 'Handleless matte cabinetry with oak accents.', textilesAndDecor: 'Linen curtains, a wool rug, a few ceramics.', continuity: ['Same oak floor throughout.'],
    },
    generation: {
      mustRemain: ['The staircase position'], mayChange: ['All furniture and finishes'], camera: 'Three-quarter view from the south-east at 45 degrees.',
      photorealism: ['Soft daylight, true material textures'], negative: ['no clutter'],
      imageInstruction: 'Show the whole home as a cut-away from above: the living room on the left with the low bouclé sofa facing the window, the kitchen beyond it along the north wall with handleless matte cabinetry, the porch outside the front door kept outdoors, oak floors throughout, chalk walls, graphite details, sculptural pendants over the dining table, linen curtains and a wool rug, honed travertine in the bathroom, the staircase where it is drawn.',
      continuityInstruction: 'Every later picture keeps the oak floor, chalk walls and graphite details.',
    },
  };
}

test('every class of architectural evidence, with the customer\'s answers applied, reaches the specification', () => {
  const ev = evidence();
  assert.equal(ev.sourceKind, 'FLOOR_PLAN');
  assert.ok(ev.rooms.length >= 7 && ev.rooms.every((r) => r.id && r.kind), 'rooms');
  assert.ok(ev.rooms.some((r) => r.label), 'room labels');
  assert.ok(ev.rooms.some((r) => r.areaM2 > 0), 'room areas in metres');
  assert.ok(ev.walls.total > 0 && ev.walls.exterior > 0 && ev.walls.interior > 0, 'walls');
  assert.ok(ev.openings.some((o) => o.type === 'DOOR'), 'doors');
  assert.ok(ev.openings.some((o) => o.type === 'WINDOW'), 'windows');
  assert.ok(ev.openings.some((o) => o.between.filter(Boolean).length === 2), 'which rooms a door joins');
  assert.ok(ev.adjacency.length > 0, 'adjacency');
  assert.ok(ev.scale.metresPerPx > 0 && ev.scale.overallM?.[0] > 0, 'scale and overall size');
  assert.ok(ev.rooms.some((r) => r.outdoor) || ev.fixedElements.some((f) => /outdoors/.test(f)), 'indoor / outdoor');
  assert.ok(ev.fixedElements.some((f) => /kitchen|bathroom|staircase/.test(f)), 'fixed elements');
  assert.equal(ev.stairs.length >= 0, true);
  assert.equal(ev.ceilingM, 2.7);
  assert.deepEqual(ev.answers, ANSWERS, 'the answers');
  assert.ok(!ev.unresolved.some((q) => q.id === 'DIMENSION:R9'), 'an answered question is no longer unresolved');
  assert.ok(ev.unresolved.length >= 1, 'unanswered reader doubts are carried as uncertainty');
});

test('MASTER: OpenAI sees the customer\'s actual source picture; the catalogue never reaches it', () => {
  const ev = evidence();
  const body = specRequest('gpt-5.6-luna', { mode: 'MASTER', evidence: ev, direction: DIRECTION }, { source: SOURCE });
  const content = body.input[1].content;
  const images = content.filter((c) => c.type === 'input_image');
  assert.deepEqual(images.map((i) => i.image_url), [SOURCE], 'the source itself, not a text description of it');
  const text = JSON.stringify(body);
  assert.match(text, /HOMATCH STRUCTURED EVIDENCE/);
  assert.match(text, /DIMENSION:R9/, 'the answer travels');
  assert.match(text, /PREMIUM|premium/);
  for (const forbidden of [/catalog/i, /CATALOGUE/, /dev\/sofa/, /asset/i, /material code/i, /blender/i]) assert.doesNotMatch(text, forbidden, String(forbidden));
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.text.format.strict, true);
  assert.equal(referenceOf('MASTER'), 'SOURCE', 'the image model draws from the source, never a Blender render');
});

test('the specification is validated: real room ids, real colours, a substantial project-specific instruction', () => {
  const ev = evidence();
  const spec = validateSpec(sampleSpec(ev), ev);
  assert.ok(spec);
  assert.equal(spec.design.palette[0].hex, '#f2f0eb', 'colours are normalised');
  assert.equal(validateSpec({ ...sampleSpec(ev), architecture: { ...sampleSpec(ev).architecture, rooms: [{ id: 'R999', name: 'x', kind: 'LIVING', keep: '' }] } }, ev), null, 'an invented room id is refused');
  assert.ok(validateSpec({ ...sampleSpec(ev), architecture: { ...sampleSpec(ev).architecture, rooms: [...sampleSpec(ev).architecture.rooms, { id: 'visual:loft', name: 'Loft', kind: 'OTHER', keep: '' }] } }, ev), 'a space only the picture shows is named as visual:…');
  assert.equal(validateSpec({ ...sampleSpec(ev), generation: { ...sampleSpec(ev).generation, imageInstruction: 'Make it modern.' } }, ev), null, 'a tiny generic instruction is refused');
  assert.equal(validateSpec({ ...sampleSpec(ev), design: { ...sampleSpec(ev).design, palette: [{ name: 'x', hex: 'red', role: 'DOMINANT' }] } }, ev), null);
  assert.equal(validateSpec(null, ev), null);
  // The schema demands every section the product needs.
  assert.deepEqual(SPEC_SCHEMA.required, ['architecture', 'design', 'generation']);
  for (const k of ['immutable', 'rooms', 'openings', 'adjacency', 'indoorOutdoor', 'fixedElements', 'conflicts']) assert.ok(SPEC_SCHEMA.properties.architecture.required.includes(k), k);
  for (const k of ['styleInterpretation', 'qualityInterpretation', 'materials', 'palette', 'furnishing', 'lighting', 'cabinetry', 'textilesAndDecor', 'continuity']) assert.ok(SPEC_SCHEMA.properties.design.required.includes(k), k);
  for (const k of ['mustRemain', 'mayChange', 'camera', 'photorealism', 'negative', 'imageInstruction', 'continuityInstruction']) assert.ok(SPEC_SCHEMA.properties.generation.required.includes(k), k);
});

test('a photograph that shows the whole home: spaces its reading did not list are kept as visual:…, never a failure', () => {
  // Production, project a6f4d744: one isometric photo of a whole flat, read as one kitchen-living room (r1). A
  // specification naming the bedrooms and the hall was refused outright (SPEC_INVALID), every time it was asked.
  const ev = { sourceKind: 'PHOTO', rooms: [{ id: 'r1', kind: 'KITCHEN_LIVING', label: 'Kitchen-living', outdoor: false }], openings: [] };
  const whole = { ...sampleSpec(ev), architecture: { ...sampleSpec(ev).architecture, rooms: [
    { id: 'r1', name: 'Kitchen-living', kind: 'KITCHEN_LIVING', keep: 'As shown.' },
    { id: 'r2', name: 'Bedroom', kind: 'BEDROOM', keep: 'As shown.' },
    { id: 'Hallway 1', name: 'Hall', kind: 'HALL', keep: 'As shown.' },
    { id: '', name: 'Балкон', kind: 'BALCONY', keep: 'Stays outdoors.' },
  ] } };
  assert.deepEqual(specProblems(whole, ev), []);
  const spec = validateSpec(whole, ev);
  assert.ok(spec);
  assert.deepEqual(spec.architecture.rooms.map((r) => r.id), ['r1', 'visual:r2', 'visual:Hallway-1', 'visual:space-4']);
  assert.ok(spec.architecture.rooms.every((r) => /^(r1|visual:[A-Za-z0-9_-]{1,30})$/.test(r.id)));
  // Stable: a stored specification checked again (the render reads it back) is the same specification.
  assert.deepEqual(validateSpec(spec, ev), spec);
  // A floor plan's evidence is the whole plan: an invented room there is still refused, and the reason is given.
  const plan = evidence();
  const invented = { ...sampleSpec(plan), architecture: { ...sampleSpec(plan).architecture, rooms: [{ id: 'R999', name: 'x', kind: 'LIVING', keep: '' }] } };
  assert.deepEqual(specProblems(invented, plan), ['UNKNOWN_ROOM:R999']);
  assert.deepEqual(specProblems({ ...sampleSpec(plan), generation: { ...sampleSpec(plan).generation, imageInstruction: 'x' } }, plan), ['INSTRUCTION_TOO_SHORT']);
  assert.deepEqual(specProblems(null, plan), ['SECTIONS_MISSING']);
  // The model is told the rule it is held to.
  assert.match(specRequest('m', { mode: 'MASTER', evidence: ev, direction: DIRECTION, room: null, change: null, approvedSpec: null }, { source: SOURCE }).input[0].content, /visual:short-name/);
});

test('the image instruction is project-specific and separates the SOURCE TRUTH (architecture) from the DESIGN INTENT (interior)', () => {
  const ev = evidence();
  const spec = validateSpec(sampleSpec(ev), ev);
  const text = imageInstruction(spec, { mode: 'MASTER', evidence: ev, direction: DIRECTION });
  const imm = text.indexOf('SOURCE TRUTH'); const cre = text.indexOf('DESIGN INTENT');
  assert.ok(imm > 0 && cre > imm, 'architecture first, then the design');
  assert.ok(text.includes(ALWAYS_IMMUTABLE[0]));
  assert.match(text, /Turn THIS floor plan/);
  assert.match(text, new RegExp(`${ev.rooms.length} spaces`), 'the property\'s own room count');
  assert.ok(ev.rooms.filter((r) => r.label).every((r) => text.includes(r.label)), 'the rooms by their own names');
  assert.match(text, /bouclé sofa/, 'the designer\'s concrete design');
  assert.match(text, /Uncertain \(porch size\): keep the drawn outline/, 'a conflict is resolved conservatively, in the open');
  assert.match(text, /no text, labels, numbers, dimensions/);
  assert.ok(text.length > 1500 && text.length <= 30000);
  assert.doesNotMatch(text, /catalog|dev\//i);
});

test('ROOM: the same engine with the approved master, its spec and the room — not a new room', () => {
  const ev = evidence();
  const approved = validateSpec(sampleSpec(ev), ev);
  const room = ev.rooms.find((r) => r.kind === 'LIVING') ?? ev.rooms[0];
  const ctx = { mode: 'ROOM', evidence: ev, direction: DIRECTION, room: { id: room.id, name: room.label }, approvedSpec: approved };
  assert.equal(modeContextProblem(ctx, { source: true, master: true }), null);
  assert.equal(modeContextProblem(ctx, { source: true, master: false }), 'MASTER_MISSING');
  assert.equal(modeContextProblem({ ...ctx, approvedSpec: null }, { source: true, master: true }), 'SPEC_MISSING');
  assert.equal(modeContextProblem({ ...ctx, room: { id: 'R404', name: null } }, { source: true, master: true }), 'ROOM_UNKNOWN');
  const body = specRequest('m', ctx, { source: SOURCE, master: MASTER });
  const imgs = body.input[1].content.filter((c) => c.type === 'input_image').map((c) => c.image_url);
  assert.deepEqual(imgs, [SOURCE, MASTER], 'the property evidence AND the approved design');
  assert.match(JSON.stringify(body), /APPROVED DESIGN'S SPECIFICATION/);
  assert.match(JSON.stringify(body), new RegExp(room.id));
  assert.equal(referenceOf('ROOM'), 'MASTER', 'drawn from the approved master');
  const text = imageInstruction(approved, ctx);
  assert.match(text, /generated design of the customer's home they selected as the reference/);
  assert.match(text, /eye-level/);
  assert.match(text, /CONTINUITY — THE SAME HOME AND THE SAME DESIGN/);
  assert.match(text, /#f2f0eb/, 'the approved palette');
  assert.ok(text.indexOf('SOURCE TRUTH') < text.indexOf('DESIGN INTENT'));
});

test('VARIANT: the same property from the same camera, with the requested change only', () => {
  const ev = evidence();
  const approved = validateSpec(sampleSpec(ev), ev);
  const base = { mode: 'VARIANT', evidence: ev, direction: DIRECTION, approvedSpec: approved };
  assert.equal(modeContextProblem(base, { source: true, master: false }), 'MASTER_MISSING');
  const style = imageInstruction(approved, { ...base, change: { style: 'CLASSIC' } });
  assert.match(style, /same camera/); assert.match(style, /classic style/);
  const quality = imageInstruction(approved, { ...base, change: { quality: 'SMART_BUDGET' } });
  assert.match(quality, /same design identity at the smart budget quality level/);
  const again = imageInstruction(approved, { ...base, change: null });
  assert.match(again, /another version of the same look and quality/);
  for (const t of [style, quality, again]) { assert.ok(t.includes(ALWAYS_IMMUTABLE[0])); assert.match(t, /CONTINUITY/); }
  const req = JSON.stringify(specRequest('m', { ...base, change: { style: 'CLASSIC' } }, { source: SOURCE, master: MASTER }));
  assert.match(req, /controlled alternative of the SAME property/);
  assert.match(req, /reinterpret the interior in the new style/);
});

test('the design\'s DNA comes from the specification (palette and light), with no catalogue ids', () => {
  const ev = evidence();
  const spec = validateSpec(sampleSpec(ev), ev);
  const dna = dnaFromSpec(spec, DIRECTION.preferences, 'job-1');
  assert.equal(dna.version, 'ds-dna-1');
  assert.deepEqual(dna.palette.slice(0, 2), ['#f2f0eb', '#c8a27a']);
  assert.equal(dna.finishes.walls.color, '#f2f0eb');
  assert.equal(dna.finishes.floor.color, '#c8a27a');
  assert.equal(dna.finishes.metal, '#2b2d30');
  assert.ok(Object.values(dna.finishes).every((f) => !f || typeof f === 'string' || f.materialId == null));
  assert.equal(dna.sourceJobId, 'job-1');
  assert.ok(dna.look.every((w) => /^[\p{L}][\p{L}\p{M} '-]{0,38}$/u.test(w)));
});

test('the direction is bounded: bad fields fall back, the customer\'s words cannot carry control characters', () => {
  const d = directionFrom({ look: { style: 'modern<script>', quality: 'PREMIUM' }, preferences: { mood: 'EVIL', furnishing: 'STAGED', brief: 'a\u0000b'.repeat(400) } });
  assert.equal(d.look, null);
  assert.equal(d.preferences.mood, 'WARM');
  assert.equal(d.preferences.furnishing, 'STAGED');
  assert.ok(d.preferences.brief.length <= 600 && !/\u0000/.test(d.preferences.brief));
});

test('a room of a whole-home view is an eye-level picture of it IN the approved design; the customer\'s words lead a variant; nothing outside the home', () => {
  const ev = { sourceKind: 'PHOTO', scale: { metresPerPx: null, uncertaintyPct: null, overallM: null, printedSizes: 0 }, stairs: [], rooms: [{ id: 'r1', kind: 'LIVING', label: 'Living', outdoor: false }, { id: 'r2', kind: 'BEDROOM', label: 'Bedroom', outdoor: false, view: 'WHOLE_HOME' }], openings: [] };
  const room = { mode: 'ROOM', evidence: ev, direction: DIRECTION, room: { id: 'r2', name: 'Bedroom' }, change: null, approvedSpec: null };
  assert.equal(roomFromWholeHome(room), true);
  assert.equal(roomFromWholeHome({ ...room, room: { id: 'r1', name: 'Living' } }), false);
  const task = specRequest('m', room, { source: SOURCE, master: MASTER }).input[1].content[0].text;
  assert.match(task, /eye-level architectural photograph of room r2/, 'drawn from the approved design, not over the whole-home photo');
  const spec = validateSpec(sampleSpec({ rooms: ev.rooms, openings: [] }), ev);
  assert.match(imageInstruction(spec, room), /THE FIRST image is the generated design of the customer's home they selected as the reference\. Produce an eye-level/);
  // A variant from the customer's own words: OpenAI makes them the heart of it (never shown back to the customer).
  const wish = { mode: 'VARIANT', evidence: ev, direction: DIRECTION, room: null, change: { style: null, quality: null, note: 'dark green sofa, warmer light' }, approvedSpec: spec };
  assert.match(specRequest('m', wish, { source: SOURCE, master: MASTER }).input[1].content[0].text, /in their own words[^]*dark green sofa, warmer light[^]*heart of this version/);
  // Every picture: nothing outside the home's walls and floor.
  assert.ok(ALWAYS_NEGATIVE.includes('no furniture or objects outside the walls or floor of the home'));
  assert.ok(ALWAYS_IMMUTABLE.some((l) => /nothing outside the building/.test(l)));
});
