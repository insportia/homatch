/*
 * GET /api/geo -> {"country":"DE"} or {"country":null}
 *
 * The visitor's coarse country, for one purpose only: OFFERING a language to
 * someone who reads the Georgian default because their browser named nothing
 * we support (src/i18n/languagePreference.ts, LanguageSuggestion.tsx). It
 * never switches a language by itself.
 *
 * Returns the two-letter code Vercel's edge already derived
 * (x-vercel-ip-country) and nothing else: no IP address, no region, no city,
 * nothing stored, nothing logged. no-store, so a shared cache can never hand
 * one visitor's country to another. Off Vercel (vite dev/preview) this file
 * does not run and the client treats the missing answer as "no suggestion".
 */
export const config = { runtime: 'edge' };

export default function handler(request: Request): Response {
  const raw = request.headers.get('x-vercel-ip-country') ?? '';
  const code = raw.trim().toUpperCase();
  const country = /^[A-Z]{2}$/.test(code) && code !== 'XX' ? code : null;
  return new Response(JSON.stringify({ country }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'x-robots-tag': 'noindex',
      vary: 'x-vercel-ip-country',
    },
  });
}
