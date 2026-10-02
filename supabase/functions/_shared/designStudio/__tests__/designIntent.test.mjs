// The customer's look, held deterministically: whatever the model says, the
// plan uses the chosen floor and wall directions, the furnishing level's cap,
// and rooms that make sense (a bed in a bedroom, nothing in a corridor).

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUserMessage, normalizeBrief, normalizePreferences, validatePlan } from '../aiPlan.ts';
import * as server from '../designIntent.ts';
import * as browser from '../../../../../src/lib/designStudio/planToHome.ts';

const { ACCENT_FAMILIES, FURNISHING_CAP, MOOD_LIGHTING, WALL_FAMILIES, floorFits, inFamily, offerFor, roleOf, wallFits } = server;

const LOCKS = { layout: false, furniture: false, walls: false, floor: false, kitchen: false, colors: false, lighting: false };

// The dev catalogue as seeded (supabase/migrations/20260930091000_design_studio_dev_catalog.sql).
const A = (code, category, subcategory, roomKinds, styleTags, w, d) => ({ code, name: code, category, subcategory, roomKinds, styleTags, widthM: w, depthM: d });
const ASSETS = [
  A('dev/sofa-3', 'SOFA', 'SOFA_3', ['LIVING'], ['contemporary', 'scandinavian'], 2.2, 0.95),
  A('dev/sofa-2', 'SOFA', 'SOFA_2', ['LIVING', 'BEDROOM'], ['contemporary'], 1.7, 0.9),
  A('dev/armchair', 'ARMCHAIR', null, ['LIVING', 'BEDROOM'], ['contemporary'], 0.85, 0.85),
  A('dev/coffee-table', 'TABLE', 'COFFEE', ['LIVING'], ['contemporary'], 1.1, 0.6),
  A('dev/side-table', 'TABLE', 'SIDE', ['LIVING', 'BEDROOM'], ['contemporary'], 0.5, 0.5),
  A('dev/tv-unit', 'STORAGE', 'MEDIA', ['LIVING'], ['contemporary'], 1.8, 0.45),
  A('dev/bookshelf', 'STORAGE', 'SHELVING', ['LIVING', 'BEDROOM', 'OFFICE'], ['scandinavian'], 0.9, 0.35),
  A('dev/rug-large', 'RUG', null, ['LIVING', 'BEDROOM'], ['contemporary'], 2.4, 1.7),
  A('dev/floor-lamp', 'LIGHTING', 'FLOOR_LAMP', ['LIVING', 'BEDROOM', 'OFFICE'], ['contemporary'], 0.4, 0.4),
  A('dev/plant-large', 'DECOR', 'PLANT', ['LIVING', 'BEDROOM', 'OFFICE', 'BALCONY', 'TERRACE'], ['scandinavian'], 0.5, 0.5),
  A('dev/bed-double', 'BED', 'DOUBLE', ['BEDROOM'], ['contemporary'], 1.6, 2.1),
  A('dev/bed-single', 'BED', 'SINGLE', ['BEDROOM'], ['contemporary'], 0.9, 2.0),
  A('dev/bedside', 'STORAGE', 'BEDSIDE', ['BEDROOM'], ['contemporary'], 0.45, 0.4),
  A('dev/wardrobe-2', 'WARDROBE', null, ['BEDROOM', 'HALL'], ['contemporary'], 1.0, 0.6),
  A('dev/dining-table-4', 'TABLE', 'DINING', ['LIVING', 'KITCHEN'], ['contemporary'], 1.4, 0.9),
  A('dev/dining-chair', 'CHAIR', 'DINING', ['LIVING', 'KITCHEN'], ['contemporary'], 0.45, 0.5),
  A('dev/kitchen-run', 'KITCHEN', 'RUN', ['KITCHEN'], ['contemporary'], 2.4, 0.62),
  A('dev/fridge', 'KITCHEN', 'APPLIANCE', ['KITCHEN'], ['contemporary'], 0.6, 0.65),
  A('dev/vanity', 'BATHROOM', 'VANITY', ['BATHROOM', 'WC'], ['contemporary'], 0.8, 0.46),
  A('dev/toilet', 'BATHROOM', 'TOILET', ['BATHROOM', 'WC'], ['contemporary'], 0.38, 0.68),
  A('dev/shower', 'BATHROOM', 'SHOWER', ['BATHROOM'], ['contemporary'], 0.9, 0.9),
  A('dev/outdoor-chair', 'OUTDOOR', 'CHAIR', ['BALCONY', 'TERRACE'], ['mediterranean'], 0.6, 0.6),
  A('dev/outdoor-table', 'OUTDOOR', 'TABLE', ['BALCONY', 'TERRACE'], ['mediterranean'], 0.7, 0.7),
  A('dev/planter', 'OUTDOOR', 'PLANTER', ['BALCONY', 'TERRACE', 'LIVING'], ['mediterranean'], 0.5, 0.5),
  // An imported piece whose room kinds are unknown: only the room semantics keep it out of a corridor.
  A('imp/bench', 'CHAIR', 'BENCH', [], [], 1.2, 0.4),
];
const M = (code, name, category, appliesTo, color, over = {}) => ({ code, name, category, appliesTo, styleTags: [], color, colorFamily: null, colorTags: [], ...over });
const MATERIALS = [
  M('dev/paint-warm-white', 'Warm white paint', 'WALL', ['WALL', 'CEILING'], '#f2eee6'),
  M('dev/paint-pure-white', 'Pure white paint', 'WALL', ['WALL', 'CEILING'], '#f8f8f6'),
  M('dev/paint-greige', 'Greige paint', 'WALL', ['WALL'], '#d8d0c3'),
  M('dev/paint-sage', 'Sage paint', 'WALL', ['WALL'], '#b6bfa7'),
  M('dev/paint-sand', 'Sand paint', 'WALL', ['WALL'], '#e2d3b9'),
  M('dev/paint-charcoal', 'Charcoal paint', 'WALL', ['WALL'], '#3f4348'),
  M('dev/floor-light-oak', 'Light oak (concept)', 'FLOOR', ['FLOOR'], '#cdb28b', { colorFamily: 'wood' }),
  M('dev/floor-natural-oak', 'Natural oak (concept)', 'FLOOR', ['FLOOR'], '#b48b5e', { colorFamily: 'wood' }),
  M('dev/floor-walnut', 'Walnut (concept)', 'FLOOR', ['FLOOR'], '#6d4b36', { colorFamily: 'wood' }),
  M('dev/floor-grey-oak', 'Grey oak (concept)', 'FLOOR', ['FLOOR'], '#a39a8d', { colorFamily: 'grey' }),
  M('dev/floor-white-stone', 'Pale stone (concept)', 'STONE', ['FLOOR'], '#e7e3dc', { colorFamily: 'white' }),
  M('dev/floor-concrete', 'Polished concrete (concept)', 'FLOOR', ['FLOOR'], '#9e9c98', { colorFamily: 'grey' }),
  M('dev/floor-terracotta-tile', 'Terracotta tile (concept)', 'TILE', ['FLOOR'], '#b9765a', { colorFamily: 'orange' }),
  M('dev/floor-dark-tile', 'Dark tile (concept)', 'TILE', ['FLOOR'], '#44474c', { colorFamily: 'grey' }),
];
const ROOMS = [
  { id: 'r-living', kind: 'LIVING', areaM2: 28, label: null },
  { id: 'r-bed', kind: 'BEDROOM', areaM2: 16, label: null },
  { id: 'r-small-bed', kind: 'BEDROOM', areaM2: 8, label: null },
  { id: 'r-kit', kind: 'KITCHEN', areaM2: 10, label: null },
  { id: 'r-bath', kind: 'BATHROOM', areaM2: 5, label: null },
  { id: 'r-corr', kind: 'CORRIDOR', areaM2: 6, label: null },
  { id: 'r-balc', kind: 'BALCONY', areaM2: 5, label: null },
];
const ctx = (locks = LOCKS, over = {}) => ({ rooms: ROOMS, assets: ASSETS, materials: MATERIALS, locks, existing: {}, ...over });
const ids = new Set(ROOMS.map((r) => r.id));
const prefs = (over = {}) => normalizePreferences({ style: 'scandinavian', mood: 'CALM', floor: 'LIGHT_WOOD', walls: 'WARM_WHITE', accent: 'BRASS', palette: 'WARM', furnishing: 'FULL', brief: '', ...over });
const brief = (p = prefs(), over = {}) => normalizeBrief({ preferences: p, ...over }, ids);
const room = (roomId, over = {}) => ({ roomId, wallColor: null, wallMaterial: null, floorMaterial: null, clearFurniture: false, furniture: [], ...over });
const answer = (rooms, over = {}) => ({ alternatives: [{ title: 'Calm', rationale: '', styleCode: 'scandinavian', palette: ['#f2eee6'], lighting: null, rooms, ...over }] });
const roomOf = (plan, id) => plan.alternatives[0].rooms.find((r) => r.roomId === id);
const roles = (codes) => codes.map((c) => roleOf(ASSETS.find((a) => a.code === c)));
/** Validate against what the route would show the model. */
const run = (raw, b = brief(), c = ctx()) => validatePlan(raw, offerFor(c, b.preferences).ctx, b);

// ── Preferences ──────────────────────────────────────────────────────

test('the server and the browser agree on every choice and every cap', () => {
  for (const k of ['MOODS', 'FLOOR_DIRECTIONS', 'WALL_DIRECTIONS', 'ACCENTS', 'PALETTES', 'FURNISHING_LEVELS', 'FURNISHING_CAP']) {
    assert.deepEqual(server[k], browser[k], k);
  }
  for (const raw of [{}, null, { style: null, mood: 'COZY', floor: 'MARBLE', walls: 'DEEP', accent: 'CHROME', palette: 'COOL', furnishing: 'STAGED', brief: 'warm modern' },
    { style: 'cyberpunk', mood: 'loud', furnishing: 7, brief: 42 }]) {
    assert.deepEqual(normalizePreferences(raw), browser.normalizePreferences(raw), JSON.stringify(raw));
  }
});

test('preferences are bounded and typed; a bad field falls back to its default; null style is custom', () => {
  const p = normalizePreferences({ style: null, mood: 'ANGRY', floor: 'CARPET', walls: 'NEON', accent: 'GOLD', palette: 'HOT', furnishing: 'MAXIMAL', brief: 'x'.repeat(5000), extra: 1 });
  assert.equal(p.style, null);
  assert.deepEqual({ ...p, brief: '' }, { style: null, mood: 'WARM', floor: 'LIGHT_WOOD', walls: 'WARM_WHITE', accent: 'BLACK_METAL', palette: 'WARM', furnishing: 'FULL', brief: '' });
  assert.equal(p.brief.length, 600);
  assert.equal(normalizePreferences({ style: 'japandi' }).style, 'japandi');
  assert.equal(normalizePreferences({}).style, 'contemporary');
});

test('the brief carries the look: its style, its words, one alternative', () => {
  const custom = brief(prefs({ style: null, brief: 'warm modern, light oak, no marble' }));
  assert.equal(custom.styleCode, null);
  assert.equal(custom.text, 'warm modern, light oak, no marble');
  assert.equal(custom.alternatives, 1);
  assert.equal(custom.preferences.furnishing, 'FULL');
  assert.equal(brief(prefs(), { alternatives: 3 }).alternatives, 3);
  // The classic brief is untouched.
  const old = normalizeBrief({ styleCode: 'japandi', text: 'calm' }, ids);
  assert.equal(old.preferences, null);
  assert.equal(old.alternatives, 2);
  assert.equal(old.styleCode, 'japandi');
});

// ── What the model is shown ──────────────────────────────────────────

test('floor materials are pre-filtered by direction, with the nearest fallback', () => {
  const floors = (dir) => offerFor(ctx(), prefs({ floor: dir })).offer;
  assert.deepEqual(floors('LIGHT_WOOD').floorCodes, ['dev/floor-light-oak', 'dev/floor-natural-oak']);
  assert.deepEqual(floors('DARK_WOOD').floorCodes, ['dev/floor-walnut']);
  assert.deepEqual(floors('STONE').floorCodes, ['dev/floor-white-stone']);
  assert.deepEqual(floors('CONCRETE').floorCodes, ['dev/floor-concrete']);
  assert.deepEqual(floors('TILE').floorCodes, ['dev/floor-dark-tile', 'dev/floor-terracotta-tile']);
  // No marble in the dev catalogue: the nearest is stone, and the audit says so.
  assert.deepEqual(floors('MARBLE').floorCodes, ['dev/floor-white-stone']);
  assert.equal(floors('MARBLE').floorFallback, 'STONE');
  // Wood is never offered as the water-safe alternative.
  assert.ok(floors('LIGHT_WOOD').wetFloorCodes.every((c) => !/oak|walnut/.test(c)));
  const shown = offerFor(ctx(), prefs({ floor: 'LIGHT_WOOD' })).ctx.materials.map((m) => m.code);
  assert.ok(!shown.includes('dev/floor-walnut') && !shown.includes('dev/floor-grey-oak'));
});

test('imported textures are matched by name, category and colour tags, not their white tint', () => {
  const oak = { code: 'polyhaven/oak_wood_planks', name: 'Oak Wood Planks', category: 'WOOD', appliesTo: ['FLOOR', 'WALL', 'OBJECT'], styleTags: [], color: '#ffffff', textured: true, colorTags: [] };
  const marble = { code: 'polyhaven/marble_01', name: 'Marble 01', category: 'STONE', appliesTo: ['FLOOR', 'WALL'], styleTags: [], color: '#ffffff', textured: true, colorTags: ['WHITE'] };
  const plaster = { code: 'polyhaven/white_plaster_02', name: 'White Plaster 02', category: 'WALL', appliesTo: ['WALL'], styleTags: [], color: '#ffffff', textured: true, colorTags: ['WHITE'] };
  assert.ok(floorFits(oak, 'LIGHT_WOOD') && !floorFits(oak, 'DARK_WOOD') && !floorFits(oak, 'STONE'));
  assert.ok(floorFits(marble, 'MARBLE') && !floorFits(marble, 'LIGHT_WOOD'));
  assert.ok(wallFits(plaster, 'PLASTER') && wallFits(plaster, 'COOL_WHITE') && !wallFits(plaster, 'DEEP'));
});

test('wall materials and colours follow the chosen family', () => {
  const walls = (dir) => offerFor(ctx(), prefs({ walls: dir })).offer.wallCodes;
  assert.deepEqual(walls('WARM_WHITE'), ['dev/paint-warm-white']);
  assert.deepEqual(walls('COOL_WHITE'), ['dev/paint-pure-white']);
  assert.deepEqual(walls('GREIGE'), ['dev/paint-greige']);
  assert.deepEqual(walls('DEEP'), ['dev/paint-charcoal']);
  assert.ok(walls('PLASTER').includes('dev/paint-sand'));
  for (const [dir, fam] of Object.entries(WALL_FAMILIES)) assert.ok(inFamily(fam, fam.hex), `${dir} default is outside its own family`);
  for (const [acc, fam] of Object.entries(ACCENT_FAMILIES)) assert.ok(inFamily(fam, fam.hex), `${acc} default is outside its own family`);
  assert.ok(!inFamily(WALL_FAMILIES.WARM_WHITE, '#3f4348') && !inFamily(WALL_FAMILIES.DEEP, '#f2eee6'));
});

test('the prompt states the look; a custom style is driven by the brief; unfurnished shows no catalogue', () => {
  const b = brief(prefs({ style: null, brief: 'warm modern', furnishing: 'ESSENTIAL', mood: 'COZY' }));
  const msg = buildUserMessage(b, offerFor(ctx(), b.preferences).ctx);
  assert.match(msg, /STYLE: custom/);
  assert.match(msg, /mood: cozy/);
  assert.match(msg, /at most 3 pieces per room/);
  assert.match(msg, /floors: light wood/);
  assert.match(msg, /brushed brass \(#b08d57\)/);
  assert.match(msg, /nothing in corridors/);
  assert.ok(!/dev\/floor-walnut/.test(msg), 'an off-direction floor was shown');
  assert.ok(!/dev\/floor-lamp/.test(msg), 'a lamp was shown at the essential level');
  const none = brief(prefs({ furnishing: 'UNFURNISHED' }));
  const empty = buildUserMessage(none, offerFor(ctx(), none.preferences).ctx);
  assert.match(empty, /furnishing: none/);
  assert.ok(!/dev\/sofa-3/.test(empty));
  assert.ok(!/\$|€|₾|price/i.test(msg));
});

// ── Holding the plan to the look ─────────────────────────────────────

test('caps cut the list, core pieces of the room programme first, never padded', () => {
  const many = ['dev/rug-large', 'dev/floor-lamp', 'dev/armchair', 'dev/tv-unit', 'dev/bookshelf', 'dev/side-table', 'dev/dining-table-4', 'dev/dining-chair', 'dev/sofa-2', 'dev/coffee-table'];
  const essential = run(answer([room('r-living', { furniture: many })]), brief(prefs({ furnishing: 'ESSENTIAL' })));
  const living = roomOf(essential, 'r-living');
  assert.equal(living.furniture.length, 3);
  assert.deepEqual(roles(living.furniture.slice(0, 2)), ['SOFA', 'COFFEE_TABLE'], 'the core is not first');
  assert.ok(essential.dropped.FURNISHING_CAP >= 1);
  const full = run(answer([room('r-living', { furniture: many })]), brief(prefs({ furnishing: 'FULL' })));
  assert.equal(roomOf(full, 'r-living').furniture.length, FURNISHING_CAP.FULL);
  // Never padded: one piece asked, the core added, nothing else.
  const few = run(answer([room('r-living', { furniture: ['dev/sofa-3'] })]), brief(prefs({ furnishing: 'STAGED' })));
  assert.deepEqual(roomOf(few, 'r-living').furniture, ['dev/sofa-3', 'dev/coffee-table']);
});

test('decor only when the home is staged', () => {
  const ask = answer([room('r-living', { furniture: ['dev/sofa-3', 'dev/coffee-table', 'dev/plant-large', 'dev/rug-large'] })]);
  assert.deepEqual(roomOf(run(ask, brief(prefs({ furnishing: 'STAGED' }))), 'r-living').furniture, ['dev/sofa-3', 'dev/coffee-table', 'dev/plant-large', 'dev/rug-large']);
  // Not offered at FULL, so it is an unknown code there; rugs and lamps stay.
  assert.deepEqual(roomOf(run(ask, brief(prefs({ furnishing: 'FULL' }))), 'r-living').furniture, ['dev/sofa-3', 'dev/coffee-table', 'dev/rug-large']);
  assert.deepEqual(roomOf(run(ask, brief(prefs({ furnishing: 'ESSENTIAL' }))), 'r-living').furniture, ['dev/sofa-3', 'dev/coffee-table']);
});

test('unfurnished: no furniture anywhere, finishes and light still applied', () => {
  const plan = run(answer([room('r-living', { furniture: ['dev/sofa-3'], floorMaterial: 'dev/floor-light-oak' }), room('r-bed', { furniture: ['dev/bed-double'] })]), brief(prefs({ furnishing: 'UNFURNISHED', mood: 'DRAMATIC' })));
  const alt = plan.alternatives[0];
  assert.ok(alt.rooms.length >= 5);
  for (const r of alt.rooms) assert.deepEqual(r.furniture, [], r.roomId);
  assert.equal(roomOf(plan, 'r-living').floorMaterial, 'dev/floor-light-oak');
  assert.deepEqual(alt.lighting, MOOD_LIGHTING.DRAMATIC);
});

test('room semantics: beds sized to the room, kitchens, bathrooms, nothing in a corridor, outdoor pieces outside', () => {
  const plan = run(answer([
    room('r-bed', { furniture: ['dev/sofa-2'] }),
    room('r-small-bed', { furniture: ['dev/bed-double'] }),
    room('r-corr', { furniture: ['dev/wardrobe-2', 'imp/bench'] }),
    room('r-balc', { furniture: ['dev/plant-large'] }),
  ]), brief(prefs({ furnishing: 'FULL' })));
  // A sofa is never a bedroom's only seating: the bed comes first, the sofa goes in a 16 m² room only beside it.
  const bed = roomOf(plan, 'r-bed').furniture;
  assert.equal(bed[0], 'dev/bed-double');
  assert.ok(!roles(bed).includes('SOFA') || bed.includes('dev/bed-double'));
  // An 8 m² bedroom gets a single bed, not the double the model chose.
  assert.equal(roomOf(plan, 'r-small-bed').furniture[0], 'dev/bed-single');
  // The kitchen gets its run, and a dining table at 10 m².
  assert.deepEqual(roles(roomOf(plan, 'r-kit').furniture), ['KITCHEN_RUN', 'DINING_TABLE']);
  assert.deepEqual(roles(roomOf(plan, 'r-bath').furniture), ['TOILET', 'VANITY', 'SHOWER']);
  // The corridor keeps its finishes and gets no furniture.
  assert.deepEqual(roomOf(plan, 'r-corr').furniture, []);
  assert.ok(roomOf(plan, 'r-corr').wallColor);
  // Balcony: plants and outdoor pieces only, topped up from the programme.
  const balc = roles(roomOf(plan, 'r-balc').furniture);
  assert.ok(balc.every((r) => ['PLANT', 'PLANTER', 'OUTDOOR_CHAIR', 'OUTDOOR_TABLE', 'OUTDOOR_SOFA', 'OUTDOOR_OTHER'].includes(r)), balc.join());
  assert.ok(balc.includes('OUTDOOR_CHAIR') && balc.includes('OUTDOOR_TABLE'));
  assert.ok(plan.intent.filled.ROOM_PROGRAMME >= 5);
  assert.ok(plan.dropped.ROOM_SEMANTICS >= 1);
});

test('a small kitchen gets a run but no dining table; a kitchen that has one is not given another', () => {
  const small = { ...ctx(), rooms: [{ id: 'r-kit', kind: 'KITCHEN', areaM2: 7, label: null }] };
  const b = normalizeBrief({ preferences: prefs() }, new Set(['r-kit']));
  assert.deepEqual(roles(roomOf(run(answer([]), b, small), 'r-kit').furniture), ['KITCHEN_RUN']);
  const has = { ...small, existing: { 'r-kit': ['dev/kitchen-run'] } };
  assert.deepEqual(roomOf(run(answer([]), b, has), 'r-kit').furniture, []);
});

test('off-direction colours and floors are replaced by the chosen family; wet rooms get a water-safe floor', () => {
  const plan = run(answer([
    room('r-living', { wallColor: '#3f4348', floorMaterial: 'dev/floor-light-oak' }),
    room('r-bath', { floorMaterial: 'dev/floor-light-oak' }),
  ]), brief(prefs({ walls: 'WARM_WHITE', floor: 'LIGHT_WOOD' })));
  assert.equal(roomOf(plan, 'r-living').wallColor, WALL_FAMILIES.WARM_WHITE.hex);
  assert.equal(roomOf(plan, 'r-living').floorMaterial, 'dev/floor-light-oak');
  assert.ok(!/oak/.test(roomOf(plan, 'r-bath').floorMaterial), roomOf(plan, 'r-bath').floorMaterial);
  assert.ok(plan.dropped.OFF_DIRECTION_COLOR === 1 && plan.dropped.OFF_DIRECTION_MATERIAL === 1);
  // An off-direction floor is not even offered, so the model cannot pick it.
  const walnut = run(answer([room('r-living', { floorMaterial: 'dev/floor-walnut' })]));
  assert.equal(roomOf(walnut, 'r-living').floorMaterial, 'dev/floor-light-oak');
  assert.equal(walnut.dropped.UNKNOWN_MATERIAL, 1);
});

test('the accent joins the palette and the mood sets the light the model left out', () => {
  const plan = run(answer([], { palette: ['#f2eee6', '#d8d0c3'], lighting: { timeOfDay: 'DAY', temperature: null, interiorIntensity: null } }), brief(prefs({ accent: 'BRASS', mood: 'COZY' })));
  const alt = plan.alternatives[0];
  assert.deepEqual(alt.palette, ['#f2eee6', '#d8d0c3', ACCENT_FAMILIES.BRASS.hex]);
  assert.deepEqual(alt.lighting, { timeOfDay: 'DAY', temperature: 'WARM', interiorIntensity: 0.8 });
  // A palette that already has the accent is left alone.
  const has = run(answer([], { palette: ['#f2eee6', '#232323'] }), brief(prefs({ accent: 'BLACK_METAL' })));
  assert.deepEqual(has.alternatives[0].palette, ['#f2eee6', '#232323']);
});

test('what the customer keeps still wins over the look', () => {
  const b = brief(prefs());
  const plan = run(answer([room('r-living', { furniture: ['dev/sofa-3'] })]), b, ctx({ ...LOCKS, furniture: true, walls: true, floor: true, lighting: true, colors: true }));
  // Nothing may change, so nothing is proposed.
  assert.equal(plan.alternatives.length, 0);
  const kitchen = run(answer([room('r-kit', { wallColor: '#f2eee6' })]), b, ctx({ ...LOCKS, kitchen: true }));
  assert.equal(roomOf(kitchen, 'r-kit'), undefined);
});

test('same answer, same look, same plan', () => {
  const raw = answer([room('r-living', { furniture: ['dev/sofa-3'] }), room('r-bed', {})]);
  assert.deepEqual(run(raw), run(raw));
});

test('the classic brief is exactly as before: no intent, no top-up, no defaults', () => {
  const b = normalizeBrief({ styleCode: 'scandinavian', alternatives: 1 }, ids);
  const plan = validatePlan(answer([room('r-bed', { furniture: ['dev/sofa-2'] })]), ctx(), b);
  assert.equal(plan.intent, undefined);
  assert.deepEqual(plan.alternatives[0].rooms, [room('r-bed', { furniture: ['dev/sofa-2'] })]);
  assert.equal(plan.alternatives[0].lighting, null);
  assert.deepEqual(plan.alternatives[0].palette, ['#f2eee6']);
});
