// Numbered result pagination: ← 1 … 4 5 6 … N →, the current page marked.
// Compact on a phone (← 3 / 12 →). Pages are server pages; nothing is hidden
// client-side.
import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { pageWindow } from '@/findBuyers/campaignView';

export function PageNav({ page, totalPages, onPage, label }: {
  page: number; totalPages: number; onPage: (p: number) => void; label: string;
}) {
  const { t, isRTL } = useLanguage();
  if (totalPages <= 1) return null;
  const items = pageWindow(page, totalPages);
  const cell = 'inline-flex h-11 min-w-11 items-center justify-center rounded-xl px-3 text-sm font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]';
  const idle = 'bg-white text-[hsl(218_45%_14%)] ring-1 ring-inset ring-[hsl(40_70%_80%)] hover:ring-[hsl(38_92%_50%)]';
  const Prev = isRTL ? ChevronRight : ChevronLeft;
  const Next = isRTL ? ChevronLeft : ChevronRight;
  return (
    <nav aria-label={label} className="flex items-center justify-center gap-1.5 pt-2">
      <button type="button" className={cn(cell, idle, 'disabled:opacity-40')} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t('fbl_page_prev')}>
        <Prev className="h-4 w-4" aria-hidden="true" />
      </button>
      <ol className="hidden items-center gap-1.5 sm:flex">
        {items.map((it, i) => it === 'gap' ? (
          <li key={`g${i}`} aria-hidden="true" className="px-1 text-sm text-[hsl(218_28%_38%)]">…</li>
        ) : (
          <li key={it}>
            <button type="button" onClick={() => onPage(it)} aria-current={it === page ? 'page' : undefined}
              aria-label={t('fbl_page_n', { n: String(it) })}
              className={cn(cell, it === page ? 'bg-[hsl(218_52%_11%)] text-[hsl(40_94%_64%)] ring-1 ring-inset ring-[hsl(40_80%_55%/0.6)]' : idle)}>
              {it}
            </button>
          </li>
        ))}
      </ol>
      <span className="px-2 text-sm font-semibold tabular-nums text-[hsl(218_45%_14%)] sm:hidden" aria-live="polite">
        {t('fbl_page_of', { n: String(page), total: String(totalPages) })}
      </span>
      <button type="button" className={cn(cell, idle, 'disabled:opacity-40')} disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label={t('fbl_page_next')}>
        <Next className="h-4 w-4" aria-hidden="true" />
      </button>
    </nav>
  );
}

export default PageNav;
