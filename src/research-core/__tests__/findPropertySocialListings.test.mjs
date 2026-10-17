// Find Property social listings: a paid campaign's stored offers join the marketplace
// results as unverified listings — deduplicated with the portals, never a Best Match on
// their own, never a buyer's request, photos only from the post itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { offerImages, socialCandidate, isSocialSource, SOCIAL_ADAPTER_VERSION } from '../marketplace/socialListings.ts';
import { processSearch } from '../marketplace/pipeline.ts';
import { offerPropertyKind, offerSearchLanguages, planOfferJobs, SEARCH_WORDS, OFFER_LANGUAGES } from '../findProperty/offerCampaign.ts';
import * as F from './fixtures/marketplaceFixtures.mjs';

const obs = (over = {}) => ({
  id: 'o1', external_id: 'FACEBOOK:post:991', canonical_url: 'https://www.facebook.com/groups/tbilisi.flats/posts/991/',
  transaction: 'SALE', property_type: 'APARTMENT', city: 'Tbilisi', district: 'Vake',
  sale_amount: 150000, sale_currency: 'USD', rent_amount: null, rent_currency: null, rent_period: null,
  area_sqm: 92, rooms: 3, bedrooms: 2, floor: 6, total_floors: 12,
  title: 'იყიდება 3 ოთახიანი ბინა ვაკეში', description: 'იყიდება 3 ოთახიანი ბინა ვაკეში, 92 კვ.მ, 150000$',
  published_at: '2026-10-01T10:00:00Z', last_seen_at: '2026-10-03T11:50:00Z',
  image_urls: ['https://scontent.fbcdn.net/v/t39/1.jpg'], field_origins: { network: 'FACEBOOK', memo23ActorRunId: 'ar1' },
  ...over,
});

test('photos come from the post itself, never from the author or the group', () => {
  const fb = {
    url: 'https://www.facebook.com/groups/1/posts/2/', text: 'იყიდება ბინა',
    user: { profilePic: 'https://scontent.fbcdn.net/avatar.jpg' },
    attachments: [{ photo_image: { uri: 'https://scontent.fbcdn.net/p1.jpg' } }, { thumbnail: 'https://scontent.fbcdn.net/p2.jpg?x=1' }],
    groupPicture: 'https://scontent.fbcdn.net/group.jpg',
  };
  assert.deepEqual(offerImages(fb), ['https://scontent.fbcdn.net/p1.jpg', 'https://scontent.fbcdn.net/p2.jpg?x=1']);
  const ig = { displayUrl: 'https://scontent.cdninstagram.com/a.jpg', childPosts: [{ displayUrl: 'https://scontent.cdninstagram.com/b.jpg' }], ownerProfilePicUrl: 'https://scontent.cdninstagram.com/me.jpg' };
  assert.deepEqual(offerImages(ig), ['https://scontent.cdninstagram.com/a.jpg', 'https://scontent.cdninstagram.com/b.jpg']);
  assert.deepEqual(offerImages({ text: 'no photos', url: 'https://t.me/c/1' }), [], 'none invented');
  assert.deepEqual(offerImages({ images: ['http://insecure.example/a.jpg', 'https://x.example/page.html'] }), [], 'https images only');
  assert.equal(offerImages({ images: Array.from({ length: 20 }, (_, i) => `https://cdn.example/${i}.jpg`) }).length, 12);
});

test('a stored offer becomes a marketplace candidate; a request or an unpriced post never does', () => {
  const c = socialCandidate(obs(), F.FIXTURE_NOW);
  assert.ok(c);
  assert.ok(isSocialSource(c.source));
  assert.equal(c.source, 'social:facebook');
  assert.equal(c.sourceName, 'Facebook');
  assert.equal(c.transactionType, 'BUY');
  assert.equal(c.exactUrl, obs().canonical_url, 'links the original post');
  assert.deepEqual(c.images, obs().image_urls);
  assert.equal(c.retrievalMetadata.verified, false);
  assert.equal(c.seller.declaredType, null, 'a social poster is never declared an owner');
  assert.equal(SOCIAL_ADAPTER_VERSION, 'fp-social-offers-2');

  assert.equal(socialCandidate(obs({ title: 'ვეძებ ბინას ვაკეში', description: 'ვეძებ 3 ოთახიან ბინას ვაკეში, ბიუჯეტი 150000$' })), null, 'a buyer request is not a listing');
  assert.equal(socialCandidate(obs({ title: 'Looking for an apartment', description: 'Looking to buy an apartment in Vake, budget $150000' })), null);
  assert.equal(socialCandidate(obs({ sale_amount: null })), null, 'no price');
  assert.equal(socialCandidate(obs({ canonical_url: 'http://facebook.com/x' })), null, 'https post url only');
  assert.equal(socialCandidate(obs({ transaction: 'RENT', sale_amount: null, rent_amount: 900, rent_currency: 'USD', rent_period: 'DAY' })), null, 'daily rent is not monthly rent');
  const rent = socialCandidate(obs({ transaction: 'RENT', sale_amount: null, rent_amount: 900, rent_currency: 'usd', rent_period: 'MONTH' }));
  assert.equal(rent.transactionType, 'MONTHLY_RENT');
  assert.equal(rent.currency, 'USD');
});

test('social listings rank beside portal listings, a repost of a portal flat is not shown twice, and social alone is never a Best Match', () => {
  const portal = F.listing({ ...F.CONFIRMED_IDENTITY, source: 'source-a', sourceListingId: 'a-1', price: 150000, areaSqm: 92, floor: 6 });
  const socialSame = socialCandidate(obs({
    id: 'o-same', external_id: 'FACEBOOK:post:1', canonical_url: 'https://www.facebook.com/groups/g/posts/1/',
    description: F.CONFIRMED_IDENTITY.description, image_urls: F.CONFIRMED_IDENTITY.images, floor: 6,
  }), F.FIXTURE_NOW);
  const socialOnly = socialCandidate(obs({
    id: 'o-only', external_id: 'FACEBOOK:post:2', canonical_url: 'https://www.facebook.com/groups/g/posts/2/',
    sale_amount: 145000, area_sqm: 88, floor: 3, image_urls: ['https://scontent.fbcdn.net/other.jpg'],
    description: 'იყიდება 3 ოთახიანი ბინა ვაკეში, ახალ აშენებულ კორპუსში, 88 კვ.მ, მესამე სართული, 145000$',
  }), F.FIXTURE_NOW);
  const out = processSearch({
    request: F.FIXTURE_REQUEST, now: F.FIXTURE_NOW,
    candidates: [{ workerId: 'w-a', candidate: portal }, { workerId: 'social-offers', candidate: socialSame }, { workerId: 'social-offers', candidate: socialOnly }],
  });
  /* The repost of the portal flat (same photos and description) is not a second result:
     it is reachable from the portal property's possible duplicates, as its original post. */
  const portalProperty = out.properties.find((p) => p.listings.some((l) => l.source === 'source-a'));
  assert.ok(!portalProperty.listings.find((l) => l.source === 'source-a').social, 'a portal listing is not marked social');
  const repost = portalProperty.possibleMatches.find((m) => m.source === 'social:facebook');
  assert.equal(repost.repost, true);
  assert.equal(repost.exactUrl, 'https://www.facebook.com/groups/g/posts/1/');
  assert.equal(out.properties.filter((p) => p.listings.some((l) => l.exactUrl === 'https://www.facebook.com/groups/g/posts/1/')).length, 0, 'never shown twice');
  assert.equal(out.stats.socialReposts, 1);
  const alone = out.properties.find((p) => p.listings.every((l) => l.social));
  assert.ok(alone, 'a social-only property is in All Results');
  assert.equal(alone.intelligence.strong, false, 'never a Best Match on unverified content alone');
  assert.equal(alone.listings[0].exactUrl, 'https://www.facebook.com/groups/g/posts/2/');
});

test('keyword search words: six languages, the searched property kind, the customer language', () => {
  for (const lang of OFFER_LANGUAGES) for (const kind of ['APARTMENT', 'HOUSE', 'LAND', 'COMMERCIAL']) {
    assert.ok(SEARCH_WORDS[lang][kind].SALE && SEARCH_WORDS[lang][kind].RENT, `${lang} ${kind}`);
  }
  assert.equal(offerPropertyKind('VILLA'), 'HOUSE');
  assert.equal(offerPropertyKind(null), 'APARTMENT');
  assert.deepEqual(offerSearchLanguages('he'), ['ka', 'ru', 'en', 'he']);
  assert.deepEqual(offerSearchLanguages('ka'), ['ka', 'ru', 'en']);
  assert.deepEqual(offerSearchLanguages('xx'), ['ka', 'ru', 'en']);
  const plan = planOfferJobs({
    search: { transaction: 'SALE', propertyType: 'HOUSE', city: 'Batumi', districts: [], languages: offerSearchLanguages('tr') },
    networks: ['FACEBOOK'], providerBudgetMicros: 10_000_000, sources: [],
    actors: { FB_POST_SEARCH: { actorKey: 'FB_POST_SEARCH', ready: true, startFeeMicros: 1000, pricePer1kMicros: 1000, probeSize: 20 } },
  });
  assert.deepEqual(plan.jobs.map((j) => j.query), ['იყიდება სახლი Batumi', 'продается дом Batumi', 'house for sale Batumi', 'satılık ev Batumi']);
});
