// Admin → Pricing Configuration: the one Verify retail price.
//
// Enter a USD price, see the credits at the live rate, confirm with a reason.
// The server (admin_set_verify_price) validates, bumps pricing_version and
// writes the change to admin_audit_log; the history below is read from there.
// New purchases use the new price at once; running and already purchased
// reports keep the price they started with. Independent of V1/V2 routing.
import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Confirm } from '@/components/admin/control/AdminKit';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import {
  creditsForCents, fetchVerifyPrice, fetchVerifyPriceHistory, parseUsdToCents, setVerifyPrice,
  type VerifyFixedPrice, type VerifyPriceChange,
} from '@/services/verifyPrice';

const usd = (cents: number | null | undefined) => (cents == null ? '—' : `$${(Number(cents) / 100).toFixed(2)}`);

export function VerifyPriceCard({ creditsPerUsd = 10 }: { creditsPerUsd?: number }) {
  const { t, lang } = useLanguage();
  const [price, setPrice] = useState<VerifyFixedPrice | null>(null);
  const [history, setHistory] = useState<VerifyPriceChange[]>([]);
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [p, h] = await Promise.all([fetchVerifyPrice(), fetchVerifyPriceHistory(10)]);
    setPrice(p);
    setHistory(h);
    if (p?.cents != null) setText((Number(p.cents) / 100).toFixed(2));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const cents = parseUsdToCents(text);
  const credits = creditsForCents(cents, creditsPerUsd);
  const unchanged = cents != null && price?.cents != null && cents === Number(price.cents);
  const fmt = (iso: string) => new Date(iso).toLocaleString(lang === 'ka' ? 'ka-GE' : lang);

  const save = async () => {
    if (cents == null || credits == null) return;
    setSaving(true);
    try {
      const next = await setVerifyPrice(cents, reason.trim());
      setPrice(next);
      toast.success(t('adm_vprice_saved'));
      setConfirming(false);
      setReason('');
      void load();
    } catch (e: any) {
      toast.error(String(e?.message ?? e).includes('PRICE_NOT_WHOLE_CREDITS') ? t('adm_vprice_invalid') : (e?.message ?? String(e)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card data-testid="admin-verify-price">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t('adm_vprice_title')}</CardTitle>
        <CardDescription>{t('adm_vprice_desc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            {price?.mode === 'FIXED' && price.cents != null
              ? t('adm_vprice_active', { usd: usd(price.cents), n: String(price.credits ?? '') })
              : t('adm_vprice_not_fixed')}
          </Badge>
          <Badge variant="secondary">{t('adm_vprice_validity', { days: String(price?.validityDays ?? 30) })}</Badge>
          <Badge variant="secondary">{t('adm_vprice_vat')}</Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_1fr] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="verify-price-usd">{t('adm_vprice_usd')}</Label>
            <Input id="verify-price-usd" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} dir="ltr" />
          </div>
          <p className="min-w-0 break-words text-sm" aria-live="polite">
            {cents == null || credits == null
              ? <span className="text-destructive">{t('adm_vprice_invalid')}</span>
              : <span className="font-semibold">{t('adm_vprice_credits', { n: String(credits) })}</span>}
          </p>
        </div>
        <Button type="button" size="sm" disabled={saving || cents == null || credits == null || unchanged} onClick={() => setConfirming(true)}>
          {t('adm_vprice_save')}
        </Button>
        {history.length ? (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground">{t('adm_vprice_history')}</p>
            <ul className="space-y-1 text-2xs text-muted-foreground">
              {history.map((h, i) => (
                <li key={`${h.changed_at}-${i}`} className="break-words">
                  {fmt(h.changed_at)} · {h.admin_email ?? '—'} · <bdi>{h.old_cents != null ? `${usd(h.old_cents)} (${h.old_credits})` : '—'} → {usd(h.new_cents)} ({h.new_credits})</bdi>
                  {h.reason ? ` · ${h.reason}` : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
      <Confirm
        open={confirming}
        onOpenChange={(v) => { if (!v) { setConfirming(false); setReason(''); } }}
        title={t('adm_vprice_confirm_title', { n: String(credits ?? ''), usd: usd(cents) })}
        description={t('adm_vprice_confirm_body')}
        confirmLabel={t('adm_vprice_save')}
        onConfirm={() => void save()}
        busy={saving}
        confirmDisabled={reason.trim().length < 3}
      >
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('adm_vprice_reason')} aria-label={t('adm_vprice_reason')} />
      </Confirm>
    </Card>
  );
}
