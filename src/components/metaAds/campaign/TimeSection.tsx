// Time: Meta's delivery hours and HOMATCH's lead arrival hours, kept apart —
// they are measured in different clocks and are never merged into one chart.
import React from 'react';
import type { CampaignDetail } from '@/services/metaAds';
import { Card, Muted, type Fmt, type T } from './shared';

const hourOf = (key: string) => {
  const h = parseInt(String(key).trim(), 10);
  return Number.isFinite(h) && h >= 0 && h < 24 ? h : null;
};

function HourBars({ t, fmt, values, label, tone }: { t: T; fmt: Fmt; values: number[]; label: string; tone: string }) {
  const max = Math.max(1, ...values);
  return (
    <figure className="min-w-0">
      <figcaption className="mb-1.5 text-2xs font-semibold text-foreground">{label}</figcaption>
      <div className="flex h-24 items-end gap-[2px] border-b border-border" aria-hidden="true" dir="ltr">
        {values.map((v, h) => (
          <div key={h} className="flex h-full min-w-0 flex-1 items-end" title={t('mm_c_time_hour', { hour: String(h).padStart(2, '0'), value: fmt.num(v) })}>
            <div className={`w-full rounded-t-[4px] ${tone}`} style={{ height: `${v > 0 ? Math.max(3, (v / max) * 100) : 0}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-2xs tabular-nums text-muted-foreground" aria-hidden="true" dir="ltr">
        <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
      </div>
      <ul className="sr-only">
        {values.map((v, h) => v > 0 && <li key={h}>{t('mm_c_time_hour', { hour: String(h).padStart(2, '0'), value: fmt.num(v) })}</li>)}
      </ul>
    </figure>
  );
}

export function TimeSection({ t, fmt, d }: { t: T; fmt: Fmt; d: CampaignDetail }) {
  const delivery = Array.from({ length: 24 }, () => 0);
  let any = false;
  for (const s of d.analysis?.segments?.hour ?? []) {
    const h = hourOf(s.key);
    if (h == null) continue;
    delivery[h] += Number(s.totals.impressions ?? 0);
    any = any || s.totals.impressions > 0;
  }
  const leads = (d.analysis?.leadHours ?? []).slice(0, 24);
  const anyLeads = leads.some((n) => n > 0);
  return (
    <Card id="mm-time" title={t('mm_c_time_title')}>
      <Muted className="mb-3">{t('mm_c_time_note')}</Muted>
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          {any ? <HourBars t={t} fmt={fmt} values={delivery} label={`${t('mm_c_time_delivery')} · ${t('mm_c_m_impressions')}`} tone="bg-[hsl(var(--gold))]" />
            : <><p className="mb-1 text-2xs font-semibold text-foreground">{t('mm_c_time_delivery')}</p><Muted>{t('mm_c_seg_none')}</Muted></>}
        </div>
        <div>
          {anyLeads ? <HourBars t={t} fmt={fmt} values={leads} label={t('mm_c_time_leads')} tone="bg-foreground/60" />
            : <><p className="mb-1 text-2xs font-semibold text-foreground">{t('mm_c_time_leads')}</p><Muted>{t('mm_c_time_leads_none')}</Muted></>}
        </div>
      </div>
    </Card>
  );
}
