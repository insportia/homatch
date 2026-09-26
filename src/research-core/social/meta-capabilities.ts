// WHAT META ACTUALLY LETS US READ, READ OFF META'S OWN DOCUMENTATION.
//
// Verified against developers.facebook.com on 2026-09-26. Not from memory, not
// from a blog, and not from what the product would like to be true.
//
// THE HEADLINE, AND IT IS UNCOMFORTABLE
//
// Homatch's strongest thesis for Facebook is expat and property GROUPS — "need a
// long-term flat in Vake from October" is exactly the evidence the matching
// engine exists to consume, and those sentences are written in groups all day.
//
// The Groups API is gone. From Meta's v19.0 changelog, quoted verbatim:
//
//   "Deprecated the following Groups API permissions and features:
//    publish_to_groups, groups_access_member_info, Groups API"
//
// v19.0 shipped 2024-01-23 and the removal date was 2024-04-22. There is no
// permission to request, no App Review to pass and no Business Verification to
// complete. The capability does not exist.
//
// So FACEBOOK_GROUP_POSTS is UNAVAILABLE, and it is important that it is
// UNAVAILABLE rather than REQUIRES_APP_REVIEW. The second would tell an operator
// to go and fill in a form, and there is no form.
//
// WHAT THE OFFICIAL API DOES GIVE US, AND ITS REAL SHAPE
//
// Reading a Page needs `pages_read_engagement` ("read content (posts, photos,
// videos, events) posted by the Page") and `pages_read_user_content` ("read user
// generated content on the Page, such as posts, comments"). Both depend on
// `pages_show_list`, which is "access the list of Pages a person manages".
//
// Read that dependency again, because it is the whole story: the official path
// reads Pages THE CONNECTED ACCOUNT MANAGES. Connecting an admin's Facebook
// account does not open the rest of Facebook. It opens that admin's own Pages.
//
// Instagram is the same shape one step further out: `instagram_basic` depends on
// `pages_show_list` and requires an Instagram PROFESSIONAL account linked to a
// Page the account manages.
//
// And there is no public-content search permission. The Public Feed API and
// CrowdTangle are both retired; the only keyword search in the current
// permissions reference is `threads_keyword_search`, which is Threads and not
// Facebook.
//
// WHAT THAT MEANS FOR THE PRODUCT, SAID PLAINLY
//
// The official Meta connection is worth building — it reads Homatch's own Pages
// and linked Instagram Professional accounts, and an agency or developer client
// who connects THEIR Page gives Homatch legitimate access to the enquiries on
// it, which is real demand evidence with real provenance.
//
// It is not a route to the expat groups, and no amount of OAuth makes it one.
// The public-HTTP adapter in adapters/meta-platform.ts already handles that
// surface honestly: it detects the login interstitial and records LOGIN_WALL or
// JOIN_REQUIRED instead of reporting an empty group. Those two mechanisms are
// complementary and this file is what keeps them from being confused.

/** The surfaces a Meta integration might be asked for. */
export type MetaCapability =
  | 'FACEBOOK_LOGIN'
  | 'FACEBOOK_PAGE_LIST'
  | 'FACEBOOK_PAGE_POSTS'
  | 'FACEBOOK_PAGE_COMMENTS'
  | 'FACEBOOK_GROUP_LIST'
  | 'FACEBOOK_GROUP_POSTS'
  | 'FACEBOOK_GROUP_COMMENTS'
  | 'FACEBOOK_PUBLIC_SEARCH'
  | 'INSTAGRAM_ACCOUNT_LINKAGE'
  | 'INSTAGRAM_MEDIA'
  | 'INSTAGRAM_COMMENTS'
  | 'INSTAGRAM_DISCOVERY'
  | 'WEBHOOKS_PAGE'
  | 'WEBHOOKS_INSTAGRAM';

/**
 * How available a capability is, independent of whether WE have it yet.
 *
 * The distinction that matters is between "you must do something" and "there is
 * nothing to do". REQUIRES_APP_REVIEW sends an operator to a form. UNAVAILABLE
 * tells them not to bother. Reporting the second as the first wastes weeks.
 */
export type CapabilityAvailability =
  /** Works with a standard token, no review. */
  | 'SUPPORTED'
  /** Works once the named permission is granted. */
  | 'SUPPORTED_WITH_PERMISSION'
  /** Needs Advanced Access on the permission. */
  | 'REQUIRES_ADVANCED_ACCESS'
  /** Needs Meta App Review. */
  | 'REQUIRES_APP_REVIEW'
  /** Needs Business Verification of the Meta app's business. */
  | 'REQUIRES_BUSINESS_VERIFICATION'
  /** Only for a Page the connected account holds a role on. */
  | 'REQUIRES_PAGE_ROLE'
  /** Only for an Instagram Professional (Business/Creator) account. */
  | 'REQUIRES_INSTAGRAM_PROFESSIONAL_ACCOUNT'
  /** Meta restricts it to specific partners or use cases. */
  | 'RESTRICTED'
  /** The API does not exist. Nothing to request. */
  | 'UNAVAILABLE';

export interface MetaCapabilitySpec {
  capability: MetaCapability;
  availability: CapabilityAvailability;
  /** Meta permission strings this needs, exactly as Meta spells them. */
  permissions: readonly string[];
  /** Other capabilities that must work first. */
  dependsOn: readonly MetaCapability[];
  /**
   * What an operator must do outside Homatch. Empty when nothing would help —
   * which is the honest answer for a removed API.
   */
  externalSteps: readonly string[];
  /** Why this row says what it says. Cites the documentation. */
  evidence: string;
}

/**
 * When the documentation behind this table was last read.
 *
 * Exposed because a capability matrix is a claim about somebody else's product,
 * and a claim about somebody else's product has a shelf life. Admin renders this
 * date next to the matrix so nobody mistakes a two-year-old reading for today's.
 */
export const META_CAPABILITIES_VERIFIED_ON = '2026-09-26';

export const META_CAPABILITY_MATRIX: readonly MetaCapabilitySpec[] = [
  {
    capability: 'FACEBOOK_LOGIN',
    availability: 'SUPPORTED',
    permissions: ['public_profile'],
    dependsOn: [],
    externalSteps: ['Create a Meta app and set its OAuth redirect URI to the Homatch callback'],
    evidence: 'Facebook Login with public_profile needs no review. It authenticates the operator '
      + 'and nothing more: it reads no Page, no group and no Instagram account.',
  },
  {
    capability: 'FACEBOOK_PAGE_LIST',
    availability: 'REQUIRES_APP_REVIEW',
    permissions: ['pages_show_list'],
    dependsOn: ['FACEBOOK_LOGIN'],
    externalSteps: ['Submit pages_show_list for App Review'],
    evidence: 'pages_show_list is documented as "access the list of Pages a person manages". It is '
      + 'the dependency every Page and Instagram capability below rests on, and it is also the '
      + 'sentence that bounds all of them: the Pages a person MANAGES, not the Pages that exist.',
  },
  {
    capability: 'FACEBOOK_PAGE_POSTS',
    availability: 'REQUIRES_APP_REVIEW',
    permissions: ['pages_read_engagement', 'pages_show_list'],
    dependsOn: ['FACEBOOK_PAGE_LIST'],
    externalSteps: ['Submit pages_read_engagement for App Review', 'Hold a role on the Page'],
    evidence: 'pages_read_engagement is documented as "read content (posts, photos, videos, '
      + 'events) posted by the Page", depends on pages_show_list, and therefore applies only to a '
      + 'Page the connected account manages.',
  },
  {
    capability: 'FACEBOOK_PAGE_COMMENTS',
    availability: 'REQUIRES_APP_REVIEW',
    permissions: ['pages_read_user_content', 'pages_show_list'],
    dependsOn: ['FACEBOOK_PAGE_LIST'],
    externalSteps: ['Submit pages_read_user_content for App Review', 'Hold a role on the Page'],
    evidence: 'pages_read_user_content is documented as "read user generated content on the Page, '
      + 'such as posts, comments". This is the most valuable official surface for Homatch: an '
      + 'enquiry left under an agency client\'s own listing is real demand with real provenance.',
  },
  {
    capability: 'FACEBOOK_GROUP_LIST',
    availability: 'UNAVAILABLE',
    permissions: [],
    dependsOn: [],
    externalSteps: [],
    evidence: 'Removed with the Groups API. Meta\'s v19.0 changelog: "Deprecated the following '
      + 'Groups API permissions and features: publish_to_groups, groups_access_member_info, '
      + 'Groups API". v19.0 shipped 2024-01-23; removal 2024-04-22.',
  },
  {
    capability: 'FACEBOOK_GROUP_POSTS',
    availability: 'UNAVAILABLE',
    permissions: [],
    dependsOn: [],
    externalSteps: [],
    evidence: 'No API. See FACEBOOK_GROUP_LIST. This is the capability Homatch would most like to '
      + 'have — expat and property groups are where housing intent is actually written — and there '
      + 'is no permission to request and no review to pass. Recorded as UNAVAILABLE rather than '
      + 'REQUIRES_APP_REVIEW so nobody is sent to fill in a form that does not exist.',
  },
  {
    capability: 'FACEBOOK_GROUP_COMMENTS',
    availability: 'UNAVAILABLE',
    permissions: [],
    dependsOn: [],
    externalSteps: [],
    evidence: 'Removed with the Groups API on 2024-04-22, along with the posts they sit under. '
      + 'A comment under a group post is the single richest demand signal on Facebook — somebody '
      + 'asking "is this still available, and is it furnished?" — and there is no official way to '
      + 'read one. No permission, no review, no partner tier.',
  },
  {
    capability: 'FACEBOOK_PUBLIC_SEARCH',
    availability: 'UNAVAILABLE',
    permissions: [],
    dependsOn: [],
    externalSteps: [],
    evidence: 'There is no public-content search permission for Facebook in the current '
      + 'permissions reference. The Public Feed API and CrowdTangle are retired. The only keyword '
      + 'search documented is threads_keyword_search, which is Threads, a different product.',
  },
  {
    capability: 'INSTAGRAM_ACCOUNT_LINKAGE',
    availability: 'REQUIRES_INSTAGRAM_PROFESSIONAL_ACCOUNT',
    permissions: ['instagram_basic', 'pages_show_list'],
    dependsOn: ['FACEBOOK_PAGE_LIST'],
    externalSteps: [
      'Convert the Instagram account to Professional (Business or Creator)',
      'Link it to a Facebook Page the connected account manages',
      'Submit instagram_basic for App Review',
    ],
    evidence: 'instagram_basic is documented as "read an Instagram account profile\'s info and '
      + 'media", depends on pages_show_list and pages_read_user_content, and requires a '
      + 'Professional account. A personal Instagram account is not reachable.',
  },
  {
    capability: 'INSTAGRAM_MEDIA',
    availability: 'REQUIRES_INSTAGRAM_PROFESSIONAL_ACCOUNT',
    permissions: ['instagram_basic'],
    dependsOn: ['INSTAGRAM_ACCOUNT_LINKAGE'],
    externalSteps: ['Submit instagram_basic for App Review'],
    evidence: 'Media and captions for the linked Professional account come with instagram_basic. '
      + 'Only for the linked account — not for arbitrary accounts.',
  },
  {
    capability: 'INSTAGRAM_COMMENTS',
    availability: 'REQUIRES_APP_REVIEW',
    permissions: ['instagram_manage_comments', 'instagram_basic', 'pages_show_list'],
    dependsOn: ['INSTAGRAM_ACCOUNT_LINKAGE'],
    externalSteps: ['Submit instagram_manage_comments for App Review'],
    evidence: 'instagram_manage_comments is documented as "create, delete and hide comments on '
      + 'behalf of the Instagram account" and is the permission that also exposes reading them. '
      + 'Homatch uses it to READ only; nothing in this codebase posts, hides or deletes.',
  },
  {
    capability: 'INSTAGRAM_DISCOVERY',
    availability: 'RESTRICTED',
    permissions: [],
    dependsOn: ['INSTAGRAM_ACCOUNT_LINKAGE'],
    externalSteps: [],
    evidence: 'There is no general Instagram search. Business Discovery reads a limited, public '
      + 'subset of OTHER Professional accounts by username and returns no comment threads, so it '
      + 'cannot serve intent discovery. Recorded RESTRICTED rather than UNAVAILABLE because a '
      + 'narrow form exists; it is not the capability the product would need.',
  },
  {
    capability: 'WEBHOOKS_PAGE',
    availability: 'REQUIRES_APP_REVIEW',
    permissions: ['pages_read_user_content', 'pages_show_list'],
    dependsOn: ['FACEBOOK_PAGE_COMMENTS'],
    externalSteps: ['Configure the Page webhook in the Meta app', 'Verify the callback URL'],
    evidence: 'Page webhooks deliver feed and comment events for a Page the app is installed on. '
      + 'This is the surface worth having: a new enquiry arrives as an event rather than being '
      + 'found by a poll hours later.',
  },
  {
    capability: 'WEBHOOKS_INSTAGRAM',
    availability: 'REQUIRES_INSTAGRAM_PROFESSIONAL_ACCOUNT',
    permissions: ['instagram_manage_comments', 'instagram_basic'],
    dependsOn: ['INSTAGRAM_COMMENTS'],
    externalSteps: ['Subscribe the Instagram field in the Meta app webhook configuration'],
    evidence: 'Instagram comment webhooks exist for a linked Professional account.',
  },
];

const BY_CAPABILITY = new Map(META_CAPABILITY_MATRIX.map((s) => [s.capability, s]));

export function metaCapabilitySpec(capability: MetaCapability): MetaCapabilitySpec {
  const spec = BY_CAPABILITY.get(capability);
  if (!spec) throw new Error(`unknown Meta capability: ${capability}`);
  return spec;
}

/** Capabilities no permission can ever unlock, because the API is gone. */
export function permanentlyUnavailable(): MetaCapability[] {
  return META_CAPABILITY_MATRIX
    .filter((s) => s.availability === 'UNAVAILABLE')
    .map((s) => s.capability);
}

/* ────────────────────────────────────────────────────────────────────────
 * From granted scopes to what we may actually attempt
 * ──────────────────────────────────────────────────────────────────────── */

export type CapabilityState =
  /** Granted and usable now. */
  | 'ENABLED'
  /** The API supports it; this connection has not been granted it. */
  | 'PERMISSION_MISSING'
  /** Granted, but an external Meta step is still outstanding. */
  | 'EXTERNAL_STEP_REQUIRED'
  /** A prerequisite capability is not enabled. */
  | 'DEPENDENCY_MISSING'
  /** No API. Nothing will change this. */
  | 'UNAVAILABLE';

export interface ResolvedCapability {
  capability: MetaCapability;
  state: CapabilityState;
  /** Permissions this needs that the connection does NOT have. */
  missingPermissions: string[];
  /** What somebody must do outside Homatch, when that is the blocker. */
  externalSteps: readonly string[];
  reason: string;
}

/**
 * Decide what a connection can do, from what Meta ACTUALLY granted.
 *
 * `grantedScopes` must be the scopes read back from Meta after the callback,
 * never the scopes we asked for. A user can untick individual permissions on
 * Meta's own consent screen, and a partial grant that we treat as a full one is
 * a capability claim with nothing behind it — the adapter then issues a call
 * that 403s, and a 403 with no explanation looks like an empty group.
 */
export function resolveMetaCapabilities(
  grantedScopes: readonly string[],
): ResolvedCapability[] {
  const granted = new Set(grantedScopes.map((s) => s.trim()).filter(Boolean));
  const state = new Map<MetaCapability, CapabilityState>();
  const out: ResolvedCapability[] = [];

  for (const spec of META_CAPABILITY_MATRIX) {
    if (spec.availability === 'UNAVAILABLE') {
      state.set(spec.capability, 'UNAVAILABLE');
      out.push({
        capability: spec.capability,
        state: 'UNAVAILABLE',
        missingPermissions: [],
        externalSteps: [],
        reason: spec.evidence,
      });
      continue;
    }

    /*
     * RESTRICTED NEVER ENABLES FROM SCOPES.
     *
     * Meta gates these behind something other than a permission string —
     * partner status, a use-case approval, or a narrower API than the product
     * needs. INSTAGRAM_DISCOVERY is the live example, and it caught a real bug
     * here: it names no permissions, so "nothing missing" plus "dependency met"
     * resolved it to ENABLED, and the matrix cheerfully reported that Homatch
     * could search Instagram. It cannot. A capability that asks for no
     * permission is not thereby granted — it is usually the opposite.
     */
    if (spec.availability === 'RESTRICTED') {
      state.set(spec.capability, 'EXTERNAL_STEP_REQUIRED');
      out.push({
        capability: spec.capability,
        state: 'EXTERNAL_STEP_REQUIRED',
        missingPermissions: [],
        externalSteps: spec.externalSteps,
        reason: `Meta restricts this outside the permission system. ${spec.evidence}`,
      });
      continue;
    }

    const unmetDependency = spec.dependsOn.find((d) => state.get(d) !== 'ENABLED');
    const missing = spec.permissions.filter((p) => !granted.has(p));

    if (missing.length > 0) {
      state.set(spec.capability, 'PERMISSION_MISSING');
      out.push({
        capability: spec.capability,
        state: 'PERMISSION_MISSING',
        missingPermissions: missing,
        externalSteps: spec.externalSteps,
        reason: `Meta did not grant ${missing.join(', ')} to this connection.`,
      });
      continue;
    }

    if (unmetDependency) {
      state.set(spec.capability, 'DEPENDENCY_MISSING');
      out.push({
        capability: spec.capability,
        state: 'DEPENDENCY_MISSING',
        missingPermissions: [],
        externalSteps: spec.externalSteps,
        reason: `${unmetDependency} is not enabled, and this capability reads through it.`,
      });
      continue;
    }

    state.set(spec.capability, 'ENABLED');
    out.push({
      capability: spec.capability,
      state: 'ENABLED',
      missingPermissions: [],
      externalSteps: [],
      reason: 'every permission this needs was granted by Meta for this connection.',
    });
  }

  return out;
}

/** Can this connection legitimately attempt this operation right now? */
export function capabilityEnabled(
  resolved: readonly ResolvedCapability[],
  capability: MetaCapability,
): boolean {
  return resolved.some((r) => r.capability === capability && r.state === 'ENABLED');
}

/**
 * The scopes worth ASKING for.
 *
 * Only for capabilities that can exist. Requesting a permission Meta has removed
 * gets the whole authorization rejected, which is a self-inflicted outage and a
 * confusing one: the operator sees "authorization failed" and the cause is a
 * string we should never have sent.
 */
export function requestableScopes(): string[] {
  const scopes = new Set<string>();
  for (const spec of META_CAPABILITY_MATRIX) {
    if (spec.availability === 'UNAVAILABLE') continue;
    for (const permission of spec.permissions) scopes.add(permission);
  }
  return [...scopes].sort();
}
