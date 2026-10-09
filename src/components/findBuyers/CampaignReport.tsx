// THE SEARCH REPORT — what one Find Buyers / Find Tenants campaign actually
// did, for the owner who paid for it: the property searched, who was looked
// for, where and in which languages, how much of the research budget it
// used, how long it took, what it found (by match category, and what was set
// aside and why), its best sources, its limitations, what could improve the
// next search, and Research Notes.
//
// Every figure comes from find_buyers_campaign_report (the campaign's own
// records). The report never claims full market coverage, never shows an
// unreviewed (legacy) lead as qualified, and never shows provider money.
// While the search runs it is a live, partial report, refreshed on the
// status poll's cadence.
import React, { useEffect, useRef, useState } from 'react';
import {
  BarChart3, ChevronDown, Clock3, Compass, FileSearch, Home, Languages, Lightbulb, MapPin, ShieldAlert, Target, Trophy, Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { GOLD_FILL, GOLD_TEXT, SourceBadge } from '@/components/findBuyers/brand';
import { ResearchNotes, useReportFormatters } from '@/components/findBuyers/ResearchNotes';
import { formatMoney, intlLocaleFor } from '@/components/workspace/primitives';
import { placeName } from '@/lib/placeNames';
import { getCampaignReport } from '@/services/findBuyers';
import {
  bestSources, communityLabel, contentMix, limitationMessage, nextSearchOptions, rejectionBreakdown, secondsSinceStart, splitDuration,
  type CampaignReport as Report,
} from '@/findBuyers/campaignReport';

const SOFT = 'text-[hsl(218_40%_85%)]';
const PANEL = 'rounded-xl bg-white/[0.04] p-3.5 ring-1 ring-inset ring-white/10';
const LIVE_REFRESH_MS = 15_000;

type T = (k: string, v?: Record<string, string | number>) => string;

function duration(t: T, seconds: number | null): string {
  if (seconds == null) return '—';
  const { h, m, s } = splitDuration(seconds);
  if (h > 0) return t('fbr_time_hm', { h: String(h), m: String(m) });
  if (m > 0) return t('fbr_time_ms', { m: String(m), s: String(s) });
  return t('fbr_time_s', { s: String(s) });
}

function SectionTitle({ icon: Icon, children, id }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode; id?: string }) {
  return (
    <h4 id={id} className="flex items-center gap-2 text-2xs font-bold uppercase tracking-[0.12em] text-[hsl(40_94%_70%)]">
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">{children}</span>
    </h4>
  );
}

function Stat({ value, label, accent = false, testId }: { value: React.ReactNode; label: string; accent?: boolean; testId?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-white/[0.04] px-3 py-2.5 ring-1 ring-inset ring-white/10" data-testid={testId}>
      <p className={cn('font-display text-lg font-bold leading-none tabular-nums', accent ? GOLD_TEXT : 'text-white')} dir="ltr">{value}</p>
      <p className={cn('mt-1 text-2xs leading-snug', SOFT)}>{label}</p>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex max-w-full items-center rounded-full bg-white/5 px-2.5 py-0.5 text-2xs font-semibold text-white ring-1 ring-inset ring-white/10">
      <span className="min-w-0 break-words" dir="auto">{children}</span>
    </span>
  );
}

const personaLabel = (t: T, p: unknown): string => {
  if (p && typeof p === 'object') {
    const o = p as Record<string, unknown>;
    const v = o.label ?? o.name ?? o.title ?? o.key ?? o.id;
    if (typeof v === 'string') return personaLabel(t, v);
    return '';
  }
  const code = String(p ?? '');
  const k = `fbr_persona_${code}`;
  const s = t(k);
  return s !== k ? s : code.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
};
const placeLabel = (p: unknown, lang: string): string => {
  if (p && typeof p === 'object') {
    const o = p as Record<string, unknown>;
    const v = o.label ?? o.name ?? o.district ?? o.city;
    return typeof v === 'string' ? placeName(v, lang) : '';
  }
  return placeName(String(p ?? ''), lang);
};

export function CampaignReport({ jobId, live, refreshKey, id }: {
  jobId: string;
  live: boolean;
  /** Changes when the status poll reports activity; the report follows, at most every 15 s while live. */
  refreshKey?: string | number | null;
  id?: string;
}) {
  const { t, lang } = useLanguage();
  const fmt = useReportFormatters();
  const [report, setReport] = useState<Report | null>(null);
  const [open, setOpen] = useState(false);
  const lastRead = useRef(0);
  const lastJob = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    const fresh = lastJob.current !== jobId;
    if (!fresh && live && Date.now() - lastRead.current < LIVE_REFRESH_MS) return undefined;
    if (fresh) { lastJob.current = jobId; setReport(null); }
    lastRead.current = Date.now();
    void getCampaignReport(jobId).then((r) => { if (alive && r) setReport(r); }).catch(() => {});
    return () => { alive = false; };
  }, [jobId, live, refreshKey]);

  if (!report) return null;
  const r = report.results;
  const cov = report.coverage;
  const p = report.property;
  const prof = report.buyerProfile;
  const tenants = p.counterpart === 'TENANT';
  const locale = intlLocaleFor(lang);
  const cur = p.currency ?? 'USD';
  const money = (v: number | null | undefined, c = cur) => (v == null ? '—' : formatMoney(v, c, locale, { decimals: 0, narrowSymbol: true }));
  const range = (o: { min?: number | null; max?: number | null } | null, f: (v: number) => string = (v) => String(v)) =>
    (o && o.min != null && o.max != null ? (o.min === o.max ? f(o.min) : `${f(o.min)} – ${f(o.max)}`) : null);
  const place = [p.neighborhood, p.district, p.city].filter(Boolean).map((x) => placeName(String(x), lang)).join(', ');
  const typeKey = `fbr_type_${p.propertyType ?? 'PROPERTY'}`;
  const typeLabel = t(typeKey) === typeKey ? t('fbr_type_PROPERTY') : t(typeKey);
  const best = bestSources(report);
  const rejected = rejectionBreakdown(report);
  const mix = contentMix(report);
  const mixTotal = mix.parts.reduce((a, x) => a + x.count, 0);
  const limits = report.limitations.map((l) => limitationMessage(l, fmt)).filter((m): m is NonNullable<typeof m> => m !== null);
  const next = nextSearchOptions(report, fmt);
  const firstVisible = secondsSinceStart(report, report.timing.firstVisibleAt);
  const firstQualified = secondsSinceStart(report, report.timing.firstQualifiedAt);
  const discovery = secondsSinceStart(report, report.timing.phase1EndedAt);
  const stopped = report.coveragePlan.queue.cancelled + report.coveragePlan.queue.failed;
  const places = prof.places.map((x) => placeLabel(x, lang)).filter(Boolean);
  const personas = prof.personas.map((x) => personaLabel(t, x)).filter(Boolean);
  const budgetBand = prof.budgetBand ? range(prof.budgetBand, (v) => money(v, prof.budgetBand?.currency ?? cur)) : null;

  return (
    /* Not a live region: the report refreshes every few seconds while running. */
    <section id={id} aria-labelledby="fbr-title" aria-live="off" data-testid="fbr-report" data-live={report.live ? 'true' : 'false'}
      className="mt-5 space-y-3 border-t border-white/10 pt-4">
      {/* ── headline ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="fbr-title" className="flex min-w-0 items-center gap-2 font-display text-base font-semibold text-white">
          <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', GOLD_FILL)}>
            <FileSearch className="h-4 w-4 text-[hsl(218_52%_11%)]" aria-hidden="true" />
          </span>
          <span className="break-words">{t('fbr_title')}</span>
        </h3>
        <span data-testid="fbr-state" className={cn('rounded-full px-2.5 py-0.5 text-2xs font-semibold ring-1 ring-inset',
          report.live ? 'bg-[hsl(40_94%_64%/0.14)] text-[hsl(40_94%_72%)] ring-[hsl(40_80%_60%/0.45)]' : 'bg-white/5 text-white ring-white/15')}>
          {t(report.live ? 'fbr_live_badge' : 'fbr_final_badge')}
        </span>
      </div>
      <p className={cn('text-2xs leading-relaxed', SOFT)} data-testid="fbr-scope">{t('fbr_scope_disclaimer')}</p>

      {/* ── summary: results, budget, time, work done ── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="fbr-summary">
        <Stat testId="fbr-strong" value={r.strong} label={t('fbr_cat_STRONG')} accent={r.strong > 0} />
        <Stat testId="fbr-potential" value={r.potential} label={t('fbr_cat_POTENTIAL')} accent={r.potential > 0} />
        <Stat testId="fbr-weak" value={r.weak} label={t('fbr_cat_WEAK')} />
        {r.uncategorised > 0
          ? <Stat testId="fbr-uncategorised" value={r.uncategorised} label={t('fbr_cat_UNCATEGORISED')} />
          : <Stat testId="fbr-rejected" value={r.rejected} label={t('fbr_set_aside')} />}
        <Stat value={report.budget.usedPct == null ? '—' : `${report.budget.usedPct}%`} label={t('fbr_budget_used_short')} />
        <Stat value={duration(t, report.timing.durationSeconds)} label={t(report.live ? 'fbr_dur_running_short' : 'fbr_dur_total_short')} />
        <Stat value={cov.signalsAnalysed} label={t('fbr_cov_signals')} />
        <Stat value={cov.postsRetrieved} label={t('fbr_cov_posts')} />
      </div>

      <ResearchNotes report={report} />

      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="fbr-details" data-testid="fbr-toggle"
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-white/5 px-4 text-sm font-semibold text-white ring-1 ring-inset ring-[hsl(40_80%_60%/0.55)] transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]">
        <span>{t(open ? 'fbr_toggle_hide' : 'fbr_toggle_show')}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>

      {open && (
        <div id="fbr-details" className="grid gap-3 lg:grid-cols-2" data-testid="fbr-details">
          {/* Property searched */}
          <div className={PANEL} data-testid="fbr-property">
            <SectionTitle icon={Home}>{t('fbr_sec_property')}</SectionTitle>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Chip>{t(p.transaction === 'RENT' ? 'fbl_dna_for_rent' : 'fbl_dna_for_sale')}</Chip>
              <Chip>{typeLabel}</Chip>
              {p.rooms != null && <Chip>{t('fbr_prop_rooms', { n: String(p.rooms) })}</Chip>}
              {p.bedrooms != null && <Chip>{t('fbr_prop_bedrooms', { n: String(p.bedrooms) })}</Chip>}
              {p.areaSqm != null && <Chip>{t('fbr_prop_area', { n: String(Math.round(p.areaSqm)) })}</Chip>}
              {p.price != null && <Chip>{t('fbr_prop_price', { price: money(p.price) })}</Chip>}
              {place && <Chip>{place}</Chip>}
            </div>
          </div>

          {/* Profile targeted */}
          <div className={PANEL} data-testid="fbr-profile">
            <SectionTitle icon={Target}>{t(tenants ? 'fbr_sec_profile_tenants' : 'fbr_sec_profile')}</SectionTitle>
            <p className={cn('mt-1 text-2xs', SOFT)}>{t(prof.basis === 'STRATEGY' ? 'fbr_profile_basis_strategy' : 'fbr_profile_basis_property')}</p>
            <ul className="mt-2 space-y-1 text-2xs text-white">
              {budgetBand && <li>{t('fbr_profile_budget', { range: budgetBand })}</li>}
              {range(prof.bedrooms) && <li>{t('fbr_profile_bedrooms', { range: range(prof.bedrooms)! })}</li>}
              {range(prof.area) && <li>{t('fbr_profile_area', { range: range(prof.area)! })}</li>}
              {places.length > 0 && <li>{t('fbr_profile_places', { places: places.join(', ') })}</li>}
            </ul>
            {personas.length > 0 && (
              <div className="mt-2">
                <p className={cn('text-2xs', SOFT)}>{t('fbr_profile_personas')}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">{personas.map((x) => <Chip key={x}>{x}</Chip>)}</div>
              </div>
            )}
          </div>

          {/* Coverage */}
          <div className={cn(PANEL, 'lg:col-span-2')} data-testid="fbr-coverage">
            <SectionTitle icon={Compass}>{t('fbr_sec_coverage')}</SectionTitle>
            <div className="mt-2 space-y-2.5">
              {cov.languages.length > 0 && (
                <div>
                  <p className={cn('flex items-center gap-1.5 text-2xs', SOFT)}><Languages className="h-3.5 w-3.5" aria-hidden="true" />{t('fbr_cov_languages')}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">{cov.languages.map((l) => <Chip key={l}>{fmt.languages([l])}</Chip>)}</div>
                </div>
              )}
              {cov.platforms.length > 0 && (
                <div>
                  <p className={cn('text-2xs', SOFT)}>{t('fbr_cov_platforms')}</p>
                  <ul className="mt-1 flex flex-wrap gap-1.5" data-testid="fbr-platforms">
                    {cov.platforms.map((x) => (
                      <li key={x.platform} className="inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-full bg-white/[0.03] py-0.5 pe-2.5 ring-1 ring-inset ring-white/10" data-state={x.state}>
                        <SourceBadge source={x.platform} onDark />
                        <span className={cn('text-2xs', x.state === 'FAILED' ? 'text-[hsl(350_80%_85%)]' : SOFT)}>
                          {t(`fbr_platform_${x.state}`)}{x.items > 0 ? ` · ${x.items}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {cov.locations.length > 0 && (
                <p className="flex flex-wrap items-center gap-1.5 text-2xs text-white">
                  <MapPin className={cn('h-3.5 w-3.5 shrink-0', GOLD_TEXT)} aria-hidden="true" />
                  <span className={SOFT}>{t('fbr_cov_locations')}:</span> {cov.locations.map((l) => placeName(l, lang)).join(', ')}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat value={cov.communitiesDiscovered} label={t('fbr_cov_communities')} />
                <Stat value={cov.communitiesRead} label={t('fbr_cov_communities_read')} />
                <Stat value={cov.commentsExamined} label={t('fbr_cov_comments')} />
                <Stat value={cov.staleSkipped} label={t('fbr_cov_stale')} />
              </div>
              <p className={cn('text-2xs leading-relaxed', SOFT)} data-testid="fbr-tasks">
                {t('fbr_cov_tasks', { done: String(report.coveragePlan.queue.done), total: String(report.coveragePlan.queue.total), stopped: String(stopped) })}
                {cov.duplicatesRemoved > 0 ? <>{' · '}{t('fbr_cov_dupes', { n: String(cov.duplicatesRemoved) })}</> : null}
              </p>
            </div>
          </div>

          {/* Budget + duration */}
          <div className={PANEL} data-testid="fbr-budget">
            <SectionTitle icon={Wallet}>{t('fbr_sec_budget')}</SectionTitle>
            <p className="mt-2 text-2xs text-white">{t('fbr_budget_credits', { n: String(report.budget.creditsCommitted) })}</p>
            <p className="mt-1 text-2xs text-white">
              {report.budget.usedPct == null ? t('fbr_budget_unknown') : t('fbr_budget_used', { pct: String(report.budget.usedPct) })}
            </p>
            {report.budget.usedPct != null && (
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={report.budget.usedPct} aria-label={t('fbr_budget_used_short')}>
                <div className={cn('h-full rounded-full', GOLD_FILL)} style={{ width: `${Math.min(100, report.budget.usedPct)}%` }} />
              </div>
            )}
            {report.budget.exhausted && <p className={cn('mt-2 text-2xs', SOFT)}>{t('fbr_budget_exhausted')}</p>}
          </div>
          <div className={PANEL} data-testid="fbr-duration">
            <SectionTitle icon={Clock3}>{t('fbr_sec_duration')}</SectionTitle>
            <ul className="mt-2 space-y-1 text-2xs text-white">
              <li>{t(report.live ? 'fbr_dur_running' : 'fbr_dur_total', { time: duration(t, report.timing.durationSeconds) })}</li>
              {discovery != null && <li>{t('fbr_dur_discovery', { time: duration(t, discovery) })}</li>}
              {firstVisible != null && <li>{t('fbr_dur_first_visible', { time: duration(t, firstVisible) })}</li>}
              {firstQualified != null && <li>{t('fbr_dur_first_qualified', { time: duration(t, firstQualified) })}</li>}
            </ul>
          </div>

          {/* Results */}
          <div className={cn(PANEL, 'lg:col-span-2')} data-testid="fbr-results">
            <SectionTitle icon={BarChart3}>{t('fbr_sec_results')}</SectionTitle>
            {r.uncategorised > 0 && <p className={cn('mt-1 text-2xs', SOFT)}>{t('fbr_cat_explain_UNCATEGORISED')}</p>}
            {r.rejected > 0 && (
              <div className="mt-2">
                <p className="text-2xs font-semibold text-white">{t('fbr_results_rejected', { n: String(r.rejected) })}</p>
                <ul className="mt-1 space-y-1" data-testid="fbr-rejections">
                  {rejected.map((x) => (
                    <li key={x.reason} className="flex items-center justify-between gap-3 text-2xs">
                      <span className={cn('min-w-0 break-words', SOFT)}>{t(`fbr_rej_${x.reason}`)}</span>
                      <span className="shrink-0 font-semibold tabular-nums text-white">{x.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {mixTotal > 0 && (
              <div className="mt-3">
                <p className="text-2xs font-semibold text-white">{t(mix.basis === 'ROLE' ? 'fbr_mix_title_role' : 'fbr_mix_title_intent')}</p>
                <ul className="mt-1.5 space-y-1.5" data-testid="fbr-mix">
                  {mix.parts.map((x) => {
                    const share = Math.round((x.count / mixTotal) * 100);
                    return (
                      <li key={x.kind} className="text-2xs">
                        <div className="flex items-center justify-between gap-3">
                          <span className={cn('min-w-0 break-words', SOFT)}>{t(mix.basis === 'ROLE' ? `fbr_role_${x.kind}` : `fbr_mix_${x.kind}`)}</span>
                          <span className="shrink-0 tabular-nums text-white" dir="ltr">{x.count} · {share}%</span>
                        </div>
                        <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
                          <div className="h-full rounded-full bg-[hsl(40_94%_64%/0.8)]" style={{ width: `${share}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>

          {/* Best sources */}
          <div className={PANEL} data-testid="fbr-sources">
            <SectionTitle icon={Trophy}>{t('fbr_sec_sources')}</SectionTitle>
            {best.length === 0 ? (
              <p className={cn('mt-2 text-2xs', SOFT)}>{t('fbr_src_none')}</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {best.map((s) => (
                  <li key={`${s.platform}-${s.community ?? ''}`} className="space-y-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <SourceBadge source={s.platform} onDark />
                      {communityLabel(s.community) && <span className="min-w-0 break-all text-2xs font-semibold text-white" dir="ltr">{communityLabel(s.community)}</span>}
                    </div>
                    <p className={cn('text-2xs', SOFT)}>
                      {t('fbr_src_line', { qualified: String(s.qualified), posts: String(s.postsRead) })}
                      {s.budgetSharePct != null ? <>{' · '}{t('fbr_src_share', { share: String(s.budgetSharePct) })}</> : null}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Limitations */}
          <div className={PANEL} data-testid="fbr-limitations">
            <SectionTitle icon={ShieldAlert}>{t('fbr_sec_limits')}</SectionTitle>
            {limits.length === 0 ? <p className={cn('mt-2 text-2xs', SOFT)}>{t('fbr_lim_none')}</p> : (
              <ul className="mt-2 list-disc space-y-1 ps-4 text-2xs leading-relaxed text-white marker:text-[hsl(40_94%_64%)]">
                {limits.map((m, i) => <li key={`${m.key}-${i}`} className="break-words">{t(m.key, m.vars)}</li>)}
              </ul>
            )}
          </div>

          {/* Next search */}
          <div className={cn(PANEL, 'lg:col-span-2')} data-testid="fbr-next">
            <SectionTitle icon={Lightbulb}>{t('fbr_sec_next')}</SectionTitle>
            {next.length === 0 ? <p className={cn('mt-2 text-2xs', SOFT)}>{t('fbr_next_none')}</p> : (
              <ul className="mt-2 list-disc space-y-1 ps-4 text-2xs leading-relaxed text-white marker:text-[hsl(40_94%_64%)]">
                {next.map((m, i) => <li key={`${m.key}-${i}`} className="break-words">{t(m.key, m.vars)}</li>)}
              </ul>
            )}
            <p className={cn('mt-2 text-2xs italic', SOFT)}>{t('fbr_next_disclaimer')}</p>
          </div>
        </div>
      )}
    </section>
  );
}

export default CampaignReport;
