// HOMATCH — the public front door of an authenticated product.
//
// /for-buyers   Find Property: describe what you want, get a search plan
// /for-owners   My property: find a buyer or tenant
//
// WHY THESE PAGES EXIST
//
// The navigation's two most important links used to point at `/ai` and
// `/property/add`. Signed out, the first opened an anonymous chat that is not
// Find Property at all, and the second bounced to the login form with no word
// about what was behind it. Both products genuinely need an account — each
// writes rows that belong to one — so the answer is not to open them up, it is
// to put an honest page in front of them: what the product does, what it
// needs, and one button that goes through sign-up and comes out AT the
// product rather than on the dashboard.
//
// A signed-in visitor who lands here (from a shared link, say) is not asked to
// sign up: the same button opens the product.

import React from 'react';
import { Link } from 'react-router-dom';
import { Globe2, Landmark, ShieldCheck, TrendingUp, Users } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { PublicHeader, HeaderSpacer } from '@/components/home/PublicHeader';
import { SiteFooter } from '@/components/home/sections/SiteFooter';
import { PAGE } from '@/components/home/sections/primitives';
import { MatchPreview, PubButton, PubEyebrow, PubSteps, SearchPlanPreview } from '@/components/home/publicUi';
import { usePublicNavLinks } from '@/site/publicNav';
import { PRODUCT_ENTRIES, useProductNavigation, type ProductKey } from '@/site/productEntry';
import type { TranslationKey } from '@/i18n/translations';
import PageMeta from '@/components/common/PageMeta';

interface EntryCopy {
  eyebrow: TranslationKey;
  title: TranslationKey;
  lead: TranslationKey;
  steps: [TranslationKey, TranslationKey][];
  needs: TranslationKey;
  cta: TranslationKey;
  ctaSignedIn: TranslationKey;
  related: { to: string; label: TranslationKey; body: TranslationKey; icon: React.ComponentType<{ className?: string; strokeWidth?: number }> }[];
}

const COPY: Record<ProductKey, EntryCopy> = {
  find_property: {
    eyebrow: 'pub_buyer_eyebrow',
    title: 'pub_buyer_title',
    lead: 'pub_buyer_lead',
    steps: [
      ['pub_buyer_step1_t', 'pub_buyer_step1_d'],
      ['pub_buyer_step2_t', 'pub_buyer_step2_d'],
      ['pub_buyer_step3_t', 'pub_buyer_step3_d'],
    ],
    needs: 'pub_buyer_needs',
    cta: 'pub_entry_signup',
    ctaSignedIn: 'pub_buyer_open',
    related: [
      { to: '/verify', label: 'nav_verify', body: 'pub_navd_verify', icon: ShieldCheck },
      { to: '/mortgage', label: 'nav_mortgage', body: 'pub_navd_mortgage', icon: Landmark },
      { to: '/for-expats/georgia', label: 'nav_for_expats', body: 'pub_navd_expat', icon: Globe2 },
    ],
  },
  find_client: {
    eyebrow: 'pub_owner_eyebrow',
    title: 'pub_owner_title',
    lead: 'pub_owner_lead',
    steps: [
      ['pub_owner_step1_t', 'pub_owner_step1_d'],
      ['pub_owner_step2_t', 'pub_owner_step2_d'],
      ['pub_owner_step3_t', 'pub_owner_step3_d'],
    ],
    needs: 'pub_owner_needs',
    cta: 'pub_entry_signup',
    ctaSignedIn: 'pub_owner_open',
    related: [
      { to: '/verify', label: 'nav_verify', body: 'pub_navd_verify', icon: ShieldCheck },
      { to: '/investment', label: 'nav_investment', body: 'pub_navd_investment', icon: TrendingUp },
      { to: '/brokers', label: 'pub_nav_brokers', body: 'pub_navd_brokers', icon: Users },
    ],
  },
};

export default function ProductEntryPage({ product }: { product: ProductKey }) {
  useSurfaceTheme('light');
  const { t } = useLanguage();
  const headerLinks = usePublicNavLinks();
  const { signedIn, startAuth, openProduct } = useProductNavigation();
  const copy = COPY[product];
  const then = PRODUCT_ENTRIES[product].appPath;

  return (
    <div className="hm-public min-h-screen overflow-x-hidden">
      <PageMeta title={t(copy.title)} description={t(copy.lead)} />
      <PublicHeader links={headerLinks} solid />
      <HeaderSpacer />

      <main>
        <section className={`${PAGE} grid gap-10 pb-16 pt-10 sm:pt-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-start lg:gap-16 lg:pb-24 lg:pt-20`}>
          <div className="min-w-0">
            <PubEyebrow>{t(copy.eyebrow)}</PubEyebrow>
            <h1 className="hm-pub-h1 mt-5 text-foreground">{t(copy.title)}</h1>
            <p className="hm-pub-lead mt-5 max-w-[36rem]">{t(copy.lead)}</p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              {signedIn ? (
                <PubButton size="lg" arrow onClick={() => openProduct(product)}>{t(copy.ctaSignedIn)}</PubButton>
              ) : (
                <>
                  <PubButton size="lg" arrow onClick={() => startAuth('signup', then)}>{t(copy.cta)}</PubButton>
                  <PubButton size="lg" tone="secondary" onClick={() => startAuth('login', then)}>{t('pub_entry_login')}</PubButton>
                </>
              )}
            </div>
            <p className="mt-4 max-w-[34rem] text-[14.5px] leading-relaxed text-muted-foreground">{t(copy.needs)}</p>

            <div className="mt-12 border-t border-border pt-8">
              <h2 className="hm-pub-h3 text-foreground">{t('pub_entry_how')}</h2>
              <PubSteps
                className="mt-5"
                steps={copy.steps.map(([title, body]) => ({ title: t(title), body: t(body) }))}
              />
            </div>
          </div>

          <div className="min-w-0 lg:sticky lg:top-28">
            {product === 'find_property' ? <SearchPlanPreview /> : <MatchPreview />}
          </div>
        </section>

        <section className="hm-pub-band">
          <div className={`${PAGE} py-12 sm:py-16`}>
            <h2 className="hm-pub-h3 text-foreground">{t('pub_entry_related')}</h2>
            <ul className="mt-5 grid gap-3 sm:grid-cols-3">
              {copy.related.map(item => (
                <li key={item.to}>
                  <Link to={item.to} className="hm-pub-card bg-card hm-pub-card--link group flex h-full items-start gap-3.5 p-4">
                    <span className="hm-pub-icon" aria-hidden="true"><item.icon className="h-5 w-5" strokeWidth={1.8} /></span>
                    <span className="min-w-0">
                      <span className="block text-[16px] font-semibold text-foreground">{t(item.label)}</span>
                      <span className="mt-0.5 block text-[14px] leading-snug text-muted-foreground">{t(item.body)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
