// HOMATCH INVESTMENT INTELLIGENCE — what the market is asking, and what
// the investor assumed.
//
// THE RULE THIS COMPONENT EXISTS TO MAKE VISIBLE
//
// Research never overwrites an assumption. The investor's $500 and the
// observed $540–$590 sit side by side, and the only way the second
// replaces the first is a button the investor presses. When they do, the
// value's provenance chip changes to RESEARCH everywhere it appears, so
// the change is not just consented to but permanently legible.
//
// WHAT AN "ASKING" RANGE IS
//
// What other landlords and sellers are ADVERTISING. Not what was paid, not
// what was achieved, and not a valuation. Georgia's Public Registry does
// not publish transaction prices in a form public research can read, so
// this product never claims one — the basis is printed on the range
// itself, not buried in a tooltip.
//
// EVERY NUMBER IS INSPECTABLE
//
// The drawer lists the actual adverts: the URL, the source, the price, the
// area, when we read it, and which other adverts appear to be the same
// property. A range nobody can check is a rumour with a decimal point.

import React, { useState } from 'react';
import { ChevronDown, ExternalLink, Loader2, Search } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import type { AssumptionComparison, OfferKind } from '@/investment/evidence/compare';
import { captionKeyFor } from '@/investment/evidence/compare';
import type { LaneResult, ResearchPhase } from './useInvestmentSession';
import { Module, formatMoney, intlLocaleFor } from './primitives';

export function EvidenceModule({
  lanes,
  comparisons,
  phase,
  steps,
  error,
  currency,
  canResearch,
  missing,
  onResearch,
  onApply,
  focused,
}: {
  lanes: LaneResult[];
  comparisons: AssumptionComparison[];
  phase: ResearchPhase;
  steps: string[];
  error: string | null;
  currency: string;
  canResearch: boolean;
  missing: string[];
  onResearch: () => void;
  onApply: (comparison: AssumptionComparison, kind: OfferKind) => void;
  focused: boolean;
}) {
  const { t } = useLanguage();

  return (
    <Module
      id="evidence"
      eyebrowKey="inv_mod_evidence_eyebrow"
      titleKey="inv_mod_evidence_title"
      subtitleKey="inv_mod_evidence_sub"
      focused={focused}
      actions={
        <button
          type="button"
          onClick={onResearch}
          disabled={!canResearch || phase === 'RUNNING'}
          className={cn(
            'flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium transition-colors',
            canResearch && phase !== 'RUNNING'
              ? 'bg-[hsl(var(--gold))] text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--gold-hover))]'
              : 'bg-[hsl(var(--muted))] text-muted-foreground',
          )}
        >
          {phase === 'RUNNING' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Search className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {phase === 'DONE' ? t('inv_research_again') : t('inv_research_run')}
        </button>
      }
    >
      <p className="mb-5 rounded-lg border border-dashed border-border px-4 py-3 text-2xs leading-relaxed text-muted-foreground">
        {t('inv_research_free_note')}
      </p>

      {!canResearch && missing.length ? (
        <p className="mb-5 text-sm text-muted-foreground">
          {t('inv_needs_input_prefix')}{' '}
          <span className="text-foreground">{missing.map((key) => t(key)).join(', ')}</span>
        </p>
      ) : null}

      {phase === 'RUNNING' ? (
        <ol className="mb-5 space-y-2">
          {steps.map((key, index) => (
            <li key={`${key}-${index}`} className="flex items-center gap-2.5 text-sm text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--gold))]" aria-hidden="true" />
              {t(key)}
            </li>
          ))}
        </ol>
      ) : null}

      {phase === 'UNAUTHENTICATED' ? (
        <p className="mb-5 rounded-lg border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] px-4 py-3 text-sm text-foreground">
          {t('inv_research_sign_in')}
        </p>
      ) : null}
      {phase === 'RATE_LIMITED' ? (
        <p className="mb-5 rounded-lg border border-border px-4 py-3 text-sm text-muted-foreground">
          {t('inv_research_rate_limited')}
        </p>
      ) : null}
      {error ? (
        <p className="mb-5 rounded-lg border border-border px-4 py-3 text-sm text-muted-foreground">
          {t(error)}
        </p>
      ) : null}

      {comparisons.length ? (
        <div className="space-y-4">
          {comparisons.map((comparison) => (
            <ComparisonCard
              key={`${comparison.field}-${comparison.evidence.basis}`}
              comparison={comparison}
              currency={currency}
              onApply={onApply}
            />
          ))}
        </div>
      ) : null}

      {lanes.length ? (
        <div className="mt-6 space-y-3">
          {lanes.map((lane) => (
            <LaneDetail key={lane.transaction} lane={lane} />
          ))}
        </div>
      ) : null}

      {phase === 'DONE' && !comparisons.length && !lanes.some((l) => l.comparables.length) ? (
        <p className="text-sm text-muted-foreground">{t('inv_research_nothing_found')}</p>
      ) : null}
    </Module>
  );
}

function ComparisonCard({
  comparison,
  currency,
  onApply,
}: {
  comparison: AssumptionComparison;
  currency: string;
  onApply: (comparison: AssumptionComparison, kind: OfferKind) => void;
}) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const evidenceCurrency = comparison.evidence.currency || currency;

  return (
    <div className="rounded-xl border border-border bg-[hsl(var(--secondary))] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-foreground">{t(`inv_field_${comparison.field}`)}</p>
        <span className="rounded-full border border-[hsl(var(--gold-border))] px-2.5 py-0.5 text-2xs text-[hsl(var(--gold-ink))]">
          {t(`inv_basis_label_${comparison.evidence.basis}`)}
        </span>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-2xs uppercase tracking-wide text-muted-foreground">
            {t('inv_evidence_your_assumption')}
          </p>
          <p className="mt-1 font-display text-xl font-semibold tabular-nums text-foreground">
            {comparison.assumption === null
              ? t('inv_evidence_none_yet')
              : formatMoney(comparison.assumption, currency, locale)}
          </p>
        </div>
        <div>
          <p className="text-2xs uppercase tracking-wide text-muted-foreground">
            {t('inv_evidence_observed_range')}
          </p>
          <p className="mt-1 font-display text-xl font-semibold tabular-nums text-[hsl(var(--gold-ink))]">
            {formatMoney(comparison.evidence.low, evidenceCurrency, locale)} –{' '}
            {formatMoney(comparison.evidence.high, evidenceCurrency, locale)}
          </p>
        </div>
      </div>

      <p className="mt-3 text-sm text-muted-foreground">
        {t(`inv_evidence_verdict_${comparison.verdict}`)}
      </p>

      <p className="mt-2 text-2xs leading-relaxed text-muted-foreground">
        {t(captionKeyFor(comparison.evidence))}{' '}
        {t('inv_evidence_support', {
          observations: comparison.evidence.observationCount,
          sources: comparison.evidence.independentSourceCount,
          properties: comparison.evidence.uniquePropertyCount,
        })}
        {comparison.evidence.conflictCount > 0
          ? ` ${t('inv_evidence_conflicts', { n: comparison.evidence.conflictCount })}`
          : ''}
      </p>

      {comparison.thin ? (
        <p className="mt-2 text-2xs text-[hsl(var(--warning))]">{t('inv_evidence_thin')}</p>
      ) : null}
      {comparison.evidence.periodAssumedMonthly ? (
        <p className="mt-2 text-2xs text-muted-foreground">{t('inv_evidence_period_assumed')}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {(['LOW', 'MEDIAN', 'HIGH'] as const).map((kind) => {
          const offer = comparison.offers.find((o) => o.kind === kind);
          if (!offer?.value) return null;
          return (
            <button
              key={kind}
              type="button"
              onClick={() => onApply(comparison, kind)}
              className="rounded-full border border-border px-3.5 py-1.5 text-xs tabular-nums text-muted-foreground transition-colors hover:border-[hsl(var(--gold-border))] hover:text-foreground"
            >
              {t(`inv_evidence_use_${kind}`)} · {formatMoney(offer.value, evidenceCurrency, locale)}
            </button>
          );
        })}
        <span className="rounded-full border border-dashed border-border px-3.5 py-1.5 text-xs text-muted-foreground">
          {t('inv_evidence_keep_mine')}
        </span>
      </div>
    </div>
  );
}

function LaneDetail({ lane }: { lane: LaneResult }) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const [open, setOpen] = useState(false);

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 bg-[hsl(var(--secondary))] px-4 py-3 text-start"
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium text-foreground">
            {t(lane.transaction === 'RENT' ? 'inv_lane_rent' : 'inv_lane_sale')}
          </span>
          <span className="mt-0.5 block text-2xs text-muted-foreground">
            {t('inv_lane_summary', {
              adverts: lane.comparables.length,
              properties: lane.uniquePropertyCount,
              crossPosted: lane.crossPostedCount,
            })}
          </span>
        </span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div className="space-y-3 px-4 py-4">
          {lane.pricePerSqm ? (
            <p className="text-sm text-muted-foreground">
              {t('inv_lane_per_sqm', {
                amount: formatMoney(lane.pricePerSqm.median, lane.pricePerSqm.currency, locale),
                n: lane.pricePerSqm.count,
              })}
            </p>
          ) : null}

          <ul className="space-y-1.5 text-2xs">
            {lane.portals.map((portal) => (
              <li key={portal.id} className="flex flex-wrap items-baseline gap-2 text-muted-foreground">
                <span className="text-foreground">{portal.sourceFamily}</span>
                <span>{t(`inv_portal_state_${portal.state}`)}</span>
                <span>· {t('inv_portal_found', { n: portal.found })}</span>
                {portal.detail ? <span className="opacity-70">· {portal.detail}</span> : null}
              </li>
            ))}
          </ul>

          {lane.widened ? (
            <p className="text-2xs text-[hsl(var(--warning))]">{t('inv_lane_widened')}</p>
          ) : null}
          {lane.truncatedByDeadline ? (
            <p className="text-2xs text-muted-foreground">{t('inv_lane_truncated')}</p>
          ) : null}
          {lane.uncertainDuplicateCount > 0 ? (
            <p className="text-2xs text-muted-foreground">
              {t('inv_lane_uncertain', { n: lane.uncertainDuplicateCount })}
            </p>
          ) : null}

          {lane.comparables.length ? (
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[30rem] text-2xs">
                <caption className="sr-only">{t('inv_lane_table_caption')}</caption>
                <thead>
                  <tr className="text-muted-foreground">
                    <th scope="col" className="py-1.5 text-start font-medium">{t('inv_lane_col_price')}</th>
                    <th scope="col" className="py-1.5 text-start font-medium">{t('inv_lane_col_area')}</th>
                    <th scope="col" className="py-1.5 text-start font-medium">{t('inv_lane_col_per_sqm')}</th>
                    <th scope="col" className="py-1.5 text-start font-medium">{t('inv_lane_col_source')}</th>
                  </tr>
                </thead>
                <tbody>
                  {lane.comparables.slice(0, 20).map((advert) => (
                    <tr key={advert.url} className="border-t border-border">
                      <td className="py-1.5 tabular-nums text-foreground">
                        {advert.price !== null && advert.currency
                          ? formatMoney(advert.price, advert.currency, locale)
                          : '—'}
                      </td>
                      <td className="py-1.5 tabular-nums text-muted-foreground">
                        {advert.areaSqm ? `${advert.areaSqm} m²` : '—'}
                      </td>
                      <td className="py-1.5 tabular-nums text-muted-foreground">
                        {advert.pricePerSqm !== null && advert.currency
                          ? formatMoney(advert.pricePerSqm, advert.currency, locale)
                          : '—'}
                      </td>
                      <td className="py-1.5">
                        <a
                          href={advert.url}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="inline-flex items-center gap-1 text-[hsl(var(--gold-ink))] underline-offset-2 hover:underline"
                        >
                          {advert.sourceFamily}
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                        {advert.alsoListedAt.length ? (
                          <span className="ms-1.5 text-muted-foreground">
                            {t('inv_lane_also_listed', { n: advert.alsoListedAt.length })}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <p className="text-2xs text-muted-foreground">
            {t('inv_lane_retrieved', { at: new Date(lane.finishedAt).toLocaleString(locale) })}
          </p>
        </div>
      ) : null}
    </div>
  );
}
