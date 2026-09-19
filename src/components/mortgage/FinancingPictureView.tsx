// HOMATCH HOME FINANCING — the summary that sits under the answer.
//
// Eight figures, then three lists.
//
// WHY THE CRITERION IN BRACKETS IS GONE
//
// Every finding used to print the rule that produced it, in brackets,
// immediately after the sentence. The intent was right: a product that
// hands out observations about somebody's mortgage without saying what
// produced them is asking to be believed rather than checked. The
// execution put this in front of a customer:
//
//   "სესხი ქონების ღირებულების 87.5%-ს ფარავს. ეს 70%-იან ზღვარზე
//    მეტია.(სესხი ღირებულებასთან გამოქვეყნებულ ზღვართან)"
//
// That bracket is an internal label. It names the criterion in the
// vocabulary of the rule engine, it is attached with no space, and it
// tells a first-time borrower nothing they did not just read in plainer
// words. Seven of them appeared on the live Georgian page at once.
//
// The criterion has not been deleted. It is still on every note, still
// asserted by the tests, and it is now where a reason belongs: inside
// the sentence itself. "The payment takes 30% of your income, above the
// published limit of 30%" carries its own rule.
//
// WHY PTI AND LTV ARE WORDS FIRST
//
// Two acronyms stood alone over two numbers. Somebody who does not know
// them learns nothing, and somebody who does loses nothing by reading
// the words. The acronym survives as the small second line, because it
// is what a bank will say back to them.
//
// There is no score. See the header of financingPicture.ts for why.

import React from 'react';
import { AlertCircle, CheckCircle2, CircleDashed } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { FigureValue } from '@/components/workspace/primitives';
import { fig } from './fields';
import { AskHomatch } from './askConsultant';
import type { FinancingPicture, PictureNote } from '@/mortgage/calculations/financingPicture';

/**
 * The question worth asking about each finding.
 *
 * Only for the ones where a conversation genuinely helps. A missing
 * valuation fee does not need an AI to explain it; why a rate comes out
 * 0.8 points higher than advertised does. See §23 of the brief: a
 * button after every sentence is noise.
 */
const ASK_FOR_NOTE: Readonly<Record<string, string>> = {
  mortgage_picture_rate_gap: 'mortgage_check_effective_rate_ask',
  mortgage_picture_rate_close: 'mortgage_check_effective_rate_ask',
  mortgage_picture_pti_near: 'mortgage_check_monthly_payment_ask',
  mortgage_picture_pti_over: 'mortgage_check_monthly_payment_ask',
  mortgage_picture_ltv_near: 'mortgage_ask_more_down',
  mortgage_picture_ltv_over: 'mortgage_ask_more_down',
  mortgage_picture_fx: 'mortgage_check_currency_risk_ask',
  mortgage_picture_missing_rate_type: 'mortgage_check_rate_type_ask',
  mortgage_picture_missing_early_fee: 'mortgage_check_early_repayment_ask',
};

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
      <ul className="mt-2 space-y-3">
        {notes.map((note) => {
          const askKey = ASK_FOR_NOTE[note.key];
          return (
            <li key={note.key} className="text-sm leading-relaxed text-foreground">
              {/* A note's variables may themselves be translation keys — a
                  rate type is an enum in the engine and a word on the
                  screen — so those are resolved before interpolation. */}
              <span className="block">
                {t(note.key, {
                  ...note.vars,
                  ...Object.fromEntries(
                    Object.entries(note.varKeys ?? {}).map(([name, key]) => [name, t(key)]),
                  ),
                })}
              </span>
              {askKey ? <AskHomatch question={t(askKey)} className="mt-2" /> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function FinancingPictureView({ picture }: { picture: FinancingPicture }) {
  const { t } = useLanguage();
  const currency = picture.currency;

  const slots: {
    labelKey: string;
    subKey?: string;
    value: number | null;
    kind: 'money' | 'percent';
    decimals?: number;
    emphasis?: boolean;
  }[] = [
    { labelKey: 'mortgage_pic_price', value: picture.propertyPrice, kind: 'money' },
    { labelKey: 'mortgage_pic_down', value: picture.downPayment, kind: 'money' },
    { labelKey: 'mortgage_pic_loan', value: picture.loanAmount, kind: 'money' },
    { labelKey: 'mortgage_pic_payment', value: picture.monthlyPayment, kind: 'money', emphasis: true },
    { labelKey: 'mortgage_pic_effective', value: picture.effectiveAnnualRatePercent, kind: 'percent', decimals: 2 },
    { labelKey: 'mortgage_pic_total_cost', value: picture.totalFinancingCost, kind: 'money' },
    { labelKey: 'mortgage_pic_pti', subKey: 'mortgage_pic_pti_sub', value: picture.ptiPercent, kind: 'percent', decimals: 1 },
    { labelKey: 'mortgage_pic_ltv', subKey: 'mortgage_pic_ltv_sub', value: picture.ltvPercent, kind: 'percent', decimals: 1 },
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
            {slot.subKey ? (
              <p className="mt-1 text-2xs leading-tight text-muted-foreground">{t(slot.subKey)}</p>
            ) : null}
          </div>
        ))}
      </div>

      {picture.known.length || picture.attention.length || picture.missing.length ? (
        <div className="grid gap-6 border-t border-border px-5 py-5 lg:grid-cols-3">
          <NoteList
            notes={picture.known}
            titleKey="mortgage_pic_known"
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
