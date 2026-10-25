// EMAIL STUDIO — the phone editor's bottom sheet (selected-element settings, Add, Layers).
//
// Not a modal: the email stays visible and scrollable above it, and the selected block is
// scrolled into the space the sheet leaves (EmailDesigner). It sits above the app's bottom bar,
// respects the safe area, and can be expanded to most of the screen or closed. Escape closes it.
// While a block is being dragged it steps aside (suspended), so the whole email is a drop target.

import { ChevronDown, ChevronUp, X } from 'lucide-react';
import React, { useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

export const SHEET_HEIGHT = { half: 0.56, full: 0.88 } as const;

export function BottomSheet({ open, title, subtitle, expanded, onExpand, onClose, actions, children, labelledBy, suspended = false }: {
  open: boolean; title: React.ReactNode; subtitle?: React.ReactNode; expanded: boolean;
  onExpand: (v: boolean) => void; onClose: () => void; actions?: React.ReactNode; children: React.ReactNode; labelledBy: string;
  suspended?: boolean;
}) {
  const { t } = useLanguage();
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, onClose]);
  if (!open) return null;
  const icon = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-foreground/70 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_85%_55%)]';
  return (
    <section
      role="region" aria-labelledby={labelledBy} data-sheet aria-hidden={suspended || undefined}
      className={cn('fixed inset-x-0 bottom-0 z-[60] flex flex-col rounded-t-2xl border-t bg-card shadow-[0_-12px_40px_rgba(12,17,25,0.18)] motion-safe:animate-in motion-safe:slide-in-from-bottom-6',
        suspended && 'pointer-events-none invisible')}
      style={{ height: `${(expanded ? SHEET_HEIGHT.full : SHEET_HEIGHT.half) * 100}dvh`, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="mx-auto mt-1.5 h-1 w-10 shrink-0 rounded-full bg-foreground/15" aria-hidden="true" />
      {/* Narrow phones: the element's actions take their own row, so the title is never squeezed out. */}
      <header className="@container shrink-0 border-b px-2 py-1">
        <div className="flex flex-wrap items-center gap-x-1">
          <div className="order-1 min-w-0 flex-1 px-1.5">
            <h2 id={labelledBy} className="truncate text-[15px] font-semibold">{title}</h2>
            {subtitle ? <p className="truncate text-2xs text-muted-foreground">{subtitle}</p> : null}
          </div>
          {actions ? <div className="order-3 flex w-full items-center justify-around @[24rem]:order-2 @[24rem]:w-auto @[24rem]:justify-end">{actions}</div> : null}
          <div className="order-2 flex @[24rem]:order-3">
            <button type="button" className={icon} aria-label={t(expanded ? 'ems_b_sheet_collapse' : 'ems_b_sheet_expand')} aria-expanded={expanded} onClick={() => onExpand(!expanded)}>
              {expanded ? <ChevronDown className="h-5 w-5" /> : <ChevronUp className="h-5 w-5" />}
            </button>
            <button type="button" className={icon} aria-label={t('ems_d_close')} onClick={onClose}><X className="h-5 w-5" /></button>
          </div>
        </div>
      </header>
      {/* Touch sizes inside the sheet: 44 px fields and choices, 16 px text (no iOS zoom on focus). */}
      <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3',
        '[&_input:not([type=color])]:min-h-11 [&_input:not([type=color])]:text-base [&_textarea]:text-base [&_[role=group]_button]:min-h-10 [&_[role=combobox]]:min-h-11 [&_[role=slider]]:h-7 [&_[role=slider]]:w-7')}>{children}</div>
    </section>
  );
}
