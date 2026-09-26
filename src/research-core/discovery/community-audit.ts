// AUDITING A COMMUNITY, WHICH IS NOT AUDITING A WEBSITE.
//
// source-audit's `audit` mode reads robots.txt, sitemaps and one page, and every
// Telegram channel in the registry is correctly INELIGIBLE for it:
//
//   classifyRegistryRow('https://t.me/tbilisikvartiri')
//     -> COMMUNITY_IDENTIFIER, auditable: false
//
// That is the right answer and it is not a gap to route around. A channel has no
// sitemap, its "listing paths" are not paths, and feeding it to the website
// auditor would produce a confident finding about a shape it does not have. The
// standing instruction was explicit: community identifiers are not fed blindly
// into the website auditor.
//
// So this is the community equivalent, and the important design decision is that
// it produces the SAME evidence type the website auditor produces —
// LifecycleEvidence — and hands it to the SAME advance() ladder. There is one
// lifecycle in this system and one set of rules about what permits access. What
// differs is only how the evidence was obtained.
//
// WHAT COUNTS AS PERMISSION HERE
//
// Exactly what counts anywhere else, and nothing has been loosened to let
// Telegram through:
//
//   the surface answers without authentication
//   robots does not forbid it
//   no membership, no anti-bot defeat, no session, no impersonation
//   a stable platform-native identity exists for what was read
//
// t.me serves no robots.txt at all (404, measured 2026-09-26), which RFC 9309
// defines as unrestricted and which this core's robots checker already implements
// that way. So the permission is real rather than assumed — and it is passed in as
// evidence rather than hardcoded here, because a robots.txt that appears tomorrow
// has to be able to change the answer.
//
// THE DISTINCTION THIS FILE EXISTS TO PROTECT
//
// An EMPTY channel and a BLOCKED channel must never collapse into each other.
//
//   @tbilisiapartments serves its page, publishes nothing but Telegram's own
//   service notices, and yields zero usable items. Access is PUBLIC. There is
//   simply nothing there.
//
//   a private channel answers "this channel is private". Access is
//   LOGIN_REQUIRED, and advance() sends it to BLOCKED, where it belongs.
//
// The first must not be reported as blocked (it would hide a healthy source behind
// a compliance-sounding label) and the second must not be reported as empty (it
// would invite somebody to "fix" the emptiness by joining). So access and YIELD
// are two separate outputs of this function, and the ladder receives them as two
// separate pieces of evidence.

import type { PreviewPage } from '../adapters/telegram/preview-parse.ts';
import type { AccessFinding, LifecycleEvidence, SourceFamily } from './source-lifecycle.ts';

/** Whether robots permits the surface, as actually measured. */
export interface RobotsEvidence {
  /**
   * The status robots.txt answered. 404 or any 4xx means unrestricted under
   * RFC 9309; a 5xx means we do not know and must not assume.
   */
  status: number | null;
  /** True only when a served robots.txt explicitly forbids the path we read. */
  disallowed: boolean;
}

export type CommunityAuditVerdict =
  /** A finding was established. Feed `evidence` to advance(). */
  | 'ESTABLISHED'
  /**
   * Nothing was established and the lifecycle must not move.
   *
   * A rate limit, unfamiliar markup or a channel that does not exist are all
   * reasons to have no opinion — not reasons to record one. The website auditor
   * has UNKNOWN for the same purpose.
   */
  | 'INCONCLUSIVE';

export interface CommunityAuditResult {
  verdict: CommunityAuditVerdict;
  /** Null when INCONCLUSIVE: no finding was reached. */
  finding: AccessFinding | null;
  family: SourceFamily;
  /**
   * Items with a usable platform-native identity that this read actually
   * produced. ZERO IS A REAL ANSWER and is not a failure: it is the difference
   * between a live source and a readable empty one, and it is what stops an empty
   * channel being promoted to LIVE_TESTED.
   */
  usableItems: number;
  /**
   * Whether a stable native identity was observed. Without one, nothing read here
   * can be stored without inventing an id — which is the defect that once let an
   * edited post become a second purchasable lead.
   */
  stableIdentity: boolean;
  /** Evidence for advance(), in the order it must be applied. Empty when INCONCLUSIVE. */
  evidence: LifecycleEvidence[];
  reason: string;
}

/**
 * True when robots does not forbid the surface.
 *
 * A 4xx (including the 404 t.me actually serves) is unrestricted per RFC 9309. A
 * 5xx is NOT permission: the server failed and we know nothing, so the honest
 * answer is no rather than an optimistic yes.
 */
export function robotsPermits(robots: RobotsEvidence): boolean {
  if (robots.disallowed) return false;
  if (robots.status === null) return false;
  if (robots.status >= 500) return false;
  return true;
}

/**
 * Turn one real community read into lifecycle evidence.
 *
 * `adapterId` is required because a finding that permits access only becomes
 * IMPLEMENTED when an adapter claims the source — and the adapter that claims it
 * has to be the one that actually did the reading.
 */
export function auditCommunityAccess(input: {
  page: PreviewPage;
  robots: RobotsEvidence;
  adapterId: string;
}): CommunityAuditResult {
  const family: SourceFamily = 'PUBLIC_COMMUNITY';
  const { page, robots, adapterId } = input;

  const inconclusive = (reason: string): CommunityAuditResult => ({
    verdict: 'INCONCLUSIVE',
    finding: null,
    family,
    usableItems: 0,
    stableIdentity: false,
    evidence: [],
    reason,
  });

  /*
   * ROBOTS FIRST, before anything about the content matters. A page we read in
   * defiance of robots is not evidence we may read it, and recording a finding
   * from it would launder the violation into a permission.
   */
  if (!robotsPermits(robots)) {
    if (robots.disallowed) {
      return {
        verdict: 'ESTABLISHED',
        finding: 'ROBOTS_DISALLOWED',
        family,
        usableItems: 0,
        stableIdentity: false,
        evidence: [{ kind: 'AUDIT', family, finding: 'ROBOTS_DISALLOWED' }],
        reason: 'robots.txt forbids this surface. advance() will block it, and that is the '
          + 'end of it rather than a problem to route around',
      };
    }
    return inconclusive(
      robots.status === null
        ? 'robots.txt was never fetched, so nothing about permission has been established'
        : `robots.txt answered ${robots.status}; a server error is not permission`,
    );
  }

  switch (page.outcome) {
    case 'OK': {
      /*
       * Identity is checked rather than assumed. Every message must carry the
       * platform's own id, because an id we invented would make an edited post a
       * new lead -- the defect that cost real money once, in a different table.
       */
      const withIdentity = page.messages.filter(
        (message) => /^\d+$/.test(String(message.messageId)) && Boolean(message.channel),
      );
      const stableIdentity = withIdentity.length === page.messages.length
        && page.messages.length > 0;

      if (!stableIdentity) {
        return inconclusive(
          `${page.messages.length} message(s) read and ${withIdentity.length} carried a usable `
          + 'platform-native id; storing the rest would mean inventing identities',
        );
      }

      return {
        verdict: 'ESTABLISHED',
        finding: 'PUBLIC_HTML',
        family,
        usableItems: withIdentity.length,
        stableIdentity: true,
        evidence: [
          { kind: 'AUDIT', family, finding: 'PUBLIC_HTML' },
          { kind: 'ADAPTER_CLAIMED', adapterId },
          /*
           * The yield, as a SEPARATE piece of evidence. advance() promotes to
           * LIVE_TESTED only when itemsParsed > 0, so a readable-but-empty source
           * cannot reach it -- which is the whole reason access and yield are not
           * one number.
           */
          { kind: 'LIVE_FETCH', ok: true, itemsParsed: withIdentity.length },
        ],
        reason: `read without authentication; ${withIdentity.length} item(s) carried a stable `
          + 'platform-native id',
      };
    }

    case 'PREVIEW_UNAVAILABLE': {
      /*
       * READABLE AND EMPTY. The page was served, no credential was involved, and
       * the channel has published nothing usable -- @tbilisiapartments serves four
       * Telegram service notices and nothing else.
       *
       * The finding is PUBLIC_HTML because that is true: access is public. The
       * YIELD is zero, so the LIVE_FETCH evidence is deliberately NOT emitted and
       * the source stops at IMPLEMENTED. Reporting this as blocked would hide a
       * healthy public source behind a compliance-sounding label.
       */
      return {
        verdict: 'ESTABLISHED',
        finding: 'PUBLIC_HTML',
        family,
        usableItems: 0,
        stableIdentity: false,
        evidence: [
          { kind: 'AUDIT', family, finding: 'PUBLIC_HTML' },
          { kind: 'ADAPTER_CLAIMED', adapterId },
        ],
        reason: 'the surface is public and carries nothing usable. Access is established; there '
          + 'is no yield, so it is not live-tested and it is not blocked either',
      };
    }

    case 'CHANNEL_PRIVATE':
      /*
       * A MEMBERSHIP WALL, named as one. Not ANTI_BOT, which would say the
       * platform is defending against automation, and not UNREACHABLE, which would
       * say nothing answered. Both would be false, and both would invite the wrong
       * remedy -- the accurate label is the one that makes joining look like what
       * it is: out of scope.
       */
      return {
        verdict: 'ESTABLISHED',
        finding: 'LOGIN_REQUIRED',
        family,
        usableItems: 0,
        stableIdentity: false,
        evidence: [{ kind: 'AUDIT', family, finding: 'LOGIN_REQUIRED' }],
        reason: 'the channel requires membership. advance() blocks it, and joining is not '
          + 'something this reader does',
      };

    case 'CHANNEL_NOT_FOUND':
      /*
       * DELIBERATELY INCONCLUSIVE, and this is the one mapping worth arguing over.
       *
       * UNREACHABLE would be the obvious finding, and advance() would move the
       * source to BLOCKED with the reason "reading this source would mean defeating
       * a control". That sentence is false about a 404. Nothing is defending
       * anything; the channel does not exist.
       *
       * Rather than change the ladder -- which is proven and shared -- this reports
       * no finding and leaves the lifecycle where it is, for a person to retire.
       * A registry that says BLOCKED about a channel that was merely renamed is
       * worse than one that says "still DISCOVERED, and here is why".
       */
      return inconclusive(
        'Telegram has no such channel. That is not a control refusing us, so no access '
        + 'finding is recorded and the lifecycle does not move; retiring it is a decision',
      );

    case 'RATE_LIMITED':
      return inconclusive(
        'Telegram asked us to slow down. A rate limit is a scheduling fact, not a finding '
        + 'about whether we may read this source',
      );

    case 'MARKUP_UNRECOGNISED':
      return inconclusive(
        'the page was served and this reader did not understand it. That is our defect, and '
        + 'recording it against the source would blame somebody else for our parser',
      );

    default:
      return inconclusive(`unhandled preview outcome: ${String(page.outcome)}`);
  }
}
