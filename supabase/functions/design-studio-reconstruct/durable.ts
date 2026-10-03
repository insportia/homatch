// HOMATCH DESIGN STUDIO — WORK THE SERVER OWNS.
//
// An expensive Design Studio operation (reading a plan, understanding photos,
// writing a design specification, generating a picture) is accepted by one
// request and then owned by the server: the request records it, answers at
// once, and the work continues in the background (EdgeRuntime.waitUntil).
// Closing the page, navigating away or a phone backgrounding the browser
// therefore never stops it — the answer was already sent.
//
// Its row is the lease: a RUNNING row touched within LEASE_MS is being worked
// on; one older than that was abandoned (an instance killed mid-call) and the
// next request for the same thing may take it over with a compare-and-set, so
// nothing is ever stuck and nothing runs twice at once.
//
// A failure is recorded with its category, never as "could not read":
//   RETRYABLE:<CODE>  the source is fine; asking again may succeed
//   TERMINAL:<CODE>   the source itself cannot be used (missing, wrong type…)

/** Longer than any single background invocation may live (the edge wall clock), so a live worker is never taken over. */
export const LEASE_MS = 8 * 60_000;

export const isFresh = (at: string | null | undefined, now = Date.now()) => !!at && Date.parse(at) > now - LEASE_MS;

export type FailureCategory = 'RETRYABLE' | 'TERMINAL';
export const failure = (category: FailureCategory, code: string) => `${category}:${code}`.slice(0, 300);

/** A stored failure, read back: category (legacy plain codes count as retryable — the source was never judged). */
export function readFailure(stored: string | null | undefined): { category: FailureCategory; code: string } | null {
  if (!stored) return null;
  const m = /^(RETRYABLE|TERMINAL):(.+)$/.exec(stored);
  return m ? { category: m[1] as FailureCategory, code: m[2] } : { category: 'RETRYABLE', code: stored };
}

/** Input problems the customer must fix (another file); everything else is worth asking again. */
const TERMINAL_CODES = new Set([
  'FILE_MISSING', 'FILE_TOO_LARGE', 'NOT_A_SUPPORTED_IMAGE', 'IMAGE_SIZE_UNREADABLE', 'INVALID_KEY',
  'SOURCE_MISSING', 'UNREADABLE_SOURCE', 'NOTHING_READ', 'REFERENCE_MISSING', 'UNSUPPORTED_PHOTOS', 'IS_FLOOR_PLAN',
]);
export const categoryOf = (code: string): FailureCategory => (TERMINAL_CODES.has(code) ? 'TERMINAL' : 'RETRYABLE');

/** Run after the answer (kept alive by EdgeRuntime.waitUntil); awaited where the runtime has none. */
export async function inBackground(label: string, work: () => Promise<unknown>): Promise<void> {
  const run = () => work().catch((e) => console.error(`[ds-durable] ${label}`, String((e as Error)?.message ?? e).slice(0, 200)));
  try {
    const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (rt?.waitUntil) { rt.waitUntil(run()); return; }
  } catch { /* fall through */ }
  await run();
}

/**
 * Start the next step in a fresh invocation of this same function, as the same
 * caller — so a long chain (spec → picture → edit map) moves on without the
 * customer's page. Fire-and-forget: the step route answers at once.
 */
export async function kick(authorization: string | null, route: string, body: Record<string, unknown>): Promise<void> {
  const base = Deno.env.get('SUPABASE_URL');
  if (!base || !authorization) return;
  try {
    const r = await fetch(`${base}/functions/v1/design-studio-reconstruct/${route}`, {
      method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    await r.body?.cancel().catch(() => null);
  } catch (e) {
    console.warn('[ds-durable] kick', route, String((e as Error)?.message ?? e).slice(0, 120));
  }
}
