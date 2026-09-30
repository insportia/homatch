// Billing: the service fee held for this campaign, its rate, and the ledger.
// Unused fee is RELEASED TO HOMATCH BALANCE — never described as cash back.
import React from 'react';
import type { CampaignDetail } from '@/services/metaAds';
import { Card, Muted, Stat, type Fmt, type T } from './shared';

export function BillingSection({ t, fmt, d }: { t: T; fmt: Fmt; d: CampaignDetail }) {
  const f = d.funding;
  const pct = f?.feePercent ?? d.campaign.fee_percent ?? null;
  const ledger = f?.ledger ?? [];
  return (
    <Card id="mm-billing" title={t('mm_c_billing_title')}>
      <div className="grid grid-cols-2 gap-2.5 sm:max-w-md">
        <Stat label={t('mm_c_billing_held')} value={fmt.money(f?.heldServiceFeeCents ?? 0)} />
        <Stat label={t('mm_c_billing_fee')} value={pct == null ? '—' : t('mm_c_billing_fee_value', { percent: fmt.num(pct, 2) })} />
      </div>
      <h3 className="mb-2 mt-4 text-[13px] font-semibold text-foreground">{t('mm_c_billing_ledger')}</h3>
      {ledger.length === 0 ? <Muted>{t('mm_c_billing_none')}</Muted> : (
        <ul className="divide-y divide-border rounded-xl border border-border" data-mm-ledger="">
          {ledger.map((r, i) => (
            <li key={`${r.created_at}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
              <span className="min-w-0">
                <span className="block truncate text-foreground">{r.labelKey ? t(r.labelKey) : t('mm_c_billing_other')}</span>
                <span className="block text-2xs text-muted-foreground">{fmt.dateTime(r.created_at)}</span>
              </span>
              <span className="shrink-0 tabular-nums text-foreground" dir="ltr">{fmt.money(r.amount_cents)}</span>
            </li>
          ))}
        </ul>
      )}
      <Muted className="mt-3">{t('mm_c_billing_disclosure')}</Muted>
    </Card>
  );
}
