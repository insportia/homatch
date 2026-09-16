import React from 'react';
import { MapPin, Eye, EyeOff, CalendarDays } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  formatDate, formatMoney, formatNumber, formatArea,
} from './primitives';
import { SalesBar, Metric, ProjectCover, type StatusCounts } from './visuals';
import type { DevProject, DevUnit, ConstructionStatus } from '@/services/developer/types';

/**
 * ENTERING A DEVELOPMENT.
 *
 * The project page used to open on a search box and a table of twelve rows.
 * Nothing on it said which building you were in, how much of it was left, or
 * what it was worth — the name was a line of grey text above a spreadsheet,
 * and the development itself was invisible in the product that sells it.
 *
 * This is the header that answers those three questions before anything else:
 * the building (its cover, or a drawn elevation when there is no photograph
 * yet), what is left of it, and what that is worth. The bar underneath is the
 * same bar the portfolio card and the command centre draw, so a developer
 * moving between the three screens is reading one fact three times rather than
 * three numbers that might disagree.
 */

const CONSTRUCTION_KEYS: Record<ConstructionStatus, string> = {
  PLANNED: 'dev_cs_planned',
  UNDER_CONSTRUCTION: 'dev_cs_under_construction',
  FINISHING: 'dev_cs_finishing',
  COMPLETED: 'dev_cs_completed',
  HANDED_OVER: 'dev_cs_handed_over',
};

export function rollUp(units: DevUnit[]): StatusCounts & {
  total: number; valueAvailable: number; areaAvailable: number; soldPct: number;
} {
  const counts = {
    available: 0, on_hold: 0, negotiation: 0, reserved: 0,
    contract_pending: 0, sold: 0, total: 0, valueAvailable: 0,
    areaAvailable: 0, soldPct: 0,
  };
  for (const unit of units) {
    counts.total += 1;
    switch (unit.status) {
      case 'AVAILABLE':
        counts.available += 1;
        counts.valueAvailable += Number(unit.price ?? 0);
        counts.areaAvailable += Number(unit.area_total ?? 0);
        break;
      case 'ON_HOLD': counts.on_hold += 1; break;
      case 'NEGOTIATION': counts.negotiation += 1; break;
      case 'RESERVED': counts.reserved += 1; break;
      case 'CONTRACT_PENDING': counts.contract_pending += 1; break;
      case 'SOLD': counts.sold += 1; break;
      default: break;
    }
  }
  counts.soldPct = counts.total > 0
    ? Math.round(((counts.sold + counts.contract_pending) / counts.total) * 100) : 0;
  return counts;
}

export function ProjectHeader({
  project, units, currency, className,
}: {
  project: DevProject;
  units: DevUnit[];
  currency?: string | null;
  className?: string;
}) {
  const { t, lang: language } = useLanguage();
  const r = rollUp(units);
  const money = currency ?? project.currency;

  return (
    <section className={className}>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="grid lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <ProjectCover
            src={project.cover_image_url}
            name={project.name}
            ratio="aspect-[16/9] lg:aspect-auto lg:h-full lg:min-h-[13rem]"
            overlay={(
              <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-background/90 px-2 py-0.5 text-2xs font-medium backdrop-blur">
                {project.is_published
                  ? <><Eye className="h-3 w-3" aria-hidden="true" />{t('dev_published')}</>
                  : <><EyeOff className="h-3 w-3" aria-hidden="true" />{t('dev_unpublished')}</>}
              </span>
            )}
          />

          <div className="flex min-w-0 flex-col justify-between gap-5 p-5 sm:p-6">
            <div className="min-w-0">
              <h1
                className="truncate font-semibold tracking-[-0.025em]"
                style={{ fontSize: 'clamp(1.5rem, 2.4vw, 2.125rem)' }}
              >
                {project.name}
              </h1>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {(project.city || project.district) && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                    {[project.district, project.city].filter(Boolean).join(', ')}
                  </span>
                )}
                <span>{t(CONSTRUCTION_KEYS[project.construction_status])}</span>
                {project.handover_date && (
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="h-3 w-3 shrink-0" aria-hidden="true" />
                    {`${t('dev_handover')} ${formatDate(project.handover_date, language)}`}
                  </span>
                )}
              </p>
            </div>

            {r.total > 0 && (
              <div>
                <div className="flex flex-wrap items-end gap-x-9 gap-y-4">
                  <Metric
                    weight="hero"
                    label={t('dev_stat_available')}
                    value={(
                      <>
                        {formatNumber(r.available, language)}
                        <span className="ml-2 align-baseline text-base font-normal text-muted-foreground">
                          {`/ ${formatNumber(r.total, language)}`}
                        </span>
                      </>
                    )}
                    hint={formatArea(r.areaAvailable, language)}
                  />
                  <Metric
                    label={t('dev_value_available')}
                    value={formatMoney(r.valueAvailable, money, language)}
                  />
                  <Metric
                    label={t('dev_stat_sold')}
                    value={`${r.soldPct}%`}
                    hint={`${formatNumber(r.sold, language)} ${t('dev_stat_sold').toLowerCase()}`}
                  />
                </div>
                <SalesBar size="lg" showLegend className="mt-4" counts={r} />
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
