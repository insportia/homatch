import { PublicSession } from './vendor/public-session.mjs';

/*
 * One public page request at worker start, so production says whether SS.ge answers this
 * worker at all before a customer's search depends on it (production d3d859cc, 2026-10-22:
 * a run was BLOCKED in 67 ms and nothing recorded why). The same anonymous bootstrap every
 * run performs; no listing is read. Only the status, the answering server and whether an
 * anonymous public token was issued are kept — never the token or a header value.
 *
 * 2026-10-23: the same bootstrap answers 200 with a token from a workstation and 403 from
 * this worker, so the refusal depends on WHERE the request comes from. The probe now also
 * records HOW Cloudflare refused (its own `cf-mitigated: challenge` marker means a bot
 * challenge; a 403 without it is a firewall rule) and the worker's public egress address,
 * which changes when Railway places a new deployment on another host. Evidence only: a
 * challenge is never answered and a block is never worked around.
 */
export const EGRESS_IP_URL = 'https://api.ipify.org?format=json';

export function cloudflareRefusal(status, headers = {}) {
  if (status !== 403 && status !== 429 && status !== 503) return null;
  const cf = typeof headers['cf-ray'] === 'string' || /cloudflare/i.test(String(headers.server ?? ''));
  if (!cf) return null;
  if (String(headers['cf-mitigated'] ?? '').toLowerCase() === 'challenge') return 'CHALLENGE';
  return status === 429 ? 'RATE_LIMIT' : 'FIREWALL_BLOCK';
}

async function egressAddress(fetchImpl) {
  try {
    const response = await fetchImpl(EGRESS_IP_URL, { signal: AbortSignal.timeout(5000) });
    const ip = response.ok ? (await response.json())?.ip : null;
    return typeof ip === 'string' && /^[0-9a-f.:]{3,45}$/i.test(ip) ? ip : null;
  } catch { return null; }
}

export async function probeSsgePublicPage({ fetchImpl = fetch, now = () => Date.now(), egress = true } = {}) {
  const seen = { status: null, server: null, refusal: null, anonymousSession: null, publicTokenPresent: null, error: null, egressIp: null };
  const session = new PublicSession({ fetchImpl, now, onBootstrap: (info) => {
    seen.status = info.status ?? null;
    const headers = info.responseHeaders ?? {};
    seen.server = typeof headers.server === 'string' ? headers.server.slice(0, 40) : headers['cf-ray'] ? 'cloudflare' : null;
    seen.refusal = cloudflareRefusal(seen.status, headers);
    seen.anonymousSession = info.anonymousSession ?? null;
    seen.publicTokenPresent = info.publicTokenPresent ?? null;
  } });
  try { await session.token(); } catch (error) { seen.error = String(error?.message ?? error).slice(0, 120); }
  if (egress) seen.egressIp = await egressAddress(fetchImpl);
  return { ok: seen.error === null && seen.publicTokenPresent === true, ...seen, checkedAt: new Date(now()).toISOString() };
}
