import React from 'react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { CARD, INK, INK_SOFT } from './styles';

/** One numbered step of the studio, with its approved heading. */
export function StudioSection({
  id, step, title, actions, children, className,
}: {
  id: string;
  step: number;
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const { t } = useLanguage();
  return (
    <section aria-labelledby={`${id}-title`} className={cn(CARD, 'p-4 sm:p-6', className)}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn('text-xs font-semibold uppercase tracking-[0.14em]', INK_SOFT)}>{t('es_step', { n: step })}</p>
          <h2 id={`${id}-title`} className={cn('mt-0.5 font-display text-lg font-bold leading-tight sm:text-xl', INK)}>{title}</h2>
        </div>
        {actions ? <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}
