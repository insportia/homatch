// A finished render picture must be stored under a key storage-sign will sign.
// The first production finish was stored as `<render>-final.png`: it saved, then
// every read was refused as INVALID_KEY and the home page showed no picture.

import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPictureKey, uuidFrom } from '../renderKeys.ts';
import { parseKey } from '../../storage/keys.ts';

const row = { id: '232a977c-e7a2-4d1d-a15a-f48ac3d3a37e', user_id: '5157044e-9158-437a-86a2-e34d5ada82f7', project_id: 'e1415ef1-74e6-4603-8f68-46262f9be118' };

test('finish and edit pictures get keys the signer parses, under the owner and project', async () => {
  for (const [role, mime, ext] of [['final', 'image/png', 'png'], ['final', 'image/jpeg', 'jpg'], ['final', 'image/webp', 'webp'], ['edit', 'image/png', 'png']]) {
    const key = await renderPictureKey(row, role, mime);
    assert.doesNotThrow(() => parseKey(key), key);
    assert.match(key, new RegExp(`^users/${row.user_id}/design-studio-thumbnails/${row.project_id}/[0-9a-f-]{36}\\.${ext}$`));
  }
});

test('the key is stable per render and role (a retry overwrites, never orphans), and distinct across them', async () => {
  assert.equal(await renderPictureKey(row, 'final', 'image/png'), await renderPictureKey(row, 'final', 'image/png'));
  assert.notEqual(await renderPictureKey(row, 'final', 'image/png'), await renderPictureKey(row, 'edit', 'image/png'));
  assert.notEqual(await renderPictureKey(row, 'final', 'image/png'), await renderPictureKey({ ...row, id: '00000000-0000-4000-8000-000000000001' }, 'final', 'image/png'));
  assert.match(await uuidFrom('x'), /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
