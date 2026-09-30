// A floor's laying pattern, from the reader's code or — when it gave none —
// its own material words, in any of the six languages. The Georgian cases
// are the words the production reader actually returned for the acceptance
// render (it wrote "light oak, herringbone" but no code).

import test from 'node:test';
import assert from 'node:assert/strict';
import { floorPattern, validateReconstruction } from '../reconstructRead.ts';

test('exact codes and their usual spellings', () => {
  assert.equal(floorPattern('WOOD_HERRINGBONE', null), 'WOOD_HERRINGBONE');
  assert.equal(floorPattern('herringbone', null), 'WOOD_HERRINGBONE');
  assert.equal(floorPattern('wood plank', null), 'WOOD_PLANK');
  assert.equal(floorPattern('Tiles', null), 'TILE');
  assert.equal(floorPattern('marble', null), 'STONE');
});

test('no code: the reader\'s own words, in every language', () => {
  assert.equal(floorPattern(null, 'ღია მუხა, ჰერინგბონი'), 'WOOD_HERRINGBONE');
  assert.equal(floorPattern(null, 'ნაცრისფერი ფილა'), 'TILE');
  assert.equal(floorPattern(null, 'მუქი ფილა'), 'TILE');
  assert.equal(floorPattern(null, 'Светлый дуб, ёлочка'), 'WOOD_HERRINGBONE');
  assert.equal(floorPattern(null, 'Серая плитка'), 'TILE');
  assert.equal(floorPattern(null, 'Açık meşe balıksırtı'), 'WOOD_HERRINGBONE');
  assert.equal(floorPattern(null, 'بلاط رمادي'), 'TILE');
  assert.equal(floorPattern(null, 'פרקט אלון בהיר'), 'WOOD_HERRINGBONE');
  assert.equal(floorPattern(null, 'light oak'), 'WOOD_PLANK');
  assert.equal(floorPattern(null, 'herringbone oak'), 'WOOD_HERRINGBONE', 'herringbone wins over plain wood');
});

test('nothing seen, nothing invented', () => {
  assert.equal(floorPattern(null, null), null);
  assert.equal(floorPattern('', ''), null);
  assert.equal(floorPattern('SPARKLY', 'white paint'), null);
  assert.equal(floorPattern(null, 'თეთრი საღებავი'), null);
});

test('a reading keeps floor patterns and never puts one on walls', () => {
  const raw = {
    view: 'AERIAL', scaleConfidence: 0.5, scaleEvidence: null, ceilingHeightM: null,
    rooms: [{ key: 'a', kind: 'LIVING', label: null, polygon: [[0, 0], [5, 0], [5, 4], [0, 4]], outdoor: false, confidence: 0.8, basis: 'OBSERVED' }],
    openings: [], objects: [], palette: [], styleWords: [], cameras: [], unknowns: [],
    surfaces: [
      { room: 'a', part: 'FLOOR', color: '#d8cfc1', material: 'ღია მუხა, ჰერინგბონი', confidence: 0.9 },
      { room: 'a', part: 'WALLS', color: '#ffffff', material: 'ფილა', confidence: 0.9, pattern: 'TILE' },
    ],
  };
  const { recon } = validateReconstruction(raw, 1);
  assert.equal(recon.surfaces[0].pattern, 'WOOD_HERRINGBONE');
  assert.equal(recon.surfaces[1].pattern, null);
});
