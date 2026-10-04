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
  | 'LINKEDIN_GROUPS' | 'LINKEDIN_POSTS';

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
};

/** What the normalizer should expect from a stage. */
export const STAGE_OUTPUT: Readonly<Record<Stage, 'GROUP_SEARCH' | 'POSTS' | 'COMMENTS'>> = {
  FB_GROUP_SEARCH: 'GROUP_SEARCH', FB_GROUP_POSTS: 'POSTS', FB_COMMENTS: 'COMMENTS',
  IG_PROFILE_POSTS: 'POSTS', IG_COMMENTS: 'COMMENTS',
  TIKTOK_SEARCH: 'POSTS', TIKTOK_COMMENTS: 'COMMENTS',
  VK_WALL: 'POSTS', TELEGRAM_CHANNEL: 'POSTS',
  LINKEDIN_GROUPS: 'GROUP_SEARCH', LINKEDIN_POSTS: 'POSTS',
};

export const STAGE_NETWORK: Readonly<Record<Stage, 'FACEBOOK' | 'INSTAGRAM' | 'TIKTOK' | 'VK' | 'TELEGRAM' | 'LINKEDIN'>> = {
  FB_GROUP_SEARCH: 'FACEBOOK', FB_GROUP_POSTS: 'FACEBOOK', FB_COMMENTS: 'FACEBOOK',
  IG_PROFILE_POSTS: 'INSTAGRAM', IG_COMMENTS: 'INSTAGRAM',
  TIKTOK_SEARCH: 'TIKTOK', TIKTOK_COMMENTS: 'TIKTOK',
  VK_WALL: 'VK', TELEGRAM_CHANNEL: 'TELEGRAM',
  LINKEDIN_GROUPS: 'LINKEDIN', LINKEDIN_POSTS: 'LINKEDIN',
};

export interface StageParams {
  query?: string | null;
  targetUrl?: string | null;
  size: number;
  /** ISO date: only content newer than this (incremental collection). */
  since?: string | null;
}

const urls = (u: string | null | undefined) => (u ? [{ url: u }] : []);

export function defaultInput(stage: Stage, p: StageParams): Record<string, unknown> {
  const q = p.query ?? '';
  switch (stage) {
    case 'FB_GROUP_SEARCH':
      return { startUrls: urls(`https://www.facebook.com/search/groups/?q=${encodeURIComponent(q)}`), maxItems: p.size };
    case 'FB_GROUP_POSTS':
      return { startUrls: urls(p.targetUrl), maxItems: p.size, ...(p.since ? { onlyPostsNewerThan: p.since } : {}) };
    case 'FB_COMMENTS':
      return { startUrls: urls(p.targetUrl), maxItems: p.size, commentsMode: 'NEWEST' };
    case 'IG_PROFILE_POSTS':
      return { startUrls: urls(p.targetUrl), maxItems: p.size, ...(p.since ? { onlyPostsNewerThan: p.since } : {}) };
    case 'IG_COMMENTS':
      return { startUrls: urls(p.targetUrl), maxItems: p.size };
    case 'TIKTOK_SEARCH':
      return q.startsWith('#')
        ? { hashtags: [q.slice(1)], maxItems: p.size }
        : { searchQueries: [q], maxItems: p.size };
    case 'TIKTOK_COMMENTS':
      return { postURLs: p.targetUrl ? [p.targetUrl] : [], commentsPerPost: p.size, maxItems: p.size };
    case 'VK_WALL':
      return { startUrls: urls(p.targetUrl), keyword: q || undefined, maxItems: p.size, includeComments: true, ...(p.since ? { dateFrom: p.since.slice(0, 10) } : {}) };
    case 'TELEGRAM_CHANNEL':
      return { startUrls: urls(p.targetUrl), maxItems: p.size };
    case 'LINKEDIN_GROUPS':
      return { startUrls: urls(`https://www.linkedin.com/search/results/groups/?keywords=${encodeURIComponent(q)}`), maxItems: p.size };
    case 'LINKEDIN_POSTS':
      return { searchQueries: [q], maxItems: p.size };
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
