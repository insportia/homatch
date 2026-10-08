import { URL } from 'node:url';
import { AcquisitionError } from './api.js';

// The anonymous statements API now returns 401. MyHome's ordinary public
// pages still expose the same envelopes in their server-rendered Next state.
// No cookies, authorization tokens, browser, or challenge recovery are used.
export function publicSearchUrl(apiUrl: string) {
  const input = new URL(apiUrl);
  if (input.origin !== 'https://api-statements.tnet.ge' || input.pathname !== '/v1/statements') throw new Error('Unexpected MyHome search endpoint');
  const url = new URL('https://www.myhome.ge/udzravi-qoneba/');
  url.search = input.search;
  return url.href;
}

export function parsePublicPage(html: string, url: string, statementId?: string): any {
  const fail = (message: string): never => { throw new AcquisitionError(url, 200, message); };
  if (html.length > 8_000_000) fail('Public page exceeds acquisition limit');
  const match = html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/);
  if (!match) fail('Public page has no structured Next data');
  let next: any;
  try { next = JSON.parse(match![1]); } catch { fail('Invalid public Next data'); }
  if (next.page !== '/[...slug]' || next.props?.pageProps?.locale !== 'ka') fail('Unexpected public page or locale');
  const queries = next.props?.pageProps?.dehydratedState?.queries;
  if (!Array.isArray(queries)) fail('Public page has no hydrated queries');
  const expected = new URL(url).searchParams;
  const matches = queries.filter((entry: any) => {
    const key = entry.queryKey;
    if (entry.state?.status !== 'success' || key?.[0] !== 'statements') return false;
    if (statementId) return key[1] === 'details' && key[2]?.locale === 'ka' && String(key[2]?.statementId) === statementId;
    if (key[1] !== 'list' || key[2]?.params?.locale !== 'ka') return false;
    const applied = key[2]?.query;
    if (!applied || typeof applied !== 'object') return false;
    // Reject homepage/cache/unfiltered or wrong-page responses, including lost
    // bracketed room, bedroom and status filters. Never accept HTTP 200 alone.
    return Object.keys(applied).length === [...expected.keys()].length &&
      [...expected].every(([name, value]) => String(applied[name]) === value);
  });
  if (matches.length !== 1) fail('Public page does not confirm the requested search or property');
  const payload = matches[0].state.data;
  if (payload?.result !== true || (statementId ? String(payload.data?.statement?.id) !== statementId : !Array.isArray(payload.data?.data))) fail('Invalid public listing envelope');
  return payload;
}

export async function publicPage(url: string, fetcher: typeof fetch = fetch, statementId?: string) {
  const input = new URL(url);
  if (input.origin !== 'https://www.myhome.ge' || !input.pathname.startsWith('/udzravi-qoneba/')) throw new Error('Unexpected public MyHome URL');
  let response: Response;
  try { response = await fetcher(url, {method:'GET', signal:AbortSignal.timeout(20000), headers:{Accept:'text/html'}}); }
  catch (error) {
    const e = error as Error & {cause?:{code?:string}};
    throw new AcquisitionError(url, null, `${e.message}${e.cause?.code ? ` (${e.cause.code})` : ''}`);
  }
  if (!response.ok) throw new AcquisitionError(url, response.status, `HTTP ${response.status}; request stopped`);
  const payload = parsePublicPage(await response.text(), url, statementId);
  return {url, status:response.status, payload};
}
