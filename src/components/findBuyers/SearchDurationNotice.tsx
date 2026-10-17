// How long finding buyers and tenants can take — said once, beside the live
// search, in the product's own navy/gold. A range, never a promise: the copy
// says it MAY take 10–30 minutes and why it varies; it never says the search
// will be finished within 30 minutes.
import React from 'react';
import { Clock3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { GOLD_TEXT } from '@/components/findBuyers/brand';

export function SearchDurationNotice({ className }: { className?: string }) {
  const { t } = useLanguage();
  return (
    <aside data-testid="fbl-duration-notice" aria-label={t('fbl_duration_title')}
      className={cn('flex min-w-0 items-start gap-3 rounded-xl bg-white/[0.06] p-3 ring-1 ring-inset ring-[hsl(40_80%_60%/0.35)]', className)}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[hsl(40_94%_64%/0.14)] ring-1 ring-inset ring-[hsl(40_80%_60%/0.5)]">
        <Clock3 className={cn('h-4 w-4', GOLD_TEXT)} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className={cn('text-2xs font-bold uppercase tracking-[0.12em]', GOLD_TEXT)}>{t('fbl_duration_title')}</p>
        <p className="mt-0.5 break-words text-sm leading-relaxed text-[hsl(218_40%_90%)]">{t('fbl_duration_body')}</p>
      </div>
    </aside>
  );
}

export default SearchDurationNotice;
