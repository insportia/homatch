import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { getBudgetOffer, formatCredits } from '@/services/billing';
import type { BudgetOffer } from '@/types/billing';
import { Loader2, Search, Wallet, Sparkles, Info } from 'lucide-react';

/**
 * WHAT A CUSTOMER SEES WHEN THEIR BALANCE IS SMALLER THAN THE ESTIMATE.
 *
 * Not "insufficient balance". The server decides which of three things is
 * true, and this renders it:
 *
 *   PAYG_FULL       the balance covers the estimate; run it
 *   PAYG_PARTIAL    offer the search their balance CAN buy
 *   TOPUP_REQUIRED  below the minimum useful budget; ask for a top-up rather
 *                   than spending their last Credits on a search that cannot
 *                   produce anything worth having
 *
 * A partial budget produces a deliberately SCOPED search, not a full one that
 * gets interrupted. That distinction is said out loud, because a customer who
 * thinks they bought a cut-off search will reasonably feel short-changed, and
 * a customer who knows they bought a focused one will not.
 *
 * The authorised figure is a MAXIMUM. Settlement charges actual usage and
 * releases the rest, which is why "you only pay for actual usage" appears next
 * to every number on this screen.
 */
export function SearchBudgetOffer({
  productCode,
  expectedUnits = 1,
  onRun,
  running = false,
}: {
  productCode: string;
  expectedUnits?: number;
  /** Called with the budget the customer authorised, or null for an included run. */
  onRun: (authorizedMaxCredits: number | null) => void;
  running?: boolean;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [offer, setOffer] = useState<BudgetOffer | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getBudgetOffer(productCode, expectedUnits)
      .then((o) => { if (alive) setOffer(o); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [productCode, expectedUnits]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/50 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }
  if (!offer) return null;

  const cr = (n: number | undefined) => formatCredits(Number(n ?? 0));

  // An included run: no budget question, no authorisation dialog.
  if (offer.offer === 'INCLUDED') {
    return (
      <div className="rounded-lg border border-gold/40 bg-gold-soft/30 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-gold-ink" />
          {t('cost_included_run')}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('included_remaining')
            .replace('{n}', String(offer.included_remaining))
            .replace('{total}', String(offer.included_remaining))}
        </p>
        <Button className="mt-3 w-full" onClick={() => onRun(null)} disabled={running}>
          {running && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
          <Search className="me-2 h-4 w-4" />
          {t('budget_cta_full')}
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">{t('budget_results_included')}</p>
      </div>
    );
  }

  if (offer.offer === 'TOPUP_REQUIRED') {
    return (
      <div className="rounded-lg border border-border/70 bg-muted/30 p-4">
        <p className="text-sm font-semibold">{t('budget_topup_title')}</p>
        <p className="mt-1.5 text-sm text-muted-foreground" dir="auto">
          {t('budget_topup_body')
            .replace('{n}', cr(offer.min_viable_budget_credits))
            .replace('{b}', `${cr(offer.available_balance)} ${t('cost_credits')}`)}
        </p>
        <Button className="mt-3 w-full bg-gold text-background hover:bg-gold/90" onClick={() => navigate('/credits')}>
          <Wallet className="me-2 h-4 w-4" />
          {t('cta_top_up')}
        </Button>
      </div>
    );
  }

  if (offer.offer === 'UNAVAILABLE') {
    return (
      <div className="rounded-lg border border-border/70 bg-muted/30 p-4 text-sm text-muted-foreground">
        {t('billing_payg_disabled')}
      </div>
    );
  }

  // PAYG_FULL and PAYG_PARTIAL share a shape; only the framing differs.
  const partial = offer.offer === 'PAYG_PARTIAL';
  const authorized = Number(offer.offered_authorized_max_credits ?? offer.authorized_max_credits ?? 0);

  return (
    <div className="rounded-lg border border-border/70 bg-card/60 p-4">
      <p className="text-sm font-semibold">
        {partial ? t('budget_partial_title') : t('budget_full_title')}
      </p>

      {partial ? (
        <p className="mt-1.5 text-sm text-muted-foreground" dir="auto">
          {t('budget_partial_body').replace('{n}', cr(authorized))}
        </p>
      ) : (
        <div className="mt-2 space-y-1 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">{t('cost_estimated_usage')}</span>
            <span className="font-medium" dir="ltr">
              {cr(offer.estimate_min_credits)}–{cr(offer.estimate_max_credits)} {t('cost_credits')}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">{t('cost_max_reserved')}</span>
            <span className="font-medium" dir="ltr">{cr(authorized)} {t('cost_credits')}</span>
          </div>
        </div>
      )}

      <p className="mt-2 text-xs text-muted-foreground">{t('cost_only_actual')}</p>

      {partial && (
        // Said plainly: this is a focused search, not a truncated one. It is
        // also where the truthfulness guarantee is restated, because a smaller
        // budget must never read as "a less honest answer".
        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          {t('budget_scoped_note')}
        </p>
      )}

      <Button className="mt-3 w-full" onClick={() => onRun(authorized)} disabled={running || authorized <= 0}>
        {running && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
        <Search className="me-2 h-4 w-4" />
        {partial
          ? t('budget_cta_partial').replace('{n}', cr(authorized))
          : t('budget_cta_full')}
      </Button>

      {partial && (
        <>
          <Separator className="my-3" />
          <Button variant="outline" className="w-full" onClick={() => navigate('/credits')}>
            <Wallet className="me-2 h-4 w-4" />
            {t('budget_cta_deeper')}
          </Button>
        </>
      )}

      {/* The decision that makes this whole screen honest: the search price
          covers the results, so nothing further is charged to see them. */}
      <p className="mt-3 text-xs text-muted-foreground">{t('budget_results_included')}</p>
    </div>
  );
}
