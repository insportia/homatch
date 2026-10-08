import {URL} from 'node:url';
export type JsonObject = Record<string, unknown>;
export type HttpOptions = {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  locale?: 'ka-ge' | 'en-us';
  headers?: Record<string, string>;
};
export class ApiError extends Error {
  status: number | null;
  kind: 'http' | 'timeout' | 'network' | 'malformed' | 'captcha' | 'access-denied';
  constructor(kind: ApiError['kind'], status: number | null = null) {
    super(`Public API request failed (${kind}${status === null ? '' : `, HTTP ${status}`})`);
    this.kind = kind;
    this.status = status;
  }
}
// Diagnostic recognition only; no undocumented status code means CAPTCHA.
export function isExplicitCaptchaError(value: unknown): boolean {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return typeof s === 'string' && /(?:(?:re)?captcha)[\s_:-]*(?:required|invalid|failed|missing|expired)|(?:required|invalid|failed|missing|expired)[\s_:-]*(?:(?:re)?captcha)/i.test(s);
}
export function isAccessDeniedHtml(text: string): boolean {
  return /<title\b[^>]*>\s*Access Denied\s*<\/title>/i.test(text) && /requested resource could not be accessed/i.test(text);
}
export function publicUrl(value: string, base = 'https://www.my.gov.ge/'): URL {
  const url = new URL(value, base);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || !/^([a-z0-9-]+\.)*gov\.ge$/i.test(url.hostname)) {
    throw new Error('Expected an official public HTTPS government URL');
  }
  for (const key of url.searchParams.keys()) {
    if (/token|captcha|session|auth|credential/i.test(key)) throw new Error('Credential-bearing URL requires separate contract inspection');
  }
  return url;
}
// Preserve the SPA navigation URL separately; fragments are not sent over HTTP.
export function spaDocumentRequest(value: string, base = 'https://www.my.gov.ge/') {
  const browserUrl = new URL(value, base);
  const route = browserUrl.hash;
  const target = new URL(browserUrl);
  target.hash = '';
  return { browserUrl: browserUrl.href, route, httpUrl: publicUrl(target.href) };
}
export async function getJson(url: string | URL, options: HttpOptions = {}): Promise<unknown> {
  const endpoint = publicUrl(String(url));
  const retries = options.retries ?? 1;
  if (!Number.isInteger(retries) || retries < 0 || retries > 3) throw new Error('retries must be 0..3');
  const timeoutMs = options.timeoutMs ?? 15000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('timeoutMs must be positive');
  const fetcher = options.fetch ?? globalThis.fetch;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(endpoint.href, {
        method: 'GET', redirect: 'error', credentials: 'omit', signal: controller.signal,
        headers: options.headers ?? { 'Accept': 'application/json, text/plain, */*', 'Content-Type': 'application/json', 'Content-Language': options.locale ?? 'ka-ge', 'DeviceTypeId': '2', 'responseType': '3' }
      });
      const text = await response.text();
      if (isAccessDeniedHtml(text)) throw new ApiError('access-denied', response.status);
      if (!response.ok) {
        if ([429, 502, 503, 504].includes(response.status) && attempt < retries) {
          clearTimeout(timer);
          await new Promise(r => setTimeout(r, options.retryDelayMs ?? 250));
          continue;
        }
        throw new ApiError(isExplicitCaptchaError(text) ? 'captcha' : 'http', response.status);
      }
      try { return JSON.parse(text); } catch { throw new ApiError('malformed', response.status); }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(controller.signal.aborted ? 'timeout' : 'network');
    } finally { clearTimeout(timer); }
  }
  throw new ApiError('network');
}
