// HOMATCH HOME FINANCING — two or three offers, side by side.
//
// THERE IS NO BEST BANK HERE, AND THERE WILL NOT BE ONE
//
// The engine already refuses to produce one: every label it emits is a
// specific, defensible comparison ("lower monthly payment", "lower total
// cost under these assumptions") and it says so explicitly when the
// currencies or terms differ enough that the totals are not comparable
// at all. This view's job is to render that refusal legibly rather than
// to quietly re-introduce a ranking through visual weight — which is
// why no card is highlighted as a winner and the labels sit on all of
// them equally.
//
// MOBILE IS CARDS, NOT A THREE-COLUMN TABLE
//
// Three offers × six figures is eighteen cells. At 320px that is a
// horizontal scroll nobody discovers, so below `sm` each offer is its
// own card and the comparison is made by scrolling vertically — which
// is the gesture people already use.

import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { Module, formatMoney, formatPercent, intlLocaleFor } from '@/components/workspace/primitives';
import { SourceBadge } from '@/components/workspace/controls';
import { NumberField, NameField, StatRow } from '../fields';
import type { PresetContext } from '@/mortgage/presets';
import type { MortgageOffer, OfferComparisonResult, OfferComparisonRow } from '@/mortgage/types';

function blankOffer(loanAmount: number, termMonths: number, currency: string, n: number): MortgageOffer {
  return {
    offerName: `Offer ${n}`,
    source: 'USER_MANUAL_ENTRY',
    loanAmount,
    currency,
    termMonths,
    nominalAnnualRatePercent: 0,
  };
}

function OfferEditor({
  offer,
  index,
  onChange,
  onRemove,
  context,
}: {
  offer: MortgageOffer;
  index: number;
  onChange: (offer: MortgageOffer) => void;
  onRemove: () => void;
  context: PresetContext;
}) {
  const { t } = useLanguage();
  const patch = (next: Partial<MortgageOffer>) => onChange({ ...offer, ...next });

  return (
    <div className="rounded-xl border border-border bg-[hsl(var(--secondary))] p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="text-2xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--gold-ink))]">
          {t('mortgage_offer_n', { n: index + 1 })}
        </span>
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('mortgage_offer_remove')}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-[hsl(var(--destructive)/0.5)] hover:text-[hsl(var(--destructive))]"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="space-y-5">
        <NameField
          labelKey="mortgage_offer_name"
          value={offer.offerName}
          onChange={(v) => patch({ offerName: v ?? '' })}
        />
        <NumberField
          field="offerRate"
          labelKey="mortgage_label_nominal_rate"
          kind="percent"
          currency={offer.currency}
          value={offer.nominalAnnualRatePercent || null}
          onChange={(v) => patch({ nominalAnnualRatePercent: v ?? 0 })}
          context={context}
          required
        />
        <NumberField
          field="offerEffectiveRate"
          labelKey="mortgage_label_effective_rate_bank"
          hintKey="mortgage_offer_effective_hint"
          kind="percent"
          currency={offer.currency}
          value={offer.effectiveAnnualRatePercent ?? null}
          onChange={(v) => patch({ effectiveAnnualRatePercent: v })}
          context={context}
        />
        <NumberField
          field="originationFeePercent"
          labelKey="mortgage_label_origination_fee_percent"
          kind="percent"
          currency={offer.currency}
          value={offer.originationFeePercent ?? null}
          onChange={(v) => patch({ originationFeePercent: v ?? undefined })}
          context={context}
        />
        <NumberField
          field="monthlyFeeFlat"
          labelKey="mortgage_label_monthly_fee"
          kind="money"
          currency={offer.currency}
          value={offer.recurringMonthlyFeeFlat ?? null}
          onChange={(v) => patch({ recurringMonthlyFeeFlat: v ?? undefined })}
          context={context}
        />
        <NumberField
          field="mandatoryInsuranceAnnualFlat"
          labelKey="mortgage_label_insurance_annual"
          kind="money"
          currency={offer.currency}
          value={offer.mandatoryInsuranceAnnualFlat ?? null}
          onChange={(v) => patch({ mandatoryInsuranceAnnualFlat: v ?? undefined })}
          context={context}
        />
        <NumberField
          field="termMonths"
          labelKey="mortgage_label_term"
          kind="months"
          currency={offer.currency}
          value={offer.termMonths}
          onChange={(v) => patch({ termMonths: v ?? offer.termMonths })}
          context={context}
        />
      </div>
    </div>
  );
}

function effectiveCell(row: OfferComparisonRow, locale: string, t: (k: string) => string) {
  if (row.effectiveAnnualRatePercent === null) return t('mortgage_offer_effective_unavailable');
  return formatPercent(row.effectiveAnnualRatePercent, locale, 2);
}

export function OffersView({
  offers,
  comparison,
  onAdd,
  onUpdate,
  onRemove,
  loanAmount,
  termMonths,
  currency,
  context,
}: {
  offers: MortgageOffer[];
  comparison: OfferComparisonResult | null;
  onAdd: (offer: MortgageOffer) => void;
  onUpdate: (index: number, offer: MortgageOffer) => void;
  onRemove: (index: number) => void;
  loanAmount: number;
  termMonths: number;
  currency: string;
  context: PresetContext;
}) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const [editing, setEditing] = useState(true);

  return (
    <>
      <Module
        id="offers-input"
        eyebrowKey="mortgage_mod_offers_eyebrow"
        titleKey="mortgage_mod_offers_title"
        subtitleKey="mortgage_mod_offers_sub"
        actions={
          offers.length < 3 ? (
            <button
              type="button"
              onClick={() => {
                onAdd(blankOffer(loanAmount, termMonths, currency, offers.length + 1));
                setEditing(true);
              }}
              className="flex min-h-11 items-center gap-2 rounded-full bg-[hsl(var(--gold))] px-4 text-xs font-medium text-[hsl(var(--primary-foreground))] transition-colors hover:bg-[hsl(var(--gold-hover))]"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {t('mortgage_offer_add')}
            </button>
          ) : null
        }
      >
        {offers.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            {t('mortgage_offers_empty')}
          </p>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="mb-4 min-h-11 rounded-full border border-border px-4 text-xs text-muted-foreground transition-colors hover:border-[hsl(var(--gold-border))] hover:text-foreground"
            >
              {editing ? t('mortgage_offers_hide_inputs') : t('mortgage_offers_show_inputs')}
            </button>
            {editing ? (
              <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                {offers.map((offer, index) => (
                  <OfferEditor
                    key={index}
                    offer={offer}
                    index={index}
                    onChange={(next) => onUpdate(index, next)}
                    onRemove={() => onRemove(index)}
                    context={context}
                  />
                ))}
              </div>
            ) : null}
          </>
        )}
      </Module>

      {comparison ? (
        <Module
          id="offers-compare"
          eyebrowKey="mortgage_mod_compare_eyebrow"
          titleKey="mortgage_mod_compare_title"
          subtitleKey="mortgage_mod_compare_sub"
        >
          {!comparison.assumptionsComparable ? (
            <div className="mb-5 rounded-lg border border-[hsl(var(--warning)/0.45)] bg-[hsl(var(--gold-soft))] px-4 py-3">
              <p className="text-sm font-medium text-[hsl(var(--gold-ink))]">
                {t('mortgage_offers_incomparable_title')}
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {comparison.incomparabilityReasons.map((key) => (
                  <li key={key} className="text-2xs leading-relaxed text-[hsl(var(--gold-ink))]">
                    {t(key)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Cards on a phone. */}
          <div className="space-y-3 lg:hidden">
            {comparison.rows.map((row, index) => (
              <div key={index} className="rounded-xl border border-border bg-[hsl(var(--secondary))] p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-display text-base font-semibold text-foreground">
                    {row.offer.offerName}
                  </span>
                  <span className="flex items-center gap-1.5 text-sm tabular-nums text-foreground">
                    {effectiveCell(row, locale, t)}
                    <SourceBadge
                      source={row.effectiveRateSource === 'BANK_SUPPLIED' ? 'USER' : 'CALCULATED'}
                    />
                  </span>
                </div>
                <div className="mt-3">
                  <StatRow
                    labelKey="mortgage_metric_monthly_payment"
                    value={row.monthlyPayment}
                    kind="money"
                    currency={row.offer.currency}
                  />
                  <StatRow
                    labelKey="mortgage_offer_initial_costs"
                    value={row.initialCosts}
                    kind="money"
                    currency={row.offer.currency}
                  />
                  <StatRow
                    labelKey="mortgage_offer_recurring"
                    value={row.recurringMonthlyCosts}
                    kind="money"
                    currency={row.offer.currency}
                  />
                  <StatRow
                    labelKey="mortgage_metric_total_repayment"
                    value={row.totalRepayment}
                    kind="money"
                    currency={row.offer.currency}
                  />
                  <StatRow
                    labelKey="mortgage_offer_total_financing_cost"
                    value={row.totalFinancingCost}
                    kind="money"
                    currency={row.offer.currency}
                  />
                </div>
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {row.labels.map((key) => (
                    <li
                      key={key}
                      className="rounded-full border border-border px-2.5 py-1 text-2xs text-muted-foreground"
                    >
                      {t(key)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* One column per offer from `lg` up. */}
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full text-sm">
              <caption className="sr-only">{t('mortgage_mod_compare_title')}</caption>
              <thead>
                <tr>
                  <th scope="col" className="py-2 text-start text-2xs uppercase tracking-wide text-muted-foreground">
                    {t('mortgage_offer_column')}
                  </th>
                  {comparison.rows.map((row, index) => (
                    <th key={index} scope="col" className="py-2 text-end font-display text-base text-foreground">
                      {row.offer.offerName}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { key: 'mortgage_offer_effective_rate', render: (r: OfferComparisonRow) => effectiveCell(r, locale, t) },
                  { key: 'mortgage_metric_monthly_payment', render: (r: OfferComparisonRow) => formatMoney(r.monthlyPayment, r.offer.currency, locale) },
                  { key: 'mortgage_offer_initial_costs', render: (r: OfferComparisonRow) => formatMoney(r.initialCosts, r.offer.currency, locale) },
                  { key: 'mortgage_offer_recurring', render: (r: OfferComparisonRow) => formatMoney(r.recurringMonthlyCosts, r.offer.currency, locale) },
                  { key: 'mortgage_metric_total_repayment', render: (r: OfferComparisonRow) => formatMoney(r.totalRepayment, r.offer.currency, locale) },
                  { key: 'mortgage_offer_total_financing_cost', render: (r: OfferComparisonRow) => formatMoney(r.totalFinancingCost, r.offer.currency, locale) },
                ].map((line) => (
                  <tr key={line.key} className="border-t border-border">
                    <th scope="row" className="py-2.5 text-start font-normal text-muted-foreground">
                      {t(line.key)}
                    </th>
                    {comparison.rows.map((row, index) => (
                      <td key={index} className="py-2.5 text-end tabular-nums text-foreground">
                        {line.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="border-t border-border">
                  <th scope="row" className="py-2.5 text-start font-normal text-muted-foreground align-top">
                    {t('mortgage_offer_tradeoffs')}
                  </th>
                  {comparison.rows.map((row, index) => (
                    <td key={index} className="py-2.5 text-end">
                      <ul className="flex flex-wrap justify-end gap-1.5">
                        {row.labels.map((key) => (
                          <li
                            key={key}
                            className="rounded-full border border-border px-2.5 py-1 text-2xs text-muted-foreground"
                          >
                            {t(key)}
                          </li>
                        ))}
                      </ul>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          <p className={cn('mt-5 max-w-[64ch] text-2xs leading-relaxed text-muted-foreground')}>
            {t('mortgage_offers_assumptions_note')}
          </p>
        </Module>
      ) : null}
    </>
  );
}
