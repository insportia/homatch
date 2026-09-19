// HOMATCH HOME FINANCING — the summary that sits above every topic.
//
// Eight figures, then three lists. The figures are the shared six-slot
// header idea from the Investment workspace, widened to eight because a
// mortgage genuinely has two more numbers a borrower checks first (the
// down payment and the loan amount are not derivable from each other
// without the price).
//
// WHY EVERY FINDING PRINTS ITS OWN CRITERION
//
// "Deserves attention: your PTI is 34.2% against a 30% limit" is a
// fact. "Deserves attention" on its own is an opinion, and a product
// that hands out opinions about somebody's mortgage without saying what
// produced them is asking to be believed rather than checked. Each line
// carries the rule that generated it, in the same breath.
//
// There is no score. See the header of financingPicture.ts for why.

import React from 'react';
import { AlertCircle, CheckCircle2, CircleDashed } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { FigureValue } from '@/components/workspace/primitives';
import { fig } from './fields';
import type { FinancingPicture, PictureNote } from '@/mortgage/calculations/financingPicture';

function NoteList({
  notes,
  titleKey,
  Icon,
  tone,
}: {
  notes: PictureNote[];
  titleKey: string;
  Icon: typeof CheckCircle2;
  tone: string;
}) {
  const { t } = useLanguage();
  if (!notes.length) return null;
  return (
    <div>
      <h3 className={cn('flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.14em]', tone)}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {t(titleKey)}
      </h3>
      <ul className="mt-2 space-y-2">
        {notes.map((note) => (
          <li key={note.key} className="text-sm leading-relaxed text-foreground">
            {/* A note's variables may themselves be translation keys — a
                rate type is an enum in the engine and a word on the
                screen — so those are resolved before interpolation. */}
            {t(note.key, {
              ...note.vars,
              ...Object.fromEntries(
                Object.entries(note.varKeys ?? {}).map(([name, key]) => [name, t(key)]),
              ),
            })}
            <span className="ms-1.5 text-2xs text-muted-foreground">({t(note.criterionKey)})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FinancingPictureView({ picture }: { picture: FinancingPicture }) {
  const { t } = useLanguage();
  const currency = picture.currency;

  const slots: { labelKey: string; value: number | null; kind: 'money' | 'percent'; decimals?: number; emphasis?: boolean }[] = [
    { labelKey: 'mortgage_pic_price', value: picture.propertyPrice, kind: 'money' },
    { labelKey: 'mortgage_pic_down', value: picture.downPayment, kind: 'money' },
    { labelKey: 'mortgage_pic_loan', value: picture.loanAmount, kind: 'money' },
    { labelKey: 'mortgage_pic_payment', value: picture.monthlyPayment, kind: 'money', emphasis: true },
    { labelKey: 'mortgage_pic_effective', value: picture.effectiveAnnualRatePercent, kind: 'percent', decimals: 2 },
    { labelKey: 'mortgage_pic_total_cost', value: picture.totalFinancingCost, kind: 'money' },
    { labelKey: 'mortgage_pic_pti', value: picture.ptiPercent, kind: 'percent', decimals: 1 },
    { labelKey: 'mortgage_pic_ltv', value: picture.ltvPercent, kind: 'percent', decimals: 1 },
  ];

  return (
    <div className="hm-workspace-panel overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold text-foreground">{t('mortgage_pic_title')}</h2>
          <p className="mt-0.5 text-2xs font-medium uppercase tracking-[0.1em] text-[hsl(var(--gold-ink))]">
            {t('mortgage_pic_eyebrow')}
          </p>
        </div>
        <span className="text-2xs text-muted-foreground">
          {t('mortgage_pic_down_percent', { pct: picture.downPaymentPercent.toFixed(1) })}
        </span>
      </header>

      <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x rtl:lg:divide-x-reverse">
        {slots.map((slot) => (
          <div key={slot.labelKey} className={cn('p-4 sm:p-5', slot.emphasis && 'bg-[hsl(var(--gold-soft))]')}>
            <p className="text-2xs font-medium uppercase leading-tight tracking-wide text-muted-foreground">
              {t(slot.labelKey)}
            </p>
            <p
              className={cn(
                'mt-1.5 font-display text-xl font-semibold leading-none',
                slot.emphasis ? 'text-[hsl(var(--gold-ink))]' : 'text-foreground',
              )}
            >
              <FigureValue
                figure={fig(slot.value)}
                kind={slot.kind}
                currency={currency}
                decimals={slot.decimals}
              />
            </p>
          </div>
        ))}
      </div>

      {picture.comfortable.length || picture.attention.length || picture.missing.length ? (
        <div className="grid gap-6 border-t border-border px-5 py-5 lg:grid-cols-3">
          <NoteList
            notes={picture.comfortable}
            titleKey="mortgage_pic_comfortable"
            Icon={CheckCircle2}
            tone="text-[hsl(var(--success))]"
          />
          <NoteList
            notes={picture.attention}
            titleKey="mortgage_pic_attention"
            Icon={AlertCircle}
            tone="text-[hsl(var(--gold-ink))]"
          />
          <NoteList
            notes={picture.missing}
            titleKey="mortgage_pic_missing"
            Icon={CircleDashed}
            tone="text-muted-foreground"
          />
        </div>
      ) : null}
    </div>
  );
}
