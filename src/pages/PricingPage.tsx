import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { useEntitlements } from '@/hooks/useEntitlements';
import { PublicHeader, type HeaderLink } from '@/components/home/PublicHeader';
import { SiteFooter } from '@/components/home/sections/SiteFooter';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { PlanBadge } from '@/components/billing/PlanBadge';
import { getCatalogue, startSubscription, getUpgradeSavings, formatCredits } from '@/services/billing';
import type { BillingCatalogue, BillingPlanRow, PlanCode, UpgradeSavings } from '@/types/billing';
import { Check, Loader2, Sparkles, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';

/**
 * THE PRICING PAGE.
 *
 * Every number on this screen comes from the server. The plan prices, the
 * monthly Credit grants, the included allowances, the result ceilings and the
 * "Most Popular" label are all rows in billing_plans / product_plan_entitlements,
 * so an admin changes the offer without a deploy and this file never disagrees
 * with what the customer is actually charged.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 * No percentage off. No "save 25%". No margin, no COGS, no provider budget.
 * The member rate is named ("VIP Member Rates"), never quantified as a share
 * of our profit, because that is internal economics and reads badly. The only
 * numeric savings claim anywhere is the one below the grid, and it is computed
 * from this customer's real charged executions or not shown at all.
 */

const PAGE = 'mx-auto w-full max-w-[80rem] px-5 sm:px-8 lg:px-10';

const PLAN_TAGLINE: Record<PlanCode, string> = {
  FREE: 'pricing_free_tagline',
  VIP: 'pricing_vip_tagline',
  PREMIUM: 'pricing_premium_tagline',
};
const PLAN_CTA: Record<PlanCode, string> = {
  FREE: 'pricing_cta_free',
  VIP: 'pricing_cta_vip',
  PREMIUM: 'pricing_cta_premium',
};
const TIER_KEY: Record<string, string> = {
  STANDARD: 'tier_standard', ENHANCED: 'tier_enhanced', MAXIMUM: 'tier_maximum',
};
const RATE_KEY: Record<PlanCode, string> = {
  FREE: 'rate_standard', VIP: 'rate_vip', PREMIUM: 'rate_best',
};
/** Included-allowance copy, per product. The COUNT comes from the server. */
const INCLUDED_KEY: Record<string, string> = {
  VERIFY: 'feat_verify_included',
  FIND_CLIENTS: 'feat_find_clients_included',
  CONTRACT_INTELLIGENCE: 'feat_contract_included',
  BROKER_FINDER: 'feat_broker_included',
};

export default function PricingPage() {
  useSurfaceTheme('light');
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { homatchUser } = useAuth();
  const ent = useEntitlements();
  const [params] = useSearchParams();

  const [catalogue, setCatalogue] = useState<BillingCatalogue | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyPlan, setBusyPlan] = useState<PlanCode | null>(null);
  const [savings, setSavings] = useState<UpgradeSavings | null>(null);

  useEffect(() => {
    getCatalogue()
      .then(setCatalogue)
      .catch(() => toast.error(t('general_error')))
      .finally(() => setLoading(false));
  }, [t]);

  // The personalised savings line, from real usage only. A customer with no
  // paid history gets nothing here rather than a hypothetical.
  useEffect(() => {
    if (!homatchUser?.id || ent.plan === 'PREMIUM') return;
    const target = ent.plan === 'VIP' ? 'PREMIUM' : 'VIP';
    getUpgradeSavings(target).then(setSavings).catch(() => {});
  }, [homatchUser?.id, ent.plan]);

  useEffect(() => {
    if (params.get('subscribed') === '1') {
      toast.success(t('sub_manage_title'));
      void ent.refresh();
    }
  }, [params, t]);

  const matrix = useMemo(() => {
    const m = new Map<string, Map<string, { included: number; tier: string; ceiling: number | null }>>();
    for (const row of catalogue?.entitlementMatrix ?? []) {
      if (!m.has(row.product_code)) m.set(row.product_code, new Map());
      m.get(row.product_code)!.set(row.plan_code, {
        included: row.included_per_period, tier: row.quality_tier, ceiling: row.result_ceiling,
      });
    }
    return m;
  }, [catalogue]);

  const onChoose = async (plan: BillingPlanRow) => {
    if (!homatchUser) { navigate('/auth/signup'); return; }
    if (plan.code === 'FREE') { navigate('/dashboard'); return; }
    if (ent.plan === plan.code) { navigate('/credits'); return; }

    setBusyPlan(plan.code);
    try {
      const res = await startSubscription(plan.code as 'VIP' | 'PREMIUM');
      if (res.checkoutUrl && !res.mock) {
        window.location.href = res.checkoutUrl;
        return;
      }
      // No payment provider configured. Say so plainly instead of pretending
      // a subscription started.
      toast.info(res.message ?? res.error ?? t('general_error'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('general_error'));
    } finally {
      setBusyPlan(null);
    }
  };

  const creditValue = catalogue ? `$${(1 / catalogue.creditsPerUsd).toFixed(2)}` : '$0.10';

  const headerLinks: HeaderLink[] = [
    { key: 'home', label: t('mp_nav_start'), target: '/' },
    { key: 'about', label: t('nav_about'), target: '/about' },
    { key: 'verify', label: t('nav_verify'), target: '/verify' },
    { key: 'mortgage', label: t('nav_mortgage'), target: '/mortgage' },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader links={headerLinks} solid />

      <main className={`${PAGE} py-12 sm:py-16 lg:py-20`}>
        <header className="max-w-3xl">
          <p className="text-[14px] font-medium uppercase tracking-[0.18em] text-gold-ink">
            {t('nav_pricing')}
          </p>
          <h1 className="mt-3 text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-balance">
            {t('pricing_page_title')}
          </h1>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground text-pretty">
            {t('pricing_page_sub')}
          </p>
        </header>

        {loading ? (
          <div className="mt-16 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <div className="mt-10 sm:mt-14 grid gap-5 lg:grid-cols-3 items-start">
              {(catalogue?.plans ?? []).map((plan) => (
                <PlanCard
                  key={plan.code}
                  plan={plan}
                  matrix={matrix}
                  creditsPerUsd={catalogue?.creditsPerUsd ?? 10}
                  isCurrent={!!homatchUser && ent.plan === plan.code}
                  busy={busyPlan === plan.code}
                  onChoose={() => onChoose(plan)}
                />
              ))}
            </div>

            {savings?.eligible && (
              <section className="mt-10 rounded-xl border border-gold/30 bg-gold-soft/40 p-5 sm:p-6">
                <p className="text-[14px] font-medium uppercase tracking-[0.18em] text-gold-ink">
                  {t('savings_title')}
                </p>
                <p className="mt-2 text-sm sm:text-base text-foreground">
                  {t('savings_body')
                    .replace('{plan}', savings.targetPlan)
                    .replace('{n}', formatCredits(savings.creditsSavedOnRates ?? 0))
                    .replace('{c}', String(savings.monthlyMembershipCredits ?? 0))}
                </p>
              </section>
            )}

            <CreditsExplainer creditValue={creditValue} />
            <ComparisonTable catalogue={catalogue} matrix={matrix} />
          </>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}

// ── Plan card ───────────────────────────────────────────────────────────────

function PlanCard({
  plan, matrix, creditsPerUsd, isCurrent, busy, onChoose,
}: {
  plan: BillingPlanRow;
  matrix: Map<string, Map<string, { included: number; tier: string; ceiling: number | null }>>;
  creditsPerUsd: number;
  isCurrent: boolean;
  busy: boolean;
  onChoose: () => void;
}) {
  const { t } = useLanguage();
  const isPremium = plan.code === 'PREMIUM';
  const isFree = plan.code === 'FREE';

  // Feature lines are assembled from the SAME rows the engine bills from, so
  // the card cannot promise an allowance the server will not honour.
  const features: string[] = [];
  for (const [product, key] of Object.entries(INCLUDED_KEY)) {
    const cell = matrix.get(product)?.get(plan.code);
    if (cell && cell.included > 0) features.push(t(key).replace('{n}', String(cell.included)));
  }
  if (plan.membership_credits_grant > 0) {
    features.push(t('feat_membership_credits').replace('{n}', String(plan.membership_credits_grant)));
  }
  const fcCeiling = matrix.get('FIND_CLIENTS')?.get(plan.code)?.ceiling;
  if (fcCeiling) features.push(t('feat_results_up_to').replace('{n}', String(fcCeiling)));
  features.push(t(TIER_KEY[plan.quality_tier] ?? 'tier_standard'));
  features.push(t(RATE_KEY[plan.code] ?? 'rate_standard'));
  if (!isFree) features.push(t('feat_deeper_research'));
  if (plan.priority_level > 0) features.push(t('feat_priority_execution'));
  if (!isFree) features.push(t('feat_ai_fair_use'));
  if (plan.badge_key === 'badge_vip') features.push(t('feat_badge_vip'));
  if (plan.badge_key === 'badge_premium') features.push(t('feat_badge_premium'));
  features.push(t('feat_free_ai'));
  features.push(t('feat_unlimited_mortgage'));
  features.push(t('feat_unlimited_live_chat'));
  features.push(t('feat_full_history'));
  // Stated on every card on purpose: pay as you go is not a paid feature.
  features.push(t('feat_unlimited_payg'));

  return (
    <div
      className={[
        'relative flex h-full flex-col rounded-2xl border p-6 sm:p-7 transition-shadow',
        isPremium
          ? 'border-gold/50 bg-card shadow-[0_1px_0_0_hsl(var(--gold)/0.25),0_18px_40px_-24px_hsl(var(--gold)/0.45)]'
          : plan.code === 'VIP'
            ? 'border-border/80 bg-card shadow-sm'
            : 'border-border/60 bg-card/60',
      ].join(' ')}
    >
      {plan.marketing_label_key && (
        <span
          className={[
            'absolute -top-2.5 start-6 rounded-full px-2.5 py-1 text-[13px] font-semibold uppercase tracking-wider',
            isPremium ? 'bg-gold text-background' : 'bg-foreground text-background',
          ].join(' ')}
        >
          {t(plan.marketing_label_key)}
        </span>
      )}

      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold tracking-tight">{plan.name}</h2>
        {plan.badge_key && <PlanBadge planCode={plan.code} size="sm" />}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{t(PLAN_TAGLINE[plan.code])}</p>

      <div className="mt-5 flex items-baseline gap-1.5" dir="ltr">
        <span className="text-4xl font-semibold tracking-tight">
          ${(plan.monthly_price_cents / 100).toFixed(0)}
        </span>
        <span className="text-sm text-muted-foreground">/ {t('pricing_per_month')}</span>
      </div>

      <Button
        className={[
          'mt-5 w-full',
          isPremium ? 'bg-gold text-background hover:bg-gold/90' : '',
        ].join(' ')}
        variant={isPremium ? 'default' : isFree ? 'outline' : 'default'}
        onClick={onChoose}
        disabled={busy || isCurrent}
      >
        {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
        {isCurrent ? t('pricing_current_plan') : t(PLAN_CTA[plan.code])}
      </Button>

      <ul className="mt-6 space-y-2.5">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-sm">
            <Check className={`mt-0.5 h-4 w-4 shrink-0 ${isPremium ? 'text-gold-ink' : 'text-muted-foreground'}`} />
            <span className="text-foreground/90">{f}</span>
          </li>
        ))}
      </ul>

      {plan.membership_credits_grant > 0 && (
        <p className="mt-5 text-xs text-muted-foreground" dir="auto">
          {t('credits_value_line').replace('{v}', `$${(1 / creditsPerUsd).toFixed(2)}`)}
        </p>
      )}
    </div>
  );
}

// ── Credits explainer ───────────────────────────────────────────────────────

function CreditsExplainer({ creditValue }: { creditValue: string }) {
  const { t } = useLanguage();
  return (
    <section className="mt-14 rounded-2xl border border-border/60 bg-card/50 p-6 sm:p-8">
      <h2 className="text-lg font-semibold tracking-tight">{t('credits_what_title')}</h2>
      <p className="mt-2 text-sm text-gold-ink font-medium" dir="auto">
        {t('credits_value_line').replace('{v}', creditValue)}
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <p className="text-sm text-muted-foreground text-pretty">{t('credits_what_body')}</p>
        <p className="text-sm text-muted-foreground text-pretty">{t('credits_free_things')}</p>
        {/* Said plainly, because a closed-loop credit must never be mistaken
            for stored money. */}
        <p className="text-sm text-muted-foreground text-pretty">{t('credits_not_cash')}</p>
      </div>
    </section>
  );
}

// ── Comparison ──────────────────────────────────────────────────────────────

function ComparisonTable({
  catalogue, matrix,
}: {
  catalogue: BillingCatalogue | null;
  matrix: Map<string, Map<string, { included: number; tier: string; ceiling: number | null }>>;
}) {
  const { t } = useLanguage();
  const plans = catalogue?.plans ?? [];
  // Only products with a real allowance on at least one plan. AI_CALL and
  // EMAIL_CAMPAIGN are registered but unpriced, and must not appear as if
  // they were on sale.
  const products = [...matrix.entries()].filter(([, byPlan]) =>
    [...byPlan.values()].some((c) => c.included > 0));

  if (!products.length) return null;

  return (
    <section className="mt-14">
      <h2 className="text-lg font-semibold tracking-tight">{t('pricing_compare_title')}</h2>
      {/* Wide content scrolls inside its own container; the page body never
          scrolls sideways on a phone. */}
      <div className="mt-4 -mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[34rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="py-3 text-start font-medium text-muted-foreground">{t('pricing_compare_product')}</th>
              {plans.map((p) => (
                <th key={p.code} className="py-3 text-start font-semibold">{p.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {products.map(([code, byPlan]) => (
              <tr key={code} className="border-b border-border/50">
                <td className="py-3 pe-4 text-muted-foreground">{t(INCLUDED_KEY[code] ?? code).replace('{n} ', '')}</td>
                {plans.map((p) => {
                  const cell = byPlan.get(p.code);
                  return (
                    <td key={p.code} className="py-3 pe-4">
                      <span className="font-medium">{cell?.included ?? 0}</span>
                      {cell?.tier && (
                        <span className="ms-2 text-xs text-muted-foreground">{t(TIER_KEY[cell.tier])}</span>
                      )}
                      {cell?.ceiling ? (
                        <span className="block text-xs text-muted-foreground">
                          {t('feat_results_up_to').replace('{n}', String(cell.ceiling))}
                        </span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="border-b border-border/50">
              <td className="py-3 pe-4 text-muted-foreground">{t('feat_unlimited_payg')}</td>
              {plans.map((p) => (
                <td key={p.code} className="py-3 pe-4">
                  <Check className="h-4 w-4 text-gold-ink" aria-label={t('feat_unlimited_payg')} />
                </td>
              ))}
            </tr>
            <tr>
              <td className="py-3 pe-4 text-muted-foreground">{t('feat_full_history')}</td>
              {plans.map((p) => (
                <td key={p.code} className="py-3 pe-4">
                  <Check className="h-4 w-4 text-gold-ink" aria-label={t('feat_full_history')} />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
