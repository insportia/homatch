// A COMMIT MUST DECLARE WHAT IT IS COMMITTING.
//
// storage-sign authorises `commit` as a WRITE, and its content gate
// (checkContent) refuses a WRITE with no declared type for every category
// whose MIME list is not '*' — which is all of them except ANY_SMALL. A
// commit sent as `{ op: 'commit', key }` therefore came back 415 after the
// bytes had already landed, leaving the object ORPHAN-bound and the upload
// reported as failed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkContent } from '../../../../supabase/functions/_shared/storage/keys.ts';

const client = readFileSync(join(process.cwd(), 'src', 'services', 'storage', 'objectStore.ts'), 'utf8');

test('the client commit carries the declared content type and size', () => {
  const commit = client.slice(client.indexOf("op: 'commit'"), client.indexOf("op: 'commit'") + 120);
  assert.match(commit, /contentType/);
  assert.match(commit, /byteSize/);
});

test('the premise: a WRITE with no type is refused for a restricted category', () => {
  const parsed = { content: { mime: ['image/jpeg'], maxBytes: 1000 } };
  assert.deepEqual(checkContent(parsed, undefined, undefined), { ok: false, reason: 'MIME_REQUIRED' });
  assert.deepEqual(checkContent(parsed, 'image/jpeg', 10), { ok: true });
});
