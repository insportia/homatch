// Creatives: each ad's own KPIs (server-computed) and its creative class.
// "Strongest signal" is only highlighted with MEANINGFUL_SIGNAL or better.
import React, { useEffect, useState } from 'react';
import { Award, ImageIcon, Video } from 'lucide-react';
import { creativeMediaUrl, type CampaignDetail } from '@/services/metaAds';
import { adNamer, atLeast, Card, Chip, EvidenceChip, Muted, type Fmt, type T, type Tone } from './shared';

const CLASS_TONE: Record<string, Tone> = {
  STRONGEST_SIGNAL: 'gold', STEADY: 'good', NEEDS_MORE_DATA: 'quiet', UNDERPERFORMING: 'watch', POSSIBLE_FATIGUE: 'watch',
};
const CLASSES = ['STRONGEST_SIGNAL', 'NEEDS_MORE_DATA', 'UNDERPERFORMING', 'POSSIBLE_FATIGUE', 'STEADY'];

function Thumb({ path, kind }: { path: string | null; kind: 'IMAGE' | 'VIDEO' | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (path && kind === 'IMAGE') creativeMediaUrl(path).then((u) => { if (live) setUrl(u); }).catch(() => undefined);
    return () => { live = false; };
  }, [path, kind]);
  return (
    <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-[hsl(var(--secondary))]">
      {url ? <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
        : kind === 'VIDEO' ? <Video className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          : <ImageIcon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
    </span>
  );
}

export function CreativesSection({ t, fmt, d }: { t: T; fmt: Fmt; d: CampaignDetail }) {
  const ads = d.analysis?.ads ?? [];
  const name = adNamer(t, d.entities, d.creatives);
  const leader = d.analysis?.leaders?.creative;
  const leadKey = leader && atLeast(leader.evidence, 'MEANINGFUL_SIGNAL') ? leader.key : null;
  const entity = (key: string) => d.entities.find((e) => e.kind === 'AD' && e.external_id === key);
  const creativeOf = (key: string) => {
    const id = entity(key)?.local_creative_id;
    return id ? d.creatives.find((c) => c.id === id) ?? null : null;
  };

  return (
    <Card id="mm-creatives" title={t('mm_c_creatives_title')}>
      {ads.length === 0 ? <Muted>{t('mm_c_creatives_none')}</Muted> : (
        <ul className="grid gap-3 md:grid-cols-2">
          {ads.map((ad) => {
            const cls = d.analysis?.creativeClasses?.find((c) => c.key === ad.key);
            const cr = creativeOf(ad.key);
            const isLeader = ad.key === leadKey;
            const shownCls = cls && CLASSES.includes(cls.cls)
              // A leader badge without meaningful evidence would be a winner from a tiny sample.
              ? (cls.cls === 'STRONGEST_SIGNAL' && !atLeast(cls.evidence, 'MEANINGFUL_SIGNAL') ? 'NEEDS_MORE_DATA' : cls.cls)
              : null;
            const k = ad.kpis;
            return (
              <li key={ad.key} className={`min-w-0 rounded-xl border p-3 ${isLeader ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]/40' : 'border-border'}`}>
                <div className="flex items-start gap-3">
                  <Thumb path={cr?.thumb ?? null} kind={cr?.kind ?? null} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{name(ad.key)}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {isLeader && <Chip tone="gold"><Award className="h-3 w-3" aria-hidden="true" />{t('mm_c_leader')}</Chip>}
                      {shownCls && !(isLeader && shownCls === 'STRONGEST_SIGNAL') && <Chip tone={CLASS_TONE[shownCls]}>{t(`mm_ccls_${shownCls}`)}</Chip>}
                      {cls && <EvidenceChip t={t} evidence={cls.evidence} />}
                    </div>
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[13px]">
                  {([
                    [t('mm_c_kpi_spend'), fmt.money(k.spendMinor)],
                    [t('mm_c_kpi_results'), fmt.num(k.results)],
                    [t('mm_c_kpi_cpr'), fmt.money(k.costPerResultMinor)],
                    [t('mm_c_kpi_ctr'), fmt.pct(k.ctr, 2)],
                    [t('mm_c_kpi_cpl'), fmt.money(k.cplMinor)],
                    [t('mm_c_kpi_frequency'), fmt.num(k.frequency, 2)],
                  ] as Array<[string, string]>).map(([l, v]) => (
                    <div key={l} className="flex min-w-0 justify-between gap-2">
                      <dt className="truncate text-muted-foreground">{l}</dt>
                      <dd className="tabular-nums text-foreground" dir="ltr">{v}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
