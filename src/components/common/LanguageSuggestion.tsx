import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { updateMyProfile } from '@/services/api';
import { bundleFor, english, loadLanguage } from '@/i18n/bundles';
import {
  LANG_SUGGESTION_KEY, mayLookUpCountry, shouldSuggest, suggestedLanguageForCountry,
} from '@/i18n/languagePreference';
import { RTL_LANGUAGES, type SupportedLanguage } from '@/types/types';

/**
 * A quiet, dismissible offer of another language, never a switch.
 *
 * Only for a visitor who reads Georgian because nothing better was known (no
 * pick, no saved account language, no browser language we support). After
 * the first paint, the coarse country from /api/geo (api/geo.ts) maps to a
 * likely language (languagePreference.ts). The offer is written IN that
 * language, so the person can read it. "No, thanks" (or closing it) is
 * remembered on this device; "Switch" is an explicit pick like the language
 * menu, saved to the account too when signed in.
 *
 * Every failure is silence: no /api/geo off Vercel, a VPN country, a slow
 * answer, a language chunk that will not load. Georgian stays.
 */
const GEO_TIMEOUT_MS = 3000;
const AFTER_PAINT_MS = 1500;

function readDismissed(): boolean {
  try { return window.localStorage.getItem(LANG_SUGGESTION_KEY) === 'dismissed'; } catch { return false; }
}
function rememberDismissed(): void {
  try { window.localStorage.setItem(LANG_SUGGESTION_KEY, 'dismissed'); } catch { /* the offer simply returns next visit */ }
}

async function fetchCountry(signal: AbortSignal): Promise<unknown> {
  const res = await fetch('/api/geo', { cache: 'no-store', credentials: 'omit', signal });
  /* Off Vercel the SPA answers this path with HTML; only JSON is an answer. */
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) return null;
  const body = (await res.json()) as { country?: unknown } | null;
  return body?.country ?? null;
}

export function LanguageSuggestion() {
  const { lang, langSource, setLang } = useLanguage();
  const { homatchUser } = useAuth();
  const asked = useRef(false);
  /* Read at click time, so a sign-in after the offer still saves the choice. */
  const userRef = useRef(homatchUser);
  userRef.current = homatchUser;

  useEffect(() => {
    if (asked.current || !mayLookUpCountry(langSource, readDismissed())) return;
    const controller = new AbortController();
    let live = true;

    const run = async () => {
      asked.current = true; // once per page load, whatever happens next
      const timer = window.setTimeout(() => controller.abort(), GEO_TIMEOUT_MS);
      let suggested: SupportedLanguage | null = null;
      try {
        suggested = suggestedLanguageForCountry(await fetchCountry(controller.signal));
      } catch {
        return;
      } finally {
        window.clearTimeout(timer);
      }
      if (!live || !shouldSuggest({ source: langSource, current: lang, suggested, dismissed: readDismissed() })) return;
      const target = suggested as SupportedLanguage;
      /* Loading it now also makes "Switch" instant. A failure reads English. */
      await loadLanguage(target).catch(() => undefined);
      if (!live) return;
      const words = (key: string) => bundleFor(target)?.[key] ?? english[key] ?? key;
      const dir = RTL_LANGUAGES.includes(target) ? 'rtl' : 'ltr';
      let switched = false;
      toast(<span lang={target} dir={dir} data-language-suggestion={target}>{words('lang_suggest_message')}</span>, {
        id: 'homatch-language-suggestion',
        duration: Infinity,
        action: {
          label: <span lang={target} dir={dir}>{words('lang_suggest_switch')}</span>,
          onClick: () => {
            switched = true;
            setLang(target);
            const user = userRef.current;
            if (user?.id && user.preferred_language !== target) void updateMyProfile(user.id, { preferred_language: target });
          },
        },
        cancel: {
          label: <span lang={target} dir={dir}>{words('lang_suggest_dismiss')}</span>,
          onClick: rememberDismissed,
        },
        onDismiss: () => { if (!switched) rememberDismissed(); },
      });
    };

    const start = window.setTimeout(() => { void run(); }, AFTER_PAINT_MS);
    return () => { live = false; window.clearTimeout(start); controller.abort(); };
    // Decided once, from the language the page first rendered in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* A pick made any other way (the language menu, a saved account language) retires the offer. */
  useEffect(() => {
    if (langSource !== 'default') toast.dismiss('homatch-language-suggestion');
  }, [langSource]);

  return null;
}
