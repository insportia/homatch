// FIND BUYERS — every stage's input against the memo23 Actor's REAL input
// schema, as read from Apify on 2026-10-04 (public /acts + /actor-builds
// metadata; the same data verifyActor stores as input_contract). A stage must
// send every required field and nothing fitToSchema would silently drop —
// otherwise a paid run starts with no query. LINKEDIN_GROUPS requires login
// cookies and never runs (HOMATCH never logs in to a source).
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildInput, essentialMissing, STAGE_ACTOR } from '../findBuyers/actorInputs.ts';
import { REGISTRY_SEEDS } from '../findBuyers/actorCatalog.ts';

const SCHEMA = {
  BLUESKY: { props: 'domain,fromAuthor,handles,hashtags,includeFollowers,includeFollowing,includePosts,lang,maxFollowsPerProfile,maxItems,maxPostsPerProfile,mentionsAuthor,proxy,searchQueries,searchType,since,sort,startUrls,until', required: [] },
  FB_COMMENTS: { props: 'commentsMode,includeNestedComments,maxConcurrency,maxItems,maxRequestRetries,minConcurrency,proxy,startUrls', required: ['startUrls'] },
  FB_GROUP_POSTS: { props: 'enrichMarketplaceListings,fetchAllComments,includeCommentReplies,includeComments,maxConcurrency,maxItems,maxRequestRetries,minConcurrency,monitoringMode,onlyPostsNewerThan,onlyPostsNewerThanHours,onlyPostsOlderThan,postsPerRequest,proxy,proxyCountry,resumeCursor,search,searchKeywordByYear,startUrls,viewOption', required: ['startUrls'] },
  FB_GROUP_SEARCH: { props: 'maxConcurrency,maxGroups,minMembers,privacy,proxyConfiguration,requireKeywordMatch,searchQueries,sources,startUrls', required: [] },
  IG_COMMENTS: { props: 'commentCountsOnly,commentsSortOrder,cookies,includeCommentLikers,includeReplies,maxCommentLikers,maxConcurrency,maxItems,maxRequestRetries,minConcurrency,monitoringMode,proxy,startUrls', required: ['startUrls'] },
  IG_PROFILE_POSTS: { props: 'downloadMediaUrls,maxConcurrency,maxItems,maxRequestRetries,minConcurrency,monitoringMode,proxy,resultsType,startUrls,storeName', required: ['startUrls'] },
  LINKEDIN_GROUPS: { props: 'cookies,maxDelay,maxItems,minDelay,proxy,startUrls', required: ['startUrls', 'cookies'] },
  LINKEDIN_POSTS: { props: 'companyNames,dateFrom,dateTo,dedupeStoreName,inputFile,maxComments,maxConcurrency,maxItems,maxPostsPerProfile,maxPostsPerQuery,maxRequestRetries,onlyNewPosts,postMustContain,postTypeFilter,scrapeComments,sdoKey,searchQueries,startUrls', required: [] },
  QUORA: { props: 'cookies,maxItems,proxy,searchQueries,startUrls', required: [] },
  REDDIT: { props: 'authorFlairContains,authors,contentContains,domainContains,excludeArchived,excludeAuthors,excludeCrossposts,excludeDeletedAuthor,excludeKeywords,excludeLocked,excludeRemoved,excludeSpoilers,excludeStickied,flairContains,htmlFetchPostBody,includeOver18,maxComments,maxConcurrency,maxContentLength,maxItems,maxRequestRetries,maxScore,minAwards,minComments,minConcurrency,minContentLength,minScore,minUpvoteRatio,mode,onlyDistinguished,onlyOriginalContent,onlyWithFlair,postType,postUrls,proxy,searchCommentDateFrom,searchCommentDateTo,searchForceNewSortWhenDateFiltered,searchIncludeComments,searchMaxCommentsPerPost,searchMaximizeCoverage,searchPostDateFrom,searchPostDateTo,searchQueries,searchSort,searchStrictPhrase,searchStrictTokenFilter,searchTimeframe,sort,startUrls,subreddits,subredditSearchQueries,subredditSearchSort,subredditSearchTimeframe,subredditSearchUrl,timeFilter,titleContains', required: ['mode'] },
  TELEGRAM_CHANNEL: { props: 'maxConcurrency,maxItems,maxRequestRetries,minConcurrency,newestDate,oldestDate,proxy,sinceLastRun,startUrls,usernames', required: [] },
  THREADS_PROFILE: { props: 'hashtags,includeReplies,maxItems,mode,postedAfter,postedBefore,postUrls,proxy,searchQueries,searchSortType,usernames', required: [] },
  TIKTOK: { props: 'exactVideoCounts,includeAuthorStats,includeHashtagsMentions,includeLikedVideos,includeMediaUrls,includeReplies,includeVideos,input,maxFollowers,maxLikedVideosPerProfile,maxRepliesPerComment,maxResults,maxVideosPerProfile,minFollowers,mode,strictHashtagMatch,verifiedOnly', required: ['mode', 'input'] },
  VK_POSTS_COMMENTS: { props: 'includeComments,maxCommentsPerPost,maxConcurrency,maxItems,maxItemsPerTarget,monitoringMode,publishedAfter,publishedBefore,resetMonitoringState,searchQuery,targets,vkAccessToken', required: [] },
  X_PROFILE: { props: 'includeRawData,includeReplies,includeRetweets,maxConcurrency,maxItems,maxRequestRetries,minConcurrency,onlyTweetsAfter,onlyTweetsBefore,proxy,startUrls,tweetIds', required: [] },
  YOUTUBE_COMMENTS: { props: 'maxConcurrency,maxItems,maxRequestRetries,minConcurrency,oldestCommentDate,proxy,sortCommentsBy,startUrls', required: ['startUrls'] },
};
const ENUMS = { TIKTOK: { mode: ['profile', 'videos', 'post', 'hashtag', 'search', 'comments', 'users'] }, REDDIT: { mode: ['searchGlobal', 'searchSubreddit', 'postComments', 'subredditUsers'] },
  BLUESKY: { sort: ['latest', 'top'], searchType: ['posts', 'accounts', 'both'] }, FB_COMMENTS: { commentsMode: ['ALL', 'NEWEST', 'MOST_RELEVANT'] }, THREADS_PROFILE: { mode: ['posts', 'replies', 'profile'] } };

const params = (stage) => ({ query: stage === 'TIKTOK_SEARCH' ? 'ბინა ვაკეში' : 'looking for an apartment in tbilisi', targetUrl: 'https://example.com/source/1', size: 20, since: '2026-09-04T12:00:00.000Z' });

for (const [stage, actorKey] of Object.entries(STAGE_ACTOR)) {
  /* Actors registered at verification time (REGISTRY_SEEDS) have no recorded
     schema until an admin verifies them; they are covered by the tests below. */
  if (REGISTRY_SEEDS[actorKey]) continue;
  test(`${stage} → ${actorKey}: required fields sent, nothing silently dropped, enums valid`, () => {
    const schema = SCHEMA[actorKey];
    assert.ok(schema, `no recorded schema for ${actorKey}`);
    const { input, dropped } = buildInput(stage, params(stage), { schemaProperties: schema.props.split(',') });
    if (actorKey === 'LINKEDIN_GROUPS') {
      assert.ok(!('cookies' in input), 'HOMATCH never sends login cookies: this Actor cannot run');
      return;
    }
    assert.deepEqual(dropped, [], `${stage} sends keys ${actorKey} does not accept: ${dropped}`);
    for (const r of schema.required) {
      assert.ok(r in input && input[r] != null && !(Array.isArray(input[r]) && input[r].length === 0), `${stage} misses required ${r}`);
    }
    for (const [k, allowed] of Object.entries(ENUMS[actorKey] ?? {})) {
      if (k in input) assert.ok(allowed.includes(input[k]), `${stage} ${k}=${input[k]} not in ${allowed}`);
    }
    for (const k of ['onlyPostsNewerThan', 'since', 'publishedAfter', 'postedAfter']) {
      if (k in input) assert.match(String(input[k]), /^\d{4}-\d{2}-\d{2}$/, `${stage} ${k} must be a date (YYYY-MM-DD)`);
    }
    const hasQueryOrTarget = ['searchQueries', 'input', 'startUrls', 'targets', 'usernames', 'postUrls'].some((k) => Array.isArray(input[k]) && input[k].length > 0);
    assert.ok(hasQueryOrTarget, `${stage} would start a run with no query or target`);
  });
}

test('TikTok hashtag queries use hashtag mode; comment follow-ups use comments mode', () => {
  assert.deepEqual(buildInput('TIKTOK_SEARCH', { query: '#tbilisirent', size: 10 }, null).input, { mode: 'hashtag', input: ['tbilisirent'], maxResults: 10 });
  assert.equal(buildInput('TIKTOK_COMMENTS', { targetUrl: 'https://www.tiktok.com/@a/video/1', size: 10 }, null).input.mode, 'comments');
  assert.equal(buildInput('REDDIT_COMMENTS', { targetUrl: 'https://www.reddit.com/r/x/comments/1/t/', size: 10 }, null).input.mode, 'postComments');
});

/* ── Facebook Pages / public post search (registered at verification) ───── */

const P = { query: 'იყიდება 3-ოთახიანი ბინა კრწანისში', targetUrl: 'https://www.facebook.com/someagency', size: 15, since: '2026-09-16T00:00:00.000Z' };

test('FB_POST_SEARCH keeps its query under whichever spelling the verified schema declares, and is refused when none survives', () => {
  for (const key of ['searchQueries', 'queries', 'query', 'searchTerms', 'keywords']) {
    const contract = { schemaProperties: [key, 'maxItems', 'onlyPostsNewerThan'], required: [key] };
    const { input } = buildInput('FB_POST_SEARCH', P, contract);
    assert.ok(key in input, key);
    assert.match(JSON.stringify(input[key]), /კრწანისში/);
    assert.equal(input.maxItems, 15);
    assert.equal(input.onlyPostsNewerThan, '2026-09-16');
    assert.deepEqual(essentialMissing('FB_POST_SEARCH', input, contract), []);
  }
  const blind = { schemaProperties: ['startUrls', 'maxItems'], required: [] };
  const { input } = buildInput('FB_POST_SEARCH', P, blind);
  assert.deepEqual(essentialMissing('FB_POST_SEARCH', input, blind), ['essential:searchQueries|queries|query|searchTerms|keywords'],
    'a run that would carry no query is refused (released at $0) rather than started');
});

test('FB_PAGE_POSTS reads one public Page with comments attached; a schema requirement it cannot meet refuses the run', () => {
  const contract = { schemaProperties: ['startUrls', 'maxPosts', 'maxItems', 'includeComments', 'onlyPostsNewerThan'], required: ['startUrls'] };
  const { input, dropped } = buildInput('FB_PAGE_POSTS', P, contract);
  assert.deepEqual(dropped, []);
  assert.deepEqual(input.startUrls, [{ url: 'https://www.facebook.com/someagency' }]);
  assert.equal(input.includeComments, true);
  assert.equal(input.maxPosts, 15);
  assert.deepEqual(essentialMissing('FB_PAGE_POSTS', input, contract), []);
  const needsCookies = { ...contract, schemaProperties: [...contract.schemaProperties, 'cookies'], required: ['startUrls', 'cookies'] };
  assert.deepEqual(essentialMissing('FB_PAGE_POSTS', buildInput('FB_PAGE_POSTS', P, needsCookies).input, needsCookies), ['required:cookies'],
    'HOMATCH never logs in: an Actor that requires cookies never runs');
});

test('every seeded Actor is a memo23 Actor (or the one owner-named exception), registered disabled-by-default, on a Facebook stage', () => {
  /* Owner, 2026-10-18: Facebook keyword buyer search is the one non-memo23 Actor (memo23Client ALLOWED_THIRD_PARTY_ACTORS). */
  const EXCEPTIONS = { FB_KEYWORD_SEARCH: 'tropical_thunderstuck~facebook-post-search' };
  for (const [k, seed] of Object.entries(REGISTRY_SEEDS)) {
    assert.equal(seed.actor_key, k);
    if (EXCEPTIONS[k]) assert.equal(seed.actor_id, EXCEPTIONS[k]);
    else assert.match(seed.actor_id, /^memo23~[a-z0-9-]+$/);
    assert.equal(seed.source, 'FACEBOOK');
    assert.ok(Object.values(STAGE_ACTOR).includes(k), `${k} has a stage`);
    assert.ok(!('enabled' in seed), 'a seed never carries an enabled flag; the server writes it disabled');
  }
});
