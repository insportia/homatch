// memo23 Actor output → one normalized shape.
//
// Actor outputs differ per Actor and drift between versions, so field access
// is tolerant (several known spellings per field) and conservative: a field
// that is not present stays null, an item without a stable id or text is
// dropped, and only real http(s) URLs survive.

export type ItemKind = 'GROUP' | 'POST' | 'COMMENT' | 'PROFILE';

export interface NormalizedItem {
  kind: ItemKind;
  network: 'FACEBOOK' | 'INSTAGRAM' | 'TIKTOK' | 'VK' | 'TELEGRAM' | 'LINKEDIN';
  externalId: string;
  url: string | null;
  parentExternalId: string | null;
  parentUrl: string | null;
  author: { id: string | null; name: string | null; url: string | null; handle: string | null };
  text: string;
  publishedAt: string | null;
  engagement: { comments: number | null; likes: number | null; shares: number | null };
  group: { id: string | null; name: string | null; url: string | null; members: number | null; description: string | null; isPublic: boolean | null } | null;
  /** Comments delivered inside a post result (VK), normalized as COMMENT items. */
  inlineComments: NormalizedItem[];
}

type Obj = Record<string, unknown>;

export function pick(o: unknown, paths: string[]): unknown {
  for (const p of paths) {
    let cur: unknown = o;
    for (const k of p.split('.')) {
      if (cur && typeof cur === 'object' && k in (cur as Obj)) cur = (cur as Obj)[k];
      else { cur = undefined; break; }
    }
    if (cur !== undefined && cur !== null && cur !== '') return cur;
  }
  return null;
}

const str = (v: unknown): string | null => (v == null ? null : typeof v === 'string' ? (v.trim() || null) : typeof v === 'number' ? String(v) : null);

export function safeHttpUrl(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch { return null; }
}

export function count(v: unknown): number | null {
  if (v == null) return null;
  if (Array.isArray(v)) return v.length;
  if (typeof v === 'object') return count(pick(v, ['count', 'total', 'totalCount']));
  const s = String(v).replace(/[,\s]/g, '').toUpperCase();
  const m = s.match(/^(\d+(?:\.\d+)?)([KM])?$/);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] === 'K' ? 1e3 : m[2] === 'M' ? 1e6 : 1);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function isoDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' || /^\d{9,13}$/.test(String(v))) {
    const n = Number(v);
    const ms = n < 1e11 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) && d.getFullYear() > 2005 ? d.toISOString() : null;
  }
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) && d.getFullYear() > 2005 ? d.toISOString() : null;
}

const TEXT = ['text', 'message', 'postText', 'content', 'caption', 'body', 'commentText', 'comment', 'description', 'title', 'desc'];
const URL_KEYS = ['url', 'postUrl', 'permalink', 'link', 'commentUrl', 'facebookUrl', 'webVideoUrl', 'videoUrl', 'shortCode'];
const DATE = ['time', 'timestamp', 'date', 'createdAt', 'created_at', 'publishedAt', 'postedAt', 'createTimeISO', 'createTime', 'taken_at', 'datePublished'];
const AUTHOR_ID = ['authorId', 'author.id', 'user.id', 'userId', 'ownerId', 'owner.id', 'from.id', 'profileId', 'authorMeta.id', 'commenterId', 'fromId', 'from_id', 'owner_id'];
const AUTHOR_NAME = ['authorName', 'author.name', 'user.name', 'user.fullName', 'userName', 'ownerFullName', 'ownerUsername', 'from.name', 'profileName', 'authorMeta.name', 'authorMeta.nickName', 'commenterName', 'name'];
const AUTHOR_URL = ['authorUrl', 'author.url', 'author.profileUrl', 'user.url', 'user.profileUrl', 'profileUrl', 'ownerProfileUrl', 'from.url', 'authorMeta.profileUrl', 'commenterUrl', 'authorProfileUrl'];
const AUTHOR_HANDLE = ['username', 'user.username', 'ownerUsername', 'authorMeta.name', 'author.username', 'uniqueId', 'authorMeta.uniqueId'];

function author(o: unknown) {
  return {
    id: str(pick(o, AUTHOR_ID)),
    name: str(pick(o, AUTHOR_NAME)),
    url: safeHttpUrl(pick(o, AUTHOR_URL)),
    handle: str(pick(o, AUTHOR_HANDLE)),
  };
}

function idOf(o: unknown, url: string | null, extra: string[] = []): string | null {
  const id = str(pick(o, [...extra, 'id', 'postId', 'post_id', 'commentId', 'comment_id', 'legacyId', 'feedbackId', 'videoId', 'aweme_id', 'pk', 'code', 'shortCode', 'messageId', 'urn']));
  if (id) return id;
  return url;
}

function engagement(o: unknown) {
  return {
    comments: count(pick(o, ['commentsCount', 'commentCount', 'comments_count', 'numComments', 'commentsNumber', 'comments.count', 'stats.commentCount', 'comments'])),
    likes: count(pick(o, ['likesCount', 'likes', 'likeCount', 'reactionsCount', 'reactions', 'diggCount', 'stats.diggCount'])),
    shares: count(pick(o, ['sharesCount', 'shares', 'shareCount', 'reposts', 'stats.shareCount'])),
  };
}

export function normalizeGroup(network: NormalizedItem['network'], o: unknown): NormalizedItem | null {
  const url = safeHttpUrl(pick(o, ['url', 'groupUrl', 'Grouplink', 'link', 'facebookUrl', 'profileUrl']));
  const id = str(pick(o, ['groupId', 'GroupID', 'id', 'pageId'])) ?? url;
  const name = str(pick(o, ['name', 'groupName', 'GroupName', 'title']));
  if (!id || !name) return null;
  const privacy = str(pick(o, ['privacy', 'type', 'visibility', 'groupType']));
  return {
    kind: 'GROUP', network, externalId: `group:${id}`, url, parentExternalId: null, parentUrl: null,
    author: { id: null, name: null, url: null, handle: null },
    text: [name, str(pick(o, ['description', 'Summary', 'summary', 'about']))].filter(Boolean).join(' — '),
    publishedAt: null,
    engagement: { comments: null, likes: null, shares: null },
    group: {
      id, name, url,
      members: count(pick(o, ['membersCount', 'members', 'memberCount', 'GroupMember', 'followers', 'membersCountText'])),
      description: str(pick(o, ['description', 'Summary', 'summary', 'about'])),
      isPublic: privacy ? !/private|closed|secret|закрыт/i.test(privacy) : null,
    },
    inlineComments: [],
  };
}

export function normalizePost(network: NormalizedItem['network'], o: unknown, parent?: { externalId: string; url: string | null } | null): NormalizedItem | null {
  const url = safeHttpUrl(pick(o, URL_KEYS));
  const text = str(pick(o, TEXT)) ?? '';
  const id = idOf(o, url);
  if (!id || !text) return null;
  const g = pick(o, ['groupId', 'group.id', 'groupUrl', 'group.url', 'pageId', 'channel', 'owner_id', 'ownerId']);
  const comments = pick(o, ['comments', 'commentsList', 'latestComments', 'topComments']);
  const post: NormalizedItem = {
    kind: 'POST', network, externalId: `post:${id}`, url,
    parentExternalId: parent?.externalId ?? (g ? `group:${str(g)}` : null),
    parentUrl: parent?.url ?? safeHttpUrl(pick(o, ['groupUrl', 'group.url', 'pageUrl', 'channelUrl'])),
    author: author(o), text, publishedAt: isoDate(pick(o, DATE)), engagement: engagement(o), group: null,
    inlineComments: [],
  };
  if (Array.isArray(comments)) {
    post.inlineComments = comments
      .map((c) => normalizeComment(network, c, { externalId: post.externalId, url: post.url }))
      .filter((c): c is NormalizedItem => c !== null)
      .slice(0, 200);
  }
  return post;
}

export function normalizeComment(network: NormalizedItem['network'], o: unknown, parent: { externalId: string; url: string | null } | null): NormalizedItem | null {
  const url = safeHttpUrl(pick(o, ['commentUrl', 'url', 'permalink', 'link']));
  const text = str(pick(o, ['text', 'commentText', 'comment', 'message', 'content', 'body'])) ?? '';
  const id = idOf(o, url, ['commentId', 'comment_id', 'cid']);
  if (!id || !text) return null;
  const parentUrl = parent?.url ?? safeHttpUrl(pick(o, ['postUrl', 'facebookUrl', 'videoWebUrl', 'inputUrl', 'post.url']));
  const parentId = parent?.externalId ?? (str(pick(o, ['postId', 'post_id', 'videoId', 'aweme_id'])) ? `post:${str(pick(o, ['postId', 'post_id', 'videoId', 'aweme_id']))}` : (parentUrl ? `post:${parentUrl}` : null));
  return {
    kind: 'COMMENT', network, externalId: `comment:${id}`, url,
    parentExternalId: parentId, parentUrl,
    author: author(o), text, publishedAt: isoDate(pick(o, DATE)), engagement: engagement(o), group: null,
    inlineComments: [],
  };
}

/** One dataset → normalized items, by the stage that produced it. */
export function normalizeDataset(
  stage: string,
  network: NormalizedItem['network'],
  items: unknown[],
  parent: { externalId: string; url: string | null } | null = null,
): NormalizedItem[] {
  const out: NormalizedItem[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(items) ? items : []) {
    if (!raw || typeof raw !== 'object') continue;
    /* Actors report errors as items with an error field; they are not results. */
    if (pick(raw, ['error', 'errorMessage']) && !pick(raw, TEXT)) continue;
    const kind = stage === 'GROUP_SEARCH' ? 'GROUP' : stage === 'COMMENTS' ? 'COMMENT' : 'POST';
    const n = kind === 'GROUP' ? normalizeGroup(network, raw)
      : kind === 'COMMENT' ? normalizeComment(network, raw, parent)
      : normalizePost(network, raw, parent);
    if (!n || seen.has(n.externalId)) continue;
    seen.add(n.externalId);
    out.push(n);
  }
  return out;
}
