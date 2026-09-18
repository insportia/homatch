/**
 * THE LOCAL HALF OF THE DECISION.
 *
 * Authorisation for object storage is answered twice, and an object is
 * reachable only if both answers are yes.
 *
 *   here      the key is well formed, the namespace and category exist, the
 *             caller is at least the right KIND of person, and the file
 *             being written is a type and size this category accepts.
 *   Postgres  `storage_authorize` — is this object actually theirs.
 *
 * WHY TWICE
 *
 * The two halves fail differently. This one is pure, runs in the ordinary
 * test suite, and can be exhausted: every malformed key, every unknown
 * category, every oversized upload. It cannot see a single row, so it can
 * never answer "is this yours". The other half can only be checked against a
 * live database, and does not run in CI at all. Neither is sufficient; the
 * conjunction is, and it fails closed in both directions.
 *
 * The rule this file must never break: IT MAY ONLY DENY. Every ALLOW it
 * returns is provisional and still has to survive the database.
 */

import {
  KeyError, checkContent, parseKey, requirementFor,
  type ParsedKey, type StorageAction,
} from './keys.ts';

export type DenyReason =
  | 'UNAUTHENTICATED'
  | 'NOT_OWNER'
  | 'NOT_ADMIN'
  | 'NO_CAPABILITY'
  | 'INVALID_KEY'
  | 'MIME_NOT_ALLOWED'
  | 'TOO_LARGE'
  | 'UNAVAILABLE';

export interface CallerFacts {
  /** The auth uid — what every ownership rule compares against. */
  authUid: string | null;
  authenticated: boolean;
  /** Whether `is_admin()` said yes. Null when it was never asked. */
  isAdmin: boolean | null;
}

export type Decision =
  | { allowed: true; caller: CallerFacts; parsed: ParsedKey }
  | { allowed: false; reason: DenyReason; caller: CallerFacts; parsed: ParsedKey | null };

export interface LocalGateInput {
  key: unknown;
  action: StorageAction;
  authUid: string | null;
  /** `public.is_admin()` for this caller. Null means the query failed. */
  isAdmin: () => Promise<boolean | null>;
  /** Declared by the caller; only meaningful for a WRITE. */
  contentType?: string;
  byteSize?: number;
}

/**
 * The coarse gate, run before the database is asked anything expensive.
 *
 * It answers the questions that need no rows, and it is the only place the
 * content policy is enforced — a presigned PUT is a capability, and once it
 * exists nothing can refuse what gets sent to it.
 */
export async function localGate(input: LocalGateInput): Promise<Decision> {
  const caller: CallerFacts = {
    authUid: input.authUid,
    authenticated: input.authUid !== null && input.authUid !== '',
    isAdmin: null,
  };

  let parsed: ParsedKey;
  try {
    parsed = parseKey(typeof input.key === 'string' ? input.key : '');
  } catch (err) {
    if (err instanceof KeyError) {
      return { allowed: false, reason: 'INVALID_KEY', caller, parsed: null };
    }
    throw err;
  }

  const deny = (reason: DenyReason): Decision =>
    ({ allowed: false, reason, caller, parsed });

  // ── The coarse person check, BEFORE the content policy ────────────────
  // Order matters. A stranger who is refused with MIME_NOT_ALLOWED has just
  // been told what this namespace accepts; a stranger refused with
  // UNAUTHENTICATED has been told only that they are a stranger.
  const requirement = requirementFor(parsed, input.action);

  if (requirement.kind !== 'ANYONE') {
    if (!caller.authenticated) return deny('UNAUTHENTICATED');

    if (requirement.kind === 'ADMIN') {
      // Asked here as well as in SQL, because an admin-only namespace should
      // not cost a signing attempt to refuse.
      const isAdmin = await input.isAdmin();
      caller.isAdmin = isAdmin;
      // A database that could not answer is not a yes. This is why the
      // helper returns `boolean | null` rather than throwing: "unknown" has
      // to be representable, or it silently becomes "true".
      if (isAdmin === null) return deny('UNAVAILABLE');
      if (!isAdmin) return deny('NOT_ADMIN');
    }
  }

  // ── Content policy, on writes only ────────────────────────────────────
  if (input.action === 'WRITE') {
    const verdict = checkContent(parsed, input.contentType, input.byteSize);
    if (!verdict.ok) {
      return deny(verdict.reason === 'TOO_LARGE' ? 'TOO_LARGE' : 'MIME_NOT_ALLOWED');
    }
  }

  // Provisional. Postgres decides whose object this actually is.
  return { allowed: true, caller, parsed };
}

/** Every reason Postgres can return, mapped onto this module's vocabulary. */
export function reasonFromSql(verdict: unknown): DenyReason | 'ALLOW' {
  switch (verdict) {
    case 'ALLOW': return 'ALLOW';
    case 'UNAUTHENTICATED':
    case 'NOT_OWNER':
    case 'NOT_ADMIN':
    case 'NO_CAPABILITY':
    case 'INVALID_KEY':
      return verdict;
    // Anything unrecognised — including null, which is what a failed RPC
    // looks like — is a refusal. There is no "probably fine" here.
    default: return 'UNAVAILABLE';
  }
}
