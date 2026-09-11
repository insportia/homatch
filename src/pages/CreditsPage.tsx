import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Zap, TrendingUp, TrendingDown, CreditCard, ArrowUpRight,
  ArrowDownRight, Clock, Loader2, ExternalLink, Info, Search,
  Send, MessageCircle, ShoppingCart, Lock, Unlock, Sparkles, Gift,
} from 'lucide-react';
import { getCreditAccount, getCreditLedger, getResearchProducts, getMyResearchPurchases } from '@/services/api';
import { getCatalogue, getMyCreditLots, startTopUp, formatCredits } from '@/services/billing';
import { useEntitlements } from '@/hooks/useEntitlements';
import { PlanBadge } from '@/components/billing/PlanBadge';
import type { CreditLot, TopupPack, FirstTopupPromo } from '@/types/billing';
import { purchaseResearchProduct } from '@/services/api3';
import type { CreditAccount, CreditLedgerEntry, LedgerType, ResearchProduct, ResearchPurchase } from '@/types/types';
import { toast } from 'sonner';

// Top-up amounts come from topup_packs, not from this file. The old
// [30, 50, 100, 200] was both a hardcoded offer and, after the
// redenomination, the wrong currency scale entirely. These are only a
// fallback for the moment before the catalogue arrives.
const FALLBACK_PACKS: TopupPack[] = [
  { code: 'USD_1', amount_cents: 100, credits: 10, sort_order: 1 },
  { code: 'USD_5', amount_cents: 500, credits: 50, sort_order: 2 },
  { code: 'USD_10', amount_cents: 1000, credits: 100, sort_order: 3 },
  { code: 'USD_25', amount_cents: 2500, credits: 250, sort_order: 4 },
];

const LOT_LABEL: Record<string, string> = {
  PURCHASED: 'wallet_bucket_purchased',
  MEMBERSHIP: 'wallet_bucket_membership',
  PROMOTIONAL: 'wallet_bucket_promotional',
  ADJUSTMENT: 'wallet_bucket_adjustment',
};

// Label text is localized via `labelKey` (translated at render time) rather
// than baked in here, so every ledger type reads correctly in all 6 languages.
const LEDGER_TYPE_CONFIG: Record<LedgerType, { labelKey: string; icon: React.ElementType; color: string }> = {
  TOP_UP:            { labelKey: 'credits_type_topup',           icon: ArrowUpRight,   color: 'text-green-400' },
  MATCH_UNLOCK:      { labelKey: 'credits_type_unlock',          icon: ArrowDownRight, color: 'text-destructive' },
  REFUND:            { labelKey: 'credits_type_refund',          icon: ArrowUpRight,   color: 'text-blue-400' },
  ADMIN_ADJUSTMENT:  { labelKey: 'credits_type_adjustment',      icon: ArrowUpRight,   color: 'text-muted-foreground' },
  SERVICE_RESERVE:   { labelKey: 'credits_type_service_reserve', icon: Lock,           color: 'text-amber-500' },
  SERVICE_CAPTURE:   { labelKey: 'credits_type_service_capture', icon: ShoppingCart,   color: 'text-muted-foreground' },
  SERVICE_RELEASE:   { labelKey: 'credits_type_service_release', icon: Unlock,         color: 'text-blue-400' },
  MEMBERSHIP_GRANT:  { labelKey: 'credits_type_membership_grant', icon: Sparkles,       color: 'text-gold-ink' },
  PROMOTIONAL_GRANT: { labelKey: 'credits_type_promotional_grant',icon: Gift,           color: 'text-gold-ink' },
  FIRST_TOPUP_BONUS: { labelKey: 'credits_type_first_topup_bonus',icon: Gift,           color: 'text-gold-ink' },
  EXPIRATION:        { labelKey: 'credits_type_expiration',       icon: Clock,          color: 'text-muted-foreground' },
  REVERSAL:          { labelKey: 'credits_type_reversal',         icon: ArrowUpRight,   color: 'text-blue-400' },
  // The one-off 1 Credit = $1.00 -> $0.10 rescale. Its own label so it is
  // never mistaken for a top-up or a gift in a customer's history.
  REDENOMINATION:    { labelKey: 'credits_type_redenomination',   icon: TrendingUp,     color: 'text-muted-foreground' },
};

const PRODUCT_ICON: Record<string, React.ElementType> = {
  TELEGRAM: Send, FACEBOOK: MessageCircle, GOOGLE: Search,
};

function LedgerRow({ entry }: { entry: CreditLedgerEntry }) {
  const { t } = useLanguage();
  const cfg = LEDGER_TYPE_CONFIG[entry.type] ?? LEDGER_TYPE_CONFIG.ADMIN_ADJUSTMENT;
  const Icon = cfg.icon;
  const isDebit = entry.amount < 0;

  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
          isDebit ? 'bg-destructive/10' : 'bg-green-500/10'
        }`}>
          <Icon className={`h-4 w-4 ${cfg.color}`} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground break-words">{t(cfg.labelKey)}</p>
          {entry.reference && (
            <p className="text-xs text-muted-foreground truncate">{entry.reference}</p>
          )}
          <p className="text-xs text-muted-foreground/60 flex items-center gap-1 mt-0.5">
            <Clock className="h-3 w-3" />
            {new Date(entry.created_at).toLocaleString()}
          </p>
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className={`text-sm font-semibold ${isDebit ? 'text-destructive' : 'text-green-400'}`} dir="ltr">
          {isDebit ? '' : '+'}{entry.amount.toFixed(2)} CR
        </p>
        <p className="text-xs text-muted-foreground">{entry.balance_after.toFixed(2)} {t('credits_ledger_balance_suffix')}</p>
      </div>
    </div>
  );
}

function CreditsContent() {
  const { homatchUser } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const ent = useEntitlements();

  const [creditAccount, setCreditAccount] = useState<CreditAccount | null>(null);
  const [ledger, setLedger] = useState<CreditLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTopUp, setShowTopUp] = useState(false);
  const [packs, setPacks] = useState<TopupPack[]>(FALLBACK_PACKS);
  const [promo, setPromo] = useState<FirstTopupPromo | null>(null);
  const [minCents, setMinCents] = useState(100);
  const [selectedPack, setSelectedPack] = useState<string>('USD_10');
  const [lots, setLots] = useState<CreditLot[]>([]);
  const [topUpLoading, setTopUpLoading] = useState(false);
  const [topUpResult, setTopUpResult] = useState<{ mock?: boolean; checkoutUrl?: string } | null>(null);
  const [products, setProducts] = useState<ResearchProduct[]>([]);
  const [purchases, setPurchases] = useState<ResearchPurchase[]>([]);
  const [purchasing, setPurchasing] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!homatchUser) return;
    setLoading(true);
    const [account, entries, prods, myPurchases, myLots] = await Promise.all([
      getCreditAccount(homatchUser.id),
      getCreditLedger(homatchUser.id),
      getResearchProducts(),
      getMyResearchPurchases(),
      getMyCreditLots(homatchUser.id),
    ]);
    setCreditAccount(account);
    setLedger(entries);
    setProducts(prods.filter(p => p.enabled));
    setPurchases(myPurchases);
    setLots(myLots);
    // The offer itself is server-defined: amounts, the bonus rule and the
    // minimum all come from topup_packs / promotions / admin_settings.
    try {
      const cat = await getCatalogue();
      if (cat.topupPacks?.length) setPacks(cat.topupPacks);
      setPromo(cat.firstTopupPromo);
      const smallest = cat.topupPacks?.[0]?.amount_cents;
      if (smallest) setMinCents(smallest);
    } catch { /* fallback packs already shown */ }
    setLoading(false);
  }, [homatchUser]);

  useEffect(() => { loadData(); }, [loadData]);

  // Read top-up result from URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('topup') === 'success') {
      toast.success(t('credits_toast_payment_success'));
      window.history.replaceState({}, '', '/credits');
      setTimeout(loadData, 2000);
    } else if (params.get('topup') === 'cancelled') {
      toast.info(t('credits_toast_payment_cancelled'));
      window.history.replaceState({}, '', '/credits');
    }
  }, [loadData, t]);

  const handleTopUp = async () => {
    setTopUpLoading(true);
    // Send the PACK CODE, not an amount. The server then prices from
    // topup_packs and a tampered request cannot buy credits it did not pay for.
    const result = await startTopUp({ packCode: selectedPack });
    setTopUpLoading(false);

    if (!result.success) {
      toast.error(result.error ?? t('credits_toast_topup_failed'));
      return;
    }

    if (result.mock) {
      // Show mock info instead of redirecting
      setTopUpResult({ mock: true, checkoutUrl: result.checkoutUrl });
    } else if (result.checkoutUrl) {
      window.location.href = result.checkoutUrl;
    }
  };

  const handlePurchase = async (code: string) => {
    setPurchasing(code);
    try {
      await purchaseResearchProduct(code);
      toast.success(t('research_purchase_success'));
      loadData();
    } catch (e: any) {
      toast.error(e?.message === 'Insufficient credits' ? t('research_purchase_insufficient') : t('research_purchase_failed'));
    } finally {
      setPurchasing(null);
    }
  };

  const balance = Number(creditAccount?.balance ?? 0);
  const totalSpent = ledger
    .filter(e => e.amount < 0)
    .reduce((s, e) => s + Math.abs(e.amount), 0);
  const totalTopUps = ledger
    .filter(e => e.type === 'TOP_UP')
    .reduce((s, e) => s + e.amount, 0);

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">{t('credits_title')}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{t('credits_topup_desc')}</p>
          </div>
          <Button
            onClick={() => setShowTopUp(true)}
            className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold h-9 shrink-0"
          >
            <Zap className="h-4 w-4 mr-1.5" />
            {t('credits_topup_btn')}
          </Button>
        </div>

        {/* Balance card */}
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground mb-1">{t('credits_balance')}</p>
                {loading ? (
                  <div className="h-10 w-32 bg-muted rounded animate-pulse" />
                ) : (
                  <p className="text-4xl font-semibold text-primary" dir="ltr">{balance.toFixed(2)}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">{t('credits_balance_unit')}</p>
                {/* A credit's dollar value, from the server, so this line
                    stays right if credits_per_usd is ever changed. */}
                {ent.creditsPerUsd > 0 && (
                  <p className="text-xs text-muted-foreground mt-1" dir="auto">
                    {t('credits_value_line').replace('{v}', `$${(1 / ent.creditsPerUsd).toFixed(2)}`)}
                  </p>
                )}
                {ent.reserved > 0 && (
                  <p className="text-xs text-amber-500 mt-1.5" dir="auto">
                    {t('wallet_reserved')}: {formatCredits(ent.reserved)} CR
                  </p>
                )}
              </div>
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Zap className="h-8 w-8 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="h-4 w-4 text-green-400" />
                <span className="text-xs text-muted-foreground">{t('credits_stat_topped_up')}</span>
              </div>
              <p className="text-xl font-semibold text-foreground" dir="ltr">{totalTopUps.toFixed(2)} CR</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingDown className="h-4 w-4 text-destructive" />
                <span className="text-xs text-muted-foreground">{t('credits_stat_spent')}</span>
              </div>
              <p className="text-xl font-semibold text-foreground" dir="ltr">{totalSpent.toFixed(2)} CR</p>
            </CardContent>
          </Card>
        </div>

        {/* Research products */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              {t('research_products_title')}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t('research_products_desc')}</p>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />)
            ) : (
              products.map(p => {
                const Icon = PRODUCT_ICON[p.category] ?? Search;
                const priceUsd = (p.price_cents / 100).toFixed(2);
                const active = purchases.find(pu => pu.product_code === p.code && pu.status === 'ACTIVE');
                return (
                  <div key={p.code} className="flex items-center gap-3 p-3 rounded-lg border border-border">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        ${priceUsd} · {t('research_vat_included')}
                        {active && <span className="ms-1.5 text-primary">· {active.units_remaining.toLocaleString()} {t('research_units_remaining')}</span>}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 text-xs gap-1.5"
                      disabled={purchasing === p.code || balance < p.price_cents / 100}
                      onClick={() => handlePurchase(p.code)}
                    >
                      {purchasing === p.code ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShoppingCart className="h-3.5 w-3.5" />}
                      {t('research_purchase_btn')}
                    </Button>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
        {/* Where the balance came from.
            Purchased credits never expire and survive a cancelled membership;
            membership and bonus credits carry their own expiry. Showing one
            undifferentiated number would hide both facts. */}
        {lots.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                {t('wallet_where_from')}
                <PlanBadge planCode={ent.plan} size="sm" />
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="divide-y divide-border">
                {lots.map((lot) => (
                  <div key={lot.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{t(LOT_LABEL[lot.kind] ?? 'wallet_bucket_adjustment')}</p>
                      <p className="text-xs text-muted-foreground">
                        {lot.expires_at
                          ? t('wallet_expires_on').replace('{d}', new Date(lot.expires_at).toLocaleDateString())
                          : t('wallet_never_expires')}
                      </p>
                    </div>
                    <p className="text-sm font-semibold shrink-0" dir="ltr">
                      {formatCredits(lot.credits_available)} CR
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">{t('wallet_purchased_safe')}</p>
            </CardContent>
          </Card>
        )}


        {/* Transaction history */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              {t('credits_ledger_title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="space-y-3 py-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="flex items-center gap-3 animate-pulse">
                    <div className="w-8 h-8 rounded-full bg-muted" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3.5 bg-muted rounded w-1/3" />
                      <div className="h-3 bg-muted rounded w-1/2" />
                    </div>
                    <div className="h-4 bg-muted rounded w-16" />
                  </div>
                ))}
              </div>
            ) : ledger.length === 0 ? (
              <div className="py-8 text-center">
                <CreditCard className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">{t('credits_ledger_empty')}</p>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {ledger.map((entry, i) => (
                  <LedgerRow key={entry.id ?? i} entry={entry} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pricing info */}
        <div className="rounded-lg border border-border/50 bg-secondary/30 p-4 flex items-start gap-3">
          <Info className="h-4 w-4 text-muted-foreground/60 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium">{t('credits_pricing_title')}</p>
            <p className="text-xs text-muted-foreground/70">{t('credits_pricing_desc')}</p>
          </div>
        </div>
      </div>

      {/* Top-up Dialog */}
      <Dialog open={showTopUp} onOpenChange={open => { setShowTopUp(open); if (!open) setTopUpResult(null); }}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              {t('credits_topup_title')}
            </DialogTitle>
            <DialogDescription>{t('credits_topup_desc')}</DialogDescription>
          </DialogHeader>

          {topUpResult ? (
            /* Mock result */
            <div className="space-y-4 py-2">
              <div className="rounded-lg bg-secondary/50 border border-border p-4 space-y-2">
                <p className="text-sm font-medium text-foreground">{t('credits_mock_session_created')}</p>
                <p className="text-xs text-muted-foreground">{t('credits_topup_mock_note')}</p>
                {topUpResult.checkoutUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="border border-border gap-1.5 text-xs"
                    onClick={() => window.open(topUpResult.checkoutUrl, '_blank')}
                  >
                    <ExternalLink className="h-3 w-3" />
                    {t('credits_view_mock_url')}
                  </Button>
                )}
              </div>
              <Button onClick={() => setShowTopUp(false)} className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
                {t('general_close')}
              </Button>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              {/* Presets */}
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">{t('credits_quick_select')}</Label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {packs.map((pack) => {
                    const selected = selectedPack === pack.code;
                    const bonus = promo && pack.amount_cents >= promo.min_amount_cents
                      ? Math.min((pack.credits * promo.bonus_match_bps) / 10000, Number(promo.max_bonus_credits))
                      : 0;
                    return (
                      <button
                        key={pack.code}
                        onClick={() => setSelectedPack(pack.code)}
                        className={`relative rounded-lg border py-2.5 text-sm font-semibold transition-all ${
                          selected
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-secondary text-foreground hover:border-primary/50'
                        }`}
                        dir="ltr"
                      >
                        ${(pack.amount_cents / 100).toFixed(pack.amount_cents % 100 === 0 ? 0 : 2)}
                        <span className="block text-[12px] font-normal text-muted-foreground">
                          {formatCredits(pack.credits + bonus)} CR
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* The activation offer, when this account still has it. Whether
                  it is still available is decided by billing_entitlements()
                  against promotion_redemptions, never in the browser. */}
              {promo && (
                <div className="rounded-lg border border-gold/40 bg-gold-soft/30 p-3">
                  <p className="text-sm font-semibold">{t('activation_double_value')}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t('activation_once')}</p>
                </div>
              )}

              {(() => {
                const pack = packs.find((x) => x.code === selectedPack) ?? packs[0];
                if (!pack) return null;
                const bonus = promo && pack.amount_cents >= promo.min_amount_cents
                  ? Math.min((pack.credits * promo.bonus_match_bps) / 10000, Number(promo.max_bonus_credits))
                  : 0;
                return (
                  <div className="rounded-lg bg-secondary/50 border border-border p-3 space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t('credits_amount_label')}</span>
                      <span className="font-medium text-foreground" dir="ltr">
                        ${(pack.amount_cents / 100).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t('credits_credits_to_add')}</span>
                      <span className="font-semibold text-primary" dir="ltr">{formatCredits(pack.credits)} CR</span>
                    </div>
                    {bonus > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{t('activation_bonus_part').replace('{n}', '')}</span>
                        <span className="font-semibold text-gold-ink" dir="ltr">+{formatCredits(bonus)} CR</span>
                      </div>
                    )}
                    <Separator className="my-1 bg-border" />
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t('credits_balance_after')}</span>
                      <span className="font-semibold text-foreground" dir="ltr">
                        {formatCredits(balance + pack.credits + bonus)} CR
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {!topUpResult && (
            <DialogFooter className="gap-2">
              <Button variant="ghost" className="border border-border" onClick={() => setShowTopUp(false)}>
                {t('general_cancel')}
              </Button>
              <Button
                onClick={handleTopUp}
                disabled={topUpLoading || !selectedPack}
                className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
              >
                {topUpLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : (
                  <CreditCard className="h-4 w-4 mr-1.5" />
                )}
                {t('credits_topup_confirm')}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

export default function CreditsPage() {
  return (
    <RouteGuard>
      <CreditsContent />
    </RouteGuard>
  );
}
