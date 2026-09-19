// HOMATCH HOME FINANCING — the front door.
//
// Nine questions, not nine calculators. The card carries the question in
// the borrower's own words — "What can I actually afford?" — because
// that is how somebody decides which one they need, and a tile labelled
// "PTI / LTV" would make them work it out.
//
// WHY A CARD SAYS WHAT IT IS WAITING FOR
//
// Several topics need more than the basic loan: the affordability view
// needs an income, the comparison needs two offers, refinancing needs a
// loan you already have. A card that simply looked disabled would be a
// dead end. Each one names the missing thing instead, so the chooser
// doubles as the list of what is left to enter.

import React from 'react';
import {
  ArrowRight,
  CalendarRange,
  Columns3,
  FastForward,
  FileCheck2,
  Landmark,
  Percent,
  Repeat,
  Scale,
  Wallet,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { TOPICS, TOPIC_ORDER, missingRequirements, type TopicDef, type TopicId, type WorkspaceState } from '@/mortgage/topics';

const ICONS: Record<TopicDef['icon'], typeof Wallet> = {
  wallet: Wallet,
  scale: Scale,
  percent: Percent,
  calendar: CalendarRange,
  columns: Columns3,
  'fast-forward': FastForward,
  repeat: Repeat,
  landmark: Landmark,
  'file-check': FileCheck2,
};

export function TopicHome({
  onSelect,
  state,
  lastOpened,
}: {
  onSelect: (topic: TopicId) => void;
  state: WorkspaceState;
  lastOpened: TopicId | null;
}) {
  const { t, isRTL } = useLanguage();

  return (
    <div className="mx-auto w-full max-w-[72rem] px-4 py-10 sm:px-5 sm:py-14">
      <header className="mb-8 max-w-[44rem] sm:mb-10">
        <p className="mb-3 text-2xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--gold-ink))]">
          {t('mortgage_product_eyebrow')}
        </p>
        <h1 className="font-display text-3xl font-semibold leading-tight text-foreground sm:text-4xl">
          {t('mortgage_home_title')}
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">{t('mortgage_home_body')}</p>
      </header>

      <div className="grid gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3">
        {TOPIC_ORDER.map((id) => {
          const topic = TOPICS[id];
          const Icon = ICONS[topic.icon];
          const missing = missingRequirements(topic, state);
          const ready = missing.length === 0;
          const resumable = lastOpened === id;

          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              className={cn(
                'hm-workspace-panel group flex min-h-[10rem] flex-col p-5 text-start transition-all sm:p-6',
                'hover:border-[hsl(var(--gold-border))] hover:shadow-[var(--shadow-hover)]',
                resumable && 'border-[hsl(var(--gold-border))]',
              )}
            >
              <span className="mb-4 flex items-start justify-between gap-3">
                <span
                  className={cn(
                    'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border',
                    ready
                      ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]'
                      : 'border-border bg-[hsl(var(--secondary))]',
                  )}
                >
                  <Icon
                    className={cn('h-5 w-5', ready ? 'text-[hsl(var(--gold-ink))]' : 'text-muted-foreground')}
                    aria-hidden="true"
                  />
                </span>
                {resumable ? (
                  <span className="rounded-full border border-[hsl(var(--gold-border))] px-2.5 py-1 text-2xs text-[hsl(var(--gold-ink))]">
                    {t('mortgage_home_last_opened')}
                  </span>
                ) : null}
              </span>

              <span className="block font-display text-lg font-semibold leading-tight text-foreground">
                {t(topic.titleKey)}
              </span>
              <span className="mt-1.5 block text-2xs font-medium uppercase tracking-[0.1em] text-[hsl(var(--gold-ink))]">
                {t(topic.questionKey)}
              </span>
              <span className="mt-3 block flex-1 text-sm leading-relaxed text-muted-foreground">
                {t(topic.descriptionKey)}
              </span>

              <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
                {ready ? (
                  <>
                    {t('mortgage_home_open')}
                    <ArrowRight
                      className={cn(
                        'h-4 w-4 transition-transform group-hover:translate-x-0.5',
                        isRTL && 'scale-x-[-1] group-hover:-translate-x-0.5',
                      )}
                      aria-hidden="true"
                    />
                  </>
                ) : (
                  <span className="text-2xs font-normal text-muted-foreground">
                    {t('mortgage_home_needs')} {missing.map((key) => t(key)).join(', ')}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-9 max-w-[58ch] text-2xs leading-relaxed text-muted-foreground">
        {t('mortgage_home_footnote')}
      </p>
    </div>
  );
}
