// ADMIN — ONE CUSTOMER'S META ADS MONEY. Read from admin_meta_customer_finance
// (admin-only database function): fee policy and effective percent, the
// service balance (deposited / available / reserved / consumed / released),
// every campaign's reservation, the ledger, adjustments, revenue, Meta media
// spend and HOMATCH's AI costs — shown whatever the fee policy is.
//
// Money only moves through admin_meta_adjust_balance: a ledger ADJUSTMENT
// with direction, reason, actor and balance before/after, audited. There is
// no field here that edits a balance directly.
import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Confirm, When } from '@/components/admin/control/AdminKit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/contexts/LanguageContext';
import { LEDGER_LABEL_KEY } from '@/lib/metaAds/billing';
import { cn } from '@/lib/utils';
import { adminAdjustBalance, adminCustomerFinance, moneyIn, type CustomerFinance } from '@/services/metaAds';
import { errorText, JsonDetails, MIN_REASON, Panel, Stat } from './kit';

type Direction = 'CREDIT' | 'DEBIT';

/** Gross margin per currency: service-fee revenue less HOMATCH's landed AI cost (USD only; other currencies have no AI cost line). */
export function grossMargin(revenueCents: number, currency: string, landedAiUsd: number): number | null {
  if (currency !== 'USD') return revenueCents;
  if (!Number.isFinite(landedAiUsd)) return null;
  return revenueCents - Math.round(landedAiUsd * 100);
}

export function CustomerFinancePanel({ userId, onChanged }: { userId: string; onChanged?: () => void }) {
  const { t, lang: language } = useLanguage();
  const [data, setData] = useState<CustomerFinance | null>(null);
  const [loading, setLoading] = useState(false);
  const [direction, setDirection] = useState<Direction>('CREDIT');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [campaignId, setCampaignId] = useState('');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await adminCustomerFinance(userId)); }
    catch (err) { setData(null); toast.error(t('mm_a_act_failed', { error: errorText(err) })); }
    finally { setLoading(false); }
  }, [userId, t]);
  useEffect(() => { void load(); }, [load]);

  const fmt = (minor: number | null | undefined, cur: string) => moneyIn(minor, cur, language);
  const cents = Math.round(Number(amount) * 100);
  const amountOk = Number.isFinite(cents) && cents > 0 && cents <= 100000000;
  const canSave = amountOk && /^[A-Z]{3}$/.test(currency) && reason.trim().length >= MIN_REASON;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const r = await adminAdjustBalance({ targetUserId: userId, direction, amountCents: cents, reason: reason.trim(), currency, campaignId: campaignId || null });
      toast.success(t('mm_a_fin_adjusted', { before: fmt(r.balance_before_cents, currency), after: fmt(r.balance_after_cents, currency) }));
      setConfirming(false); setAmount(''); setReason(''); setCampaignId('');
      await load(); onChanged?.();
    } catch (err) {
      const code = (err as { code?: string })?.code;
      toast.error(code === 'INSUFFICIENT_FUNDS' ? t('mm_a_fin_insufficient') : t('mm_a_act_failed', { error: errorText(err) }));
    } finally { setSaving(false); }
  };

  if (loading && !data) return <Skeleton className="h-48 rounded-2xl" />;
  if (!data) return null;
  const ai = data.ai_costs_usd ?? { calls: 0, raw_cost_usd: 0, landed_cost_usd: 0, unpriced_calls: 0 };

  return (
    <div className="space-y-4">
      <Panel title={t('mm_a_fin_title')}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Stat label={t('mm_a_fin_effective')} value={`${data.effective_fee_percent}%`} />
          <Stat label={t('mm_a_fin_policy')} value={t(`mm_a_fee_kind_${data.policy?.kind ?? 'STANDARD_PERCENT'}`)} />
          {data.sampleQuote && (
            <Stat label={t('mm_a_fin_quote', { planned: fmt(data.sampleQuote.planned_media_cents, 'USD') })}
              value={fmt(data.sampleQuote.service_fee_cents, 'USD')} />
          )}
        </div>
        <p className="mt-2 text-2xs text-muted-foreground">{t('mm_a_fin_semantics')}</p>
      </Panel>

      <Panel title={t('mm_a_fin_balances')}>
        {data.balances.length === 0 ? <p className="text-sm text-muted-foreground">{t('mm_a_fin_no_balance')}</p> : (
          <div className="space-y-3">
            {data.balances.map((b) => (
              <div key={b.currency}>
                <p className="mb-1 text-2xs font-semibold text-muted-foreground">{b.currency}</p>
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
                  <Stat label={t('mm_a_fin_deposited')} value={fmt(b.deposited_cents, b.currency)} />
                  <Stat label={t('mm_a_fin_available')} value={fmt(b.available_cents, b.currency)} />
                  <Stat label={t('mm_a_fin_reserved')} value={fmt(b.reserved_service_cents, b.currency)} />
                  <Stat label={t('mm_a_fin_consumed')} value={fmt(b.consumed_service_cents, b.currency)} />
                  <Stat label={t('mads_ledger_released_to_balance')} value={fmt(b.released_cents, b.currency)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title={t('mm_a_fin_revenue_costs')}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {(data.revenue_and_costs.length ? data.revenue_and_costs : [{ currency: 'USD', service_fee_revenue_cents: 0, service_fee_reserved_cents: 0, meta_media_spend_cents: 0 }]).map((r) => {
            const gm = grossMargin(r.service_fee_revenue_cents, r.currency, Number(ai.landed_cost_usd));
            return (
              <div key={r.currency} className="grid grid-cols-2 gap-2">
                <Stat label={t('mm_a_fin_revenue', { currency: r.currency })} value={fmt(r.service_fee_revenue_cents, r.currency)} />
                <Stat label={t('mm_a_fin_margin', { currency: r.currency })} value={gm == null ? '—' : fmt(gm, r.currency)} tone={gm != null && gm < 0 ? 'warn' : undefined} />
                <Stat label={t('mm_a_fin_meta_spend', { currency: r.currency })} value={fmt(r.meta_media_spend_cents, r.currency)} />
                <Stat label={t('mm_a_fin_reserved')} value={fmt(r.service_fee_reserved_cents, r.currency)} />
              </div>
            );
          })}
          <div className="grid grid-cols-2 gap-2">
            <Stat label={t('mm_a_fin_ai_calls')} value={ai.calls} />
            <Stat label={t('mm_a_fin_ai_landed')} value={`$${Number(ai.landed_cost_usd).toFixed(4)}`} />
            <Stat label={t('mm_a_fin_ai_raw')} value={`$${Number(ai.raw_cost_usd).toFixed(4)}`} />
            <Stat label={t('mm_a_fin_ai_unpriced')} value={ai.unpriced_calls} tone={ai.unpriced_calls > 0 ? 'warn' : undefined} />
          </div>
        </div>
        <p className="mt-2 text-2xs text-muted-foreground">{t('mm_a_fin_costs_note')}</p>
      </Panel>

      <Panel title={t('mm_a_fin_campaigns')}>
        {data.campaigns.length === 0 ? <p className="text-sm text-muted-foreground">{t('mm_a_none')}</p> : (
          <ul className="space-y-2 text-[13px]">
            {data.campaigns.map((c) => (
              <li key={c.id} className="min-w-0 rounded-xl border border-border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <b className="min-w-0 break-words">{c.name || c.id.slice(0, 8)}</b>
                  <span className="text-2xs text-muted-foreground">{c.status}{c.fee_percent != null ? ` · ${c.fee_percent}%` : ''}</span>
                </div>
                <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-5">
                  {([
                    ['mm_a_fin_planned', c.planned_media_cents], ['mm_a_fin_fee_taken', c.service_fee_taken_cents],
                    ['mm_a_fin_fee_held', c.service_fee_held_cents], ['mads_ledger_released_to_balance', c.service_fee_released_cents],
                    ['mm_a_fin_meta_spend_short', c.meta_media_spend_cents],
                  ] as Array<[string, number]>).map(([k, v]) => (
                    <div key={k} className="min-w-0">
                      <dt className="break-words text-2xs text-muted-foreground">{t(k)}</dt>
                      <dd className="tabular-nums" dir="ltr">{fmt(v, c.currency)}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={t('mm_a_fin_adjust_title')}>
        <p className="mb-3 text-2xs text-muted-foreground">{t('mm_a_fin_adjust_note')}</p>
        <fieldset className="space-y-2">
          <legend className="text-2xs font-medium text-muted-foreground">{t('mm_a_fin_direction')}</legend>
          <div className="flex flex-wrap gap-2">
            {(['CREDIT', 'DEBIT'] as Direction[]).map((d) => (
              <label key={d} className={cn('inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full border px-3 text-[13px]',
                direction === d ? 'border-foreground bg-[hsl(var(--secondary))] font-semibold' : 'border-border')}>
                <input type="radio" name="mm-fin-direction" value={d} checked={direction === d} onChange={() => setDirection(d)} className="accent-current" />
                {t(`mm_a_fin_${d.toLowerCase()}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="mt-3 flex flex-wrap gap-3">
          <label className="flex w-40 flex-col gap-1" htmlFor="mm-fin-amount">
            <span className="text-2xs font-medium text-muted-foreground">{t('mm_a_fin_amount')}</span>
            <Input id="mm-fin-amount" dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
              aria-invalid={amount !== '' && !amountOk} className="font-mono" />
          </label>
          <label className="flex w-28 flex-col gap-1" htmlFor="mm-fin-currency">
            <span className="text-2xs font-medium text-muted-foreground">{t('mm_a_fin_currency')}</span>
            <Input id="mm-fin-currency" dir="ltr" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} className="font-mono" />
          </label>
          <label className="flex min-w-0 flex-1 basis-48 flex-col gap-1" htmlFor="mm-fin-campaign">
            <span className="text-2xs font-medium text-muted-foreground">{t('mm_a_fin_campaign_optional')}</span>
            <select id="mm-fin-campaign" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}
              className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-sm">
              <option value="">{t('mm_a_fin_no_campaign')}</option>
              {data.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name || c.id.slice(0, 8)}</option>)}
            </select>
          </label>
        </div>
        <label className="mt-3 block space-y-1 text-sm" htmlFor="mm-fin-reason">
          <span className="text-2xs font-medium text-muted-foreground">{t('mm_a_reason_label')}</span>
          <Textarea id="mm-fin-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('mm_a_reason_ph')}
            maxLength={500} required aria-required="true" />
        </label>
        <Button size="sm" className="mt-3" disabled={!canSave || saving} onClick={() => setConfirming(true)}>
          {saving && <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}{t('mm_a_fin_adjust_save')}
        </Button>

        <h3 className="mb-1.5 mt-5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{t('mm_a_fin_adjustments')}</h3>
        {data.adjustments.length === 0 ? <p className="text-sm text-muted-foreground">{t('mm_a_none')}</p> : (
          <ul className="space-y-1.5 text-[13px]">
            {data.adjustments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-border/60 pb-1.5 last:border-0">
                <When at={a.created_at} />
                <b>{t(`mm_a_fin_${a.direction.toLowerCase()}`)} {fmt(a.amount_cents, a.currency)}</b>
                <span className="tabular-nums text-muted-foreground" dir="ltr">{fmt(a.balance_before_cents, a.currency)} → {fmt(a.balance_after_cents, a.currency)}</span>
                <span className="text-muted-foreground">{t('mm_a_fee_by', { admin: a.admin_user_id.slice(0, 8) })}</span>
                <span className="min-w-0 break-words">{t('mm_a_reason')}: {a.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={t('mm_a_fin_ledger')}>
        {data.ledger.length === 0 ? <p className="text-sm text-muted-foreground">{t('mm_a_none')}</p> : (
          <ul className="space-y-1 text-[13px]">
            {data.ledger.map((l) => (
              <li key={l.id} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 border-b border-border/60 pb-1 last:border-0">
                <span className="min-w-0 break-words">{LEDGER_LABEL_KEY[l.entry_type] ? t(LEDGER_LABEL_KEY[l.entry_type]) : l.entry_type}
                  <span className="ms-2 font-mono text-2xs text-muted-foreground" dir="ltr">{l.entry_type}</span></span>
                <span className={cn('tabular-nums', l.amount_cents < 0 ? 'text-destructive' : '')} dir="ltr">{fmt(l.amount_cents, l.currency)}</span>
                <When at={l.created_at} />
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3"><JsonDetails label={t('mm_a_fin_policy_history')} value={data.policy_history} /></div>
      </Panel>

      <Confirm
        open={confirming}
        onOpenChange={(v) => { if (!v && !saving) setConfirming(false); }}
        title={t('mm_a_fin_confirm', { direction: t(`mm_a_fin_${direction.toLowerCase()}`), amount: amountOk ? fmt(cents, currency) : '—' })}
        description={t('mm_a_fin_adjust_note')}
        confirmLabel={t('mm_a_confirm')}
        onConfirm={() => void save()}
        busy={saving}
        confirmDisabled={!canSave}
      />
    </div>
  );
}
