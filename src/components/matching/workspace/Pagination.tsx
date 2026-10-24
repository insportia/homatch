import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { formatCount } from './format';

/** 1 … 4 5 [6] 7 8 … 20 — the pages a numbered pager shows. */
export function pageWindow(page: number, pages: number): Array<number | 'gap'> {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: Array<number | 'gap'> = [1];
  const lo = Math.max(2, page - 1);
  const hi = Math.min(pages - 1, page + 1);
  if (lo > 2) out.push('gap');
  for (let p = lo; p <= hi; p += 1) out.push(p);
  if (hi < pages - 1) out.push('gap');
  out.push(pages);
  return out;
}

const BTN = 'inline-flex h-10 min-w-10 items-center justify-center rounded-lg border px-2 text-sm font-semibold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)] disabled:cursor-not-allowed disabled:opacity-40';

export function RangeLine({ page, pageSize, total }: { page: number; pageSize: number; total: number }) {
  const { t, lang } = useLanguage();
  if (!total) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <p className="text-xs font-semibold text-[hsl(224_14%_30%)]" data-testid="mw-range">
      {t('mw_showing', { from: formatCount(from, lang), to: formatCount(to, lang), total: formatCount(total, lang) })}
    </p>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const { t, lang } = useLanguage();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="flex flex-wrap items-center justify-center gap-1.5" aria-label={t('mw_pages_label')} data-testid="mw-pagination">
      <button type="button" className={cn(BTN, 'border-[hsl(var(--border))] bg-white')} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t('mw_page_previous')} data-testid="mw-page-prev">
        <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
      </button>
      {pageWindow(page, pages).map((p, i) => (p === 'gap'
        ? <span key={`g${i}`} className="px-1 text-muted-foreground" aria-hidden="true">…</span>
        : (
          <button key={p} type="button" onClick={() => onPage(p)} aria-current={p === page ? 'page' : undefined} data-page={p}
            className={cn(BTN, p === page ? 'border-[hsl(218_52%_11%)] bg-[hsl(218_52%_11%)] text-[hsl(40_94%_64%)]' : 'border-[hsl(var(--border))] bg-white text-[hsl(218_45%_14%)]')}>
            <span dir="ltr">{formatCount(p, lang)}</span>
          </button>
        )))}
      <button type="button" className={cn(BTN, 'border-[hsl(var(--border))] bg-white')} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label={t('mw_page_next')} data-testid="mw-page-next">
        <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
      </button>
    </nav>
  );
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-[hsl(var(--border))] overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-white" data-testid="mw-skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-4 motion-safe:animate-pulse">
          <span className="h-5 w-5 rounded-md bg-[hsl(218_20%_92%)]" />
          <span className="h-4 w-32 rounded bg-[hsl(218_20%_92%)]" />
          <span className="hidden h-4 flex-1 rounded bg-[hsl(218_20%_94%)] sm:block" />
          <span className="h-6 w-16 rounded-lg bg-[hsl(42_60%_92%)]" />
        </div>
      ))}
    </div>
  );
}
