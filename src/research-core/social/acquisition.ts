// HOW EVIDENCE CAN LEGITIMATELY BE ACQUIRED — PER PLATFORM, PER SURFACE, PER MODE.
//
// THE MISTAKE THIS FILE CORRECTS
//
// meta-capabilities.ts established that Meta removed the Groups API on
// 2024-04-22. That is true and it is narrow: it answers one question about one
// acquisition mode. The conclusion drawn from it — "so Facebook groups are out"
// — collapsed five different questions into one:
//
//   OFFICIAL_API        does the platform's documented API expose this?
//   BUSINESS_API        does a business/Page-scoped API expose it?
//   AUTHORIZED_ACCOUNT  can an account that legitimately sees it read it
//                       programmatically through a SUPPORTED mechanism?
//   PUBLIC_WEB          is it served to an anonymous reader?
//   PUBLIC_FEED         is there an RSS/JSON feed?
//   WEBHOOK             does the platform push it to us?
//
// A capability can be UNAVAILABLE in one mode and available in another, and a
// product that only asks the first question under-reports what it could
// legitimately read. So availability is a matrix, not a verdict.
//
// THE OTHER HALF, AND IT IS NOT NEGOTIABLE
//
// "An authorized account can see it" does not imply "we may read it
// programmatically". The distinction is the whole of the compliance boundary:
//
//   A SUPPORTED mechanism is one the platform publishes for the purpose — an
//   API, a feed, a webhook, a documented export.
//
//   Driving a logged-in browser session at a platform's ordinary web UI is NOT
//   a supported mechanism. It is the thing every one of these platforms
//   prohibits in terms, and it is what the brief forbids in its own words: do
//   not automate the normal web UI with stored credentials, do not defeat login
//   or anti-bot protections, do not impersonate.
//
// So AUTHORIZED_ACCOUNT here means "through a mechanism the platform supports
// for an authorized account". Where no such mechanism exists, the honest value
// is NOT_PROGRAMMATICALLY_AVAILABLE — which is different from UNAVAILABLE (the
// API was removed) and different from RESTRICTED (it exists but is gated).
// Three different facts, three different words, because each implies a
// different next action and only one of them is "nothing will help".
//
// WHAT A HUMAN CAN STILL DO
//
// The workflow the brief describes is real and is representable without
// bypassing anything: Homatch identifies a relevant community, a PERSON performs
// the platform-native membership action, and if a supported read mechanism then
// exists the connection becomes eligible. That is why membership state and
// readability are separate fields — joining is a human act, and it does not
// conjure an API that does not exist.

import type { SignalPlatform } from '../signals/types.ts';

export type AcquisitionMode =
  /** The platform's documented general API. */
  | 'OFFICIAL_API'
  /** A business/Page/professional-scoped API. */
  | 'BUSINESS_API'
  /** A mechanism the platform supports for an authorized account. */
  | 'AUTHORIZED_ACCOUNT'
  /** Served to an anonymous reader over ordinary HTTP. */
  | 'PUBLIC_WEB'
  /** An RSS/JSON/Atom feed intended for programmatic reading. */
  | 'PUBLIC_FEED'
  /** The platform pushes events to us. */
  | 'WEBHOOK';

/** The surfaces the product wants, named independently of any platform. */
export type CommunitySurface =
  | 'COMMUNITY_DISCOVERY'
  | 'COMMUNITY_MEMBERSHIP'
  | 'COMMUNITY_POSTS'
  | 'COMMUNITY_COMMENTS'
  | 'PAGE_POSTS'
  | 'PAGE_COMMENTS'
  | 'OWN_MEDIA'
  | 'OWN_MEDIA_COMMENTS'
  | 'PUBLIC_POSTS'
  | 'PUBLIC_COMMENTS'
  | 'KEYWORD_SEARCH';

export type SurfaceAvailability =
  /** A supported mechanism exists and works with configuration alone. */
  | 'AVAILABLE'
  /** Exists, but gated behind review, verification, partner status or a role. */
  | 'RESTRICTED'
  /**
   * A human can see it; no supported programmatic mechanism exists. The only
   * route would be automating the UI, which we do not do.
   */
  | 'NOT_PROGRAMMATICALLY_AVAILABLE'
  /** The API existed and was removed. Nothing to request. */
  | 'UNAVAILABLE'
  /** We have not established this yet, and will not guess. */
  | 'UNVERIFIED';

export interface SurfaceCapability {
  platform: SignalPlatform;
  surface: CommunitySurface;
  mode: AcquisitionMode;
  availability: SurfaceAvailability;
  /** What must be provisioned/approved. Empty when nothing would help. */
  requires: readonly string[];
  /** Why this row says what it says. Cites documentation or states the gap. */
  evidence: string;
  /**
   * Has Homatch code actually read this surface against the live platform?
   * Separate from availability: the platform permitting something and us having
   * proven we can do it are different claims, and only one of them is ours.
   */
  liveVerified: boolean;
}

/**
 * Whether a membership action is something a human can take, and whether it
 * makes the content readable afterwards. Two questions, deliberately.
 */
export type MembershipCapability =
  /** Anyone can read without joining. */
  | 'NOT_REQUIRED'
  /** A person must join through the platform. Automation is not attempted. */
  | 'JOIN_REQUIRES_HUMAN_ACTION'
  /** The platform supports a programmatic join. */
  | 'JOIN_SUPPORTED'
  /** Joining is possible but reading afterwards still has no mechanism. */
  | 'JOIN_DOES_NOT_GRANT_READ'
  | 'UNVERIFIED';

export const ACQUISITION_VERIFIED_ON = '2026-09-26';

/**
 * The matrix.
 *
 * Every row is a claim about somebody else's product, so every row carries its
 * evidence and the date above says when it was read. A row marked UNVERIFIED is
 * an admission, not a placeholder to be quietly upgraded later.
 */
export const ACQUISITION_MATRIX: readonly SurfaceCapability[] = [
  /* ── FACEBOOK ──────────────────────────────────────────────────────────── */
  {
    platform: 'FACEBOOK', surface: 'PAGE_POSTS', mode: 'BUSINESS_API',
    availability: 'RESTRICTED',
    requires: ['pages_show_list', 'pages_read_engagement', 'App Review', 'a role on the Page'],
    evidence: 'pages_read_engagement reads "content posted by the Page" and depends on '
      + 'pages_show_list, "the list of Pages a person manages". Real, and bounded to Pages the '
      + 'connected account manages.',
    liveVerified: false,
  },
  {
    platform: 'FACEBOOK', surface: 'PAGE_COMMENTS', mode: 'BUSINESS_API',
    availability: 'RESTRICTED',
    requires: ['pages_show_list', 'pages_read_user_content', 'App Review', 'a role on the Page'],
    evidence: 'pages_read_user_content reads "user generated content on the Page, such as posts, '
      + 'comments". The best official demand surface Homatch has: an enquiry under an agency '
      + 'client\'s own listing, with provenance.',
    liveVerified: false,
  },
  {
    platform: 'FACEBOOK', surface: 'COMMUNITY_POSTS', mode: 'OFFICIAL_API',
    availability: 'UNAVAILABLE',
    requires: [],
    evidence: 'Groups API removed 2024-04-22 (v19.0 changelog: "Deprecated ... publish_to_groups, '
      + 'groups_access_member_info, Groups API"). No permission, no review.',
    liveVerified: false,
  },
  {
    platform: 'FACEBOOK', surface: 'COMMUNITY_POSTS', mode: 'AUTHORIZED_ACCOUNT',
    availability: 'NOT_PROGRAMMATICALLY_AVAILABLE',
    requires: [],
    evidence: 'A member can read their groups in the app. Meta publishes no supported programmatic '
      + 'mechanism for an authorized account to do so since the Groups API was removed. The only '
      + 'remaining route is driving a logged-in browser at the ordinary web UI, which the platform '
      + 'prohibits and which this codebase does not do. Distinct from UNAVAILABLE: a human CAN see '
      + 'this content, so if Meta ever publishes a mechanism this row changes without the product '
      + 'changing.',
    liveVerified: false,
  },
  {
    platform: 'FACEBOOK', surface: 'COMMUNITY_POSTS', mode: 'PUBLIC_WEB',
    availability: 'RESTRICTED',
    requires: ['the group to be public', 'content served to an anonymous reader'],
    evidence: 'adapters/meta-platform.ts already reads this surface and, far more often, detects '
      + 'the login interstitial and records LOGIN_WALL or JOIN_REQUIRED. Genuinely public group '
      + 'content is sometimes served; most is not. RESTRICTED because the platform decides per '
      + 'request, and the adapter reports which happened rather than calling a wall an empty group.',
    liveVerified: true,
  },
  {
    platform: 'FACEBOOK', surface: 'COMMUNITY_COMMENTS', mode: 'PUBLIC_WEB',
    availability: 'RESTRICTED',
    requires: ['the group and thread to be publicly served'],
    evidence: 'Same mechanism and same caveat as COMMUNITY_POSTS/PUBLIC_WEB. Comments are the '
      + 'richer demand surface and the less often served.',
    liveVerified: true,
  },
  {
    platform: 'FACEBOOK', surface: 'COMMUNITY_DISCOVERY', mode: 'AUTHORIZED_ACCOUNT',
    availability: 'NOT_PROGRAMMATICALLY_AVAILABLE',
    requires: [],
    evidence: 'Enumerating the groups an account belongs to needed groups_access_member_info, '
      + 'removed with the Groups API. A person can list their own groups by looking; there is no '
      + 'supported call.',
    liveVerified: false,
  },
  {
    platform: 'FACEBOOK', surface: 'COMMUNITY_MEMBERSHIP', mode: 'AUTHORIZED_ACCOUNT',
    availability: 'NOT_PROGRAMMATICALLY_AVAILABLE',
    requires: ['a person to join through Facebook itself'],
    evidence: 'No supported join API. Automating a join would be defeating an access control, '
      + 'which is out of scope by instruction and by platform terms. Recorded so the workflow '
      + '"Homatch suggests a group, a human joins it" is representable without pretending the join '
      + 'itself is automatable — and note that joining does not create a read mechanism either.',
    liveVerified: false,
  },
  {
    platform: 'FACEBOOK', surface: 'KEYWORD_SEARCH', mode: 'OFFICIAL_API',
    availability: 'UNAVAILABLE',
    requires: [],
    evidence: 'No public-content search permission exists for Facebook. The Public Feed API and '
      + 'CrowdTangle are retired; the only keyword search in the permissions reference is '
      + 'threads_keyword_search, a different product.',
    liveVerified: false,
  },
  {
    platform: 'FACEBOOK', surface: 'PAGE_COMMENTS', mode: 'WEBHOOK',
    availability: 'RESTRICTED',
    requires: ['pages_read_user_content', 'App Review', 'webhook configured and callback verified'],
    evidence: 'Page webhooks deliver feed and comment events for a Page the app is installed on: '
      + 'an enquiry arrives as an event rather than being found by a poll hours later.',
    liveVerified: false,
  },

  /* ── INSTAGRAM ─────────────────────────────────────────────────────────── */
  {
    platform: 'INSTAGRAM', surface: 'OWN_MEDIA', mode: 'BUSINESS_API',
    availability: 'RESTRICTED',
    requires: ['Instagram Professional account', 'linked Facebook Page', 'instagram_basic', 'App Review'],
    evidence: 'instagram_basic reads "an Instagram account profile\'s info and media" for the '
      + 'linked Professional account. Not for arbitrary accounts.',
    liveVerified: false,
  },
  {
    platform: 'INSTAGRAM', surface: 'OWN_MEDIA_COMMENTS', mode: 'BUSINESS_API',
    availability: 'RESTRICTED',
    requires: ['instagram_manage_comments', 'App Review'],
    evidence: 'instagram_manage_comments exposes reading comments on the linked account. Homatch '
      + 'reads only; nothing here posts, hides or deletes.',
    liveVerified: false,
  },
  {
    platform: 'INSTAGRAM', surface: 'KEYWORD_SEARCH', mode: 'OFFICIAL_API',
    availability: 'RESTRICTED',
    requires: ['partner-level access Homatch does not have'],
    evidence: 'No general Instagram search. Business Discovery reads a limited public subset of '
      + 'other Professional accounts by username and returns no comment threads, so it cannot '
      + 'serve intent discovery.',
    liveVerified: false,
  },
  {
    platform: 'INSTAGRAM', surface: 'PUBLIC_POSTS', mode: 'PUBLIC_WEB',
    availability: 'RESTRICTED',
    requires: ['the profile grid to be served to an anonymous reader'],
    evidence: 'adapters/instagram.ts reads this and usually meets a login wall, which it reports '
      + 'rather than calling an empty profile.',
    liveVerified: true,
  },

  /* ── REDDIT ────────────────────────────────────────────────────────────── */
  /*
   * MEASURED 2026-09-26, and this row is now evidence rather than inference.
   *
   * The previous note said Reddit's position "could not be read" because they
   * blocked our user agent. They do serve robots.txt, and it is unambiguous:
   *
   *   # Reddit believes in an open internet, but not the misuse of public content.
   *   User-agent: *
   *   Disallow: /
   *
   * A blanket disallow for every crawler, with their Public Content Policy linked
   * beside it. That is not a gap to route around and not a rate limit to wait out
   * -- it is the answer. So PUBLIC_WEB is recorded as its own row below rather than
   * being left merely unimplemented, because "nobody has built it yet" and "we are
   * asked not to" look identical in an empty matrix, and only the second one must
   * never be revisited by somebody feeling productive.
   */
  {
    platform: 'FORUM', surface: 'COMMUNITY_POSTS', mode: 'PUBLIC_WEB',
    availability: 'UNAVAILABLE',
    requires: [],
    evidence: 'robots.txt at www.reddit.com is "User-agent: * / Disallow: /" — measured '
      + '2026-09-26, HTTP 200, served with a link to their Public Content Policy. Every '
      + 'unauthenticated path is disallowed, the .json endpoints included. This core respects '
      + 'robots, so there is nothing here to implement: reading it would mean defeating a control '
      + 'the platform states plainly. Not a rate limit, not an outage, and not pending work.',
    liveVerified: true,
  },
  {
    platform: 'FORUM', surface: 'COMMUNITY_POSTS', mode: 'OFFICIAL_API',
    availability: 'RESTRICTED',
    requires: [
      'a registered Reddit app (reddit.com/prefs/apps)',
      'OAuth client credentials held by this deployment',
      'acceptance of the Reddit Data API terms and a declared use case',
    ],
    evidence: 'Reddit publishes a documented Data API over OAuth, and with robots.txt disallowing '
      + 'everything else it is the ONLY sanctioned route to this surface. RESTRICTED rather than '
      + 'UNVERIFIED because what stands in the way is now known precisely and is not a technical '
      + 'unknown: registering an application and accepting the API terms is an act of agreement a '
      + 'person performs, not a credential that can be derived. The adapter is deliberately not '
      + 'written against it until credentials exist, because an adapter that cannot be run against '
      + 'the live platform cannot be proven and would sit in the registry looking finished.',
    liveVerified: false,
  },

  /* ── VK ────────────────────────────────────────────────────────────────── */
  /*
   * MEASURED 2026-09-26, and VK is the interesting one: unlike Reddit it does not
   * say no, and unlike Telegram it does not say yes either.
   *
   *   vk.com/robots.txt   268 lines, HTTP 200, and NO bare "Disallow: /".
   *                       Selective: *?w=wall, *?w=page, /feed*, /groups?id=,
   *                       /wall*?reply=, /wall*?thread= and many more.
   *   vk.com/<community>  302 -> m.vk.com/public<id>, which serves 102,772 bytes
   *                       HTTP 200 to an identifying agent with no credentials.
   *   m.vk.com/robots.txt the same selective policy, which matters because it is a
   *                       DIFFERENT ORIGIN and this core checks robots per origin.
   *
   * So the community landing page is genuinely permitted and genuinely served. What
   * is NOT permitted is the query form needed to page a wall -- `*?w=wall` is
   * disallowed explicitly -- and the 102KB that does arrive carries only four
   * `wall_post` markers beside fourteen `login` references and captcha/challenge
   * scaffolding.
   *
   * That is the whole finding: a reader built on this could fetch a landing page and
   * could not page a community. A community reader that cannot page is not a
   * community reader, and dressing one up as an adapter would put a row in the
   * registry that looks finished and yields almost nothing.
   */
  {
    platform: 'VK', surface: 'COMMUNITY_POSTS', mode: 'PUBLIC_WEB',
    availability: 'RESTRICTED',
    requires: [
      'a paging route that robots permits, which *?w=wall is not',
    ],
    evidence: 'Measured 2026-09-26. vk.com/robots.txt has no blanket disallow, and a community '
      + 'URL 302s to m.vk.com and returns HTTP 200 with 102,772 bytes to an identifying agent '
      + 'holding no credentials — so this is not a login wall and not a robots refusal. But '
      + '"*?w=wall" IS disallowed on both origins, and that is the form a wall is paged with, so '
      + 'only the landing page is reachable: 4 wall_post markers against 14 login references and '
      + 'captcha/challenge scaffolding in the same document. RESTRICTED, and deliberately not '
      + 'implemented: an adapter that cannot page a community is not a community reader, and it '
      + 'would sit in the registry looking finished.',
    liveVerified: true,
  },
  {
    platform: 'VK', surface: 'COMMUNITY_POSTS', mode: 'OFFICIAL_API',
    availability: 'RESTRICTED',
    requires: [
      'a VK application registered by a person',
      'a service or group access token held by this deployment',
    ],
    evidence: 'VK documents an open API with wall and comment methods for public communities, '
      + 'and with the public-web route limited to a landing page it is the only route that could '
      + 'actually read a community here. RESTRICTED rather than UNVERIFIED because what is missing '
      + 'is now known precisely: a token. It has NOT been called in this session — no token exists '
      + 'to call it with — so nothing about its current method availability or rate tiers is '
      + 'claimed, and liveVerified stays false. An operator provisioning a token is what moves '
      + 'this row, and only a real call moves liveVerified.',
    liveVerified: false,
  },

  /* ── TELEGRAM ──────────────────────────────────────────────────────────── */
  {
    platform: 'TELEGRAM', surface: 'COMMUNITY_POSTS', mode: 'PUBLIC_WEB',
    availability: 'AVAILABLE',
    requires: [],
    evidence: 'adapters/telegram runs a PUBLIC_PREVIEW mode over t.me/s/<channel>, which is an '
      + 'ordinary public web page. It reads recent posts and no comments, and says so rather than '
      + 'implying it read history.',
    liveVerified: false,
  },
  {
    platform: 'TELEGRAM', surface: 'COMMUNITY_POSTS', mode: 'OFFICIAL_API',
    availability: 'RESTRICTED',
    requires: ['bot or MTProto credentials'],
    evidence: 'adapters/telegram/client.ts defines the client contract and ships '
      + 'UnconfiguredTelegramClient, which refuses every call with NOT_CONFIGURED. The integration '
      + 'is finishable without credentials because the client is the only part that changes when '
      + 'they arrive.',
    liveVerified: false,
  },
  {
    platform: 'TELEGRAM', surface: 'COMMUNITY_COMMENTS', mode: 'PUBLIC_WEB',
    availability: 'NOT_PROGRAMMATICALLY_AVAILABLE',
    requires: [],
    evidence: 'The t.me/s/ preview does not render discussion threads. Recorded explicitly because '
      + '"the preview returned no comments" must not be read as "this channel has no discussion".',
    liveVerified: false,
  },
];

/* ────────────────────────────────────────────────────────────────────────
 * Reading the matrix
 * ──────────────────────────────────────────────────────────────────────── */

/** Every mode in which a platform can reach a surface, best availability first. */
const RANK: Record<SurfaceAvailability, number> = {
  AVAILABLE: 0,
  RESTRICTED: 1,
  UNVERIFIED: 2,
  NOT_PROGRAMMATICALLY_AVAILABLE: 3,
  UNAVAILABLE: 4,
};

export function modesFor(
  platform: SignalPlatform,
  surface: CommunitySurface,
): SurfaceCapability[] {
  return ACQUISITION_MATRIX
    .filter((r) => r.platform === platform && r.surface === surface)
    .slice()
    .sort((a, b) => RANK[a.availability] - RANK[b.availability]);
}

/**
 * The best legitimate route to a surface, or null when there is none.
 *
 * "Best" means most available, and a surface reachable only by a mode we do not
 * implement returns that row rather than null — the caller needs to know the
 * difference between "no route exists" and "a route exists and is gated".
 */
export function bestRoute(
  platform: SignalPlatform,
  surface: CommunitySurface,
): SurfaceCapability | null {
  return modesFor(platform, surface)[0] ?? null;
}

/**
 * Is there any route we could actually attempt today, given configuration?
 *
 * AVAILABLE alone. RESTRICTED means something must be provisioned or approved
 * first, and reporting it as attemptable is how a planner schedules a job that
 * can only 403.
 */
export function attemptableNow(
  platform: SignalPlatform,
  surface: CommunitySurface,
): boolean {
  return modesFor(platform, surface).some((r) => r.availability === 'AVAILABLE');
}

export interface SurfaceSummary {
  surface: CommunitySurface;
  best: SurfaceAvailability;
  /** Modes tried, in the order a planner should consider them. */
  modes: Array<{ mode: AcquisitionMode; availability: SurfaceAvailability }>;
  /** Everything an operator would have to do to open the best route. */
  requires: string[];
}

/** What a platform can reach, for the admin screen. */
export function platformSummary(platform: SignalPlatform): SurfaceSummary[] {
  const surfaces = [...new Set(
    ACQUISITION_MATRIX.filter((r) => r.platform === platform).map((r) => r.surface),
  )];

  return surfaces.map((surface) => {
    const modes = modesFor(platform, surface);
    const best = modes[0];
    return {
      surface,
      best: best ? best.availability : 'UNVERIFIED',
      modes: modes.map((m) => ({ mode: m.mode, availability: m.availability })),
      requires: best ? [...best.requires] : [],
    };
  });
}

/**
 * Surfaces that no configuration will ever open.
 *
 * UNAVAILABLE only. NOT_PROGRAMMATICALLY_AVAILABLE is deliberately excluded:
 * a human can see that content, so a future supported mechanism would change it,
 * and lumping the two together would bury a real product opportunity under a
 * permanent-sounding label.
 */
export function permanentlyClosed(platform: SignalPlatform): CommunitySurface[] {
  const closed: CommunitySurface[] = [];
  for (const summary of platformSummary(platform)) {
    if (summary.modes.every((m) => m.availability === 'UNAVAILABLE')) closed.push(summary.surface);
  }
  return closed;
}
