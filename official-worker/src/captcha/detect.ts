// detect.ts — is there actually a CAPTCHA, and which one?
//
// Credits are spent only for a challenge that is present AND supported.
// Absent → NONE (nothing to solve; a failure is something else: a changed
// page, an error, a genuine empty result). A challenge of another kind is
// reported as such, never solved with the wrong method.

export type ChallengeType = 'NONE' | 'RECAPTCHA_V2' | 'RECAPTCHA_V2_INVISIBLE' | 'RECAPTCHA_V3' | 'RECAPTCHA_ENTERPRISE' | 'HCAPTCHA' | 'TURNSTILE' | 'UNKNOWN';

export interface DetectedChallenge {
  present: boolean;
  type: ChallengeType;
  siteKey: string | null;
  /** Solvable by this integration (reCAPTCHA v2, incl. invisible / Enterprise v2). */
  supported: boolean;
}

const SITEKEY = /^6L[0-9A-Za-z_-]{38}$/;
const SITEKEY_IN_TEXT = /['"](6L[0-9A-Za-z_-]{38})['"]/;

export const NO_CHALLENGE: DetectedChallenge = { present: false, type: 'NONE', siteKey: null, supported: false };

/** Classify a page or script body. Pure. */
export function detectChallengeInHtml(html: string): DetectedChallenge {
  const h = String(html ?? '');
  if (/hcaptcha\.com\/1\/api\.js|class=["'][^"']*h-captcha/i.test(h)) return { present: true, type: 'HCAPTCHA', siteKey: null, supported: false };
  if (/challenges\.cloudflare\.com\/turnstile|class=["'][^"']*cf-turnstile/i.test(h)) return { present: true, type: 'TURNSTILE', siteKey: null, supported: false };
  const hasRecaptcha = /google\.com\/recaptcha|gstatic\.com\/recaptcha|recaptcha\.net\/recaptcha|g-recaptcha|grecaptcha/i.test(h);
  if (!hasRecaptcha) return NO_CHALLENGE;
  const attr = /data-sitekey=["']([0-9A-Za-z_-]{20,64})["']/i.exec(h)?.[1] ?? null;
  const render = /recaptcha\/(?:api|enterprise)\.js\?[^"']*render=([0-9A-Za-z_-]{20,64})/i.exec(h)?.[1] ?? null;
  const inText = SITEKEY_IN_TEXT.exec(h)?.[1] ?? null;
  const siteKey = attr ?? (render && render !== 'explicit' ? render : null) ?? inText;
  const enterprise = /recaptcha\/enterprise\.js|grecaptcha\.enterprise/i.test(h);
  // v3: rendered with a site key and driven by execute(action) — no widget.
  const v3 = !!render && render !== 'explicit' && /grecaptcha(?:\.enterprise)?\.execute\s*\(/.test(h) && !/data-sitekey=/i.test(h);
  if (v3) return { present: true, type: 'RECAPTCHA_V3', siteKey, supported: false };
  const invisible = /data-size=["']invisible["']|size\s*:\s*["']invisible["']/i.test(h);
  const type: ChallengeType = enterprise ? 'RECAPTCHA_ENTERPRISE' : invisible ? 'RECAPTCHA_V2_INVISIBLE' : 'RECAPTCHA_V2';
  return { present: true, type, siteKey: siteKey && SITEKEY.test(siteKey) ? siteKey : siteKey, supported: !!siteKey };
}

/**
 * NAPR's public viewer is a single-page app: the site key lives in its HTML
 * or one of its own scripts. Only same-origin scripts are read, at most four.
 * A configured override (NAPR_RECAPTCHA_SITEKEY) wins.
 */
export async function discoverSiteKey(pageUrl: string, fetcher: typeof fetch, override?: string | null): Promise<DetectedChallenge> {
  if (override && /^[0-9A-Za-z_-]{20,64}$/.test(override)) return { present: true, type: 'RECAPTCHA_V2', siteKey: override, supported: true };
  const originOf = (u: string) => /^(https?:\/\/[^/?#]+)/i.exec(u)?.[1]?.toLowerCase() ?? '';
  const origin = originOf(pageUrl);
  const base = pageUrl.split('#')[0];
  const res = await fetcher(base, { redirect: 'follow' });
  if (!res.ok) return NO_CHALLENGE;
  const html = await res.text();
  const first = detectChallengeInHtml(html);
  if (first.present && first.siteKey) return first;
  const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)]
    .map((m) => new URL(m[1], base).toString())
    .filter((u) => originOf(u) === origin)
    .slice(0, 4);
  let found: DetectedChallenge = first;
  for (const u of scripts) {
    const r = await fetcher(u, { redirect: 'follow' });
    if (!r.ok) continue;
    const body = (await r.text()).slice(0, 4_000_000);
    const d = detectChallengeInHtml(body);
    if (d.present && d.siteKey) return d;
    if (d.present && !found.present) found = d;
  }
  return found;
}
