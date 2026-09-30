// Small shared pieces for the Meta Control Center panels. Same card and KPI
// look as the rest of AdminMetaAdsPage; nothing here fetches.
import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

export function Panel({ title, actions, children, className }: {
  title?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={cn('min-w-0 rounded-2xl border border-border bg-card p-4 shadow-card', className)}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="min-w-0 break-words font-semibold text-foreground">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'warn' }) {
  return (
    <div className={cn(
      'min-w-0 rounded-xl border px-3 py-2.5',
      tone === 'warn' ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]' : 'border-border bg-[hsl(var(--secondary))]',
    )}>
      <p className="break-words text-2xs text-muted-foreground">{label}</p>
      <p className="font-display text-xl font-bold tabular-nums" dir="ltr">{value}</p>
    </div>
  );
}

/** A count-by-key map as a sorted list, largest first. */
export function Breakdown({ title, data }: { title: string; data: Record<string, number> | null | undefined }) {
  const { t } = useLanguage();
  const entries = Object.entries(data ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <div className="min-w-0">
      <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('mm_a_none')}</p>
      ) : (
        <ul className="space-y-1 text-[13px]">
          {entries.map(([k, n]) => (
            <li key={k} className="flex min-w-0 items-baseline justify-between gap-3 border-b border-border/60 pb-1 last:border-0">
              <span className="min-w-0 break-all font-mono" dir="ltr">{k}</span>
              <span className="shrink-0 tabular-nums" dir="ltr">{n.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Admin-only JSON, collapsed until asked for. */
export function JsonDetails({ label, value }: { label: string; value: unknown }) {
  return (
    <details className="min-w-0 text-[13px]">
      <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">{label}</summary>
      <pre dir="ltr" className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-2 font-mono text-2xs">
        {JSON.stringify(value ?? null, null, 2)}
      </pre>
    </details>
  );
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e ?? ''));
