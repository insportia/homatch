/*
 * LEADS CRM — the small visual vocabulary the page and the drawer share.
 *
 * Premium light: warm white ground (the `.hm-customer` token block), white surfaces,
 * deep navy for structure and text, gold reserved for the one primary action and for
 * "this wants you" (a due follow-up). Controls are 44–48px tall with a visible ring.
 */

import React, { useMemo } from 'react';
import { StatusPill } from '@/components/verify/ui';
import { intlLocaleFor } from '@/components/workspace/primitives';
import { useLanguage } from '@/contexts/LanguageContext';
import { statusLabelKey, statusTone } from '@/crm/model';
import { cn } from '@/lib/utils';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)] focus-visible:ring-offset-2';

/** The approved gold primary. */
export const GOLD_BUTTON = cn(
  'inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[hsl(38_92%_54%)] px-6 text-[15px] font-bold text-[#161309]',
  'transition-colors hover:bg-[hsl(38_92%_60%)] motion-reduce:transition-none',
  'disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-[hsl(38_92%_54%)]',
  FOCUS,
);

/** White secondary with a thin border. */
export const SECONDARY_BUTTON = cn(
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[hsl(40_12%_82%)] bg-white px-4 text-sm font-semibold text-[hsl(218_45%_14%)]',
  'transition-colors hover:border-[hsl(38_60%_62%)] hover:bg-[hsl(42_60%_98%)] motion-reduce:transition-none',
  'disabled:cursor-not-allowed disabled:opacity-55',
  FOCUS,
);

export const PANEL = 'rounded-2xl border border-[hsl(40_12%_86%)] bg-white shadow-[0_1px_2px_hsl(35_25%_15%/0.05),0_6px_20px_hsl(35_25%_15%/0.05)]';

export const FIELD = cn(
  'w-full rounded-xl border border-[hsl(40_12%_80%)] bg-white px-3.5 text-[15px] text-[hsl(218_45%_14%)] placeholder:text-[hsl(218_15%_50%)]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)] focus-visible:border-transparent',
  'disabled:cursor-not-allowed disabled:opacity-60',
);

export const SECTION_TITLE = 'font-display text-[15px] font-semibold text-[hsl(218_45%_14%)]';

export function CrmStatusPill({ status }: { status: string }) {
  const { t } = useLanguage();
  return <StatusPill tone={statusTone(status)}>{t(statusLabelKey(status))}</StatusPill>;
}

/** Date + time in the reader's language. */
export function useCrmDateFormat() {
  const { lang } = useLanguage();
  return useMemo(() => {
    const locale = intlLocaleFor(lang);
    let dateTime: Intl.DateTimeFormat;
    let dateOnly: Intl.DateTimeFormat;
    try {
      dateTime = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      dateOnly = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
      dateTime = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
      dateOnly = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });
    }
    const safe = (f: Intl.DateTimeFormat) => (iso: string | null | undefined): string => {
      if (!iso) return '';
      const d = new Date(iso);
      return Number.isFinite(d.getTime()) ? f.format(d) : '';
    };
    return { dateTime: safe(dateTime), date: safe(dateOnly) };
  }, [lang]);
}

export function SectionCard({
  title, icon: Icon, children, className, labelledBy,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
  labelledBy: string;
}) {
  return (
    <section aria-labelledby={labelledBy} className={cn(PANEL, 'p-4 sm:p-5', className)}>
      <h3 id={labelledBy} className={cn(SECTION_TITLE, 'flex items-center gap-2')}>
        {Icon ? <Icon className="h-4 w-4 shrink-0 text-[hsl(34_90%_31%)]" aria-hidden="true" /> : null}
        <span className="min-w-0 break-words">{title}</span>
      </h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}
