// Optimization: RECOMMEND ONLY. Nothing here applies itself — the customer
// chooses APPLY / DISMISS / REMIND per recommendation. APPLY is offered only
// when the server marked it actionable AND the evidence is meaningful.
import React, { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { actOnRecommendation, type CampaignDetail, type RecommendationAct, type RecommendationRow } from '@/services/metaAds';
import { decide, prefsOf, proposalOf, type Decision } from '@/lib/metaAds/homatchIntelligence';
import type { Recommendation } from '@/lib/metaAds/analysis';
import { adNamer, Card, Chip, EvidenceChip, Muted, errorText, type Fmt, type T, type Tone } from './shared';

const REC_TYPES = ['KEEP', 'MONITOR', 'TEST', 'REALLOCATE', 'REDUCE', 'INCREASE', 'REFRESH_CREATIVE', 'PAUSE', 'EXPAND', 'NARROW', 'COLLECT_DATA'];
const REASONS = ['NOT_ENOUGH_RESULTS_YET', 'CREATIVE_COSTS_MORE_THAN_STRONGEST', 'CTR_DECLINING', 'COST_RISING', 'FREQUENCY_RISING',
  'CONVERSION_DECLINING', 'COST_IMPROVED_TWO_WINDOWS', 'COST_PER_RESULT_ROSE', 'LOW_QUALIFICATION_RATE', 'PERFORMING_STEADILY', 'COLLECTING_MORE_DATA', 'PAUSED_NOT_COLLECTING'];
const METRICS = ['COST_PER_RESULT', 'COST_PER_QUALIFIED_LEAD', 'CTR', 'SPEND_PACE'];
const OUTCOMES: Record<string, Tone> = { HELPED: 'good', NEUTRAL: 'quiet', HURT: 'watch', INSUFFICIENT_DATA: 'quiet' };
const TIMELINE_KEYS = ['tl_budget_changed', 'tl_changed_in_meta', 'tl_config_restored', 'tl_duplicate_detected', 'tl_duplicate_review',
  'tl_duration_changed', 'tl_ended', 'tl_guard_attention', 'tl_guard_reviewed', 'tl_guard_warning_n', 'tl_paused', 'tl_paused_in_meta',
  'tl_protective_pause', 'tl_protective_pause_copy', 'tl_recommendation_applied', 'tl_renamed', 'tl_resumed', 'tl_resumed_in_meta', 'tl_synced'];

/**
 * The recommendation's title, read against where the campaign is: "collect
 * more data" only makes sense while it can collect. Paused and in-review
 * campaigns say what actually happens next.
 */
export function recTitle(t: T, type: string, status: string): string {
  if (type === 'COLLECT_DATA' && status === 'PAUSED') return t('mm_rec_COLLECT_DATA_PAUSED');
  if (type === 'COLLECT_DATA' && ['SUBMITTED', 'META_REVIEW'].includes(status)) return t('mm_rec_COLLECT_DATA_REVIEW');
  return REC_TYPES.includes(type) ? t(`mm_rec_${type}`) : type;
}

/** The one gate for APPLY, mirroring the server's own check in recommendation_act. */
export function canApply(r: Pick<RecommendationRow, 'actionable' | 'confidence'>): boolean {
  return r.actionable === true && (r.confidence === 'MEANINGFUL_SIGNAL' || r.confidence === 'HIGH_CONFIDENCE');
}

const isOpen = (r: RecommendationRow) =>
  r.status === 'OPEN' || (r.status === 'SNOOZED' && (!r.snooze_until || Date.parse(r.snooze_until) <= Date.now()));

export function OptimizationSection({ t, fmt, d, onChanged }: { t: T; fmt: Fmt; d: CampaignDetail; onChanged: () => void }) {
  const adName = adNamer(t, d.entities, d.creatives);
  const [pending, setPending] = useState<{ id: string; act: RecommendationAct } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; ok: boolean; text: string } | null>(null);

  const recs = d.recommendations ?? [];
  const open = recs.filter(isOpen);
  const snoozed = recs.filter((r) => r.status === 'SNOOZED' && !isOpen(r));
  const applied = recs.filter((r) => r.status === 'APPLIED');

  /* HOMATCH Intelligence (when the owner turned it on): each suggestion read
     against the hard limits — within limits, needs approval, or held. It
     never applies anything; APPLY stays the owner's. */
  const intel = prefsOf(d.campaign.intelligence);
  const verdictOf = (r: RecommendationRow): Decision | null => {
    if (!intel.enabled) return null;
    const p = proposalOf({ type: r.type, affected: r.affected, confidence: r.confidence, reasonCodes: r.reason_codes ?? [],
      proposedDailyMinor: r.proposed?.dailyBudgetCents } as unknown as Recommendation);
    if (!p) return null;
    const locIds = (d.campaign.targeting?.locations ?? []).map((l) => `${l.type}:${l.key}`);
    return decide([p], intel, { approvedDailyMinor: Number(d.campaign.daily_budget_cents ?? 0), status: d.campaign.status,
      approvedLocationIds: locIds, housingRestricted: (d.campaign.special_ad_categories ?? []).includes('HOUSING'), exclusions: [] },
    [], Date.now())[0] ?? null;
  };
  const target = (affected: string) => (affected.startsWith('ad:') ? adName(affected.slice(3)) : t('mm_c_affected_campaign'));
  const metricValue = (metric: string, v: number | null) => (metric === 'CTR' ? fmt.pct(v, 2) : fmt.money(v));

  async function act(r: RecommendationRow, kind: RecommendationAct) {
    if (kind === 'APPLY' && !canApply(r)) return;
    setConfirming(null);
    setResult(null);
    setPending({ id: r.id, act: kind });
    try {
      await actOnRecommendation(r.id, kind, crypto.randomUUID(), kind === 'REMIND' ? 3 : undefined);
      // Success is only reported after the server (and, for APPLY, Meta) confirmed.
      setResult({ id: r.id, ok: true, text: t(`mm_c_rec_done_${kind}`) });
      onChanged();
    } catch (e) {
      setResult({ id: r.id, ok: false, text: errorText(t, e, fmt) });
      onChanged();
    } finally {
      setPending(null);
    }
  }

  const reasons = (r: RecommendationRow) => (r.reason_codes ?? []).map((code) => {
    if (code.startsWith('STRONGEST:')) return t('mm_recr_STRONGEST', { creative: adName(code.slice('STRONGEST:'.length)) });
    return REASONS.includes(code) ? t(`mm_recr_${code}`) : null;
  }).filter(Boolean) as string[];

  const recBody = (r: RecommendationRow) => (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-foreground">{recTitle(t, r.type, d.campaign.status)}</p>
        <span className="flex items-center gap-1 text-2xs text-muted-foreground">{t('mm_c_rec_confidence')}<EvidenceChip t={t} evidence={r.confidence} /></span>
      </div>
      <p className="mt-1 text-2xs text-muted-foreground">{t('mm_c_rec_affects', { target: target(r.affected) })}</p>
      {reasons(r).length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 ps-5 text-[13px] text-foreground">
          {reasons(r).map((s) => <li key={s}>{s}</li>)}
        </ul>
      )}
      {METRICS.includes(r.metric) && (r.baseline != null || r.candidate != null) && (
        <p className="mt-1.5 text-[13px] text-foreground">
          {r.baseline != null && r.candidate != null
            ? `${t(`mm_c_metric_${r.metric}`)}: ${metricValue(r.metric, r.baseline)} → ${metricValue(r.metric, r.candidate)}`
            : `${t(`mm_c_metric_${r.metric}`)}: ${metricValue(r.metric, r.candidate ?? r.baseline)}`}
        </p>
      )}
      {r.proposed?.dailyBudgetCents != null && (
        <p className="mt-1 text-[13px] font-semibold text-foreground">{t('mm_c_rec_proposed', { amount: fmt.money(r.proposed.dailyBudgetCents) })}</p>
      )}
    </>
  );

  return (
    <div className="space-y-4">
      <Card id="mm-recs" title={t('mm_c_opt_title')}>
        <Muted className="mb-3">{t('mm_c_opt_lead')}</Muted>
        <p className="mb-3 text-2xs text-muted-foreground" data-mm-intel-state={intel.enabled ? 'on' : 'off'}>✨ {t(intel.enabled ? 'mm_i_state_on' : 'mm_i_state_off')}</p>
        {open.length + snoozed.length + applied.length === 0 ? <Muted>{t('mm_c_rec_none')}</Muted> : (
          <ul className="space-y-3" data-mm-recs="">
            {open.map((r) => {
              const applicable = canApply(r);
              const busy = pending?.id === r.id;
              return (
                <li key={r.id} className="rounded-xl border border-border p-3">
                  {recBody(r)}
                  {(() => { const v = verdictOf(r); return v ? (
                    <p className="mt-1.5 text-2xs font-semibold text-[hsl(var(--gold-ink))]" data-mm-intel-verdict={v.verdict}>
                      ✨ {t(`mm_i_verdict_${v.verdict}`)}{v.reason && v.verdict === 'NEEDS_APPROVAL' ? ` · ${t(`mm_i_reason_${v.reason}`)}` : ''}
                    </p>
                  ) : null; })()}
                  {!r.actionable ? <Muted className="mt-2">{t('mm_c_rec_info_only')}</Muted>
                    : !applicable ? <Muted className="mt-2">{t('mm_c_rec_needs_evidence')}</Muted> : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {applicable && (confirming === r.id ? (
                      <>
                        <button type="button" disabled={pending !== null} onClick={() => act(r, 'APPLY')}
                          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[hsl(38_92%_54%)] px-3.5 text-2xs font-bold text-[#161309] hover:bg-[hsl(38_92%_60%)] disabled:opacity-60">
                          {busy && pending?.act === 'APPLY' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                          {t('mm_c_confirm')}
                        </button>
                        <button type="button" disabled={pending !== null} onClick={() => setConfirming(null)}
                          className="inline-flex min-h-10 items-center rounded-lg border border-border px-3.5 text-2xs font-medium text-foreground hover:bg-[hsl(var(--secondary))]">
                          {t('mm_c_cancel')}
                        </button>
                      </>
                    ) : (
                      <button type="button" disabled={pending !== null} onClick={() => setConfirming(r.id)}
                        className="inline-flex min-h-10 items-center rounded-lg bg-[hsl(38_92%_54%)] px-3.5 text-2xs font-bold text-[#161309] hover:bg-[hsl(38_92%_60%)] disabled:opacity-60">
                        {t('mm_c_rec_apply')}
                      </button>
                    ))}
                    <button type="button" disabled={pending !== null} onClick={() => act(r, 'DISMISS')}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border px-3.5 text-2xs font-medium text-foreground hover:bg-[hsl(var(--secondary))] disabled:opacity-60">
                      {busy && pending?.act === 'DISMISS' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}{t('mm_c_rec_dismiss')}
                    </button>
                    <button type="button" disabled={pending !== null} onClick={() => act(r, 'REMIND')}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border px-3.5 text-2xs font-medium text-foreground hover:bg-[hsl(var(--secondary))] disabled:opacity-60">
                      {busy && pending?.act === 'REMIND' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}{t('mm_c_rec_remind')}
                    </button>
                  </div>
                  <p aria-live="polite" className="mt-2 text-[13px] empty:hidden">
                    {busy && pending?.act === 'APPLY' ? <span className="text-muted-foreground">{t('mm_c_waiting_meta')}</span>
                      : result?.id === r.id ? <span className={result.ok ? 'text-[hsl(152_54%_30%)]' : 'text-destructive'}>{result.text}</span> : null}
                  </p>
                </li>
              );
            })}
            {snoozed.map((r) => (
              <li key={r.id} className="rounded-xl border border-dashed border-border p-3 opacity-90">
                {recBody(r)}
                <p className="mt-2 text-2xs text-muted-foreground">{t('mm_c_rec_snoozed', { date: fmt.date(r.snooze_until) })}</p>
              </li>
            ))}
            {applied.map((r) => (
              <li key={r.id} className="rounded-xl border border-border bg-[hsl(var(--secondary))]/50 p-3">
                {recBody(r)}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
                  <span>{t('mm_c_rec_applied_on', { date: fmt.date(r.acted_at) })}</span>
                  <span aria-hidden="true">·</span>
                  <span>{t('mm_c_rec_outcome')}:</span>
                  {r.outcome && OUTCOMES[r.outcome]
                    ? <Chip tone={OUTCOMES[r.outcome]}>{t(`mm_c_out_${r.outcome}`)}</Chip>
                    : <span>{t('mm_c_out_pending')}</span>}
                </div>
                {result?.id === r.id && <p aria-live="polite" className="mt-2 text-[13px] text-[hsl(152_54%_30%)]">{result.text}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card id="mm-timeline" title={t('mm_c_timeline_title')}>
        <TimelineList t={t} fmt={fmt} timeline={d.timeline ?? []} />
      </Card>
    </div>
  );
}

function TimelineList({ t, fmt, timeline }: { t: T; fmt: Fmt; timeline: CampaignDetail['timeline'] }) {
  const rows = timeline.filter((e) => TIMELINE_KEYS.includes(e.customer_key));
  if (rows.length === 0) return <Muted>{t('mm_c_timeline_none')}</Muted>;
  const vars = (e: CampaignDetail['timeline'][number]): Record<string, string | number> => {
    const p = e.params ?? {};
    switch (e.customer_key) {
      case 'tl_budget_changed': {
        const cur = typeof p.currency === 'string' && /^[A-Z]{3}$/.test(p.currency) ? p.currency : fmt.currency;
        const m = (v: unknown) => (v == null ? '—' : new Intl.NumberFormat(fmt.lang, { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(Number(v) / 100));
        return { from: m(p.from), to: m(p.to) };
      }
      case 'tl_duration_changed': return { from: fmt.num(Number(p.from)), to: fmt.num(Number(p.to)) };
      case 'tl_renamed': return { from: typeof p.from === 'string' && p.from ? p.from : '—', to: typeof p.to === 'string' ? p.to : '—' };
      case 'tl_guard_warning_n': return { n: fmt.num(Number(p.n)), of: fmt.num(Number(p.of)) };
      case 'tl_recommendation_applied': {
        const type = String(p.type ?? '');
        return { type: REC_TYPES.includes(type) ? t(`mm_rec_${type}`) : '—' };
      }
      default: return {};
    }
  };
  return (
    <ol className="relative space-y-3 border-s border-border ps-4" data-mm-timeline="">
      {rows.map((e, i) => (
        <li key={`${e.at}-${i}`} className="relative">
          <span className="absolute -start-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-[hsl(var(--gold))]" aria-hidden="true" />
          <p className="text-[13px] text-foreground">{t(`mm_${e.customer_key}`, vars(e))}</p>
          <p className="text-2xs text-muted-foreground"><time dateTime={e.at}>{fmt.dateTime(e.at)}</time></p>
        </li>
      ))}
    </ol>
  );
}
