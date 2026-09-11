// HOMATCH — what we keep when something breaks, and what the customer sees.
//
// These are two different audiences and they must never be served the same
// string. A buyer who opened their verification and was shown
//
//     Cannot read properties of undefined (reading 'filter')
//
// learned nothing, lost confidence in a report they paid for, and could not
// tell us anything useful about it. That text is for us.
//
// So: every user-facing surface renders a translation key, and every
// diagnostic goes here instead — with enough context to find the row and
// reproduce it, and deliberately without anything that would turn an error
// log into a copy of a customer's contract.
//
// WHAT IS NEVER LOGGED
//
// Document text, extracted clauses, names, personal numbers, addresses, the
// result payload itself. Ids and shapes only. A stack trace plus "job
// 72ad7c75, payload V3, stage MARKET" is enough to find anything; the
// document body adds nothing to the diagnosis and a great deal to the
// consequences of a leaked log.

/** Context worth having when reading a report of this later. */
export interface ErrorContext {
  /** Where the customer was. `window.location.pathname`, never the query. */
  route?: string;
  /** The row this was about — a uuid, never a name or a filename. */
  subjectId?: string | null;
  subjectType?: 'RESEARCH_JOB' | 'DOCUMENT' | 'DEAL_ROOM' | 'MATCHING_JOB' | 'BACKGROUND_JOB';
  /** Which historical contract the payload arrived in, when known. */
  payloadVersion?: string | null;
  /** Which stage of a multi-stage job was running. */
  stage?: string | null;
  /** The component or boundary that caught it. */
  boundary?: string | null;
}

/**
 * Keys that would carry customer content if a caller passed a whole payload
 * in by mistake. Belt and braces: the type above already excludes them, but
 * `ErrorContext` is structural and an `as any` would slip past it.
 */
const FORBIDDEN_KEYS = new Set([
  'text', 'body', 'content', 'analysis', 'extractedText', 'clauses',
  'name', 'fullName', 'personalNumber', 'address', 'email', 'phone',
  'payload', 'result', 'resultJson', 'document', 'file',
]);

/** Ids and short enum-ish tokens only. Anything long is a sentence, and a
 *  sentence in an error context is almost always customer content. */
const MAX_VALUE_LEN = 120;

export function sanitizeContext(ctx: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(ctx ?? {})) {
    if (FORBIDDEN_KEYS.has(k)) continue;
    if (v === null || v === undefined) continue;
    if (typeof v === 'object') continue;
    const s = String(v);
    if (!s || s.length > MAX_VALUE_LEN) continue;
    out[k] = s;
  }
  return out;
}

/** The message, if there is one, without letting a thrown object stringify
 *  into `[object Object]` and lose the only useful part. */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const m = (error as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return 'unknown error';
}

export function stackOf(error: unknown): string | null {
  return error instanceof Error && typeof error.stack === 'string' ? error.stack : null;
}

/**
 * Record a failure.
 *
 * Console today, because that is what this application has: Sentry is
 * initialised in main.tsx and will pick up anything rethrown, and there is no
 * server-side client error sink to write to yet. Routing every report through
 * one function is what makes adding one later a change in one file rather
 * than in every catch block.
 */
export function reportError(error: unknown, ctx: ErrorContext = {}): void {
  const safe = sanitizeContext(ctx as Record<string, unknown>);
  const stack = stackOf(error);
  // eslint-disable-next-line no-console
  console.error('[homatch]', messageOf(error), safe, stack ?? '');
}
