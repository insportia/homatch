// HOMATCH — human-verification handoff: source feasibility.
//
// WHAT THIS FILE DECIDES
// ----------------------
// When a Verify source cannot be completed by the server, there are exactly
// three honest outcomes, and this table decides which one applies:
//
//   1. RETRY_IN_SERVER_BROWSER — an ordinary solvable CAPTCHA. The customer
//      sees the live Railway Chromium page and the Buster yellow-person
//      button, exactly as today. Nothing changes.
//
//   2. USER_SIDE_HANDOFF — the refusal is about our NETWORK, not the puzzle.
//      A screenshot cannot fix that, because a screenshot does not change the
//      source IP. The customer completes the verification in their own
//      browser, on their own connection, and returns only the legitimate
//      result.
//
//   3. SKIP_SOURCE — neither is possible. That source is skipped, Verify
//      continues, and NOTHING negative is recorded about the property.
//
// THE LINE THIS FILE DOES NOT CROSS
// ---------------------------------
// A handoff is a real person doing a real verification on the real site. It
// is never token forging, never replay of a solution, never a solving farm,
// never IP spoofing, never tunnelling our requests through the customer's
// connection, and never an automated anti-bot bypass. The only thing that
// crosses back from the customer is a public result the source itself would
// hand any ordinary visitor.
//
// WHY FEASIBILITY IS PER-SOURCE
// -----------------------------
// Session transfer is NOT universal and assuming it is would be the single
// easiest way to build something that looks finished and silently fails. A
// source is handoff-capable only if a customer can reach the same result from
// a cold start in their own browser — no server cookie, no server-side wizard
// state, no multi-step flow that only makes sense mid-session. Each entry
// below records that judgement and the reason for it.

export type HandoffCapability =
  /** The customer can reach the same public result from a cold start. */
  | 'PUBLIC_LOOKUP'
  /** Result reachable, but only by re-entering inputs we already hold. */
  | 'REPEATABLE_WITH_INPUTS'
  /** Requires server-side session state that cannot be legitimately moved. */
  | 'SESSION_BOUND'
  /** The source has no public human-facing path at all. */
  | 'NOT_HANDOFFABLE';

export type HandoffDecision = 'RETRY_IN_SERVER_BROWSER' | 'USER_SIDE_HANDOFF' | 'SKIP_SOURCE';

/** Mirrors the migration's handoff_kind check constraint. */
export type HandoffKind = 'VERIFY_ON_SOURCE' | 'FETCH_AND_RETURN' | 'UPLOAD_RESULT';

export interface SourceHandoffSpec {
  /** Stable source key, matching SOURCE_KEYS in the Verify extraction layer. */
  key: string;
  capability: HandoffCapability;
  /** What we would ask the customer to actually do. */
  kind: HandoffKind;
  /** Inputs the customer's browser needs. Only things we may lawfully pass:
   * the cadastral code or company id the customer themselves asked about.
   * Never a cookie, never a token, never another user's data. */
  requiredInputs: ('cadastralCode' | 'companyIdCode' | 'personalId')[];
  /** Whether the remaining flow for this source can continue server-side once
   * the customer returns a result, or whether the customer must finish it. */
  serverCanContinue: boolean;
  /** Honest engineering note. Read by the feasibility report, not by the UI. */
  note: string;
}

/**
 * The feasibility matrix.
 *
 * Judgements are conservative on purpose: a source marked handoff-capable
 * that turns out not to be produces a dead end for a paying customer, which
 * is worse than skipping it cleanly.
 */
export const SOURCE_HANDOFF: Readonly<Record<string, SourceHandoffSpec>> = Object.freeze({
  'napr.registry': {
    key: 'napr.registry',
    capability: 'REPEATABLE_WITH_INPUTS',
    kind: 'VERIFY_ON_SOURCE',
    requiredInputs: ['cadastralCode'],
    serverCanContinue: false,
    note:
      'The public registry extract search is reachable from a cold start with only the cadastral ' +
      'code, which the customer supplied in the first place. The customer completes the ' +
      'verification and returns the public extract reference. The server cannot continue the ' +
      'same session afterwards, so the returned reference is the deliverable.',
  },
  'napr.enreg': {
    key: 'napr.enreg',
    capability: 'REPEATABLE_WITH_INPUTS',
    kind: 'VERIFY_ON_SOURCE',
    requiredInputs: ['companyIdCode'],
    serverCanContinue: false,
    note:
      'Company registry lookup by identification code is a public, single-step search. A customer ' +
      'can reproduce it from a cold start and return the public extract link.',
  },
  'enforcement.debtors': {
    key: 'enforcement.debtors',
    capability: 'REPEATABLE_WITH_INPUTS',
    kind: 'VERIFY_ON_SOURCE',
    requiredInputs: ['companyIdCode'],
    serverCanContinue: false,
    note:
      'The debtors registry is a public single-field lookup and is the source that most often ' +
      'produces the datacenter refusal. It is the primary motivating case for handoff.',
  },
  'rs.taxpayer': {
    key: 'rs.taxpayer',
    capability: 'REPEATABLE_WITH_INPUTS',
    kind: 'VERIFY_ON_SOURCE',
    requiredInputs: ['companyIdCode'],
    serverCanContinue: false,
    note: 'Taxpayer status is a public lookup keyed by identification code.',
  },
  'mygov.permits': {
    key: 'mygov.permits',
    capability: 'SESSION_BOUND',
    kind: 'VERIFY_ON_SOURCE',
    requiredInputs: ['cadastralCode'],
    serverCanContinue: false,
    note:
      'The permits flow is a multi-step Angular wizard whose result depends on server-side ' +
      'navigation state built up across several screens. A customer starting cold would have to ' +
      'reproduce that navigation exactly, and the document set reached depends on choices made ' +
      'mid-flow. Marked SESSION_BOUND rather than guessed at: an unreliable handoff here would ' +
      'strand the customer on a wizard with no way to know they had finished.',
  },
  'napr.map': {
    key: 'napr.map',
    capability: 'NOT_HANDOFFABLE',
    kind: 'VERIFY_ON_SOURCE',
    requiredInputs: ['cadastralCode'],
    serverCanContinue: false,
    note:
      'The cadastral map is consumed as rendered tiles plus layer state. There is no discrete ' +
      'public "result" a customer could hand back, so there is nothing for a handoff to return.',
  },
  'napr.document': {
    key: 'napr.document',
    capability: 'PUBLIC_LOOKUP',
    kind: 'FETCH_AND_RETURN',
    requiredInputs: [],
    serverCanContinue: true,
    note:
      'A registry document is addressed by a stable public URL discovered earlier in the run. If ' +
      'that URL is already known, the customer can open it directly and upload or confirm the ' +
      'document, and the server CAN continue parsing afterwards because the artifact — not a ' +
      'session — is what was missing.',
  },
});

/** Sources with no entry are treated as not handoff-capable. Failing closed is
 * the safe direction: an unknown source gets skipped cleanly rather than
 * sending a customer somewhere we have not reasoned about. */
export function specFor(sourceKey: string): SourceHandoffSpec | null {
  return SOURCE_HANDOFF[sourceKey] ?? null;
}

export function isHandoffCapable(sourceKey: string): boolean {
  const s = specFor(sourceKey);
  return !!s && (s.capability === 'PUBLIC_LOOKUP' || s.capability === 'REPEATABLE_WITH_INPUTS');
}

/* ------------------------------------------------------------------ *
 * The decision                                                        *
 * ------------------------------------------------------------------ */

export interface HandoffContext {
  sourceKey: string;
  /** Verify's own customer-facing status for this source. */
  status: string;
  /**
   * True when the page text showed a TERMINAL network refusal — Google's
   * "Try again later" / "your computer or network may be sending automated
   * queries". This is the signal that distinguishes "hard puzzle" from
   * "this IP is refused", and it is the whole reason handoff exists.
   */
  networkRefusal: boolean;
  /** Inputs we actually hold. A handoff cannot be offered without them. */
  available: { cadastralCode?: string | null; companyIdCode?: string | null; personalId?: string | null };
  /** Set when the customer already declined or a previous handoff expired, so
   * we do not loop them back into the same dead end. */
  priorAttempt?: 'NONE' | 'CANCELLED' | 'EXPIRED' | 'COMPLETED';
}

export interface HandoffPlan {
  decision: HandoffDecision;
  sourceKey: string;
  kind: HandoffKind | null;
  /** Why, in engineering terms. Surfaced in logs and the audit trail, never
   * shown raw to a customer. */
  reason: string;
  serverCanContinue: boolean;
}

/**
 * Decides what to do about one source that needs human verification.
 *
 * Ordering matters and is deliberate:
 *
 *   - A terminal network refusal goes STRAIGHT to handoff when possible. The
 *     mandate is explicit: do not first ask the customer to solve a CAPTCHA
 *     that cannot be solved from where it is rendered.
 *   - An ordinary CAPTCHA stays in the server browser, where Buster helps.
 *   - Everything else skips the source. Skipping is always safe, because a
 *     skipped source produces no evidence and therefore cannot produce a
 *     negative finding or move the verdict.
 */
export function decideHandoff(ctx: HandoffContext): HandoffPlan {
  const spec = specFor(ctx.sourceKey);
  const capable = isHandoffCapable(ctx.sourceKey);
  const base = { sourceKey: ctx.sourceKey, serverCanContinue: spec?.serverCanContinue ?? false };

  // A completed handoff must never be re-offered — that would be a loop.
  if (ctx.priorAttempt === 'COMPLETED') {
    return { ...base, decision: 'SKIP_SOURCE', kind: null, reason: 'handoff already completed for this source' };
  }

  // The customer already said no, or let it lapse. Asking again is nagging,
  // and the honest outcome is to skip and continue.
  if (ctx.priorAttempt === 'CANCELLED' || ctx.priorAttempt === 'EXPIRED') {
    return {
      ...base,
      decision: 'SKIP_SOURCE',
      kind: null,
      reason: `previous handoff ended as ${ctx.priorAttempt}; not re-offering`,
    };
  }

  if (ctx.networkRefusal) {
    if (!capable) {
      return {
        ...base,
        decision: 'SKIP_SOURCE',
        kind: null,
        reason: spec
          ? `terminal network refusal and source is ${spec.capability}`
          : 'terminal network refusal and source has no handoff spec',
      };
    }
    if (!hasRequiredInputs(spec!, ctx.available)) {
      return {
        ...base,
        decision: 'SKIP_SOURCE',
        kind: null,
        reason: `handoff needs ${spec!.requiredInputs.join(', ')} which is not available`,
      };
    }
    return {
      ...base,
      decision: 'USER_SIDE_HANDOFF',
      kind: spec!.kind,
      reason: 'terminal network refusal; verification must originate from the customer network',
    };
  }

  // Ordinary solvable CAPTCHA — unchanged behaviour, Buster still applies.
  if (ctx.status === 'CAPTCHA_REQUIRED') {
    return {
      ...base,
      decision: 'RETRY_IN_SERVER_BROWSER',
      kind: null,
      reason: 'ordinary CAPTCHA; solvable in the server browser with extension assistance',
    };
  }

  if (ctx.status === 'BLOCKED' || ctx.status === 'TECHNICAL_FAILED') {
    if (capable && hasRequiredInputs(spec!, ctx.available)) {
      return {
        ...base,
        decision: 'USER_SIDE_HANDOFF',
        kind: spec!.kind,
        reason: `source reported ${ctx.status}; customer-side lookup is possible`,
      };
    }
    return { ...base, decision: 'SKIP_SOURCE', kind: null, reason: `source reported ${ctx.status} and cannot be handed off` };
  }

  return { ...base, decision: 'SKIP_SOURCE', kind: null, reason: `no human verification needed for status ${ctx.status}` };
}

function hasRequiredInputs(spec: SourceHandoffSpec, available: HandoffContext['available']): boolean {
  return spec.requiredInputs.every((k) => {
    const v = available[k];
    return typeof v === 'string' && v.trim().length > 0;
  });
}

/* ------------------------------------------------------------------ *
 * Terminal-refusal detection                                          *
 * ------------------------------------------------------------------ */

// The phrases Google actually serves when it refuses a network outright, in
// the languages this product encounters. Matching is substring-based and
// case-insensitive because the surrounding markup varies.
const REFUSAL_PATTERNS: RegExp[] = [
  /your computer or network may be sending automated queries/i,
  /we're sorry\.\.\..*but your computer or network/i,
  /unusual traffic from your computer network/i,
  /try again later/i,
  /автоматические запросы/i,
  /необычный трафик/i,
];

/**
 * True when page text indicates the NETWORK was refused rather than a puzzle
 * being presented.
 *
 * Kept deliberately narrow. A false positive here sends a customer into a
 * handoff they did not need; a false negative merely leaves today's behaviour
 * in place, which still works for ordinary CAPTCHAs. So the failure that
 * costs less is the one this errs toward.
 */
export function isTerminalNetworkRefusal(pageText: string | null | undefined): boolean {
  if (!pageText) return false;
  const t = String(pageText);
  // "Try again later" alone is too generic to act on; it only counts as a
  // refusal when it appears alongside automated-query or unusual-traffic
  // language, which is how Google's block page is actually worded.
  const strong = REFUSAL_PATTERNS.slice(0, 3).concat(REFUSAL_PATTERNS.slice(4));
  if (strong.some((re) => re.test(t))) return true;
  return /try again later/i.test(t) && /(automated|robot|unusual traffic|запрос)/i.test(t);
}

/** The feasibility matrix as data, for the report and the admin surface. */
export function feasibilityMatrix(): SourceHandoffSpec[] {
  return Object.values(SOURCE_HANDOFF).slice().sort((a, b) => a.key.localeCompare(b.key));
}
