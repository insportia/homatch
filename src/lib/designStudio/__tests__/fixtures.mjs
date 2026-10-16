// TEST FIXTURES — typed by a person, not read from any real drawing.
//
// A one-bedroom apartment at 1 px = 1 cm, 10 x 7 m, every element marked
// VERIFIED so HOMATCH's deterministic generator builds it. Used by unit tests
// and by the browser QA harness to drive the workspace; never shipped to a
// customer and never presented as a real property.
//
//   +------------------------+----------------+
//   |                        |    BEDROOM     |
//   |        LIVING          |    16 m²       |
//   |        42 m²           +-------+--------+
//   |                        | BATH  |  HALL  |  <- entry door (east)
//   +------------------------+-------+--------+

import { generateScene } from '../../floorplan/geometry.ts';

const W = (id, x1, y1, x2, y2, kind = 'INTERIOR') => ({
  id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, kind,
  thicknessPx: kind === 'EXTERIOR' ? 25 : 10, confidence: 1, evidence: 'fixture', state: 'VERIFIED',
});
const O = (id, wallId, position, widthPx, extra = {}) => ({
  id, wallId, position, widthPx, confidence: 1, evidence: 'fixture', state: 'VERIFIED', ...extra,
});
const R = (id, kind, label, pts, area) => ({
  id, kind, label, polygon: pts.map(([x, y]) => ({ x, y })), statedAreaM2: area,
  confidence: 1, evidence: 'fixture', state: 'VERIFIED',
});

export function oneBedroomDoc() {
  return {
    sourceAssetId: 'fixture',
    imageWidth: 1000,
    imageHeight: 700,
    detectedScale: 0.01,
    scaleConfidence: 1,
    scaleEvidence: 'fixture',
    ceilingHeight: 2.7,
    ceilingHeightSource: 'OPERATOR',
    walls: [
      W('w-n', 0, 0, 1000, 0, 'EXTERIOR'),
      W('w-e', 1000, 0, 1000, 700, 'EXTERIOR'),
      W('w-s', 1000, 700, 0, 700, 'EXTERIOR'),
      W('w-w', 0, 700, 0, 0, 'EXTERIOR'),
      W('w-i1', 600, 0, 600, 700),
      W('w-i2', 600, 400, 1000, 400),
      W('w-i3', 800, 400, 800, 700),
    ],
    doors: [
      O('d-bed', 'w-i1', 200 / 700, 90, { sillHeightM: 0, heightM: 2.1 }),
      O('d-hall', 'w-i1', 550 / 700, 100, { sillHeightM: 0, heightM: 2.1 }),
      O('d-bath', 'w-i3', 0.5, 80, { sillHeightM: 0, heightM: 2.1 }),
      O('d-bed2', 'w-i2', 0.75, 90, { sillHeightM: 0, heightM: 2.1 }),
      O('d-entry', 'w-e', 550 / 700, 100, { sillHeightM: 0, heightM: 2.1 }),
    ],
    windows: [
      O('win-living-w', 'w-w', 0.5, 180, { sillHeightM: 0.9, heightM: 1.4 }),
      O('win-living-n', 'w-n', 0.3, 160, { sillHeightM: 0.9, heightM: 1.4 }),
      O('win-bed', 'w-n', 0.8, 140, { sillHeightM: 0.9, heightM: 1.4 }),
    ],
    rooms: [
      R('r-living', 'LIVING', 'Living', [[0, 0], [600, 0], [600, 700], [0, 700]], 42),
      R('r-bed', 'BEDROOM', 'Bedroom', [[600, 0], [1000, 0], [1000, 400], [600, 400]], 16),
      R('r-bath', 'BATHROOM', 'Bathroom', [[600, 400], [800, 400], [800, 700], [600, 700]], 6),
      R('r-hall', 'HALL', 'Hall', [[800, 400], [1000, 400], [1000, 700], [800, 700]], 6),
    ],
    balconies: [],
    unknownElements: [],
    warnings: [],
    extractionConfidence: 1,
  };
}

export function oneBedroomScene() {
  const { scene, validation } = generateScene(oneBedroomDoc());
  if (!scene) throw new Error(`fixture does not build: ${JSON.stringify(validation.problems)}`);
  return scene;
}

const asset = (code, category, w, d, h, over = {}) => ({
  id: `id-${code}`, code, name: code, category, subcategory: null, roomKinds: [], styleTags: [], colorTags: [],
  materialTags: [], widthM: w, depthM: d, heightM: h, placement: 'FLOOR', anchor: 'WALL', clearanceM: 0,
  procedural: { kind: 'CABINET' }, modelKey: null, lods: [], triangles: null, textureBytes: null, thumbnailKey: null,
  materialSlots: [], variants: [], dominantColors: [], provenance: 'HOMATCH_DEV_PLACEHOLDER', isPlaceholder: true,
  active: true, ...over,
});

export function testAssets() {
  return new Map([
    asset('dev/sofa-3', 'SOFA', 2.2, 0.95, 0.82, {
      clearanceM: 0.9, procedural: { kind: 'SOFA' },
      variants: [{ id: 'sand', name: 'Sand', colors: { body: '#d8c8b0' } }],
    }),
    asset('dev/sofa-2', 'SOFA', 1.7, 0.9, 0.82, { clearanceM: 0.8, procedural: { kind: 'SOFA' } }),
    asset('dev/sofa-xl', 'SOFA', 3.4, 1.0, 0.82, { procedural: { kind: 'SOFA' } }),
    asset('dev/coffee-table', 'TABLE', 1.1, 0.6, 0.42, { anchor: 'CENTRE', procedural: { kind: 'TABLE' } }),
    asset('dev/rug-large', 'RUG', 2.4, 1.7, 0.01, { anchor: 'CENTRE', procedural: { kind: 'RUG' } }),
    asset('dev/bed-double', 'BED', 1.6, 2.05, 0.95, { clearanceM: 0.6, procedural: { kind: 'BED' } }),
    asset('dev/wardrobe', 'WARDROBE', 1.8, 0.6, 2.2, { clearanceM: 0.8 }),
    asset('dev/kitchen-run', 'KITCHEN', 2.4, 0.62, 0.9, { clearanceM: 1.0 }),
    asset('dev/retired', 'SOFA', 2.0, 0.9, 0.8, { active: false }),
  ].map((a) => [a.code, a]));
}

export function testMaterials() {
  const m = (id, appliesTo, baseColor) => ({
    id, code: id, name: id, category: appliesTo.includes('FLOOR') ? 'FLOOR' : 'WALL', appliesTo, styleTags: [],
    colorFamily: null, pbr: { baseColor, roughness: 0.6, metalness: 0 }, thumbnailKey: null,
    provenance: 'HOMATCH_DEV_PLACEHOLDER', isPlaceholder: true, active: true,
  });
  return new Map([
    ['m-oak', m('m-oak', ['FLOOR'], '#b48b5e')],
    ['m-warm-white', m('m-warm-white', ['WALL', 'CEILING'], '#f2eee6')],
  ]);
}

/*
 * The whole-home tour fixture: eight rooms, every one reached through a real
 * doorway, 12 x 10 m at 1 px = 1 cm (typed by a person, never a real home).
 *
 *   +--------------+---------+---------+
 *   |              | BED 1   | BED 2   |
 *   |   LIVING     |         |         |
 *   |              +----d----+----d----+
 *   |              d    CORRIDOR       |
 *   +------d-------+--d------+----d----+
 *   |   KITCHEN    |  BATH   |ENTRANCE d <- entry door (east)
 *   |              |         |         |
 *   +------d-------+---------+---------+
 *   |   BALCONY    |
 *   +--------------+
 *
 * `omit` drops doors by id (an unreachable room for the reachability tests).
 */
export function tourApartmentDoc({ omit = [] } = {}) {
  const door = (id, wallId, position, widthPx) => O(id, wallId, position, widthPx, { sillHeightM: 0, heightM: 2.1 });
  return {
    sourceAssetId: 'fixture-tour',
    imageWidth: 1200,
    imageHeight: 1000,
    detectedScale: 0.01,
    scaleConfidence: 1,
    scaleEvidence: 'fixture',
    ceilingHeight: 2.7,
    ceilingHeightSource: 'OPERATOR',
    walls: [
      W('w-n', 0, 0, 1200, 0, 'EXTERIOR'),
      W('w-e', 1200, 0, 1200, 850, 'EXTERIOR'),
      W('w-s1', 1200, 850, 600, 850, 'EXTERIOR'),
      W('w-s2', 600, 850, 0, 850, 'EXTERIOR'),
      W('w-w', 0, 850, 0, 0, 'EXTERIOR'),
      W('w-bw', 0, 1000, 0, 850, 'EXTERIOR'),
      W('w-bs', 600, 1000, 0, 1000, 'EXTERIOR'),
      W('w-be', 600, 850, 600, 1000, 'EXTERIOR'),
      W('w-i1', 600, 0, 600, 850),
      W('w-i2', 0, 500, 600, 500),
      W('w-i3', 900, 0, 900, 400),
      W('w-i4', 600, 400, 1200, 400),
      W('w-i5', 600, 550, 1200, 550),
      W('w-i6', 850, 550, 850, 850),
    ],
    doors: [
      door('d-entry', 'w-e', 700 / 850, 100),
      door('d-entry-corr', 'w-i5', 425 / 600, 90),
      door('d-living', 'w-i1', 450 / 850, 80),
      door('d-bed1', 'w-i4', 150 / 600, 90),
      door('d-bed2', 'w-i4', 450 / 600, 90),
      door('d-bath', 'w-i5', 125 / 600, 80),
      door('d-kitchen', 'w-i2', 0.5, 90),
      door('d-balcony', 'w-s2', 0.5, 90),
    ].filter((d) => !omit.includes(d.id)),
    windows: [
      O('win-living', 'w-w', 0.75, 180, { sillHeightM: 0.9, heightM: 1.4 }),
      O('win-kitchen', 'w-w', 0.25, 120, { sillHeightM: 0.9, heightM: 1.4 }),
      O('win-bed1', 'w-n', 0.62, 120, { sillHeightM: 0.9, heightM: 1.4 }),
      O('win-bed2', 'w-n', 0.88, 120, { sillHeightM: 0.9, heightM: 1.4 }),
    ],
    rooms: [
      R('r-living', 'LIVING', 'Living', [[0, 0], [600, 0], [600, 500], [0, 500]], 30),
      R('r-bed1', 'BEDROOM', 'Bedroom 1', [[600, 0], [900, 0], [900, 400], [600, 400]], 12),
      R('r-bed2', 'BEDROOM', 'Bedroom 2', [[900, 0], [1200, 0], [1200, 400], [900, 400]], 12),
      R('r-corr', 'CORRIDOR', 'Corridor', [[600, 400], [1200, 400], [1200, 550], [600, 550]], 9),
      R('r-kitchen', 'KITCHEN', 'Kitchen', [[0, 500], [600, 500], [600, 850], [0, 850]], 21),
      R('r-bath', 'BATHROOM', 'Bathroom', [[600, 550], [850, 550], [850, 850], [600, 850]], 7.5),
      R('r-entry', 'HALL', 'Entrance', [[850, 550], [1200, 550], [1200, 850], [850, 850]], 10.5),
    ],
    balconies: [
      R('r-balcony', 'BALCONY', 'Balcony', [[0, 850], [600, 850], [600, 1000], [0, 1000]], 9),
    ],
    unknownElements: [],
    warnings: [],
    extractionConfidence: 1,
  };
}

export function tourApartmentScene(opts) {
  const { scene, validation } = generateScene(tourApartmentDoc(opts));
  if (!scene) throw new Error(`tour fixture does not build: ${JSON.stringify(validation.problems)}`);
  return scene;
}
