// PHASE 2 — every source HOMATCH discovery names, what it can honestly do, and
// what would have to be true before it may be called READY.
//
// ONE MATRIX, READ BY CODE
//
// The answer to "can Find Property read MyHome?" used to be spread over a
// survey comment in market/runtime.ts, a host list in source-audit, a registry
// row in production and a Meta capability table. This file is the one place
// that states it per source, and `sourceStatus()` is the one function that
// turns it plus production evidence into a status. The admin panel and the
// release report read the same answer.
//
// CODE PRESENCE IS NEVER READINESS
//
// `implementation` says what exists in this repository. `sourceStatus()` will
// not return READY for any source unless a production proof is supplied: a
// passing live-check row, or real collected rows from that source, inside the
// proof window. A fixture test proves the parser, not the source.
//
// Status words (owner contract, Phase 2 §11):
//   READY            implemented, enabled, proven live inside the window
//   DEGRADED         proven live once, but the latest proof is partial or failing
//   BLOCKED          cannot run: access control, missing credential/review,
//                    or no live proof yet (`reason` says which)
//   DISABLED         implemented and proven, switched off by an operator
//   NOT_IMPLEMENTED  no adapter in this repository

export type SourceStatus = 'READY' | 'DEGRADED' | 'BLOCKED' | 'DISABLED' | 'NOT_IMPLEMENTED';

export type SourceKind = 'PORTAL' | 'COMMUNITY' | 'SOCIAL';

export type SourcePlatform = 'PORTAL' | 'TELEGRAM' | 'FORUM' | 'FACEBOOK' | 'INSTAGRAM' | 'LINKEDIN';

/** How bytes reach HOMATCH. Mirrors discovery_source_live_checks.route where one exists. */
export type RetrievalMethod =
  | 'EDGE_HTTP'
  | 'WORKER_HTTP'
  | 'WORKER_BROWSER'
  | 'TELEGRAM_MTPROTO'
  | 'OFFICIAL_API'
  | 'NONE';

/**
 * What this repository contains for the source.
 *   IMPLEMENTED      an executable adapter customer runs may use once proven
 *   CANDIDATE        an adapter that only the live check runs; never a customer run
 *   ACCESS_GATED     an adapter for an official API whose access is not granted
 *   NOT_IMPLEMENTED  nothing
 */
export type Implementation = 'IMPLEMENTED' | 'CANDIDATE' | 'ACCESS_GATED' | 'NOT_IMPLEMENTED';

/** What the tests stand on. CAPTURED = a real page; DOC_SHAPED / SYNTHETIC = written by us. */
export type FixtureKind = 'CAPTURED' | 'DOC_SHAPED' | 'SYNTHETIC' | 'NONE';

/** Cost class per retrieval. Numbers live in docs/claude/PHASE2_DISCOVERY.md (COGS). */
export type CostClass = 'NEAR_ZERO' | 'PAID_BROWSER' | 'PAID_API' | 'NONE';

/** Whether a field is provided by the source, sometimes, or never. */
export type Availability = 'YES' | 'SOMETIMES' | 'NO';

export interface SourceCapability {
  key: string;
  label: string;
  kind: SourceKind;
  platform: SourcePlatform;
  hosts: readonly string[];
  /** The adapter id that executes it; equals discovery_source_live_checks.source_key. */
  adapterId: string | null;
  implementation: Implementation;
  retrieval: RetrievalMethod;
  /** Null when anonymous public access is enough. */
  authRequired: string | null;
  publicData: string;
  exactLink: Availability;
  authorProfile: Availability;
  contacts: Availability;
  fixture: FixtureKind;
  cost: CostClass;
  /** Why it cannot run, when that is permanent or external. Null when nothing blocks the code path. */
  blocker: string | null;
  action: string;
}

const PORTAL_PUBLIC = 'listing pages: title, price, area, rooms, city/district, description';

export const SOURCE_CAPABILITIES: readonly SourceCapability[] = [
  /* ── PORTALS ─────────────────────────────────────────────────────────── */
  {
    key: 'ss-ge', label: 'ss.ge / home.ss.ge', kind: 'PORTAL', platform: 'PORTAL',
    hosts: ['home.ss.ge', 'ss.ge'], adapterId: 'ss-ge', implementation: 'IMPLEMENTED',
    retrieval: 'EDGE_HTTP', authRequired: null,
    publicData: 'search JSON in __NEXT_DATA__: price, area, rooms, bedrooms, district, createDate',
    exactLink: 'YES', authorProfile: 'NO', contacts: 'NO', fixture: 'CAPTURED', cost: 'NEAR_ZERO',
    blocker: null,
    action: 'Run the bounded live check; promote on pass. Detail pages are JS-rendered, so photos and contacts need the browser route.',
  },
  {
    key: 'myhome-ge', label: 'myhome.ge', kind: 'PORTAL', platform: 'PORTAL',
    hosts: ['www.myhome.ge', 'myhome.ge'], adapterId: 'myhome-ge', implementation: 'CANDIDATE',
    retrieval: 'WORKER_BROWSER', authRequired: null, publicData: PORTAL_PUBLIC,
    exactLink: 'YES', authorProfile: 'SOMETIMES', contacts: 'SOMETIMES', fixture: 'SYNTHETIC', cost: 'PAID_BROWSER',
    blocker: 'Answers 403 to every non-browser client (site and api.myhome.ge, 2026-09-20); production registry lifecycle BLOCKED. Page shape never captured: the sandbox cannot reach it.',
    action: 'Enable the discovery browser route (owner approval), run the WORKER_BROWSER live check; a challenge page is recorded as BLOCKED, never worked around.',
  },
  {
    key: 'livo-ge', label: 'livo.ge', kind: 'PORTAL', platform: 'PORTAL',
    hosts: ['livo.ge', 'www.livo.ge'], adapterId: 'livo-ge', implementation: 'CANDIDATE',
    retrieval: 'EDGE_HTTP', authRequired: null, publicData: PORTAL_PUBLIC,
    exactLink: 'YES', authorProfile: 'SOMETIMES', contacts: 'SOMETIMES', fixture: 'SYNTHETIC', cost: 'NEAR_ZERO',
    blocker: 'Never surveyed (runtime.ts survey note) and absent from source_registry; page shape unknown.',
    action: 'Run the live check (robots-declared sitemaps + structured data); pin the route from its evidence; add a registry row.',
  },
  {
    key: 'place-ge', label: 'place.ge', kind: 'PORTAL', platform: 'PORTAL',
    hosts: ['place.ge'], adapterId: 'place-ge', implementation: 'IMPLEMENTED',
    retrieval: 'EDGE_HTTP', authRequired: null, publicData: PORTAL_PUBLIC,
    exactLink: 'YES', authorProfile: 'NO', contacts: 'NO', fixture: 'CAPTURED', cost: 'NEAR_ZERO',
    blocker: null, action: 'Run the bounded live check.',
  },
  {
    key: 'home-ge', label: 'home.ge', kind: 'PORTAL', platform: 'PORTAL',
    hosts: ['www.home.ge', 'home.ge'], adapterId: 'home-ge', implementation: 'IMPLEMENTED',
    retrieval: 'EDGE_HTTP', authRequired: null, publicData: PORTAL_PUBLIC,
    exactLink: 'YES', authorProfile: 'NO', contacts: 'NO', fixture: 'CAPTURED', cost: 'NEAR_ZERO',
    blocker: null, action: 'Run the bounded live check.',
  },
  {
    key: 'home24-ge', label: 'home24.ge', kind: 'PORTAL', platform: 'PORTAL',
    hosts: ['www.home24.ge', 'home24.ge'], adapterId: 'home24-ge', implementation: 'IMPLEMENTED',
    retrieval: 'EDGE_HTTP', authRequired: null, publicData: PORTAL_PUBLIC,
    exactLink: 'YES', authorProfile: 'NO', contacts: 'NO', fixture: 'CAPTURED', cost: 'NEAR_ZERO',
    blocker: null, action: 'Run the bounded live check.',
  },
  {
    key: 'zaraya-properties', label: 'Zaraya (zarayaproperties.com)', kind: 'PORTAL', platform: 'PORTAL',
    hosts: ['www.zarayaproperties.com', 'zarayaproperties.com'], adapterId: 'zaraya-properties', implementation: 'IMPLEMENTED',
    retrieval: 'EDGE_HTTP', authRequired: null, publicData: 'developer units: price (developer basis), area, rooms',
    exactLink: 'YES', authorProfile: 'NO', contacts: 'NO', fixture: 'CAPTURED', cost: 'NEAR_ZERO',
    blocker: null, action: 'Run the bounded live check.',
  },
  {
    key: 'realting-com', label: 'realting.com', kind: 'PORTAL', platform: 'PORTAL',
    hosts: ['realting.com'], adapterId: 'realting-com', implementation: 'IMPLEMENTED',
    retrieval: 'EDGE_HTTP', authRequired: null, publicData: 'schema.org listings incl. coordinates',
    exactLink: 'YES', authorProfile: 'NO', contacts: 'NO', fixture: 'CAPTURED', cost: 'NEAR_ZERO',
    blocker: null, action: 'Run the bounded live check.',
  },
  {
    key: 'estatemarket-ge', label: 'estatemarket.ge', kind: 'PORTAL', platform: 'PORTAL',
    hosts: ['estatemarket.ge'], adapterId: 'estatemarket-ge', implementation: 'IMPLEMENTED',
    retrieval: 'EDGE_HTTP', authRequired: null, publicData: 'developer unit types for one verified complex',
    exactLink: 'YES', authorProfile: 'NO', contacts: 'NO', fixture: 'CAPTURED', cost: 'NEAR_ZERO',
    blocker: null, action: 'Run the bounded live check; one complex route only.',
  },
  {
    key: 'makler-ge', label: 'makler.ge', kind: 'PORTAL', platform: 'PORTAL',
    hosts: ['www.makler.ge', 'makler.ge'], adapterId: 'makler-ge', implementation: 'IMPLEMENTED',
    retrieval: 'EDGE_HTTP', authRequired: null, publicData: 'schema.org ItemList; no reliable price field',
    exactLink: 'YES', authorProfile: 'NO', contacts: 'NO', fixture: 'CAPTURED', cost: 'NEAR_ZERO',
    blocker: null, action: 'Run the bounded live check; add a registry row if it passes.',
  },

  /* ── COMMUNITIES ─────────────────────────────────────────────────────── */
  {
    key: 'telegram', label: 'Telegram public channels/groups', kind: 'COMMUNITY', platform: 'TELEGRAM',
    hosts: ['t.me'], adapterId: 'telegram-community', implementation: 'IMPLEMENTED',
    retrieval: 'TELEGRAM_MTPROTO', authRequired: 'operator MTProto session on the official worker (Railway variables)',
    publicData: 'public channel/group messages: text, date, author @username when shown',
    exactLink: 'YES', authorProfile: 'SOMETIMES', contacts: 'SOMETIMES', fixture: 'CAPTURED', cost: 'NEAR_ZERO',
    blocker: null, action: 'Collecting in production; listing posts extract forward. Backfill waits for approval.',
  },
  {
    key: 'forum-ge', label: 'forum.ge real-estate board', kind: 'COMMUNITY', platform: 'FORUM',
    hosts: ['forum.ge'], adapterId: 'forum-community', implementation: 'IMPLEMENTED',
    retrieval: 'EDGE_HTTP', authRequired: null,
    publicData: 'board topics and posts: findpost permalink, topic, author showuser profile, text',
    exactLink: 'YES', authorProfile: 'YES', contacts: 'SOMETIMES', fixture: 'CAPTURED', cost: 'NEAR_ZERO',
    blocker: null, action: 'forum_discovery_enabled / forum_schedule_enabled are OFF; switch on after review.',
  },

  /* ── SOCIAL ──────────────────────────────────────────────────────────── */
  {
    key: 'facebook-pages', label: 'Facebook public Pages', kind: 'SOCIAL', platform: 'FACEBOOK',
    hosts: ['graph.facebook.com'], adapterId: 'facebook-graph-pages', implementation: 'ACCESS_GATED',
    retrieval: 'OFFICIAL_API',
    authRequired: 'Graph API token with Page Public Content Access (Meta App Review + Business Verification), separate from the Meta Ads app credentials',
    publicData: 'posts on public Pages: message, permalink_url, created_time; comment authors are not returned for Pages we do not manage',
    exactLink: 'YES', authorProfile: 'SOMETIMES', contacts: 'SOMETIMES', fixture: 'DOC_SHAPED', cost: 'NEAR_ZERO',
    blocker: 'No discovery token or Page Public Content Access exists for HOMATCH. Anonymous pages hit login walls; automating a logged-in UI is prohibited.',
    action: 'Owner decides whether to apply for Page Public Content Access under a discovery-only Meta app.',
  },
  {
    key: 'facebook-groups', label: 'Facebook groups', kind: 'SOCIAL', platform: 'FACEBOOK',
    hosts: ['facebook.com'], adapterId: null, implementation: 'NOT_IMPLEMENTED',
    retrieval: 'NONE', authRequired: 'none possible',
    publicData: 'none programmatically: Groups API removed 2024-04-22',
    exactLink: 'NO', authorProfile: 'NO', contacts: 'NO', fixture: 'NONE', cost: 'NONE',
    blocker: 'Groups API removed by Meta on 2024-04-22; no permission, review or partner tier restores it. Logged-out group pages are login-walled; the retired scraping vendors stay locked off (CLAUDE.md).',
    action: 'None technical. A person may share a post link manually; that is not discovery.',
  },
  {
    key: 'instagram', label: 'Instagram public professional accounts / hashtags', kind: 'SOCIAL', platform: 'INSTAGRAM',
    hosts: ['graph.facebook.com'], adapterId: 'instagram-graph', implementation: 'ACCESS_GATED',
    retrieval: 'OFFICIAL_API',
    authRequired: 'Instagram Professional account linked to a Page + instagram_basic and Instagram Public Content Access (App Review)',
    publicData: 'Business Discovery: username, media caption, permalink, timestamp of other professional accounts; hashtag media: caption, permalink, timestamp (no username)',
    exactLink: 'YES', authorProfile: 'SOMETIMES', contacts: 'SOMETIMES', fixture: 'DOC_SHAPED', cost: 'NEAR_ZERO',
    blocker: 'No linked Instagram professional account or reviewed permission exists for discovery. Personal accounts are unreachable by design.',
    action: 'Owner decides whether to link a professional account and submit the review.',
  },
  {
    key: 'linkedin', label: 'LinkedIn', kind: 'SOCIAL', platform: 'LINKEDIN',
    hosts: ['linkedin.com'], adapterId: null, implementation: 'NOT_IMPLEMENTED',
    retrieval: 'NONE', authRequired: 'none available for third-party content',
    publicData: 'none programmatically: no public post search API; member/org content APIs are limited to the authorizing member or administered organization',
    exactLink: 'NO', authorProfile: 'NO', contacts: 'NO', fixture: 'NONE', cost: 'NONE',
    blocker: 'LinkedIn offers no API that returns other people\'s posts; public pages require login after a few views and its terms prohibit automated collection. This repo already forbids LINKEDIN_SCRAPE (src/lib/comm/researchPlan.ts).',
    action: 'None technical. Revisit only if LinkedIn grants partner content access.',
  },
];

const BY_KEY = new Map(SOURCE_CAPABILITIES.map((c) => [c.key, c]));

export function sourceCapability(key: string): SourceCapability {
  const found = BY_KEY.get(key);
  if (!found) throw new Error(`unknown discovery source: ${key}`);
  return found;
}

/* ── Status ─────────────────────────────────────────────────────────────── */

/** One discovery_source_live_checks row, as much as the status needs. */
export interface LiveCheckEvidence {
  source_key: string;
  route: string;
  checked_at: string;
  ok: boolean;
  detail_ok?: boolean | null;
  normalized_ok?: boolean | null;
  latency_ms?: number | null;
  limitation?: string | null;
}

export interface SourceEvidence {
  /** Live-check rows for this source (any order). */
  liveChecks?: readonly LiveCheckEvidence[];
  /** Newest row this source genuinely produced in production (raw_signals / supply_observations). */
  lastCollectedAt?: string | null;
  /** The operator switch for this source; false = switched off. Undefined = no switch. */
  enabled?: boolean;
  now?: number;
}

export interface SourceStatusResult {
  key: string;
  status: SourceStatus;
  liveTested: boolean;
  reason: string;
  lastCheck: LiveCheckEvidence | null;
  lastProofAt: string | null;
}

/** A proof older than this no longer makes a source READY. */
export const PROOF_WINDOW_DAYS = 14;

const DAY = 86_400_000;

function within(at: string | null | undefined, now: number): boolean {
  if (!at) return false;
  const t = Date.parse(at);
  return Number.isFinite(t) && now - t <= PROOF_WINDOW_DAYS * DAY && t <= now + DAY;
}

/* A PASS is an adapter row that collected, identified and normalized a listing.
   A host probe (robots + home page, source_key = host) shows reachability only. */
const fullPass = (c: LiveCheckEvidence, adapterId: string | null) =>
  !!adapterId && c.source_key === adapterId && c.ok && c.detail_ok === true && c.normalized_ok === true;

export function sourceStatus(capability: SourceCapability, evidence: SourceEvidence = {}): SourceStatusResult {
  const now = evidence.now ?? Date.now();
  const checks = [...(evidence.liveChecks ?? [])]
    .filter((c) => c.source_key === capability.adapterId || capability.hosts.includes(c.source_key))
    .sort((a, b) => Date.parse(b.checked_at) - Date.parse(a.checked_at));
  const lastCheck = checks[0] ?? null;
  const lastPass = checks.find((c) => fullPass(c, capability.adapterId)) ?? null;
  const lastProofAt = [lastPass?.checked_at, evidence.lastCollectedAt]
    .filter((v): v is string => !!v && Number.isFinite(Date.parse(v)))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
  const liveTested = !!lastProofAt;
  const result = (status: SourceStatus, reason: string): SourceStatusResult =>
    ({ key: capability.key, status, liveTested, reason, lastCheck, lastProofAt });

  if (capability.implementation === 'NOT_IMPLEMENTED') {
    return capability.blocker ? result('BLOCKED', capability.blocker) : result('NOT_IMPLEMENTED', 'no adapter');
  }
  if (capability.implementation === 'ACCESS_GATED') {
    return result('BLOCKED', capability.blocker ?? 'access not granted');
  }
  if (evidence.enabled === false) return result('DISABLED', 'switched off by an operator');
  if (!lastProofAt) {
    return result('BLOCKED', capability.implementation === 'CANDIDATE'
      ? `AWAITING_LIVE_PROOF (candidate adapter): ${capability.blocker ?? 'never checked live'}`
      : 'AWAITING_LIVE_PROOF: no passing live check and no collected rows');
  }
  if (!within(lastProofAt, now)) return result('DEGRADED', `last proof ${lastProofAt} is older than ${PROOF_WINDOW_DAYS} days`);
  const lastAdapterCheck = checks.find((c) => c.source_key === capability.adapterId) ?? null;
  if (lastAdapterCheck && !fullPass(lastAdapterCheck, capability.adapterId) && Date.parse(lastAdapterCheck.checked_at) > Date.parse(lastProofAt)) {
    const c = lastAdapterCheck;
    return result('DEGRADED', `latest check failed: ${c.limitation ?? (c.ok ? 'partial (detail/normalization)' : 'not ok')}`);
  }
  if (capability.implementation === 'CANDIDATE') {
    return result('DEGRADED', 'live check passed, but a candidate adapter is not used by customer runs until it is pinned and promoted');
  }
  return result('READY', `proven ${lastProofAt}`);
}
