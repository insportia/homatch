import React from 'react';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { PublicHeader, HeaderSpacer } from '@/components/home/PublicHeader';
import { usePublicNavLinks } from '@/site/publicNav';
import { SiteFooter } from '@/components/home/sections/SiteFooter';
import { PAGE } from '@/components/home/sections/primitives';
import { Cookie } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';
import { openCookieSettings } from '@/lib/consent/cookieConsent';

const LAST_UPDATED = 'October 25, 2026';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <div className="text-sm text-muted-foreground leading-relaxed space-y-2">{children}</div>
    </section>
  );
}

/*
 * THE INVENTORY IS WHAT THE CODE ACTUALLY STORES, NOT A TEMPLATE.
 *
 * Every row was read from source (2026-10-25): the Supabase session key,
 * src/lib/consent/cookieConsent.ts, LanguageContext, anonymousSession,
 * the sidebar cookie, returnTo/pending-intent session keys, the service
 * worker, and the PWA funnel in src/lib/engagement.ts (the only optional
 * storage, gated on analytics consent). No marketing cookie or advertising
 * pixel is loaded today. Add a row here in the same PR as any new storage.
 */
const INVENTORY: { name: string; cat: 'necessary' | 'analytics'; purpose: TranslationKey; duration: TranslationKey }[] = [
  { name: 'sb-…-auth-token', cat: 'necessary', purpose: 'cookie_inv_session', duration: 'cookie_dur_signout' },
  { name: 'homatch_cookie_consent', cat: 'necessary', purpose: 'cookie_inv_consent', duration: 'cookie_dur_until_changed' },
  { name: 'homatch_lang', cat: 'necessary', purpose: 'cookie_inv_lang', duration: 'cookie_dur_until_cleared' },
  { name: 'homatch.anon.session', cat: 'necessary', purpose: 'cookie_inv_anon', duration: 'cookie_dur_until_signin' },
  { name: 'sidebar_state', cat: 'necessary', purpose: 'cookie_inv_sidebar', duration: 'cookie_dur_7d' },
  { name: 'homatch_return_to, homatch_pending_*', cat: 'necessary', purpose: 'cookie_inv_return', duration: 'cookie_dur_until_signin' },
  { name: 'Service worker cache', cat: 'necessary', purpose: 'cookie_inv_sw', duration: 'cookie_dur_until_updated' },
  { name: 'homatch_telemetry_id, homatch_standalone_seen', cat: 'analytics', purpose: 'cookie_inv_pwa', duration: 'cookie_dur_until_withdrawn' },
];

export default function CookiesPage() {
  useSurfaceTheme('light');
  const { t } = useLanguage();
  const headerLinks = usePublicNavLinks();

  return (
    <div className="hm-public min-h-screen bg-background text-foreground flex flex-col">
      <PublicHeader links={headerLinks} solid />
      <HeaderSpacer />

      <main className={`flex-1 ${PAGE} py-14 sm:py-20`}>
        <div className="max-w-[48rem] space-y-10">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-foreground/20 bg-secondary">
              <Cookie className="h-3.5 w-3.5 text-gold-ink" />
              <span className="text-[14px] font-semibold uppercase tracking-[0.16em] text-gold-ink">{t('cookie_policy_badge')}</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-semibold text-foreground text-balance">{t('cookie_policy_title')}</h1>
            <p className="text-sm text-muted-foreground">{t('privacy_last_updated', { date: LAST_UPDATED })}</p>
            <p className="text-sm text-muted-foreground leading-relaxed">{t('cookie_policy_intro')}</p>
          </div>

          <div className="w-full h-px bg-border/50" />

          <Section title={t('cookie_s_necessary_title')}><p>{t('cookie_s_necessary_body')}</p></Section>
          <Section title={t('cookie_s_analytics_title')}><p>{t('cookie_s_analytics_body')}</p></Section>
          <Section title={t('cookie_s_marketing_title')}>
            <p>{t('cookie_s_marketing_body')}</p>
            <p>{t('cookie_s_marketing_current')}</p>
          </Section>

          <Section title={t('cookie_s_inventory_title')}>
            <div className="overflow-x-auto rounded-[0.9rem] border border-border">
              <table className="w-full text-xs">
                <thead className="bg-secondary/60 text-foreground">
                  <tr>
                    <th scope="col" className="p-2.5 text-start font-semibold">{t('cookie_col_name')}</th>
                    <th scope="col" className="p-2.5 text-start font-semibold">{t('cookie_col_category')}</th>
                    <th scope="col" className="p-2.5 text-start font-semibold">{t('cookie_col_purpose')}</th>
                    <th scope="col" className="p-2.5 text-start font-semibold">{t('cookie_col_duration')}</th>
                  </tr>
                </thead>
                <tbody>
                  {INVENTORY.map((row) => (
                    <tr key={row.name} className="border-t border-border align-top">
                      <td className="p-2.5 font-mono text-2xs text-foreground break-all" dir="ltr">{row.name}</td>
                      <td className="p-2.5">{row.cat === 'necessary' ? t('cookie_cat_necessary_short') : t('cookie_cat_analytics')}</td>
                      <td className="p-2.5">{t(row.purpose)}</td>
                      <td className="p-2.5">{t(row.duration)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>{t('cookie_s_inventory_note')}</p>
          </Section>

          <Section title={t('cookie_s_choices_title')}>
            <p>{t('cookie_s_choices_body')}</p>
            <button
              type="button"
              onClick={openCookieSettings}
              className="mt-1 inline-flex h-9 items-center rounded-full border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-secondary"
            >
              {t('home_footer_cookie_settings')}
            </button>
          </Section>

          <Section title={t('cookie_s_third_title')}>
            <p>{t('cookie_s_third_body')}</p>
            <ul className="list-disc list-inside space-y-1.5">
              <li>{t('cookie_third_google')}</li>
              <li>{t('cookie_third_fonts')}</li>
              <li>{t('cookie_third_stripe')}</li>
              <li>{t('cookie_third_sentry')}</li>
              <li>{t('cookie_third_video')}</li>
            </ul>
          </Section>

          <Section title={t('cookie_s_updates_title')}><p>{t('cookie_s_updates_body')}</p></Section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
