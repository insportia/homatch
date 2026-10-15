// POST OPPORTUNITY — one comparable post and the interest its audience showed
// (/property/:id/buyers/opportunity/:key?job=…). Find Buyers 3.0, 2026-10-15.
//
// Everything on this page comes from what HOMATCH read: the platform's reported comment
// total (or "not reported"), the comments actually analyzed, the people and signals found
// among them. Nothing is extrapolated to the comments not read, and nobody is called a
// buyer: these are people who asked about a comparable property. Contact happens on the
// source platform, by the owner, one person at a time — HOMATCH sends nothing.

import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Check, Copy, ExternalLink, MessageCircle, Sparkles } from 'lucide-react';
import { RouteGuard } from '@/components/common/RouteGuard';
import { AppLayout } from '@/components/layouts/AppLayout';
import { CustomerSurface, DISCOVERY_SURFACE, EmptyState } from '@/components/customer/surface';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { formatMoney, intlLocaleFor } from '@/components/workspace/primitives';
import { sourceStyle } from '@/components/findBuyers/brand';
import { useExternalResults } from '@/components/findBuyers/useExternalResults';
import { daysAgo, ownerFactsOf, type OwnerFacts } from '@/findBuyers/externalResults';
import { readProperty } from '@/services/propertyManagement';
import type { PropertyFacts } from '@/types/types';

const CARD = 'rounded-2xl bg-white p-4 ring-1 ring-inset ring-[hsl(40_50%_86%)] sm:p-5';


function OpportunityContent() {
  const { t, lang } = useLanguage();
  const { id: propertyId = '', key = '' } = useParams<{ id: string; key: string }>();
  const [params] = useSearchParams();
  const job = params.get('job');
  const [owner, setOwner] = useState<OwnerFacts | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!propertyId) return;
    readProperty(propertyId).then((p) => setOwner(ownerFactsOf((p as { facts?: PropertyFacts | PropertyFacts[] } | null)?.facts))).catch(() => setOwner(null));
  }, [propertyId]);
  const r = useExternalResults(propertyId, job ?? undefined, owner);
  const op = useMemo(() => r.opportunities.find((o) => o.key === key) ?? null, [r.opportunities, key]);
  const money = (n: number, cur: string) => formatMoney(n, cur, intlLocaleFor(lang), { decimals: 0, narrowSymbol: true });
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(intlLocaleFor(lang), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : t('fbo_not_reported'));

  const loading = r.leads === null && !r.failed;
  const latest = op ? daysAgo(op.latestCommentAt) : null;
  const analyzedAt = op ? op.leads.map((l) => l.created_at).sort().at(-1) ?? null : null;
  const draft = t('fbo_draft_text');

  return (
    <AppLayout noPadding surfaceClass={DISCOVERY_SURFACE}>
      <CustomerSurface className="pb-32">
        <div className="pt-4 sm:pt-5">
          <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-[hsl(34_90%_36%)]">{t('fbo_eyebrow')}</p>
          <h1 className="mt-0.5 font-display text-xl font-semibold text-[hsl(218_45%_14%)]">{t('fbo_title')}</h1>
        </div>
        {loading ? <div className="mt-4 h-48 rounded-2xl bg-white/70 motion-safe:animate-pulse" />
          : r.failed ? <p role="alert" data-testid="fbo-error" className={cn(CARD, 'mt-4 text-sm')}>{t('fbx_results_failed')}</p>
          : !op ? <div className="mt-4"><EmptyState icon={Sparkles} title={t('fbo_gone')} /></div>
          : (
            <div className="mt-4 space-y-3" data-testid="fbo-detail" data-key={op.key}>
              {/* The comparable post */}
              <section className={CARD}>
                {(() => { const src = sourceStyle(op.platform); return (
                  <p className="flex items-center gap-1.5 text-2xs font-semibold text-[hsl(218_28%_38%)]">
                    <span style={{ color: src.color }} aria-hidden="true"><src.Icon className="h-3.5 w-3.5" /></span>{src.label}
                    <span className="ms-auto rounded-full bg-[hsl(42_100%_94%)] px-2 py-0.5 text-[hsl(34_90%_30%)]">{t('fbo_score', { n: String(op.opportunityScore) })}</span>
                  </p>); })()}
                {op.excerpt && <p className="mt-2 whitespace-pre-line break-words text-sm text-[hsl(218_45%_14%)]">{op.excerpt}</p>}
                {op.facts && (
                  <p className="mt-2 flex flex-wrap gap-1.5 text-2xs font-semibold text-[hsl(218_45%_14%)]" data-testid="fbo-facts">
                    {op.facts.price != null && op.facts.currency && <span className="rounded-full bg-[hsl(40_33%_96%)] px-2 py-0.5">{money(op.facts.price, op.facts.currency)}</span>}
                    {op.facts.areaSqm != null && <span className="rounded-full bg-[hsl(40_33%_96%)] px-2 py-0.5">{op.facts.areaSqm} m²</span>}
                    {op.facts.bedrooms != null && <span className="rounded-full bg-[hsl(40_33%_96%)] px-2 py-0.5">{t('fbo_bedrooms', { n: String(op.facts.bedrooms) })}</span>}
                  </p>
                )}
                <a href={op.url} target="_blank" rel="noopener noreferrer" data-testid="fbo-open-post"
                  className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-[hsl(218_45%_14%)] ring-1 ring-inset ring-[hsl(40_60%_76%)]">
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />{t('fbo_open_post')}
                </a>
              </section>

              {/* Post activity: total (as reported) · analyzed · signals */}
              <section className={CARD} aria-label={t('fbo_activity')}>
                <h2 className="text-sm font-semibold text-[hsl(218_45%_14%)]">{t('fbo_activity')}</h2>
                <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="fbo-stats">
                  {([['fbo_stat_comments', op.totalComments, 'total'], ['fbo_stat_analyzed', op.analyzedComments, 'analyzed'],
                    ['fbo_stat_people', op.interestedPeople, 'people'], ['fbo_stat_signals', op.signalTotal, 'signals']] as const).map(([k, v, id]) => (
                    <div key={k} className="rounded-xl bg-[hsl(40_33%_98%)] px-2 py-2 text-center ring-1 ring-inset ring-[hsl(40_30%_90%)]">
                      <dd className="font-display text-lg font-semibold tabular-nums text-[hsl(218_45%_14%)]" data-testid={`fbo-stat-${id}`}>{v ?? '—'}</dd>
                      <dt className="text-2xs text-[hsl(218_28%_38%)]">{t(k)}</dt>
                    </div>
                  ))}
                </dl>
                {op.totalComments == null && <p className="mt-2 text-2xs text-[hsl(218_28%_38%)]">{t('fbo_total_unknown')}</p>}
                {op.totalComments != null && op.analyzedComments != null && op.totalComments > op.analyzedComments && (
                  <p className="mt-2 text-2xs text-[hsl(218_28%_38%)]" data-testid="fbo-unread">{t('fbo_unread_note', { n: String(op.totalComments - op.analyzedComments) })}</p>
                )}
                <ul className="mt-3 space-y-1.5" data-testid="fbo-breakdown">
                  {Object.entries(op.breakdown).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).map(([s, n]) => (
                    <li key={s} className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate text-[hsl(218_45%_14%)]">{t(`fbo_sig_${s}`)}</span>
                      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-[hsl(40_30%_92%)]" aria-hidden="true">
                        <span className="block h-full rounded-full bg-[hsl(38_92%_50%)]" style={{ width: `${Math.min(100, ((n ?? 0) / Math.max(1, op.signalTotal)) * 100)}%` }} />
                      </span>
                      <span className="w-6 text-end font-semibold tabular-nums">{n}</span>
                    </li>
                  ))}
                </ul>
              </section>

              {/* Why this matters + freshness */}
              <section className={CARD}>
                <h2 className="text-sm font-semibold text-[hsl(218_45%_14%)]">{t('fbo_why')}</h2>
                <p className="mt-1 text-sm text-[hsl(218_45%_14%)]">{t('fbo_why_similar', { n: String(Math.round(op.similarity)) })}</p>
                {op.comparison && (
                  <p className="mt-1 text-sm text-[hsl(218_45%_14%)]" data-testid="fbo-comparison">
                    {op.comparison.difference < 0 ? t('fbo_cheaper', { amount: money(-op.comparison.difference, op.comparison.currency) })
                      : op.comparison.difference > 0 ? t('fbo_pricier', { amount: money(op.comparison.difference, op.comparison.currency) }) : t('fbo_same_price')}
                    {op.comparison.ownerPerSqm != null && op.comparison.comparablePerSqm != null && (
                      <span className="block text-2xs text-[hsl(218_28%_38%)]">{t('fbo_per_sqm', { own: money(op.comparison.ownerPerSqm, op.comparison.currency), other: money(op.comparison.comparablePerSqm, op.comparison.currency) })}</span>
                    )}
                  </p>
                )}
                <p className="mt-1 text-2xs text-[hsl(218_28%_38%)]">{t('fbo_comparison_caveat')}</p>
                <dl className="mt-3 grid gap-1 text-2xs text-[hsl(218_28%_38%)]" data-testid="fbo-freshness">
                  <div className="flex justify-between gap-2"><dt>{t('fbo_post_date')}</dt><dd className="text-end">{fmt(op.postPublishedAt)}</dd></div>
                  <div className="flex justify-between gap-2"><dt>{t('fbo_latest_comment')}</dt><dd className="text-end">{latest == null ? t('fbo_not_reported') : t('fbo_latest_days', { n: String(latest) })}</dd></div>
                  <div className="flex justify-between gap-2"><dt>{t('fbo_analyzed_at')}</dt><dd className="text-end">{fmt(analyzedAt)}</dd></div>
                </dl>
              </section>

              {/* The evidence: each comment as written, with its own link when there is one */}
              <section className={CARD} aria-label={t('fbo_evidence')}>
                <h2 className="text-sm font-semibold text-[hsl(218_45%_14%)]">{t('fbo_evidence')}</h2>
                <ul className="mt-2 space-y-2" data-testid="fbo-evidence">
                  {op.leads.map((l) => {
                    const ev = l.evidence.find((e) => e.parentUrl === op.url) ?? l.evidence[0];
                    return (
                      <li key={l.id} className="rounded-xl bg-[hsl(40_33%_98%)] p-3 ring-1 ring-inset ring-[hsl(40_30%_90%)]">
                        <p className="flex flex-wrap gap-1">
                          {l.signals.filter((s) => s !== 'IRRELEVANT' && s !== 'POSITIVE').map((s) => (
                            <span key={s} className="rounded-full bg-[hsl(218_70%_96%)] px-2 py-0.5 text-2xs font-semibold text-[hsl(220_60%_30%)]">{t(`fbo_sig_${s}`)}</span>
                          ))}
                        </p>
                        <p className="mt-1.5 whitespace-pre-line break-words text-sm text-[hsl(218_45%_14%)]" dir="auto">{ev?.text}</p>
                        <p className="mt-1.5 flex flex-wrap items-center gap-2 text-2xs text-[hsl(218_28%_38%)]">
                          <span>{ev?.publishedAt ? fmt(ev.publishedAt) : t('fbo_not_reported')}</span>
                          {ev?.url && ev.url !== op.url ? (
                            <a href={ev.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-[hsl(34_90%_32%)]">
                              <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />{t('fbo_open_comment')}
                            </a>
                          ) : <span>{t('fbo_no_comment_link')}</span>}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </section>

              {/* Recommended next action */}
              <section className={CARD}>
                <h2 className="text-sm font-semibold text-[hsl(218_45%_14%)]">{t('fbo_next')}</h2>
                <p className="mt-1 text-sm text-[hsl(218_45%_14%)]">{t('fbo_next_body')}</p>
                <p className="mt-2 rounded-xl bg-[hsl(40_33%_98%)] p-3 text-sm text-[hsl(218_45%_14%)] ring-1 ring-inset ring-[hsl(40_30%_90%)]" data-testid="fbo-draft">{draft}</p>
                <button type="button" data-testid="fbo-copy-draft"
                  onClick={() => { void navigator.clipboard?.writeText(draft).then(() => setCopied(true)).catch(() => setCopied(false)); }}
                  className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-[hsl(218_45%_14%)] ring-1 ring-inset ring-[hsl(40_60%_76%)]">
                  {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}{t(copied ? 'fbo_copied' : 'fbo_copy_draft')}
                </button>
                <p className="mt-2 text-2xs text-[hsl(218_28%_38%)]">{t('fbo_contact_note')}</p>
              </section>
            </div>
          )}
      </CustomerSurface>
    </AppLayout>
  );
}

export default function PostOpportunityPage() {
  return <RouteGuard><OpportunityContent /></RouteGuard>;
}
