// EMAIL STUDIO — the real sending allowance (UX pass §6). Every figure comes from
// my_email_allowance(), i.e. from the same plan period and admin ceilings email_quota_reserve
// enforces at send time. A ceiling that is not configured is not shown; a provider figure that is
// unknown (no recent usage snapshot) is labelled unavailable — nothing is guessed, and nothing
// here promises delivery: these are the most the system will ACCEPT for sending.

import { Clock, Gauge, Info, Loader2, Mail, ShieldAlert } from 'lucide-react';
import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { dispatchMinutes, type EmailAllowance, sendable } from '@/services/emailCampaignStudio';

const n = (v: number, lang: string) => v.toLocaleString(lang);

export function AllowancePanel({ allowance, recipients, loading, className, compact = false }: {
  allowance: EmailAllowance | null; recipients?: number; loading?: boolean; className?: string; compact?: boolean;
}) {
  const { t, lang } = useLanguage();
  if (loading && !allowance) return <div className={cn('flex h-32 items-center justify-center rounded-2xl border bg-card', className)}><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (!allowance) return <div className={cn('rounded-2xl border bg-card p-4 text-sm text-muted-foreground', className)}>{t('ems_allow_unavailable')}</div>;
  const a = allowance;
  const s = recipients != null ? sendable(a, recipients) : null;
  const rows: Array<{ key: string; value: string; sub?: string; warn?: boolean }> = [
    {
      key: a.plan.periodKind === 'FREE_LIFETIME' ? 'ems_allow_plan_free' : 'ems_allow_plan_month',
      value: t('ems_allow_of', { left: n(a.plan.remaining, lang), total: n(a.plan.included, lang) }),
      sub: a.plan.periodKind === 'MONTHLY' && a.plan.endsAt ? t('ems_allow_resets', { when: new Date(a.plan.endsAt).toLocaleDateString(lang) }) : t('ems_allow_no_month'),
      warn: a.plan.remaining === 0,
    },
    ...(a.tenantDaily ? [{ key: 'ems_allow_daily', value: t('ems_allow_of', { left: n(a.tenantDaily.remaining, lang), total: n(a.tenantDaily.cap, lang) }), sub: t('ems_allow_resets_daily'), warn: a.tenantDaily.remaining === 0 }] : []),
    ...(a.providerDaily ? [{ key: 'ems_allow_platform_day', value: n(a.providerDaily.remaining, lang), sub: t('ems_allow_platform_hint'), warn: a.providerDaily.remaining === 0 }] : []),
    ...(a.providerMonthly ? [{ key: 'ems_allow_platform_month', value: n(a.providerMonthly.remaining, lang), sub: t('ems_allow_platform_hint') }] : []),
    {
      key: 'ems_allow_provider',
      value: a.provider?.dailyRemaining != null ? n(a.provider.dailyRemaining, lang) : t('ems_allow_provider_unknown'),
      sub: a.provider ? t('ems_allow_provider_at', { when: new Date(a.provider.capturedAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }) }) : t('ems_allow_provider_none'),
    },
    {
      key: 'ems_allow_overage',
      value: a.overage.enabled ? t('ems_allow_overage_on', { price: a.overage.pricePer1kUsd.toFixed(2) }) : t('ems_allow_overage_off'),
      sub: a.overage.enabled && a.overage.room != null ? t('ems_allow_overage_room', { n: n(a.overage.room, lang) }) : undefined,
    },
  ];
  return (
    <section className={cn('rounded-2xl border bg-card p-4 sm:p-5', className)} aria-label={t('ems_allow_title')}>
      <div className="mb-3 flex items-start gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[hsl(38_90%_95%)] text-[hsl(32_70%_32%)]"><Gauge className="h-[18px] w-[18px]" /></span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold leading-snug">{t('ems_allow_title')}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('ems_allow_sub')}</p>
        </div>
      </div>
      {!a.sending.enabled ? (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[13px] text-amber-900"><ShieldAlert className="mt-px h-4 w-4 shrink-0" />{t('ems_allow_sending_off')}</p>
      ) : null}
      {s && recipients != null ? (
        <div className={cn('mb-3 rounded-xl p-3', s.now >= recipients ? 'bg-emerald-50 text-emerald-950' : 'bg-amber-50 text-amber-950')}>
          <p className="flex items-center gap-1.5 text-sm font-semibold"><Mail className="h-4 w-4" aria-hidden="true" />
            {s.now >= recipients ? t('ems_allow_fits', { n: n(recipients, lang) }) : t('ems_allow_partial', { now: n(s.now, lang), n: n(recipients, lang) })}
          </p>
          {s.limitedBy ? <p className="mt-1 text-2xs">{t(`ems_allow_limit_${s.limitedBy.toLowerCase()}`)}</p> : null}
          {recipients > 0 ? <p className="mt-1 flex items-center gap-1 text-2xs"><Clock className="h-3.5 w-3.5" aria-hidden="true" />{t('ems_allow_time', { min: dispatchMinutes(Math.min(s.now, recipients)) })}</p> : null}
          <p className="mt-1 text-2xs">{s.overage > 0 ? t('ems_allow_cost_overage', { n: n(s.overage, lang), usd: (Math.ceil(s.overage / 1000) * a.overage.pricePer1kUsd).toFixed(2) }) : t('ems_allow_cost_included')}</p>
        </div>
      ) : null}
      <dl className={cn('grid gap-2', compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2 xl:grid-cols-3')}>
        {rows.map((r) => (
          <div key={r.key} className={cn('rounded-lg border px-3 py-2', r.warn && 'border-amber-300 bg-amber-50/60')}>
            <dt className="text-2xs font-medium text-muted-foreground">{t(r.key)}</dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums [overflow-wrap:anywhere]">{r.value}</dd>
            {r.sub ? <dd className="text-2xs leading-snug text-muted-foreground">{r.sub}</dd> : null}
          </div>
        ))}
      </dl>
      <p className="mt-3 flex items-start gap-1.5 text-2xs leading-snug text-muted-foreground"><Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t('ems_allow_disclaimer')}</p>
    </section>
  );
}
