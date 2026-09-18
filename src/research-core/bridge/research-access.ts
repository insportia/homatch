// HOMATCH RESEARCH CORE — authenticated research access, and its limits.
//
// Some public content is served reliably only to a logged-in session. An
// operator may legitimately connect one. This file is the model of that
// connection, and — more importantly — the model of everything it is not
// allowed to become.
//
// THE SECRET IS NEVER HERE
//
// Homatch already has the pattern: `dev_ad_connections.credential_ref` holds
// "the NAME of a secret held by the platform, never the secret". This follows
// it exactly. A connection row carries a `credentialRef` — an opaque key into
// the platform secret store — plus status and health. No cookie, no token, no
// password, no session blob, in the database, in the API response, in the
// frontend, in a log line, or in this repository.
//
// `redactConnection()` below is what goes anywhere near a log or an admin
// payload, and __tests__/researchAccess.test.mjs asserts that nothing
// resembling a credential survives it.
//
// THE ACCOUNT IS AN ACCESS LAYER, NOT THE DATABASE
//
// What Homatch learns is kept in source_registry and raw_signals, which
// outlive any session. A connection that expires costs reach, not knowledge.
//
// WHAT THIS DELIBERATELY CANNOT DO
//
// There is no join, no bulk join, no challenge handler, no CAPTCHA path, no
// fingerprint or stealth option, no proxy setting and no account pool. A
// source needing membership becomes an AccessRequest — a queue entry for a
// human — and that is the only mechanism. `AccessRequest` has no "auto
// approve" state for the same reason.

export type ConnectionStatus =
  /** No credential provisioned. The normal state. */
  | 'NOT_CONNECTED'
  /** An operator started the connection; the secret is not present yet. */
  | 'PENDING_CREDENTIALS'
  | 'CONNECTED'
  /** Present but rejected — expired, revoked, or challenged. */
  | 'ACTION_REQUIRED'
  /** Turned off deliberately. */
  | 'DISABLED';

export type ResearchPlatform = 'FACEBOOK' | 'INSTAGRAM';

export interface ResearchConnection {
  id: string;
  platform: ResearchPlatform;
  /** What an operator calls it. Never the account's password or handle-as-secret. */
  label: string;
  /**
   * The NAME of a platform secret, never the secret.
   *
   * An operator provisions the value out of band (the platform's own secret
   * store); Homatch stores only this reference. Nothing in the product can
   * read the value back out to a browser.
   */
  credentialRef: string | null;
  status: ConnectionStatus;
  /** Operator-facing detail. Must never quote the credential. */
  statusDetail: string | null;
  lastValidatedAt: string | null;
  /** When the platform said the session ends, if it said. Never guessed. */
  expiresAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
  consecutiveFailures: number;
  createdAt: string;
  updatedAt: string;
}

export type ConnectionHealth = 'HEALTHY' | 'EXPIRING' | 'EXPIRED' | 'FAILING' | 'ABSENT';

/**
 * Health, from what the platform actually told us.
 *
 * EXPIRING is not a prediction about a session we have not tested — it is
 * reported only when the platform gave an expiry. A connection with no stated
 * expiry is never guessed to be expiring.
 */
export function connectionHealth(
  connection: ResearchConnection,
  now: number = Date.now(),
): ConnectionHealth {
  if (connection.status === 'NOT_CONNECTED' || connection.status === 'DISABLED') return 'ABSENT';
  if (connection.status === 'PENDING_CREDENTIALS') return 'ABSENT';
  if (connection.status === 'ACTION_REQUIRED') return 'EXPIRED';

  if (connection.expiresAt) {
    const expiry = Date.parse(connection.expiresAt);
    if (Number.isFinite(expiry)) {
      if (expiry <= now) return 'EXPIRED';
      if (expiry - now <= 3 * 86_400_000) return 'EXPIRING';
    }
  }

  if (connection.consecutiveFailures >= 3) return 'FAILING';
  return 'HEALTHY';
}

/** May this connection be used for research right now? */
export function isUsable(connection: ResearchConnection, now: number = Date.now()): boolean {
  if (connection.status !== 'CONNECTED') return false;
  if (!connection.credentialRef) return false;
  const health = connectionHealth(connection, now);
  return health === 'HEALTHY' || health === 'EXPIRING';
}

/**
 * Anything that looks like a credential, so it can be kept out of logs.
 *
 * Deliberately broad. A false positive redacts a harmless string; a false
 * negative puts a session cookie in a log file forever.
 */
const CREDENTIAL_SHAPED =
  /(c_user|xs=|sessionid|csrftoken|datr|fr=|access_token|Bearer\s+\S+|sid=|[A-Za-z0-9_-]{40,})/i;

export interface RedactedConnection {
  id: string;
  platform: ResearchPlatform;
  label: string;
  /** Whether a credential reference exists. Never what it is. */
  hasCredential: boolean;
  status: ConnectionStatus;
  statusDetail: string | null;
  lastValidatedAt: string | null;
  expiresAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
  consecutiveFailures: number;
  health: ConnectionHealth;
}

/**
 * The only shape that may leave the server.
 *
 * `credentialRef` is dropped entirely rather than masked: a reference is not
 * a secret, but it is a key into the store that holds one, and the frontend
 * has no use for it.
 */
export function redactConnection(
  connection: ResearchConnection,
  now: number = Date.now(),
): RedactedConnection {
  return {
    id: connection.id,
    platform: connection.platform,
    label: scrub(connection.label),
    hasCredential: !!connection.credentialRef,
    status: connection.status,
    statusDetail: connection.statusDetail ? scrub(connection.statusDetail) : null,
    lastValidatedAt: connection.lastValidatedAt,
    expiresAt: connection.expiresAt,
    lastFailureAt: connection.lastFailureAt,
    lastFailureReason: connection.lastFailureReason ? scrub(connection.lastFailureReason) : null,
    consecutiveFailures: connection.consecutiveFailures,
    health: connectionHealth(connection, now),
  };
}

/** Remove anything credential-shaped from an operator-facing string. */
export function scrub(text: string): string {
  return text
    .split(/\s+/)
    .map((token) => (CREDENTIAL_SHAPED.test(token) ? '[redacted]' : token))
    .join(' ');
}

/* ────────────────────────────────────────────────────────────────────────
 * The access queue
 *
 * A source that needs membership is recorded here and waits for a person.
 * There is no state that means "joined automatically", because there is no
 * code that joins.
 * ──────────────────────────────────────────────────────────────────────── */

export type AccessRequestState =
  | 'REQUESTED'
  /** A human is dealing with it on the platform. */
  | 'IN_PROGRESS'
  /** Access exists; the source can move to AUTHENTICATED_ACCESS. */
  | 'APPROVED'
  /** A human decided not to. The source is not re-queued. */
  | 'REJECTED'
  /** Asked and refused by the platform or the group's owner. */
  | 'DENIED_BY_PLATFORM';

export interface AccessRequest {
  id: string;
  sourceUrl: string;
  platform: ResearchPlatform;
  sourceName: string | null;
  /** Why an operator should spend time on this. Shown in the queue. */
  rationale: string;
  countryCode: string | null;
  city: string | null;
  languages: string[];
  /** Which jobs would benefit, so the queue can be prioritised. */
  profiles: string[];
  state: AccessRequestState;
  requestedAt: string;
  lastAttemptAt: string | null;
  lastAttemptStatus: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  note: string | null;
}

/**
 * Turn a JOIN_REQUIRED discovery into a queue entry.
 *
 * Deterministic id on the URL, so the same group discovered by three
 * different jobs produces one queue entry rather than three.
 */
export function toAccessRequest(input: {
  id: string;
  sourceUrl: string;
  platform: ResearchPlatform;
  sourceName: string | null;
  rationale: string;
  countryCode: string | null;
  city: string | null;
  languages: string[];
  profiles: string[];
  at: string;
}): AccessRequest {
  return {
    id: input.id,
    sourceUrl: input.sourceUrl,
    platform: input.platform,
    sourceName: input.sourceName,
    rationale: input.rationale,
    countryCode: input.countryCode,
    city: input.city,
    languages: input.languages,
    profiles: input.profiles,
    state: 'REQUESTED',
    requestedAt: input.at,
    lastAttemptAt: null,
    lastAttemptStatus: null,
    decidedAt: null,
    decidedBy: null,
    note: null,
  };
}

/**
 * Which access states a request can move a source into.
 *
 * Only APPROVED grants access, and only to AUTHENTICATED_ACCESS — never to
 * PUBLIC, because a source behind a membership wall is not public just
 * because we are now inside it.
 */
export function sourceStateAfter(request: AccessRequest): 'JOIN_REQUIRED' | 'AUTHENTICATED_ACCESS' | 'INACCESSIBLE' {
  switch (request.state) {
    case 'APPROVED':
      return 'AUTHENTICATED_ACCESS';
    case 'REJECTED':
    case 'DENIED_BY_PLATFORM':
      return 'INACCESSIBLE';
    case 'REQUESTED':
    case 'IN_PROGRESS':
      return 'JOIN_REQUIRED';
  }
}
