import { COOKIE_POLICY_VERSION } from '@/lib/legal/policies';

/*
 * COOKIE CONSENT — the one place optional storage asks permission.
 *
 * Necessary storage (session, language, this choice itself) needs no consent
 * and is not modelled as a toggle. Analytics and marketing default to OFF and
 * stay off until the visitor turns them on: anything that would set optional
 * storage or load an optional script calls hasConsent() first, and anything
 * that loads late subscribes with onConsentChange().
 *
 * A stored choice made under an older cookie-policy version is treated as no
 * choice, so the banner returns after a material change to the policy.
 */
export type OptionalCategory = 'analytics' | 'marketing';

export interface CookieConsent {
  necessary: true;
  analytics: boolean;
  marketing: boolean;
  version: string;
  decidedAt: string;
}

const STORAGE_KEY = 'homatch_cookie_consent';
const CHANGE_EVENT = 'homatch:cookie-consent';
const OPEN_EVENT = 'homatch:cookie-settings';

export function readConsent(): CookieConsent | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<CookieConsent>;
    if (v.version !== COOKIE_POLICY_VERSION) return null;
    return {
      necessary: true,
      analytics: v.analytics === true,
      marketing: v.marketing === true,
      version: v.version,
      decidedAt: String(v.decidedAt ?? ''),
    };
  } catch {
    return null;
  }
}

export function hasConsent(category: OptionalCategory): boolean {
  return readConsent()?.[category] === true;
}

export function saveConsent(choice: { analytics: boolean; marketing: boolean }): CookieConsent {
  const consent: CookieConsent = {
    necessary: true,
    analytics: choice.analytics === true,
    marketing: choice.marketing === true,
    version: COOKIE_POLICY_VERSION,
    decidedAt: new Date().toISOString(),
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(consent)); } catch { /* storage unavailable: applies to this view only */ }
  // Withdrawal: drop what an optional category had stored.
  if (!consent.analytics) {
    try {
      localStorage.removeItem('homatch_telemetry_id');
      localStorage.removeItem('homatch_standalone_seen');
    } catch { /* storage unavailable */ }
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: consent }));
  return consent;
}

export function onConsentChange(fn: (c: CookieConsent) => void): () => void {
  const handler = (e: Event) => fn((e as CustomEvent<CookieConsent>).detail);
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

/** The footer's "Cookie settings" link. */
export function openCookieSettings(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function onOpenCookieSettings(fn: () => void): () => void {
  window.addEventListener(OPEN_EVENT, fn);
  return () => window.removeEventListener(OPEN_EVENT, fn);
}
