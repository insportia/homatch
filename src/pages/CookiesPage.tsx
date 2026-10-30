import type { ReactNode } from 'react';
import { LegalLayout, LegalList, type LegalSection } from '@/components/legal/LegalLayout';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';
import { openCookieSettings } from '@/lib/consent/cookieConsent';
import { listsStripeCookies } from '@/lib/legal/operator';
import { useLegalEdition } from '@/lib/legal/useLegalEdition';

/*
 * THE INVENTORY IS WHAT THE CODE ACTUALLY STORES, NOT A TEMPLATE.
 *
 * Every row was read from source (2026-10-25): the Supabase session key,
 * src/lib/consent/cookieConsent.ts, LanguageContext, anonymousSession,
 * returnTo/pending-intent keys, the service worker, the sidebar cookie
 * (functional, consent-gated in components/ui/sidebar.tsx) and the PWA funnel
 * in src/lib/engagement.ts (analytics, consent-gated). No Meta Pixel, GA or
 * GTM is loaded. Third-party rows are set on the provider's own pages or only
 * after the visitor presses play. Add a row here in the same PR as any new
 * storage or script.
 */
type Cat = 'necessary' | 'functional' | 'analytics' | 'marketing';
type Consent = 'not_required' | 'required' | 'on_action';
const INVENTORY: { name: string; provider: string; cat: Cat; third: boolean; consent: Consent; purpose: TranslationKey; duration: TranslationKey }[] = [
  { name: 'sb-…-auth-token', provider: 'HOMATCH (Supabase Auth)', cat: 'necessary', third: false, consent: 'not_required', purpose: 'cookie_inv_session', duration: 'cookie_dur_signout' },
  { name: 'homatch_cookie_consent', provider: 'HOMATCH', cat: 'necessary', third: false, consent: 'not_required', purpose: 'cookie_inv_consent', duration: 'cookie_dur_until_changed' },
  { name: 'homatch_lang', provider: 'HOMATCH', cat: 'necessary', third: false, consent: 'not_required', purpose: 'cookie_inv_lang', duration: 'cookie_dur_until_cleared' },
  { name: 'homatch.anon.session', provider: 'HOMATCH', cat: 'necessary', third: false, consent: 'not_required', purpose: 'cookie_inv_anon', duration: 'cookie_dur_until_signin' },
  { name: 'homatch_return_to, homatch_pending_*, homatch_policy_preaccept', provider: 'HOMATCH', cat: 'necessary', third: false, consent: 'not_required', purpose: 'cookie_inv_return', duration: 'cookie_dur_session' },
  { name: 'Service worker cache', provider: 'HOMATCH', cat: 'necessary', third: false, consent: 'not_required', purpose: 'cookie_inv_sw', duration: 'cookie_dur_until_updated' },
  { name: 'sidebar_state', provider: 'HOMATCH', cat: 'functional', third: false, consent: 'required', purpose: 'cookie_inv_sidebar', duration: 'cookie_dur_7d' },
  { name: 'homatch_telemetry_id, homatch_standalone_seen', provider: 'HOMATCH', cat: 'analytics', third: false, consent: 'required', purpose: 'cookie_inv_pwa', duration: 'cookie_dur_until_withdrawn' },
  { name: 'Google sign-in', provider: 'Google', cat: 'necessary', third: true, consent: 'on_action', purpose: 'cookie_inv_google', duration: 'cookie_dur_provider' },
  { name: 'Stripe Checkout', provider: 'Stripe', cat: 'necessary', third: true, consent: 'on_action', purpose: 'cookie_inv_stripe', duration: 'cookie_dur_provider' },
  { name: 'YouTube / Vimeo', provider: 'Google (YouTube), Vimeo', cat: 'marketing', third: true, consent: 'on_action', purpose: 'cookie_inv_video', duration: 'cookie_dur_provider' },
];

const CAT_LABEL: Record<Cat, TranslationKey> = {
  necessary: 'cookie_cat_necessary', functional: 'cookie_cat_functional', analytics: 'cookie_cat_analytics', marketing: 'cookie_cat_marketing',
};
const CONSENT_LABEL: Record<Consent, TranslationKey> = {
  not_required: 'cookie_consent_not_required', required: 'cookie_consent_required', on_action: 'cookie_consent_on_action',
};

export default function CookiesPage() {
  const { t } = useLanguage();
  /* 2026-10-30: no payment provider is connected and Stripe is not used, so its checkout cookies are
     no longer listed. Earlier editions (?version=2026-10-29, 2026-10-25) still show them as published. */
  const stripe = listsStripeCookies(useLegalEdition('cookies'));
  const rows = INVENTORY.filter((r) => stripe || r.provider !== 'Stripe');

  const cols: { key: TranslationKey; cell: (r: typeof INVENTORY[number]) => ReactNode }[] = [
    { key: 'cookie_col_provider', cell: (r) => r.provider },
    { key: 'cookie_col_category', cell: (r) => t(CAT_LABEL[r.cat]) },
    { key: 'cookie_col_purpose', cell: (r) => t(r.purpose) },
    { key: 'cookie_col_duration', cell: (r) => t(r.duration) },
    { key: 'cookie_col_party', cell: (r) => t(r.third ? 'cookie_party_third' : 'cookie_party_first') },
    { key: 'cookie_col_consent', cell: (r) => t(CONSENT_LABEL[r.consent]) },
  ];

  const inventory = (
    <>
      {/* Phones: one card per entry. */}
      <ul className="space-y-3 md:hidden">
        {rows.map((r) => (
          <li key={r.name} className="rounded-[0.9rem] border border-border bg-card p-3.5">
            <p className="font-mono text-2xs text-foreground break-all" dir="ltr">{r.name}</p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[14px]">
              {cols.map((c) => (
                <div key={c.key} className="contents"><dt className="text-muted-foreground/80">{t(c.key)}</dt><dd className="text-foreground">{c.cell(r)}</dd></div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
      {/* Tablet and up: the table. */}
      <div className="hidden overflow-x-auto rounded-[0.9rem] border border-border md:block print:block">
        <table className="w-full text-[13px]">
          <thead className="bg-secondary/60 text-foreground">
            <tr>
              <th scope="col" className="p-2.5 text-start font-semibold">{t('cookie_col_name')}</th>
              {cols.map((c) => <th key={c.key} scope="col" className="p-2.5 text-start font-semibold">{t(c.key)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-t border-border align-top">
                <td className="p-2.5 font-mono text-2xs text-foreground break-all" dir="ltr">{r.name}</td>
                {cols.map((c) => <td key={c.key} className="p-2.5">{c.cell(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>{t('cookie_s_inventory_note')}</p>
    </>
  );

  const sections: LegalSection[] = [
    { id: 'what', title: t('cookie_what_title'), content: <><p>{t('cookie_what_p1')}</p><p>{t('cookie_what_p2')}</p></> },
    { id: 'necessary', title: t('cookie_s_necessary_title'), content: <p>{t('cookie_s_necessary_body')}</p> },
    { id: 'functional', title: t('cookie_s_functional_title'), content: <><p>{t('cookie_s_functional_body')}</p><p>{t('cookie_s_functional_current')}</p></> },
    { id: 'analytics', title: t('cookie_s_analytics_title'), content: <p>{t('cookie_s_analytics_body')}</p> },
    { id: 'marketing', title: t('cookie_s_marketing_title'), content: <><p>{t('cookie_s_marketing_body')}</p><p><strong>{t('cookie_s_marketing_current')}</strong></p></> },
    { id: 'inventory', title: t('cookie_s_inventory_title'), content: inventory },
    {
      id: 'choices', title: t('cookie_s_choices_title'), content: <>
        <p>{t('cookie_s_choices_body')}</p>
        <button
          type="button"
          onClick={openCookieSettings}
          className="mt-1 inline-flex h-9 items-center rounded-full border border-border bg-card px-4 text-[14px] font-semibold text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring print:hidden"
        >
          {t('home_footer_cookie_settings')}
        </button>
      </>,
    },
    {
      id: 'third-party', title: t('cookie_s_third_title'), content: <>
        <p>{t('cookie_s_third_body')}</p>
        <LegalList items={[t('cookie_third_google'), t('cookie_third_fonts'), ...(stripe ? [t('cookie_third_stripe')] : []), t('cookie_third_sentry'), t('cookie_third_video')]} />
      </>,
    },
    { id: 'updates', title: t('cookie_s_updates_title'), content: <p>{t('cookie_s_updates_body')}</p> },
  ];

  return <LegalLayout doc="cookies" title={t('cookie_policy_title')} intro={<p>{t('cookie_policy_intro')}</p>} sections={sections} />;
}
