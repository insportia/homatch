import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Cookie } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useLanguage } from '@/contexts/LanguageContext';
import { onOpenCookieSettings, readConsent, saveConsent } from '@/lib/consent/cookieConsent';

/*
 * The cookie banner and its settings, in one compact card.
 *
 * - Shown until a choice is stored for the current cookie-policy version.
 * - "Accept all" and "Reject optional" are the same size, weight and colour:
 *   refusing is exactly as easy as accepting.
 * - Optional categories start OFF in settings; nothing is pre-ticked.
 * - Non-modal: the page stays usable and nothing optional runs meanwhile.
 * - The footer's "Cookie settings" reopens it, to change or withdraw.
 *
 * Not shown where a banner would sit on top of every capture: ?consent=skip
 * hides it anywhere, and the harness build (the browser test suites) hides
 * it unless a test asks for it with ?consent=show — the banner's own suite
 * is tests/mobile/legalCompliance.test.mjs.
 */
const HARNESS = import.meta.env.MODE === 'harness';
export function CookieConsent() {
  const { t, isRTL } = useLanguage();
  const { search } = useLocation();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    if (!readConsent()) setOpen(true);
    return onOpenCookieSettings(() => {
      const c = readConsent();
      setAnalytics(c?.analytics ?? false);
      setMarketing(c?.marketing ?? false);
      setSettings(true);
      setOpen(true);
    });
  }, []);

  const param = new URLSearchParams(search).get('consent');
  if (!open || param === 'skip' || (HARNESS && param !== 'show')) return null;

  const decide = (choice: { analytics: boolean; marketing: boolean }) => {
    saveConsent(choice);
    setOpen(false);
    setSettings(false);
  };

  const btn = 'h-9 rounded-full px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const primary = `${btn} bg-foreground text-background hover:bg-foreground/90`;
  const quiet = `${btn} text-foreground underline-offset-4 hover:underline`;

  return (
    <section
      role="region"
      aria-labelledby="cookie-consent-title"
      dir={isRTL ? 'rtl' : 'ltr'}
      data-cookie-consent=""
      className="fixed inset-x-4 bottom-4 z-[60] mx-auto max-w-[26rem] rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-2xl sm:inset-x-auto sm:end-4 sm:mx-0"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary">
          <Cookie className="h-4 w-4 text-gold-ink" aria-hidden="true" />
        </span>
        <div className="min-w-0 space-y-1">
          <h2 id="cookie-consent-title" className="text-sm font-semibold text-foreground">{t('cookie_banner_title')}</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t('cookie_banner_body')}{' '}
            <Link to="/cookies" className="font-medium text-gold-ink hover:text-foreground">{t('cookie_policy_link')}</Link>
          </p>
        </div>
      </div>

      {settings && (
        <ul className="mt-4 space-y-2 border-t border-border pt-3 text-sm">
          <li className="flex items-center justify-between gap-3">
            <span id="cc-necessary" className="text-foreground">{t('cookie_cat_necessary')}</span>
            <Switch checked disabled aria-labelledby="cc-necessary" />
          </li>
          <li className="flex items-center justify-between gap-3">
            <span id="cc-analytics" className="text-foreground">{t('cookie_cat_analytics')}</span>
            <Switch checked={analytics} onCheckedChange={setAnalytics} aria-labelledby="cc-analytics" />
          </li>
          <li className="flex items-center justify-between gap-3">
            <span id="cc-marketing" className="text-foreground">{t('cookie_cat_marketing')}</span>
            <Switch checked={marketing} onCheckedChange={setMarketing} aria-labelledby="cc-marketing" />
          </li>
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {settings ? (
          <button type="button" className={primary} onClick={() => decide({ analytics, marketing })}>
            {t('cookie_btn_save')}
          </button>
        ) : (
          <button type="button" className={quiet} onClick={() => setSettings(true)}>
            {t('cookie_btn_settings')}
          </button>
        )}
        <div className="ms-auto flex flex-wrap gap-2">
          <button type="button" className={primary} onClick={() => decide({ analytics: false, marketing: false })}>
            {t('cookie_btn_reject')}
          </button>
          <button type="button" className={primary} onClick={() => decide({ analytics: true, marketing: true })}>
            {t('cookie_btn_accept')}
          </button>
        </div>
      </div>
    </section>
  );
}
