// HOMATCH — the verdict, and the one-line reason for it.
//
// The verdict is EXACTLY one of three values and comes from property risk
// only. A source we could not reach never moves it, so this component is
// deliberately incapable of showing a "degraded" or "partial" verdict: there
// is no such state, because coverage is not risk.
//
// Mobile note: the reason list wraps rather than truncating. A buyer reading
// "Negative" needs the reason on the same screen, not behind a tooltip.
import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { CheckCircle2, AlertTriangle, ShieldAlert } from 'lucide-react';

export type Verdict = 'POSITIVE' | 'MODERATELY_POSITIVE' | 'NEGATIVE';

const STYLES: Record<Verdict, { wrap: string; icon: React.ElementType; iconClass: string; key: string }> = {
  POSITIVE: {
    wrap: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-900',
    icon: CheckCircle2,
    iconClass: 'text-emerald-600 dark:text-emerald-400',
    key: 'dr_verdict_positive',
  },
  MODERATELY_POSITIVE: {
    wrap: 'bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-900',
    icon: AlertTriangle,
    iconClass: 'text-amber-600 dark:text-amber-400',
    key: 'dr_verdict_moderate',
  },
  NEGATIVE: {
    wrap: 'bg-rose-50 border-rose-200 dark:bg-rose-950/40 dark:border-rose-900',
    icon: ShieldAlert,
    iconClass: 'text-rose-600 dark:text-rose-400',
    key: 'dr_verdict_negative',
  },
};

export function VerdictBanner({
  verdict,
  reasons = [],
  subtitle,
}: {
  verdict: Verdict;
  reasons?: string[];
  subtitle?: string | null;
}) {
  const { t } = useLanguage();
  const s = STYLES[verdict] ?? STYLES.MODERATELY_POSITIVE;
  const Icon = s.icon;

  return (
    <div className={`rounded-xl border p-4 sm:p-5 ${s.wrap}`}>
      <div className="flex items-start gap-3">
        <Icon className={`h-6 w-6 shrink-0 mt-0.5 ${s.iconClass}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg sm:text-xl font-semibold leading-tight">{t(s.key)}</h2>
          {subtitle ? (
            <p className="text-sm text-muted-foreground mt-1 break-words">{subtitle}</p>
          ) : null}
          {reasons.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {reasons.map((r, i) => (
                <li key={i} className="text-sm leading-relaxed flex gap-2">
                  <span aria-hidden="true" className="opacity-50">•</span>
                  <span className="min-w-0 break-words">{r}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
