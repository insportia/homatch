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
