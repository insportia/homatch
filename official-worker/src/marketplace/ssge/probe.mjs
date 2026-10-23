import { PublicSession } from './vendor/public-session.mjs';

/*
 * One public page request at worker start, so production says whether SS.ge answers this
 * worker at all before a customer's search depends on it (production d3d859cc, 2026-10-22:
 * a run was BLOCKED in 67 ms and nothing recorded why). The same anonymous bootstrap every
 * run performs; no listing is read. Only the status, the answering server and whether an
 * anonymous public token was issued are kept — never the token or a header value.
 */
export async function probeSsgePublicPage({ fetchImpl = fetch, now = () => Date.now() } = {}) {
  const seen = { status: null, server: null, anonymousSession: null, publicTokenPresent: null, error: null };
  const session = new PublicSession({ fetchImpl, now, onBootstrap: (info) => {
    seen.status = info.status ?? null;
    const headers = info.responseHeaders ?? {};
    seen.server = typeof headers.server === 'string' ? headers.server.slice(0, 40) : headers['cf-ray'] ? 'cloudflare' : null;
    seen.anonymousSession = info.anonymousSession ?? null;
    seen.publicTokenPresent = info.publicTokenPresent ?? null;
  } });
  try { await session.token(); } catch (error) { seen.error = String(error?.message ?? error).slice(0, 120); }
  return { ok: seen.error === null && seen.publicTokenPresent === true, ...seen, checkedAt: new Date(now()).toISOString() };
}
