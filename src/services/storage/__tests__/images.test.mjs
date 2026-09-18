// THE READ PATH: R2 FIRST, SUPABASE ONLY WHEN THE OBJECT IS NOT THERE.
//
// There is exactly one dangerous mistake available in a fallback, and it is
// this: falling back after a REFUSAL. The R2 path asks `storage-sign`, which
// asks Postgres whose object it is. If that says NOT_OWNER and the code then
// asks Supabase Storage for the same bytes through a different mechanism,
// the fallback has become an authorisation bypass — and it would look like a
// resilience feature in review.
//
// So these tests are mostly about which failures are allowed to fall
// through. NOT_FOUND and UNAVAILABLE may; every refusal is final.

import test from 'node:test';
import assert from 'node:assert/strict';

/*
 * The module reaches for the Supabase client and the signer at import time,
 * so both are replaced before it loads. `register` is the documented hook
 * for this and needs no bundler.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Records what each layer was asked for during one resolve(). */
const calls = { r2: [], supabase: [] };
/** What the fake signer should do next. */
let r2Behaviour = { ok: true };

const dir = mkdtempSync(join(tmpdir(), 'homatch-images-'));
const loader = join(dir, 'loader.mjs');
const state = join(dir, 'state.mjs');

writeFileSync(state, `
export const calls = ${JSON.stringify(calls)};
export const control = { behaviour: { ok: true } };
export class StorageError extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}
export async function signedReadUrl(key) {
  calls.r2.push(key);
  const b = control.behaviour;
  if (!b.ok) throw new StorageError(b.reason);
  return { url: 'https://r2.example/' + encodeURIComponent(key), expiresAt: 'x' };
}
export const supabase = {
  storage: {
    from(bucket) {
      return {
        createSignedUrl(path) {
          calls.supabase.push(bucket + '/' + path);
          return Promise.resolve(control.supabaseFails
            ? { data: null, error: new Error('no') }
            : { data: { signedUrl: 'https://supabase.example/' + path }, error: null });
        },
      };
    },
  },
};
`);

writeFileSync(loader, `
import { pathToFileURL } from 'node:url';
const STATE = ${JSON.stringify(pathToFileURL(state).href)};
export async function resolve(specifier, context, next) {
  if (specifier.endsWith('/objectStore') || specifier.endsWith('objectStore.ts')
      || specifier === './objectStore') {
    return { url: STATE, shortCircuit: true };
  }
  if (specifier === '@/db/supabase') return { url: STATE, shortCircuit: true };
  return next(specifier, context);
}
`);

register(pathToFileURL(loader).href);

const { control, calls: seen } = await import(pathToFileURL(state).href);
const images = await import('../images.ts');

function reset(behaviour = { ok: true }, supabaseFails = false) {
  seen.r2.length = 0;
  seen.supabase.length = 0;
  control.behaviour = behaviour;
  control.supabaseFails = supabaseFails;
  images.clearImageUrlCache();
  images.storageReadStats.r2 = 0;
  images.storageReadStats.supabaseFallback = 0;
  images.storageReadStats.refused = 0;
  images.storageReadStats.failed = 0;
}

test('an absolute URL is passed straight through, unsigned', async () => {
  reset();
  for (const url of ['https://cdn.example/a.jpg', 'data:image/png;base64,AAA', 'blob:x']) {
    assert.equal(await images.resolveImageSrc(url), url);
  }
  assert.equal(seen.r2.length, 0, 'an imported listing image must not be signed');
  assert.equal(seen.supabase.length, 0);
});

test('nothing to show resolves to null rather than an empty src', async () => {
  reset();
  for (const value of [null, undefined, '', '   ']) {
    assert.equal(await images.resolveImageSrc(value), null);
  }
});

test('a stored key is read from R2 first', async () => {
  reset();
  const url = await images.resolveImageSrc('users/11111111-1111-1111-1111-111111111111/property-photos/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333.jpg');
  assert.ok(url.startsWith('https://r2.example/'));
  assert.equal(seen.supabase.length, 0, 'Supabase must not be asked when R2 answered');
  assert.equal(images.storageReadStats.r2, 1);
});

test('a bare legacy path is given its bucket prefix before R2 is asked', async () => {
  reset();
  await images.resolveImageSrc('some-user/some-property/photo.jpg');
  assert.equal(seen.r2[0], 'property-photos/some-user/some-property/photo.jpg');
});

test('NOT_FOUND falls back to Supabase, because that is a migration gap', async () => {
  reset({ ok: false, reason: 'NOT_FOUND' });
  const url = await images.resolveImageSrc('property-photos/a/b.jpg');
  assert.ok(url.startsWith('https://supabase.example/'));
  assert.equal(seen.supabase[0], 'property-photos/a/b.jpg');
  assert.equal(images.storageReadStats.supabaseFallback, 1);
  assert.equal(images.storageReadStats.refused, 0);
});

test('UNAVAILABLE falls back too: an outage is not an answer about ownership', async () => {
  reset({ ok: false, reason: 'UNAVAILABLE' });
  assert.ok((await images.resolveImageSrc('property-photos/a/b.jpg')).startsWith('https://supabase'));
  assert.equal(images.storageReadStats.supabaseFallback, 1);
});

test('A REFUSAL IS FINAL. The fallback must never route around it.', async () => {
  for (const reason of ['NOT_OWNER', 'NOT_ADMIN', 'NO_CAPABILITY', 'UNAUTHENTICATED', 'INVALID_KEY']) {
    reset({ ok: false, reason });
    const url = await images.resolveImageSrc('property-photos/somebody-else/contract.jpg');
    assert.equal(url, null, `${reason} must not fall through`);
    assert.equal(seen.supabase.length, 0,
      `${reason} asked Supabase for the same object — that is an authorisation bypass`);
    assert.equal(images.storageReadStats.refused, 1);
    assert.equal(images.storageReadStats.supabaseFallback, 0);
  }
});

test('when both sides fail, the answer is null and it is counted as a failure', async () => {
  reset({ ok: false, reason: 'NOT_FOUND' }, true);
  assert.equal(await images.resolveImageSrc('property-photos/a/b.jpg'), null);
  assert.equal(images.storageReadStats.failed, 1);
  assert.equal(images.storageReadStats.supabaseFallback, 0);
});

test('the same key is signed once and reused, until the cache is cleared', async () => {
  reset();
  await images.resolveImageSrc('property-photos/a/b.jpg');
  await images.resolveImageSrc('property-photos/a/b.jpg');
  await images.resolveImageSrc('property-photos/a/b.jpg');
  assert.equal(seen.r2.length, 1, 'a gallery must not re-sign the same key per render');
  images.clearImageUrlCache();
  await images.resolveImageSrc('property-photos/a/b.jpg');
  assert.equal(seen.r2.length, 2);
});
