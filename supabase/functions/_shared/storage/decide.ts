/**
 * THE AUTHORISATION DECISION, WITH THE DATABASE TAKEN OUT OF IT.
 *
 * This is the rule that replaces twenty-two RLS policies, and it is the one
 * piece of the object-storage layer whose mistakes are invisible: a signer
 * that is wrong returns 403 from R2 and you find out immediately, but an
 * authoriser that is wrong hands somebody a working URL to a contract and
 * nothing anywhere reports a problem.
 *
 * So the decision takes its two database answers as FUNCTIONS instead of
 * reaching for a client. Every branch — anonymous, signed in but not the
 * owner, signed in but not an admin, in the workspace without the
 * capability, a database that is down — can then be exercised in the
 * ordinary test suite, in milliseconds, with no Deno and no network. The
 * wiring that turns those functions into real queries is in storageAuth.ts
 * and is four lines long.
 *
 * WHAT A DENIAL IS ALLOWED TO SAY
 *
 * Enough for the caller to know what to do — sign in, or ask for access —
 * and nothing about what exists. A refused key and a key that was never
 * written must be indistinguishable from outside.
 */

import { KeyError, parseKey, type ParsedKey, type StorageAction } from './keys.ts';

export type DenyReason =
  | 'UNAUTHENTICATED'
  | 'NOT_OWNER'
  | 'NOT_ADMIN'
  | 'NO_CAPABILITY'
  | 'INVALID_KEY'
  | 'UNAVAILABLE';

export interface CallerFacts {
  /** The auth uid — what every owner-scoped policy compares against. */
  authUid: string | null;
  authenticated: boolean;
}

export type Decision =
  | { allowed: true; caller: CallerFacts; parsed: ParsedKey }
  | { allowed: false; reason: DenyReason; caller: CallerFacts; parsed: ParsedKey | null };

export interface DecideInput {
  key: unknown;
  action: StorageAction;
  /** Null when the caller presented no user token. */
  authUid: string | null;
  /** `public.is_admin()` as the caller. Null means the query failed. */
  isAdmin: () => Promise<boolean | null>;
  /** `public.dev_can(ws, cap)` as the caller. Null means the query failed. */
  devCan: (workspace: string, capability: string) => Promise<boolean | null>;
}

export async function decide(input: DecideInput): Promise<Decision> {
  const caller: CallerFacts = {
    authUid: input.authUid,
    authenticated: input.authUid !== null && input.authUid !== '',
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

  const allow = (): Decision => ({ allowed: true, caller, parsed });
  const deny = (reason: DenyReason): Decision =>
    ({ allowed: false, reason, caller, parsed });

  const requirement = parsed.rules[input.action];

  switch (requirement.kind) {
    case 'ANYONE':
      return allow();

    case 'AUTHENTICATED':
      return caller.authenticated ? allow() : deny('UNAUTHENTICATED');

    case 'OWNER': {
      if (!caller.authenticated) return deny('UNAUTHENTICATED');
      // The live policy compares `(storage.foldername(name))[1]` with
      // `auth.uid()::text`. Same two values, same comparison.
      const owner = (parsed.scopeSegment ?? '').toLowerCase();
      return owner === (caller.authUid ?? '').toLowerCase() ? allow() : deny('NOT_OWNER');
    }

    case 'ADMIN': {
      if (!caller.authenticated) return deny('UNAUTHENTICATED');
      const isAdmin = await input.isAdmin();
      // A database that could not answer is not a yes. This branch is the
      // reason the helpers return `boolean | null` rather than throwing:
      // "unknown" has to be representable, or it becomes "true".
      if (isAdmin === null) return deny('UNAVAILABLE');
      return isAdmin ? allow() : deny('NOT_ADMIN');
    }

    case 'WORKSPACE': {
      if (!caller.authenticated) return deny('UNAUTHENTICATED');
      const can = await input.devCan(parsed.scopeSegment ?? '', requirement.capability);
      if (can === null) return deny('UNAVAILABLE');
      return can ? allow() : deny('NO_CAPABILITY');
    }

    default:
      // Unreachable while Requirement has five members — and a denial
      // anyway, because the alternative to an exhaustive switch is a silent
      // allow the day a sixth is added.
      return deny('UNAVAILABLE');
  }
}
