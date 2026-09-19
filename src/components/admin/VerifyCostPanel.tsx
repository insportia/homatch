/*
 * WHAT ONE VERIFICATION COSTS HOMATCH.
 *
 * COGS ONLY. Not a price, not a margin, not anything a customer is ever
 * shown — the same boundary the AI Talk panel draws, drawn again here
 * because a screen full of money is one somebody will eventually mistake for
 * an invoice.
 *
 * THE RULE THIS PANEL IS BUILT ON
 *
 * A figure that is not known renders as unknown. Never as zero, never as a
 * dash that could be read as zero, never quietly dropped out of an average.
 * A verification costs fractions of a dollar per stage, so a total shown to
 * two decimal places would report most of this screen as free.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 * Railway and Supabase are fixed monthly subscriptions. verify_billing_events
 * excludes them from provider COGS on purpose and no per-job share of them is
 * invented here; there is no honest way to divide a subscription by a
 * verification. If allocated infrastructure is wanted it belongs in its own
 * labelled metric, exactly as AI Talk keeps its allocation separate from its
 * measured variable cost.
 */
import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { usd, num, secs, isFloorTotal } from '@/verify/cogsFormat';
import {
  getVerifyCogsSummary, listVerifyCogsJobs, getVerifyCogsJob,
  type VerifyCogsSummary, type VerifyCogsJob, type VerifyCogsDetail,
} from '@/services/verifyCogs';

function Stat({ label, value, sub, incomplete }: {
  label: string; value: string; sub?: string; incomplete?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card/60 p-4">
      <p className="text-2xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums break-words ${incomplete ? 'text-amber-600 dark:text-amber-400' : ''}`}>
        {value}
      </p>
      {sub ? <p className="mt-0.5 text-xs text-muted-foreground break-words">{sub}</p> : null}
    </div>
  );
}

function PriceStateBadge({ state }: { state: string | null }) {
  const { t } = useLanguage();
  if (state === 'PRICED') {
    return <Badge variant="outline" className="whitespace-normal font-normal">{t('vcogs_priced')}</Badge>;
  }
  // Anything that is not fully priced is called out, because its cost is a
  // floor and a floor presented as a total is a wrong number.
  return (
    <Badge variant="destructive" className="whitespace-normal font-normal">
      {state === 'PARTIALLY_PRICED' ? t('vcogs_partially_priced') : t('vcogs_unpriced')}
    </Badge>
  );
}

export function VerifyCostPanel() {
  const { t } = useLanguage();
  const [summary, setSummary] = useState<VerifyCogsSummary | null>(null);
  const [jobs, setJobs] = useState<VerifyCogsJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lookup, setLookup] = useState('');
  const [detail, setDetail] = useState<VerifyCogsDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailMiss, setDetailMiss] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, j] = await Promise.all([getVerifyCogsSummary(), listVerifyCogsJobs({ limit: 100 })]);
      setSummary(s);
      setJobs(j);
    } catch (e) {
      // A read that failed says nothing about the cost. It must not leave the
      // previous numbers on screen looking current, nor show zeros.
      setSummary(null);
      setJobs([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const inspect = async (jobId: string) => {
    setDetailLoading(true);
    setDetailMiss(false);
    setDetail(null);
    try {
      const d = await getVerifyCogsJob(jobId.trim());
      if (!d) setDetailMiss(true);
      setDetail(d);
    } catch {
      setDetailMiss(true);
    } finally {
      setDetailLoading(false);
    }
  };

  const incomplete = isFloorTotal(summary?.partiallyPricedJobs);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('vcogs_note')}</p>

      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <span className="min-w-0 break-words">{t('vcogs_error')}</span>
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t('vcogs_loading')}
        </div>
      ) : null}

      {summary ? (
        <>
          {incomplete ? (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <span className="min-w-0 break-words">
                {t('vcogs_floor_note').replace('{n}', String(summary.partiallyPricedJobs))}
              </span>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={t('vcogs_stat_jobs')} value={num(summary.jobsCount)} />
            <Stat
              label={incomplete ? t('vcogs_stat_total_floor') : t('vcogs_stat_total')}
              value={usd(summary.totalCogsUsd, 4)}
              sub={`${t('vcogs_stat_priced')}: ${num(summary.pricedJobs)} · ${t('vcogs_stat_partial')}: ${num(summary.partiallyPricedJobs)}`}
              incomplete={incomplete}
            />
            <Stat label={t('vcogs_stat_avg')} value={usd(summary.avgCogsUsd, 4)} />
            <Stat label={t('vcogs_stat_duration')} value={secs(summary.avgDurationSeconds)} />
            <Stat label={t('vcogs_stat_tokens')} value={num(summary.totalTokens)} sub={`${t('vcogs_stat_cached')}: ${num(summary.cachedInputTokens)}`} />
            <Stat label={t('vcogs_stat_searches')} value={num(summary.webSearches)} />
            <Stat label={t('vcogs_stat_model_cost')} value={usd(summary.totalModelCostUsd, 4)} />
            <Stat label={t('vcogs_stat_search_cost')} value={usd(summary.totalSearchCostUsd, 4)} />
          </div>
        </>
      ) : null}

      {/* ── INSPECT ONE ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">{t('vcogs_inspect')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={lookup}
              onChange={(e) => setLookup(e.target.value)}
              placeholder={t('vcogs_job_placeholder')}
              className="min-w-0 flex-1 basis-full sm:basis-auto"
            />
            <Button onClick={() => void inspect(lookup)} disabled={!lookup.trim() || detailLoading} className="shrink-0">
              {detailLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              <span className="ms-2">{t('vcogs_inspect_go')}</span>
            </Button>
          </div>

          {detailMiss ? <p className="text-sm text-muted-foreground">{t('vcogs_not_found')}</p> : null}

          {detail ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <div className="min-w-0 break-words"><span className="text-muted-foreground">{t('vcogs_col_subject')}: </span>{detail.subject ?? '—'}</div>
                <div className="min-w-0 break-words"><span className="text-muted-foreground">{t('vcogs_col_account')}: </span>{detail.userEmail ?? t('vcogs_anonymous')}</div>
                <div className="min-w-0 break-words"><span className="text-muted-foreground">{t('vcogs_col_duration')}: </span>{secs(detail.durationSeconds)}</div>
                <div className="min-w-0 break-words"><span className="text-muted-foreground">{t('vcogs_price_book')}: </span>{detail.priceBookEffectiveFrom ? new Date(detail.priceBookEffectiveFrom).toISOString().slice(0, 10) : '—'}</div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-sm">
                <PriceStateBadge state={detail.priceState} />
                <span className="tabular-nums font-semibold">{usd(detail.providerCogsUsd, 6)}</span>
                <span className="text-muted-foreground">{t('vcogs_measured_total')}</span>
              </div>

              {/* Per stage. Wide by nature, so it scrolls in its own box
                  rather than pushing the page sideways on a phone. */}
              <div className="-mx-1 overflow-x-auto px-1">
                <table className="w-full min-w-[34rem] text-sm">
                  <thead>
                    <tr className="border-b border-border text-start text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="py-2 pe-3 text-start font-medium">{t('vcogs_stage')}</th>
                      <th className="py-2 pe-3 text-start font-medium">{t('vcogs_stage_model')}</th>
                      <th className="py-2 pe-3 text-end font-medium">{t('vcogs_col_tokens')}</th>
                      <th className="py-2 pe-3 text-end font-medium">{t('vcogs_col_searches')}</th>
                      <th className="py-2 pe-3 text-end font-medium">{t('vcogs_col_model_cost')}</th>
                      <th className="py-2 text-end font-medium">{t('vcogs_col_search_cost')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.stages.map((s) => (
                      <tr key={s.stage} className="border-b border-border/60">
                        <td className="py-2 pe-3 font-medium">{s.stage}</td>
                        <td className="py-2 pe-3 text-muted-foreground">{s.model ?? '—'}</td>
                        <td className="py-2 pe-3 text-end tabular-nums">{num(s.tokens)}</td>
                        <td className="py-2 pe-3 text-end tabular-nums">{num(s.webSearches)}</td>
                        <td className="py-2 pe-3 text-end tabular-nums">{usd(s.modelCostUsd, 6)}</td>
                        <td className="py-2 text-end tabular-nums">{usd(s.searchCostUsd, 6)}</td>
                      </tr>
                    ))}
                    {detail.stages.length === 0 ? (
                      <tr><td colSpan={6} className="py-3 text-muted-foreground">{t('vcogs_no_stages')}</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ── EVERY VERIFICATION ──────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">{t('vcogs_recent')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[56rem] text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pe-3 text-start font-medium">{t('vcogs_col_completed')}</th>
                  <th className="py-2 pe-3 text-start font-medium">{t('vcogs_col_subject')}</th>
                  <th className="py-2 pe-3 text-start font-medium">{t('vcogs_col_account')}</th>
                  <th className="py-2 pe-3 text-end font-medium">{t('vcogs_col_duration')}</th>
                  <th className="py-2 pe-3 text-end font-medium">{t('vcogs_col_tokens')}</th>
                  <th className="py-2 pe-3 text-end font-medium">{t('vcogs_col_cached')}</th>
                  <th className="py-2 pe-3 text-end font-medium">{t('vcogs_col_searches')}</th>
                  <th className="py-2 pe-3 text-end font-medium">{t('vcogs_col_model_cost')}</th>
                  <th className="py-2 pe-3 text-end font-medium">{t('vcogs_col_search_cost')}</th>
                  <th className="py-2 pe-3 text-end font-medium">{t('vcogs_col_total')}</th>
                  <th className="py-2 pe-3 text-start font-medium">{t('vcogs_col_price_state')}</th>
                  <th className="py-2 text-start font-medium">{t('vcogs_col_reuse')}</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.jobId} className="border-b border-border/60 align-top">
                    <td className="py-2 pe-3 whitespace-nowrap tabular-nums">{j.completedAt ? new Date(j.completedAt).toISOString().replace('T', ' ').slice(0, 16) : '—'}</td>
                    <td className="py-2 pe-3">
                      <button type="button" className="text-start underline underline-offset-2" onClick={() => { setLookup(j.jobId); void inspect(j.jobId); }}>
                        {j.subject ?? j.jobId.slice(0, 8)}
                      </button>
                    </td>
                    <td className="py-2 pe-3 break-words">{j.userEmail ?? t('vcogs_anonymous')}</td>
                    <td className="py-2 pe-3 text-end tabular-nums">{secs(j.durationSeconds)}</td>
                    <td className="py-2 pe-3 text-end tabular-nums">{num(j.totalTokens)}</td>
                    <td className="py-2 pe-3 text-end tabular-nums">{num(j.cachedInputTokens)}</td>
                    <td className="py-2 pe-3 text-end tabular-nums">{num(j.webSearches)}</td>
                    <td className="py-2 pe-3 text-end tabular-nums">{usd(j.modelCostUsd, 6)}</td>
                    <td className="py-2 pe-3 text-end tabular-nums">{usd(j.searchCostUsd, 6)}</td>
                    <td className="py-2 pe-3 text-end tabular-nums font-semibold">{usd(j.providerCogsUsd, 6)}</td>
                    <td className="py-2 pe-3"><PriceStateBadge state={j.priceState} /></td>
                    <td className="py-2">{j.reuseGraphHit ? `${t('vcogs_reuse_yes')} (${num(j.reuseFactsReused)})` : t('vcogs_reuse_no')}</td>
                  </tr>
                ))}
                {!loading && jobs.length === 0 ? (
                  <tr><td colSpan={12} className="py-3 text-muted-foreground">{t('vcogs_empty')}</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
