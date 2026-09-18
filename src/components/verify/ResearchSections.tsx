// HOMATCH VERIFY — what is ready to read, while the rest is still running.
//
// The percentage and the elapsed clock say how the RUN is going. This says
// what has actually been FOUND, section by section, and it is the thing a
// customer waiting eleven minutes was really asking for.
//
// EVERY NUMBER HERE WAS COUNTED SERVER-SIDE
//
// The maturity states and the counters come from research-agent's `sections`
// block, derived from the persisted result. Nothing is inferred from render
// time, so two tabs and a reopened case show the same thing, and a section
// cannot appear ready here while the report disagrees.
//
// PRELIMINARY IS LABELLED PRELIMINARY
//
// That is the entire contract of showing a section early. A reader is told
// which state they are looking at, so "usable now" never quietly becomes
// "final". A section that could not be established says so rather than
// staying blank, because an empty row reads as "still loading" forever.

import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { SectionId, SectionMaturity, SectionState, SectionsSnapshot } from '@/verify/sections';

/** Section title keys. Seven already exist as phase labels and are reused. */
const SECTION_LABEL: Record<SectionId, string> = {
  PROPERTY: 'verify_pstep_identity',
  LOCATION: 'verify_pstep_location',
  MARKET: 'verify_pstep_market',
  OFFICIAL: 'verify_pstep_official',
  DEVELOPER: 'verify_pstep_company',
  PARTICIPANTS: 'verify_pstep_participants',
  PUBLIC_CONTEXT: 'verify_section_public_context',
  RISKS: 'verify_section_risks',
  SYNTHESIS: 'verify_pstep_synthesis',
};

const MATURITY_LABEL: Record<SectionMaturity, string> = {
  PENDING: 'verify_maturity_pending',
  PRELIMINARY: 'verify_maturity_preliminary',
  ENRICHING: 'verify_maturity_enriching',
  VERIFIED: 'verify_maturity_verified',
  PARTIAL: 'verify_maturity_partial',
  UNAVAILABLE: 'verify_maturity_unavailable',
};

/**
 * Which counters are worth a customer's attention, and what to call them.
 *
 * Deliberately a subset. The server counts more than this — request counts,
 * cache hits, portal states — and those are operations data, not something a
 * buyer needs while deciding whether a price is fair.
 */
const METRIC_LABEL: Record<string, string> = {
  advertisements: 'verify_metric_advertisements',
  uniqueProperties: 'verify_metric_unique_properties',
  crossPosted: 'verify_metric_cross_posted',
  uncertainDuplicates: 'verify_metric_uncertain_duplicates',
  independentSources: 'verify_metric_independent_sources',
  priceConflicts: 'verify_metric_price_conflicts',
  sourcesChecked: 'verify_metric_sources_checked',
  sourcesConfirmed: 'verify_metric_sources_confirmed',
  sourcesBlocked: 'verify_metric_sources_blocked',
  documentsRetrieved: 'verify_metric_documents',
  nearbyPlaces: 'verify_metric_nearby_places',
  participants: 'verify_metric_participants',
  signals: 'verify_metric_signals',
  complaints: 'verify_metric_complaints',
  conflicts: 'verify_metric_conflicts',
  materialFindings: 'verify_metric_material_findings',
  riskFlags: 'verify_metric_risk_flags',
  directors: 'verify_metric_directors',
  relatedProjects: 'verify_metric_related_projects',
};

const NOTE_LABEL: Record<string, string> = {
  MARKET_ENVELOPE_WIDENED: 'verify_note_market_widened',
  MARKET_TIME_BUDGET_REACHED: 'verify_note_market_time_budget',
  OFFICIAL_SOURCE_NOT_READABLE: 'verify_note_official_not_readable',
  COMPANY_FROM_WEB_RESEARCH_ONLY: 'verify_note_company_web_only',
  UNIT_NOT_INDEPENDENTLY_CONFIRMED: 'verify_note_unit_not_confirmed',
  MARKET_SOURCE_BLOCKED: 'verify_note_market_source_blocked',
  MARKET_SOURCE_RATE_LIMITED: 'verify_note_market_source_blocked',
  MARKET_SOURCE_LOGIN_WALL: 'verify_note_market_source_blocked',
  MARKET_SOURCE_JOIN_REQUIRED: 'verify_note_market_source_blocked',
};

/** ✓ for settled, ● for moving, ○ for not started, ! for unavailable. */
function mark(maturity: SectionMaturity): string {
  if (maturity === 'VERIFIED') return '✓';
  if (maturity === 'PARTIAL') return '◐';
  if (maturity === 'UNAVAILABLE') return '—';
  if (maturity === 'PENDING') return '○';
  return '●';
}

function toneFor(maturity: SectionMaturity): string {
  switch (maturity) {
    case 'VERIFIED':
      return 'text-emerald-600 dark:text-emerald-400';
    case 'PARTIAL':
      return 'text-amber-600 dark:text-amber-400';
    case 'UNAVAILABLE':
      return 'text-muted-foreground/60';
    case 'PENDING':
      return 'text-muted-foreground/40';
    default:
      return 'text-primary';
  }
}

function SectionRow({ section }: { section: SectionState }) {
  const { t } = useLanguage();
  const metrics = Object.entries(section.metrics).filter(
    ([key, value]) => typeof value === 'number' && value > 0 && METRIC_LABEL[key],
  ) as Array<[string, number]>;

  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className={`mt-0.5 w-4 shrink-0 text-center text-sm leading-5 ${toneFor(section.maturity)}`}
      >
        {mark(section.maturity)}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium break-words">{t(SECTION_LABEL[section.id])}</span>
          <span className={`text-2xs uppercase tracking-wider ${toneFor(section.maturity)}`}>
            {t(MATURITY_LABEL[section.maturity])}
          </span>
        </div>

        {metrics.length > 0 && (
          <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
            {metrics.map(([key, value]) => (
              <li key={key} className="text-2xs text-muted-foreground">
                <span className="tabular-nums font-medium text-foreground/80">{value}</span>{' '}
                {t(METRIC_LABEL[key])}
              </li>
            ))}
          </ul>
        )}

        {section.notes.map((note) =>
          NOTE_LABEL[note] ? (
            <p key={note} className="text-2xs text-muted-foreground/80 break-words">
              {t(NOTE_LABEL[note])}
            </p>
          ) : null,
        )}
      </div>
    </li>
  );
}

export interface ResearchSectionsProps {
  sections?: SectionsSnapshot | null;
}

export function ResearchSections({ sections }: ResearchSectionsProps) {
  const { t } = useLanguage();
  if (!sections || !Array.isArray(sections.sections) || sections.sections.length === 0) return null;

  /*
   * Sections that have not started are shown, dimmed, rather than hidden.
   *
   * A list that grows as research proceeds makes the page jump and re-reads
   * badly; a stable list whose rows change state does not. The order is the
   * pipeline's own, so a reader can see what is still ahead.
   */
  return (
    <section
      aria-live="polite"
      aria-label={t('verify_sections_title')}
      className="rounded-2xl border border-border bg-card/40 p-4 sm:p-5 space-y-3"
    >
      <p className="text-2xs uppercase tracking-wider text-muted-foreground/70">
        {t('verify_sections_title')}
      </p>
      <ul className="space-y-2.5">
        {sections.sections.map((section) => (
          <SectionRow key={section.id} section={section} />
        ))}
      </ul>
    </section>
  );
}
