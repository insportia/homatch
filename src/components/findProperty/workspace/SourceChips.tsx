/*
 * Which property site the results come from: All sources, or one site at a time.
 * The chips are the sites that really returned homes in THIS search, each with
 * how many of the homes it holds (a home on two sites counts for both, and in
 * "All sources" it appears once, with every site named on it).
 */
import { Globe2 } from 'lucide-react';
import type { T } from '../format';
import { cx } from './primitives';

export function SourceChips({ t, sources, total, active, onChange }: {
  t: T; sources: Array<{ key: string; name: string; count: number }>; total: number; active: string | undefined;
  onChange: (source: string | undefined) => void;
}) {
  if (sources.length < 2) return null;
  const chip = (key: string | undefined, label: string, count: number) => {
    const on = active === key;
    return (
      <li key={key ?? 'ALL'} className="shrink-0 snap-start">
        <button type="button" onClick={() => onChange(key)} aria-pressed={on} data-source-chip={key ?? 'ALL'}
          className={cx('inline-flex min-h-[44px] items-center gap-2 rounded-full border px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))] focus-visible:ring-offset-2',
            on ? 'border-[#0C1119] bg-[#0C1119] text-white shadow-sm' : 'border-border bg-card text-foreground/80 hover:border-[hsl(var(--gold-border))] hover:text-foreground')}>
          <span dir="ltr">{label}</span>
          <span className={cx('rounded-full px-2 py-0.5 text-2xs tabular-nums', on ? 'bg-white/15 text-[hsl(var(--gold))]' : 'bg-muted text-muted-foreground')}>{count}</span>
        </button>
      </li>
    );
  };
  return (
    <nav aria-label={t('fpv_sources_nav')} className="space-y-2" data-source-chips>
      <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground"><Globe2 className="h-3.5 w-3.5 text-[hsl(var(--gold-ink))]" aria-hidden="true" />{t('fpv_sources_nav')}</p>
      <ul className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
        {chip(undefined, t('fpv_all_sources'), total)}
        {sources.map((s) => chip(s.key, s.name, s.count))}
      </ul>
    </nav>
  );
}
