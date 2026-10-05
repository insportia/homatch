// Stage → memo23 Actor input. One place builds every request body.
//
// The default bodies follow each Actor's public store documentation. They are
// not trusted blindly: when an admin verifies an Actor, its current input
// schema is fetched from Apify and stored (registry.input_contract.schema),
// and `fitToSchema` then drops any key the schema does not declare and
// reports it, so a renamed field shows up as a named problem rather than a
// silent misconfiguration. `input_contract.defaults` / `.rename` let an admin
// correct a body without a deploy.

export type Stage =
  | 'FB_GROUP_SEARCH' | 'FB_GROUP_POSTS' | 'FB_COMMENTS'
  | 'IG_PROFILE_POSTS' | 'IG_COMMENTS'
  | 'TIKTOK_SEARCH' | 'TIKTOK_COMMENTS'
  | 'VK_WALL'
  | 'TELEGRAM_CHANNEL'
  | 'LINKEDIN_GROUPS' | 'LINKEDIN_POSTS'
  | 'REDDIT_SEARCH' | 'REDDIT_COMMENTS'
  | 'QUORA_SEARCH'
  | 'BLUESKY_SEARCH'
  | 'X_PROFILE' | 'THREADS_PROFILE'
  | 'YOUTUBE_COMMENTS';

export type Network = 'FACEBOOK' | 'INSTAGRAM' | 'TIKTOK' | 'VK' | 'TELEGRAM' | 'LINKEDIN'
  | 'REDDIT' | 'QUORA' | 'X' | 'THREADS' | 'BLUESKY' | 'YOUTUBE';

export const STAGE_ACTOR: Readonly<Record<Stage, string>> = {
  FB_GROUP_SEARCH: 'FB_GROUP_SEARCH',
  FB_GROUP_POSTS: 'FB_GROUP_POSTS',
  FB_COMMENTS: 'FB_COMMENTS',
  IG_PROFILE_POSTS: 'IG_PROFILE_POSTS',
  IG_COMMENTS: 'IG_COMMENTS',
  TIKTOK_SEARCH: 'TIKTOK',
  TIKTOK_COMMENTS: 'TIKTOK',
  VK_WALL: 'VK_POSTS_COMMENTS',
  TELEGRAM_CHANNEL: 'TELEGRAM_CHANNEL',
  LINKEDIN_GROUPS: 'LINKEDIN_GROUPS',
  LINKEDIN_POSTS: 'LINKEDIN_POSTS',
  REDDIT_SEARCH: 'REDDIT',
  REDDIT_COMMENTS: 'REDDIT',
  QUORA_SEARCH: 'QUORA',
  BLUESKY_SEARCH: 'BLUESKY',
  X_PROFILE: 'X_PROFILE',
  THREADS_PROFILE: 'THREADS_PROFILE',
  YOUTUBE_COMMENTS: 'YOUTUBE_COMMENTS',
};

/** What the normalizer should expect from a stage. */
export const STAGE_OUTPUT: Readonly<Record<Stage, 'GROUP_SEARCH' | 'POSTS' | 'COMMENTS'>> = {
  FB_GROUP_SEARCH: 'GROUP_SEARCH', FB_GROUP_POSTS: 'POSTS', FB_COMMENTS: 'COMMENTS',
  IG_PROFILE_POSTS: 'POSTS', IG_COMMENTS: 'COMMENTS',
  TIKTOK_SEARCH: 'POSTS', TIKTOK_COMMENTS: 'COMMENTS',
  VK_WALL: 'POSTS', TELEGRAM_CHANNEL: 'POSTS',
  LINKEDIN_GROUPS: 'GROUP_SEARCH', LINKEDIN_POSTS: 'POSTS',
  REDDIT_SEARCH: 'POSTS', REDDIT_COMMENTS: 'COMMENTS', QUORA_SEARCH: 'POSTS', BLUESKY_SEARCH: 'POSTS',
  X_PROFILE: 'POSTS', THREADS_PROFILE: 'POSTS', YOUTUBE_COMMENTS: 'COMMENTS',
};

export const STAGE_NETWORK: Readonly<Record<Stage, Network>> = {
  FB_GROUP_SEARCH: 'FACEBOOK', FB_GROUP_POSTS: 'FACEBOOK', FB_COMMENTS: 'FACEBOOK',
  IG_PROFILE_POSTS: 'INSTAGRAM', IG_COMMENTS: 'INSTAGRAM',
  TIKTOK_SEARCH: 'TIKTOK', TIKTOK_COMMENTS: 'TIKTOK',
  VK_WALL: 'VK', TELEGRAM_CHANNEL: 'TELEGRAM',
  LINKEDIN_GROUPS: 'LINKEDIN', LINKEDIN_POSTS: 'LINKEDIN',
  REDDIT_SEARCH: 'REDDIT', REDDIT_COMMENTS: 'REDDIT', QUORA_SEARCH: 'QUORA', BLUESKY_SEARCH: 'BLUESKY',
  X_PROFILE: 'X', THREADS_PROFILE: 'THREADS', YOUTUBE_COMMENTS: 'YOUTUBE',
};

export interface StageParams {
  query?: string | null;
  targetUrl?: string | null;
  size: number;
  /** ISO date: only content newer than this (incremental collection). */
  since?: string | null;
}

const urls = (u: string | null | undefined) => (u ? [{ url: u }] : []);
const strings = (u: string | null | undefined) => (u ? [u] : []);
/** Date-only fields (YYYY-MM-DD) take the day of the incremental floor. */
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : undefined);

/*
 * THE REAL CONTRACTS. Each case matches the Actor's published input schema as
 * read from Apify on 2026-10-04 (registry input_contract.schemaProperties):
 * required fields are always sent, and nothing relies on a key the Actor does
 * not accept (fitToSchema drops those silently). Notably TikTok and Reddit
 * pick their job with a required `mode`, VK and Threads take plain strings,
 * Facebook group search caps by `maxGroups`, Bluesky searches `searchQueries`.
 */
export function defaultInput(stage: Stage, p: StageParams): Record<string, unknown> {
  const q = p.query ?? '';
  switch (stage) {
    case 'FB_GROUP_SEARCH':
      return { searchQueries: [q], maxGroups: p.size };
    case 'FB_GROUP_POSTS':
      return { startUrls: urls(p.targetUrl), maxItems: p.size, ...(p.since ? { onlyPostsNewerThan: day(p.since) } : {}) };
    case 'FB_COMMENTS':
      return { startUrls: urls(p.targetUrl), maxItems: p.size, commentsMode: 'NEWEST' };
    case 'IG_PROFILE_POSTS':
      return { startUrls: urls(p.targetUrl), maxItems: p.size };
    case 'IG_COMMENTS':
      return { startUrls: urls(p.targetUrl), maxItems: p.size };
    case 'TIKTOK_SEARCH':
      return q.startsWith('#')
        ? { mode: 'hashtag', input: [q.slice(1)], maxResults: p.size }
        : { mode: 'search', input: [q], maxResults: p.size };
    case 'TIKTOK_COMMENTS':
      return { mode: 'comments', input: strings(p.targetUrl), maxResults: p.size };
    case 'VK_WALL':
      return { targets: strings(p.targetUrl), ...(q ? { searchQuery: q } : {}), maxItems: p.size, includeComments: true, ...(p.since ? { publishedAfter: day(p.since) } : {}) };
    case 'TELEGRAM_CHANNEL':
      return { startUrls: urls(p.targetUrl), maxItems: p.size };
    case 'LINKEDIN_GROUPS':
      return { startUrls: urls(`https://www.linkedin.com/search/results/groups/?keywords=${encodeURIComponent(q)}`), maxItems: p.size };
    case 'LINKEDIN_POSTS':
      return { searchQueries: [q], maxItems: p.size };
    /* Reddit: site-wide keyword search, newest first, posts only; comments are a
       separate, gated stage (postComments) for qualifying posts. The 30-day
       window is applied at ingest; `searchTimeframe` is ignored by sort=new. */
    case 'REDDIT_SEARCH':
      return { mode: 'searchGlobal', searchQueries: [q], sort: 'new', searchTimeframe: 'month', searchIncludeComments: false, maxItems: p.size };
    case 'REDDIT_COMMENTS':
      return { mode: 'postComments', postUrls: urls(p.targetUrl), maxComments: p.size, maxItems: p.size };
    case 'QUORA_SEARCH':
      return { searchQueries: [q], maxItems: p.size };
    case 'BLUESKY_SEARCH':
      return { searchQueries: [q], searchType: 'posts', sort: 'latest', maxItems: p.size, ...(p.since ? { since: day(p.since) } : {}) };
    case 'X_PROFILE':
      return { startUrls: urls(p.targetUrl), maxItems: p.size, ...(p.since ? { onlyTweetsAfter: p.since } : {}) };
    case 'THREADS_PROFILE':
      return { mode: 'posts', usernames: strings(p.targetUrl), maxItems: p.size, ...(p.since ? { postedAfter: day(p.since) } : {}) };
    case 'YOUTUBE_COMMENTS':
      return { startUrls: urls(p.targetUrl), maxItems: p.size };
  }
}

export interface InputContract {
  /** properties of the Actor's input schema, as fetched from Apify. */
  schemaProperties?: string[];
  defaults?: Record<string, unknown>;
  /** our key → the Actor's key */
  rename?: Record<string, string>;
}

export function buildInput(stage: Stage, p: StageParams, contract: InputContract | null | undefined): { input: Record<string, unknown>; dropped: string[] } {
  let input: Record<string, unknown> = { ...defaultInput(stage, p) };
  for (const [from, to] of Object.entries(contract?.rename ?? {})) {
    if (from in input && typeof to === 'string' && to) { input[to] = input[from]; delete input[from]; }
  }
  input = { ...(contract?.defaults ?? {}), ...input };
  for (const k of Object.keys(input)) if (input[k] === undefined) delete input[k];
  return fitToSchema(input, contract?.schemaProperties);
}

export function fitToSchema(input: Record<string, unknown>, properties: string[] | undefined): { input: Record<string, unknown>; dropped: string[] } {
  if (!properties || properties.length === 0) return { input, dropped: [] };
  const allowed = new Set(properties);
  const out: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(input)) (allowed.has(k) ? (out[k] = v) : dropped.push(k));
  return { input: out, dropped };
}
