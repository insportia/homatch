import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { getQuote, startTopUp, getCatalogue, formatCredits } from '@/services/billing';
import { useEntitlements } from '@/hooks/useEntitlements';
import type { ExecutionQuote, TopupPack } from '@/types/billing';
import { Loader2, Sparkles, Wallet, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';

/**
 * WHAT HAPPENS WHEN THE INCLUDED RUNS ARE GONE.
 *
 * Not a paywall. A continuation.
 *
 * The mandate is specific about this: never disable the product, never tell
 * someone to wait until next month, never force a subscription. So this dialog
 * has three doors and the cheapest one is first: activate a balance for a
 * dollar, or look at VIP, or look at Premium. A customer who wants to spend
 * $500 a month without ever subscribing is a good customer and this screen
 * must not stand in their way.
 *
 * WHO DECIDES THE OFFER
 *
 * Not this component. `first_topup_promo_available` arrives from
 * billing_entitlements(), which checks promotion_redemptions, and the grant
 * itself is made by the payment webhook against unique indexes. This file only
 * renders what the server already decided; nothing here could be edited in a
 * browser to mint a second bonus.
 */
export function ContinueWithCredits({
  open,
  onOpenChange,
  productCode,
  productLabel,
  onFunded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  productCode: string;
  /** Already-translated product name, for the headline. */
  productLabel: string;
  /** Called after a successful top-up so the caller can retry the run. */
  onFunded?: () => void;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const ent = useEntitlements();
  const [quote, setQuote] = useState<ExecutionQuote | null>(null);
  const [packs, setPacks] = useState<TopupPack[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void getQuote(productCode).then(setQuote);
    void getCatalogue().then((c) => setPacks(c.topupPacks)).catch(() => {});
  }, [open, productCode]);

  const includedTotal = ent.forProduct(productCode)?.included_per_period ?? 0;
  const promo = ent.firstTopupAvailable;
  const smallestPack = packs[0];
  const creditsPerUsd = ent.creditsPerUsd || 10;

  // The activation headline, computed from the real pack and the real promo
  // rule rather than from a hardcoded "$1 gets you 20".
  const activationAmount = smallestPack ? smallestPack.amount_cents / 100 : 1;
  const activationBase = smallestPack ? smallestPack.credits : activationAmount * creditsPerUsd;
  const activationTotal = promo ? activationBase * 2 : activationBase;

  const onTopUp = async (packCode?: string) => {
    setBusy(true);
    try {
      const res = await startTopUp(packCode ? { packCode } : { amountUsd: activationAmount });
      if (res.checkoutUrl && !res.mock) {
        window.location.href = res.checkoutUrl;
        return;
      }
      toast.info(res.message ?? res.error ?? t('general_error'));
      onFunded?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('general_error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-balance">
            {includedTotal > 0
              ? t('included_used_title')
                  .replace('{n}', String(includedTotal))
                  .replace('{product}', productLabel)
              : productLabel}
          </DialogTitle>
          <DialogDescription>{t('included_used_body')}</DialogDescription>
        </DialogHeader>

        {/* What this run would cost, before anything is authorised. */}
        {quote?.funding === 'PAYG' && (
          <div className="rounded-lg border border-border/70 bg-muted/30 p-3.5 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t('cost_estimated_usage')}</span>
              <span className="font-medium" dir="ltr">
                {formatCredits(quote.estimate_min_credits)}–{formatCredits(quote.estimate_max_credits)} {t('cost_credits')}
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t('cost_max_reserved')}</span>
              <span className="font-medium" dir="ltr">
                {formatCredits(quote.authorized_max_credits)} {t('cost_credits')}
              </span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{t('cost_only_actual')}</p>
          </div>
        )}

        {/* Door one: activate a balance. Shown first because it is the
            cheapest way to keep going and needs no commitment. */}
        <div className="rounded-lg border border-gold/40 bg-gold-soft/30 p-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-gold-ink" />
            <p className="text-sm font-semibold">
              {promo ? t('activation_double_value') : t('topup_title')}
            </p>
          </div>
          <p className="mt-2 text-sm" dir="auto">
            {t('activation_headline')
              .replace('{a}', `$${activationAmount.toFixed(activationAmount % 1 === 0 ? 0 : 2)}`)
              .replace('{n}', formatCredits(activationTotal))}
          </p>
          {promo && (
            <p className="mt-1 text-xs text-muted-foreground" dir="auto">
              {t('activation_purchased_part').replace('{n}', formatCredits(activationBase))}
              {' · '}
              {t('activation_bonus_part').replace('{n}', formatCredits(activationBase))}
            </p>
          )}
          <Button
            className="mt-3 w-full bg-gold text-background hover:bg-gold/90"
            onClick={() => onTopUp(smallestPack?.code)}
            disabled={busy}
          >
            {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            <Wallet className="me-2 h-4 w-4" />
            {promo ? t('activation_cta') : t('cta_top_up')}
          </Button>
          {promo && (
            <p className="mt-2 text-center text-[13px] text-muted-foreground">{t('activation_once')}</p>
          )}
        </div>

        <Separator />

        {/* Doors two and three. An upgrade is an option, never a gate. */}
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-center">
          <Button variant="outline" className="w-full sm:w-auto" onClick={() => navigate('/pricing')}>
            {t('cta_view_vip')}
            <ArrowRight className="ms-2 h-3.5 w-3.5 rtl:rotate-180" />
          </Button>
          <Button variant="outline" className="w-full sm:w-auto" onClick={() => navigate('/pricing')}>
            {t('cta_view_premium')}
            <ArrowRight className="ms-2 h-3.5 w-3.5 rtl:rotate-180" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
