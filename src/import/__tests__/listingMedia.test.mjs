// Every photo of one listing, and nothing else (src/import/listingMedia).
// Fixtures model the shapes a listing page ships: Next.js Pages (__NEXT_DATA__),
// the App Router payload (self.__next_f.push) with a recommendations block,
// JSON-LD, and a page whose only clue is the cover photo's upload folder.
import test from 'node:test';
import assert from 'node:assert/strict';

import { extractListingMedia, orderedGallery, mergeGallery, photoIdentity, isListingPhotoUrl, IMPORTED_GALLERY_MAX } from '../listingMedia.ts';

const CDN = 'https://static-statements.tnet.ge/uploads/202608/20260819/statements';
const OTHER = 'https://static-statements.tnet.ge/uploads/202607/20260702/statements';
const own = Array.from({ length: 15 }, (_, i) => `${CDN}/P${String(i).padStart(2, '0')}abc.webp`);
const recommended = Array.from({ length: 6 }, (_, i) => `${OTHER}/R${i}zz.webp`);

function pagesRouterPage() {
  const nextData = {
    props: { pageProps: { dehydratedState: { queries: [
      { state: { data: { data: { similar: recommended.map((u, i) => ({ id: 99000 + i, images: [{ large: u }] })) } } } },
      { state: { data: { data: { statement: { id: 25805378, title: 'flat', images: own.map((u, i) => ({ large: u, thumb: u.replace('.webp', '_thumb.webp'), is_main: i === 0 })) } } } } },
    ] } } },
  };
  return `<html><head><meta property="og:image" content="${own[0].replace('.webp', '_thumb.webp')}"></head>
  <body><img src="https://static.my.ge/myhome/images/myhome-logo.svg"><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></body></html>`;
}

function appRouterPage() {
  const listing = JSON.stringify({ statement_id: 25805378, price: 213840, gallery: null, images: own.map((u) => ({ large: u.replace(/\//g, '\\u002F') })) });
  const recs = JSON.stringify({ items: recommended.map((u, i) => ({ id: 77000 + i, images: [{ large: u }] })) });
  const chunk = (s) => `<script>self.__next_f.push([1,${JSON.stringify(s)}])</script>`;
  return `<html><head><meta property="og:image" content="${own[0]}"></head><body>
    ${chunk(`1:${recs}\n`)}${chunk(`2:{"statement":${listing.slice(0, 120)}`)}${chunk(`${listing.slice(120)}}\n`)}
    <div class="avatar"><img src="https://static-statements.tnet.ge/users/avatar/u1.jpg"></div>
  </body></html>`;
}

test('T. Pages Router: the listing object\'s full gallery, not the og:image thumbnail, no recommendations', () => {
  const r = extractListingMedia(pagesRouterPage(), { listingId: '25805378' });
  assert.equal(r.method, 'LISTING_OBJECT');
  assert.equal(r.candidates, 15);
  assert.deepEqual(r.images, own, 'source order kept, large variant chosen');
  assert.ok(!r.images.some((u) => u.includes('/202607/')), 'no recommended listings');
});

test('T. App Router payload: the images array owned by this listing id, across chunks', () => {
  const r = extractListingMedia(appRouterPage(), { listingId: '25805378' });
  assert.equal(r.method, 'APP_ROUTER_PAYLOAD');
  assert.deepEqual(r.images, own);
});

test('T. JSON-LD gallery of the listing, ignoring Organization logos', () => {
  const ld = [{ '@type': 'Organization', image: 'https://example.ge/logo.png' }, { '@type': 'Apartment', image: own.slice(0, 7) }];
  const html = `<script type="application/ld+json">${JSON.stringify(ld)}</script>`;
  const r = extractListingMedia(html, { listingId: '1' });
  assert.equal(r.method, 'JSON_LD');
  assert.equal(r.images.length, 7);
});

test('T. last resort: photos sharing the cover\'s upload folder, never another listing\'s folder', () => {
  const html = `<meta property="og:image" content="${own[0]}">` + own.map((u) => `<img data-src="${u}">`).join('') + recommended.map((u) => `<img src="${u}">`).join('');
  const r = extractListingMedia(html, { listingId: null });
  assert.equal(r.method, 'COVER_FOLDER');
  assert.equal(r.images.length, 15);
  assert.ok(r.images.every((u) => u.startsWith(CDN)));
});

test('U. gallery dedupe keeps source order and collapses size variants to the largest', () => {
  const g = orderedGallery([own[0].replace('.webp', '_thumb.webp'), own[1], own[0], own[0].replace('.webp', '_large.webp'), own[1]]);
  assert.equal(g.images.length, 2);
  assert.equal(photoIdentity(g.images[0]), photoIdentity(own[0]));
  assert.ok(g.images[0].endsWith('_large.webp'), 'largest variant wins');
  assert.equal(g.images[1], own[1]);
});

test('U. non-listing assets are rejected', () => {
  for (const bad of ['https://static.my.ge/myhome/images/myhome-logo.png', 'https://x.ge/icons/a.png', 'https://x.ge/a.svg',
    'https://static-statements.tnet.ge/users/avatar/u1.jpg', 'http://insecure.ge/a.jpg', 'https://x.ge/ads/banner.jpg']) {
    assert.equal(isListingPhotoUrl(bad), false, bad);
  }
  assert.equal(isListingPhotoUrl(own[3]), true);
});

test('W. an external gallery is never cut to the manual-upload limit of five', () => {
  const r = extractListingMedia(pagesRouterPage(), { listingId: '25805378' });
  assert.ok(r.images.length > 5);
  const many = Array.from({ length: 80 }, (_, i) => `${CDN}/M${i}.webp`);
  assert.equal(orderedGallery(many).images.length, IMPORTED_GALLERY_MAX, 'only a sanity ceiling applies');
  assert.equal(orderedGallery(many).candidates, 80, 'the source count is still reported (media health)');
});

test('V. refresh of an existing property merges: held photos keep their place, owner entries stay, new ones append', () => {
  const ownerUpload = 'property-photos/u1/p1/kitchen.jpg';
  const existing = [own[0], ownerUpload];
  const merged = mergeGallery(existing, own);
  assert.equal(merged[0], own[0]);
  assert.equal(merged[1], ownerUpload, 'an owner-added entry is never removed or moved');
  assert.equal(merged.length, 1 + 1 + 14, 'the cover is not duplicated; 14 new source photos appended');
  assert.deepEqual(mergeGallery(merged, own), merged, 'a second refresh adds nothing');
});

test('nothing found → NONE, not a guess', () => {
  assert.deepEqual(extractListingMedia('<html><body>no photos</body></html>', { listingId: '5' }), { images: [], candidates: 0, rejected: 0, method: 'NONE' });
});
