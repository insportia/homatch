// TWO SERVICES, TWO IDENTITIES.
//
// Internal Matching compares a property with demand that already exists INSIDE
// HOMATCH: members' saved requirements and members who asked about it. External
// Matching discovers potentially interested people OUTSIDE HOMATCH through
// research of public sources. They are different engines with different
// results, so every screen that shows either one names it with the same mark:
//
//   Internal  — an emerald "network" mark on a white chip, navy ink
//   External  — a gold radar mark on a navy chip
//
// Nothing here reads or mixes the engines' data; it is a label system only.
import React from 'react';
import { Radar, UsersRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { GOLD_FILL, GOLD_TEXT, NAVY_BAND } from '@/components/findBuyers/brand';

export type MatchingService = 'internal' | 'external';

const MARK = {
  internal: { Icon: UsersRound, name: 'svc_internal_name', short: 'svc_internal_short', line: 'svc_internal_line' },
  external: { Icon: Radar, name: 'svc_external_name', short: 'svc_external_short', line: 'svc_external_line' },
} as const;

/** The compact mark: icon + service name. Used on cards, tabs and list rows. */
export function ServiceBadge({ service, onDark = false, compact = false, className }: {
  service: MatchingService; onDark?: boolean; compact?: boolean; className?: string;
}) {
  const { t } = useLanguage();
  const m = MARK[service];
  const internal = service === 'internal';
  return (
    <span
      data-service={service}
      className={cn(
        'inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full py-0.5 pe-2.5 ps-0.5 text-2xs font-bold uppercase tracking-[0.08em]',
        internal
          ? onDark ? 'bg-white/10 text-white ring-1 ring-inset ring-[hsl(158_60%_55%/0.55)]' : 'bg-white text-[hsl(218_45%_14%)] ring-1 ring-inset ring-[hsl(158_45%_70%)]'
          : onDark ? cn('bg-white/10 ring-1 ring-inset ring-[hsl(40_80%_60%/0.55)]', GOLD_TEXT) : cn(NAVY_BAND, GOLD_TEXT, 'ring-1 ring-inset ring-[hsl(40_80%_55%/0.5)]'),
        className,
      )}
    >
      <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
        internal ? 'bg-[hsl(158_64%_36%)] text-white' : cn(GOLD_FILL, 'text-[hsl(218_52%_11%)]'))}>
        <m.Icon className="h-3 w-3" aria-hidden="true" />
      </span>
      <span className="truncate">{t(compact ? m.short : m.name)}</span>
    </span>
  );
}

/**
 * The section header every matching surface opens with: which service this is,
 * in one line of words, and an optional count of THIS customer's results.
 */
export function ServiceHeader({ service, title, count, actions, id, className }: {
  service: MatchingService;
  title?: string;
  count?: number | null;
  actions?: React.ReactNode;
  id?: string;
  className?: string;
}) {
  const { t } = useLanguage();
  const m = MARK[service];
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-2', className)}>
      <div className="min-w-0 flex-1 basis-64 space-y-1">
        <ServiceBadge service={service} />
        <h2 id={id} className="flex flex-wrap items-baseline gap-x-2 font-display text-lg font-semibold leading-snug text-[hsl(218_45%_14%)]">
          <span className="min-w-0 break-words">{title ?? t(m.name)}</span>
          {typeof count === 'number' && (
            <span className="text-sm font-semibold tabular-nums text-[hsl(218_28%_38%)]">{t('svc_results_count', { n: String(count) })}</span>
          )}
        </h2>
        <p className="max-w-prose text-2xs leading-relaxed text-[hsl(218_28%_38%)] break-words">{t(m.line)}</p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** The two services side by side as jump links, so a page always says which one is in view. */
export function ServiceSwitch({ active, onSelect, className }: {
  active: MatchingService;
  onSelect: (service: MatchingService) => void;
  className?: string;
}) {
  const { t } = useLanguage();
  return (
    <div role="tablist" aria-label={t('svc_switch_label')}
      className={cn('grid grid-cols-2 gap-1 rounded-2xl bg-white p-1 ring-1 ring-inset ring-[hsl(40_70%_82%)]', className)}>
      {(['internal', 'external'] as const).map((service) => {
        const m = MARK[service];
        const on = service === active;
        return (
          <button key={service} type="button" role="tab" aria-selected={on} onClick={() => onSelect(service)}
            className={cn(
              'flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]',
              on
                ? service === 'external' ? cn(NAVY_BAND, GOLD_TEXT) : 'bg-[hsl(158_64%_32%)] text-white'
                : 'text-[hsl(218_45%_14%)] hover:bg-[hsl(42_100%_97%)]',
            )}>
            <m.Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">{t(m.name)}</span>
          </button>
        );
      })}
    </div>
  );
}
