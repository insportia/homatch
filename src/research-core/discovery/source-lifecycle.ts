// HOMATCH RESEARCH CORE — how far a source has got, and what earned it.
//
// WHY THIS IS A SECOND AXIS AND NOT A RENAME OF access_state
//
// source-registry.ts already has SourceAccessState, and it answers a
// different question: HOW can we read this — publicly, with a session, only
// as a member, not at all. That is a property of the source right now.
//
// This answers WHERE IN THE JOURNEY it is: we found a URL, we looked at it,
// we established that reading it is permitted, an adapter claims it, it has
// been read for real, and it has produced enough to be worth the slot.
//
// A source can be PUBLIC and still DISCOVERED — anyone could read it, nobody
// has. It can be AUTHENTICATED_ACCESS and PRODUCTIVE. Collapsing the two into
// one column loses exactly the distinction that says which of four hundred
// candidate domains is worth an engineer's afternoon.
//
// EVERY TRANSITION IS EARNED
//
// This is the part that stops the registry becoming a wish list. A state is
// not set; it is advanced by EVIDENCE of a specific kind, and `advance()`
// refuses anything else:
//
//   you cannot be PERMITTED without an audit that actually found permission
//   you cannot be LIVE_TESTED by a fixture, ever
//   you cannot be PRODUCTIVE on one lucky scan
//   you cannot leave BLOCKED by fetching it anyway
//
// That last one is the load-bearing rule. A source is BLOCKED when it cannot
// be read without defeating something — a login wall, an anti-bot check, a
// robots directive, a platform term. If a fetch later succeeds against a
// BLOCKED source, that is not good news and it is not a promotion: something
// bypassed a control, and advance() says so instead of quietly recording a
// win.
//
// WHAT THE STATES DO NOT CLAIM
//
// PRODUCTIVE is a statement about measured yield in a market and a language.
// It is not a claim that Homatch covers that market, and nothing here totals
// up to a coverage percentage — there is no denominator for one.

import type { ResearchLanguage } from './lexicon.ts';

/* ────────────────────────────────────────────────────────────────────────
 * Families
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * What KIND of source this is, which decides which adapter family reads it.
 *
 * The point of a family is that one implementation plus per-source
 * configuration handles most members, so a new Georgian classifieds site is a
 * config row rather than a new scraper. A source only earns a dedicated
 * implementation when the family genuinely cannot express it — and the
 * lifecycle is what decides whether it has earned one, from measured yield
 * rather than from enthusiasm.
 */
export type SourceFamily =
  /** A site whose purpose is listing property. Structured, paginated. */
  | 'PROPERTY_PORTAL'
  /** Classified ads across categories, property among them. */
  | 'CLASSIFIEDS'
  /** An agency's own site: their inventory, their contact details. */
  | 'AGENCY_SITE'
  /** A developer's own site: projects, phases, availability. */
  | 'DEVELOPER_SITE'
  /** Investment-focused: yields, funds, cross-border buying. */
  | 'INVESTMENT_SITE'
  /** Threaded discussion. Where intent is stated rather than advertised. */
  | 'FORUM'
  /** A public community: a group, a channel, a subreddit. */
  | 'PUBLIC_COMMUNITY'
  /** Expat and relocation communities, which skew hard to demand. */
  | 'EXPAT_COMMUNITY'
  /** A regional or city-specific property site. */
  | 'REGIONAL_SITE'
  /** Telegram, which has its own access model and its own adapter. */
  | 'TELEGRAM'
  /** Anything genuinely one of a kind. Deliberately last and rarely right. */
  | 'OTHER';

export const SOURCE_FAMILIES: readonly SourceFamily[] = [
  'PROPERTY_PORTAL', 'CLASSIFIEDS', 'AGENCY_SITE', 'DEVELOPER_SITE',
  'INVESTMENT_SITE', 'FORUM', 'PUBLIC_COMMUNITY', 'EXPAT_COMMUNITY',
  'REGIONAL_SITE', 'TELEGRAM', 'OTHER',
];

export function isSourceFamily(value: unknown): value is SourceFamily {
  return typeof value === 'string' && (SOURCE_FAMILIES as readonly string[]).includes(value);
}

/* ────────────────────────────────────────────────────────────────────────
 * The lifecycle
 * ──────────────────────────────────────────────────────────────────────── */

export type SourceLifecycle =
  /** A URL exists and looks relevant. Nothing has been checked. */
  | 'DISCOVERED'
  /** Looked at: what it is, what it serves, what its rules say. */
  | 'AUDITED'
  /** A legitimate access method has been established. */
  | 'PERMITTED'
  /** An adapter claims it and can parse it. */
  | 'IMPLEMENTED'
  /** Proven against fixtures. A statement about our code, not the world. */
  | 'FIXTURE_TESTED'
  /** Read for real, and real content came back. */
  | 'LIVE_TESTED'
  /** Has produced useful results, repeatedly, in a measured way. */
  | 'PRODUCTIVE'
  /** Was working and is now failing. Backed off, not abandoned. */
  | 'DEGRADED'
  /** Cannot be read without defeating a control. Never routed around. */
  | 'BLOCKED'
  /** Deliberately stopped. Kept for history. */
  | 'RETIRED';

export const SOURCE_LIFECYCLE_STATES: readonly SourceLifecycle[] = [
  'DISCOVERED', 'AUDITED', 'PERMITTED', 'IMPLEMENTED', 'FIXTURE_TESTED',
  'LIVE_TESTED', 'PRODUCTIVE', 'DEGRADED', 'BLOCKED', 'RETIRED',
];

export function isSourceLifecycle(value: unknown): value is SourceLifecycle {
  return typeof value === 'string' && (SOURCE_LIFECYCLE_STATES as readonly string[]).includes(value);
}

/** The forward ladder, in order. DEGRADED, BLOCKED and RETIRED sit outside it. */
const LADDER: readonly SourceLifecycle[] = [
  'DISCOVERED', 'AUDITED', 'PERMITTED', 'IMPLEMENTED', 'FIXTURE_TESTED',
  'LIVE_TESTED', 'PRODUCTIVE',
];

export function ladderIndex(state: SourceLifecycle): number {
  return LADDER.indexOf(state);
}

/* ────────────────────────────────────────────────────────────────────────
 * Evidence
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Why access is or is not permitted.
 *
 * `ROBOTS_DISALLOWED`, `LOGIN_REQUIRED`, `ANTI_BOT` and `TERMS_PROHIBIT` are
 * all BLOCKED and none of them is a problem to be solved with a better
 * scraper. `API_AVAILABLE` and `PUBLIC_HTML` are the two legitimate routes.
 */
export type AccessFinding =
  | 'PUBLIC_HTML'
  | 'API_AVAILABLE'
  | 'FEED_AVAILABLE'
  | 'ROBOTS_DISALLOWED'
  | 'LOGIN_REQUIRED'
  | 'ANTI_BOT'
  | 'TERMS_PROHIBIT'
  | 'GEO_BLOCKED'
  | 'UNREACHABLE';

export function findingPermitsAccess(finding: AccessFinding): boolean {
  return finding === 'PUBLIC_HTML' || finding === 'API_AVAILABLE' || finding === 'FEED_AVAILABLE';
}

export type LifecycleEvidence =
  /** Somebody or something looked at the source and recorded what it is. */
  | { kind: 'AUDIT'; family: SourceFamily; finding: AccessFinding; note?: string }
  /** An adapter now claims this source. */
  | { kind: 'ADAPTER_CLAIMED'; adapterId: string }
  /** The adapter parsed stored fixtures correctly. */
  | { kind: 'FIXTURE_PASS'; adapterId: string }
  /**
   * A real request was made and real content came back. `itemsParsed` is what
   * separates "the page answered" from "we understood it": a 200 carrying a
   * cookie wall is a successful fetch and no evidence at all.
   */
  | { kind: 'LIVE_FETCH'; ok: true; itemsParsed: number }
  /** A real request failed. */
  | { kind: 'LIVE_FETCH'; ok: false; reason: string }
  /** A completed scan, with what it yielded. */
  | { kind: 'SCAN'; scanned: number; useful: number; language: ResearchLanguage | null }
  /** A person or a policy decided to stop using this source. */
  | { kind: 'RETIRE'; reason: string }
  /** A person reversed a block, e.g. a licence was granted. */
  | { kind: 'UNBLOCK'; reason: string };

export interface LifecycleState {
  state: SourceLifecycle;
  family: SourceFamily | null;
  /** The access finding that justified the current state, when there is one. */
  finding: AccessFinding | null;
  adapterId: string | null;
  /** Consecutive failures since the last success. */
  failureCount: number;
  /** Lifetime totals, which is what PRODUCTIVE is measured from. */
  scanned: number;
  useful: number;
}

export function initialState(): LifecycleState {
  return {
    state: 'DISCOVERED', family: null, finding: null, adapterId: null,
    failureCount: 0, scanned: 0, useful: 0,
  };
}

export interface Transition {
  from: SourceLifecycle;
  to: SourceLifecycle;
  /** Operator-facing. Always populated, including when nothing moved. */
  reason: string;
  /**
   * True when the evidence was REFUSED rather than merely insufficient.
   *
   * The difference matters: a scan that did not yet meet the productivity bar
   * is normal progress, while a successful fetch of a BLOCKED source is a
   * control having been bypassed and needs somebody to look at it.
   */
  rejected: boolean;
}

/**
 * How much yield makes a source worth its slot.
 *
 * Both parts are needed. A ratio alone promotes a source with one useful
 * result out of one scan; a count alone promotes a firehose with a terrible
 * ratio that happens to be large. Twenty observations is roughly where a
 * yield rate starts meaning anything, which is the same number
 * source-registry.ts shrinks its productivity prior over.
 */
export const PRODUCTIVE_MIN_SCANNED = 20;
export const PRODUCTIVE_MIN_USEFUL = 3;
export const PRODUCTIVE_MIN_RATE = 0.05;

/** Consecutive failures before a working source is called DEGRADED. */
export const DEGRADE_AFTER_FAILURES = 3;

/**
 * Apply evidence and return the new state.
 *
 * Pure, and it never skips a rung: evidence for a state further up the ladder
 * than the next one is recorded but does not promote. That is what makes the
 * ladder mean something — a source at LIVE_TESTED has necessarily been
 * audited, permitted and implemented, so the admin area can trust the label
 * instead of re-deriving it.
 */
export function advance(
  current: LifecycleState,
  evidence: LifecycleEvidence,
): { state: LifecycleState; transition: Transition } {
  const from = current.state;
  const stay = (reason: string, rejected = false, patch: Partial<LifecycleState> = {}) => ({
    state: { ...current, ...patch },
    transition: { from, to: from, reason, rejected },
  });
  const move = (to: SourceLifecycle, reason: string, patch: Partial<LifecycleState> = {}) => ({
    state: { ...current, ...patch, state: to },
    transition: { from, to, reason, rejected: false },
  });

  /*
   * RETIRED IS A DECISION, AND ONLY A DECISION REVERSES IT.
   *
   * Checked first so no amount of successful scanning quietly revives a
   * source somebody deliberately stopped using.
   */
  if (from === 'RETIRED' && evidence.kind !== 'UNBLOCK') {
    /*
     * Rejected, including for a scan — especially for a scan. A retired
     * source should never have been scheduled, so evidence that one was read
     * means something is still selecting it, which is a defect rather than a
     * harmless no-op. A RETIRE arriving for an already-retired source is the
     * one exception: repeating a decision is not a defect.
     */
    return stay(
      'the source is retired; only an explicit decision reopens it',
      evidence.kind !== 'RETIRE',
    );
  }

  switch (evidence.kind) {
    case 'AUDIT': {
      if (!findingPermitsAccess(evidence.finding)) {
        /*
         * THE RULE THAT MATTERS. A login wall, an anti-bot check, a robots
         * directive or a prohibition in the terms is a reason to stop, not a
         * problem to route around. The source is recorded, named, and left
         * alone — which is also what makes it reviewable, because a human can
         * see the list and decide whether to ask for access properly.
         */
        return {
          state: { ...current, state: 'BLOCKED', family: evidence.family, finding: evidence.finding },
          transition: {
            from, to: 'BLOCKED', rejected: false,
            reason: `${evidence.finding}: reading this source would mean defeating a control`,
          },
        };
      }
      if (from === 'BLOCKED') {
        // A re-audit that now finds public access is how a block is lifted
        // legitimately: the site changed, not our willingness to bypass it.
        return move('AUDITED', `re-audited and now ${evidence.finding}`, {
          family: evidence.family, finding: evidence.finding, failureCount: 0,
        });
      }
      if (ladderIndex(from) > ladderIndex('AUDITED')) {
        return stay('already past audit; the finding was recorded', false, {
          family: evidence.family, finding: evidence.finding,
        });
      }
      return move('AUDITED', `audited: ${evidence.finding}`, {
        family: evidence.family, finding: evidence.finding,
      });
    }

    case 'ADAPTER_CLAIMED': {
      if (from === 'BLOCKED') {
        return stay('a blocked source is not implemented against', true, { adapterId: evidence.adapterId });
      }
      if (from === 'DISCOVERED') {
        return stay('nothing has been audited yet; an adapter cannot claim it', true);
      }
      if (from === 'AUDITED') {
        /*
         * An audit that found a permitted route IS the permission. Recorded
         * as its own rung so the admin area can see the difference between
         * "we looked" and "we established we may read it".
         */
        return current.finding && findingPermitsAccess(current.finding)
          ? move('IMPLEMENTED', `permitted via ${current.finding}, claimed by ${evidence.adapterId}`, {
              adapterId: evidence.adapterId,
            })
          : stay('audited but no permitted access route was recorded', true);
      }
      if (ladderIndex(from) >= ladderIndex('IMPLEMENTED')) {
        return stay(`already implemented by ${current.adapterId ?? 'an adapter'}`, false, {
          adapterId: evidence.adapterId,
        });
      }
      return move('IMPLEMENTED', `claimed by ${evidence.adapterId}`, { adapterId: evidence.adapterId });
    }

    case 'FIXTURE_PASS': {
      if (from === 'BLOCKED' || from === 'DISCOVERED' || from === 'AUDITED') {
        return stay('fixtures cannot advance a source that has no adapter yet', true);
      }
      if (ladderIndex(from) > ladderIndex('FIXTURE_TESTED')) {
        return stay('already proven against live content, which is stronger');
      }
      return move('FIXTURE_TESTED', `fixtures pass for ${evidence.adapterId}`);
    }

    case 'LIVE_FETCH': {
      if (from === 'BLOCKED') {
        /*
         * A successful fetch of a blocked source is NOT a promotion. Something
         * defeated a control, and recording it as progress would turn a
         * compliance failure into a green row on a dashboard.
         */
        return stay(
          evidence.ok
            ? 'a blocked source answered: a control was bypassed and this needs a human'
            : 'a blocked source is still blocked',
          evidence.ok,
        );
      }
      if (!evidence.ok) {
        const failures = current.failureCount + 1;
        if (ladderIndex(from) >= ladderIndex('LIVE_TESTED') && failures >= DEGRADE_AFTER_FAILURES) {
          return move('DEGRADED', `${failures} consecutive failures: ${evidence.reason}`, {
            failureCount: failures,
          });
        }
        return stay(`fetch failed: ${evidence.reason}`, false, { failureCount: failures });
      }
      /*
       * A 200 is not evidence. A cookie wall, a consent interstitial and a
       * soft 404 all answer 200 and carry nothing, so the promotion needs
       * something PARSED -- content we understood.
       */
      if (evidence.itemsParsed <= 0) {
        return stay('the source answered but nothing could be parsed from it', false, { failureCount: 0 });
      }
      if (from === 'DEGRADED') {
        // Recovery returns to where it was working, not to the beginning.
        return move('LIVE_TESTED', 'recovered: live content parsed again', { failureCount: 0 });
      }
      if (ladderIndex(from) < ladderIndex('IMPLEMENTED')) {
        return stay('no adapter has claimed this source yet', true, { failureCount: 0 });
      }
      if (ladderIndex(from) >= ladderIndex('LIVE_TESTED')) {
        return stay('already live-tested', false, { failureCount: 0 });
      }
      return move('LIVE_TESTED', `live fetch parsed ${evidence.itemsParsed} item(s)`, { failureCount: 0 });
    }

    case 'SCAN': {
      const scanned = current.scanned + Math.max(0, evidence.scanned);
      const useful = current.useful + Math.max(0, evidence.useful);
      const patch = { scanned, useful, failureCount: 0 };

      if (from === 'BLOCKED') return stay('a blocked source is not scanned', true);
      if (ladderIndex(from) < ladderIndex('LIVE_TESTED')) {
        return stay('a scan cannot promote a source that has never been read live', true, patch);
      }
      if (from === 'PRODUCTIVE') return stay('already productive', false, patch);

      const rate = scanned > 0 ? useful / scanned : 0;
      if (scanned >= PRODUCTIVE_MIN_SCANNED && useful >= PRODUCTIVE_MIN_USEFUL && rate >= PRODUCTIVE_MIN_RATE) {
        return move('PRODUCTIVE', `${useful} useful of ${scanned} scanned (${(rate * 100).toFixed(0)}%)`, patch);
      }
      return stay(
        `not yet productive: ${useful} useful of ${scanned} scanned`
        + ` (needs ${PRODUCTIVE_MIN_USEFUL} of ${PRODUCTIVE_MIN_SCANNED} at ${PRODUCTIVE_MIN_RATE * 100}%)`,
        false,
        from === 'DEGRADED' ? { ...patch, state: 'LIVE_TESTED' } : patch,
      );
    }

    case 'RETIRE':
      return move('RETIRED', evidence.reason);

    case 'UNBLOCK': {
      if (from !== 'BLOCKED' && from !== 'RETIRED') {
        return stay('the source is not blocked or retired');
      }
      /*
       * Back to AUDITED, not to wherever it was. Whatever we knew about how
       * to read it is now old, and a source that changed enough to be
       * unblocked has changed enough to be looked at again.
       */
      return move('AUDITED', `reopened: ${evidence.reason}`, { failureCount: 0, finding: null });
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * What each state is allowed to do
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * May this source be scanned on a customer's campaign?
 *
 * LIVE_TESTED and PRODUCTIVE only. Everything below has not been proven to
 * return real content, and a campaign is not the place to find out — a
 * customer paying for a search should not be funding our first attempt at a
 * new site.
 *
 * DEGRADED is excluded deliberately: it is retried by the back-off schedule,
 * not by a customer's budget.
 */
export function mayScanForCampaign(state: SourceLifecycle): boolean {
  return state === 'LIVE_TESTED' || state === 'PRODUCTIVE';
}

/** May results from this source be shown to a customer? Same bar. */
export function mayDeliverResults(state: SourceLifecycle): boolean {
  return mayScanForCampaign(state);
}

/**
 * Is this source worth an engineer writing a dedicated adapter for it?
 *
 * Measured, not felt. A source that is already productive through a family
 * adapter does not need one; a source with a real record that the family
 * cannot parse properly does.
 */
export function shouldGraduateToDedicatedAdapter(
  state: LifecycleState,
  options: { minScanned?: number; minUseful?: number; familyParsesPoorly: boolean },
): boolean {
  if (!options.familyParsesPoorly) return false;
  if (!mayScanForCampaign(state.state)) return false;
  return state.scanned >= (options.minScanned ?? PRODUCTIVE_MIN_SCANNED * 2)
    && state.useful >= (options.minUseful ?? PRODUCTIVE_MIN_USEFUL * 2);
}

/**
 * A one-line, operator-facing account of where a source stands.
 *
 * Deliberately says "not yet" rather than a percentage. There is no
 * denominator for how far along a source "should" be.
 */
export function describeLifecycle(state: LifecycleState): string {
  switch (state.state) {
    case 'DISCOVERED': return 'Found, not yet looked at.';
    case 'AUDITED': return `Looked at: ${state.finding ?? 'no finding recorded'}.`;
    case 'PERMITTED': return `Access established via ${state.finding ?? 'an unrecorded route'}.`;
    case 'IMPLEMENTED': return `Claimed by ${state.adapterId ?? 'an adapter'}; not yet read.`;
    case 'FIXTURE_TESTED': return 'Proven against fixtures. Not proven against the site.';
    case 'LIVE_TESTED': return 'Read for real. Not yet enough results to judge.';
    case 'PRODUCTIVE': return `${state.useful} useful of ${state.scanned} scanned.`;
    case 'DEGRADED': return `Was working; ${state.failureCount} consecutive failures.`;
    case 'BLOCKED': return `Cannot be read legitimately: ${state.finding ?? 'unspecified'}.`;
    case 'RETIRED': return 'Deliberately stopped.';
  }
}
