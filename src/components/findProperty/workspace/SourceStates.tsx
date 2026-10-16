import { AlertTriangle, CheckCircle2, Clock3, Loader2, MinusCircle, ShieldAlert, Users, XCircle } from 'lucide-react';
import type { SearchSummary } from '@/services/marketplaceSearch';
import type { T } from '../format';
import { cx, Pill, SOURCE_TONE, sourceState, type SourceState } from './primitives';

const ICON: Record<SourceState, typeof Loader2> = {
  WAITING: Clock3, SEARCHING: Loader2, FOUND: CheckCircle2, NONE: MinusCircle, UNAVAILABLE: ShieldAlert, FAILED: XCircle, TIMED_OUT: AlertTriangle,
};

/**
 * Every source this search really dispatched, with its real state and count. The list is
 * the server's (one row per worker run), so a newly enabled portal appears without a code change.
 */
export function SourceStates({ t, search, compact }: { t: T; search: SearchSummary; compact?: boolean }) {
  const rows = (search.sources ?? []).map((s) => ({ s, state: sourceState(s, search.terminal) }));
  return (
    <ul className={cx('grid gap-2', compact ? 'sm:grid-cols-2 xl:grid-cols-3' : 'sm:grid-cols-2')} data-testid="mps-sources" aria-label={t('fpx_sources_label')}>
      <li className="flex min-h-[56px] min-w-0 items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-2.5" data-source="HOMATCH">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#0C1119] text-[hsl(var(--gold))]" aria-hidden="true"><Users className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{t('fpx_source_homatch')}</span>
          <span className="block truncate text-xs text-muted-foreground">{t('fpx_source_homatch_note')}</span>
        </span>
      </li>
      {rows.map(({ s, state }, i) => {
        const Icon = ICON[state];
        const found = s.freshListings + s.cachedListings;
        return (
          <li key={`${s.workerId ?? s.source}-${i}`} data-state={state} data-source={s.source}
            className="flex min-h-[56px] min-w-0 items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-2.5">
            <span className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-lg', state === 'FOUND' ? 'bg-[hsl(var(--success)/0.1)] text-[hsl(var(--success))]' : state === 'SEARCHING' ? 'bg-[hsl(var(--info)/0.08)] text-[hsl(var(--info))]' : 'bg-muted text-muted-foreground')} aria-hidden="true">
              <Icon className={cx('h-4 w-4', state === 'SEARCHING' && 'motion-safe:animate-spin')} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold" dir="ltr">{s.source}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {state === 'FOUND' ? t('fpx_src_found_n', { n: found }) : t(`fpx_src_${state}`)}
                {s.cachedListings > 0 && state === 'FOUND' ? ` · ${t('fpx_src_cached_n', { n: s.cachedListings })}` : ''}
              </span>
            </span>
            <Pill tone={SOURCE_TONE[state]} pulse={state === 'SEARCHING'} className="hidden sm:inline-flex">{t(`fpx_src_pill_${state}`)}</Pill>
          </li>
        );
      })}
    </ul>
  );
}

/** Real fraction of sources that reached an end state; never an invented percentage. */
export function sourceProgress(search: SearchSummary) {
  const rows = search.sources ?? [];
  const done = rows.filter((s) => !['WAITING', 'SEARCHING'].includes(sourceState(s, search.terminal))).length;
  return { done, total: rows.length, fraction: rows.length ? done / rows.length : search.terminal ? 1 : 0 };
}
