import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/*
 * LISTINGS / INGESTION — STATIC.
 *
 * Creating a listing writes three things: the property row, its facts, and its
 * search profile. Only the first one was checked.
 *
 *   upsertPropertyFacts   logged the error and returned. The facts ARE the
 *                         listing -- price, city, area, rooms -- so a failure
 *                         here produced "Property added successfully!" for a
 *                         property with no price and no location.
 *
 *   createSearchProfile   discarded the error entirely. The search profile is
 *                         what the matching engine matches demand against, so
 *                         a property without one is invisible to matching --
 *                         which reads to the owner as the engine being broken
 *                         rather than the listing never having been finished.
 *
 * Both call sites (PrivateListingPage, URLImportPage) already wrap the whole
 * save in a try/catch that shows the customer a real message. They just were
 * never given anything to catch.
 */

const ROOT = process.cwd();
const api = fs.readFileSync(path.join(ROOT, 'src', 'services', 'api.ts'), 'utf8');

/** The source of one exported function: from its declaration to the next one. */
function body(name) {
  const start = api.indexOf(`export async function ${name}`);
  assert.ok(start > 0, `${name} should exist`);
  const next = api.indexOf('\nexport ', start + 1);
  return api.slice(start, next > start ? next : api.length);
}

test('a listing whose facts did not save is not reported as saved', () => {
  const fn = body('upsertPropertyFacts');
  assert.match(fn, /throw new Error\(`Could not save the property details/);
  assert.ok(!/console\.error\('upsertPropertyFacts error/.test(fn), 'logging and continuing is the defect');
});

test('a listing that never got a search profile is not reported as saved', () => {
  const fn = body('createSearchProfile');
  assert.match(fn, /const \{ error \} = await supabase\.from\('search_profiles'\)\.upsert\(/);
  assert.match(fn, /throw new Error\(`Could not save the matching profile/);
});

test('both listing flows can surface the failure they now get', () => {
  for (const p of ['PrivateListingPage.tsx', 'URLImportPage.tsx']) {
    const page = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'property', p), 'utf8');
    assert.match(page, /await upsertPropertyFacts\(/, `${p} saves facts`);
    assert.match(page, /catch \(err/, `${p} must have a catch to receive the throw`);
    assert.match(page, /toast\.error\(/, `${p} must tell the customer`);
  }
});

test('the search profile no longer pretends to set transaction_type', () => {
  const fn = body('createSearchProfile');
  // `facts.source_url ? undefined : undefined` is undefined either way. It read
  // like it set the field and never did.
  assert.ok(!/transaction_type: facts\.source_url/.test(fn));
});

test('a photo delete that matched nothing is not called a delete', () => {
  const fn = body('deletePropertyPhoto');
  assert.match(fn, /\.select\('id'\)/);
  assert.match(fn, /data\.length === 0/);
});

test('a half-applied cover photo change is reported', () => {
  const fn = body('setCoverPhoto');
  // Two statements: clearing the old cover, then setting the new one. If the
  // second fails quietly the property ends up with no cover at all.
  assert.match(fn, /clearErr/);
  assert.match(fn, /setErr/);
  assert.match(fn, /data\.length === 0/);
});

test('every ingestion write is either checked or deliberately advisory', () => {
  // A sweep of the ingestion helpers: none may end in a bare `await supabase`
  // whose result is thrown away.
  for (const name of [
    'upsertPropertyFacts', 'createSearchProfile', 'deletePropertyPhoto',
    'setCoverPhoto', 'updateImport', 'updateProperty', 'softDeleteProperty',
  ]) {
    assert.ok(/error/i.test(body(name)), `${name} must inspect the result of its write`);
  }
});
