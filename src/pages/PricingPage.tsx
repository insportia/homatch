import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { PublicHeader, HeaderSpacer, type HeaderLink } from '@/components/home/PublicHeader';
import { SiteFooter } from '@/components/home/sections/SiteFooter';
import { PageBlocks } from '@/site/render/PageBlocks';
import { SitePage } from '@/site/render/SitePage';
import { usePublishedPage } from '@/site/render/usePublishedPage';
import { Button } from '@/components/ui/button';
import { getCatalogue, formatCredits } from '@/services/billing';
import type { BillingCatalogue } from '@/types/billing';
import { Loader2, ArrowRight, Wallet } from 'lucide-react';

/**
 * THE PRICING PAGE, WITH NOTHING TO COMPARE.
 *
 * This was three plan cards, an upgrade-savings banner and a feature
 * comparison table. There are no plans now: no FREE/VIP/PREMIUM, no monthly
 * fee, no membership credits, no "Most Popular". An account is free, credits
 * are bought when they are wanted, and a search charges what it actually used.
 *
 * So the page answers three questions and stops:
 *
 *   What does it cost me to be here?   Nothing.
 *   What does a thing cost?            A list, from the server.
 *   How do I get credits?              Any amount from $1.
 *
 * EVERY NUMBER STILL COMES FROM THE SERVER. billable_products carries the
 * price and admin_settings carries the conversion rate, so an operator
 * changing either changes this page without a deploy — which is the property
 * the plan grid had and the reason it is kept.
 *
 * WHAT IS DELIBERATELY ABSENT, AND STAYS ABSENT
 *
 * COGS, margin, provider budgets and the reference cost behind a price. The
 * catalogue endpoint does not select those columns at all, so this file could
 * not render them even if somebody asked it to.
 */

const PAGE = 'mx-auto w-full max-w-[64rem] px-5 sm:px-8 lg:px-10';

export default function PricingPage() {
  const { t } = useLanguage();
  const { homatchUser } = useAuth();
  const navigate = useNavigate();
  useSurfaceTheme('light');

  const [catalogue, setCatalogue] = useState<BillingCatalogue | null>(null);
  const [loading, setLoading] = useState(true);
  const storedPage = usePublishedPage('pricing');

  useEffect(() => {
    let alive = true;
    getCatalogue()
      .then((c) => { if (alive) setCatalogue(c); })
      .catch(() => { if (alive) setCatalogue(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const creditsPerUsd = catalogue?.creditsPerUsd ?? 10;
  /* One dollar's worth, stated in the customer's own arithmetic. */
  const rateCredits = String(creditsPerUsd);
  const rateUsd = '1';

  const headerLinks: HeaderLink[] = [
    { key: 'verify', label: t('nav_verify'), target: '/verify' },
    { key: 'mortgage', label: t('nav_mortgage'), target: '/mortgage' },
    { key: 'investment', label: t('nav_investment'), target: '/investment' },
  ];

  const products = (catalogue?.products ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader links={headerLinks} solid />
      <HeaderSpacer />

      <main className={`${PAGE} py-12 sm:py-16 lg:py-20`}>
        {/* Stored content the owner edits in Site Studio. */}
        <SitePage slug="pricing" content={storedPage} only={['pricing_intro']} />

        {/*
          The headline and the no-subscription sentence live in the stored
          intro above, which is the page's one h1 and is editable in Site
          Studio. Repeating them here would give the page two titles and say
          the same thing twice.
        */}
        <p className="mt-6 text-sm font-medium text-gold-ink" dir="auto">
          {t('payg_rate_line', { credits: rateCredits, usd: rateUsd })}
        </p>

        {/*
          ── What things cost ────────────────────────────────────

          Rendered only when there is something to render. An empty list left
          a heading with a blank space under it on production for the window
          between the frontend deploying and the catalogue function catching
          up -- a page that looks broken rather than one that is simply
          waiting. The same shape protects against the endpoint failing.
        */}
        {(loading || products.length > 0) && (
        <section className="mt-10 sm:mt-14" aria-labelledby="payg-prices">
          <h2 id="payg-prices" className="text-lg font-semibold tracking-tight">
            {t('payg_prices_title')}
          </h2>

          {loading ? (
            <div className="mt-8 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-border rounded-xl border border-border bg-card">
              {products.map((p) => (
                <li key={p.code} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3.5">
                  <span className="min-w-0 flex-1 text-sm font-medium text-foreground">{p.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {p.price_credits == null
                      ? t('payg_price_unavailable')
                      : p.billing_mode === 'VARIABLE'
                        /* Variable cost: the figure is a starting point, not
                           a flat price, and saying so is the honest form. */
                        ? t('payg_price_from', { credits: formatCredits(p.price_credits) })
                        : t('payg_price_each', { credits: formatCredits(p.price_credits) })}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-3 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">
            {t('payg_only_actual')}
          </p>
        </section>
        )}

        {/* ── Getting credits ───────────────────────────────────── */}
        <section className="mt-10 sm:mt-14 rounded-2xl border border-border/60 bg-card/50 p-6 sm:p-8">
          <h2 className="text-lg font-semibold tracking-tight">{t('payg_topup_title')}</h2>
          <p className="mt-2 max-w-[52ch] text-sm leading-relaxed text-muted-foreground">
            {t('payg_topup_body')}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="lg"
              className="h-auto min-h-11 whitespace-normal py-2.5 text-start leading-snug"
              onClick={() => navigate(homatchUser ? '/credits' : '/auth/signup')}
            >
              <Wallet className="me-2 h-4 w-4 shrink-0" aria-hidden="true" />
              {homatchUser ? t('payg_cta_wallet') : t('payg_cta_start')}
              <ArrowRight className="ms-2 h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden="true" />
            </Button>
            {!homatchUser && (
              <span className="text-sm text-muted-foreground">{t('payg_free_account')}</span>
            )}
          </div>
        </section>
      </main>

      {/* Everything an admin ADDED, below. The heading is excluded because it
          has already been rendered above. */}
      <PageBlocks slug="pricing" except={['pricing_intro']} />

      <SiteFooter />
    </div>
  );
}
