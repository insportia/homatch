// Leads funnel from the Leads Center statuses. A stage counts every lead
// that has reached it or gone further; LOST is shown apart, never subtracted.
import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import type { CampaignDetail } from '@/services/metaAds';
import { Card, Muted, type Fmt, type T } from './shared';

const REACHED_CONTACTED = ['CONTACTED', 'QUALIFIED', 'VIEWING', 'NEGOTIATING', 'WON'];

export function LeadsFunnelSection({ t, fmt, d, campaignId }: { t: T; fmt: Fmt; d: CampaignDetail; campaignId: string }) {
  const by = d.leads?.byStatus ?? {};
  const total = d.leads?.total ?? 0;
  const stages: Array<[string, number]> = [
    [t('mm_c_funnel_total'), total],
    [t('mm_c_funnel_contacted'), REACHED_CONTACTED.reduce((n, s) => n + Number(by[s] ?? 0), 0)],
    [t('mm_c_funnel_qualified'), d.leads?.qualified ?? 0],
    [t('mm_c_funnel_viewing'), d.leads?.viewings ?? 0],
    [t('mm_c_funnel_won'), Number(by.WON ?? 0)],
  ];
  const lost = Number(by.LOST ?? 0);
  const href = `/outreach/meta?tab=leads&campaign=${encodeURIComponent(campaignId)}`;
  return (
    <Card id="mm-leads" title={t('mm_c_leads_title')}
      actions={
        <Link to={href} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-border px-3 text-2xs font-semibold text-foreground hover:bg-[hsl(var(--secondary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]">
          {t('mm_c_leads_open')}<ArrowUpRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />
        </Link>
      }>
      {total === 0 ? <Muted>{t('mm_c_leads_none')}</Muted> : (
        <>
          <ol className="space-y-2" data-mm-funnel="">
            {stages.map(([label, n], i) => {
              const share = total > 0 ? n / total : 0;
              return (
                <li key={label} className="min-w-0">
                  <div className="flex items-baseline justify-between gap-2 text-[13px]">
                    <span className="font-semibold text-foreground">{label}</span>
                    <span className="tabular-nums text-foreground" dir="ltr">
                      {fmt.num(n)}{i > 0 && <span className="ms-1.5 text-2xs text-muted-foreground">{t('mm_c_funnel_of', { pct: fmt.pct(share, 0) })}</span>}
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-[hsl(var(--secondary))]" aria-hidden="true">
                    <div className="h-full rounded-full bg-[hsl(var(--gold))]" style={{ width: `${Math.max(n > 0 ? 2 : 0, share * 100)}%` }} />
                  </div>
                </li>
              );
            })}
          </ol>
          {lost > 0 && <p className="mt-3 text-[13px] text-muted-foreground">{t('mm_c_funnel_lost', { n: fmt.num(lost) })}</p>}
        </>
      )}
      <Muted className="mt-3">{t('mm_c_leads_note')}</Muted>
    </Card>
  );
}
