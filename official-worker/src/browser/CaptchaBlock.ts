// CaptchaBlock.ts — server-side CAPTCHA rejection detection.
//
// Deliberately a module of its own, with NO Playwright import, so the
// decision is a pure function over text and is unit-testable without a
// browser. BrowserSession.ts wraps it with the frame-reading part.
//
// WHY THIS EXISTS
// ---------------
// A datacenter IP is not a viable place to complete a Google reCAPTCHA. Real
// production testing returned Google's automated-query rejection rather than
// a solvable challenge — meaning the customer could be parked on a challenge
// that CANNOT be completed from the server, no matter how many times it is
// reloaded.
//
// When one of these appears, the correct action is to stop re-prompting and
// end that source. It is a statement about where the request came from, never
// about the property: a blocked source is NOT risk, NOT a confirmed negative,
// and must never influence the verdict (NO EVIDENCE = NO FACT).

/** Network/reputation rejections — NOT ordinary solvable challenges. */
const CAPTCHA_BLOCK_PATTERNS: readonly RegExp[] = [
  /automated queries/i,
  /unusual traffic/i,
  /your computer or network may be sending automated/i,
  /try again later/i,
  /can'?t process your request right now/i,
  /cannot process your request right now/i,
  /rate limit(ed)?|too many requests/i,
  /access denied|forbidden by security policy/i,
  /ავტომატური მოთხოვნ/i,
  /სცადეთ მოგვიანებით/i,
];

/**
 * True when page text shows the ENVIRONMENT was rejected, rather than an
 * ordinary challenge waiting for a human.
 *
 * Kept deliberately narrow: a false positive here would end a source the
 * customer could actually have completed, so ordinary challenge wording
 * ("I am not a robot", tile-selection prompts) must never match.
 */
export function isCaptchaNetworkBlocked(text: unknown): boolean {
  const t = String(text ?? '');
  if (!t.trim()) return false;
  return CAPTCHA_BLOCK_PATTERNS.some((re) => re.test(t));
}
