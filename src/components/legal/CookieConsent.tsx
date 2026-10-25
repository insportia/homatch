import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Cookie } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';
import { onOpenCookieSettings, readConsent, saveConsent, type OptionalCategory } from '@/lib/consent/cookieConsent';

/*
 * The cookie banner and its settings, in one compact floating card.
 *
 * - Shown until a choice is stored for the current cookie-policy version;
 *   a returning visitor with a valid choice never sees it again.
 * - "Accept all" and "Reject optional" are the same size, weight and colour:
 *   refusing is exactly as easy as accepting, on both views.
 * - Optional categories start OFF; nothing is pre-ticked. Each switch is
 *   real — it is what hasConsent() returns to the code that sets storage.
 * - Non-modal: the page stays usable and nothing optional runs meanwhile.
 *   Escape on the settings view goes back to the summary, never dismisses.
 * - The footer's "Cookie settings" reopens it on the settings view.
 *
 * Not shown where a banner would sit on top of every capture: ?consent=skip
 * hides it anywhere, and the harness build (the browser test suites) hides
 * it unless a test asks for it with ?consent=show — the banner's own suite
 * is tests/mobile/legalCompliance.test.mjs.
 */
const HARNESS = import.meta.env.MODE === 'harness';
const OPTIONAL: { cat: OptionalCategory; label: TranslationKey; desc: TranslationKey }[] = [
  { cat: 'functional', label: 'cookie_cat_functional', desc: 'cookie_desc_functional' },
  { cat: 'analytics', label: 'cookie_cat_analytics', desc: 'cookie_desc_analytics' },
  { cat: 'marketing', label: 'cookie_cat_marketing', desc: 'cookie_desc_marketing' },
];
const NONE = { functional: false, analytics: false, marketing: false };
const ALL = { functional: true, analytics: true, marketing: true };

export function CookieConsent() {
  const { t, isRTL } = useLanguage();
  const { search } = useLocation();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [choice, setChoice] = useState<Record<OptionalCategory, boolean>>(NONE);
  const settingsTitle = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!readConsent()) setOpen(true);
    return onOpenCookieSettings(() => {
      const c = readConsent();
      setChoice(c ? { functional: c.functional, analytics: c.analytics, marketing: c.marketing } : NONE);
      setSettings(true);
      setOpen(true);
    });
  }, []);

  useEffect(() => { if (settings) settingsTitle.current?.focus(); }, [settings]);

  const param = new URLSearchParams(search).get('consent');
  if (!open || param === 'skip' || (HARNESS && param !== 'show')) return null;

  const decide = (c: Record<OptionalCategory, boolean>) => {
    saveConsent(c);
    setOpen(false);
    setSettings(false);
  };

  const btn = 'h-9 rounded-full px-4 text-[14px] font-semibold transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card';
  const primary = `${btn} bg-foreground text-background hover:bg-foreground/90`;
  const quiet = `${btn} border border-border text-foreground hover:bg-secondary`;

  return (
    <section
      role="region"
      aria-labelledby={settings ? 'cookie-settings-title' : 'cookie-consent-title'}
      dir={isRTL ? 'rtl' : 'ltr'}
      data-cookie-consent=""
      onKeyDown={(e) => { if (e.key === 'Escape' && settings) { e.stopPropagation(); setSettings(false); } }}
      className="fixed inset-x-4 bottom-4 z-[60] mx-auto max-w-[27rem] rounded-2xl border border-foreground/10 bg-card/95 p-4 text-card-foreground shadow-[0_18px_50px_-20px_rgba(0,0,0,0.35)] backdrop-blur-md sm:inset-x-auto sm:end-5 sm:bottom-5 sm:mx-0 sm:p-5 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-300 print:hidden"
    >
      {!settings ? (
        <>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gold-ink/25 bg-secondary">
              <Cookie className="h-4 w-4 text-gold-ink" aria-hidden="true" />
            </span>
            <div className="min-w-0 space-y-1.5">
              <h2 id="cookie-consent-title" className="text-[15px] font-semibold text-foreground">{t('cookie_banner_title')}</h2>
              <p className="text-[14px] leading-relaxed text-muted-foreground">
                {t('cookie_banner_body')}{' '}
                <Link to="/cookies" className="font-medium text-gold-ink underline-offset-2 hover:underline">{t('cookie_policy_link')}</Link>
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" className={quiet} onClick={() => setSettings(true)}>{t('cookie_btn_settings')}</button>
            <div className="ms-auto flex flex-wrap gap-2">
              <button type="button" className={primary} onClick={() => decide(NONE)}>{t('cookie_btn_reject')}</button>
              <button type="button" className={primary} onClick={() => decide(ALL)}>{t('cookie_btn_accept')}</button>
            </div>
          </div>
        </>
      ) : (
        <>
          <h2 id="cookie-settings-title" ref={settingsTitle} tabIndex={-1} className="text-[15px] font-semibold text-foreground focus:outline-none">
            {t('cookie_settings_title')}
          </h2>
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
            <li className="flex items-start justify-between gap-3 p-3">
              <div className="min-w-0">
                <p id="cc-necessary" className="text-[14px] font-medium text-foreground">{t('cookie_cat_necessary')}</p>
                <p className="text-[13px] leading-snug text-muted-foreground">{t('cookie_desc_necessary')}</p>
              </div>
              <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-[13px] font-medium text-gold-ink" data-always-active="">
                {t('cookie_always_active')}
              </span>
            </li>
            {OPTIONAL.map(({ cat, label, desc }) => (
              <li key={cat} className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p id={`cc-${cat}`} className="text-[14px] font-medium text-foreground">{t(label)}</p>
                  <p id={`cc-${cat}-d`} className="text-[13px] leading-snug text-muted-foreground">{t(desc)}</p>
                </div>
                <Switch
                  checked={choice[cat]}
                  onCheckedChange={(v) => setChoice((c) => ({ ...c, [cat]: v === true }))}
                  aria-labelledby={`cc-${cat}`}
                  aria-describedby={`cc-${cat}-d`}
                  data-consent-category={cat}
                  className="mt-0.5 shrink-0"
                />
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" className={quiet} onClick={() => decide(choice)}>{t('cookie_btn_save')}</button>
            <div className="ms-auto flex flex-wrap gap-2">
              <button type="button" className={primary} onClick={() => decide(NONE)}>{t('cookie_btn_reject')}</button>
              <button type="button" className={primary} onClick={() => decide(ALL)}>{t('cookie_btn_accept')}</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
