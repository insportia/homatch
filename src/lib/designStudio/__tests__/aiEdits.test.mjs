// Editing a picture OpenAI made goes through the SAME edit pipeline: the edit
// built for an "ai:…" target is exactly the APPEARANCE contract render-edit
// validates, and the pipeline's own prompt paints with it. Spatial changes are
// never offered (they would need the 3D path, which does not design the picture).

import test from 'node:test';
import assert from 'node:assert/strict';
import { aiActionsFor, aiAppearanceEdit, aiWhat, isAiEntry } from '../renders/aiEdits.ts';
import { editPrompt } from '../../../../supabase/functions/_shared/designStudio/renderPrompt.ts';

const sofa = { color: '#0a0b0c', kind: 'OBJECT', id: 'ai:sofa:1', roomId: 'R7', coverage: 0.02, box: [0.3, 0.4, 0.5, 0.6] };
const wall = { ...sofa, kind: 'WALL', id: 'ai:wall:2' };
const floor = { ...sofa, kind: 'FLOOR', id: 'ai:floor:1' };
const blender = { ...sofa, id: 'obj-1f2e' };

test('an AI target offers appearance changes only; a 3D-design target is not the adapter\'s', () => {
  assert.deepEqual(aiActionsFor(sofa), ['COLOR']);
  assert.deepEqual(aiActionsFor(wall), ['PAINT']);
  assert.deepEqual(aiActionsFor({ ...sofa, kind: 'CEILING', id: 'ai:ceiling:1' }), ['PAINT']);
  assert.deepEqual(aiActionsFor(floor), ['MATERIAL']);
  assert.deepEqual(aiActionsFor(blender), [], 'the existing catalogue path keeps its own targets');
  assert.equal(isAiEntry(sofa), true); assert.equal(isAiEntry(blender), false);
  assert.equal(aiWhat({ id: 'ai:kitchen_cabinets:3' }), 'kitchen_cabinets');
  for (const op of [{ action: 'MOVE', to: { x: 1, y: 1 }, roomId: null }, { action: 'REMOVE' }, { action: 'REPLACE', assetId: 'x' }, { action: 'ROTATE', rotationY: 1 }]) {
    assert.equal(aiAppearanceEdit(sofa, op, 'x'), null, `${op.action} is never offered on an AI picture`);
  }
});

test('the edit is exactly the pipeline\'s APPEARANCE contract, and its prompt paints the right thing', () => {
  const colour = aiAppearanceEdit(sofa, { action: 'COLOR', color: '#9FAE94' }, '#9fae94');
  assert.deepEqual(colour, { type: 'APPEARANCE', targetId: 'ai:sofa:1', targetKind: 'OBJECT', color: '#9fae94', materialId: null, label: 'sofa' });
  // render-edit's own checks (renders.ts validateAppearance): target id, kind, colour or material, label ≤ 80.
  assert.match(colour.targetId, /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/);
  assert.ok(['OBJECT', 'FLOOR', 'WALL', 'CEILING', 'STAIRS', 'DOOR', 'WINDOW', 'OTHER'].includes(colour.targetKind));
  assert.match(editPrompt(colour), /repaint the object as sofa in the colour #9fae94/);
  assert.match(editPrompt(colour), /Everything outside the masked area must stay exactly as it is/);
  const paint = aiAppearanceEdit(wall, { action: 'PAINT', color: '#f2f0eb' }, '#f2f0eb');
  assert.equal(paint.targetKind, 'WALL'); assert.equal(paint.label, 'wall');
  const material = aiAppearanceEdit(floor, { action: 'MATERIAL', materialId: 'dev/floor-natural-oak' }, 'Natural oak');
  assert.deepEqual(material, { type: 'APPEARANCE', targetId: 'ai:floor:1', targetKind: 'FLOOR', color: null, materialId: 'dev/floor-natural-oak', label: 'Natural oak' });
  assert.match(editPrompt(material), /repaint the floor as Natural oak/);
  assert.equal(aiAppearanceEdit(sofa, { action: 'COLOR', color: 'red' }, 'red'), null, 'not a colour');
  assert.equal(aiAppearanceEdit(sofa, { action: 'PAINT', color: '#ffffff' }, 'x'), null, 'paint is for walls and ceilings');
});
