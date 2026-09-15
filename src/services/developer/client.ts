// HOMATCH FOR DEVELOPERS — the one place a Supabase error becomes a decision.
//
// Two rules, both of them §87:
//
//   Nothing is swallowed. There is no `.catch(() => {})` anywhere in this
//   product; a read that fails throws a DevError and the screen renders its
//   error state. A silently empty inventory table is worse than an error,
//   because the person believes it.
//
//   The customer never reads Postgres. `new row violates row-level security
//   policy for table "dev_units"` is a sentence for us. The customer gets a
//   translation key chosen from the SQLSTATE, and the original goes to the
//   error log with the ids and nothing else.

import { supabase } from '@/db/supabase';
import { reportError } from '@/lib/errorReporting';
import type { PostgrestError } from '@supabase/supabase-js';

/**
 * `key` is a translation key the UI renders. `detail` is for us and is never
 * put in front of anybody.
 */
export class DevError extends Error {
  readonly key: string;
  readonly code: string | null;
  constructor(key: string, detail: string, code: string | null) {
    super(detail);
    this.name = 'DevError';
    this.key = key;
    this.code = code;
  }
}

/**
 * SQLSTATE to something a salesperson can act on.
 *
 * 42501 and the RLS message are the same event from two directions: the
 * database refused because of who you are. Both say so in the same words.
 */
function keyForCode(code: string | null, message: string): string {
  if (code === '42501' || /row-level security/i.test(message)) return 'dev_err_not_allowed';
  if (code === '23505') return 'dev_err_already_exists';
  if (code === '23503') return 'dev_err_missing_reference';
  if (code === '23514' || code === '23502') return 'dev_err_invalid';
  if (code === 'P0002' || code === '02000') return 'dev_err_not_found';
  if (code === 'PGRST116') return 'dev_err_not_found';
  return 'dev_err_generic';
}

/**
 * A raise from one of our own PL/pgSQL functions carries a sentence that was
 * written for the customer ("Unit A-704 is SOLD and cannot be reserved").
 * Those are worth showing verbatim; a Postgres internal is not. The test is
 * whether the function chose the errcode itself.
 */
const AUTHORED_CODES = new Set(['23514', 'P0001', '42501', '02000', 'P0002']);

function isAuthoredMessage(code: string | null, message: string): boolean {
  if (!code || !AUTHORED_CODES.has(code)) return false;
  if (/row-level security|permission denied for|violates/i.test(message)) return false;
  // Our messages are sentences. Postgres internals are not punctuated like this.
  return /[.!?]$/.test(message.trim()) && message.length < 220;
}

export function toDevError(
  error: PostgrestError | Error,
  context: { op: string; subjectId?: string | null },
): DevError {
  const pg = error as PostgrestError;
  const code = typeof pg.code === 'string' ? pg.code : null;
  const message = error.message ?? 'Unknown error';

  reportError(error instanceof Error ? error : new Error(message), {
    route: typeof window !== 'undefined' ? window.location.pathname : undefined,
    subjectId: context.subjectId ?? null,
    stage: context.op,
    boundary: 'developer-os',
  });

  const key = isAuthoredMessage(code, message) ? 'dev_err_passthrough' : keyForCode(code, message);
  return new DevError(key, message, code);
}

/**
 * THE SENTENCE TO PUT IN FRONT OF SOMEBODY.
 *
 * `dev_err_passthrough` is not a message — it is a marker meaning "the
 * database already wrote one". Our own PL/pgSQL raises say things like
 * "Unit A-704 is no longer available to offer." and a person can act on that;
 * replacing it with "That could not be done." throws away the only useful
 * part. Every call site goes through here so the choice is made once.
 */
export function devErrorText(
  error: unknown, t: (key: string) => string,
): string {
  if (error instanceof DevError) {
    if (error.key === 'dev_err_passthrough') return error.message;
    return t(error.key);
  }
  return t('dev_err_generic');
}

/** Run a PostgREST query and throw a DevError rather than returning `{ error }`. */
export async function run<T>(
  op: string,
  query: PromiseLike<{ data: T | null; error: PostgrestError | null }>,
  subjectId?: string | null,
): Promise<T> {
  const { data, error } = await query;
  if (error) throw toDevError(error, { op, subjectId });
  return data as T;
}

/** Same, for a list where "no rows" is an empty array and never an error. */
export async function runList<T>(
  op: string,
  query: PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
  subjectId?: string | null,
): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw toDevError(error, { op, subjectId });
  return data ?? [];
}

/** Call a SECURITY DEFINER function. Every workflow transition goes through here. */
export async function rpc<T>(
  fn: string,
  args: Record<string, unknown>,
  subjectId?: string | null,
): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw toDevError(error, { op: `rpc:${fn}`, subjectId });
  return data as T;
}

export { supabase };
