// PHASE 2 Facebook / Instagram discovery through the official Graph API.
// Fixtures are DOC_SHAPED (Meta's documented response shapes, written for the
// test). They prove mapping and refusals; they do NOT make any source
// LIVE_TESTED — only a real token returning a real post can.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { scanFacebookPage, scanInstagramAccount, scanInstagramHashtag, GRAPH_BASE } from '../adapters/social/meta-graph-discovery.ts';
import { fromDemandSignal } from '../discovery/discovery-entity.ts';
import { sourceCapability, sourceStatus } from '../discovery/source-capabilities.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TOKEN = 'EAAB-secret-token-value';

function graph(routes) {
  const calls = [];
  const fetchGraph = async (url) => {
    calls.push(url);
    const u = new URL(url);
    const key = u.pathname.replace(`/${GRAPH_BASE.split('/').pop()}/`, '');
    const hit = routes[key];
    if (!hit) return { status: 404, json: { error: { code: 100, message: 'Unsupported get request' } } };
    return typeof hit === 'function' ? hit(u) : { status: 200, json: hit };
  };
  return { fetchGraph, calls };
}

const PAGE = { id: '1029384756', name: 'Tbilisi Apartments', link: 'https://www.facebook.com/TbilisiApartments', username: 'TbilisiApartments' };
const POSTS = { data: [
  { id: '1029384756_111', message: 'Looking to rent 2BR in Vake, budget $900. WhatsApp +995 555 11 22 33', permalink_url: 'https://www.facebook.com/TbilisiApartments/posts/111', created_time: '2026-10-01T09:00:00+0000' },
  { id: '1029384756_112', message: 'Photo only' , permalink_url: 'javascript:alert(1)', created_time: '2026-10-01T10:00:00+0000' },
  { id: '1029384756_113', created_time: '2026-10-01T11:00:00+0000' },
] };
const COMMENTS = { data: [
  { id: '111_c1', message: 'Is it still available? Call me 599123456', permalink_url: 'https://www.facebook.com/TbilisiApartments/posts/111?comment_id=c1', created_time: '2026-10-01T12:00:00+0000' },
] };

test('Facebook: no token → ACCESS_NOT_GRANTED, no request made', async () => {
  const { fetchGraph, calls } = graph({});
  const r = await scanFacebookPage({ pageId: 'TbilisiApartments' }, { token: null }, fetchGraph);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'ACCESS_NOT_GRANTED');
  assert.equal(calls.length, 0);
});

test('Facebook: exact post permalink, Page as author/source, comments keep their own permalink and an unknown author stays null', async () => {
  const { fetchGraph } = graph({
    TbilisiApartments: PAGE,
    'TbilisiApartments/posts': POSTS,
    '1029384756_111/comments': COMMENTS,
    '1029384756_112/comments': { data: [] },
  });
  const r = await scanFacebookPage({ pageId: 'TbilisiApartments', includeComments: true }, { token: TOKEN }, fetchGraph);
  assert.ok(r.ok, JSON.stringify(r));
  const [post, comment, photo] = [r.value[0], r.value[1], r.value.find((x) => x.external_id === 'fb:1029384756_112')];
  assert.equal(post.source_url, 'https://www.facebook.com/TbilisiApartments/posts/111');
  assert.equal(post.parent_url, 'https://www.facebook.com/TbilisiApartments');
  assert.equal(post.author_public_name, 'Tbilisi Apartments');
  assert.match(post.original_text, /\+995 555 11 22 33/, 'public contact kept verbatim');
  assert.equal(comment.content_type, 'COMMENT');
  assert.equal(comment.source_url, 'https://www.facebook.com/TbilisiApartments/posts/111?comment_id=c1', 'exact comment link');
  assert.equal(comment.parent_url, 'https://www.facebook.com/TbilisiApartments/posts/111');
  assert.equal(comment.author_public_name, null, 'not returned by Meta, not invented');
  assert.equal(photo.source_url, 'https://www.facebook.com/TbilisiApartments', 'an unsafe permalink falls back to the Page, never to javascript:');
  assert.equal(photo.parent_url, null);
  assert.ok(!r.value.some((x) => x.external_id === 'fb:1029384756_113'), 'a post with no text is not a signal');
});

test('Facebook: permission and rate errors are typed and never echo the token', async () => {
  const denied = graph({ TbilisiApartments: () => ({ status: 403, json: { error: { code: 10, message: `(#10) This endpoint requires the 'Page Public Content Access' feature. token=${TOKEN}` } } }) });
  const r = await scanFacebookPage({ pageId: 'TbilisiApartments' }, { token: TOKEN }, denied.fetchGraph);
  assert.equal(r.reason, 'PERMISSION_DENIED');
  assert.ok(!r.detail.includes(TOKEN));
  const limited = graph({ TbilisiApartments: () => ({ status: 400, json: { error: { code: 4, message: 'Application request limit reached' } } }) });
  assert.equal((await scanFacebookPage({ pageId: 'TbilisiApartments' }, { token: TOKEN }, limited.fetchGraph)).reason, 'RATE_LIMITED');
  assert.equal((await scanFacebookPage({ pageId: 'groups/123' }, { token: TOKEN }, limited.fetchGraph)).reason, 'NOT_FOUND', 'a group path is refused before any call');
});

test('Instagram Business Discovery: @username, profile URL and exact post permalink', async () => {
  const { fetchGraph, calls } = graph({
    '17841400000000000': { business_discovery: { username: 'batumi.homes', name: 'Batumi Homes', media: { data: [
      { id: '1801', caption: 'For sale: 2-room flat, Batumi, 55 m², $78,000. DM or +995 577 00 11 22', permalink: 'https://www.instagram.com/p/C1abc/', timestamp: '2026-09-29T08:00:00+0000', media_type: 'IMAGE' },
    ] } } },
  });
  const r = await scanInstagramAccount('batumi.homes', { token: TOKEN, igUserId: '17841400000000000' }, fetchGraph);
  assert.ok(r.ok);
  assert.equal(r.value[0].source_url, 'https://www.instagram.com/p/C1abc/');
  assert.equal(r.value[0].author_public_name, '@batumi.homes');
  assert.equal(r.value[0].author_public_url, 'https://www.instagram.com/batumi.homes/');
  assert.ok(decodeURIComponent(calls[0]).includes('business_discovery.username(batumi.homes)'));
  assert.equal((await scanInstagramAccount('x', { token: TOKEN, igUserId: null }, fetchGraph)).reason, 'ACCESS_NOT_GRANTED');
});

test('Instagram hashtag media: exact permalink, author unknown and therefore null', async () => {
  const { fetchGraph } = graph({
    ig_hashtag_search: { data: [{ id: '17843853986012965' }] },
    '17843853986012965/recent_media': { data: [
      { id: '1802', caption: 'Ищу квартиру в Тбилиси, Ваке, до $1000', permalink: 'https://www.instagram.com/p/C2def/', timestamp: '2026-10-01T08:00:00+0000' },
      { id: '1803', caption: 'no link' },
    ] },
  });
  const r = await scanInstagramHashtag('#tbilisirent', { token: TOKEN, igUserId: '17841400000000000' }, fetchGraph);
  assert.ok(r.ok);
  assert.equal(r.value.length, 1, 'a media item without a permalink is not kept');
  assert.equal(r.value[0].author_public_name, null);
  assert.equal(r.value[0].source_url, 'https://www.instagram.com/p/C2def/');
});

test('a social row becomes the shared DEMAND entity with provenance intact', () => {
  const e = fromDemandSignal({ platform: 'FACEBOOK', external_id: 'fb:1029384756_111', source_url: 'https://www.facebook.com/TbilisiApartments/posts/111',
    parent_url: 'https://www.facebook.com/TbilisiApartments', author_public_name: 'Tbilisi Apartments', author_public_url: 'https://www.facebook.com/TbilisiApartments',
    original_text: POSTS.data[0].message }, { intent: 'RENT', city: 'Tbilisi', district: 'Vake', budgetMax: 900, currency: 'USD', bedrooms: 2, origin: 'MODEL' });
  assert.equal(e.provenance.permalink, 'https://www.facebook.com/TbilisiApartments/posts/111');
  assert.equal(e.provenance.threadUrl, 'https://www.facebook.com/TbilisiApartments');
  assert.equal(e.contacts[0].kind, 'PHONE');
});

test('Meta discovery is separate from Meta Ads, and stays BLOCKED until access is real', () => {
  const src = readFileSync(join(root, 'src/research-core/adapters/social/meta-graph-discovery.ts'), 'utf8');
  assert.doesNotMatch(src, /from ['"][^'"]*metaAds/);
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ''), /META_APP_SECRET|META_TOKEN_ENCRYPTION_KEY|Deno\.env/);
  for (const key of ['facebook-pages', 'instagram', 'facebook-groups', 'linkedin']) {
    assert.equal(sourceStatus(sourceCapability(key)).status, 'BLOCKED', key);
  }
  assert.equal(sourceCapability('linkedin').implementation, 'NOT_IMPLEMENTED');
  assert.equal(sourceCapability('facebook-groups').implementation, 'NOT_IMPLEMENTED');
});
