// PROPERTY IMPORT — the source registry (src/import/sourceAdapters.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveListingSource, LISTING_SOURCES, MYHOME, SS } from '../sourceAdapters.ts';

const PORTAL = '<!DOCTYPE html><html><head><title>უძრავი ქონების პორტალი საქართველოში, ბინები, ყიდვა გაყიდვა გაქირავება - MyHome.ge</title></head>'
  + '<body><div class="card">120 000 $ · 75 კვ.მ</div><div class="card">95 000 $ · 60 კვ.მ</div></body></html>';
const LISTING = '<html><head><title>იყიდება 3 ოთახიანი ბინა კრწანისში — 25805378</title></head><body>'
  + '<script id="__NEXT_DATA__">{"props":{"pageProps":{"statement":{"id":25805378,"price":{"1":{"price_total":185000}}}}}}</script></body></html>';

test('the 2026-10-04 MyHome URL resolves to the MyHome adapter with its listing id and public alternates', () => {
  const r = resolveListingSource('https://www.myhome.ge/ka/udzravi-qoneba/iyideba-3-otaxiani-bina-krwanisshi-25805378/');
  assert.equal(r.adapter.id, 'myhome');
  assert.equal(r.listingId, '25805378');
  assert.deepEqual(r.candidates, [
    'https://www.myhome.ge/ka/udzravi-qoneba/iyideba-3-otaxiani-bina-krwanisshi-25805378/',
    'https://www.myhome.ge/pr/25805378/', 'https://www.myhome.ge/ka/pr/25805378/',
  ]);
  assert.equal(resolveListingSource('https://www.myhome.ge/pr/25805378/').listingId, '25805378');
});

test('a portal homepage with other listings\' prices is NOT the listing (the root cause); the listing page is', () => {
  assert.equal(MYHOME.showsListing(PORTAL, '25805378'), false);
  assert.equal(MYHOME.showsListing(LISTING, '25805378'), true);
  assert.equal(MYHOME.showsListing(LISTING, null), false, 'no id, no proof');
});

test('SS.ge resolves; unknown domains get no adapter (generic extraction, truthful failure)', () => {
  const r = resolveListingSource('https://ss.ge/ka/udzravi-qoneba/iyideba-2-otaxiani-bina-vakeshi-12345678');
  assert.equal(r.adapter.id, 'ss');
  assert.equal(r.listingId, '12345678');
  assert.equal(SS.showsListing('<html>12345678</html>', '12345678'), true);
  assert.equal(resolveListingSource('https://example.com/listing/1'), null);
  assert.equal(resolveListingSource('not a url'), null);
  assert.equal(resolveListingSource('ftp://myhome.ge/pr/1/'), null);
});

test('the registry is the single list of supported sources (one entry per site)', () => {
  assert.deepEqual(LISTING_SOURCES.map((a) => a.id), ['myhome', 'ss']);
  for (const a of LISTING_SOURCES) for (const k of ['matches', 'listingId', 'candidateUrls', 'showsListing']) assert.equal(typeof a[k], 'function');
});
