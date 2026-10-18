import { Bookmark, History, Layers, Plus, Telescope } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { T } from '../format';
import { btn, cx, Eyebrow } from './primitives';

export type WorkspaceTab = 'searches' | 'saved' | 'activity';
export const WORKSPACE_TABS: WorkspaceTab[] = ['searches', 'saved', 'activity'];

/**
 * The page's front door: what Find Property is, the one primary action, and the
 * two ways to search. Light, calm, and short — the old full-width black band is gone.
 */
export function WorkspaceHeader({ t, compact, activeSources, deepAvailable, deepOffered = true, action }: {
  t: T; compact?: boolean; activeSources?: number | null; deepAvailable?: boolean; action?: ReactNode;
  /** false while Admin pauses paid Deep Search (service find_property_deep): the free search only. */
  deepOffered?: boolean;
}) {
  return (
    <header className="relative overflow-hidden rounded-3xl border border-[hsl(var(--gold-border)/0.6)] bg-[linear-gradient(135deg,hsl(42_60%_99%)_0%,hsl(40_42%_96%)_55%,hsl(38_50%_93%)_100%)] px-5 py-6 shadow-[0_1px_2px_rgba(12,17,25,0.04),0_20px_48px_-32px_rgba(12,17,25,0.35)] sm:px-8 sm:py-8">
      <div className="pointer-events-none absolute -end-24 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(circle,hsl(var(--gold)/0.22),transparent_65%)]" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[hsl(var(--gold)/0.5)] to-transparent" aria-hidden="true" />
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 max-w-2xl space-y-2">
          <Eyebrow>{t('fpx_eyebrow')}</Eyebrow>
          <h1 className="font-display text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] text-[#0C1119] sm:text-[36px]">{t('plan_page_title')}</h1>
          {!compact ? <p className="max-w-[60ch] text-[15px] leading-relaxed text-foreground/75">{t('fpx_header_sub')}</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {action ?? <Link to="/find-property/new" className={cx(btn.primary, 'min-h-12 px-6 text-[15px]')} data-action="new-search"><Plus className="h-4 w-4" aria-hidden="true" />{t('mps_new_search')}</Link>}
        </div>
      </div>
      {!compact ? (
        <ul className={cx('relative mt-6 grid gap-2.5', deepOffered && 'sm:grid-cols-2')} aria-label={t('fpx_modes_label')}>
          <li className="flex min-w-0 items-start gap-3 rounded-2xl border border-white/70 bg-white/70 p-3.5 backdrop-blur-sm">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#0C1119] text-[hsl(var(--gold))]" aria-hidden="true"><Layers className="h-4 w-4" /></span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">{t('fpx_free_title')}<span className="rounded-full bg-[hsl(var(--success)/0.1)] px-2 py-0.5 text-2xs font-semibold text-[hsl(var(--success))]">{t('fpx_free_price')}</span></span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{activeSources ? t('fpx_free_line_n', { n: activeSources }) : t('fpx_free_line')}</span>
            </span>
          </li>
          {deepOffered ? <li className="flex min-w-0 items-start gap-3 rounded-2xl border border-white/70 bg-white/70 p-3.5 backdrop-blur-sm" data-mode-tile="DEEP">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold)/0.12)] text-[hsl(var(--gold-ink))]" aria-hidden="true"><Telescope className="h-4 w-4" /></span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">{t('fpx_deep_title')}<span className="rounded-full bg-[hsl(var(--gold)/0.14)] px-2 py-0.5 text-2xs font-semibold text-[hsl(var(--gold-ink))]">{deepAvailable ? t('fpx_deep_price') : t('fpx_deep_soon')}</span></span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{t('fpx_deep_line')}</span>
            </span>
          </li> : null}
        </ul>
      ) : null}
    </header>
  );
}

const TAB_ICON = { searches: History, saved: Bookmark, activity: Layers } as const;

/** Segmented navigation between the customer's searches, saved homes and activity. Links, so each view is addressable. */
export function WorkspaceTabs({ t, active, counts, hrefOf }: {
  t: T; active: WorkspaceTab; counts: Partial<Record<WorkspaceTab, number | null>>; hrefOf: (tab: WorkspaceTab) => string;
}) {
  return (
    <nav aria-label={t('fpx_tabs_label')}>
      <ul className="flex w-full gap-1 rounded-2xl border border-border bg-card p-1 shadow-sm sm:inline-flex sm:w-auto">
        {WORKSPACE_TABS.map((tab) => {
          const Icon = TAB_ICON[tab];
          const on = tab === active;
          const n = counts[tab];
          return (
            <li key={tab} className="min-w-0 flex-1 sm:flex-none">
              <Link to={hrefOf(tab)} aria-current={on ? 'page' : undefined} data-tab={tab}
                className={cx('flex min-h-[44px] items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 text-sm font-semibold transition sm:gap-2 sm:px-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]',
                  on ? 'bg-[#0C1119] text-white shadow-sm' : 'text-foreground/70 hover:bg-muted hover:text-foreground')}>
                <Icon className={cx('hidden h-4 w-4 sm:block', on ? 'text-[hsl(var(--gold))]' : '')} aria-hidden="true" />
                {t(`fpx_tab_${tab}`)}
                {n != null ? <span className={cx('rounded-full px-1.5 text-2xs tabular-nums', on ? 'bg-white/15' : 'bg-muted')}>{n}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
