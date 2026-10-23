// EVERY PHOTO, ONCE, WITH THE OWNER'S COVER FIRST.
//
// What this replaces on Property Details was a 16:7 cover and — only when there was
// more than one photo — a strip of inert 64px squares. You could see that other photos
// existed and you could not look at any of them.
//
// The two properties under test:
//
//   NOTHING APPEARS TWICE. An import writes the same key into `cover_photo_url` AND
//   into `property_facts.gallery_images`, so a naive concatenation shows the first
//   photo twice and reports one more photo than the property has. The count is a claim
//   the interface makes out loud, and a duplicated photo makes it false.
//
//   THE OWNER'S COVER LEADS. They chose it on the edit screen. An interface that opens
//   on a different photo is quietly overruling them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { galleryImages } from '../../src/property/gallery.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');
const code = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

/* ────────────────────────────────────────────────────────────────────────
 * The ordering rule
 * ──────────────────────────────────────────────────────────────────────── */

test('a property with no photos at all yields an empty list, not a blank entry', () => {
  assert.deepEqual(galleryImages({}), []);
  assert.deepEqual(galleryImages({ coverPhotoUrl: null, photos: null, galleryImages: null }), []);
  /* Whitespace is not an address. */
  assert.deepEqual(galleryImages({ coverPhotoUrl: '   ' }), []);
});

test('the owner-chosen cover leads, whatever its display_order says', () => {
  const images = galleryImages({
    photos: [
      { storage_path: 'users/a/p/1.jpg', display_order: 0, is_cover: false },
      { storage_path: 'users/a/p/2.jpg', display_order: 1, is_cover: true },
      { storage_path: 'users/a/p/3.jpg', display_order: 2, is_cover: false },
    ],
  });
  assert.equal(images[0], 'users/a/p/2.jpg', 'the cover is not first');
  assert.deepEqual(images, ['users/a/p/2.jpg', 'users/a/p/1.jpg', 'users/a/p/3.jpg']);
});

test('without a cover flag the property row cover leads, then the table order', () => {
  const images = galleryImages({
    coverPhotoUrl: 'users/a/p/cover.jpg',
    photos: [
      { storage_path: 'users/a/p/b.jpg', display_order: 1 },
      { storage_path: 'users/a/p/a.jpg', display_order: 0 },
    ],
  });
  assert.deepEqual(images, ['users/a/p/cover.jpg', 'users/a/p/a.jpg', 'users/a/p/b.jpg']);
});

test('the same photo reached three ways appears once', () => {
  /*
   * THE CASE THAT EXISTS IN PRODUCTION. The one imported property carries the portal's
   * own image URL in cover_photo_url, and an importer puts the same URL in
   * facts.gallery_images. Concatenating them shows it twice and reports one photo more
   * than the property has.
   */
  const shared = 'https://static.example.test/a.webp';
  const images = galleryImages({
    coverPhotoUrl: shared,
    photos: [{ storage_path: shared, is_cover: true }],
    galleryImages: [shared, 'https://static.example.test/b.webp'],
  });
  assert.deepEqual(images, [shared, 'https://static.example.test/b.webp']);
  assert.equal(new Set(images).size, images.length, 'the list contains a duplicate');
});

test('storage_path is preferred over public_url', () => {
  /*
   * `property-photos` is a PRIVATE bucket. A URL into it expires, and public_url is only
   * ever set for an object that genuinely is public -- which none of these are. The key
   * is the durable address; PrivateImage mints a short-lived URL from it when somebody
   * actually looks.
   */
  const images = galleryImages({
    photos: [{ storage_path: 'users/a/p/key.jpg', public_url: 'https://expired.example/x.jpg' }],
  });
  assert.deepEqual(images, ['users/a/p/key.jpg']);
});

test('a photo carrying only a public_url is still shown rather than dropped', () => {
  const images = galleryImages({ photos: [{ public_url: 'https://cdn.example/x.jpg' }] });
  assert.deepEqual(images, ['https://cdn.example/x.jpg']);
});

test('ordering is deterministic', () => {
  const source = {
    coverPhotoUrl: 'c.jpg',
    photos: [
      { storage_path: 'b.jpg', display_order: 2 },
      { storage_path: 'a.jpg', display_order: 1, is_cover: true },
    ],
    galleryImages: ['d.jpg', 'a.jpg'],
  };
  assert.deepEqual(galleryImages(source), galleryImages(source));
});

/* ────────────────────────────────────────────────────────────────────────
 * The component, and where it is used
 * ──────────────────────────────────────────────────────────────────────── */

test('the gallery does not reimplement storage', () => {
  /*
   * PrivateImage is the one thing that knows a private key from an absolute URL. A
   * gallery that built its own signed URLs would be a second place to get expiry,
   * fallback and the NOT_FOUND-only rule wrong.
   */
  const body = code(read('src', 'components', 'property', 'PropertyGallery.tsx'));
  assert.match(body, /PrivateImage/);
  assert.ok(!/property-photos/.test(body), 'the gallery names a bucket');
  assert.ok(!/createSignedUrl|getPublicUrl|storage\.from/.test(body),
    'the gallery mints its own URLs instead of going through PrivateImage');
});

test('the lightbox is a dialog, so escape and focus work', () => {
  const body = code(read('src', 'components', 'property', 'PropertyGallery.tsx'));
  assert.match(body, /<Dialog /);
  assert.match(body, /DialogContent/);
  /* Named for assistive technology even though the visible title would crowd a photo. */
  assert.match(body, /DialogTitle className="sr-only"/);
  /* Arrow keys, and only while it is open -- binding them to the page would steal them
     from every other control on a long property page. */
  assert.match(body, /ArrowRight/);
  assert.match(body, /if \(!open\) return undefined;/);
});

test('Property Details renders the gallery rather than a lone cover', () => {
  const body = code(read('src', 'pages', 'property', 'PropertyDetailPage.tsx'));
  assert.match(body, /<PropertyGallery/);
  assert.match(body, /galleryImages:/, 'the importer array is not passed through');
  /* The old inert strip is gone. */
  assert.ok(!/w-16 h-16 shrink-0 rounded-lg/.test(body),
    'the inert 64px thumbnail strip is back');
});

/* ────────────────────────────────────────────────────────────────────────
 * The contextual action
 * ──────────────────────────────────────────────────────────────────────── */

test('the campaign CTA says what this property is looking for', () => {
  /*
   * "Start matching" is an abstraction the customer has to translate into their own
   * situation. A listing for sale is looking for buyers; a rental is looking for
   * tenants. The machinery underneath is deliberately unchanged -- same handler, same
   * budget dialog, same CampaignLaunchPanel, same FIND_CLIENTS product, same
   * reserve-settle-release. Only the words are contextual.
   */
  const body = code(read('src', 'pages', 'property', 'PropertyDetailPage.tsx'));
  assert.match(body, /intelligenceActionFor\(property\.transaction_type/,
    'the CTA does not derive the action from the transaction type');
  /* Falls back to the generic wording rather than guessing a side of the market. */
  assert.match(body, /: t\('prop_view_matches'\)/);
  /* Matching workspace (owner, 2026-10-24): the property page no longer launches the legacy paid external campaign; it opens the workspace (MatchingEntryCard). */
  assert.match(body, /<MatchingEntryCard propertyId=\{id\} \/>/);
  assert.doesNotMatch(body, /productCode="FIND_CLIENTS"/, 'the property page no longer launches a paid campaign');
});

/*
 * REPLACING A PHOTO UPDATES THE LISTING (2026-10-12, VILLION).
 *
 * Replacing a photo is "remove, then add". Removing the cover used to delete the row
 * and leave properties.cover_photo_url on the deleted key with no row marked
 * is_cover, so every list showed a broken cover until the row was repaired by hand.
 */
test('removing the cover promotes the next photo and keeps cover_photo_url in step', () => {
  const svc = code(read('src', 'services', 'propertyManagement.ts'));
  const remove = svc.slice(svc.indexOf('export async function removePhoto'), svc.indexOf('export async function promoteNextCover'));
  assert.match(remove, /select\('id,storage_path,property_id,is_cover'\)/);
  assert.match(remove, /is_cover\)\s*\{\s*await promoteNextCover\(propertyId, key\)/);
  const promote = svc.slice(svc.indexOf('export async function promoteNextCover'), svc.indexOf('export async function attachPhoto'));
  assert.match(promote, /update\(\{ is_cover: true \}\)/, 'the next photo becomes the cover');
  assert.match(promote, /cover_photo_url: cover/, 'the property row follows it');
  assert.match(promote, /cover_image/, 'with no photos left, the imported cover returns');
  assert.match(promote, /imported !== removedKey/, 'never the key that was just deleted');
});

test('every cover_photo_url rendered as an image goes through PrivateImage (a managed cover is a private key)', () => {
  for (const file of [['src', 'pages', 'designStudio', 'DesignStudioPage.tsx'], ['src', 'pages', 'DashboardPage.tsx']]) {
    const src = code(read(...file));
    assert.doesNotMatch(src, /<img[^>]*src=\{[^}]*cover_photo_url/, `${file.at(-1)}: raw <img> on cover_photo_url`);
  }
});
