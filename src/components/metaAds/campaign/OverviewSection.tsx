// Overview: the KPI grid, the deterministic summary (fact codes → copy),
// campaign health across seven dimensions, and the evidence level. When the
// evidence is INSUFFICIENT_DATA the page says so before any number.
import React from 'react';
import { Info } from 'lucide-react';
import type { CampaignDetail } from '@/services/metaAds';
import { KpiGrid } from './KpiGrid';
import {
  Card, Chip, EvidenceChip, Muted, healthTone, placementName, ageGenderName, adNamer, type Fmt, type T,
} from './shared';

type Fact = { code: string; params: Record<string, string | number | null>; confidence?: string };

const HEALTH_DIMS = ['DELIVERY', 'COST_EFFICIENCY', 'LEAD_QUALITY', 'CREATIVE_HEALTH', 'AUDIENCE_LEARNING', 'BUDGET_UTILIZATION', 'DATA_HEALTH'] as const;
const FACT_CODES = ['STATUS', 'SPEND_RESULTS', 'LEADS_QUALIFIED', 'NO_DATA_YET', 'PLACEMENT_LEADS', 'AUDIENCE_LEADS', 'CREATIVE_LEADS'];
const REC_TYPES = ['KEEP', 'MONITOR', 'TEST', 'REALLOCATE', 'REDUCE', 'INCREASE', 'REFRESH_CREATIVE', 'PAUSE', 'EXPAND', 'NARROW', 'COLLECT_DATA'];

export function InsufficientBanner({ t }: { t: T }) {
  return (
    <div role="note" className="flex gap-2.5 rounded-xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] px-3.5 py-3 text-[13px] text-[hsl(var(--gold-ink))]">
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>
        <p className="font-semibold">{t('mm_c_insufficient_title')}</p>
        <p className="mt-0.5 leading-relaxed">{t('mm_c_insufficient_body')}</p>
      </div>
    </div>
  );
}

/** A fact code with its params → one localized sentence. Unknown codes render nothing. */
export function factSentence(t: T, fmt: Fmt, d: CampaignDetail, f: Fact): string | null {
  const p = f.params ?? {};
  const adName = adNamer(t, d.entities, d.creatives);
  const affected = (a: unknown) => {
    const s = String(a ?? 'campaign');
    return s.startsWith('ad:') ? adName(s.slice(3)) : t('mm_c_affected_campaign');
  };
  const dash = (v: unknown) => (v == null ? '—' : String(v));
  if (f.code.startsWith('RECOMMEND_')) {
    const type = f.code.slice('RECOMMEND_'.length);
    return REC_TYPES.includes(type) ? t(`mm_fact_RECOMMEND_${type}`, { affected: affected(p.affected) }) : null;
  }
  if (!FACT_CODES.includes(f.code)) return null;
  switch (f.code) {
    case 'STATUS': return t('mm_fact_STATUS', { status: t(`mads_status_${String(p.status ?? d.campaign.status).toLowerCase()}`) });
    case 'SPEND_RESULTS': return t('mm_fact_SPEND_RESULTS', {
      spendMinor: fmt.money(p.spendMinor as number | null), results: fmt.num(p.results as number | null),
      costPerResultMinor: fmt.money(p.costPerResultMinor as number | null),
    });
    case 'LEADS_QUALIFIED': return t('mm_fact_LEADS_QUALIFIED', { leads: dash(p.leads), qualified: dash(p.qualified) });
    case 'PLACEMENT_LEADS': return t('mm_fact_PLACEMENT_LEADS', { placement: placementName(t, String(p.placement ?? 'OTHER')) });
    case 'AUDIENCE_LEADS': return t('mm_fact_AUDIENCE_LEADS', { segment: ageGenderName(t, String(p.segment ?? '')) });
    case 'CREATIVE_LEADS': return t('mm_fact_CREATIVE_LEADS', { creative: adName(String(p.creative ?? '')) });
    default: return t('mm_fact_NO_DATA_YET');
  }
}

export function OverviewSection({ t, fmt, d }: { t: T; fmt: Fmt; d: CampaignDetail }) {
  const facts: Fact[] = (d.analysis?.facts?.length ? d.analysis.facts : d.campaign.summary?.facts) ?? [];
  const evidence = d.evidence || 'INSUFFICIENT_DATA';
  const insufficient = evidence === 'INSUFFICIENT_DATA';
  const health = d.analysis?.health ?? d.campaign.health ?? null;
  const sentences = facts.map((f) => ({ f, s: factSentence(t, fmt, d, f) })).filter((x) => x.s);

  return (
    <div className="space-y-4">
      {insufficient && <InsufficientBanner t={t} />}

      <Card id="mm-kpis" title={t('mm_c_kpi_title')}
        actions={<span className="flex items-center gap-1.5 text-2xs text-muted-foreground">{t('mm_c_evidence_label')}<EvidenceChip t={t} evidence={evidence} /></span>}>
        {d.kpis ? <KpiGrid t={t} fmt={fmt} kpis={d.kpis} /> : <Muted>{t('mm_c_kpi_none')}</Muted>}
      </Card>

      <Card id="mm-summary" title={t('mm_c_summary_title')}>
        {sentences.length === 0 ? <Muted>{t('mm_c_summary_none')}</Muted> : (
          <ul className="space-y-1.5" data-mm-facts="">
            {sentences.map(({ f, s }, i) => (
              <li key={`${f.code}-${i}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm leading-relaxed text-foreground">
                <span className="min-w-0">{s}</span>
                {f.confidence && <EvidenceChip t={t} evidence={f.confidence} />}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card id="mm-health" title={t('mm_c_health_title')}>
        {!health ? <Muted>{t('mm_c_health_none')}</Muted> : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" data-mm-health="">
            {HEALTH_DIMS.map((dim) => {
              const h = (health as Record<string, { state: string; code: string } | undefined>)[dim];
              const state = h?.state ?? 'INSUFFICIENT_DATA';
              return (
                <li key={dim} className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2">
                  <span className="min-w-0 truncate text-[13px] text-foreground">{t(`mm_hdim_${dim}`)}</span>
                  <Chip tone={healthTone(state)}>{t(`mm_hstate_${state}`)}</Chip>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
