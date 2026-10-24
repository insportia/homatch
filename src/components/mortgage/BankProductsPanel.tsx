// HOMATCH HOME FINANCING — bank products, verified only.
//
// The products an admin has checked against the bank's own published page, inside their review
// window. Nothing else: no scraped rates, no "best bank". When nothing is verified the panel says
// so plainly. A product can be added to the offer comparison as an alternative scenario; it then
// runs through the same engine as any offer the person typed, at the product's starting rate.

import React, { useEffect, useState } from 'react';
import { ExternalLink, Landmark, Plus } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { formatPercent, intlLocaleFor } from '@/components/workspace/primitives';
import { listPublicBankProducts, type PublicBankProduct } from '@/services/mortgageBankProductsPublic';
import type { MortgageOffer } from '@/mortgage/types';

export function bankProductAsOffer(p: PublicBankProduct, loanAmount: number, termMonths: number): MortgageOffer | null {
  if (p.rateFromPercent === null) return null;
  const term = Math.min(Math.max(termMonths, p.minTermMonths ?? termMonths), p.maxTermMonths ?? termMonths);
  return {
    offerName: `${p.bankName} · ${p.productName}`,
    source: 'BANK_PUBLISHED',
    loanAmount,
    currency: p.currency,
    termMonths: term,
    nominalAnnualRatePercent: p.rateFromPercent,
    effectiveAnnualRatePercent: p.effectiveRateFromPercent,
    ...(p.rateType ? { rateType: p.rateType } : {}),
  };
}

export function BankProductsPanel({ currency, loanAmount, termMonths, canAdd, onUse }: {
  currency: string;
  loanAmount: number;
  termMonths: number;
  /** False when the comparison already holds three offers. */
  canAdd: boolean;
  onUse: (offer: MortgageOffer) => void;
}) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const [rows, setRows] = useState<PublicBankProduct[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setRows(null); setFailed(false);
    listPublicBankProducts(currency).then((r) => { if (live) setRows(r); }).catch(() => { if (live) { setRows([]); setFailed(true); } });
    return () => { live = false; };
  }, [currency]);

  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
  const range = (a: number | null, b: number | null) =>
    a === null ? '' : b !== null && b !== a ? t('mortgage_bp_range', { from: formatPercent(a, locale, 2), to: formatPercent(b, locale, 2) }) : formatPercent(a, locale, 2);

  return (
    <section aria-labelledby="bp-title" className="hm-workspace-panel p-5 sm:p-6" data-testid="mortgage-bank-products">
      <h3 id="bp-title" className="flex items-center gap-2 font-display text-base font-semibold text-foreground">
        <Landmark className="h-4 w-4 text-[hsl(var(--gold-ink))]" aria-hidden="true" />{t('mortgage_bp_title', { currency })}
      </h3>
      <p className="mt-1 max-w-[60ch] text-sm text-muted-foreground">{t('mortgage_bp_sub')}</p>
      {rows === null ? (
        <p className="mt-3 text-sm text-muted-foreground" role="status">{t('mortgage_bp_loading')}</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-border px-4 py-4 text-sm text-muted-foreground">
          {t(failed ? 'mortgage_bp_failed' : 'mortgage_bp_empty')}
        </p>
      ) : (
        <ul className="mt-3 grid gap-3">
          {rows.map((p) => {
            const offer = bankProductAsOffer(p, loanAmount, termMonths);
            return (
              <li key={p.id} className="rounded-xl border border-border bg-background p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">{p.bankName}</p>
                    <p className="text-sm text-muted-foreground">{p.productName}</p>
                  </div>
                  {p.rateFromPercent !== null ? (
                    <p className="text-end text-sm">
                      <span className="block text-xs text-muted-foreground">{t('mortgage_bp_rate')}</span>
                      <span className="font-semibold tabular-nums text-foreground">{range(p.rateFromPercent, p.rateToPercent)}</span>
                    </p>
                  ) : null}
                </div>
                <dl className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                  {p.effectiveRateFromPercent !== null ? <div>{t('mortgage_bp_effective')}: <span className="text-foreground">{formatPercent(p.effectiveRateFromPercent, locale, 2)}</span></div> : null}
                  {p.minDownPaymentPercent !== null ? <div>{t('mortgage_bp_down')}: <span className="text-foreground">{formatPercent(p.minDownPaymentPercent, locale, 0)}</span></div> : null}
                  {p.maxTermMonths !== null ? <div>{t('mortgage_bp_term', { years: Math.round(p.maxTermMonths / 12) })}</div> : null}
                  {p.rateType ? <div>{t(`mortgage_rate_type_${p.rateType.toLowerCase()}`)}</div> : null}
                </dl>
                {p.notes ? <p className="mt-2 text-xs text-muted-foreground">{p.notes}</p> : null}
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-[hsl(var(--gold-ink))] underline underline-offset-4">
                    {t('mortgage_bp_source', { date: date(p.verifiedAt) })}<ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                  {offer ? (
                    <button type="button" disabled={!canAdd} onClick={() => onUse(offer)}
                      className={cn('inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[hsl(var(--gold-border))] px-4 text-sm font-medium text-[hsl(var(--gold-ink))]', !canAdd && 'cursor-not-allowed opacity-60')}>
                      <Plus className="h-4 w-4" aria-hidden="true" />{t('mortgage_bp_use')}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">{t('mortgage_bp_disclaimer')}</p>
    </section>
  );
}
