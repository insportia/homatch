// HOMATCH — where a task in the drawer actually takes you.
//
// The Running-tasks drawer told a customer what was happening and then left
// them to find the result themselves. Its one navigation affordance was
//
//     if (!job.resultRef) return;
//     navigate(job.resultRef);
//
// — a blind jump to whatever string the row happened to carry, shown only
// once the job had finished. Three things followed from that, all of them
// visible in production:
//
//   1. A RUNNING task had no way back to its own workspace. The customer who
//      started a verification, navigated away, and wanted to watch it again
//      had to remember where it lived.
//   2. A wrong string was a dead end. FIND_CLIENTS jobs are written with
//      `/properties/<id>/matches` while the registered route is
//      `/property/<id>/matches`, so every finished client search navigated
//      to the 404 page. Nothing validated the path, so nothing caught it.
//   3. Every new product had to remember to write a correct result_ref in
//      two places — the client that starts the job, and the worker that
//      mirrors it — or it silently had no destination at all.
//
// This module is the single answer to "where does this task go?", and it is
// deliberately a pure function of the job row: same job, same destination,
// no component state, no navigation side effects, trivially testable.
//
// WHY A ROUTE ALLOWLIST RATHER THAN TRUSTING result_ref
//
// `result_ref` is customer-controlled data in the sense that matters: it is
// written by several producers, persisted for days, and replayed into
// `navigate()` long afterwards. A path that no longer resolves is not a
// hypothetical — it is defect (2) above. So a stored path is USED only when
// it matches a route this application actually registers; otherwise the
// resolver falls back to something it can reason about. The patterns below
// are checked against src/routes.tsx by destination.test.mjs, so a renamed
// route breaks the test rather than the product.
//
// It never guesses. An unrecognised product with no usable subject gets the
// generic task list or no button at all — never a plausible-looking guess at
// somebody else's page.

import type { JobState } from './jobState.ts';
import { hasReadableResult, isTerminal } from './jobState.ts';

/** Where the button goes, and what it should say. */
export interface JobDestination {
  /** An in-app path, always beginning with a single '/'. */
  to: string;
  /** i18n key for the button label. */
  labelKey: string;
  /**
   * What we are actually offering:
   *   RESULT    the finished answer for this exact job
   *   WORKSPACE the live workspace where this job is running
   *   SERVICE   the owning product's landing page
   *   GENERIC   the task/activity list — a safe last resort
   */
  kind: 'RESULT' | 'WORKSPACE' | 'SERVICE' | 'GENERIC';
}

/** The subset of a background job this resolver needs. */
export interface ResolvableJob {
  productType: string;
  subjectType?: string | null;
  subjectId?: string | null;
  state: JobState;
  resultRef?: string | null;
}

/**
 * Routes this resolver is allowed to send a customer to.
 *
 * `:param` matches exactly one non-empty path segment. Query strings and
 * fragments on a stored ref are preserved but not matched against.
 */
const ROUTE_PATTERNS: readonly string[] = [
  '/verify',
  '/verify/:id',
  // Contracts is a product of its own, so a contract analysis resolves to the
  // contract's own page and a document id is a complete address.
  '/contracts',
  '/contracts/:id',
  '/investment',
  '/mortgage',
  '/property/:id',
  '/property/:id/matches',
  '/dashboard',
  '/activity',
  '/outreach',
  '/outreach/email',
  '/outreach/calls',
  '/active-search',
  // NOTE: '/cases' is deliberately absent — the Cases page was removed by the
  // 2026-09-06 mandate (see routes.tsx:55) and must never be navigated to.
];

/**
 * Paths that were written wrongly and are still sitting in the database.
 *
 * Fixing the producers stops NEW rows being wrong; it does nothing for the
 * jobs already stored, which a customer can still see for 48 hours. Both
 * halves are needed, and this is the half that repairs history.
 */
const LEGACY_REWRITES: readonly (readonly [RegExp, string])[] = [
  // `/properties/<id>/matches` — the registered route is singular.
  [/^\/properties\/([^/?#]+)\/matches\b/, '/property/$1/matches'],
  /*
   * `/verify/<case>?tab=documents&doc=<id>` — the Deal Room Documents tab.
   *
   * Every contract analysis ever queued wrote this shape, so the refs are
   * already in the database: 2 of the 7 jobs in production carry it, and both
   * are contract analyses. Fixing the producer alone would leave every
   * existing contract task opening a workspace the customer no longer sees.
   * The document id is the whole address now — a contract has its own page.
   */
  [/^\/verify\/[^/?#]+\?(?=[^#]*\btab=documents\b)[^#]*\bdoc=([^&#]+).*$/, '/contracts/$1'],
];

/** The product's own home, used when no exact destination can be built. */
const SERVICE_HOME: Record<string, string> = {
  VERIFY: '/verify',
  // Contracts is its own product; a contract job that cannot name its exact
  // result belongs at that product's front door, not at Verify's.
  DOCUMENT_ANALYSIS: '/contracts',
  CONTRACT_ANALYSIS: '/contracts',
  MARKET_RESEARCH: '/verify',
  LOCATION_RESEARCH: '/verify',
  FIND_CLIENTS: '/dashboard',
  AI_ENRICHMENT: '/outreach',
  EMAIL_CAMPAIGN: '/outreach/email',
  AI_CALL: '/outreach/calls',
};

/** The generic, always-safe destination: the customer's own activity list. */
const GENERIC_HOME = '/activity';

const splitPath = (ref: string): { path: string; rest: string } => {
  const cut = ref.search(/[?#]/);
  return cut === -1 ? { path: ref, rest: '' } : { path: ref.slice(0, cut), rest: ref.slice(cut) };
};

/** Does this path match one of the routes the application registers? */
export function isKnownRoute(path: string): boolean {
  const segs = path.split('/').filter(Boolean);
  return ROUTE_PATTERNS.some((pattern) => {
    const pat = pattern.split('/').filter(Boolean);
    if (pat.length !== segs.length) return false;
    return pat.every((p, i) => (p.startsWith(':') ? segs[i].length > 0 : p === segs[i]));
  });
}

/**
 * Turns a stored `result_ref` into a path this application can actually
 * serve, or null when it cannot be trusted.
 *
 * Rejects anything that is not a same-origin in-app path. `//evil.example`
 * parses as a protocol-relative URL in a browser, so a stored ref beginning
 * with two slashes must never reach `navigate()`.
 */
export function normalizeResultRef(ref: string | null | undefined): string | null {
  const raw = typeof ref === 'string' ? ref.trim() : '';
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;

  let candidate = raw;
  for (const [pattern, replacement] of LEGACY_REWRITES) {
    if (pattern.test(candidate)) {
      candidate = candidate.replace(pattern, replacement);
      break;
    }
  }

  const { path, rest } = splitPath(candidate);
  return isKnownRoute(path) ? `${path}${rest}` : null;
}

/**
 * Builds a destination from the job's own subject when the stored ref is
 * unusable. Only shapes this codebase actually writes are reconstructed —
 * an unknown subject produces nothing rather than a guess.
 */
function fromSubject(job: ResolvableJob): string | null {
  const id = typeof job.subjectId === 'string' ? job.subjectId.trim() : '';
  if (!id) return null;

  switch (job.subjectType) {
    case 'RESEARCH_JOB':
      // Verify reads its running job from the query string, not the path.
      return job.productType === 'VERIFY' ? `/verify?job=${encodeURIComponent(id)}` : null;
    case 'DEAL_ROOM':
      // The storage container, which stopped being a destination. Nothing
      // writes this subject type — 0 rows in production — but a historical
      // one must still not open the retired workspace.
      return '/verify';
    case 'PROPERTY':
      return `/property/${encodeURIComponent(id)}/matches`;
    case 'DOCUMENT':
      // This was once impossible: the reader opened inside a verification
      // case, so a document id alone could not address a page and the case id
      // lived only on the stored ref. A contract has its own page now, which
      // makes the subject id a complete address and a lost ref recoverable.
      return `/contracts/${encodeURIComponent(id)}`;
    default:
      return null;
  }
}

/**
 * The one label rule.
 *
 * A finished job offers its result; a running one offers the place it is
 * running. A FAILED job only gets a button when the destination can actually
 * do something about it — a landing page cannot retry anything, and a button
 * that just moves the customer somewhere else is worse than no button.
 */
function labelFor(state: JobState, kind: JobDestination['kind']): string | null {
  if (state === 'CANCELLED') return null;
  if (state === 'FAILED') return kind === 'RESULT' || kind === 'WORKSPACE' ? 'job_review_retry' : null;
  if (hasReadableResult(state)) return kind === 'RESULT' ? 'job_open_result' : 'job_open_workspace';
  return kind === 'GENERIC' ? null : 'job_open_workspace';
}

/**
 * The single destination resolver for every product in the drawer.
 *
 * Priority, in order:
 *   1. the exact result/detail path, when the job stored one we can serve
 *   2. the live workspace rebuilt from the job's own subject
 *   3. the owning product's landing page
 *   4. the generic activity list
 *
 * Returns null when there is nothing honest to offer, and the caller renders
 * no button at all.
 */
export function resolveJobDestination(job: ResolvableJob): JobDestination | null {
  const stored = normalizeResultRef(job.resultRef);

  // A stored ref is the deepest thing we have. Whether it counts as "the
  // result" or "the workspace" is the job's state, not the path's shape:
  // Verify writes the same ref the moment it starts and never changes it.
  if (stored) {
    const kind = hasReadableResult(job.state) ? 'RESULT' : 'WORKSPACE';
    const labelKey = labelFor(job.state, kind);
    return labelKey ? { to: stored, labelKey, kind } : null;
  }

  const rebuilt = fromSubject(job);
  if (rebuilt) {
    const labelKey = labelFor(job.state, 'WORKSPACE');
    return labelKey ? { to: rebuilt, labelKey, kind: 'WORKSPACE' } : null;
  }

  const home = SERVICE_HOME[job.productType];
  if (home) {
    const labelKey = labelFor(job.state, 'SERVICE');
    return labelKey ? { to: home, labelKey, kind: 'SERVICE' } : null;
  }

  // Unknown or legacy product. The activity list is the only page that is
  // true for every task, and a running unknown task gets no button rather
  // than one that promises a workspace nobody can name.
  if (isTerminal(job.state) && job.state !== 'CANCELLED') {
    return { to: GENERIC_HOME, labelKey: 'job_open_activity', kind: 'GENERIC' };
  }
  return null;
}
