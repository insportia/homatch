import { Check, Gift, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import type { EntitlementStatus, FeatureCode, PlanCode, PublicPlan } from './service';
import { formatGel } from './service';
import { featureOf, useEntitlementStatus } from './useEntitlementStatus';

/** The plan's features, in the owner's words, from the server's entitlement rows. */
export function planFeatureLines(plan: PublicPlan, t: (k: string, v?: Record<string, string>) => string): string[] {
  const e = plan.entitlements;
  const lines: string[] = [];
  const quota = (f: FeatureCode, one: string, unlimited: string) => {
    const x = e[f];
    if (!x?.enabled) return;
    lines.push(x.unlimited ? t(unlimited) : t(one, { count: String(x.limit ?? 0) }));
  };
  quota('VERIFY', 'sub_feat_verify', 'sub_feat_verify_unlimited');
  quota('CONTRACT_ANALYSIS', 'sub_feat_contract', 'sub_feat_contract_unlimited');
  if (e.HOMI_UNLIMITED?.enabled) lines.push(t('sub_feat_homi'));
  if (e.INTERNAL_SEARCH?.enabled) lines.push(t('sub_feat_search'));
  if (e.INTERNAL_MATCHING?.enabled) lines.push(t('sub_feat_matching'));
  if (e.INTERNAL_UNLOCK_FREE?.enabled) lines.push(t('sub_feat_unlock'));
  return lines;
}

export function PlanCard({ plan, current, highlight, action }: {
  plan: PublicPlan; current: boolean; highlight: boolean; action: React.ReactNode;
}) {
  const { t, lang } = useLanguage();
  const name = t(`sub_plan_${plan.code}`);
  return (
    <article
      className={`flex min-w-0 flex-col rounded-2xl border p-5 sm:p-6 ${highlight ? 'border-[hsl(38_92%_54%)] bg-card shadow-hover' : 'border-border bg-card'}`}
      aria-label={name}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">{name}</h2>
        {current ? <span className="rounded-full bg-gold-soft px-2.5 py-0.5 text-xs font-semibold text-gold-ink">{t('sub_current')}</span> : null}
      </div>
      <p className="mt-3 text-3xl font-bold tabular-nums" dir="ltr">
        {t('sub_per_month', { price: formatGel(plan.priceTetri, lang === 'ka' ? 'ka-GE' : lang) })}
      </p>
      {plan.vatInclusive ? <p className="mt-1 text-xs text-muted-foreground">{t('sub_vat_included')}</p> : null}
      <ul className="mt-4 flex-1 space-y-2 text-sm">
        {planFeatureLines(plan, t).map((line) => (
          <li key={line} className="flex gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-gold-ink" aria-hidden="true" />
            <span className="min-w-0">{line}</span>
          </li>
        ))}
      </ul>
      <div className="mt-5">{action}</div>
    </article>
  );
}

/**
 * "Your first one is free" / "Included in your plan: N left" for an entry point.
 * Server truth only; renders nothing while unknown or for signed-out visitors.
 */
export function EntitlementBadge({ feature, className = '' }: { feature: Extract<FeatureCode, 'VERIFY' | 'CONTRACT_ANALYSIS'>; className?: string }) {
  const { t } = useLanguage();
  const { status } = useEntitlementStatus();
  const f = featureOf(status, feature);
  if (!status || !f) return null;
  let text: string | null = null;
  let Icon = Sparkles;
  if (f.trialAvailable) { text = t('sub_badge_first_free'); Icon = Gift; }
  else if (f.included && f.unlimited) text = t('sub_badge_included_unlimited');
  else if (f.included && (f.remaining ?? 0) > 0) text = t('sub_badge_included', { remaining: String(f.remaining) });
  else if (status.hasLegacyBalance) text = t('sub_badge_legacy');
  if (!text) return null;
  return (
    <span className={`inline-flex max-w-full items-center gap-1.5 rounded-full bg-gold-soft px-2.5 py-1 text-xs font-semibold text-gold-ink ${className}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">{text}</span>
    </span>
  );
}

/** The answer to SUBSCRIPTION_REQUIRED / ALLOWANCE_EXHAUSTED: plans, never a top-up. */
export function SubscribePrompt({ code, className = '' }: { code: string; className?: string }) {
  const { t } = useLanguage();
  return (
    <div role="status" className={`rounded-xl border border-[hsl(38_92%_54%)]/40 bg-gold-soft p-4 text-sm ${className}`}>
      <p className="font-medium text-foreground">{code === 'ALLOWANCE_EXHAUSTED' ? t('sub_prompt_exhausted') : t('sub_prompt_subscribe')}</p>
      <Button asChild size="sm" className="mt-3 bg-gold text-primary hover:bg-gold-hover">
        <Link to="/pricing">{t('sub_see_plans')}</Link>
      </Button>
    </div>
  );
}

export function planLabel(t: (k: string) => string, code: PlanCode | 'FREE' | null | undefined): string {
  return t(`sub_plan_${code ?? 'FREE'}`);
}

export function hasAnyIncluded(status: EntitlementStatus | null): boolean {
  return !!status?.subscription?.hasAccess;
}
